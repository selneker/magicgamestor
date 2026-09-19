import { Copy } from "lucide-react";
import { toast } from "sonner";

export const CopyButton = ({ value, label, testId }) => {
  if (!value) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); toast.success(`${label} copié`); }
    catch (_) { toast.error("Copie impossible"); }
  };
  return <button type="button" onClick={copy} title={`Copier ${label} : ${value}`} aria-label={`Copier ${label}`} data-testid={testId}
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary">
    <Copy className="h-3.5 w-3.5" />
  </button>;
};
