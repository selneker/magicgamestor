import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
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
  const normalizedName = name.toLowerCase().replace(/[\s,_-]+/g, " ").trim();
  const normalizedFigure = figureStr.replace(/[\s,_-]+/g, " ").trim();
  const showName = !hasFigure || (!normalizedName.includes(normalizedFigure) && !normalizedName.match(new RegExp(`(?:prime\\+?|pack évolutif)\\s+${String(value).replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}`)));
  const hasRealOldPrice = Number(product.old_price) > Number(product.price) && Number.isFinite(Number(product.old_price));
  const discount = hasRealOldPrice ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const showDiscount = discount >= 5;
  const unitPrice = product.uc_amount ? Math.round(product.price / product.uc_amount) : null;
  const available = product.purchasable !== false;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.3 }}
      data-testid={`product-card-${product.slug}`}
      className={`card-lift group relative flex min-h-[112px] min-w-0 flex-row overflow-hidden rounded-[14px] border bg-card min-[480px]:h-full min-[480px]:flex-col ${available ? "" : "opacity-70"}`}
    >
      <Link to={`/produit/${product.slug}`} className="flex min-w-0 flex-1 flex-col justify-center p-3 min-[480px]:p-4 sm:p-5" aria-label={name}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate rounded-full border border-[color:var(--rule-strong)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" data-testid={`product-type-${product.slug}`}>
            {typeLabel(game, product.type, lang)}
          </span>
          {product.popular ? (
            <span data-testid={`badge-popular-${product.slug}`} className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] leading-none text-[#0A0A0A]">{t("common.popular")}</span>
          ) : product.badge ? (
            <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-background">{product.badge}</span>
          ) : null}
        </div>

        {hasFigure && (
          <div className="mt-5 flex items-baseline gap-1.5" data-testid={`product-figure-${product.slug}`}>
            <span className="num text-[2rem] font-bold leading-none tabular-nums min-[480px]:text-[2.4rem]">{value}</span>
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
              <div className="mt-1.5 flex min-h-4 items-center gap-1.5 leading-none">
                {showDiscount && <><span className="text-[11px] text-muted-foreground line-through">{formatAr(product.old_price)}</span><span className="rounded-full bg-primary px-2 py-1 text-[11px] font-semibold leading-none text-[#0A0A0A]">-{discount}%</span></>}
              </div>
              {unitPrice && <p className="mt-2 text-sm font-semibold text-muted-foreground">{formatAr(unitPrice)}/UC</p>}
            </div>
            <span className="sr-only">Voir le détail de {name}</span>
          </div>
        </div>
      </Link>
      <button
        type="button" disabled={!available} data-testid={`add-to-cart-${product.slug}`}
        className="flex min-h-11 w-auto shrink-0 items-center justify-center gap-2 border-l-2 px-3 min-[480px]:w-full min-[480px]:border-l-0 min-[480px]:border-t-2 border-[color:var(--rule-strong)] bg-card px-3 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.05em] text-foreground transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-foreground hover:text-background active:translate-y-0.5 active:bg-primary active:text-[#0A0A0A] disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-card disabled:hover:text-muted-foreground"
        onClick={() => addFeedback(add(product), t, toast, setOpen)}
      >
        {available ? <><Plus className="h-3.5 w-3.5" />{t("product.add")}</> : t("product.unavailable")}
      </button>
    </motion.article>
  );
}
