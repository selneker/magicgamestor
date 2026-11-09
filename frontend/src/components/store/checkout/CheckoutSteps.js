import { Check } from "lucide-react";
import { useLang } from "@/context/LanguageContext";

// One entry per checkout screen. The order must match the screens array in
// pages/Checkout.js: verification, payment method, payment, manual reference.
const STEPS = ["stepVerify", "stepMethod", "stepPay", "stepConfirm"];

// PL-CHK-1 — stepper compact : 4 points reliés, sans libellés visibles
// (l'étape courante reste portée par le nom de chaque point dans l'arbre
// accessible, aria-label sur chaque point ; aucune autre indication d'étape
// n'est rendue au-dessus). Pas un bouton : les étapes ne sont pas cliquables,
// un contrôle focusable qui ne fait rien serait un piège clavier.
export function CheckoutSteps({ step }) {
  const { t } = useLang();
  const active = Math.min(Math.max(step, 0), STEPS.length - 1);
  return (
    <ol className="mt-3 flex items-center" data-testid="checkout-steps" aria-label={t("checkout.progressLabel")}>
      {STEPS.map((key, i) => {
        const complete = i < active;
        const current = i === active;
        return (
          <li key={key} data-testid={`checkout-stage-${i + 1}`} aria-current={current ? "step" : undefined} aria-label={t(`checkout.${key}`)} className="flex flex-1 items-center">
            <span
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-colors duration-150 motion-reduce:transition-none ${complete || current ? "border-primary bg-primary text-[#0A0A0A]" : "border-[color:var(--rule-strong)] bg-transparent text-muted-foreground"}`}
              aria-hidden="true"
            >
              {complete ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
            </span>
            {i < STEPS.length - 1 && <span className={`mx-1.5 h-px flex-1 ${complete ? "bg-primary" : "bg-[color:var(--rule-strong)]"}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
