import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { PaymentFlow } from "@/components/store/PaymentFlow";
import { PubgIdVerify } from "@/components/store/PubgIdVerify";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Checkout() {
  const { t } = useLang();
  const { items, total } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const ctx = location.state || {};
  const [pubgId, setPubgId] = useState(ctx.pubgId || searchParams.get("pubg_id") || user?.saved_pubg_ids?.[0] || "");
  const [verified, setVerified] = useState(ctx.verified || null);
  const [email, setEmail] = useState(ctx.email || "");
  const [method, setMethod] = useState(ctx.method || null);
  const [phone, setPhone] = useState(ctx.phone || user?.phone || "");
  const [reference, setReference] = useState(ctx.reference || { provider: "mvola", value: "" });
  const [config, setConfig] = useState(null);
  const [autoVerify, setAutoVerify] = useState(0);

  useEffect(() => {
    api.get("/payments/config").then(({ data }) => setConfig(data)).catch(() => {});
  }, []);

  if (items.length === 0) {
    return <div className="py-24 text-center" data-testid="checkout-empty"><p className="text-muted-foreground">{t("cart.empty")}</p><Button asChild className="mt-4 rounded-full"><Link to="/boutique">{t("cart.browse")}</Link></Button></div>;
  }

  const goConfirm = () => {
    if (!/^\d{9,13}$/.test(pubgId.trim())) return toast.error(t("checkout.pubgId"));
    if (!verified) return toast.error(t("checkout.verifyRequired"));
    if (!method) return;
    if (method === "manual" && !(reference.value || "").trim()) return toast.error(t("checkout.refRequired"));
    navigate("/commande/confirmation", { state: { pubgId: pubgId.trim(), verified, email, method, phone, reference } });
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 pb-28 pt-6" data-testid="checkout-form">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("checkout.title")}</h1>

      <section className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6">
        <h2 className="font-display text-lg font-bold">{t("checkout.account")}</h2>
        <div className="mt-4">
          <label htmlFor="pubg-id" className="text-sm font-semibold">{t("checkout.pubgId")}</label>
          <Input id="pubg-id" data-testid="pubg-id-input" inputMode="numeric" value={pubgId} onChange={(e) => setPubgId(e.target.value.replace(/\D/g, ""))} required className="mt-1 h-12 rounded-[12px]" placeholder="5123456789" />
          {user?.saved_pubg_ids?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">{user.saved_pubg_ids.map((id) => <button type="button" key={id} data-testid={`saved-id-${id}`} onClick={() => { setPubgId(id); setAutoVerify((n) => n + 1); }} className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:bg-primary hover:text-[#0A0A0A]">{id}</button>)}</div>
          )}
          <PubgIdVerify pubgId={pubgId} onVerified={setVerified} autoTrigger={autoVerify} />
        </div>
        {!user && (
          <div className="mt-4">
            <label htmlFor="email" className="text-sm font-semibold">{t("checkout.email")}</label>
            <Input id="email" type="email" data-testid="guest-email-input" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 rounded-[12px]" />
            <p className="mt-2 text-xs text-muted-foreground">{t("checkout.guest")} <Link to="/connexion" state={{ from: "/commande" }} className="font-semibold text-primary">{t("checkout.loginHint")}</Link></p>
          </div>
        )}
      </section>

      <section className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6">
        <h2 className="font-display text-lg font-bold">{t("checkout.payment")}</h2>
        <div className="mt-4">
          <PaymentFlow method={method} setMethod={setMethod} phone={phone} setPhone={setPhone} reference={reference} setReference={setReference} subtotal={total} config={config} onPay={goConfirm} />
        </div>
      </section>
    </div>
  );
}
