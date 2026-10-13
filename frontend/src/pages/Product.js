import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ShieldCheck, ShoppingBag, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, formatAr } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { addFeedback, useCart } from "@/context/CartContext";
import { useGames } from "@/context/GameContext";
import { ProductCard, productName } from "@/components/store/ProductCard";
import { GameLogo } from "@/pages/Home";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gameOf, productFigure, typeLabel, usePageMeta } from "@/lib/catalog";

export default function Product() {
  const { slug } = useParams();
  const { t, lang } = useLang();
  const { add, setOpen, items } = useCart();
  const { games } = useGames();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [missing, setMissing] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  usePageMeta(product ? productName(product, lang) : null, product ? localized(product, "description", lang) : undefined);

  useEffect(() => {
    setProduct(null); setMissing(false); setImgOk(true);
    api.get(`/products/${slug}`).then((r) => setProduct(r.data)).catch(() => setMissing(true));
  }, [slug]);

  if (missing) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center" data-testid="product-missing">
        <p className="num text-6xl">404</p>
        <p className="mt-4 text-muted-foreground">{t("catalog.empty")}</p>
        <Button asChild className="mt-6 rounded-full"><Link to="/boutique">{t("cart.browse")}</Link></Button>
      </div>
    );
  }
  if (!product) return <div className="grid gap-6 py-8 lg:grid-cols-2"><Skeleton className="h-80 rounded-[18px]" /><Skeleton className="h-80 rounded-[18px]" /></div>;

  const game = games.find((g) => g.id === gameOf(product));
  const { value, unit } = productFigure(product, game, lang);
  const available = product.purchasable !== false;
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const tryAdd = (feedback) => { const r = add(product); if (!r.ok || feedback) addFeedback(r, t, toast, setOpen); return r.ok; };
  const buyNow = () => { if (items.some((i) => i.id === product.id) || tryAdd(false)) navigate("/commande"); };

  return (
    <div className="pb-32 pt-4">
      <Link to={`/boutique?game=${gameOf(product)}`} data-testid="back-to-catalog" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" />{game?.name || t("catalog.title")}</Link>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="grain relative flex min-h-[320px] flex-col justify-between overflow-hidden rounded-[18px] border bg-card p-6 sm:p-10" data-testid="product-visual">
          <div className="flex items-start justify-between gap-3">
            {game && <GameLogo game={game} className="h-14 w-14" />}
            {product.popular && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0A0A0A]">{t("common.popular")}</span>}
          </div>
          {product.image_url && imgOk
            ? <img src={product.image_url} alt={productName(product, lang)} loading="lazy" onError={() => setImgOk(false)} className="mx-auto max-h-[300px] w-full object-contain py-6" data-testid="product-image" />
            : <p className="py-8 font-display leading-none"><span className="num text-[clamp(4rem,16vw,9rem)]">{value}</span> <span className="text-xl font-semibold uppercase text-muted-foreground">{unit}</span></p>}
          <p className="eyebrow">{typeLabel(game, product.type, lang)}</p>
        </div>
        <div className="rounded-[18px] border bg-card p-6 sm:p-10">
          <p className="eyebrow" data-testid="product-game-type">{game?.name} · {typeLabel(game, product.type, lang)}</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl" data-testid="product-name">{productName(product, lang)}</h1>
          <div className="mt-6 flex flex-wrap items-end gap-3">
            <span data-testid="product-price" className="num text-4xl sm:text-5xl">{formatAr(product.price)}</span>
            {product.old_price && <span className="pb-1 text-muted-foreground line-through">{formatAr(product.old_price)}</span>}
            {discount > 0 && <span className="mb-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-[#0A0A0A]">{t("product.save")} {discount}%</span>}
          </div>
          {localized(product, "description", lang) && <p className="mt-5 text-sm leading-relaxed text-muted-foreground" data-testid="product-description">{localized(product, "description", lang)}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"><Zap className="h-3.5 w-3.5" />{t("store.deliveryNote")}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5" />MVola · Orange Money · USDT</span>
          </div>
          {!available && <p className="mt-6 rounded-[12px] border border-dashed p-3 text-sm font-semibold" data-testid="product-unavailable">{t("product.unavailable")}</p>}
          <div className="mt-8 hidden gap-3 sm:flex">
            <Button size="lg" disabled={!available} className="h-12 flex-1 rounded-full text-base font-bold" onClick={buyNow} data-testid="buy-now-button">{t("product.buy")}</Button>
            <Button size="lg" disabled={!available} variant="outline" className="h-12 rounded-full px-6" onClick={() => tryAdd(true)} data-testid="product-add-to-cart"><ShoppingBag className="mr-2 h-4 w-4" />{t("product.add")}</Button>
          </div>
          <ol className="mt-10 grid gap-3 border-t pt-6 sm:grid-cols-3">
            {[t("store.step1"), t("store.step2"), t("store.step3")].map((s, i) => (
              <li key={s} className="flex items-center gap-2 text-sm"><span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-[#0A0A0A]">{i + 1}</span>{s}</li>
            ))}
          </ol>
        </div>
      </div>

      {product.related?.length > 0 && (
        <section className="mt-16">
          <h2 className="border-b pb-3 font-display text-2xl font-bold">{t("product.related")}</h2>
          <div className="mt-5 grid grid-cols-2 items-stretch gap-3 md:grid-cols-4" data-testid="related-grid">{product.related.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}</div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-20 z-30 px-4 sm:hidden">
        <div className="glass mx-auto flex max-w-md items-center gap-3 rounded-full border p-2">
          <span className="pl-3 font-display text-lg font-bold">{formatAr(product.price)}</span>
          <Button disabled={!available} className="ml-auto h-11 rounded-full px-6 font-bold" onClick={buyNow} data-testid="buy-now-mobile">{t("product.buy")}</Button>
        </div>
      </div>
    </div>
  );
}
