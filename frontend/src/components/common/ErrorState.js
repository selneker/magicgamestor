import { cn } from "@/lib/utils";

/* ── PL-DS-003 — état d'erreur socle ───────────────────────────────────
   Icône (optionnelle), titre, description et bouton « réessayer » optionnel.
   Tout le texte est traduit par l'appelant (t()) et passé par props.
   Cible tactile >= 44 px sur le bouton. */

export function ErrorState({ icon, title, description, retryLabel, onRetry, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 text-center p-8", className)}>
      {icon && <div className="text-destructive">{icon}</div>}
      {title && <h3 className="font-display font-semibold text-foreground">{title}</h3>}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {retryLabel && onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[44px] inline-flex items-center justify-center rounded-[10px] border border-[color:var(--border)] bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted">
          {retryLabel}
        </button>
      )}
    </div>
  );
}
ErrorState.displayName = "ErrorState";
