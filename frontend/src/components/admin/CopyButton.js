import { Copy } from "lucide-react";
import { toast } from "sonner";

// PL-UX-4 — variante `bare` : icône de copie SANS cadre (ligne de commande et
// ligne joueur de la carte admin). La zone tactile reste de 44 px (le
// pseudo-élément transparent étend la surface cliquable de 32 → 44 px).
// PL-UX-5 — variante `small` (maquette carte admin v2) : petit carré bordé
// d'origine 20 px, rayon 3 px, icône 12 px ; zone tactile 44 px (pseudo-
// élément transparent, 20 → 44 px). Les variantes par défaut et `bare`
// restent inchangées (PaymentFlow et le reste du site ne bougent pas).
export const CopyButton = ({ value, label, testId, bare = false, small = false }) => {
  if (!value) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); toast.success(`${label} copié`); }
    catch (_) { toast.error("Copie impossible"); }
  };
  return <button type="button" onClick={copy} title={`Copier ${label} : ${value}`} aria-label={`Copier ${label}`} data-testid={testId}
    className={bare
      ? "relative inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground before:absolute before:-inset-1.5 before:content-['']"
      : small
        ? "relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-foreground/30 text-muted-foreground transition-colors hover:border-foreground hover:bg-primary hover:text-[#0A0A0A] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground before:absolute before:-inset-3 before:content-['']"
        : "inline-flex h-6 w-6 shrink-0 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-foreground hover:bg-primary hover:text-[#0A0A0A]"}>
    <Copy className={small ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={2} />
  </button>;
};
