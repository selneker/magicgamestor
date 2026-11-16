import { cn } from "@/lib/utils";

/* ── PL-DS-003 — skeleton de chargement socle ──────────────────────────
   Bloc pulsant sur une surface atténuée. Hauteur/largeur réglables via
   className. Couleur issue des jetons (--muted). */

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted min-h-[44px] w-full", className)}
      {...props}
    />
  );
}
Skeleton.displayName = "Skeleton";
