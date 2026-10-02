import { Loader2, Smartphone, Zap } from "lucide-react";
import { formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { PaymentStatus } from "@/components/store/PaymentStatus";
import { USSD } from "@/components/store/PaymentFlow";
import { OrderSummary } from "@/components/store/checkout/StepConfirm";
import { BinancePay } from "@/components/store/checkout/BinancePay";

export function StepPay({ method, order, config, summary, reference, busy, onPayAuto, onManualPaid, cryptoPayment, onConfirmed, trackUrl }) {
  if (method === "manual") return <ManualPay config={config} summary={summary} reference={reference} onPaid={onManualPaid} />;
  if (method === "binance") return cryptoPayment ? <BinancePay payment={cryptoPayment} orderId={order.id} onConfirmed={onConfirmed} trackUrl={trackUrl} /> : null;
  if (order?.attempt) return <PaymentStatus key={order.attempt} order={order} onRetry={onPayAuto} onCompleted={onConfirmed} />;
  return <AutoPay summary={summary} busy={busy} onPay={onPayAuto} />;
}

function AutoPay({ summary, busy, onPay }) {
  const { t } = useLang();
  return (
    <section className="space-y-4" data-testid="checkout-step-pay-auto">
      <OrderSummary summary={summary} />
      <p className="flex items-center gap-2 rounded-[14px] bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground"><Zap className="h-4 w-4 shrink-0" />{t("checkout.autoVerifyNote")}</p>
      <Button type="button" onClick={onPay} disabled={busy} data-testid="checkout-pay-now" className="h-12 w-full rounded-full text-base font-bold">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.processing")}</> : `${t("checkout.payNow")} · ${formatAr(summary.subtotal + summary.fee)}`}
      </Button>
    </section>
  );
}

function ManualPay({ config, summary, reference, onPaid }) {
  const { t } = useLang();
  const provider = reference.provider || "mvola";
  const merchant = config?.providers?.[provider];
  const amount = summary.subtotal + summary.fee;
  const code = merchant ? USSD[provider](merchant.merchant, amount) : "";
  return (
    <section className="space-y-4" data-testid="checkout-step-pay-manual">
      <div className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6">
        <h2 className="font-display text-xl font-bold">{t("checkout.manualPayTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("checkout.manualHowto")}</p>
        <p className="mt-4 font-display text-3xl font-bold num" data-testid="manual-amount">{formatAr(amount)}</p>
        {merchant && (
          <a href={`tel:*${code.slice(1)}`} data-testid="ussd-button" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full font-semibold text-white transition-opacity hover:opacity-90" style={{ background: provider === "mvola" ? "var(--mvola)" : "var(--orange)" }}>
            <Smartphone className="h-4 w-4" />{t("checkout.ussd")}
          </a>
        )}
      </div>
      <Button type="button" onClick={onPaid} data-testid="manual-paid-button" className="h-12 w-full rounded-full text-base font-bold">{t("checkout.manualPaid")}</Button>
    </section>
  );
}
