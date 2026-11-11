import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

/* PL-CHK-5 — feuille partagée des trois feuilles du tunnel (preuve, annulation,
   vérification de sécurité). Cause du lot : les feuilles Radix `side="bottom"`
   n'avaient NI hauteur maximale NI zone défilable (ui/sheet.jsx:33-34) — sur
   un écran bas (620 px de bureau) le contenu passait sous le bord de la
   fenêtre et le pied (Confirmer / Garder ma commande) était coupé : le client
   ne pouvait ni envoyer sa preuve ni annuler.

   Structure imposée (maquette `apercu-corrections-paiement.html`, feuille v2) :
   - colonne flex : contenu DÉFILABLE (min-h-0, overflow-y-auto) + pied FIXE
     (flex-none, filet) hors de la zone défilable — jamais coupé ;
   - hauteur maximale calc(100dvh - 48px) — `dvh` (pas `vh`) pour les barres
     du navigateur mobile ; pied avec env(safe-area-inset-bottom) ;
   - bureau ≥1024 px : fenêtre centrée de 480 px, max-h 80 % de la fenêtre,
     pied avec « Fermer » + bouton principal toujours visibles ;
   - croix « ✕ » (zone 44 px, aria-label), poignée, focus piégé, Échap,
     aria-modal, fermeture par l'arrière-plan REFUSÉE pendant un envoi (busy).

   Cas keepMounted (feuille CAPTCHA) : le widget Turnstile doit rester monté et
   tourner invisiblement DANS la feuille fermée (interaction-only). Une feuille
   Radix MODALE forceMountée verrouille le body (pointer-events:none, via
   DismissableLayer) et masque toute la page (aria-hidden, via hideOthers) dès
   le montage — même fermée : la page serait inutilisable. Cette feuille est
   donc NON MODALE (`modal={false}`) : la coquille fournit elle-même l'overlay
   (arrière-plan cliquable, sauf busy) et le piège de focus (Tab en boucle).
   Les feuilles preuve / annulation restent Radix modales standards. */

// Piège de focus manuel (feuille non modale) : Tab / Maj+Tab restent dans la
// feuille — seuls les éléments réellement visibles (offsetParent non null)
// participent, le widget invisible est exclu.
const trapTab = (e) => {
  if (e.key !== "Tab") return;
  const els = [...e.currentTarget.querySelectorAll(
    'a[href], button:not([disabled]), input:not([type="hidden"]), textarea, select, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null);
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !e.currentTarget.contains(document.activeElement))) {
    e.preventDefault(); first.focus();
  }
};

export function CheckoutSheet({ open, onOpenChange, busy = false, keepMounted = false, title, children, footer, testId }) {
  const { t } = useLang();
  const closeBtnRef = React.useRef(null);
  // keepMounted (feuille CAPTCHA) : Radix démonterait sinon le widget à chaque
  // fermeture ; ici il reste monté, invisible (visibility:hidden n'arrête pas
  // l'exécution du widget).
  const hidden = keepMounted && !open;
  const guardClose = (v) => { if (!busy) onOpenChange(v); };

  // Focus initial DANS la feuille quand elle s'ouvre (feuille non modale :
  // Radix ne le fait pas) — la croix, premier élément focalisable stable.
  React.useEffect(() => {
    if (keepMounted && open) {
      const id = requestAnimationFrame(() => closeBtnRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(id);
    }
  }, [keepMounted, open]);

  const overlayCls = `fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none ${hidden ? "invisible" : ""}`;
  const contentCls = `fixed z-50 flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom motion-reduce:animate-none
    inset-x-0 bottom-0 max-h-[calc(100dvh-48px)] rounded-t-[24px] border-t border-[color:var(--rule)] bg-card
    lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-[480px] lg:max-h-[80vh] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[24px] data-[state=closed]:lg:slide-out-to-bottom
    ${hidden ? "invisible pointer-events-none" : ""}`;

  return (
    <Dialog.Root open={open} onOpenChange={guardClose} modal={!keepMounted}>
      <Dialog.Portal forceMount={keepMounted || undefined}>
        {keepMounted ? (
          // Overlay de la coquille (feuille non modale) : arrière-plan
          // cliquable = fermeture, refusée pendant un envoi.
          <div
            aria-hidden="true" onClick={() => guardClose(false)}
            className={overlayCls} data-testid={`${testId}-overlay`}
          />
        ) : (
          <Dialog.Overlay className={overlayCls} />
        )}
        <Dialog.Content
          forceMount={keepMounted || undefined}
          aria-describedby={undefined}
          aria-modal="true"
          aria-hidden={keepMounted ? !open : undefined}
          onKeyDown={keepMounted ? trapTab : undefined}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
          data-testid={testId}
          className={contentCls}
        >
          {/* Poignée (mobile uniquement, comme la maquette). */}
          <div className="mx-auto mb-1 mt-2 h-1 w-9 shrink-0 rounded-full bg-[color:var(--rule-strong)] lg:hidden" aria-hidden="true" />
          {/* Croix : zone tactile 44 px, aria-label FR/EN. */}
          <Dialog.Close
            ref={closeBtnRef}
            data-testid={`${testId}-close`}
            aria-label={t("common.close")}
            className="absolute right-1 top-1 z-10 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Dialog.Close>
          <Dialog.Title className="flex-none px-4 pt-1 pr-12 text-[18px] font-extrabold leading-snug" data-testid={`${testId}-title`}>{title}</Dialog.Title>
          {/* SEUL le contenu défile : min-h-0 est ce qui autorise le pied à rester peint. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2" data-testid={`${testId}-scroll`}>{children}</div>
          {/* Pied FIXE — jamais dans la zone défilable, jamais coupé. */}
          <div
            data-testid={`${testId}-footer`}
            className="flex-none border-t border-[color:var(--rule)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pb-4"
          >
            <div className="flex flex-col gap-2 lg:flex-row">
              {/* Bureau : « Fermer » en premier (maquette E). Mobile : masqué. */}
              <Dialog.Close asChild>
                <Button type="button" variant="outline" data-testid={`${testId}-desktop-close`}
                  className="hidden h-[46px] flex-1 rounded-full text-[14px] font-bold lg:flex">
                  {t("common.close")}
                </Button>
              </Dialog.Close>
              {footer}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
