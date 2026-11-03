import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/context/LanguageContext";
import { IdentityFieldsVerify } from "@/components/store/checkout/IdentityFieldsVerify";

// Jeu historique : seuls ses IDs mémorisés sur le compte (`saved_pubg_ids`)
// restent proposés en chips de pré-remplissage. La VÉRIFICATION passe désormais
// par le composant GÉNÉRIQUE (route /fazercards/validate-id, tous jeux, PUBG
// Mobile compris) — plus aucun format supposé, plus de contrôle de chiffres ici.
const LEGACY_GAME = "pubg-mobile";

export function StepVerify({ gameName, pubgId, setPubgId, user, verified, setVerified, autoVerify, setAutoVerify, gameId, identity, setIdentity, identitySpec, identityValues, setIdentityValues, email, setEmail, onContinue }) {
  const { t } = useLang();
  const [identities, setIdentities] = useState([]);
  // Contrat d'identité piloté par la CONFIG ADMIN du jeu (jamais une hypothèse `player_id`).
  const spec = useMemo(() => (Array.isArray(identitySpec) ? identitySpec : []), [identitySpec]);
  const primaryKey = useMemo(() => spec.find((f) => f.primary)?.key || spec[0]?.key || "player_id", [spec]);

  useEffect(() => {
    if (!user) return;
    api.get("/me/game-identities", { params: { game_id: gameId } }).then((r) => setIdentities(r.data)).catch(() => setIdentities([]));
  }, [user, gameId]);

  const known = new Set(identities.map((i) => i.fields?.[primaryKey]));
  const legacyIds = gameId === LEGACY_GAME ? (user?.saved_pubg_ids || []).filter((id) => !known.has(id)) : [];

  const valuesRef = useRef(identityValues); valuesRef.current = identityValues;
  const identsRef = useRef(identities); identsRef.current = identities;
  const uid = user?.user_id;

  // Toute écriture dans les champs passe ici : elle marque le jeu « touché »,
  // pour que le pré-remplissage ne revienne jamais face à un effacement volontaire.
  const touched = useRef(null);
  const writeValues = useCallback((v) => { touched.current = gameId; setIdentityValues(v); }, [gameId, setIdentityValues]);

  // Pré-remplissage (§4.8) : une identité déjà connue (dernier ID…) arrive dans
  // les champs mais n'est JAMAIS comptée comme vérifiée — la re-vérification
  // réelle (POST /fazercards/validate-id) repart de zéro pour la commande.
  const valuesKey = JSON.stringify(identityValues || {});
  useEffect(() => {
    if (!spec.length || !pubgId || touched.current === gameId) return;
    if (!((valuesRef.current || {})[primaryKey])) {
      setIdentityValues((v) => ({ ...v, [primaryKey]: pubgId }));
    }
  }, [valuesKey, gameId, primaryKey, pubgId, spec.length, setIdentityValues]);

  const saveIdentity = useCallback((fields, name) => {
    if (!uid) return;
    const found = identsRef.current.find((i) => Object.entries(fields).every(([k, v]) => i.fields?.[k] === v));
    if (found) return setIdentity(found);
    api.post("/me/game-identities", { game_id: gameId, label: name || fields[primaryKey], fields, ...(name ? { player_name: name } : {}) })
      .then(({ data }) => { setIdentities((l) => (l.some((i) => i.id === data.id) ? l : [...l, data])); setIdentity(data); })
      .catch(() => {});
  }, [uid, gameId, primaryKey, setIdentity]);

  // Après vérification réussie : les champs TRIMMÉS du formulaire partent dans
  // la commande — aucun drapeau « validated » n'est envoyé ni stocké. La valeur
  // primaire miroite `pubgId` (colonne historique du payload /orders, PUBG
  // inchangé) ; l'identité est enregistrée (dédupliquée côté serveur).
  const handleVerified = useCallback((v) => {
    setVerified(v);
    if (!v) return;
    const fields = Object.fromEntries(spec.map((f) => [f.key, ((valuesRef.current || {})[f.key] || "").trim()]));
    if (fields[primaryKey]) setPubgId(fields[primaryKey]);
    saveIdentity(fields, v.name);
  }, [setVerified, spec, primaryKey, setPubgId, saveIdentity]);

  // Identité enregistrée choisie : champs pré-remplis (§4.8) + REVÉRIFICATION
  // immédiate (autoTrigger) — une identité sauvegardée n'est jamais acceptée
  // telle quelle.
  const pickIdentity = (it) => {
    setIdentity(it);
    writeValues(Object.fromEntries(spec.map((f) => [f.key, it.fields?.[f.key] || ""])));
    if (it.fields?.[primaryKey]) setPubgId(it.fields[primaryKey]);
    setAutoVerify((n) => n + 1);
  };

  const legacyPick = (id) => {
    writeValues((v) => ({ ...v, [primaryKey]: id }));
    setPubgId(id);
    setAutoVerify((n) => n + 1);
  };

  const selected = identity?.id && Object.entries(identity.fields || {}).every(([k, v]) => (identityValues || {})[k] === v);

  return (
    <section className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6" data-testid="checkout-step-verify">
      <h2 className="font-display text-xl font-bold" data-testid="checkout-verify-title">{spec.length ? t("checkout.verifyTitleGame", { game: gameName || "" }) : t("checkout.verifyTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("checkout.verifySub")}</p>
      {!user && (
        <div className="mt-4">
          <label htmlFor="email" className="text-sm font-semibold">{t("checkout.email")}</label>
          <Input id="email" type="email" data-testid="guest-email-input" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 rounded-[12px]" />
          <p className="mt-2 text-xs text-muted-foreground">{t("checkout.guest")} <Link to="/connexion" state={{ from: "/commande" }} className="font-semibold text-primary">{t("checkout.loginHint")}</Link></p>
        </div>
      )}
      <div className="mt-4">
        <IdentityFieldsVerify spec={spec} gameId={gameId} values={identityValues} setValues={writeValues}
          onVerified={handleVerified} autoTrigger={autoVerify} checkout initial={verified} />
        {identities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1" data-testid="checkout-identities">{identities.map((it) => <button type="button" key={it.id} data-testid={`identity-pick-${it.id}`} onClick={() => pickIdentity(it)} className={`rounded-full px-2 py-0.5 text-xs font-semibold transition-colors hover:bg-primary hover:text-[#0A0A0A] ${selected && identity?.id === it.id ? "bg-primary text-[#0A0A0A]" : "bg-muted text-muted-foreground"}`}>{it.label}</button>)}</div>
        )}
        {legacyIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{legacyIds.map((id) => <button type="button" key={id} data-testid={`saved-id-${id}`} onClick={() => legacyPick(id)} className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary hover:text-[#0A0A0A]">{id}</button>)}</div>
        )}
      </div>
      {verified && (
        <Button type="button" onClick={onContinue} data-testid="checkout-verify-continue" className="mt-4 h-12 w-full rounded-full text-base font-bold">{t("checkout.continue")}</Button>
      )}
    </section>
  );
}
