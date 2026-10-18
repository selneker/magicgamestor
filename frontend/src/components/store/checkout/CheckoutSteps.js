import { Check } from "lucide-react";
import { useLang } from "@/context/LanguageContext";

const STAGES = ["account", "payment", "delivery"];
const stageForStep = (step) => step === 0 ? 0 : step < 3 ? 1 : 2;

export function CheckoutSteps({ step }) {
  const { t } = useLang();
  const active = stageForStep(step);
  return (
    <ol className="mt-4 grid grid-cols-3 gap-2" data-testid="checkout-steps" aria-label={t("checkout.progressLabel")}>
      {STAGES.map((key, i) => {
        const complete = i < active;
        const current = i === active;
        return <li key={key} data-testid={`checkout-stage-${i + 1}`} aria-current={current ? "step" : undefined}>
          <button type="button" disabled={!complete} className="flex min-h-11 w-full items-center gap-2 text-left disabled:cursor-default">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${complete || current ? "border-foreground bg-primary text-[#0A0A0A]" : "border-muted bg-muted text-muted-foreground"}`}>{complete ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}</span>
            <span className={`truncate text-xs font-semibold ${current ? "text-foreground" : "text-muted-foreground"}`}>{t(`checkout.stage${key[0].toUpperCase()}${key.slice(1)}`)}</span>
          </button>
        </li>;
      })}
    </ol>
  );
}
