import { Link, useNavigate, useLocation } from "react-router-dom";
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
// measured height (~101 px at 390 px) so the reserved space never lets the bar
// cover the footer's last row.
const BAR_FALLBACK_HEIGHT = 112;

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

  return (
    <>
      {/* Spacer so the bar never covers the footer's last row. It stays in place
          while the bar is hidden for the keyboard, so nothing shifts. 2.5rem = the
          footer's own pb-28 (7rem) minus the bar's 4.5rem bottom offset. */}
      {barSlot && (
        <div
          className="md:hidden"
          aria-hidden="true"
          data-testid="cart-bar-spacer"
          style={{ height: `max(0px, calc(${barHeight}px + max(0.75rem, env(safe-area-inset-bottom, 0px)) - 2.5rem))` }}
        />
      )}
      {/* env() avec un repli : sans lui, un navigateur qui ne connait pas
          env() invaliderait toute la declaration `bottom` et la barre fixe
          retomberait a sa position statique. */}
      {/* Surface d'encre FIXE (noire dans les deux themes) : le total est en
          neon dessus, et le cadre creme a 55 % garde la barre separee du fond
          sombre (>= 3:1) au lieu de se fondre dedans. */}
      {renderBar && <div ref={barRef} className="fixed inset-x-3 bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom,0px))+0.5rem)] z-[45] flex items-center gap-3 border-2 border-[color:hsl(var(--cream)/.55)] bg-ink p-2 text-[color:hsl(var(--cream))] shadow-[4px_4px_0_hsl(var(--primary))] md:hidden" data-testid="mobile-cart-bar">
        <button type="button" className="min-h-11 min-w-0 flex-1 px-2 text-left" onClick={() => setOpen(true)}><span className="block text-sm font-semibold">{count} {count === 1 ? t("cart.item") : t("cart.items")}</span><span className="num block text-lg text-neo-on-ink">{formatAr(total)}</span><span className="block text-xs leading-snug">{t("cart.paymentFeeHint")}</span></button>
        <button type="button" className="min-h-11 shrink-0 bg-primary px-4 text-sm font-bold text-[#0A0A0A]" onClick={() => { setOpen(false); navigate("/commande"); }}>{t("cart.checkout")}</button>
      </div>}
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
