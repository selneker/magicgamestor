import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Coins, Crown, ShoppingBag, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, formatAr } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { subscriptionLabel, useCart } from "@/context/CartContext";
import { ProductCard, productName } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function Product() {
  const { slug } = useParams();
  const { t, lang } = useLang();
  const { add, setOpen, items } = useCart();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setProduct(null); setMissing(false);
    api.get(`/products/${slug}`).then((r) => setProduct(r.data)).catch(() => setMissing(true));
  }, [slug]);

  if (missing) return <div className="py-24 text-center text-slate-500" data-testid="product-missing">404</div>;
  if (!product) return <div className="grid gap-6 py-8 lg:grid-cols-2"><Skeleton className="h-80 rounded-3xl" /><Skeleton className="h-80 rounded-3xl" /></div>;

  const isUc = product.type === "uc";
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const tryAdd = () => { const r = add(product); if (!r.ok) toast.error(t("product.duplicateSub").replaceAll("{label}", subscriptionLabel(product.type))); return r.ok; };
  const buyNow = () => { if (tryAdd() || items.some((i) => i.id === product.id)) navigate("/commande"); };

  return (
    <div className="pb-32 pt-4">
      <Link to="/boutique" data-testid="back-to-catalog" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-900"><ChevronLeft className="h-4 w-4" />{t("catalog.title")}</Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <div className={`relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-[2rem] ${isUc ? "bg-gradient-to-br from-amber-100 via-yellow-50 to-white" : "bg-gradient-to-br from-violet-100 via-indigo-50 to-white"}`} data-testid="product-visual">
          <div className="flex h-28 w-28 items-center justify-center border border-foreground bg-primary text-[#0A0A0A]">{isUc ? <Coins className="h-14 w-14" strokeWidth={1.75} /> : <Crown className="h-14 w-14" strokeWidth={1.75} />}</div>
          <p className="absolute bottom-6 left-6 font-display text-5xl font-black uppercase text-slate-900/10 sm:text-7xl">{productName(product, lang)}</p>
          {product.popular && <span className="absolute left-0 top-0 bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#0A0A0A]">{t("common.popular")}</span>}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">PUBG Mobile · {isUc ? "UC" : product.type === "prime_plus" ? "Prime+" : "Prime"}</p>
          <h1 className="mt-2 font-display text-4xl font-black uppercase tracking-tight sm:text-5xl" data-testid="product-name">{productName(product, lang)}</h1>
          <div className="mt-4 flex items-end gap-3">
            <span data-testid="product-price" className="num text-3xl sm:text-4xl">{formatAr(product.price)}</span>
            {product.old_price && <span className="pb-1 text-slate-400 line-through">{formatAr(product.old_price)}</span>}
            {discount > 0 && <span className="mb-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">{t("product.save")} {discount}%</span>}
          </div>
          <p className="mt-5 text-slate-600" data-testid="product-description">{localized(product, "description", lang)}</p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Zap className="h-3.5 w-3.5" />{t("product.delivery")}</div>

          <div className="mt-8 hidden gap-3 sm:flex">
            <Button size="lg" className="h-12 flex-1 rounded-full text-base font-bold" onClick={buyNow} data-testid="buy-now-button">{t("product.buy")}</Button>
            <Button size="lg" variant="outline" className="h-12 rounded-full px-6" onClick={() => { if (tryAdd()) { toast.success(t("product.added")); setOpen(true); } }} data-testid="product-add-to-cart"><ShoppingBag className="mr-2 h-4 w-4" />{t("product.add")}</Button>
          </div>

          <div className="mt-10 rounded-2xl border border-slate-100 bg-white p-6">
            <h2 className="font-display text-lg font-bold text-slate-900">{t("product.howTitle")}</h2>
            <ol className="mt-4 space-y-3">
              {[t("product.how1"), t("product.how2"), t("product.how3")].map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-600"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>{s}</li>
              ))}
            </ol>
            <div className="mt-5 flex gap-2"><span className="rounded-md bg-[var(--mvola)] px-2 py-1 text-xs font-bold text-white">MVola</span><span className="rounded-md bg-[var(--orange)] px-2 py-1 text-xs font-bold text-white">Orange Money</span></div>
          </div>
        </div>
      </div>

      {product.related?.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-2xl font-bold text-slate-900">{t("product.related")}</h2>
          <div className="mt-5 grid grid-cols-2 items-stretch gap-4 md:grid-cols-4" data-testid="related-grid">{product.related.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}</div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-20 z-30 px-4 sm:hidden">
        <div className="glass mx-auto flex max-w-md items-center gap-3 rounded-full p-2 shadow-[0_8px_32px_rgba(15,23,42,0.14)]">
          <span className="pl-3 font-display text-lg font-bold text-slate-900">{formatAr(product.price)}</span>
          <Button className="ml-auto h-11 rounded-full px-6 font-bold" onClick={buyNow} data-testid="buy-now-mobile">{t("product.buy")}</Button>
        </div>
      </div>
    </div>
  );
}
