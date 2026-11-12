import { useState } from "react";
import { Image } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { ProofViewer } from "@/components/admin/ProofViewer";

// PL-CHK-2 — section « Preuves » du détail de commande admin.
// PL-UX-4 — la liste n'affiche PLUS de miniature et ne charge PLUS d'image :
// un seul bouton « Preuves (n) » (visible seulement s'il y a au moins une
// preuve). Les images ne sont téléchargées qu'à l'ouverture de la visionneuse
// plein écran (GET authentifié par cookies, comme avant) ; une preuve purgée
// (410) affiche un message explicite.

export function OrderProofs({ order, className = "" }) {
  const { t } = useLang();
  const proofs = order.payment_proofs || [];
  const [open, setOpen] = useState(false);

  if (proofs.length === 0) return null;

  return (
    <span data-testid="admin-proofs" className="contents">
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`admin-proofs-button-${order.order_number}`}
        aria-label={t("admin.proofsButtonAria", { n: proofs.length })}
        // PL-UX-5 — rayon 8 px (jamais de pilule) ; la hauteur et la largeur
        // (flexible sur mobile, fixe sur bureau) viennent de className.
        className={`inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-[color:var(--rule-strong)] px-4 text-xs font-bold text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground ${className}`}
      >
        <Image className="h-4 w-4" aria-hidden="true" />
        {t("admin.proofsButton", { n: proofs.length })}
      </button>
      {open && <ProofViewer order={order} onClose={() => setOpen(false)} />}
    </span>
  );
}
