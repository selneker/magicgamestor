import { cn } from "@/lib/utils";

/* ── PL-DS-003 — champ de formulaire socle ─────────────────────────────
   Label + input + message d'erreur. Le label est traduit par l'appelant
   (t()). Les couleurs viennent des jetons (--input, --border, --foreground,
   --destructive). Cible tactile >= 44 px sur l'input. */

export function Field({ label, error, children, className, inputClassName, ...props }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label className="text-xs font-medium text-foreground" {...props}>
          {label}
        </label>
      )}
      <input
        className={cn(
          "flex h-11 w-full rounded-md border border-[color:var(--border)] bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]",
          inputClassName
        )}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
Field.displayName = "Field";
