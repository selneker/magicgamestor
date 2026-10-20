import { Check } from "lucide-react";
import { useLang } from "@/context/LanguageContext";

// One entry per checkout screen. The order must match the screens array in
// pages/Checkout.js: verification, payment method, payment, manual reference.
const STEPS = ["stepVerify", "stepMethod", "stepPay", "stepConfirm"];

export function CheckoutSteps({ step }) {
  const { t } = useLang();
  const active = Math.min(Math.max(step, 0), STEPS.length - 1);
  return (
    <ol className="mt-4 grid grid-cols-4 gap-2" data-testid="checkout-steps" aria-label={t("checkout.progressLabel")}>
      {STEPS.map((key, i) => {
        const complete = i < active;
        const current = i === active;
        return (
          <li key={key} data-testid={`checkout-stage-${i + 1}`} aria-current={current ? "step" : undefined}>
            {/* Not a button: the steps are not clickable, and a focusable control
                that does nothing is a keyboard trap. */}
            <div className="flex min-h-11 w-full flex-col items-center gap-1.5 text-center">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${complete || current ? "border-foreground bg-primary text-[#0A0A0A]" : "border-muted bg-muted text-muted-foreground"}`} aria-hidden="true">{complete ? <Check className="h-4 w-4" /> : i + 1}</span>
              <span className={`text-[11px] font-semibold leading-tight ${current ? "text-foreground" : "text-muted-foreground"}`}>{t(`checkout.${key}`)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
