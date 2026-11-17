import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* ── PL-DS-003 — bouton socle du design system ─────────────────────────
   Bouton partagé par toutes les pages. Pose les règles du design system :
   - cible tactile >= 44 px (min-h-[44px]), requise sur mobile (390 px) ;
   - couleurs issues des jetons CSS (jamais de hex en dur) ;
   - variante `link` sans remplissage ni cible tactile forcée (lien texte).
   Le contenu (texte déjà traduit via t() par l'appelant) passe par children. */

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[10px] text-xs font-semibold tracking-[0.04em] transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border border-[color:var(--rule-strong)] bg-primary text-primary-foreground shadow-[var(--shadow-brut)] hover:bg-foreground hover:text-background hover:shadow-[4px_4px_0_hsl(var(--foreground)/.2)] min-h-[44px]",
        secondary:
          "border border-[color:var(--rule)] bg-foreground text-background hover:bg-primary hover:text-primary-foreground min-h-[44px]",
        outline:
          "border border-[color:var(--rule-strong)] bg-transparent text-foreground hover:bg-primary hover:text-primary-foreground min-h-[44px]",
        ghost: "hover:bg-primary hover:text-primary-foreground min-h-[44px]",
        destructive:
          "border border-[color:var(--rule)] bg-destructive text-destructive-foreground hover:opacity-90 min-h-[44px]",
        link: "text-foreground underline-offset-4 hover:underline p-0 min-h-auto",
      },
      size: {
        default: "px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={asChild ? undefined : "button"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
Button.displayName = "Button";
