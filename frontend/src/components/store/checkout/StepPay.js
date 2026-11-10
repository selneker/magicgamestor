import { Loader2, Zap } from "lucide-react";
import { formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { PaymentStatus } from "@/components/store/PaymentStatus";
import { OrderSummary } from "@/components/store/checkout/StepConfirm";
import { BinancePay } from "@/components/store/checkout/BinancePay";
import { PaymentCountdown } from "@/components/store/checkout/PaymentCountdown";
import { ProofPay } from "@/components/store/checkout/ProofPay";

// PL-CHK-2 — l'étape 3 affiche le compte à rebours (payment_deadline_at) pour
// TOUTES les méthodes ; le paiement manuel délègue entièrement à ProofPay
// (instructions USSD + envoi de preuve + écran d'attente). Mvola/ORANGE AUTO
// et Binance gardent leurs comportements et textes inchangés.

export function StepPay({ method, order, config, summary, reference, busy, captchaReady = true, onPayAuto, cryptoPayment, onConfirmed, trackUrl, onUpdated, onRefresh }) {
  if (method === "manual") {
    return <ProofPay order={order} config={config} summary={summary} reference={reference} onUpdated={onUpdated} onConfirmed={onConfirmed} />;
  }
  if (method === "binance") {
    return cryptoPayment ? (
      <section className="space-y-4" data-testid="checkout-step-pay-binance">
        <PaymentCountdown order={order} onZero={onRefresh} />
        <OrderSummary summary={summary} sticky />
        <BinancePay payment={cryptoPayment} orderId={order.id} onConfirmed={onConfirmed} trackUrl={trackUrl} />
      </section>
    ) : null;
  }
  if (order?.attempt) {
    return (
      <section className="space-y-4" data-testid="checkout-step-pay-auto-status">
        <PaymentCountdown order={order} onZero={onRefresh} />
        <OrderSummary summary={summary} sticky />
        <PaymentStatus key={order.attempt} order={order} onRetry={onPayAuto} onCompleted={onConfirmed} />
      </section>
    );
  }
  return (
    <section className="space-y-4" data-testid="checkout-step-pay-auto">
      <PaymentCountdown order={order} onZero={onRefresh} />
      <AutoPay summary={summary} busy={busy} captchaReady={captchaReady} onPay={onPayAuto} />
    </section>
  );
}

function AutoPay({ summary, busy, captchaReady = true, onPay }) {
  const { t } = useLang();
  return (
    <>
      <OrderSummary summary={summary} sticky />
      <p className="flex items-center gap-2 rounded-[14px] bg-muted px-3 py-2 text-sm font-semibold text-foreground"><Zap className="h-4 w-4 shrink-0" />{t("checkout.autoVerifyNote")}</p>
      <p className="text-sm text-muted-foreground">{t("checkout.playerVerifyNote")}</p>
      <Button type="button" onClick={onPay} disabled={busy || !captchaReady} data-testid="checkout-pay-now" className="h-12 w-full rounded-full text-base font-bold">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.processing")}</> : `${t("checkout.payNow")} · ${formatAr(summary.subtotal + summary.fee)}`}
      </Button>
    </>
  );
}
