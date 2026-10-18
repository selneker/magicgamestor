import { Link } from "react-router-dom";
import { formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { gameOf, productFigure, typeLabel } from "@/lib/catalog";

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

const isSinglePurchase = (type) => ["prime", "prime_plus", "evo"].includes(type);

export function ProductCard({
  product,
  badge = null,
  onAdd,
  onIncrease,
  onDecrease,
  qty = 0,
  favorite = false,
  onToggleFavorite,
}) {
  const { t, lang } = useLang();
  const { games } = useGames();
  const game = games.find((g) => g.id === gameOf(product));
  const name = productName(product, lang);
  const available = product.purchasable !== false;
  const hasFigure = Boolean(product.uc_amount || product.duration_months);
  const figure = productFigure(product, game, lang);
  const hasRealOldPrice = Number(product.old_price) > Number(product.price)
    && Number.isFinite(Number(product.old_price))
    && Number.isFinite(Number(product.price));
  const discount = hasRealOldPrice ? Math.round((1 - Number(product.price) / Number(product.old_price)) * 100) : 0;
  const showDiscount = hasRealOldPrice && discount >= 5;
  const maxQty = isSinglePurchase(product.type) ? 1 : 20;
  const unitPrice = product.uc_amount ? Math.round(Number(product.price) / Number(product.uc_amount)) : null;

  const badgeData = {
    popular: { icon: "flame", label: t("common.popular"), testId: "badge-popular-" + product.slug },
    best: { icon: "crown", label: t("catalog.bestPriceUC"), testId: "badge-best-" + product.slug },
    new: { icon: "bolt", label: t("common.new"), testId: "badge-new-" + product.slug },
    hot: { icon: "flame", label: t("common.promo"), testId: "badge-hot-" + product.slug },
  };
  const context = badgeData[badge] || (
    product.type === "evo"
      ? { icon: "crown", label: lang === "en" ? "Evolving pack" : "Pack évolutif" }
      : isSinglePurchase(product.type)
        ? { icon: "bolt", label: lang === "en" ? "Subscription" : "Abonnement" }
        : { icon: "cart", label: lang === "en" ? "Top-up pack" : "Pack recharge" }
  );
  const actionIcon = product.type === "evo" ? "cart" : isSinglePurchase(product.type) ? "arrow" : "plus";
  const focus = "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink";
  const toggleFavorite = () => onToggleFavorite?.(product);
  const add = () => onAdd?.(product);
  const increase = () => onIncrease?.(product);
  const decrease = () => onDecrease?.(product);
  const unavailableLabel = lang === "en" ? "Unavailable" : "Indisponible";
  const favoriteLabel = favorite
    ? (lang === "en" ? "Remove from favorites" : "Retirer des favoris")
    : (lang === "en" ? "Add to favorites" : "Ajouter aux favoris");
  const cartLabel = lang === "en" ? "in cart" : "au panier";

  return (
    <article
      data-testid={"product-card-" + product.slug}
      className={"group relative flex min-h-[360px] min-w-0 flex-col rounded-neo border-[3px] border-ink bg-neo p-6 shadow-brut transition duration-200 ease-out hover:-translate-y-1 hover:shadow-brut-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 " + (available ? "" : "opacity-60 grayscale")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 pr-1">
          <span data-testid={"product-type-" + product.slug} className="rounded-full border-2 border-ink bg-white/40 px-3 py-1 font-body text-[10px] font-bold uppercase leading-none tracking-wider backdrop-blur">
            {typeLabel(game, product.type, lang)}
          </span>
          <span
            data-testid={context.testId}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink/10 px-3 py-1 font-body text-[10px] font-bold uppercase leading-none tracking-wider backdrop-blur"
          >
            <Icon name={context.icon} className="h-3 w-3" />{context.label}
          </span>
        </div>

        <button
          type="button"
          data-testid={"favorite-button-" + product.slug}
          aria-label={favoriteLabel + " : " + name}
          aria-pressed={favorite}
          onClick={toggleFavorite}
          className={"grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-ink bg-ink text-white transition duration-150 hover:scale-105 hover:bg-red-500 active:scale-95 aria-[pressed=true]:bg-red-500 aria-[pressed=true]:[&_svg]:fill-white " + focus}
        >
          <Icon name="heart" />
        </button>
      </div>

      <Link
        to={"/produit/" + product.slug}
        className="mt-6 flex min-w-0 flex-1 flex-col rounded-md text-ink focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink"
        aria-label={name}
      >
        <h2 data-testid={"product-name-" + product.slug} className="line-clamp-2 min-h-[4rem] font-display text-2xl font-extrabold leading-tight tracking-tight">
          {name}
        </h2>
        {hasFigure && (
          <div data-testid={"product-figure-" + product.slug} className="mt-5 flex min-w-0 items-baseline gap-2">
            <span className={"num min-w-0 break-words font-display font-extrabold leading-[0.9] tracking-[-0.055em] " + (String(figure.value).length >= 5 ? "text-5xl sm:text-6xl" : String(figure.value).length >= 4 ? "text-6xl sm:text-7xl" : "text-7xl sm:text-8xl")}>
              {figure.value}
            </span>
            {figure.unit && <span className="shrink-0 font-display text-xl font-bold uppercase tracking-tight text-ink/70">{figure.unit}</span>}
          </div>
        )}
      </Link>

      <div className={"mt-auto flex min-h-20 items-center justify-between gap-2 rounded-full border-2 border-ink " + (
        !available ? "border-dashed bg-transparent px-5" : qty > 0 ? "bg-ink p-1.5" : "bg-white py-2 pl-4 pr-1.5 sm:pl-6 sm:pr-2"
      )}>
        {!available ? (
          <span className="font-body text-sm font-bold uppercase tracking-wide">{unavailableLabel}</span>
        ) : qty > 0 ? (
          <>
            <button
              type="button"
              data-testid={"cart-dec-" + product.slug}
              aria-label={(qty === 1 ? (lang === "en" ? "Remove from cart" : "Retirer du panier") : (lang === "en" ? "Remove one" : "Retirer un exemplaire")) + " : " + name}
              onClick={decrease}
              className={"grid h-12 w-12 shrink-0 place-items-center rounded-full bg-neo text-ink transition duration-150 hover:scale-105 active:scale-95 sm:h-14 sm:w-14 " + focus}
            >
              <Icon name={qty === 1 ? "trash" : "minus"} className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
            <span className="min-w-0 text-center font-body text-xs font-bold leading-tight text-neo sm:text-sm" aria-live="polite">
              <span className="font-display text-2xl font-extrabold">{qty}</span> {cartLabel}
            </span>
            <button
              type="button"
              data-testid={"cart-inc-" + product.slug}
              aria-label={(lang === "en" ? "Add one" : "Ajouter un exemplaire") + " : " + name}
              disabled={qty >= maxQty}
              onClick={increase}
              className={"grid h-12 w-12 shrink-0 place-items-center rounded-full bg-neo text-ink transition duration-150 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:h-14 sm:w-14 " + focus}
            >
              <Icon name="plus" className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p data-testid={"price-" + product.slug} className="num whitespace-nowrap font-display text-xl font-extrabold leading-none text-ink sm:text-2xl">
                  {formatAr(product.price)}
                </p>
                {showDiscount && (
                  <span data-testid={"product-discount-" + product.slug} className="rounded-full border border-ink bg-neo px-2 py-0.5 font-body text-[10px] font-extrabold leading-4 text-ink">
                    -{discount}%
                  </span>
                )}
              </div>
              {unitPrice && <p className="mt-1 text-[10px] font-semibold leading-tight text-neutral-600 sm:text-[11px]">{formatAr(unitPrice)}/{figure.unit || "UC"}</p>}
            </div>
            <button
              type="button"
              data-testid={"add-to-cart-" + product.slug}
              aria-label={(lang === "en" ? "Add to cart" : "Ajouter au panier") + " : " + name}
              disabled={!available}
              onClick={add}
              className={"grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-ink bg-ink text-neo transition duration-150 hover:scale-105 hover:bg-neo hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:h-16 sm:w-16 " + focus}
            >
              <Icon name={actionIcon} className="h-6 w-6 sm:h-7 sm:w-7" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}
