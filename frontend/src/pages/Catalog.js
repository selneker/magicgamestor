import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { ProductCard } from "@/components/store/ProductCard";
import { GameLogo, BackToTop } from "@/pages/Home";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import PackEvolutif from "@/pages/PackEvolutif";
import { usePageMeta } from "@/lib/catalog";
import { useFavorites } from "@/lib/favorites";

const tab = (active) => `shrink-0 rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${active ? "border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]" : "bg-card text-muted-foreground hover:bg-foreground hover:text-background"}`;

// `/boutique` without `?game=` always shows this picker; only backend-authorized games are listed.
function GamePicker({ games, onPick }) {
  const { t } = useLang();
  usePageMeta(t("games.pickTitle"));
  return (
    <div className="pb-24 pt-6" data-testid="game-picker">
      <div className="border-b pb-5">
        <p className="eyebrow">{t("games.eyebrow")}</p>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-tight sm:text-5xl">{t("games.pickTitle")}</h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">{t("games.pickSubtitle")}</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="game-picker-grid">
        {games.map((g) => (
          <button key={g.id} type="button" onClick={() => onPick(g)} data-testid={`game-pick-${g.slug || g.id}`}
            className="card-lift group flex min-h-[160px] flex-col justify-between rounded-[16px] border bg-card p-5 text-left">
            <span className="flex w-full items-start justify-between"><GameLogo game={g} className="h-14 w-14" /><ArrowUpRight className="h-5 w-5 text-muted-foreground" /></span>
            <span className="mt-6 block">
              <span className="block truncate font-display text-xl font-bold uppercase leading-tight">{g.name}</span>
              {g.description && <span className="mt-1 block truncate text-xs text-muted-foreground">{g.description}</span>}
            </span>
          </button>
        ))}
      </div>
      {games.length === 0 && <p className="mt-10 text-center text-muted-foreground" data-testid="game-picker-empty">{t("games.empty")}</p>}
    </div>
  );
}

function GameBanner({ game, games, onSwitch }) {
  const { t } = useLang();
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto]" data-testid="catalog-game-banner">
      <div className="flex items-center gap-4 rounded-[16px] border bg-card p-4 sm:p-6">
        <GameLogo game={game} className="h-16 w-16 sm:h-20 sm:w-20" />
        <div className="min-w-0">
          <p className="eyebrow">{t("store.catalogFor")}</p>
          <h1 className="truncate font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl" data-testid="catalog-game-name">{game.name}</h1>
          {game.currency_label && <p className="mt-1 text-xs text-muted-foreground">{game.currency_label}</p>}
        </div>
      </div>
      {games.length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-[16px] border bg-card p-3 md:flex-col md:justify-center" data-testid="catalog-game-switch">
          {games.filter((g) => g.id !== game.id).map((g) => (
            <button key={g.id} type="button" onClick={() => onSwitch(g)} data-testid={`catalog-switch-${g.id}`} className="flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold transition-colors hover:bg-primary hover:text-[#0A0A0A]">
              <GameLogo game={g} className="h-7 w-7 rounded-full" />{g.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Catalog() {
  const { t, lang } = useLang();
  const { games, selectGame } = useGames();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
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
  usePageMeta(currentGame ? `${currentGame.name} — ${t("catalog.title")}` : null);

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
        .then((r) => setProducts(r.data)).catch(() => setProducts([]));
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

  if (!game || (games.length > 0 && !currentGame)) {
    return <GamePicker games={games} onPick={(g) => { selectGame(g.id); setParams({ game: g.id }, { replace: true }); }} />;
  }

  return (
    <div className="pb-24 pt-6">
      {currentGame && <GameBanner game={currentGame} games={games} onSwitch={(g) => { selectGame(g.id); setParams({ game: g.id }, { replace: true }); }} />}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto" role="tablist" data-testid="type-tabs">
          <button role="tab" aria-selected={!type} data-testid="type-tab-all" onClick={() => update({ type: "" })} className={tab(!type)}>{t("catalog.all")}</button>
          {types.map((pt) => (
            <button key={pt.key} role="tab" aria-selected={activeTypes.includes(pt.key)} data-testid={`type-tab-${pt.key}`} onClick={() => update({ type: pt.key })} className={tab(activeTypes.length === 1 && activeTypes[0] === pt.key)}>
              {(lang === "en" && pt.label_en) || pt.label}
            </button>
          ))}
          {hasEvo && <button role="tab" aria-selected={type === "evo"} data-testid="type-tab-evo" onClick={() => update({ type: "evo", popular: "" })} className={tab(type === "evo")}>{t("nav.evo")}</button>}
          <button data-testid="filter-popular" aria-pressed={popular} onClick={() => update({ popular: popular ? "" : "1" })} className={tab(popular)}>{t("catalog.popular")}</button>
          <button data-testid="filter-favorites" aria-pressed={favorites} onClick={() => update({ favorites: favorites ? "" : "1" })} className={tab(favorites)}>{t("catalog.favorites")}</button>
        </div>
        <div className="flex w-full items-center gap-2 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input data-testid="catalog-search" aria-label={t("catalog.search")} value={q} onChange={(e) => update({ q: e.target.value })} placeholder={t("catalog.search")} className="h-10 rounded-full pl-9" />
            {q && <button data-testid="catalog-search-clear" aria-label="clear" onClick={() => update({ q: "" })} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button>}
          </div>
          <Button variant="outline" size="sm" className="h-10 shrink-0 rounded-full" onClick={() => setShowFilters((s) => !s)} data-testid="toggle-filters" aria-expanded={showFilters}><SlidersHorizontal className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{t("catalog.filters")}</span></Button>
          <Select value={sort} onValueChange={(v) => update({ sort: v === "default" ? "" : v })}>
            <SelectTrigger className="h-10 w-36 shrink-0 rounded-full sm:w-44" data-testid="sort-select"><SelectValue placeholder={t("catalog.sort")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="price_asc">{t("catalog.priceAsc")}</SelectItem>
              <SelectItem value="unit_price">{t("catalog.unitPrice")}</SelectItem>
              <SelectItem value="price_desc">{t("catalog.priceDesc")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showFilters && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-end gap-3 border bg-card p-4 pb-safe shadow-[0_-8px_24px_hsl(0_0%_4%_/_0.18)] lg:static lg:mt-4 lg:rounded-[14px] lg:p-4 lg:shadow-none" data-testid="price-filters">
          <label className="text-sm font-semibold">{t("catalog.price")} ({t("catalog.min")})<Input data-testid="filter-min" type="number" min="0" value={minPrice} onChange={(e) => update({ min: e.target.value })} className="mt-1 w-36" placeholder="0" /></label>
          <label className="text-sm font-semibold">{t("catalog.price")} ({t("catalog.max")})<Input data-testid="filter-max" type="number" min="0" value={maxPrice} onChange={(e) => update({ max: e.target.value })} className="mt-1 w-36" placeholder="800000" /></label>
          <Button variant="ghost" size="sm" data-testid="filter-reset" onClick={() => setParams({ game }, { replace: true })}>{t("catalog.reset")}</Button>
        </div>
      )}

      <p className="mt-8 eyebrow" data-testid="results-count" aria-live="polite">{products ? `${products.length} ${t("catalog.results")}` : t("common.loading")}</p>
      {type === "evo" ? <PackEvolutif embedded products={products} /> : <>
        <div className="mt-3 grid grid-cols-1 items-stretch gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" data-testid="catalog-grid">
          {products === null && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="min-h-44 rounded-[20px]" />)}
          {visibleProducts?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
        {products?.length === 0 && (
          <div className="mt-6 rounded-[16px] border border-dashed bg-card p-10 text-center" data-testid="catalog-empty">
            <p className="font-display text-lg font-bold">{t("catalog.empty")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
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
