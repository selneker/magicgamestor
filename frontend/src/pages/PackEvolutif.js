import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, CalendarRange, Loader2, Search, ShieldAlert } from "lucide-react";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useCart } from "@/context/CartContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageMeta } from "@/lib/catalog";

// PL-DS-003-V1 — présentation sur les classes littérales du DS (.h-l/.h-c/.p-m/
// .eyebrow/.num, .trust-card, .chip, .form-field, .button-main). Le shell Dialog
// (focus trap) et toute la logique d'éligibilité/testids sont conservés.
function BtnMain({ testid, label, children, theme = "dark", accent = "violet", className = "", ...props }) {
  return (
    <button className={`button-main ${className}`.trim()} data-button-theme={theme} data-button-accent={accent} data-testid={testid} {...props}>
      <span className="button-main-inner full-h">
        <span className="button-main-inner__back" data-text={label || ""}></span>
        <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{children}</span></span></span>
      </span>
    </button>
  );
}

export default function PackEvolutif({ embedded = false, products = null }) {
  const { t, lang } = useLang();
  const { add } = useCart();
  const navigate = useNavigate();
  // Cette page est aussi rendue en mode `embedded` dans le catalogue : dans ce
  // cas elle ne doit pas écraser les métadonnées de la page catalogue.
  usePageMeta(t("seo.packTitle"), t("seo.packDescription"), { enabled: !embedded });
  const [offers, setOffers] = useState(null);
  const [seasonInfo, setSeasonInfo] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pubgId, setPubgId] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const displayedOffers = embedded ? products : offers;

  useEffect(() => {
    if (!embedded) api.get("/products", { params: { type: "evo" } }).then((r) => setOffers(r.data)).catch(() => setOffers([]));
    api.get("/evo/season").then((r) => setSeasonInfo(r.data)).catch(() => {});
  }, [embedded]);

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
    <div className={embedded ? "" : "container section mgs-shell"} data-testid="evo-page">
      {!embedded && <>
      <div className="mgs-head">
        <div>
          <p className="eyebrow">PUBG Mobile</p>
          <h1 className="mgs-title">{t("evo.title")}</h1>
          <p className="mgs-sub" style={{ maxWidth: "34em" }}>{t("evo.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span data-testid="evo-season-badge" className="mgs-chip">
            <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
            {seasonInfo?.season ? `${t("evo.season")} : ${seasonInfo.season.name}` : t("evo.noSeason")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ marginTop: "2em" }}>
        <p className="eyebrow" data-testid="evo-specials-title">{t("evo.specials")}</p>
        <span className="h-px flex-1" style={{ background: "hsl(0 0% 7% / .15)" }} />
      </div>
      </>}
      <div className="packs-grid" style={{ marginTop: "1em", gridTemplateColumns: "repeat(auto-fit, minmax(16em, 1fr))" }} data-testid="evo-grid">
        {displayedOffers === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        {displayedOffers?.map((p) => (
          <article key={p.id} data-testid={`evo-offer-${p.slug}`} className="mgs-card">
            <div>
              <p className="eyebrow">{t(`evo.limit.${p.evo_limit || "season"}`)}</p>
              <h2 className="h-c" style={{ marginTop: ".2em" }}>{lang === "en" && p.name_en ? p.name_en : p.name}</h2>
            </div>
            <p className="p-m" style={{ marginTop: ".4em" }}>{lang === "en" && p.description_en ? p.description_en : p.description_fr}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3" style={{ paddingTop: "1em" }}>
              <div>
                {p.old_price && <p className="p-m" style={{ fontSize: ".75em", textDecoration: "line-through", opacity: .6 }}>{formatAr(p.old_price, lang)}</p>}
                <p className="num" style={{ fontSize: "1.5em", fontWeight: 800 }} data-testid={`evo-price-${p.slug}`}>{formatAr(p.price, lang)}</p>
              </div>
              {p.purchasable === false ? (
                <BtnMain disabled theme="light" accent="blue" className="h-11 disabled:opacity-70" testid={`evo-soon-${p.slug}`} label={t("evo.soon")}>{t("evo.soon")}</BtnMain>
              ) : (
                <BtnMain onClick={() => openOffer(p)} className="h-11" testid={`evo-buy-${p.slug}`} label={t("evo.buy")}>{t("evo.buy")}</BtnMain>
              )}
            </div>
          </article>
        ))}
      </div>
      {displayedOffers?.length === 0 && <p className="p-m" style={{ marginTop: "2em", textAlign: "center" }} data-testid="evo-empty">{t("evo.empty")}</p>}
      <p className="trust-card" style={{ marginTop: "2em", padding: "1em", fontSize: ".8em", flexDirection: "row" }} data-testid="evo-hint">{t("evo.hint")}</p>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {/* 28 px comme la carte produit. `rounded-3xl` est remappe a 14 px par
            index.css, et `ui/dialog.jsx` impose `sm:rounded-lg` : le `!` est une
            rustine a retirer en T5.2 (quand les rayons seront unifies). */}
        <DialogContent aria-describedby={undefined} className="!rounded-[28px] overflow-hidden sm:max-w-md" data-testid="evo-dialog">
          <DialogHeader><DialogTitle className="h-c">{selected && (lang === "en" && selected.name_en ? selected.name_en : selected.name)}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="kv" style={{ border: "1px solid hsl(0 0% 7% / .18)", borderRadius: ".8em", alignItems: "center" }}>
                <span className="k">{t(`evo.limit.${selected.evo_limit || "season"}`)}</span>
                <span className="v num" style={{ fontSize: "1.1em" }}>{formatAr(selected.price, lang)}</span>
              </div>
              <form onSubmit={check} className="space-y-3">
                <label className="text-sm font-semibold" htmlFor="evo-pubg-id">{t("evo.pubgLabel")}</label>
                <input id="evo-pubg-id" data-testid="evo-pubg-input" inputMode="numeric" value={pubgId}
                  onChange={(e) => { setPubgId(e.target.value.replace(/\D/g, "")); setResult(null); }}
                  placeholder="5123456789" className="form-field w-full" required />
                <BtnMain type="submit" disabled={checking || !pubgId} testid="evo-check-button" theme="light" accent="blue" className="h-11 w-full disabled:opacity-50" label={t("evo.check")}>
                  {checking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("evo.checking")}</> : <><Search className="mr-2 h-4 w-4" />{t("evo.check")}</>}
                </BtnMain>
              </form>
              {result && !result.eligible && (
                <p data-testid="evo-not-eligible" className="flex items-start gap-2 rounded-xl bg-destructive px-3 py-2.5 text-sm font-semibold text-destructive-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{result.reason}
                </p>
              )}
              {result?.eligible && (
                <p data-testid="evo-eligible" className="trust-card" style={{ flexDirection: "row", alignItems: "flex-start", padding: ".8em", background: "color-mix(in srgb, var(--color--neon) 20%, transparent)", fontSize: ".9em", fontWeight: 600 }}>
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />{t("evo.eligible")}
                </p>
              )}
              <BtnMain onClick={proceed} disabled={!result?.eligible} testid="evo-continue-button" className="h-12 w-full disabled:opacity-50" label={t("evo.continue")}>
                {t("evo.continue")} — {formatAr(selected.price, lang)}
              </BtnMain>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}