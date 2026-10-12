import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/context/LanguageContext";
import { PubgIdVerify } from "@/components/store/PubgIdVerify";

export function StepVerify({ pubgId, setPubgId, user, verified, setVerified, autoVerify, setAutoVerify, gameId, identity, setIdentity, email, setEmail, onContinue }) {
  const { t } = useLang();
  const [identities, setIdentities] = useState([]);
  useEffect(() => {
    if (!user) return;
    api.get("/me/game-identities", { params: { game_id: gameId } }).then((r) => setIdentities(r.data)).catch(() => setIdentities([]));
  }, [user, gameId]);
  const known = new Set(identities.map((i) => i.fields?.player_id));
  const legacyIds = (user?.saved_pubg_ids || []).filter((id) => !known.has(id));
  const pubgRef = useRef(pubgId); pubgRef.current = pubgId;
  const identsRef = useRef(identities); identsRef.current = identities;
  const uid = user?.user_id;
  // After a successful verification, a new PUBG ID is saved right away as a GameIdentity (deduplicated server-side).
  const handleVerified = useCallback((v) => {
    setVerified(v);
    if (!v || !uid) return;
    const pid = pubgRef.current.trim();
    const found = identsRef.current.find((i) => i.fields?.player_id === pid);
    if (found) return setIdentity(found);
    api.post("/me/game-identities", { game_id: gameId, label: `PUBG ${pid}`, fields: { player_id: pid }, ...(v.name ? { player_name: v.name } : {}) })
      .then(({ data }) => { setIdentities((l) => (l.some((i) => i.id === data.id) ? l : [...l, data])); setIdentity(data); })
      .catch(() => {});
  }, [setVerified, uid, gameId, setIdentity]);
  const pickIdentity = (it) => { setIdentity(it); setPubgId(it.fields?.player_id || ""); setAutoVerify((n) => n + 1); };
  return (
    <section className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6" data-testid="checkout-step-verify">
      <h2 className="font-display text-xl font-bold">{t("checkout.verifyTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("checkout.verifySub")}</p>
      {!user && (
        <div className="mt-4">
          <label htmlFor="email" className="text-sm font-semibold">{t("checkout.email")}</label>
          <Input id="email" type="email" data-testid="guest-email-input" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 rounded-[12px]" />
          <p className="mt-2 text-xs text-muted-foreground">{t("checkout.guest")} <Link to="/connexion" state={{ from: "/commande" }} className="font-semibold text-primary">{t("checkout.loginHint")}</Link></p>
        </div>
      )}
      <div className="mt-4">
        <label htmlFor="pubg-id" className="text-sm font-semibold">{t("checkout.playerId")}</label>
        <Input id="pubg-id" data-testid="pubg-id-input" inputMode="numeric" value={pubgId} onChange={(e) => setPubgId(e.target.value.replace(/\D/g, ""))} required className="mt-1 h-12 rounded-[12px] num" placeholder="5123456789" />
        {identities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1" data-testid="checkout-identities">{identities.map((it) => <button type="button" key={it.id} data-testid={`identity-pick-${it.id}`} onClick={() => pickIdentity(it)} className={`rounded-full px-2 py-0.5 text-xs font-semibold transition-colors hover:bg-primary hover:text-[#0A0A0A] ${identity?.id === it.id && identity?.fields?.player_id === pubgId ? "bg-primary text-[#0A0A0A]" : "bg-muted text-muted-foreground"}`}>{it.label}</button>)}</div>
        )}
        {legacyIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{legacyIds.map((id) => <button type="button" key={id} data-testid={`saved-id-${id}`} onClick={() => { setPubgId(id); setAutoVerify((n) => n + 1); }} className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary hover:text-[#0A0A0A]">{id}</button>)}</div>
        )}
        <PubgIdVerify pubgId={pubgId} onVerified={handleVerified} autoTrigger={autoVerify} checkout initial={verified} />
      </div>
      {verified && (
        <Button type="button" onClick={onContinue} data-testid="checkout-verify-continue" className="mt-4 h-12 w-full rounded-full text-base font-bold">{t("checkout.continue")}</Button>
      )}
    </section>
  );
}
