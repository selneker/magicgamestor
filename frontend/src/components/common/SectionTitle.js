import { cn } from "@/lib/utils";

/* ── PL-DS-003 — titre de section socle ────────────────────────────────
   Sourcil (eyebrow) en police de corps + titre en police d'affichage.
   Texte traduit par l'appelant (t()) et passé par props. */

export function SectionTitle({ eyebrow, title, className, eyebrowClassName, titleClassName }) {
  return (
    <div className={cn("flex flex-col space-y-1", className)}>
      {eyebrow && (
        <p className={cn("text-[11px] font-medium tracking-[0.08em] text-muted-foreground", eyebrowClassName)}>
          {eyebrow}
        </p>
      )}
      <h2 className={cn("font-display font-semibold text-foreground tracking-[-0.02em]", titleClassName)}>
        {title}
      </h2>
    </div>
  );
}
SectionTitle.displayName = "SectionTitle";
