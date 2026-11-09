import { Link, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";
import { useGames } from "@/context/GameContext";
import { useChat } from "@/context/ChatContext";
import { showsCartBar } from "@/lib/bottomChrome";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Fallback used when ResizeObserver is unavailable: a bit more than the bar's
// measured height (~62 px single-row since PL-UI-BOTTOM-1 dropped the fee hint)
// so the reserved space never lets the bar cover the footer's last row.
const BAR_FALLBACK_HEIGHT = 64;

export function CartDrawer() {
  const { items, open, setOpen, setQty, remove, total, count, gameId } = useCart();
  const { games, open: selectorOpen } = useGames();
  const { panelOpen } = useChat();
  const { pathname } = useLocation();
  const cartGame = games.find((g) => g.id === gameId);
  const { t, lang } = useLang();
  const navigate = useNavigate();

  // The mobile bar only exists where the bottom nav exists, never on a product
  // page (own buy bar) and never while an overlay is open.
  const barSlot = showsCartBar({ pathname, hasItems: items.length > 0, drawerOpen: open, panelOpen, selectorOpen });

  // When the on-screen keyboard opens, the layout viewport shrinks and a
  // bottom-anchored bar rises with it — on some browsers it would then cover the
  // field being typed into. Hide the bar while a text field has focus.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isTextField = (el) =>
      el instanceof HTMLElement &&
      ((el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(el.type)) ||
        el.tagName === "TEXTAREA" || el.isContentEditable);
    const onFocusIn = (e) => { if (isTextField(e.target)) setTyping(true); };
    const onFocusOut = (e) => { if (!e.relatedTarget) setTyping(false); };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const renderBar = barSlot && !typing;
  const prefersReduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The bar is fixed, so the page must reserve room for it. Its height depends on
  // how the fee hint wraps, so it is measured rather than guessed.
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    // ResizeObserver is missing on old Android WebViews (Chrome < 64). Without this
    // guard the constructor throws inside the layout effect: React unmounts the
    // tree and the ErrorBoundary replaces the whole shop with the error screen.
    if (typeof ResizeObserver === "undefined") {
      setBarHeight(BAR_FALLBACK_HEIGHT);
      return;
    }
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderBar]);
  useEffect(() => { if (!barSlot) setBarHeight(0); }, [barSlot]);

  // PL-UI-BOTTOM-1 — le bas de page est réservé par une variable CSS
  // consommée par Layout (pb main) : navigation + barre panier, jamais le
  // dernier élément caché. 7rem = base `pb-28` déjà posée par main ; au-delà
  // il manque seulement la barre (72 px + safe-area) - 40 px de marge interne.
  useEffect(() => {
    const root = document.documentElement;
    if (!barSlot || barHeight <= 0) return;
    root.style.setProperty("--bottom-chrome-reserve", `max(0px, calc(${barHeight}px - 2.5rem + env(safe-area-inset-bottom, 0px)))`);
    return () => root.style.removeProperty("--bottom-chrome-reserve");
  }, [barSlot, barHeight]);

  return (
    <>
      {/* env() avec un repli : sans lui, un navigateur qui ne connait pas
          env() invaliderait toute la declaration `bottom` et la barre fixe
          retomberait a sa position statique. */}
      {/* Carte flottante (PL-UI-BOTTOM-1) : jetons de surface (`bg-card`),
          coins 20 px, bordure 1 px discrète, aucun cadre coloré. Posée
          AU-DESSUS de la navigation : nav (52 px) + safe-area + 8 px. */}
      {renderBar && (
      <motion.div        ref={barRef}
        initial={prefersReduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReduced ? 0 : 0.2, ease: "easeOut" }}
        className="fixed inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom,0px))+4.5rem)] z-[45] flex items-center gap-3 rounded-[20px] border border-[color:var(--rule-strong)] bg-card p-2 text-[color:hsl(var(--card-foreground))] shadow-[0_18px_44px_hsl(0_0%_0%_/_.22)] backdrop-blur-md md:hidden"
        data-testid="mobile-cart-bar">
        <button type="button" className="min-h-11 min-w-0 flex-1 rounded-[14px] px-2 text-left" onClick={() => setOpen(true)}><span className="block text-xs font-medium">{count} {count === 1 ? t("cart.item") : t("cart.items")}</span><span className="num block text-lg font-bold">{formatAr(total)}</span></button>
        <button type="button" className="min-h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-bold text-[#0A0A0A]" onClick={() => { setOpen(false); navigate("/commande"); }}>{t("cart.checkout")}</button>
      </motion.div>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
      {/* 28 px sur les deux coins gauches (le tiroir est une feuille laterale
          droite : les coins droits sont contre l'ecran). `overflow-hidden` rogne
          le contenu par les coins ; le defilement interne reste sur la liste
          (`overflow-y-auto`), l'ombre et la croix ne sont pas coupees. */}
      <SheetContent aria-describedby={undefined} className="flex w-full flex-col overflow-hidden rounded-l-[28px] pb-safe sm:max-w-md" data-testid="cart-drawer">
        <SheetHeader><SheetTitle className="font-display text-xl">{t("cart.title")}</SheetTitle>{cartGame && <p className="eyebrow" data-testid="cart-game">{t("store.gameLabel")} · {cartGame.name}</p>}</SheetHeader>
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" data-testid="cart-empty">
            <p className="text-slate-500">{t("cart.empty")}</p>
            <Button asChild variant="outline" className="rounded-full" onClick={() => setOpen(false)}><Link to="/boutique">{t("cart.browse")}</Link></Button>
          </div>
        ) : (
          <>
            <ul className="flex-1 space-y-3 overflow-y-auto py-4">
              {items.map((i) => (
                <li key={i.id} data-testid={`cart-item-${i.slug}`} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-foreground bg-primary font-display text-xs font-black text-[#0A0A0A]">{(games.find((g) => g.id === (i.game_id || "pubg-mobile"))?.product_types || []).find((pt) => pt.key === i.type)?.label?.slice(0, 3) || i.type.slice(0, 3).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{lang === "en" && i.name_en ? i.name_en : i.name}</p>
                    <p className="text-sm text-slate-500">{formatAr(i.price)}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-slate-200 p-0.5">
                    <button aria-label={`${t("cart.qty")} -`} data-testid={`cart-dec-${i.slug}`} onClick={() => setQty(i.id, i.qty - 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-5 text-center text-sm font-bold">{i.qty}</span>
                    <button aria-label={`${t("cart.qty")} +`} data-testid={`cart-inc-${i.slug}`} onClick={() => setQty(i.id, Math.min(20, i.qty + 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <button data-testid={`cart-remove-${i.slug}`} onClick={() => remove(i.id)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-500" aria-label={t("cart.remove")}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="border-t pt-4">
              <div className="flex items-center justify-between text-lg"><span className="eyebrow">{t("cart.total")}</span><span data-testid="cart-total" className="num text-2xl">{formatAr(total)}</span></div>
              <p className="mt-2 text-xs text-muted-foreground">{t("cart.paymentFeeHint")}</p>
              <Button data-testid="cart-checkout-button" className="mt-4 h-12 w-full rounded-full text-base font-bold" onClick={() => { setOpen(false); navigate("/commande"); }}>{t("cart.checkout")}</Button>
            </div>
          </>
        )}
      </SheetContent>
      </Sheet>
    </>
  );
}
