import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Gamepad2, Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { ProductCard } from "@/components/store/ProductCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import PackEvolutif from "@/pages/PackEvolutif";

const TYPES = [["", "all"], ["uc", "uc"], ["prime", "prime"], ["prime_plus", "prime_plus"]];

// Phase 3 — explicit game selection. `/boutique` without `?game=` always shows this
// picker: a game kept in localStorage never skips it. Only ACTIVE games are listed
// (GameContext already filters `active !== false` and sorts by `sort_order`).
function GamePicker({ games, onPick }) {
  const { t } = useLang();
  // Logo fallback: a missing OR broken `icon_url` falls back to the design-system icon.
  const [broken, setBroken] = useState({});
  return (
    <div className="pb-24 pt-6" data-testid="game-picker">
      <div className="border-b pb-4">
        <p className="eyebrow">{t("games.eyebrow")}</p>
        <h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{t("games.pickTitle")}</h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">{t("games.pickSubtitle")}</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="game-picker-grid">
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g)}
            data-testid={`game-pick-${g.slug || g.id}`}
            className="card-lift group flex items-center gap-4 rounded-[14px] border bg-card p-4 text-left sm:p-5"
          >
            <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-[#0A0A0A]">
              {g.icon_url && !broken[g.id] ? (
                <img src={g.icon_url} alt="" className="h-full w-full object-cover" loading="lazy"
                  onError={() => setBroken((b) => ({ ...b, [g.id]: true }))} />
              ) : (
                <Gamepad2 className="h-7 w-7" strokeWidth={2} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-lg font-bold uppercase leading-tight text-foreground">{g.name}</span>
              {g.description && <span className="mt-1 block truncate text-[12px] text-muted-foreground">{g.description}</span>}
            </span>
          </button>
        ))}
      </div>
      {games.length === 0 && <p className="mt-10 text-center text-muted-foreground" data-testid="game-picker-empty">{t("games.empty")}</p>}
    </div>
  );
}

export default function Catalog() {
  const { t } = useLang();
  const { games, selectGame } = useGames();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const game = params.get("game") || "";
  const type = params.get("type") || "";
  const q = params.get("q") || "";
  const sort = params.get("sort") || "default";
  const popular = params.get("popular") === "1";
  const minPrice = params.get("min") || "";
  const maxPrice = params.get("max") || "";

  const update = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!game) return;  // no game selected yet: the picker is shown, nothing to fetch
    const id = setTimeout(() => {
      setProducts(null);
      api.get("/products", { params: { game, type: type || undefined, q: q || undefined, sort, popular: popular || undefined, min_price: minPrice || undefined, max_price: maxPrice || undefined } })
        .then((r) => setProducts(r.data)).catch(() => setProducts([]));
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [game, type, q, sort, popular, minPrice, maxPrice]);

  const activeType = useMemo(() => (type.includes(",") ? "prime" : type), [type]);
  const currentGame = useMemo(() => games.find((g) => g.id === game) || null, [games, game]);

  // No `?game=` → explicit selection page. An unknown/inactive game id falls back to it too.
  if (!game || (games.length > 0 && !currentGame)) {
    return <GamePicker games={games} onPick={(g) => { selectGame(g.id); setParams({ game: g.id }, { replace: true }); }} />;
  }

  return (
    <div className="pb-24 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">{currentGame?.name || t("games.title")}</p><h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{t("catalog.title")}</h1></div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input data-testid="catalog-search" value={q} onChange={(e) => update({ q: e.target.value })} placeholder={t("catalog.search")} className="h-11 rounded-full pl-9" />
          {q && <button data-testid="catalog-search-clear" onClick={() => update({ q: "" })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <div className="no-scrollbar flex w-full gap-2 overflow-x-auto sm:w-auto sm:min-w-0 sm:flex-1" role="tablist" data-testid="type-tabs">
          {TYPES.map(([value, key]) => (
            <button key={key} role="tab" data-testid={`type-tab-${key}`} onClick={() => update({ type: value })}
              className={`shrink-0 border border-foreground px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] transition-colors ${activeType === value || (value === "prime" && type.startsWith("prime,")) ? "bg-primary text-[#0A0A0A]" : "bg-card text-muted-foreground hover:bg-foreground hover:text-background"}`}>
              {t(`catalog.${key}`)}
            </button>
          ))}
          <button data-testid="filter-popular" onClick={() => update({ popular: popular ? "" : "1" })} className={`shrink-0 border border-foreground px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] transition-colors ${popular ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-foreground hover:text-background"}`}>{t("catalog.popular")}</button>
          <Button variant="outline" role="tab" aria-selected={activeType === "evo"} data-testid="type-tab-evo" onClick={() => update({ type: "evo", popular: "" })}
            className={`h-auto shrink-0 rounded-none border border-foreground px-4 py-2 text-[11px] font-black uppercase tracking-[0.1em] shadow-none transition-colors ${activeType === "evo" ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-card text-muted-foreground hover:bg-foreground hover:text-background"}`}>
            {t("nav.evo")}
          </Button>
        </div>
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShowFilters((s) => !s)} data-testid="toggle-filters"><SlidersHorizontal className="mr-1 h-4 w-4" />{t("catalog.filters")}</Button>
          <Select value={sort} onValueChange={(v) => update({ sort: v === "default" ? "" : v })}>
            <SelectTrigger className="h-9 w-44 rounded-full" data-testid="sort-select"><SelectValue placeholder={t("catalog.sort")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t("catalog.sortDefault")}</SelectItem>
              <SelectItem value="price_asc">{t("catalog.priceAsc")}</SelectItem>
              <SelectItem value="price_desc">{t("catalog.priceDesc")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showFilters && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-100 bg-white p-4" data-testid="price-filters">
          <label className="text-sm font-semibold text-slate-600">{t("catalog.price")} ({t("catalog.min")})<Input data-testid="filter-min" type="number" value={minPrice} onChange={(e) => update({ min: e.target.value })} className="mt-1 w-36 rounded-xl" placeholder="0" /></label>
          <label className="text-sm font-semibold text-slate-600">{t("catalog.price")} ({t("catalog.max")})<Input data-testid="filter-max" type="number" value={maxPrice} onChange={(e) => update({ max: e.target.value })} className="mt-1 w-36 rounded-xl" placeholder="800000" /></label>
          <Button variant="ghost" size="sm" data-testid="filter-reset" onClick={() => setParams({}, { replace: true })}>{t("catalog.reset")}</Button>
        </div>
      )}

      <p className="mt-8 eyebrow" data-testid="results-count">{products ? `${products.length} ${t("catalog.results")}` : t("common.loading")}</p>
      {type === "evo" ? <PackEvolutif embedded products={products} /> : <>
      <div className="mt-3 grid grid-cols-2 items-stretch gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="catalog-grid">
        {products === null && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        {products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
      </div>
      {products?.length === 0 && (
        <div className="mt-10 text-center" data-testid="catalog-empty">
          <p className="text-slate-500">{t("catalog.emptyGame")}</p>
          {currentGame?.description && <p className="mt-1 text-sm text-muted-foreground">{currentGame.description}</p>}
          {currentGame && (
            <Button asChild variant="outline" className="mt-4 rounded-full" data-testid="catalog-empty-back">
              <Link to="/boutique">{t("games.select")}</Link>
            </Button>
          )}
        </div>
      )}
      </>}
    </div>
  );
}
