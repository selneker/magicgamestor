import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Gamepad2, Plus } from "lucide-react";
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
  const [imgFailed, setImgFailed] = useState(false);
  const game = games.find((g) => g.id === gameOf(product));
  const { value, unit } = productFigure(product, game, lang);
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const available = product.purchasable !== false;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.3 }}
      data-testid={`product-card-${product.slug}`}
      className={`card-lift group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[14px] border bg-card ${available ? "" : "opacity-70"}`}
    >
      <Link to={`/produit/${product.slug}`} className="flex flex-1 flex-col p-4 sm:p-5" aria-label={productName(product, lang)}>
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
        <div className="mt-5 flex items-end justify-between gap-3">
          <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-display leading-none text-foreground">
            <span className="num break-all text-[clamp(1.6rem,7.5vw,2.6rem)] font-bold leading-none sm:text-[2.6rem]">{value}</span>
            {unit && <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-sm">{unit}</span>}
          </h3>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]">
            {(product.image_url && !imgFailed) || (game?.icon_url && !imgFailed) ? (
              <img src={product.image_url || game.icon_url} alt="" width="44" height="44" className="h-full w-full object-cover" loading="lazy" onError={() => setImgFailed(true)} />
            ) : <Gamepad2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />}
          </span>
        </div>
        <p className="mt-2 truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{game?.name || ""}</p>
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
      <button
        type="button" disabled={!available} data-testid={`add-to-cart-${product.slug}`}
        className="flex h-12 w-full items-center justify-center gap-1.5 border-t bg-card px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground transition-colors hover:bg-foreground hover:text-background active:bg-primary active:text-[#0A0A0A] disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-muted-foreground"
        onClick={() => addFeedback(add(product), t, toast, setOpen)}
      >
        {available ? <><Plus className="h-3.5 w-3.5" />{t("product.add")}</> : t("product.unavailable")}
      </button>
    </motion.article>
  );
}
