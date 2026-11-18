import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useGames } from "@/context/GameContext";
import { useLang, localized } from "@/context/LanguageContext";
import { Icon } from "@/components/ui/icon";
import { GameCard } from "@/components/game/GameCard";
import { ProductCard } from "@/components/store/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { usePageMeta } from "@/lib/catalog";

// Une charge utile qui n'est pas un tableau (page HTML renvoyee par un proxy,
// objet d'erreur, ...) ne doit pas faire planter le rendu : on la remplace par
// un tableau vide et on le signale dans la console avec l'endpoint concerne.
const asList = (endpoint, payload) => {
  if (Array.isArray(payload)) return payload;
  console.warn(`[MagicGameStore] ${endpoint} a renvoye une charge utile non-tableau (${typeof payload}) : liste ignoree.`);
  return [];
};

export function GameLogo({ game, className = "h-14 w-14" }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-[color:var(--rule-strong)] bg-primary text-[color:var(--brand-ink)] ${className}`}>
      {game.icon_url && !broken
        ? <img src={game.icon_url} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />
        : <Icon name="manette" className="h-1/2 w-1/2" aria-hidden="true" />}
    </span>
  );
}

/* ── PL-005-FE-03 refonte Slush — accueil de la maquette 01-accueil.html ──
   Markup et classes EXACTS de la maquette : hero (page-hero / h-d /
   hero-lime / data-anim-hero), bandeau marquee CTA (cta-banner-section,
   marquee-advanced ANIMÉ via lib/slush.js), étapes (steps-grid /
   step-card), preuves (trust-grid), avis (reviews-grid — les exemples
   NEUTRES de la maquette, affichés avec leur mention « avis d'exemple »),
   cartes de jeux (packs-grid / two-col-grid__visual), FAQ (faq-list avec
   accordéon data-toggle porté en état React).
   Toutes les sections portent .section : le fond de page encre et les
   panneaux crème arrondis viennent de design-system.css (body[data-page=
   "home"], posé par SlushChrome).
   Contenu 100 % réel (règle 6) : les sections commerce du site (offres
   populaires, abonnements, événement, support) restent, habillées par les
   mêmes classes maquette. Les icônes viennent de la bibliothèque
   maquettes/icons (sprite public/icons.svg, composant Icon). */

// Face avant des boutons maquette (thème light : crème bordée d'encre).
function ButtonMain({ to, label, accent = "light", theme = "light", className = "", cursor, testId, children }) {
  return (
    <Link
      to={to}
      className={`button-main ${className}`.trim()}
      data-button-theme={theme}
      data-button-accent={accent}
      data-cursor={cursor}
      data-testid={testId}
    >
      <span className="button-main-inner full-h">
        <span className="button-main-inner__back" data-text={label}></span>
        <span className="button-main-inner__front">
          <span className="button-main-inner__bg"></span>
          <span className="button-main-inner__text"><span>{children || label}</span></span>
        </span>
      </span>
    </Link>
  );
}

function Hero({ shopUrl, games }) {
  const { t } = useLang();
  // L'eyebrow sert à quelque chose : il liste les jeux réellement
  // disponibles (« PUBG Mobile · Free Fire · … ») ; repli sur le libellé
  // statique tant que la boutique n'a aucun jeu.
  const eyebrow = games.length > 0 ? games.map((g) => g.name).join(" · ") : t("store.heroEyebrow");
  return (
    <section className="page-hero" data-testid="hero">
      <div className="container" data-hero-content>
        <p className="eyebrow" data-hero-fade>{eyebrow}</p>
        <h1 className="h-d" data-anim-hero style={{ marginTop: ".35em" }} data-testid="hero-title">
          {t("store.heroA")} <span className="hero-lime">{t("store.heroB")}</span>
        </h1>
        <p className="h-s" data-load-stagger style={{ maxWidth: "30em", marginTop: "1.2em" }}>
          {t("store.heroSub")}
        </p>
        <div className="hero-cta-row" data-load-stagger>
          <ButtonMain to={shopUrl} label={t("store.ctaShop")} theme="dark" accent="violet"
            cursor={t("store.ctaShop")} testId="hero-cta-shop">
            {t("store.ctaShop")}
            <svg className="button-main-inner__arrow" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5873 10L0 8.4127L6.30385 2.13152L0.793651 2.1542V0H10V9.20635H7.8458L7.86848 3.67347L1.5873 10Z" fill="currentColor" /></svg>
          </ButtonMain>
          <ButtonMain to="/suivi" label={t("store.ctaTrack")} theme="light" accent="blue" testId="hero-cta-track" />
        </div>
      </div>
    </section>
  );
}

// Bandeau marquee CTA de la maquette : boutons géants « Recharger » en
// boucle, direction liée au scroll (lib/slush.js initMarquee). La maquette
// a oublié les data-marquee-*-target sur ses enfants (son JS ne les
// trouvait jamais) : le port React les ajoute pour que l'animation joue.
const MARQUEE_ACCENTS = ["white", "orange", "blue", "violet", "green"];

function CtaBanner({ games }) {
  const { t } = useLang();
  const notes = t("footer.tickerMessages") || [];
  const label = t("store.bannerCta");
  return (
    <section className="cta-banner-section" data-testid="home-cta-banner">
      <div className="cta-banner-inner">
        <div className="marquee-advanced" data-marquee-direction="left" data-marquee-speed="15" data-marquee-scroll-speed="10" data-marquee-duplicate="2" data-marquee-scroll-direction-target>
          <div className="marquee-advanced__scroll" data-marquee-scroll-target>
            {[0, 1, 2].map((dup) => (
              <div className="marquee-advanced__collection" data-marquee-collection-target key={dup} aria-hidden={dup > 0 ? "true" : undefined}>
                {MARQUEE_ACCENTS.map((accent) => (
                  <Link to="/boutique" key={`${dup}-${accent}`} className="download-cta-el button-main" data-button-theme="dark" data-button-accent={accent} data-cursor={label} data-testid={dup === 0 && accent === "white" ? "cta-banner-primary" : undefined}>
                    <span className="button-main-inner full-h">
                      <span className="button-main-inner__back is--download" data-text={label}></span>
                      <span className="button-main-inner__front">
                        <span className="button-main-inner__bg" data-box-theme={accent}></span>
                        <span className="button-main-inner__text"><span className="marquee-cta-h">{label}</span></span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="container ticker-note">{notes[0] || ""}</p>
      {/* Le bandeau n'est plus un espace vide : sous le marquee, les jeux
          réellement disponibles en boutique — chaque pilule mène au
          catalogue du jeu (choix du jeu depuis l'accueil). */}
      {games.length > 0 && (
        <div className="container" data-testid="home-banner-games">
          <p className="eyebrow" style={{ color: "inherit" }}>{t("store.gamesTitle")}</p>
          <div className="banner-games">
            {games.map((g) => (
              <Link to={`/boutique?game=${g.id}`} className="banner-game" key={g.id} data-testid={`banner-game-${g.slug || g.id}`}>
                <GameLogo game={g} className="banner-game__logo" />
                <span className="banner-game__name">{g.name}</span>
                <svg className="banner-game__arrow" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5873 10L0 8.4127L6.30385 2.13152L0.793651 2.1542V0H10V9.20635H7.8458L7.86848 3.67347L1.5873 10Z" fill="currentColor" /></svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// « Comment ça marche » (maquette .steps-grid, accents jaune/bleu/vert).
// Icônes de la bibliothèque maquettes/icons (sprite public/icons.svg),
// pas de lucide : étiquettes (choix du pack), clé (identifiants), fusée.
const STEPS_ICONS = ["etiquettes", "cle", "fusee"];
const STEPS_THEMES = ["yellow", "blue", "green"];

function Steps() {
  const { t } = useLang();
  const steps = [[t("store.step1"), t("store.step1d")], [t("store.step2"), t("store.step2d")], [t("store.step3"), t("store.step3d")]];
  return (
    <section className="section" data-testid="home-steps">
      <div className="container">
        <div className="section-head">
          <h2 className="h-l" data-anim-slant>{t("store.stepsTitle")}</h2>
          <Link className="link p-m" to="/boutique">{t("store.seeShop")}</Link>
        </div>
        <div className="steps-grid">
          {steps.map(([title, desc], i) => {
            const name = STEPS_ICONS[i];
            return (
              <div className="step-card" data-card-reveal="card" data-box-theme={STEPS_THEMES[i]} key={title} data-testid={`home-step-${i}`}>
                <span className="step-card__num" aria-hidden="true">{i + 1}</span>
                <Icon name={name} className="ic-use" data-icon-reveal aria-hidden="true" />
                <h3 className="h-c">{title}</h3>
                <p className="p-m">{desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// « Pourquoi Magic Game Store ? » (maquette .trust-grid).
// Icônes maquettes : contrôle OK (compte vérifié), portefeuille
// (Mobile Money & USDT), chrono (suivi temps réel), bulle (support).
const WHY_ICONS = ["chat-ok", "portefeuille", "chrono", "bulle-noire"];

function WhyChoose() {
  const { t } = useLang();
  const items = [
    [t("store.why1t"), t("store.why1d")],
    [t("store.why2t"), t("store.why2d")],
    [t("store.why3t"), t("store.why3d")],
    [t("store.why4t"), t("store.why4d")],
  ];
  return (
    <section className="section" data-testid="home-why">
      <div className="container">
        <div className="section-head"><h2 className="h-l" data-anim-slant>{t("store.whyTitle")}</h2></div>
        <div className="trust-grid">
          {items.map(([title, desc], i) => {
            const name = WHY_ICONS[i];
            return (
              <div className="trust-card" data-card-reveal="card" key={title} data-testid={`home-why-${i}`}>
                <Icon name={name} className="ic-use" data-icon-reveal aria-hidden="true" />
                <strong>{title}</strong>
                <span>{desc}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Avis clients (maquette .reviews-grid) : les 3 exemples NEUTRES de la
// maquette, affichés avec la mention « avis d'exemple » qu'elle porte
// elle-même — à remplacer par de vrais avis quand ils existent.
function Reviews() {
  const { t } = useLang();
  const reviews = [
    [t("store.review1"), t("store.review1who")],
    [t("store.review2"), t("store.review2who")],
    [t("store.review3"), t("store.review3who")],
  ];
  return (
    <section className="section" data-testid="home-reviews">
      <div className="container">
        <div className="section-head">
          <h2 className="h-l" data-anim-slant>{t("store.reviewsTitle")}</h2>
          <span className="p-m">{t("store.reviewsNote")}</span>
        </div>
        <div className="reviews-grid">
          {reviews.map(([quote, who], i) => (
            <div className="review-card" data-card-reveal="card" key={who} data-testid={`home-review-${i}`}>
              <span className="stars" aria-label={t("store.reviewsStars")}>★★★★★</span>
              <p className="p-m">{quote}</p>
              <span className="who">{who}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Cartes de jeux (maquette .packs-grid, 2 colonnes, .two-col-grid__visual).
const GAME_THEMES = ["violet", "glacier", "purple", "blue"];

function GamesCards({ games }) {
  const { t, lang } = useLang();
  return (
    <section className="section" data-testid="home-game-selection">
      <div className="container">
        <div className="section-head">
          <h2 className="h-l" data-anim-slant>{t("store.gamesTitle")}</h2>
          <Link className="link p-m" to="/jeux" data-testid="games-see-all">{t("common.seeAll")}</Link>
        </div>
        {/* auto-fit : 1 colonne naturelle en mobile (pas de titres écrasés),
            3 colonnes ≥ 768 px, pas de trou à côté de la 3e carte — les
            tracks vides de auto-fit sont réduites à 0. Écrase les paliers
            2/3/4 colonnes de .packs-grid (mg-components.css:292). */}
        <div className="packs-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(18em, 1fr))" }}>
          {games.slice(0, 3).map((g, i) => (
            <Link to={`/boutique?game=${g.id}`} className="two-col-grid__visual" data-card-reveal="card" data-box-theme={GAME_THEMES[i % GAME_THEMES.length]} style={{ minHeight: "16em" }} key={g.id} data-testid={`home-game-${g.slug || g.id}`}>
              <svg className="mg-shape" viewBox="0 0 200 200" aria-hidden="true"><rect x="20" y="20" width="160" height="160" rx="46" transform="rotate(8 100 100)" fill="currentColor" /><path d="M115 55l-40 62h29l-11 38 46-64h-30l18-36z" fill="hsl(0 0% 0% / .18)" /></svg>
              <GameLogo game={g} className="ic-use h-[6em] w-[6em] rounded-[1em]" />
              <span style={{ position: "relative", zIndex: 1 }}>
                <strong className="h-c" style={{ display: "block" }}>{g.name}</strong>
                <span className="p-m">{localized(g, "description", lang) || t("games.seeAll")}</span>
              </span>
            </Link>
          ))}
          {games.length < 2 && (
            <div className="two-col-grid__visual" data-card-reveal="card" data-box-theme="glacier" style={{ minHeight: "16em" }} data-testid="home-game-soon">
              <svg className="mg-shape" viewBox="0 0 200 200" aria-hidden="true"><rect x="20" y="20" width="160" height="160" rx="46" transform="rotate(8 100 100)" fill="currentColor" /><path d="M115 55l-40 62h29l-11 38 46-64h-30l18-36z" fill="hsl(0 0% 0% / .12)" /></svg>
              <Icon name="blocs" className="ic-use opacity-45" aria-hidden="true" />
              <span style={{ position: "relative", zIndex: 1 }}>
                <strong className="h-c" style={{ display: "block" }}>{t("store.soonCard")}</strong>
                <span className="p-m">{t("store.soonSub")}</span>
              </span>
            </div>
          )}
        </div>
        {games.length === 0 && <p className="p-m" data-testid="home-games-empty">{t("games.empty")}</p>}
      </div>
    </section>
  );
}

// FAQ (maquette .faq-list, accordéon data-toggle porté en état React :
// .faq-a.is--open + aria-expanded, le « + » pivote via la CSS maquette).
function Faq() {
  const { t } = useLang();
  const [open, setOpen] = useState(null);
  const qa = [
    [t("store.faq1q"), t("store.faq1a")],
    [t("store.faq2q"), t("store.faq2a")],
    [t("store.faq3q"), t("store.faq3a")],
    [t("store.faq4q"), t("store.faq4a")],
  ];
  return (
    <section className="section" id="faq" data-testid="home-faq">
      <div className="container">
        <div className="section-head">
          <h2 className="h-l" data-anim-slant>{t("store.faqTitle")}</h2>
          <Link className="link p-m" to="/chat">{t("store.supportCta")}</Link>
        </div>
        <div className="faq-list" data-card-reveal="wrap">
          {qa.map(([q, a], i) => (
            <div className="faq-item" data-card-reveal="card" key={i} data-testid={`home-faq-item-${i}`}>
              <button
                type="button"
                className="faq-q"
                aria-expanded={open === i ? "true" : "false"}
                aria-controls={`faq-a${i + 1}`}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span>{q}</span>
                <span className="faq-toggle" aria-hidden="true"></span>
              </button>
              <div className={`faq-a${open === i ? " is--open" : ""}`} id={`faq-a${i + 1}`}><p>{a}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BackToTop() {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button" data-testid="back-to-top" aria-label={t("common.backToTop")}
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      className={`fixed right-4 z-40 flex items-center gap-2 rounded-full border border-[color:var(--rule-strong)] bg-foreground px-4 py-3 text-xs font-semibold text-background shadow-[4px_4px_0_hsl(var(--primary)/.5)] transition-all duration-300 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] md:bottom-6 ${show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"}`}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      <span className="hidden sm:inline">{t("common.backToTop")}</span>
    </button>
  );
}

export default function Home() {
  const { t, lang } = useLang();
  const { games } = useGames();
  const [products, setProducts] = useState(null);
  const [subs, setSubs] = useState(null);
  const [events, setEvents] = useState([]);
  const [productError, setProductError] = useState(false);
  // FAQ de la page d'accueil → données structurées FAQPage : Google peut
  // afficher ces questions directement dans les résultats de recherche.
  const faqJsonLd = useMemo(() => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ["1", "2", "3", "4"].map((i) => ({
      "@type": "Question",
      name: t(`store.faq${i}q`),
      acceptedAnswer: { "@type": "Answer", text: t(`store.faq${i}a`) },
    })),
  }), [t]);
  usePageMeta(t("seo.homeTitle"), t("seo.homeDescription"), { jsonLd: faqJsonLd });
  const load = useCallback(() => {
    setProductError(false);
    Promise.all([
      api.get("/products", { params: { popular: true } }),
      api.get("/products", { params: { type: "prime,prime_plus" } }),
      api.get("/products", { params: { type: "evo" } }),
    ]).then(([popularResponse, primeResponse, evoResponse]) => {
      const popular = asList("/products?popular=true", popularResponse.data);
      const prime = asList("/products?type=prime,prime_plus", primeResponse.data);
      const evo = asList("/products?type=evo", evoResponse.data);
      const unique = new Map();
      [...popular, ...prime, ...evo].forEach((product) => unique.set(product.id, product));
      const all = [...unique.values()];
      const selected = [
        ...all.filter((product) => Number(product.uc_amount) > 0).slice(0, 2),
        ...all.filter((product) => ["prime", "prime_plus"].includes(product.type)).slice(0, 1),
        ...all.filter((product) => product.type === "evo").slice(0, 1),
      ];
      setProducts([...new Map(selected.map((product) => [product.id, product])).values()].slice(0, 4));
      setSubs(prime.slice(0, 8));
    }).catch(() => { setProductError(true); setProducts([]); setSubs([]); });
    api.get("/events").then((r) => setEvents(asList("/events", r.data).slice(0, 1))).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const shopUrl = games.length === 1 ? `/boutique?game=${games[0].id}` : "/boutique";
  const subsUrl = `${shopUrl}${shopUrl.includes("?") ? "&" : "?"}type=prime,prime_plus`;
  const popularIds = new Set((products || []).map((product) => product.id));
  const visibleSubs = subs === null
    ? undefined
    : Array.isArray(subs)
      ? subs.filter((product, index, list) => !popularIds.has(product.id) && list.findIndex((item) => item.id === product.id) === index)
      : [];

  return (
    <div data-testid="home-page">
      <Hero shopUrl={shopUrl} games={games} />
      <CtaBanner games={games} />

      <Steps />

      <WhyChoose />

      <Reviews />

      <section className="section" data-testid="popular-section">
        <div className="container">
          <div className="section-head">
            <h2 className="h-l" data-anim-slant>{t("store.offersTitle")}</h2>
            <Link to={shopUrl} data-testid="see-all-link" className="link p-m">{t("common.seeAll")}</Link>
          </div>
          <div className="grid grid-cols-1 items-stretch gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" data-testid="popular-grid">
            {products === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-[14px]" />)}
            {products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} displayPopular />)}
          </div>
          {!productError && products?.length === 0 && <p className="p-m" data-testid="popular-empty">{t("store.noOffers")}</p>}
          {productError && <ErrorState title={t("common.error")} description={t("store.offersError")} retryLabel={t("common.retry")} onRetry={load} className="mt-6" data-testid="popular-error" />}
        </div>
      </section>

      <section className="section" data-testid="subs-section">
        <div className="container">
          <div className="section-head">
            <h2 className="h-l" data-anim-slant>{t("common.subsTitle")}</h2>
            <Link to={subsUrl} data-testid="subs-more-link" className="link p-m">{t("common.seeAll")}</Link>
          </div>
          <div className="grid grid-cols-1 items-stretch gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" data-testid="subs-grid">
            {subs === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-[14px]" />)}
            {visibleSubs?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
          {!productError && visibleSubs?.length === 0 && <p className="p-m" data-testid="subs-empty">{t("store.noOffers")}</p>}
        </div>
      </section>

      {events.map((ev) => (
        <section className="section" key={ev.id} data-testid="home-event">
          <div className="container">
            <div className="overflow-hidden rounded-[28px] border-2 border-[color:var(--card-border)] bg-card lg:grid lg:grid-cols-2">
              <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-56 w-full border-b object-cover lg:h-full lg:border-b-0 lg:border-r" loading="lazy" />
              <div className="p-6 sm:p-10">
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-ink)]">{t("common.promo")}</span>
                <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">{localized(ev, "title", lang)}</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{localized(ev, "description", lang)}</p>
                <div className="mt-6 flex items-end gap-3"><span className="num text-3xl sm:text-4xl">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-sm text-muted-foreground line-through">{ev.old_price_label}</span>}</div>
                <div className="mt-6">
                  <ButtonMain to={ev.product_slug ? `/produit/${ev.product_slug}` : "/evenements"} label={t("events.buy")} theme="dark" accent="violet" testId="home-event-cta" />
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}

      <section className="section" data-testid="home-support">
        <div className="container">
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <div className="trust-card" data-card-reveal="card">
              <Icon name="avion" className="ic-use" data-icon-reveal aria-hidden="true" />
              <strong className="h-c" style={{ display: "block" }}>{t("store.deliveryNote")}</strong>
              <span>{t("store.step2d")}</span>
            </div>
            <div className="flex flex-col justify-between gap-6 rounded-[1.4em] bg-[color:var(--color--dark)] p-6 text-[color:var(--color--light)] sm:p-10" data-card-reveal="card">
              <div><p className="eyebrow" style={{ color: "inherit" }}>{t("store.supportTitle")}</p><p className="mt-3 text-sm opacity-75">{t("store.supportSub")}</p></div>
              <div>
                <ButtonMain to="/chat" label={t("store.supportCta")} theme="light" accent="neon" testId="home-support-cta" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <GamesCards games={games} />

      <Faq />

      <BackToTop />
    </div>
  );
}
