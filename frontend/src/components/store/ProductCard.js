import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { subscriptionLabel, useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";

export const productName = (p, lang) => (lang === "en" && p.name_en ? p.name_en : p.name);

const bigNumber = (p) => {
  if (p.type === "uc") return p.uc_amount ? String(p.uc_amount) : (String(p.name).match(/\d+/)?.[0] || "UC");
  return p.duration_months ? `${p.duration_months}` : "1";
};
const unitLabel = (p) => (p.type === "uc" ? "UC" : p.type === "prime_plus" ? "Prime+" : "Prime");

export function ProductCard({ product, index = 0 }) {
  const { add, setOpen } = useCart();
  const { t, lang } = useLang();
  const isUc = product.type === "uc";
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.32 }}
      data-testid={`product-card-${product.slug}`}
      className="card-lift group relative flex min-w-0 flex-col border border-foreground bg-card"
    >
      {product.popular && (
        <span data-testid={`badge-popular-${product.slug}`} className="absolute -top-px right-0 bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#0A0A0A]">{t("common.popular")}</span>
      )}
      {!product.popular && product.badge && <span className="absolute -top-px right-0 bg-foreground px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-background">{product.badge}</span>}
      <Link to={`/produit/${product.slug}`} className="flex flex-1 flex-col p-4 pt-8">
        <p className="eyebrow">{isUc ? "PUBG Mobile UC" : `PUBG ${unitLabel(product)}`}</p>
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="num text-[2rem] leading-[0.85] text-foreground sm:text-5xl">{bigNumber(product)}</span>
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{isUc ? "UC" : t("product.months")}</span>
        </div>
        <h3 className="mt-3 truncate font-display text-sm font-bold uppercase tracking-tight text-foreground">{productName(product, lang)}</h3>
        <div className="mt-auto pt-4">
          <span data-testid={`price-${product.slug}`} className="num block whitespace-nowrap text-lg text-foreground">{formatAr(product.price)}</span>
          <div className="flex items-center gap-2">
            {product.old_price && <span className="whitespace-nowrap text-xs text-muted-foreground line-through">{formatAr(product.old_price)}</span>}
            {discount > 0 && <span className="bg-primary px-1 text-[10px] font-black text-[#0A0A0A]">-{discount}%</span>}
          </div>
        </div>
      </Link>
      <Button
        size="sm" data-testid={`add-to-cart-${product.slug}`}
        className="h-11 w-full whitespace-normal rounded-none border-t border-foreground bg-transparent px-1 text-[10px] font-black uppercase leading-tight tracking-[0.1em] text-foreground shadow-none hover:bg-primary hover:text-[#0A0A0A]"
        onClick={() => { const r = add(product); if (!r.ok) return toast.error(t("product.duplicateSub").replaceAll("{label}", subscriptionLabel(product.type))); toast.success(t("product.added"), { action: { label: t("nav.cart"), onClick: () => setOpen(true) } }); }}
      >
        {t("product.add")}
      </Button>
    </motion.article>
  );
}
