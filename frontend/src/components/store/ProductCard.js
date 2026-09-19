import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { subscriptionLabel, useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";

export const productName = (p, lang) => (lang === "en" && p.name_en ? p.name_en : p.name);

const quantity = (p) => (p.type === "uc"
  ? { value: p.uc_amount || String(p.name).match(/\d+/)?.[0] || "", unit: "UC" }
  : { value: p.duration_months || 1, unit: "mois" });

export function ProductCard({ product, index = 0 }) {
  const { add, setOpen } = useCart();
  const { t, lang } = useLang();
  const isUc = product.type === "uc";
  const { value, unit } = quantity(product);
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const category = isUc ? "PUBG MOBILE UC" : `PUBG ${subscriptionLabel(product.type)}`;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.3 }}
      data-testid={`product-card-${product.slug}`}
      className="card-lift group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[14px] border bg-card"
    >
      {product.popular && (
        <span data-testid={`badge-popular-${product.slug}`} className="absolute right-3 top-3 z-10 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0A0A0A]">{t("common.popular")}</span>
      )}
      {!product.popular && product.badge && <span className="absolute right-3 top-3 z-10 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-background">{product.badge}</span>}

      <Link to={`/produit/${product.slug}`} className="flex flex-1 flex-col p-4 pt-10 sm:p-5 sm:pt-11">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{category}</p>
        <h3 className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 font-display leading-none text-foreground">
          <span className="num text-[clamp(1.75rem,8.5vw,2.75rem)] font-bold leading-none sm:text-[2.75rem]">{value}</span>
          <span className="shrink-0 text-sm font-medium uppercase leading-none tracking-[0.06em] text-muted-foreground sm:text-base">{unit}</span>
        </h3>

        <div className="mt-auto pt-6">
          <div className="border-t pt-3">
            <p data-testid={`price-${product.slug}`} className="num text-[1.3rem] font-bold leading-none text-foreground">{formatAr(product.price)}</p>
            {(product.old_price || discount > 0) && (
              <p className="mt-2 flex flex-wrap items-center gap-2 leading-none">
                {product.old_price && <span className="text-[11px] font-normal text-muted-foreground line-through">{formatAr(product.old_price)}</span>}
                {discount > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-[#0A0A0A]">-{discount}%</span>}
              </p>
            )}
          </div>
        </div>
      </Link>

      <Button
        size="sm" variant="ghost" data-testid={`add-to-cart-${product.slug}`} style={{ borderRadius: 0 }}
        className="h-12 w-full whitespace-nowrap rounded-none border-0 border-t bg-card px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground shadow-none transition-colors hover:bg-foreground hover:text-background active:bg-primary active:text-[#0A0A0A]"
        onClick={() => { const r = add(product); if (!r.ok) return toast.error(t("product.duplicateSub").replaceAll("{label}", subscriptionLabel(product.type))); toast.success(t("product.added"), { action: { label: t("nav.cart"), onClick: () => setOpen(true) } }); }}
      >
        {t("product.add")}
      </Button>
    </motion.article>
  );
}
