import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { addFeedback, useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { formatAr } from "@/lib/api";
import { gameOf, productFigure, typeLabel } from "@/lib/catalog";

export const productName = (p, lang) => (lang === "en" && p.name_en ? p.name_en : p.name);

export function ProductCard({ product, index = 0 }) {
  const { add, setOpen } = useCart();
  const { t, lang } = useLang();
  const { games } = useGames();
  const game = games.find((g) => g.id === gameOf(product));
  const name = productName(product, lang);
  // A numeric headline (currency amount / months) stays the hero figure. Text-only
  // labels (e.g. "Pack évolutif") must NOT be rendered as a giant broken word.
  const hasFigure = !!(product.uc_amount || product.duration_months);
  const { value, unit } = productFigure(product, game, lang);
  // Avoid repeating the headline figure as a subtitle (e.g. a "30 UC" pack named "30 UC").
  const figureStr = hasFigure ? `${value} ${unit || ""}`.trim().toLowerCase() : "";
  const showName = !hasFigure || name.trim().toLowerCase() !== figureStr;
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const available = product.purchasable !== false;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.3 }}
      data-testid={`product-card-${product.slug}`}
      className={`card-lift group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[14px] border bg-card ${available ? "" : "opacity-70"}`}
    >
<<<<<<< HEAD
<<<<<<< HEAD
      <Link to={`/produit/${product.slug}`} className="block" aria-label={name}>
        <div className="relative aspect-[4/5] w-full overflow-hidden" data-testid={`product-figure-${product.slug}`}>
          <div className="absolute inset-0" style={{ background: grad }} aria-hidden="true" />
          {product.image_url && (
            <img src={product.image_url} alt="" aria-hidden="true" loading="lazy" decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/10" aria-hidden="true" />
          <div className="absolute left-2.5 top-2.5 flex max-w-[72%] flex-wrap gap-1.5">
            <span data-testid={`product-type-${product.slug}`} className="truncate rounded-full border border-white/25 bg-black/35 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90 backdrop-blur-sm">{typeLabel(game, product.type, lang)}</span>
          </div>
          <div className="absolute right-2.5 top-2.5 flex flex-col items-end gap-1.5">
            {product.popular && <span data-testid={`badge-popular-${product.slug}`} className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0A0A0A]">{t("common.popular")}</span>}
            {discount > 0 && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold leading-none text-[#0A0A0A]">-{discount}%</span>}
            {!product.popular && product.badge && <span className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white backdrop-blur-sm">{product.badge}</span>}
          </div>
          <div className="absolute inset-x-3 bottom-3 text-white">
            {hasFigure ? (
              <p className="flex items-baseline gap-1.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                <span className="num text-[2rem] font-bold leading-none tabular-nums">{value}</span>
                {unit && <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/80">{unit}</span>}
              </p>
            ) : (
              <p className="font-display text-lg font-bold leading-tight [overflow-wrap:anywhere] line-clamp-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">{typeLabel(game, product.type, lang)}</p>
            )}
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-3.5">
        <Link to={`/produit/${product.slug}`} className="min-w-0">
          <h3 data-testid={`product-name-${product.slug}`} className="min-h-[2.5rem] font-display text-sm font-bold leading-tight text-foreground [overflow-wrap:anywhere] line-clamp-2">{name}</h3>
        </Link>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p data-testid={`price-${product.slug}`} className="num text-[1.1rem] font-bold leading-none text-foreground">{formatAr(product.price)}</p>
          {product.old_price && <span className="text-[11px] text-muted-foreground line-through">{formatAr(product.old_price)}</span>}
          {discount > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#0A0A0A]">-{discount}%</span>}
        </div>
        <button
          type="button" disabled={!available} data-testid={`add-to-cart-${product.slug}`}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[color:var(--rule-strong)] bg-transparent px-3 text-xs font-semibold uppercase tracking-[0.05em] text-foreground transition-[transform,background-color,color,box-shadow] hover:-translate-y-0.5 hover:bg-foreground hover:text-background active:translate-y-0.5 active:bg-primary active:text-[#0A0A0A] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-transparent disabled:hover:text-foreground"
          onClick={() => addFeedback(add(product), t, toast, setOpen)}
        >
          {available ? <><Plus className="h-3.5 w-3.5" />{t("product.add")}</> : t("product.unavailable")}
        </button>
      </div>
=======
      <Link to={`/produit/${product.slug}`} className="flex flex-1 flex-col p-4 sm:p-5" aria-label={name}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate rounded-full border border-[color:var(--rule-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" data-testid={`product-type-${product.slug}`}>
            {typeLabel(game, product.type, lang)}
          </span>
          {product.popular ? (
            <span data-testid={`badge-popular-${product.slug}`} className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0A0A0A]">{t("common.popular")}</span>
          ) : product.badge ? (
            <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-background">{product.badge}</span>
          ) : null}
        </div>

        {hasFigure && (
          <div className="mt-5 flex items-baseline gap-1.5" data-testid={`product-figure-${product.slug}`}>
            <span className="num text-[2.4rem] font-bold leading-none tabular-nums">{value}</span>
            {unit && <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-sm">{unit}</span>}
          </div>
        )}

        <h3
          data-testid={`product-name-${product.slug}`}
          className={`mt-3 font-display font-bold leading-tight text-foreground [overflow-wrap:anywhere] line-clamp-2 ${hasFigure ? "min-h-[2.5rem] text-sm text-muted-foreground" : "min-h-[3.25rem] text-xl"}`}
        >
          {showName ? name : ""}
        </h3>

        <div className="mt-auto pt-5">
          <div className="flex items-end justify-between gap-2 border-t pt-3">
            <div className="min-w-0">
              <p data-testid={`price-${product.slug}`} className="num text-[1.25rem] font-bold leading-none text-foreground">{formatAr(product.price)}</p>
              {(product.old_price || discount > 0) && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 leading-none">
                  {product.old_price && <span className="text-[11px] text-muted-foreground line-through">{formatAr(product.old_price)}</span>}
                  {discount > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-[#0A0A0A]">-{discount}%</span>}
                </p>
              )}
            </div>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </div>
      </Link>
=======
      <Link to={`/produit/${product.slug}`} className="flex flex-1 flex-col p-4 sm:p-5" aria-label={name}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate rounded-full border border-[color:var(--rule-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" data-testid={`product-type-${product.slug}`}>
            {typeLabel(game, product.type, lang)}
          </span>
          {product.popular ? (
            <span data-testid={`badge-popular-${product.slug}`} className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0A0A0A]">{t("common.popular")}</span>
          ) : product.badge ? (
            <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-background">{product.badge}</span>
          ) : null}
        </div>

        {hasFigure && (
          <div className="mt-5 flex items-baseline gap-1.5" data-testid={`product-figure-${product.slug}`}>
            <span className="num text-[2.4rem] font-bold leading-none tabular-nums">{value}</span>
            {unit && <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-sm">{unit}</span>}
          </div>
        )}

        <h3
          data-testid={`product-name-${product.slug}`}
          className={`mt-3 font-display font-bold leading-tight text-foreground [overflow-wrap:anywhere] line-clamp-2 ${hasFigure ? "min-h-[2.5rem] text-sm text-muted-foreground" : "min-h-[3.25rem] text-xl"}`}
        >
          {showName ? name : ""}
        </h3>

        <div className="mt-auto pt-5">
          <div className="flex items-end justify-between gap-2 border-t pt-3">
            <div className="min-w-0">
              <p data-testid={`price-${product.slug}`} className="num text-[1.25rem] font-bold leading-none text-foreground">{formatAr(product.price)}</p>
              {(product.old_price || discount > 0) && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 leading-none">
                  {product.old_price && <span className="text-[11px] text-muted-foreground line-through">{formatAr(product.old_price)}</span>}
                  {discount > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-[#0A0A0A]">-{discount}%</span>}
                </p>
              )}
            </div>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </div>
      </Link>
>>>>>>> origin/main
      <button
        type="button" disabled={!available} data-testid={`add-to-cart-${product.slug}`}
        className="flex h-12 w-full items-center justify-center gap-1.5 border-t bg-card px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground transition-colors hover:bg-foreground hover:text-background active:bg-primary active:text-[#0A0A0A] disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-muted-foreground"
        onClick={() => addFeedback(add(product), t, toast, setOpen)}
      >
        {available ? <><Plus className="h-3.5 w-3.5" />{t("product.add")}</> : t("product.unavailable")}
      </button>
<<<<<<< HEAD
>>>>>>> df1cac3aecfa8b7c135c594204962e24ba227f6c
=======
>>>>>>> origin/main
    </motion.article>
  );
}
