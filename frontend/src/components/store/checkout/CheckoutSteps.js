import { useLang } from "@/context/LanguageContext";

const KEYS = ["stepVerify", "stepMethod", "stepPay", "stepConfirm"];

export function CheckoutSteps({ step }) {
  const { t } = useLang();
  return (
    <ol className="mt-4 grid grid-cols-4 gap-1.5" data-testid="checkout-steps">
      {KEYS.map((k, i) => (
        <li key={k} data-testid={`checkout-step-${i + 1}`} aria-current={i === step ? "step" : undefined}>
          <span className={`block h-1.5 rounded-full transition-colors duration-200 ${i <= step ? "bg-primary ring-1 ring-foreground" : "bg-muted"}`} />
          <span className={`mt-1.5 block truncate text-[11px] font-semibold ${i === step ? "text-foreground" : "text-muted-foreground"}`}>{t(`checkout.${k}`)}</span>
        </li>
      ))}
    </ol>
  );
}
