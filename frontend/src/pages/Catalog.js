import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { ProductCard } from "@/components/store/ProductCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const TYPES = [["", "all"], ["uc", "uc"], ["prime", "prime"], ["prime_plus", "prime_plus"]];

export default function Catalog() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
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
    const id = setTimeout(() => {
      setProducts(null);
      api.get("/products", { params: { type: type || undefined, q: q || undefined, sort, popular: popular || undefined, min_price: minPrice || undefined, max_price: maxPrice || undefined } })
        .then((r) => setProducts(r.data)).catch(() => setProducts([]));
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [type, q, sort, popular, minPrice, maxPrice]);

  const activeType = useMemo(() => (type.includes(",") ? "prime" : type), [type]);

  return (
    <div className="pb-24 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">PUBG Mobile</p><h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{t("catalog.title")}</h1></div>
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
      <div className="mt-3 grid grid-cols-2 items-stretch gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="catalog-grid">
        {products === null && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        {products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
      </div>
      {products?.length === 0 && <p className="mt-10 text-center text-slate-500" data-testid="catalog-empty">{t("catalog.empty")}</p>}
    </div>
  );
}
