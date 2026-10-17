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

export function ProductCard({ product, index = 0 }) {
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
  const available = product.purchasable !== false;

  // Favorites
  const [favorites, toggleFavorite] = useFavorites();
  const isFavorite = favorites.includes(product.id);

  return (
    <article
      data-testid={`product-card-${product.slug}`}
      className="group relative w-full rounded-[3rem] border-[3px] border-[color:var(--neo-border)] bg-[color:var(--neo-card-bg)] text-[color:var(--neo-text)] shadow-neo hover:shadow-neo-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--neo-border)] transition-all duration-200 ease-in-out"
      // Neo-brutalist shadow classes: we'll define them in CSS or use inline style? We'll use Tailwind-like classes via className.
      // We'll define the neo-brutalist shadow in the CSS later, but for now we can use inline style or rely on the tokens.
      // We'll add the shadow via className and define the CSS in index.css.
      // Let's add a class for the neo-brutalist style and define the CSS in index.css.
      // We'll do: className="... neo-card"
      // And then in index.css we define .neo-card with the shadow and other properties.
      // However, we are to use the tokens and apply the style via the tokens.
      // We'll use the tokens in the className by using the CSS variables.
      // We'll set the background, text color, border color via the tokens.
      // For the shadow, we can use the tokens as well: --neo-text for the shadow color.
      // We'll define the shadow in the style attribute or use a class that uses the tokens.
      // Since we are already using the tokens for background, border, and text, we can define the shadow in the CSS using the tokens.
      // We'll add a class "neo-card" and define it in index.css.
      // Let's do that.
      // We'll change the className to include "neo-card" and then define the neo-card class in index.css.
      // But note: we are to avoid changing the rest of the site. We'll define the neo-card class in index.css and use it only here.
      // We'll do that after we write the component.
      // For now, we'll use the tokens in the className string.
      // We'll use the following format:
      //   className=`rounded-[3rem] border-[3px] border-[color:var(--neo-border)] bg-[color:var(--neo-card-bg)] text-[color:var(--neo-text)] shadow-[8px_8px_0_0hsl(0_0%_6.7%_/_0.18)] hover:shadow-[12px_12px_0_0hsl(0_0%_6.7%_/_0.18)]`
      // But note: the shadow color is hsl(0 0% 6.7% / 0.18) which is approximately #111111 with 18% opacity.
      // We can use the token --neo-text and adjust the opacity.
      // We'll use: shadow-[8px_8px_0_0hsl(0_0%_6.7%_/_0.18)] but we don't have the exact hsl value for --neo-text.
      // We can compute: #111111 is hsl(0 0% 6.7%).
      // So we can use: shadow-[8px_8px_0_0_hsl(0_0%_6.7%_/_0.18)]
      // However, Tailwind does not support arbitrary values with hsl() in the same way. We'll use the tokens in the style attribute?
      // Alternatively, we can define the shadow in the CSS using the tokens and then use a class.
      // Let's do: we'll define a class .neo-card in index.css that uses the tokens for the shadow.
      // We'll do that after we finish the component.
      // For now, we'll use inline style for the shadow? But we are to avoid inline style for the shadow?
      // We'll use the className and rely on the CSS we will add to index.css.
      // We'll add the class "neo-card" and then in index.css we define:
      //   .neo-card {
      //     box-shadow: 8px 8px 0 hsl(var(--neo-text) / 0.18);
      //   }
      //   .neo-card:hover {
      //     box-shadow: 12px 12px 0 hsl(var(--neo-text) / 0.18);
      //   }
      //   .neo-card:focus-visible {
      //     outline: 2px solid hsl(var(--neo-border));
      //     outline-offset: 2px;
      //   }
      // We'll do that.
      // Let's set the className to include "neo-card" and the other classes for the layout.
      // We'll also need to adjust the radius: 3rem from 560px, 2rem below.
      // We'll use: rounded-[3rem] and then use a media query to change to 2rem? Or we can use a CSS variable for the radius.
      // We'll use: rounded-[3rem] and then override in a media query?
      // We can use: rounded-[3rem] and then add a class that changes it at a certain breakpoint?
      // We'll use: rounded-[3rem] and then in the CSS we can override with a media query?
      // Alternatively, we can use: rounded-[3rem] and then use a utility class that changes at a breakpoint?
      // We'll do: we'll set the radius to 3rem and then use a media query in the CSS to change it to 2rem for screens under 560px.
      // We'll do that in index.css.
      // For now, we'll set the radius to 3rem and note that we need to add the media query.
      // We'll add a class "neo-card-radius" and define it in index.css with the media query.
      // Let's do: className="neo-card neo-card-radius"
      // And then in index.css we define:
      //   .neo-card-radius {
      //     border-radius: 3rem;
      //   }
      //   @media (max-width: 559px) {
      //     .neo-card-radius {
      //       border-radius: 2rem;
      //     }
      //   }
      // We'll do that.
      // Now, let's write the className for the article.
      // We'll also need to set the min-height and other layout classes.
      // We'll use flex and min-h-[112px] etc. as in the original, but we adjust for the néo-brutalist design.
      // We'll keep the same flex behavior but adjust the classes.
      // We'll write the className string for the article.
      // We'll break it down:
      //   - neo-card: for the background, text, border, shadow, focus outline
      //   - neo-card-radius: for the radius (with media query in CSS)
      //   - group: for the hover state of the inner elements (we'll use group for the hover effects on the inner elements)
      //   - relative: for the absolute positioning of the link and favorite button
      //   - w-full: full width
      //   - We'll also set the min-height and padding.
      //   - We'll use: min-h-[112px] min-w-0 flex min-[480px]:h-full min-[480px]:flex-col max-[479px]:min-h-[140px]
      //   - We'll also set the padding: pt-4 pb-10 px-4 (to accommodate the favorite button at top and capsule at bottom)
      //   - We'll also set the z-index for the inner content.
      // Let's construct the className:
      className={`${available ? "" : "opacity-70"} neo-card neo-card-radius group relative w-full min-h-[112px] min-w-0 flex min-[480px]:h-full min-[480px]:flex-col max-[479px]:min-h-[140px] pt-4 pb-10 px-4`}
    >
      {/* Link to product page - covers the entire card */}
      <Link to={`/produit/${product.slug}`} className="absolute inset-0" aria-label={name} />

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
          {product.popular ? (
            <span
              data-testid={`badge-popular-${product.slug}`}
              className="shrink-0 rounded-full bg-[color:var(--neo-border)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] leading-none text-[color:var(--neo-card-bg)]"
            >
              {t("common.popular")}
            )
          ) : product.badge ? (
            <span className="shrink-0 rounded-full bg-[color:var(--neo-text)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--neo-card-bg)]">
              {product.badge}
            </span>
          ) : null}
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
                  </>
                </>
              )}
            </div>
            {unitPrice && (
              <p className="mt-2 text-sm font-semibold text-[color:var(--neo-text)]/70">
                {formatAr(unitPrice)}/UC
              </p>
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