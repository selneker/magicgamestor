import { Link } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addFeedback, useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { formatAr } from "@/lib/api";
import { gameOf, productFigure, typeLabel } from "@/lib/catalog";
import { useFavorites } from "@/lib/favorites";

export const productName = (p, lang) => (lang === "en" && p.name_en ? p.name_en : p.name);

export function ProductCard({ product, index = 0, badge = null }) {
  const { add, setOpen } = useCart();
  const { t, lang } = useLang();
  const { games } = useGames();
  const game = games.find((g) => g.id === gameOf(product));
  const name = productName(product, lang);
  const hasFigure = !!(product.uc_amount || product.duration_months);
  const { value, unit } = productFigure(product, game, lang);
  const figureStr = hasFigure ? `${value} ${unit || ""}`.trim().toLowerCase() : "";
  const normalizedName = name.toLowerCase().replace(/[\s,_-]+/g, " ").trim();
  const normalizedFigure = figureStr.replace(/[\s,_-]+/g, " ").trim();
  const showName = !hasFigure || (!normalizedName.includes(normalizedFigure) && !normalizedName.match(new RegExp(`(?:prime\\+?|pack évolutif)\\s+${String(value).replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}`)));
  const hasRealOldPrice = Number(product.old_price) > Number(product.price) && Number.isFinite(Number(product.old_price));
  const discount = hasRealOldPrice ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const showDiscount = discount >= 5;
  const unitPrice = product.uc_amount ? Math.round(product.price / product.uc_amount) : null;
  const safeBadge = /^(new|hot)$/i.test(String(product.badge || "").trim()) ? String(product.badge).trim().toUpperCase() : null;
  const available = product.purchasable !== false;

  // Favorites
  const [favorites, toggleFavorite] = useFavorites();
  const isFavorite = favorites.includes(product.id);

  return (
    <article
      data-testid={`product-card-${product.slug}`}
      className={`${available ? "" : "opacity-70"} neo-card neo-card-radius group relative w-full min-h-[112px] min-w-0 flex min-[480px]:h-full min-[480px]:flex-col max-[479px]:min-h-[140px] pt-4 pb-10 px-4`}
    >
      {/* Link to product page - covers the entire card */}
      <Link to={`/produit/${product.slug}`} className="absolute inset-0 focus-ring active:scale-[98]" aria-label={name} />

      {/* Inner content */}
      <div className="relative z-10 flex h-full flex-col">
        {/* Top row: type badge and context badge */}
        <div className="flex items-center justify-between gap-2 mb-2">
          {/* Type badge */}
          <span
            className="truncate rounded-full border-[2px] border-[color:var(--neo-border)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--neo-text)]"
            data-testid={`product-type-${product.slug}`}
          >
            {typeLabel(game, product.type, lang)}
          </span>
          {/* Context badge */}
          {badge === "popular" && (
            <span
              data-testid={`badge-popular-${product.slug}`}
              className="shrink-0 rounded-full bg-[color:var(--neo-border)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] leading-none text-[color:var(--neo-card-bg)]"
            >
              {t("common.popular")}
            </span>
          )}
          {badge === "best" && (
            <span
              data-testid={`badge-best-${product.slug}`}
              className="shrink-0 rounded-full bg-[color:var(--neo-text)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--neo-card-bg)]"
            >
              {t("catalog.bestPriceUC")}
            </span>
          )}
          {(badge === "new" || badge === "hot") && (
            <span
              data-testid={`badge-${badge}-${product.slug}`}
              className="shrink-0 rounded-full bg-[color:var(--neo-text)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--neo-card-bg)]"
            >
              {badge === "new" ? t("common.new") : t("common.promo")}
            </span>
          )}
        </div>

        {/* Quantity figure (if applicable) */}
        {hasFigure && (
          <div className="mb-4 flex items-baseline gap-1.5" data-testid={`product-figure-${product.slug}`}>
            <div className="figure-highlight">
              <span className="num text-[2.4rem] font-bold leading-none tabular-nums min-[480px]:text-[2.8rem]">{value}</span>
              {unit && <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--neo-text)]/70 sm:text-sm">{unit}</span>}
            </div>
          </div>
        )}

        {/* Title */}
        <h3
          data-testid={`product-name-${product.slug}`}
          className={`mt-3 font-display font-bold leading-tight text-[color:var(--neo-text)] [overflow-wrap:anywhere] line-clamp-2 ${hasFigure ? "min-h-[2.5rem] text-sm text-[color:var(--neo-text)]/70" : "min-h-[3.25rem] text-xl"}`}
        >
          {showName ? name : ""}
        </h3>

        {/* Spacer to push the capsule to the bottom */}
        <div className="mt-auto" />

        {/* Capsule at the bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-20 flex items-end justify-between gap-2 border-t pt-3">
          {/* Left: price and discount */}
          <div className="min-w-0">
            <p data-testid={`price-${product.slug}`} className="num text-[1.75rem] font-bold leading-none text-[color:var(--neo-text)] min-[480px]:text-[2rem]">
              {formatAr(product.price)}
            </p>
            <div className="mt-1.5 flex min-h-4 items-center gap-1.5 leading-none">
              {showDiscount && (
                <>
                  <span className="text-[11px] text-[color:var(--neo-text)]/50 line-through">{formatAr(product.old_price)}</span>
                  <span className="rounded-full bg-[color:var(--neo-card-bg)] px-2 py-1 text-[11px] font-semibold leading-none text-[color:var(--neo-text)]">
                    -{discount}%
                  </span>
                </>
              )}
            </div>
            {unitPrice && (
              <p className="mt-2 text-sm font-semibold text-[color:var(--neo-text)]/70">
                {formatAr(unitPrice)}/UC
              </p>
            )}
            {bestUnitPrice && (
              <span className="mt-2 inline-flex w-fit rounded-full bg-[color:var(--neo-text)] px-2 py-1 text-[10px] font-bold text-[color:var(--neo-card-bg)]">
                Meilleur prix par UC
              </span>
            )}
          </div>

          {/* Right: add to cart button */}
          <button
            type="button"
            disabled={!available}
            data-testid={`add-to-cart-${product.slug}`}
            className="flex min-h-11 w-auto shrink-0 items-center justify-center gap-2 border-l-2 px-3 min-[480px]:w-full min-[480px]:border-l-0 min-[480px]:border-t-2 border-[color:var(--neo-border)] bg-[color:var(--neo-card-bg)] px-3 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.05em] text-[color:var(--neo-text)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-[color:var(--neo-text)] hover:text-[color:var(--neo-card-bg)] active:translate-y-0.5 active:bg-[color:var(--neo-text)] active:text-[color:var(--neo-card-bg)] disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-[color:var(--neo-card-bg)] disabled:hover:text-[color:var(--neo-text)]/50 focus-ring"
            onClick={() => addFeedback(add(product), t, toast, setOpen)}
          >
            {available ? (
              <>
                <Plus className="h-3.5 w-3.5" />{t("product.add")}
              </>
            ) : t("product.unavailable")}
          </button>
        </div>
      </div>

      {/* Favorite button (top right) */}
      <button
        type="button"
        aria-label={t("product.favorite")}
        aria-pressed={isFavorite}
        data-testid={`favorite-button-${product.slug}`}
        className="absolute top-0 right-0 z-20 mt-2 mr-2 w-11 h-11 shrink-0 rounded-full border-[2px] border-[color:var(--neo-border)] bg-[color:var(--neo-card-bg)] text-[color:var(--neo-text)] hover:bg-red-600 hover:text-[color:var(--neo-card-bg)] active:bg-red-700 active:text-[color:var(--neo-card-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--neo-border)] transition-colors duration-200"
        onClick={toggleFavorite}
      >
        {isFavorite ? (
          // Filled heart
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.36l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        ) : (
          // Outline heart
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.845 4.693c-4.142-1.274-8.788.116-8.904 4.124c-.116 3.012.381 6.45 2.014 8.607a48.388 48.388 0 013.477 5.207c-.256 1.06-.41 2.227-.41 3.49v4.733a.75.75 0 00.75.75h4.5a.75.75 0 00.75-.75v-4.733c0-1.263-.154-2.517-.41-3.49a48.388 48.388 0 013.477-5.207c1.633-2.157 2.13-5.595 2.014-8.607a48.398 48.398 0 00-.116-4.124c-1.152-4.248-4.762-5.398-8.904-4.124z" />
          </svg>
        )}
      </button>
    </article>
  );
}
