import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, CalendarRange, Loader2, Lock, Search, ShieldAlert } from "lucide-react";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function PackEvolutif() {
  const { t, lang } = useLang();
  const { add } = useCart();
  const navigate = useNavigate();
  const [offers, setOffers] = useState(null);
  const [seasonInfo, setSeasonInfo] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pubgId, setPubgId] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get("/products", { params: { type: "evo" } }).then((r) => setOffers(r.data)).catch(() => setOffers([]));
    api.get("/evo/season").then((r) => setSeasonInfo(r.data)).catch(() => {});
  }, []);

  const openOffer = (p) => { setSelected(p); setPubgId(""); setResult(null); };
  const check = async (e) => {
    e.preventDefault();
    const id = pubgId.trim();
    if (!/^\d{9,13}$/.test(id)) return setResult({ eligible: false, reason: t("evo.invalidId") });
    setChecking(true); setResult(null);
    try {
      const { data } = await api.get("/evo/eligibility", { params: { product_id: selected.id, pubg_id: id } });
      setResult(data);
    } catch (err) { setResult({ eligible: false, reason: errorMessage(err) }); }
    finally { setChecking(false); }
  };
  const proceed = () => {
    add(selected);
    const id = pubgId.trim();
    setSelected(null);
    navigate(`/commande?pubg_id=${id}`);
  };

  return (
    <div className="pb-24 pt-6" data-testid="evo-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">PUBG Mobile</p>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{t("evo.title")}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("evo.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span data-testid="evo-season-badge" className="inline-flex items-center gap-2 border border-foreground bg-card px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em]">
            <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
            {seasonInfo?.season ? `${t("evo.season")} : ${seasonInfo.season.name}` : t("evo.noSeason")}
          </span>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <p className="eyebrow" data-testid="evo-specials-title">{t("evo.specials")}</p>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2" data-testid="evo-grid">
        {offers === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        {offers?.map((p) => (
          <article key={p.id} data-testid={`evo-offer-${p.slug}`} className="flex flex-col border border-foreground bg-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{t(`evo.limit.${p.evo_limit || "season"}`)}</p>
                <h2 className="mt-1 font-display text-xl font-black uppercase tracking-tight">{lang === "en" && p.name_en ? p.name_en : p.name}</h2>
              </div>
              <Lock className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{lang === "en" && p.description_en ? p.description_en : p.description_fr}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
              <div>
                {p.old_price && <p className="text-xs text-muted-foreground line-through">{formatAr(p.old_price)}</p>}
                <p className="num text-2xl text-foreground" data-testid={`evo-price-${p.slug}`}>{formatAr(p.price)}</p>
              </div>
              {p.purchasable === false ? (
                <Button disabled variant="outline" data-testid={`evo-soon-${p.slug}`} className="rounded-full px-6 font-bold opacity-70">{t("evo.soon")}</Button>
              ) : (
                <Button onClick={() => openOffer(p)} data-testid={`evo-buy-${p.slug}`} className="rounded-full px-6 font-bold">{t("evo.buy")}</Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {offers?.length === 0 && <p className="mt-10 text-center text-muted-foreground" data-testid="evo-empty">{t("evo.empty")}</p>}
      <p className="mt-8 border border-foreground bg-muted/40 p-4 text-xs text-muted-foreground" data-testid="evo-hint">{t("evo.hint")}</p>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent aria-describedby={undefined} className="rounded-3xl sm:max-w-md" data-testid="evo-dialog">
          <DialogHeader><DialogTitle className="font-display">{selected && (lang === "en" && selected.name_en ? selected.name_en : selected.name)}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border border-foreground bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t(`evo.limit.${selected.evo_limit || "season"}`)}</span>
                <span className="num text-lg">{formatAr(selected.price)}</span>
              </div>
              <form onSubmit={check} className="space-y-3">
                <label className="text-sm font-semibold" htmlFor="evo-pubg-id">{t("evo.pubgLabel")}</label>
                <Input id="evo-pubg-id" data-testid="evo-pubg-input" inputMode="numeric" value={pubgId}
                  onChange={(e) => { setPubgId(e.target.value.replace(/\D/g, "")); setResult(null); }}
                  placeholder="5123456789" className="h-12 rounded-xl" required />
                <Button type="submit" disabled={checking || !pubgId} data-testid="evo-check-button" variant="outline" className="h-11 w-full rounded-full font-bold">
                  {checking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("evo.checking")}</> : <><Search className="mr-2 h-4 w-4" />{t("evo.check")}</>}
                </Button>
              </form>
              {result && !result.eligible && (
                <p data-testid="evo-not-eligible" className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{result.reason}
                </p>
              )}
              {result?.eligible && (
                <div className="space-y-3">
                  <p data-testid="evo-eligible" className="flex items-start gap-2 border border-foreground bg-primary/20 px-3 py-2.5 text-sm font-semibold">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />{t("evo.eligible")}
                  </p>
                  <Button onClick={proceed} data-testid="evo-continue-button" className="h-12 w-full rounded-full font-bold">
                    {t("evo.continue")} — {formatAr(selected.price)}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
