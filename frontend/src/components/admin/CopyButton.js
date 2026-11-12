import { Copy } from "lucide-react";
import { toast } from "sonner";

// PL-UX-4 — variante `bare` : icône de copie SANS cadre (ligne de commande et
// ligne joueur de la carte admin). La zone tactile reste de 44 px (le
// pseudo-élément transparent étend la surface cliquable de 32 → 44 px).
export const CopyButton = ({ value, label, testId, bare = false }) => {
  if (!value) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); toast.success(`${label} copié`); }
    catch (_) { toast.error("Copie impossible"); }
  };
  return <button type="button" onClick={copy} title={`Copier ${label} : ${value}`} aria-label={`Copier ${label}`} data-testid={testId}
    className={bare
      ? "relative inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground before:absolute before:-inset-1.5 before:content-['']"
      : "inline-flex h-6 w-6 shrink-0 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-foreground hover:bg-primary hover:text-[#0A0A0A]"}>
    <Copy className="h-3.5 w-3.5" strokeWidth={2} />
  </button>;
};
