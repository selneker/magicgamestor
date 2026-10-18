import { Link } from "react-router-dom";
import { useCart } from "@/context/CartContext";
import { useFavorites } from "@/lib/favorites";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";
import { addFeedback } from "@/context/CartContext";
import { toast } from "sonner";

const ICONS = {
  plus: <path d="M12 5v14M5 12h14" strokeWidth="3.2" strokeLinecap="round" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />,
  cart: <><path d="M3 4h2.5l2 11h10l2-8H7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="17" cy="19.5" r="1.4" fill="currentColor" stroke="none" /></>,
  flame: <path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 1.8 1.8 2C10.5 8.5 11 5.5 12 3z" fill="currentColor" stroke="none" />,
  bolt: <path d="M13 2 5 13h6l-1 9 8-11h-6l1-9z" fill="currentColor" stroke="none" />,
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="currentColor" stroke="none" />,
  minus: <path d="M5 12h14" strokeWidth="3.2" strokeLinecap="round" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  heart: <path d="M12 20.5s-8-4.7-8-10.2A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 8 2.5c0 5.5-8 10.2-8 10.2z" strokeWidth="2.4" strokeLinejoin="round" />,
};

function Icon({ name, className = "h-5 w-5" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true">{ICONS[name]}</svg>;
}

export const productName = (product, lang) => (lang === "en" && product.name_en ? product.name_en : product.name);

export function ProductCard({ product, index = 0, badge }) {
  const { t, lang } = useLang();
  const { items, add, setQty, remove, open, setOpen } = useCart();
  const [favorites, toggleFavorite] = useFavorites();
  const productInCart = items.find((item) => item.id === product.id);
  const qty = productInCart ? productInCart.qty : 0;
  const showCart = qty > 0;
  const available = product.purchasable !== false;
  const max = product.type === "uc" ? 20 : 1;
  const oldPrice = Number(product.old_price);
  const price = Number(product.price);
  const discount = oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : 0;
  const showDiscount = discount >= 5;
  const figure = product.type === "uc" ? product.uc_amount : product.duration_months;
  const unit = product.type === "uc" ? "UC" : product.duration_months ? "mois" : "";
  const context = badge || (product.popular ? "popular" : product.type === "evo" ? "evo" : "offer");
  const contextIcon = context === "popular" ? "flame" : context === "evo" ? "crown" : product.type === "prime" || product.type === "prime_plus" ? "bolt" : "cart";
  const contextLabel = context === "popular" ? "Populaire" : context === "evo" ? "Elite Pack" : product.type === "prime_plus" ? "Abonnement" : product.type === "prime" ? "Abonnement" : "Pack UC";
  const focus = "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink";
  const actionIconName = product.type === "uc" ? "plus" : product.type === "evo" ? "cart" : "arrow";

  const handleAdd = () => {
    const addResult = add(product);
    addFeedback(addResult, t, toast, setOpen);
  };

  const handleIncrease = () => {
    if (qty < max) {
      setQty(product.id, qty + 1);
    }
  };

  const handleDecrease = () => {
    if (qty > 0) {
      setQty(product.id, qty - 1);
    }
  };

  const handleToggleFavorite = () => {
    toggleFavorite(product.id);
  };

  return (
    <article data-testid={`product-card-${product.slug}`} className={`group relative flex min-h-[224px] flex-col rounded-[24px] border-2 border-ink bg-neo p-3 shadow-none transition duration-200 ease-out hover:shadow-[5px_5px_0_#111111] hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${available ? "" : "grayscale"}`}>
      <Link to={`/produit/${product.slug}`} className="absolute inset-0 z-0 rounded-[1.35rem]" aria-label={product.name || product.slug || "Produit"} />
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-ink bg-white/40 px-2 py-0.5 font-body text-[8px] font-bold uppercase leading-none tracking-wider backdrop-blur">{typeLabel(product)}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/10 px-3 py-1 font-body text-[10px] font-bold uppercase leading-none tracking-wider backdrop-blur"><Icon name={contextIcon} className="h-3 w-3" />{contextLabel}</span>
          </div>
          <button type="button" aria-label={`${favorites.includes(product.id) ? t("product.removeFavorite") : t("product.addFavorite")} : ${product.name || product.slug}`} aria-pressed={favorites.includes(product.id)} onClick={handleToggleFavorite} className={`grid aspect-square h-8 w-8 shrink-0 place-items-center !rounded-full border border-ink bg-ink text-white transition duration-150 hover:scale-105 hover:bg-red-500 active:scale-95 aria-[pressed=true]:bg-red-500 aria-[pressed=true]:[&_svg]:fill-white ${focus}`}><Icon name="heart" /></button>
        </div>

        <h2 className="mt-2 line-clamp-2 min-h-[2rem] font-display text-sm font-extrabold leading-tight sm:text-base">{product.name || product.slug}</h2>
        {figure ? (
          <p className={"mt-2 flex items-baseline gap-2 font-display font-extrabold tracking-tighter " + (figureLength >= 5 ? "text-3xl sm:text-4xl" : figureLength >= 4 ? "text-4xl sm:text-5xl" : "text-5xl sm:text-6xl")}>
            <span className="leading-none">{figure}</span>
            <span className="text-xl font-bold uppercase tracking-tight text-ink/70">{unit}</span>
          </p>
        ) : null}

        <div className="mt-auto relative h-11">
          {!available ? (
            <span className="flex items-center justify-between gap-1.5 w-full px-3 font-body text-sm font-bold uppercase tracking-wide">Indisponible</span>
          ) : (
            <>
              {/* Price view */}
              <div className={`absolute inset-0 flex items-center justify-between gap-1.5 px-3 transition-all duration-200 ease-out ${showCart ? "opacity-0 pointer-events-none -translate-y-6" : "opacity-100 pointer-events-auto translate-y-0"} `}>
                <div className="text-[color:var(--neo-text)]/70">
                  <p className="num text-[1.75rem] font-bold leading-none">{formatAr(product.price)}</p>
                  {showDiscount && (
                    <span className="mt-1.5 flex min-h-4 items-center gap-1.5 leading-none">
                      <span className="text-[11px] text-[color:var(--neo-text)]/50 line-through">{formatAr(product.old_price)}</span>
                      <span className="rounded-full bg-[color:var(--neo-card-bg)] px-2 py-1 text-[11px] font-semibold leading-none text-[color:var(--neo-text)]">
                        -{discount}%
                      </span>
                    </span>
                  )}
                </div>
                <button type="button" onClick={handleAdd} className={`grid aspect-square h-9 w-9 shrink-0 place-items-center !rounded-full border-2 border-ink bg-ink text-neo transition duration-150 hover:scale-105 active:scale-95 ${focus}`}>
                  <Icon name={actionIconName} />
                </button>
              </div>

              {/* Cart view */}
              <div className={`absolute inset-0 flex items-center justify-between gap-1.5 px-3 transition-all duration-200 ease-out ${showCart ? "opacity-100 pointer-events-auto translate-y-0" : "opacity-0 pointer-events-none translate-y-6"} `}>
                {product.type === "prime" || product.type === "prime_plus" || product.type === "evo" ? (
                  <>
                    <span className="flex items-center gap-2">
                      <Icon name="check" className="h-4 w-4 text-neo" />
                      <span className="font-body text-sm font-semibold text-neo">{t("product.inCart")}</span>
                    </span>
                    <button type="button" onClick={() => setOpen(true)} className={`grid aspect-square h-9 w-9 shrink-0 place-items-center !rounded-full border-2 border-ink bg-neo text-white transition duration-150 hover:scale-105 active:scale-95 ${focus}`}>
                      <Icon name="cart" />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={handleDecrease} className={`grid aspect-square h-7 w-7 shrink-0 place-items-center !rounded-full bg-neo text-ink transition hover:scale-105 active:scale-95 disabled:opacity-40 ${focus}`}>
                      <Icon name={qty === 1 ? "trash" : "minus"} />
                    </button>
                    <span className="min-w-0 text-center font-body text-sm font-bold leading-tight text-neo" aria-live="polite"><span className="font-display text-2xl font-extrabold">{qty}</span> au panier</span>
                    <button type="button" onClick={handleIncrease} className={`grid aspect-square h-7 w-7 shrink-0 place-items-center !rounded-full bg-neo text-ink transition hover:scale-105 active:scale-95 disabled:opacity-40 ${focus}`}>
                      <Icon name="plus" />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}