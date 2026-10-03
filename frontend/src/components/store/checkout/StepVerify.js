import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/context/LanguageContext";
import { PubgIdVerify } from "@/components/store/PubgIdVerify";

export function StepVerify({ pubgId, setPubgId, user, verified, setVerified, autoVerify, setAutoVerify, email, setEmail, onContinue }) {
  const { t } = useLang();
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
        {user?.saved_pubg_ids?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{user.saved_pubg_ids.map((id) => <button type="button" key={id} data-testid={`saved-id-${id}`} onClick={() => { setPubgId(id); setAutoVerify((n) => n + 1); }} className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary hover:text-[#0A0A0A]">{id}</button>)}</div>
        )}
        <PubgIdVerify pubgId={pubgId} onVerified={setVerified} autoTrigger={autoVerify} checkout initial={verified} />
      </div>
      {verified && (
        <Button type="button" onClick={onContinue} data-testid="checkout-verify-continue" className="mt-4 h-12 w-full rounded-full text-base font-bold">{t("checkout.continue")}</Button>
      )}
    </section>
  );
}
