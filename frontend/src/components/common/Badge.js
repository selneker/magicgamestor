import { cn } from "@/lib/utils";

/* ── PL-DS-003 — badge socle du design system ──────────────────────────
   Badge partagé par toutes les pages. Variantes issues des jetons, jamais
   de hex en dur. Le texte est traduit par l'appelant (t()) et passé par
   children. */

const badgeVariants = {
  default: "rounded-md border border-transparent bg-primary text-primary-foreground px-2.5 py-0.5 text-xs font-semibold",
  secondary:
    "rounded-md border border-transparent bg-secondary text-secondary-foreground px-2.5 py-0.5 text-xs font-semibold",
  outline: "rounded-md border border-[color:var(--border)] text-foreground px-2.5 py-0.5 text-xs font-semibold",
  destructive:
    "rounded-md border border-transparent bg-destructive text-destructive-foreground px-2.5 py-0.5 text-xs font-semibold",
};

export function Badge({ className, variant = "default", ...props }) {
  return (
    <div className={cn(badgeVariants[variant], "inline-flex items-center", className)} {...props} />
  );
}
Badge.displayName = "Badge";
