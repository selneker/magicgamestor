import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/context/LanguageContext";
import { PubgIdVerify } from "@/components/store/PubgIdVerify";
import { IdentityFieldsVerify } from "@/components/store/checkout/IdentityFieldsVerify";

// Jeu historique : PUBG Mobile garde son écran de saisie EXACT (champ numérique + PubgIdVerify).
const LEGACY_GAME = "pubg-mobile";

export function StepVerify({ gameName, pubgId, setPubgId, user, verified, setVerified, autoVerify, setAutoVerify, gameId, identity, setIdentity, identitySpec, identityValues, setIdentityValues, email, setEmail, onContinue }) {
  const { t } = useLang();
  const [identities, setIdentities] = useState([]);
  // Contrat d'identité piloté par la CONFIG ADMIN du jeu (jamais une hypothèse `player_id`).
  const spec = useMemo(() => (Array.isArray(identitySpec) ? identitySpec : []), [identitySpec]);
  const dynamic = gameId !== LEGACY_GAME && spec.length > 0;
  const primaryKey = useMemo(() => spec.find((f) => f.primary)?.key || spec[0]?.key || "player_id", [spec]);
  const primaryValue = dynamic ? ((identityValues || {})[primaryKey] || "") : pubgId;

  useEffect(() => {
    if (!user) return;
    api.get("/me/game-identities", { params: { game_id: gameId } }).then((r) => setIdentities(r.data)).catch(() => setIdentities([]));
  }, [user, gameId]);

  const known = new Set(identities.map((i) => i.fields?.[primaryKey]));
  const legacyIds = dynamic ? [] : (user?.saved_pubg_ids || []).filter((id) => !known.has(id));
  const pubgRef = useRef(pubgId); pubgRef.current = pubgId;
  const valuesRef = useRef(identityValues); valuesRef.current = identityValues;
  const identsRef = useRef(identities); identsRef.current = identities;
  const uid = user?.user_id;

  const saveIdentity = useCallback((fields, name) => {
    if (!uid) return;
    const found = identsRef.current.find((i) => Object.entries(fields).every(([k, v]) => i.fields?.[k] === v));
    if (found) return setIdentity(found);
    api.post("/me/game-identities", { game_id: gameId, label: dynamic ? name || fields[primaryKey] : `PUBG ${fields.player_id}`, fields, ...(name ? { player_name: name } : {}) })
      .then(({ data }) => { setIdentities((l) => (l.some((i) => i.id === data.id) ? l : [...l, data])); setIdentity(data); })
      .catch(() => {});
  }, [uid, gameId, dynamic, primaryKey, setIdentity]);

  // Après vérification réussie, une nouvelle identité est enregistrée immédiatement (dédupliquée côté serveur).
  const handleVerified = useCallback((v) => {
    setVerified(v);
    if (!v || !uid) return;
    if (dynamic) {
      const fields = Object.fromEntries(spec.map((f) => [f.key, ((valuesRef.current || {})[f.key] || "").trim()]));
      return saveIdentity(fields, v.name);
    }
    return saveIdentity({ player_id: pubgRef.current.trim() }, v.name);
  }, [setVerified, uid, dynamic, spec, saveIdentity]);

  const pickIdentity = (it) => {
    setIdentity(it);
    if (dynamic) setIdentityValues(Object.fromEntries(spec.map((f) => [f.key, it.fields?.[f.key] || ""])));
    else setPubgId(it.fields?.player_id || "");
    setAutoVerify((n) => n + 1);
  };

  const selected = identity?.id && Object.entries(dynamic ? identity.fields || {} : { player_id: primaryValue })
    .every(([k, v]) => (dynamic ? (identityValues || {})[k] === v : pubgId.trim() === v));

  return (
    <section className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6" data-testid="checkout-step-verify">
      <h2 className="font-display text-xl font-bold" data-testid="checkout-verify-title">{dynamic ? t("checkout.verifyTitleGame", { game: gameName || "" }) : t("checkout.verifyTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("checkout.verifySub")}</p>
      {!user && (
        <div className="mt-4">
          <label htmlFor="email" className="text-sm font-semibold">{t("checkout.email")}</label>
          <Input id="email" type="email" data-testid="guest-email-input" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 rounded-[12px]" />
          <p className="mt-2 text-xs text-muted-foreground">{t("checkout.guest")} <Link to="/connexion" state={{ from: "/commande" }} className="font-semibold text-primary">{t("checkout.loginHint")}</Link></p>
        </div>
      )}
      <div className="mt-4">
        {dynamic ? (
          <IdentityFieldsVerify spec={spec} gameId={gameId} values={identityValues} setValues={setIdentityValues}
            onVerified={handleVerified} autoTrigger={autoVerify} checkout initial={verified} />
        ) : (
          <>
            <label htmlFor="pubg-id" className="text-sm font-semibold">{t("checkout.playerId")}</label>
            <Input id="pubg-id" data-testid="pubg-id-input" inputMode="numeric" value={pubgId} onChange={(e) => setPubgId(e.target.value.replace(/\D/g, ""))} required className="mt-1 h-12 rounded-[12px] num" placeholder="5123456789" />
            <PubgIdVerify pubgId={pubgId} onVerified={handleVerified} autoTrigger={autoVerify} checkout initial={verified} />
          </>
        )}
        {identities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1" data-testid="checkout-identities">{identities.map((it) => <button type="button" key={it.id} data-testid={`identity-pick-${it.id}`} onClick={() => pickIdentity(it)} className={`rounded-full px-2 py-0.5 text-xs font-semibold transition-colors hover:bg-primary hover:text-[#0A0A0A] ${selected && identity?.id === it.id ? "bg-primary text-[#0A0A0A]" : "bg-muted text-muted-foreground"}`}>{it.label}</button>)}</div>
        )}
        {legacyIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{legacyIds.map((id) => <button type="button" key={id} data-testid={`saved-id-${id}`} onClick={() => { setPubgId(id); setAutoVerify((n) => n + 1); }} className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary hover:text-[#0A0A0A]">{id}</button>)}</div>
        )}
      </div>
      {verified && (
        <Button type="button" onClick={onContinue} data-testid="checkout-verify-continue" className="mt-4 h-12 w-full rounded-full text-base font-bold">{t("checkout.continue")}</Button>
      )}
    </section>
  );
}
