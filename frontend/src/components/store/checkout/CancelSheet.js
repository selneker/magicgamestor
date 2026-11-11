import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { clearPendingOrderId } from "@/lib/pendingOrder";
import { useLang } from "@/context/LanguageContext";
import { CheckoutSheet } from "@/components/store/checkout/CheckoutSheet";
import { Button } from "@/components/ui/button";

// PL-CHK-4 — écran 7 « Pourquoi annulez-vous ? » (feuille du bas, sondage).
// Cinq raisons (radio) → POST /api/orders/{id}/cancel { reason } (contrat
// PL-ORDER-CLIENT-1 : 200 {ok, status:"cancelled"} ; 409 cancel_not_allowed /
// cancel_conflict ; 422 ; 403/404 ; 429). Le bouton PRIMAIRE est « Garder ma
// commande » (ferme la feuille) pour éviter les annulations par erreur ; le
// lien « Annuler la commande » n'est actif qu'UNE raison choisie. Succès : la
// mémorisation de reprise PL-CHK-3 est effacée, message de confirmation,
// retour à l'accueil (le parent navigationne). 409 : message clair + l'état
// réel de la commande est rechargé (onConflict).

const REASONS = [
  { key: "wrong_info", labelKey: "checkout.cancelWrongInfo" },
  { key: "change_method", labelKey: "checkout.cancelChangeMethod" },
  { key: "too_short", labelKey: "checkout.cancelTooShort" },
  { key: "cannot_pay_now", labelKey: "checkout.cancelCannotPayNow" },
  { key: "other", labelKey: "checkout.cancelOther" },
];

const detailCode = (e) => {
  const d = e?.response?.data?.detail;
  return typeof d === "object" ? d?.code : null;
};

export function CancelSheet({ open, onOpenChange, order, onCancelled, onConflict }) {
  const { t } = useLang();
  const [reason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Chaque ouverture repart d'une feuille vierge (pas de raison résiduelle).
  useEffect(() => { if (open) { setReason(null); setError(""); } }, [open]);

  const cancel = async () => {
    if (!reason || busy || !order) return;
    setBusy(true); setError("");
    try {
      await api.post(`/orders/${order.id}/cancel`, { reason });
      // Commande annulée : plus rien à reprendre (mémorisation PL-CHK-3).
      clearPendingOrderId();
      toast.success(t("checkout.cancelDone"));
      onOpenChange(false);
      onCancelled?.();
    } catch (e) {
      const status = e?.response?.status;
      const code = detailCode(e);
      if (status === 409) {
        // preuve envoyée / payée / expirée (cancel_not_allowed) ou conflit
        // d'état (cancel_conflict) : message clair + état réel rechargé.
        setError(code === "cancel_conflict" ? t("checkout.cancelConflict") : t("checkout.cancelNotAllowed"));
        onConflict?.();
      } else {
        setError(errorMessage(e, t("common.error")));
      }
    } finally { setBusy(false); }
  };

  return (
    // PL-CHK-5 — coquille partagée (CheckoutSheet) : contenu défilable + pied
    // FIXE. Radix : focus piégé, Échap, aria-modal ; fermeture REFUSÉE pendant
    // l'appel (busy).
    <CheckoutSheet
      open={open} onOpenChange={onOpenChange} busy={busy}
      title={t("checkout.cancelTitle")} testId="cancel-sheet"
      footer={
        <>
          {/* Bouton principal : GARDER la commande (anti-annulation par erreur). */}
          <Button type="button" onClick={() => onOpenChange(false)} disabled={busy} data-testid="cancel-keep"
            className="h-[52px] flex-1 rounded-full text-[15px] font-extrabold lg:h-[46px]">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.cancelOrder")}</> : t("checkout.keepOrder")}
          </Button>
          {/* Contour, grisé tant qu'aucune raison n'est choisie (maquette D). */}
          <Button type="button" onClick={cancel} disabled={!reason || busy} variant="outline" data-testid="cancel-confirm"
            className="h-[50px] w-full rounded-full text-[14px] font-bold lg:h-[46px]">
            {t("checkout.cancelOrder")}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t("checkout.cancelTitle")} className="pb-2" data-testid="cancel-reasons">
        {REASONS.map((r) => (
          <button
            key={r.key} type="button" role="radio" aria-checked={reason === r.key}
            onClick={() => setReason(r.key)} data-testid={`cancel-reason-${r.key}`}
            className={`flex min-h-[44px] w-full items-center gap-3 border-b border-[color:var(--rule)] text-left text-sm transition-colors motion-reduce:transition-none last:border-b-0 ${reason === r.key ? "font-bold text-foreground" : "text-muted-foreground"}`}
          >
            <span className={`h-5 w-5 shrink-0 rounded-full border-2 ${reason === r.key ? "border-[color:var(--brand-lime)] bg-[radial-gradient(var(--brand-lime)_45%,transparent_50%)]" : "border-[color:var(--rule-strong)]"}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">{t(r.labelKey)}</span>
          </button>
        ))}
      </div>

      <p role="alert" className={`pb-2 text-sm font-semibold ${error ? "" : "sr-only"}`} data-testid="cancel-error" aria-live="assertive">{error || "\u00a0"}</p>
    </CheckoutSheet>
  );
}
