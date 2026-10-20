import { Copy, Loader2, Smartphone, Zap } from "lucide-react";
import { toast } from "sonner";
import { formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { PaymentStatus } from "@/components/store/PaymentStatus";
import { USSD, pretty } from "@/components/store/PaymentFlow";
import { OrderSummary } from "@/components/store/checkout/StepConfirm";
import { BinancePay } from "@/components/store/checkout/BinancePay";

// navigator.clipboard needs a secure context (http:// is not one) and the
// browser can refuse it. Fall back to a selection copy, and only report a
// failure when that fails too.
async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch (_) {
    return false;
  }
}

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
      <OrderSummary summary={summary} sticky />
      <p className="flex items-center gap-2 rounded-[14px] bg-muted px-3 py-2 text-sm font-semibold text-foreground"><Zap className="h-4 w-4 shrink-0" />{t("checkout.autoVerifyNote")}</p>
      <p className="text-sm text-muted-foreground">{t("checkout.playerVerifyNote")}</p>
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
  const steps = t("checkout.ussdSteps");

  // The toast container is an aria-live="polite" region, so the confirmation is
  // announced to screen readers.
  const copyCode = async () => {
    const copied = await copyToClipboard(code);
    if (copied) toast.success(t("checkout.copied"));
    else toast.error(t("common.error"));
  };

  return (
    <section className="space-y-4" data-testid="checkout-step-pay-manual">
      <OrderSummary summary={summary} sticky />
      <div className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6">
        <h2 className="font-display text-xl font-bold">{t("checkout.manualPayTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("checkout.manualHowto")}</p>

        <p className="eyebrow mt-5">{t("checkout.ussdAmount")}</p>
        <p className="mt-1 font-display text-3xl font-bold num" data-testid="manual-amount">{formatAr(amount)}</p>

        {merchant && (
          <div className="mt-5 rounded-[16px] border-2 border-[color:var(--rule)] bg-muted/40 p-4">
            <p className="eyebrow">{t("checkout.ussdTitle")}</p>

            <p className="mt-3 text-sm font-semibold">{t("checkout.ussdCode")}</p>
            <p className="mt-1 select-all break-all font-mono text-sm font-bold leading-relaxed" data-testid="ussd-code">{code}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={copyCode} data-testid="copy-ussd-code"
                aria-label={`${t("checkout.copy")} ${t("checkout.ussdCode")}`}
                className="h-11 rounded-full px-4 text-sm font-bold">
                <Copy className="h-4 w-4" aria-hidden="true" />{t("checkout.copy")}
              </Button>
              <a href={`tel:*${code.slice(1)}`} data-testid="ussd-button" className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full font-semibold text-white transition-opacity hover:opacity-90" style={{ background: provider === "mvola" ? "var(--mvola)" : "var(--orange)" }}>
                <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />{t("checkout.ussd")}
              </a>
            </div>

            <p className="mt-4 text-sm font-semibold">{t("checkout.ussdNumber")}</p>
            <p className="mt-1 num text-base font-bold" data-testid="merchant-number">{pretty(merchant.merchant)}</p>
          </div>
        )}

        {Array.isArray(steps) && (
          <ol className="mt-5 space-y-2 text-sm text-muted-foreground" data-testid="ussd-steps">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="num shrink-0 font-bold text-foreground">{i + 1}.</span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-sm text-muted-foreground">{t("checkout.ussdNote")}</p>
      </div>
      <Button type="button" onClick={onPaid} data-testid="manual-paid-button" className="h-12 w-full rounded-full text-base font-bold">{t("checkout.ussdNext")}</Button>
    </section>
  );
}
