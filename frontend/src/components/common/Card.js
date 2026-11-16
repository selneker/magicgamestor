import { cn } from "@/lib/utils";

/* ── PL-DS-003 — carte socle du design system ──────────────────────────
   Carte partagée par toutes les pages. Surface et bordure issues des jetons
   (--card, --border, --shadow-brut), jamais de hex en dur.
   Sous-composants : CardHeader, CardTitle, CardDescription, CardContent,
   CardFooter — calqués sur les primitives shadcn mais avec les jetons DS. */

const Card = ({ className, ...props }) => (
  <div
    className={cn("rounded-xl border border-[color:var(--border)] bg-card text-card-foreground shadow-[var(--shadow-brut)]", className)}
    {...props}
  />
);
Card.displayName = "Card";

const CardHeader = ({ className, ...props }) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
);
CardHeader.displayName = "CardHeader";

const CardTitle = ({ className, ...props }) => (
  <div className={cn("font-display font-semibold leading-none tracking-tight text-foreground", className)} {...props} />
);
CardTitle.displayName = "CardTitle";

const CardDescription = ({ className, ...props }) => (
  <div className={cn("text-sm text-muted-foreground", className)} {...props} />
);
CardDescription.displayName = "CardDescription";

const CardContent = ({ className, ...props }) => (
  <div className={cn("p-6 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

const CardFooter = ({ className, ...props }) => (
  <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
