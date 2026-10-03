import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { PaymentStatus } from "@/components/store/PaymentStatus";
import { Button } from "@/components/ui/button";

export default function CheckoutConfirm() {
  const { t, lang } = useLang();
  const { items, total, clear } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const ctx = location.state;
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);

  useEffect(() => {
    api.get("/payments/config").then(({ data }) => setConfig(data)).catch(() => {});
  }, []);

  const initiateUrl = (o) => (o.payment_provider === "fiveone" ? "/payments/fiveone/initiate" : "/payments/initiate");

  // Non-manual order created → poll status (same lifecycle as before).
  if (order && order.payment_method !== "manual") {
    return (
      <div className="mx-auto max-w-xl py-10" data-testid="checkout-confirm-page">
        <PaymentStatus key={order.attempt || 0} order={order} onRetry={() => api.post(initiateUrl(order), { order_id: order.id }).then(({ data }) => { if (data.payment_url && !data.simulated) return window.location.assign(data.payment_url); setOrder({ ...order, attempt: (order.attempt || 0) + 1 }); }).catch((e) => toast.error(errorMessage(e)))} />
      </div>
    );
  }

  // Guard: no checkout context or empty cart → back to checkout.
  if (!ctx || !ctx.method || items.length === 0) return <Navigate to="/commande" replace />;

  const manual = ctx.method === "manual";
  const feeRule = config?.payment_fees?.[manual ? "manual" : config?.gateway === "fiveone" ? "fiveone" : "papi"];
  const fee = feeRule ? Math.min(Math.max(Math.round((total * feeRule.percent) / 100), feeRule.min), feeRule.max) : 0;
  const grandTotal = total + fee;
  const methodLabel = manual ? t("checkout.manualTitle") : ctx.method === "mvola" ? t("checkout.mvolaAuto") : t("checkout.orangeAuto");

  const confirm = async () => {
    setBusy(true);
    try {
      const payload = {
        pubg_id: ctx.pubgId, pseudo: (ctx.verified?.name || ctx.pubgId), email: ctx.email || undefined,
        items: items.map((i) => ({ product_id: i.id, quantity: i.qty })),
        payment_method: ctx.method, payment_phone: manual ? undefined : ctx.phone,
        manual_reference: manual ? `${ctx.reference.provider}:${ctx.reference.value}` : undefined,
      };
      const { data: created } = await api.post("/orders", payload);
      clear();
      if (manual) {
        toast.success(`${t("order.title")} ${created.order_number}`);
        return navigate(`/suivi/${created.order_number}?pubg_id=${created.pubg_id}`);
      }
      const { data: payment } = await api.post(initiateUrl(created), { order_id: created.id });
      if (payment.payment_url && !payment.simulated) { window.location.assign(payment.payment_url); return; }
      setOrder({ ...created, simulated: payment.simulated });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl pb-16 pt-3" data-testid="checkout-confirm-page">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate("/commande", { state: ctx })}
        className="h-10 w-10 shrink-0 rounded-full border border-[color:var(--rule-strong)] bg-card"
        data-testid="checkout-confirm-back"
        aria-label={t("common.back")}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
      </Button>

      <h1 className="mt-4 font-display text-2xl font-bold" data-testid="checkout-confirm-title">{t("checkout.confirmTitle")}</h1>

      <div className="mt-6 space-y-4 rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-5" data-testid="checkout-confirm-summary">
        <Field label={t("checkout.product")}>
          {items.map((i) => <p key={i.id} className="text-sm font-semibold text-foreground">{i.qty} × {lang === "en" && i.name_en ? i.name_en : i.name}</p>)}
        </Field>
        <Field label={t("checkout.playerId")}>
          <p className="num text-sm text-foreground" data-testid="confirm-player-id">{ctx.pubgId}</p>
          {ctx.verified?.name && <p className="text-xs text-muted-foreground">{ctx.verified.name}</p>}
        </Field>
        <Field label={t("checkout.methodCol")}>
          <p className="text-sm font-semibold text-foreground" data-testid="confirm-method">{methodLabel}</p>
        </Field>

        <div className="space-y-2 border-t-2 border-[color:var(--rule)] pt-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t("checkout.amount")}</span><span className="font-semibold text-foreground">{formatAr(total)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t("checkout.paymentFee")}</span><span className="font-semibold text-foreground" data-testid="confirm-fee">{formatAr(fee)}</span></div>
          <div className="flex justify-between gap-3 border-t-2 border-[color:var(--rule)] pt-2 text-base font-bold"><span>{t("checkout.totalToPay")}</span><span className="num" data-testid="confirm-total">{formatAr(grandTotal)}</span></div>
        </div>
      </div>

      <Button type="button" onClick={confirm} disabled={busy} data-testid="confirm-and-pay-button" className="mt-6 h-12 w-full rounded-full text-base font-bold">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.processing")}</> : `${t("checkout.confirmAndPay")} · ${formatAr(grandTotal)}`}
      </Button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
