import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";

// PL-UX-4 — visionneuse de preuves PLEIN ÉCRAN.
// Les images ne sont téléchargées qu'à l'ouverture (GET authentifié par
// cookies vers /admin/orders/{id}/proofs/{index}, comme avant) : la LISTE des
// commandes n'affiche plus de miniature et ne charge plus d'image.
// Zoom : pinch à deux doigts, double-tap / double-clic, molette, boutons
// + / − / « Ajuster », déplacement quand l'image est zoomée.
// Navigation : 1 à 3 images, flèches clavier, glissement, pastilles n/3.
// Fermeture : ✕, Échap, touche retour du téléphone, clic en dehors.
// accessibilité : role=dialog + aria-modal, libellé français, piège de focus,
// focus rendu au bouton d'ouverture. Aucune dépendance ajoutée.

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_PX = 60;
const DOUBLE_TAP_MS = 320;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function ProofViewer({ order, startIndex = 0, onClose }) {
  const { t } = useLang();
  const proofs = order.payment_proofs || [];
  const count = proofs.length;
  const [index, setIndex] = useState(clamp(startIndex, 0, Math.max(count - 1, 0)));
  const [frames, setFrames] = useState({}); // i -> { url } | { error }
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(MIN_SCALE);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [reduced, setReduced] = useState(false);

  const dialogRef = useRef(null);
  const areaRef = useRef(null);
  const openerRef = useRef(null);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const viaPop = useRef(false);
  const gesture = useRef({ active: false, x: 0, y: 0, panX: 0, panY: 0, moved: 0, lastTap: 0 });
  const pinch = useRef(null);

  // Focus : rendu au bouton d'ouverture à la fermeture, pris au montage.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const node = dialogRef.current;
    if (node && typeof node.focus === "function") node.focus();
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, []);

  // Mouvement réduit : pas de transition d'ouverture.
  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const apply = () => setReduced(!!mq?.matches);
    apply();
    if (mq?.addEventListener) mq.addEventListener("change", apply);
    return () => { if (mq?.removeEventListener) mq.removeEventListener("change", apply); };
  }, []);

  // Touche retour du téléphone : un état d'historique est poussé à
  // l'ouverture ; le retour navigateur ferme la visionneuse.
  // PL-UX-4 — l'effet est monté UNE SEULE FOIS (`onClose` dans une ref) :
  // sinon chaque rendu du parent rejouait pushState/back, et le popstate
  // asynchrone arrivait sur le listener suivant → la visionneuse se fermait
  // d'elle-même au premier rafraîchissement de la liste.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    try { window.history.pushState({ mgsProofViewer: true }, ""); } catch (_) { /* historique indisponible */ }
    const onPop = () => { viaPop.current = true; onCloseRef.current(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!viaPop.current) { try { window.history.back(); } catch (_) { /* rien à annuler */ } }
    };
  }, []);

  // Libération des URL d'objet à la fermeture.
  useEffect(() => () => {
    Object.values(framesRef.current).forEach((f) => { if (f?.url) URL.revokeObjectURL(f.url); });
  }, []);

  // Chargement de l'image courante — SEULEMENT à l'ouverture de la visionneuse.
  useEffect(() => {
    const current = framesRef.current[index];
    if (current) return undefined;
    let stop = false;
    setLoading(true);
    api.get(`/admin/orders/${encodeURIComponent(order.id)}/proofs/${index}`, { responseType: "blob" })
      .then(({ data }) => {
        if (stop) return;
        const url = URL.createObjectURL(data);
        setFrames((f) => ({ ...f, [index]: { url } }));
        setLoading(false);
      })
      .catch((e) => {
        if (stop) return;
        setFrames((f) => ({ ...f, [index]: { error: e?.response?.status === 410 ? "gone" : "unavailable" } }));
        setLoading(false);
      });
    return () => { stop = true; };
  }, [order.id, index]);

  const frame = frames[index];

  const go = useCallback((delta) => {
    if (count < 2) return;
    setIndex((i) => (i + delta + count) % count);
    setScale(MIN_SCALE);
    setPan({ x: 0, y: 0 });
  }, [count]);

  const zoomBy = useCallback((factor) => {
    setScale((s) => clamp(s * factor, MIN_SCALE, MAX_SCALE));
  }, []);
  const fit = useCallback(() => { setScale(MIN_SCALE); setPan({ x: 0, y: 0 }); }, []);

  // Piège de focus (le focus ne sort jamais de la visionneuse).
  const trapFocus = (e) => {
    const node = dialogRef.current;
    if (!node) return;
    const items = node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // Clavier : Échap, flèches, +/−, Tab (piège de focus).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.25); }
      else if (e.key === "Tab") trapFocus(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, go, zoomBy]);

  // Molette (zoom) — écouteur non passif pour neutraliser le défilement.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Pinch à deux doigts (tactile) — écouteur non passif.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const dist = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onStart = (e) => {
      if (e.touches.length !== 2) return;
      pinch.current = { dist: dist(e.touches), scale };
      gesture.current.active = false;
    };
    const onMove = (e) => {
      if (e.touches.length !== 2 || !pinch.current) return;
      e.preventDefault();
      const next = clamp((pinch.current.scale * dist(e.touches)) / (pinch.current.dist || 1), MIN_SCALE, MAX_SCALE);
      setScale(next);
    };
    const onEnd = () => { pinch.current = null; };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scale]);

  // Déplacement (image zoomée) + glissement (image non zoomée) + double-tap.
  const onPointerDown = (e) => {
    gesture.current = { active: true, x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: 0, lastTap: gesture.current.lastTap };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g.active) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    g.moved = Math.max(g.moved, Math.abs(dx));
    if (scale > 1) setPan({ x: g.panX + dx, y: g.panY + dy });
  };
  const onPointerUp = (e) => {
    const g = gesture.current;
    if (!g.active) return;
    g.active = false;
    const dx = e.clientX - g.x;
    if (scale <= 1 && Math.abs(dx) > SWIPE_PX) { go(dx < 0 ? 1 : -1); return; }
    const now = Date.now();
    if (g.moved < 10 && now - g.lastTap < DOUBLE_TAP_MS) {
      setScale((s) => (s > 1 ? MIN_SCALE : DOUBLE_TAP_SCALE));
      setPan({ x: 0, y: 0 });
      g.lastTap = 0;
    } else {
      g.lastTap = now;
    }
  };

  const btn = "inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[color:hsl(var(--cream))] transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[color:hsl(var(--cream))]";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("admin.proofViewerTitle")}
      tabIndex={-1}
      data-testid="proof-viewer"
      className="fixed inset-0 z-[80] flex flex-col bg-ink text-[color:hsl(var(--cream))] outline-none"
    >
      <header className="flex flex-none items-center gap-2 px-2 py-2">
        <p className="text-sm font-semibold" data-testid="proof-viewer-counter">{index + 1} / {count}</p>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={t("admin.proofZoomOut")} title={t("admin.proofZoomOut")} data-testid="proof-zoom-out" className={btn}>
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => zoomBy(1.25)} aria-label={t("admin.proofZoomIn")} title={t("admin.proofZoomIn")} data-testid="proof-zoom-in" className={btn}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={fit} aria-label={t("admin.proofZoomFit")} title={t("admin.proofZoomFit")} data-testid="proof-zoom-fit" className="inline-flex h-11 items-center justify-center rounded-full bg-white/10 px-3 text-xs font-bold text-[color:hsl(var(--cream))] transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[color:hsl(var(--cream))]">
            {t("admin.proofZoomFit")}
          </button>
          <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} data-testid="proof-viewer-close" className={btn}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={areaRef}
        data-testid="proof-viewer-area"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {loading && <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-transparent" aria-hidden="true" />}
        {frame?.error && (
          <p role="alert" data-testid="proof-viewer-error" className="px-6 text-center text-sm font-semibold">
            {frame.error === "gone" ? t("admin.proofGone") : t("admin.proofUnavailableAdmin")}
          </p>
        )}
        {frame?.url && (
          <img
            src={frame.url}
            alt={t("admin.proofViewerImage", { n: index + 1 })}
            data-testid="proof-viewer-image"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transition: reduced ? "none" : "transform 120ms ease-out",
            }}
            className="max-h-full max-w-full select-none object-contain"
          />
        )}
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t("admin.proofPrevious")} data-testid="proof-viewer-prev" className={`absolute left-2 top-1/2 -translate-y-1/2 ${btn}`}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t("admin.proofNext")} data-testid="proof-viewer-next" className={`absolute right-2 top-1/2 -translate-y-1/2 ${btn}`}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex flex-none items-center justify-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2" data-testid="proof-viewer-dots">
          {proofs.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setIndex(i); setScale(MIN_SCALE); setPan({ x: 0, y: 0 }); }}
              aria-label={t("admin.proofGoTo", { n: i + 1 })}
              aria-current={i === index ? "true" : undefined}
              data-testid={`proof-viewer-dot-${i}`}
              className={`h-11 w-11 rounded-full focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[color:hsl(var(--cream))] ${i === index ? "bg-[color:hsl(var(--cream))]" : "bg-white/20"}`}
            >
              <span className={`mx-auto block h-2 w-2 rounded-full ${i === index ? "bg-ink" : "bg-white/70"}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
