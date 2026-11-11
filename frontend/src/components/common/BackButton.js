import { Link } from "react-router-dom";
import { useLang } from "@/context/LanguageContext";

// PL-CHK-5 — flèche de retour style iOS « ‹ » (maquettes corrections + Binance) :
// chevron fin (trait arrondi 2,4, ~12 × 20 px), SANS cercle ni fond, aligné à
// gauche avec un retrait négatif pour l'alignement optique, zone tactile
// 44 × 44 px, aria-label FR/EN. Un seul composant partagé par tout le tunnel,
// /orders/:id et les pages connexion / inscription / mot de passe oublié —
// l'ancien bouton rond (h-10 w-10 rounded-full border bg-card) est retiré.
const CLS = "-ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-foreground transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";

export function BackButton({ to, onClick, testId }) {
  const { t } = useLang();
  const icon = (
    <svg viewBox="0 0 12 20" fill="none" aria-hidden="true" className="h-5 w-3">
      <path d="M10 2L2 10l8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const common = { className: CLS, "data-testid": testId, "aria-label": t("common.back") };
  if (to) {
    return <Link to={to} {...common}>{icon}</Link>;
  }
  return <button type="button" onClick={onClick} {...common}>{icon}</button>;
}
