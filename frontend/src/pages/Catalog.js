import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { ProductCard } from "@/components/store/ProductCard";
import { GameLogo, BackToTop } from "@/pages/Home";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import PackEvolutif from "@/pages/PackEvolutif";
import { usePageMeta, currencyOf } from "@/lib/catalog";
import { useFavorites } from "@/lib/favorites";

const tab = (active) => `game-tab${active ? " is--active" : ""} min-h-11 min-w-11 inline-flex items-center`;

function ProductSection({ id, title, products, popularIds, bestUnitId }) {
  if (!products?.length) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="section-head"><h2 id={`${id}-title`} className="h-l">{title}</h2></div>
      <div className="packs-grid">
        {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} displayPopular={popularIds.has(p.id)} bestUnitPrice={p.id === bestUnitId} />)}
      </div>
    </section>
  );
}

// `/boutique` without `?game=` always shows this picker; only backend-authorized games are listed.
const GAME_MEDIA = ["yellow", "orange", "blue", "green", "violet", "purple"];
function GamePicker({ games, onPick }) {
  const { t } = useLang();
  usePageMeta(t("seo.catalogTitle"), t("seo.gamesDescription"));
  // PL-DS-V3 — sélecteur de jeu du prototype boutique : fil d'Ariane, mgs-head
  // (mgs-title « Choisissez votre jeu »), grille mgs-grid--2 de cartes mgs-game
  // (media coloré u--bg--*, icône, nom, description, chips de types, CTA).
  return (
    <section className="section">
      <div className="container">
        <div className="mgs-shell" data-testid="game-picker">
          <div className="mgs-crumb">
            <Link to="/">{t("games.crumbHome")}</Link>
            <svg className="bold-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            <span>{t("nav.shop")}</span>
          </div>
          <div className="mgs-head">
            <p className="eyebrow">{t("games.eyebrow")}</p>
            <h1 className="mgs-title">{t("games.pickTitle")}</h1>
            <p className="mgs-sub">{t("games.pickSubtitle")}</p>
          </div>
          <div className="mgs-grid mgs-grid--2" data-testid="game-picker-grid">
            {games.map((g, i) => (
              <div key={g.id} className="mgs-game" role="button" tabIndex={0} data-testid={`game-pick-${g.slug || g.id}`}
                aria-label={`${t("games.viewOffers")} — ${g.name}`} onClick={() => onPick(g)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(g); } }}>
                <div className={`mgs-game__media u--bg--${GAME_MEDIA[i % GAME_MEDIA.length]}`}>
                  {g.icon_url
                    ? <img src={g.icon_url} alt="" className="h-[3.4em] w-[3.4em] object-contain" loading="lazy" />
                    : <Icon name="manette" className="bold-ic" />}
                </div>
                <div className="mgs-game__body">
                  <h2 className="mgs-game__name">{g.name}</h2>
                  {g.description && <p className="mgs-game__desc">{g.description}</p>}
                  {(g.product_types || []).length > 0 && (
                    <div className="mgs-chips">{g.product_types.slice(0, 3).map((pt) => <span key={pt.key} className="mgs-chip">{pt.label}</span>)}</div>
                  )}
                  <span className="button-main" data-button-theme="dark" data-button-accent="yellow" aria-hidden="true">
                    <span className="button-main-inner full-h"><span className="button-main-inner__back" data-text={t("games.viewOffers")}></span><span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("games.viewOffers")}</span></span></span></span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          {games.length === 0 && <p className="mgs-sub" data-testid="game-picker-empty">{t("games.empty")}</p>}
        </div>
      </div>
    </section>
  );
}

function GameBanner({ game, games, onSwitch }) {
  const { t } = useLang();
  return (
    <div className="game-hero" data-testid="catalog-game-banner" style={{ marginBottom: "1.4em", flexWrap: "wrap" }}>
      <GameLogo game={game} className="h-[4.5em] w-[4.5em] rounded-[1em]" />
      <div className="game-hero__meta">
        <p className="eyebrow">{t("store.catalogFor")}</p>
        <h1 className="h-l" data-testid="catalog-game-name">{game.name}</h1>
        {game.currency_label && <p className="p-m">{game.currency_label}</p>}
        {games.length > 1 && (
          <div className="game-hero__stats" data-testid="catalog-game-switch">
            {games.filter((g) => g.id !== game.id).map((g) => (
              <button key={g.id} type="button" onClick={() => onSwitch(g)} data-testid={`catalog-switch-${g.id}`} className="chip min-h-11">
                <GameLogo game={g} className="h-[1.6em] w-[1.6em] rounded-full" />{g.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Catalog() {
  const { t, lang } = useLang();
  const { games, selectGame } = useGames();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [productsError, setProductsError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [favoriteIds] = useFavorites();
  const game = params.get("game") || "";
  const type = params.get("type") || "";
  const q = params.get("q") || "";
  const sort = params.get("sort") || "price_asc";
  const popular = params.get("popular") === "1";
  const favorites = params.get("favorites") === "1";
  const minPrice = params.get("min") || "";
  const maxPrice = params.get("max") || "";
  const currentGame = useMemo(() => games.find((g) => g.id === game) || null, [games, game]);
  // Libellé monétaire du jeu pour les titres (« Packs Diamants », « Prix par CP »…) ;
  // « UC » seulement en dernier recours si le jeu n'a pas de monnaie configurée (comportement historique PUBG).
  const currencyLabel = currencyOf(currentGame) || "UC";
  usePageMeta(
    currentGame ? `${currentGame.name} — ${t("catalog.title")}` : t("seo.catalogTitle"),
    currentGame ? t("seo.catalogDescription", { game: currentGame.name }) : t("seo.gamesDescription"),
  );

  const update = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!game) return;
    const id = setTimeout(() => {
      setProducts(null);
      api.get("/products", { params: { game, type: type || undefined, q: q || undefined, sort, popular: popular || undefined, favorites: favorites || undefined, min_price: minPrice || undefined, max_price: maxPrice || undefined } })
        .then((r) => setProducts(r.data)).catch(() => { setProducts([]); setProductsError(t("common.error")); })
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [game, type, q, sort, popular, favorites, minPrice, maxPrice]);

  // Type tabs come from the game's own configuration; the evolving pack keeps its dedicated view.
  const types = (currentGame?.product_types || []).filter((pt) => pt.key !== "evo");
  const hasEvo = (currentGame?.product_types || []).some((pt) => pt.key === "evo");
  const activeTypes = type.split(",").filter(Boolean);
  const visibleProducts = useMemo(() => {
    if (!products) return null;
    let filteredProducts = products;
    if (favorites) {
      filteredProducts = products.filter(p => favoriteIds.includes(p.id));
    }
    if (!filteredProducts) return null;
    if (sort === "unit_price") {
      return [...filteredProducts].sort((a, b) => {
        const aUnit = a.uc_amount ? a.price / a.uc_amount : Number.POSITIVE_INFINITY;
        const bUnit = b.uc_amount ? b.price / b.uc_amount : Number.POSITIVE_INFINITY;
        return aUnit - bUnit;
      });
    }
    return filteredProducts;
  }, [products, sort, favorites, favoriteIds]);

  const popularIds = useMemo(() => new Set((visibleProducts || []).filter((p) => p.popular === true).slice(0, 3).map((p) => p.id)), [visibleProducts]);

  // Compute badge for each product based on priority and limits
  const productsWithBadge = useMemo(() => {
    if (!visibleProducts) return null;

    // Step 2: compute best price/UC among UC products
    const ucProducts = visibleProducts.filter(p => p.uc_amount);
    let bestPriceUC = null;
    if (ucProducts.length > 0) {
      bestPriceUC = Math.min(...ucProducts.map(p => p.price / p.uc_amount));
    }
    // Step 3: assign badges in priority order
    return visibleProducts.map((p, idx) => {
      let badge = null;
      // Popular badge (max 3) — popularIds est la source unique de verite
      if (p.popular && popularIds.has(p.id)) {
        badge = "popular";
      } else {
        // Best price/UC badge (only for UC products)
        if (p.uc_amount && bestPriceUC !== null) {
          const priceUC = p.price / p.uc_amount;
          if (Math.abs(priceUC - bestPriceUC) < 0.01) { // tolerance for floating point
            badge = "best";
          }
        }
        // New/Hot badge (only if no higher priority badge)
        if (!badge && p.badge) {
          const badgeLower = p.badge.toLowerCase();
          if (badgeLower === "new") {
            badge = "new";
          } else if (badgeLower === "promo") {
            badge = "hot";
          }
        }
      }
      return { product: p, badge };
    });
  }, [visibleProducts, popularIds]);
  const bestUnitId = useMemo(() => {
    const candidates = (visibleProducts || []).filter((p) => Number(p.uc_amount) > 0);
    return candidates.sort((a, b) => (a.price / a.uc_amount) - (b.price / b.uc_amount))[0]?.id;
  }, [visibleProducts]);
  const sectioned = !type && !q && !popular && !minPrice && !maxPrice;
  const sections = useMemo(() => {
    if (!sectioned || !visibleProducts) return null;
    const featured = visibleProducts.filter((p) => popularIds.has(p.id));
    const featuredIds = new Set(featured.map((p) => p.id));
    const remaining = visibleProducts.filter((p) => !featuredIds.has(p.id));
    return {
      featured,
      uc: remaining
        .filter((p) => Number(p.uc_amount) > 0 && p.type !== "evo" && !["prime", "prime_plus"].includes(p.type))
        .sort((a, b) => Number(a.uc_amount) - Number(b.uc_amount)),
      prime: remaining.filter((p) => ["prime", "prime_plus"].includes(p.type)),
      evo: remaining.filter((p) => p.type === "evo"),
    };
  }, [sectioned, visibleProducts, popularIds]);

  if (!game || (games.length > 0 && !currentGame)) {
    return <GamePicker games={games} onPick={(g) => { selectGame(g.id); setParams({ game: g.id }, { replace: true }); }} />;
  }

  return (
    <div className="container section page-top page-bottom" style={{ maxWidth: "78em" }}>
      {currentGame && <GameBanner game={currentGame} games={games} onSwitch={(g) => { selectGame(g.id); setParams({ game: g.id }, { replace: true }); }} />}

      <div className="game-tabs" role="tablist" aria-label={t("catalog.all")} data-testid="type-tabs" style={{ marginBottom: "1.2em" }}>
        <button role="tab" aria-selected={!type} data-testid="type-tab-all" onClick={() => update({ type: "" })} className={tab(!type)}>{t("catalog.all")}</button>
        {types.map((pt) => (
          <button key={pt.key} role="tab" aria-selected={activeTypes.includes(pt.key)} data-testid={`type-tab-${pt.key}`} onClick={() => update({ type: pt.key })} className={tab(activeTypes.length === 1 && activeTypes[0] === pt.key)}>
            {(lang === "en" && pt.label_en) || pt.label}
          </button>
        ))}
        {hasEvo && <button role="tab" aria-selected={type === "evo"} data-testid="type-tab-evo" onClick={() => update({ type: "evo", popular: "" })} className={tab(type === "evo")}>{t("nav.evo")}</button>}
        <button data-testid="filter-popular" aria-pressed={popular} onClick={() => update({ popular: popular ? "" : "1" })} className={tab(popular)}>{t("catalog.popular")}</button>
      </div>

      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: "1.4em" }}>
        <div className="relative min-w-0 flex-1" style={{ maxWidth: "22em" }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "hsl(0 0% 7% / .5)" }} aria-hidden="true" />
          <input data-testid="catalog-search" aria-label={t("catalog.search")} value={q} onChange={(e) => update({ q: e.target.value })} placeholder={t("catalog.search")} className="form-field w-full pl-9" />
          {q && <button data-testid="catalog-search-clear" aria-label="clear" onClick={() => update({ q: "" })} className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11" style={{ color: "hsl(0 0% 7% / .6)" }}><X className="h-4 w-4" /></button>}
        </div>
        <Button variant="outline" size="sm" className="h-11 min-w-11 shrink-0 rounded-full" onClick={() => setShowFilters((s) => !s)} data-testid="toggle-filters" aria-expanded={showFilters}><SlidersHorizontal className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{t("catalog.filters")}</span></Button>
        <Select value={sort} onValueChange={(v) => update({ sort: v === "default" ? "" : v })}>
          <SelectTrigger className="h-11 w-36 shrink-0 rounded-full sm:w-44" data-testid="sort-select"><SelectValue placeholder={t("catalog.sort")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="price_asc">{t("catalog.priceAsc")}</SelectItem>
            <SelectItem value="unit_price">{t("catalog.unitPrice", { label: currencyLabel })}</SelectItem>
            <SelectItem value="price_desc">{t("catalog.priceDesc")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showFilters && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-end gap-3 border bg-card p-4 pb-safe shadow-[0_-8px_24px_hsl(0_0%_4%_/_0.18)] lg:static lg:mt-4 lg:rounded-[14px] lg:p-4 lg:shadow-none" data-testid="price-filters">
          <label className="text-sm font-semibold">{t("catalog.price")} ({t("catalog.min")})<Input data-testid="filter-min" type="number" min="0" value={minPrice} onChange={(e) => update({ min: e.target.value })} className="mt-1 w-36" placeholder="0" /></label>
          <label className="text-sm font-semibold">{t("catalog.price")} ({t("catalog.max")})<Input data-testid="filter-max" type="number" min="0" value={maxPrice} onChange={(e) => update({ max: e.target.value })} className="mt-1 w-36" placeholder="800000" /></label>
          <Button variant="ghost" size="sm" data-testid="filter-reset" onClick={() => setParams({ game }, { replace: true })}>{t("catalog.reset")}</Button>
        </div>
      )}

      <p className="eyebrow" style={{ marginTop: "1.4em", marginBottom: "1em" }} data-testid="results-count" aria-live="polite">{products ? `${products.length} ${t("catalog.results")}` : t("common.loading")}</p>
      {productsError && <p className="mt-4 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground" data-testid="catalog-error">{productsError}</p>}
      {type === "evo" ? <PackEvolutif embedded products={products} /> : <>
        {sectioned && products === null ? <div className="packs-grid" data-testid="catalog-grid">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="min-h-44 rounded-[20px]" />)}</div> : sectioned ? <div className="space-y-10" data-testid="catalog-sections">
          <ProductSection id="popular" title={t("catalog.popularSection")} products={sections?.featured} popularIds={popularIds} bestUnitId={bestUnitId} />
          <ProductSection id="packs-uc" title={t("catalog.ucSection", { label: currencyLabel })} products={sections?.uc} popularIds={popularIds} bestUnitId={bestUnitId} />
          <ProductSection id="prime" title={t("catalog.primeSection")} products={sections?.prime} popularIds={popularIds} bestUnitId={bestUnitId} />
          <ProductSection id="packs-evolutifs" title={t("catalog.evoSection")} products={sections?.evo} popularIds={popularIds} bestUnitId={bestUnitId} />
        </div> : <div className="packs-grid" data-testid="catalog-grid">
          {products === null && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="min-h-44 rounded-[20px]" />)}
          {productsWithBadge?.map(({ product, badge }, i) => <ProductCard key={product.id} product={product} index={i} badge={badge} />)}
        </div>}
        {products?.length === 0 && (
          <div className="trust-card" style={{ marginTop: "1.5em", alignItems: "center", textAlign: "center", padding: "2.5em" }} data-testid="catalog-empty">
            <p className="h-c">{t("catalog.empty")}</p>
            <div className="flex flex-wrap justify-center gap-2" style={{ marginTop: "1em" }}>
              <Button variant="outline" className="rounded-full" data-testid="catalog-empty-reset" onClick={() => setParams({ game }, { replace: true })}>{t("catalog.reset")}</Button>
              <Button asChild variant="ghost" className="rounded-full" data-testid="catalog-empty-back"><Link to="/boutique">{t("store.switchGame")}</Link></Button>
            </div>
          </div>
        )}
      </>}
      <BackToTop />
    </div>
  );
}
