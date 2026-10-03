import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

const CLS = "h-10 w-10 shrink-0 rounded-full border border-[color:var(--rule-strong)] bg-card";

// Shared back button (profile + checkout): link when `to` is given, action otherwise.
export function BackButton({ to, onClick, testId }) {
  const { t } = useLang();
  const icon = <ArrowLeft className="h-4 w-4" strokeWidth={2} />;
  if (to) {
    return (
      <Button asChild variant="ghost" size="icon" className={CLS} data-testid={testId}>
        <Link to={to} aria-label={t("common.back")}>{icon}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} className={CLS} data-testid={testId} aria-label={t("common.back")}>
      {icon}
    </Button>
  );
}
