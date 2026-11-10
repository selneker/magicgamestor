import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { clearPendingOrderId } from "@/lib/pendingOrder";
import { useLang } from "@/context/LanguageContext";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
    // Feuille du bas accessible (Radix : focus piégé, Échap, aria-modal) ;
    // fermeture REFUSÉE pendant l'appel.
    <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        className="gap-0 rounded-t-[24px] border-t border-[color:var(--rule)] bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 [&>button]:hidden lg:inset-x-auto lg:left-1/2 lg:top-1/2 lg:w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[24px]"
        data-testid="cancel-sheet"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[color:var(--rule-strong)]" aria-hidden="true" />
        <SheetTitle className="text-[18px] font-extrabold" data-testid="cancel-sheet-title">{t("checkout.cancelTitle")}</SheetTitle>

        <div role="radiogroup" aria-label={t("checkout.cancelTitle")} className="mt-2" data-testid="cancel-reasons">
          {REASONS.map((r, i) => (
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

        <p role="alert" className={`mt-2 text-sm font-semibold ${error ? "" : "sr-only"}`} data-testid="cancel-error" aria-live="assertive">{error || "\u00a0"}</p>

        {/* Bouton principal : GARDER la commande (anti-annulation par erreur). */}
        <Button type="button" onClick={() => onOpenChange(false)} disabled={busy} data-testid="cancel-keep"
          className="mt-3 h-[52px] w-full rounded-full text-[15px] font-extrabold">
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.cancelOrder")}</> : t("checkout.keepOrder")}
        </Button>
        {/* Lien discret, actif seulement quand une raison est choisie. */}
        <button type="button" onClick={cancel} disabled={!reason || busy} data-testid="cancel-confirm"
          className={`mx-auto mt-3 block min-h-[44px] text-[13px] underline underline-offset-[3px] ${reason && !busy ? "text-muted-foreground" : "pointer-events-none opacity-40 text-muted-foreground"}`}>
          {t("checkout.cancelOrder")}
        </button>
      </SheetContent>
    </Sheet>
  );
}
