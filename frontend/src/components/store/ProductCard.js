import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Coins, Crown, Flame } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";

export const productName = (p, lang) => (lang === "en" && p.name_en ? p.name_en : p.name);

export function ProductCard({ product, index = 0 }) {
  const { add, setOpen } = useCart();
  const { t, lang } = useLang();
  const isUc = product.type === "uc";
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.04, 0.4), duration: 0.35 }}
      data-testid={`product-card-${product.slug}`}
      className="card-lift relative flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)]"
    >
      {product.popular && (
        <span data-testid={`badge-popular-${product.slug}`} className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"><Flame className="h-3 w-3" />{t("common.popular")}</span>
      )}
      {!product.popular && product.badge && <span className="absolute right-3 top-3 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{product.badge}</span>}
      <Link to={`/produit/${product.slug}`} className="flex flex-1 flex-col">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isUc ? "bg-amber-50 text-amber-600" : "bg-violet-50 text-violet-600"}`}>
          {isUc ? <Coins className="h-6 w-6" /> : <Crown className="h-6 w-6" />}
        </div>
        <h3 className="mt-4 font-display text-xl font-bold text-slate-900">{productName(product, lang)}</h3>
        <p className="text-xs text-slate-500">{isUc ? "PUBG Mobile UC" : `PUBG Mobile ${product.type === "prime_plus" ? "Prime+" : "Prime"}`}</p>
        <div className="mt-4">
          <span data-testid={`price-${product.slug}`} className="block whitespace-nowrap font-display text-lg font-bold text-primary">{formatAr(product.price)}</span>
          <div className="flex items-center gap-2">
            {product.old_price && <span className="whitespace-nowrap text-xs text-slate-400 line-through">{formatAr(product.old_price)}</span>}
            {discount > 0 && <span className="text-[10px] font-bold text-emerald-600">-{discount}%</span>}
          </div>
        </div>
      </Link>
      <Button
        size="sm" data-testid={`add-to-cart-${product.slug}`} className="mt-4 w-full rounded-full font-bold active:scale-[0.97]"
        onClick={() => { add(product); toast.success(t("product.added"), { action: { label: t("nav.cart"), onClick: () => setOpen(true) } }); }}
      >
        {t("product.add")}
      </Button>
    </motion.article>
  );
}
