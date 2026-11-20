import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ShieldCheck, ShoppingBag, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, formatAr } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { addFeedback, useCart } from "@/context/CartContext";
import { useGames } from "@/context/GameContext";
import { ProductCard, productName } from "@/components/store/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { gameOf, productFigure, typeLabel, usePageMeta } from "@/lib/catalog";
import { SITE_URL, absoluteImage } from "@/lib/seo";

// PL-DS-V3 — fiche produit rebuild sur la structure EXACTE du prototype
// design-system-v3.html : .mgs-shell > .mgs-crumb + .mgs-grid--2 (media coloré
// u--bg--yellow à gauche ; eyebrow / mgs-title / mgs-price / description /
// boutons .button-main / trust à droite) + .mgs-buybar mobile + produits liés.
// Logique (ajout panier, achat direct, JSON-LD, usePageMeta) et testids inchangés.
function BtnMain({ testid, label, theme = "dark", accent = "yellow", onClick, disabled, children, className = "" }) {
  return (
    <button type="button" data-testid={testid} onClick={onClick} disabled={disabled} className={`button-main disabled:opacity-50 ${className}`.trim()} data-button-theme={theme} data-button-accent={accent}>
      <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={label}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{children}</span></span></span></span>
    </button>
  );
}

export default function Product() {
  const { slug } = useParams();
  const { t, lang } = useLang();
  const { add, setOpen, items } = useCart();
  const { games } = useGames();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [missing, setMissing] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const game = useMemo(() => (product ? games.find((g) => g.id === gameOf(product)) : null), [games, product]);
  const productNameValue = product ? productName(product, lang) : "";
  const productDescription = product
    ? localized(product, "description", lang)
      || (game?.name ? t("seo.productDescription", { game: game.name }) : t("seo.gamesDescription"))
    : undefined;
  const productJsonLd = useMemo(() => {
    if (!product) return undefined;
    const available = product.purchasable !== false;
    const url = `${SITE_URL}/produit/${product.slug}`;
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Product",
          name: productNameValue,
          description: productDescription,
          sku: product.slug,
          image: [absoluteImage(product.image_url)],
          brand: { "@type": "Brand", name: "Magic Game Store" },
          category: game?.name || undefined,
          offers: {
            "@type": "Offer",
            url,
            price: Number(product.price),
            priceCurrency: "MGA",
            availability: available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            seller: { "@type": "Organization", name: "Magic Game Store" },
          },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Magic Game Store", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: game?.name || t("catalog.title"), item: `${SITE_URL}/boutique${game ? `?game=${encodeURIComponent(game.id)}` : ""}` },
            { "@type": "ListItem", position: 3, name: productNameValue, item: url },
          ],
        },
      ],
    };
  }, [product, productNameValue, productDescription, game, t]);
  usePageMeta(productNameValue || null, productDescription, { jsonLd: productJsonLd });

  useEffect(() => {
    setProduct(null); setMissing(false); setImgOk(true);
    api.get(`/products/${slug}`).then((r) => setProduct(r.data)).catch(() => setMissing(true));
  }, [slug]);

  if (missing) {
    return (
      <section className="section"><div className="container"><div className="mgs-shell">
        <div className="py-24 text-center" data-testid="product-missing">
          <p className="num text-6xl">404</p>
          <p className="mgs-sub mt-4">{t("catalog.empty")}</p>
          <Link to="/boutique" className="button-main mt-6" data-button-theme="dark" data-button-accent="yellow"><span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("cart.browse")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("cart.browse")}</span></span></span></span></Link>
        </div>
      </div></div></section>
    );
  }
  if (!product) return <div className="container grid gap-6 py-8 lg:grid-cols-2"><Skeleton className="h-80 rounded-[18px]" /><Skeleton className="h-80 rounded-[18px]" /></div>;

  const { value, unit } = productFigure(product, game, lang);
  const available = product.purchasable !== false;
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  const tryAdd = (feedback) => { const r = add(product); if (!r.ok || feedback) addFeedback(r, t, toast, setOpen); return r.ok; };
  const buyNow = () => { if (items.some((i) => i.id === product.id) || tryAdd(false)) navigate("/commande"); };

  return (
    <section className="section">
      <div className="container">
        <div className="mgs-shell">
          <div className="mgs-crumb">
            <Link to={`/boutique?game=${gameOf(product)}`} data-testid="back-to-catalog">{game?.name || t("catalog.title")}</Link>
            <svg className="bold-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            <span>{productName(product, lang)}</span>
          </div>

          <div className="mgs-grid mgs-grid--2" style={{ alignItems: "start", gap: "2em" }}>
            {/* Media coloré (image réelle préférée au montant vedette). */}
            <div className="mgs-card__media u--bg--yellow" style={{ aspectRatio: "1/1", borderRadius: "1.5em", border: ".125em solid var(--color--dark)" }} data-testid="product-visual">
              {product.image_url && imgOk
                ? <img src={product.image_url} alt={productName(product, lang)} loading="lazy" onError={() => setImgOk(false)} className="max-h-full w-full object-contain p-6" data-testid="product-image" />
                : <p className="font-display leading-none" style={{ position: "relative", zIndex: 1 }}><span className="num" style={{ fontSize: "clamp(4rem,16vw,9rem)" }}>{value}</span> <span className="text-xl font-semibold uppercase" style={{ opacity: .6 }}>{unit}</span></p>}
            </div>

            <div>
              <p className="eyebrow" data-testid="product-game-type">{game?.name} · {typeLabel(game, product.type, lang)}</p>
              <h1 className="mgs-title" style={{ fontSize: "3.5em", margin: ".2em 0" }} data-testid="product-name">{productName(product, lang)}</h1>
              <p className="mgs-price" style={{ fontSize: "2.5em", margin: ".3em 0" }} data-testid="product-price">{formatAr(product.price, lang)}</p>
              {product.old_price && <p className="mgs-muted"><s>{formatAr(product.old_price, lang)}</s>{discount > 0 && <span className="mgs-chip" style={{ marginLeft: ".6em" }}>{t("product.save")} {discount}%</span>}</p>}
              {localized(product, "description", lang) && <p className="mgs-sub" style={{ fontSize: "1em" }} data-testid="product-description">{localized(product, "description", lang)}</p>}
              <div className="mgs-divider"></div>
              <div className="mgs-row" style={{ flexWrap: "wrap", gap: ".6em", margin: ".5em 0 1em" }}>
                <span className="mgs-chip"><Zap className="h-3.5 w-3.5" />{t("store.deliveryNote")}</span>
                <span className="mgs-chip"><ShieldCheck className="h-3.5 w-3.5" />MVola · Orange Money · USDT</span>
              </div>
              {!available && <p className="mgs-co-note" data-testid="product-unavailable">{t("product.unavailable")}</p>}
              <div className="mgs-row" style={{ flexWrap: "wrap", gap: ".75em" }}>
                <BtnMain testid="product-add-to-cart" label={t("product.add")} theme="dark" accent="yellow" onClick={() => tryAdd(true)} disabled={!available}><ShoppingBag className="mr-2 h-4 w-4" />{t("product.add")}</BtnMain>
                <BtnMain testid="buy-now-button" label={t("product.buy")} theme="light" accent="" onClick={buyNow} disabled={!available}>{t("product.buy")}</BtnMain>
              </div>
              <ol className="mgs-muted mt-8 grid gap-3 sm:grid-cols-3" style={{ fontSize: ".85em" }}>
                {[t("store.step1"), t("store.step2"), t("store.step3")].map((s, i) => (
                  <li key={s} className="flex items-center gap-2"><span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--color--dark)", color: "var(--color--light)", fontSize: ".8em" }}>{i + 1}</span>{s}</li>
                ))}
              </ol>
            </div>
          </div>

          {product.related?.length > 0 && (
            <section className="mt-16">
              <h2 className="mgs-section-h">{t("product.related")}</h2>
              <div className="mgs-grid mgs-grid--3 mt-5" data-testid="related-grid">{product.related.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}</div>
            </section>
          )}
        </div>
      </div>

      {/* Barre d'achat mobile fixe du prototype (.mgs-buybar). */}
      <div className="mgs-buybar sm:hidden">
        <span className="mgs-price">{formatAr(product.price, lang)}</span>
        <BtnMain testid="buy-now-mobile" label={t("product.buy")} theme="dark" accent="yellow" onClick={buyNow} disabled={!available} className="ml-auto">{t("product.buy")}</BtnMain>
      </div>
    </section>
  );
}