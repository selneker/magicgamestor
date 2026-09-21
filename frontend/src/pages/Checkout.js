import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { PaymentMethodPicker } from "@/components/store/PaymentMethodPicker";
import { PaymentStatus } from "@/components/store/PaymentStatus";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Checkout() {
  const { t, lang } = useLang();
  const { items, total, clear } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pubgId, setPubgId] = useState(user?.saved_pubg_ids?.[0] || "");
  const [pseudo, setPseudo] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState("mvola");
  const [phone, setPhone] = useState(user?.phone || "");
  const [reference, setReference] = useState({ provider: "mvola", value: "" });
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    api.get("/payments/config").then(({ data }) => {
      setConfig(data);
      if (data.papi_auto === false) setMethod("manual");
    }).catch(() => {});
  }, []);
  const manual = method === "manual";

  if (order && order.payment_method !== "manual") {
    return <div className="py-12"><PaymentStatus key={order.attempt || 0} order={order} onRetry={() => api.post("/payments/initiate", { order_id: order.id }).then(({ data }) => { if (data.payment_url && !data.simulated) return window.location.assign(data.payment_url); setOrder({ ...order, attempt: (order.attempt || 0) + 1 }); }).catch((e) => toast.error(errorMessage(e)))} /></div>;
  }

  if (items.length === 0) {
    return <div className="py-24 text-center" data-testid="checkout-empty"><p className="text-slate-500">{t("cart.empty")}</p><Button asChild className="mt-4 rounded-full"><Link to="/boutique">{t("cart.browse")}</Link></Button></div>;
  }

  const submit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!/^\d{9,13}$/.test(pubgId.trim())) return toast.error(t("checkout.pubgId"));
    if (manual && !(reference.value || "").trim()) return toast.error(t("checkout.refRequired"));
    setBusy(true);
    try {
      const payload = {
        pubg_id: pubgId.trim(), pseudo: pseudo.trim(), email: email || undefined,
        items: items.map((i) => ({ product_id: i.id, quantity: i.qty })),
        payment_method: method, payment_phone: method === "manual" ? undefined : phone,
        manual_reference: method === "manual" ? `${reference.provider}:${reference.value}` : undefined,
      };
      const { data: created } = await api.post("/orders", payload);
      clear();
      if (method === "manual") {
        toast.success(`${t("order.title")} ${created.order_number}`);
        return navigate(`/suivi/${created.order_number}?pubg_id=${created.pubg_id}`);
      }
      const { data: payment } = await api.post("/payments/initiate", { order_id: created.id });
      if (payment.payment_url && !payment.simulated) { window.location.assign(payment.payment_url); return; }
      setOrder({ ...created, simulated: payment.simulated });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-8 pb-28 pt-6 lg:grid-cols-[1.2fr_0.8fr]" data-testid="checkout-form">
      <div className="space-y-8">
        <h1 className="font-display text-3xl font-bold text-slate-900 sm:text-4xl">{t("checkout.title")}</h1>
        <section className="rounded-[2rem] border border-slate-100 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("checkout.account")}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pubg-id" className="text-sm font-semibold text-slate-700">{t("checkout.pubgId")}</label>
              <Input id="pubg-id" data-testid="pubg-id-input" inputMode="numeric" value={pubgId} onChange={(e) => setPubgId(e.target.value.replace(/\D/g, ""))} required className="mt-1 h-12 rounded-xl" placeholder="5123456789" />
              {user?.saved_pubg_ids?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">{user.saved_pubg_ids.map((id) => <button type="button" key={id} data-testid={`saved-id-${id}`} onClick={() => setPubgId(id)} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">{id}</button>)}</div>
              )}
            </div>
            <div>
              <label htmlFor="pseudo" className="text-sm font-semibold text-slate-700">{t("checkout.pseudo")}</label>
              <Input id="pseudo" data-testid="pseudo-input" value={pseudo} onChange={(e) => setPseudo(e.target.value)} required minLength={2} className="mt-1 h-12 rounded-xl" />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">{t("checkout.hint")}</p>
          {!user && (
            <div className="mt-4">
              <label htmlFor="email" className="text-sm font-semibold text-slate-700">{t("checkout.email")}</label>
              <Input id="email" type="email" data-testid="guest-email-input" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 rounded-xl" />
              <p className="mt-2 text-xs text-slate-500">{t("checkout.guest")} <Link to="/connexion" state={{ from: "/commande" }} className="font-semibold text-primary">{t("checkout.loginHint")}</Link></p>
            </div>
          )}
        </section>
        <section className="rounded-[2rem] border border-slate-100 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("checkout.payment")}</h2>
          <div className="mt-4"><PaymentMethodPicker method={method} setMethod={setMethod} phone={phone} setPhone={setPhone} reference={reference} setReference={setReference} total={total} config={config} /></div>
        </section>
      </div>
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)]" data-testid="order-summary">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("checkout.summary")}</h2>
          <div className="mt-4 border border-foreground bg-muted/40 p-3 text-sm" data-testid="summary-pubg">
            <p className="eyebrow">{t("checkout.pubgAccount")}</p>
            <p className="mt-1 text-foreground"><span className="font-semibold">{t("checkout.pubgIdShort")} :</span> <span className="num break-all" data-testid="summary-pubg-id">{pubgId || "—"}</span></p>
            <p className="text-foreground"><span className="font-semibold">{t("checkout.pseudo")} :</span> <span className="break-all" data-testid="summary-pubg-pseudo">{pseudo || "—"}</span></p>
          </div>
          <ul className="mt-4 divide-y">
            {items.map((i) => <li key={i.id} className="flex justify-between py-2 text-sm"><span className="text-slate-600">{i.qty} × {lang === "en" && i.name_en ? i.name_en : i.name}</span><span className="font-semibold">{formatAr(i.qty * i.price)}</span></li>)}
          </ul>
          <div className="mt-4 flex items-center justify-between border-t pt-4"><span className="font-semibold text-slate-600">{t("cart.total")}</span><span data-testid="checkout-total" className="font-display text-2xl font-bold text-slate-900">{formatAr(total)}</span></div>
          <Button type="submit" disabled={busy} data-testid="pay-button" className="mt-6 h-12 w-full rounded-full text-base font-bold" style={{ background: method === "mvola" ? "var(--mvola)" : method === "orange" ? "var(--orange)" : undefined }}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.processing")}</> : manual ? t("checkout.send") : `${t("checkout.pay")} ${formatAr(total)}`}
          </Button>
        </div>
      </aside>
    </form>
  );
}
