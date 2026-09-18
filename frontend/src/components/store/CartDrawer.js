import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";

export function CartDrawer() {
  const { items, open, setOpen, setQty, remove, total } = useCart();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent aria-describedby={undefined} className="flex w-full flex-col sm:max-w-md" data-testid="cart-drawer">
        <SheetHeader><SheetTitle className="font-display text-xl">{t("cart.title")}</SheetTitle></SheetHeader>
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
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-display text-xs font-bold ${i.type === "uc" ? "bg-amber-50 text-amber-600" : "bg-violet-50 text-violet-600"}`}>{i.type === "uc" ? "UC" : "P+"}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{lang === "en" && i.name_en ? i.name_en : i.name}</p>
                    <p className="text-sm text-slate-500">{formatAr(i.price)}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-slate-200 p-0.5">
                    <button data-testid={`cart-dec-${i.slug}`} onClick={() => setQty(i.id, i.qty - 1)} className="rounded-full p-1 hover:bg-slate-100"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-5 text-center text-sm font-bold">{i.qty}</span>
                    <button data-testid={`cart-inc-${i.slug}`} onClick={() => setQty(i.id, Math.min(20, i.qty + 1))} className="rounded-full p-1 hover:bg-slate-100"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <button data-testid={`cart-remove-${i.slug}`} onClick={() => remove(i.id)} className="text-slate-400 hover:text-red-500" aria-label={t("cart.remove")}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="border-t pt-4">
              <div className="flex items-center justify-between text-lg"><span className="font-semibold text-slate-600">{t("cart.total")}</span><span data-testid="cart-total" className="font-display text-2xl font-bold text-slate-900">{formatAr(total)}</span></div>
              <Button data-testid="cart-checkout-button" className="mt-4 h-12 w-full rounded-full text-base font-bold" onClick={() => { setOpen(false); navigate("/commande"); }}>{t("cart.checkout")}</Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
