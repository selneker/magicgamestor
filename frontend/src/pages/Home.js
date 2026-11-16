import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUp, ArrowUpRight, Gamepad2, KeyRound, MessageCircle, Rocket, ShieldCheck, Tag, Timer, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useGames } from "@/context/GameContext";
import { useLang, localized } from "@/context/LanguageContext";
import { GameCard } from "@/components/game/GameCard";
import { ProductCard } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { usePageMeta } from "@/lib/catalog";

const rise = (i = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.06 * i, duration: 0.45, ease: "easeOut" } });

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
        : <Gamepad2 className="h-1/2 w-1/2" strokeWidth={2} aria-hidden="true" />}
    </span>
  );
}

/* ── PL-005-FE-03 — Accueil « à panneaux » (maquette 01-accueil) ──────────
   Le fond de la page est l'ENCRE (fixe, les deux thèmes) et chaque section
   est un panneau arrondi posé dessus — l'encre se voit dans les interstices,
   comme la maquette. Contenu 100 % réel (règle 6) : la section avis de la
   maquette (faux avis) n'est PAS portée ; les offres populaires et les
   abonnements du site restent (vrais prix = source). */

// Panneau de section : surface crème (clair) / #1F1F1F (sombre), texte
// theme-apparié via --panel-ink.
const panel = "rounded-[28px] bg-[color:hsl(var(--panel))] text-[color:hsl(var(--panel-ink))]";
const panelMuted = "text-[color:hsl(var(--panel-muted))]";
// Titre display de section (maquette .h-l : capitales, display black) —
// échelle fluide réduite par rapport à la maquette pour tenir 320-390 px
// sans déborder (la maquette clippe son titre à 390 px).
function SectionHead({ eyebrow, title, sub, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[color:var(--rule)] pb-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-1 font-display text-[clamp(1.75rem,4.5vw,3.25rem)] font-black uppercase leading-[0.95] tracking-[-0.02em]">{title}</h2>
        {sub && <p className={`mt-2 max-w-xl text-sm ${panelMuted}`}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// Surlignage néon du titre (maquette .hero-lime) : fond néon, texte encre
// FIXE — jamais l'inverse (néon en texte sur crème ≈ 1,1:1).
function HeroLime({ children }) {
  return <span className="inline-block rounded-[6px] bg-[color:var(--brand-neon)] px-[0.18em] text-[color:var(--brand-ink)]">{children}</span>;
}

function Hero({ shopUrl }) {
  const { t } = useLang();
  return (
    <section className={`${panel} px-6 pb-10 pt-10 sm:px-10 sm:pt-14 lg:px-14 lg:pb-14`} data-testid="hero">
      <motion.div {...rise(0)}>
        <p className="eyebrow">{t("store.heroEyebrow")}</p>
        {/* Maquette .h-d : capitales, display black, interlignage serré.
            Échelle fluide (16vw ≈ 62 px à 390 px, 9.5rem max à 1440 px) —
            la maquette (6.5em/12.5em fixes) clippe son titre hors écran. */}
        <h1 className="mt-3 max-w-6xl font-display text-[clamp(2.6rem,16vw,9.5rem)] font-black uppercase leading-[0.95] tracking-[-0.02em]" data-testid="hero-title">
          <span className="block">{t("store.heroA")}</span>
          <span className="mt-2 inline-block"><HeroLime>{t("store.heroB")}</HeroLime></span>
        </h1>
        <p className={`mt-6 max-w-lg text-lg leading-relaxed sm:text-xl ${panelMuted}`}>{t("store.heroSub")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-12 border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-violet)] px-7 text-sm font-semibold text-[color:hsl(var(--cream))] hover-slide" data-testid="hero-cta-shop">
            <Link to={shopUrl}>{t("store.ctaShop")}<ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
          <Button asChild size="lg" className="h-12 border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-blue)] px-7 text-sm font-semibold text-[color:var(--brand-ink)] hover-slide" data-testid="hero-cta-track">
            <Link to="/suivi">{t("store.ctaTrack")}</Link>
          </Button>
        </div>
      </motion.div>
    </section>
  );
}

// Bandeau d'appel à l'action (maquette .cta-banner-section) : panneau encre,
// boutons géants. La maquette anime ce ruban (marquee) : le lot n'autorise
// pas le marquee animé (règle 4) → rangée STATIQUE, même mise en forme.
function CtaBanner() {
  const { t } = useLang();
  const giant = "inline-flex items-center justify-center whitespace-nowrap rounded-[28px] px-6 py-4 font-display font-bold leading-none sm:px-8";
  const size = "text-[13.5vw] sm:text-7xl lg:text-8xl";
  return (
    <section className="overflow-hidden rounded-[28px] bg-ink px-4 py-14 text-[color:hsl(var(--cream))] sm:px-8 lg:py-24" data-testid="home-cta-banner">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link to="/boutique" data-testid="cta-banner-primary" className={`${giant} ${size} border-2 border-[color:hsl(var(--cream)/.45)] text-[color:hsl(var(--cream))] transition-colors hover:bg-[color:hsl(var(--cream)/.12)] motion-safe:duration-200`}>
          {t("store.bannerCta")}
        </Link>
        <Link to="/boutique" className={`${giant} ${size} border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-orange)] text-[color:var(--brand-ink)] transition-transform hover:-translate-y-1 motion-safe:duration-200`}>
          {t("store.bannerCta")}
        </Link>
        <Link to="/boutique" className={`${giant} ${size} border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-blue)] text-[color:var(--brand-ink)] transition-transform hover:-translate-y-1 motion-safe:duration-200`}>
          {t("store.bannerCta")}
        </Link>
        <Link to="/boutique" className={`${giant} ${size} border-2 border-[color:var(--brand-violet)] bg-[color:var(--brand-violet)] text-[color:hsl(var(--cream))] transition-transform hover:-translate-y-1 motion-safe:duration-200`}>
          {t("store.bannerCta")}
        </Link>
        <Link to="/boutique" className={`${giant} ${size} border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-green)] text-[color:var(--brand-ink)] transition-transform hover:-translate-y-1 motion-safe:duration-200`}>
          {t("store.bannerCta")}
        </Link>
      </div>
    </section>
  );
}

// « Comment ça marche » (maquette .steps-grid) : cartes aux accents de la
// maquette (jaune / bleu / vert), texte encre FIXE, numéros display.
function Steps() {
  const { t } = useLang();
  const accents = [
    "bg-[color:var(--brand-yellow)] text-[color:var(--brand-ink)]",
    "bg-[color:var(--brand-blue)] text-[color:var(--brand-ink)]",
    "bg-[color:var(--brand-green)] text-[color:var(--brand-ink)]",
  ];
  const icons = [Tag, KeyRound, Rocket];
  const steps = [[t("store.step1"), t("store.step1d")], [t("store.step2"), t("store.step2d")], [t("store.step3"), t("store.step3d")]];
  return (
    <section className={`${panel} px-6 py-10 sm:px-10 lg:px-14`} data-testid="home-steps">
      <SectionHead title={t("store.stepsTitle")}
        action={<Link to="/boutique" className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">{t("store.seeShop")}</Link>} />
      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {steps.map(([title, desc], i) => {
          const Icon = icons[i];
          return (
            <li key={title} className={`card-lift flex flex-col gap-4 rounded-[22px] p-6 sm:p-8 ${accents[i]}`} data-testid={`home-step-${i}`}>
              <div className="flex items-start justify-between">
                <span className="num text-5xl font-extrabold leading-none opacity-40" aria-hidden="true">{i + 1}</span>
                <Icon className="h-9 w-9" strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--brand-ink)]">{desc}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function GamesBento({ games }) {
  const { t } = useLang();
  // PL-UI-GAMES-1 — grille de cartes sur tous les écrans : 2 col mobile,
  // 3 tablette, 4 bureau ; 6 jeux max sur l'accueil puis « Voir tous les
  // jeux » vers /jeux. Le composant porte les data-testid historiques
  // `home-game-*` (conservés pour les tests).
  return (
    <section className={`${panel} px-6 py-10 sm:px-10 lg:px-14`} data-testid="home-game-selection">
      <SectionHead title={t("store.gamesTitle")} sub={t("store.gamesSub")} />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {games.slice(0, 6).map((g) => (
          <GameCard key={g.id} game={g} testId={`home-game-${g.slug || g.id}`} />
        ))}
      </div>
      {games.length > 6 && (
        <div className="mt-5 flex justify-center">
          <Link
            to="/jeux"
            data-testid="games-see-all"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[color:var(--rule-strong)] px-5 text-sm font-semibold hover:bg-[color:hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-neon)]"
          >
            {t("games.seeAll")}
            <ArrowUpRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      )}
      {games.length === 0 && <p className={`text-sm ${panelMuted}`} data-testid="home-games-empty">{t("games.empty")}</p>}
    </section>
  );
}

// « Pourquoi Magic Game Store ? » (maquette .trust-grid) : cartes bordées.
function WhyChoose() {
  const { t } = useLang();
  const items = [
    [ShieldCheck, t("store.why1t"), t("store.why1d")],
    [Wallet, t("store.why2t"), t("store.why2d")],
    [Timer, t("store.why3t"), t("store.why3d")],
    [MessageCircle, t("store.why4t"), t("store.why4d")],
  ];
  return (
    <section className={`${panel} px-6 py-10 sm:px-10 lg:px-14`} data-testid="home-why">
      <SectionHead title={t("store.whyTitle")} sub={t("store.whySub")} />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([Icon, title, desc], i) => (
          <motion.div key={title} {...rise(i)} className="card-lift flex flex-col gap-4 rounded-[22px] border bg-card p-6" data-testid={`home-why-${i}`}>
            <Icon className="h-9 w-9 text-foreground" strokeWidth={1.75} aria-hidden="true" />
            <div>
              <h3 className="font-display text-lg font-bold leading-tight">{title}</h3>
              <p className={`mt-2 text-sm leading-relaxed ${panelMuted}`}>{desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// FAQ (maquette .faq-list) : une CARTE bordée par question (et non un seul
// bloc), « + » pivote en « × » dans une pastille néon. La logique reste
// l'accordéon Radix existant (aucun changement de logique).
function Faq() {
  const { t } = useLang();
  const qa = [
    [t("store.faq1q"), t("store.faq1a")],
    [t("store.faq2q"), t("store.faq2a")],
    [t("store.faq3q"), t("store.faq3a")],
    [t("store.faq4q"), t("store.faq4a")],
  ];
  return (
    <section className={`${panel} px-6 py-10 sm:px-10 lg:px-14`} data-testid="home-faq">
      <SectionHead title={t("store.faqTitle")}
        action={<Link to="/chat" className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">{t("store.supportCta")}</Link>} />
      <Accordion type="single" collapsible className="mt-6 grid gap-3">
        {qa.map(([q, a], i) => (
          <AccordionItem key={i} value={`faq-${i}`} className="rounded-[22px] border bg-card px-5" data-testid={`home-faq-item-${i}`}>
            <AccordionTrigger
              className="relative py-5 pr-16 text-left font-display text-base font-bold hover:no-underline [&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-[color:var(--brand-ink)] before:absolute before:right-12 before:top-1/2 before:h-9 before:w-9 before:-translate-y-1/2 before:rounded-full before:border before:border-[color:var(--rule-strong)] before:bg-primary before:content-['']"
            >
              {q}
            </AccordionTrigger>
            <AccordionContent className={`pb-5 text-sm leading-relaxed ${panelMuted}`}>{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
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
      <ArrowUp className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t("common.backToTop")}</span>
    </button>
  );
}


export default function Home() {
  const { t, lang } = useLang();
  const { games, selectGame } = useGames();
  const [products, setProducts] = useState(null);
  const [subs, setSubs] = useState(null);
  const [events, setEvents] = useState([]);
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
  useEffect(() => {
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
    }).catch(() => { setProducts([]); setSubs([]); });
    api.get("/events").then((r) => setEvents(asList("/events", r.data).slice(0, 1))).catch(() => {});
  }, []);
  const shopUrl = games.length === 1 ? `/boutique?game=${games[0].id}` : "/boutique";
  const subsUrl = `${shopUrl}${shopUrl.includes("?") ? "&" : "?"}type=prime,prime_plus`;
  const popularIds = new Set((products || []).map((product) => product.id));
  // `subs === null` = chargement en cours : on garde `undefined` pour que la
  // section affiche ses skeletons et non le message "aucune offre".
  const visibleSubs = subs === null
    ? undefined
    : Array.isArray(subs)
      ? subs.filter((product, index, list) => !popularIds.has(product.id) && list.findIndex((item) => item.id === product.id) === index)
      : [];

  return (
    // Fond encre pleine largeur (maquette « à panneaux ») : le pseudo-fond
    // absolu déborde de la colonne de contenu sur toute la largeur de
    // l'écran ; `isolate` le garde DERRIÈRE les panneaux (z-index négatif
    // confiné) et au-dessus du fond du site.
    <div className="relative isolate pb-16" data-testid="home-page">
      <div aria-hidden="true" className="absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 bg-ink" />
      <div className="grid gap-3">
        <Hero shopUrl={shopUrl} />
        <CtaBanner />
        <GamesBento games={games} />

        <section className={`${panel} px-6 py-10 sm:px-10 lg:px-14`}>
          <SectionHead eyebrow={t("catalog.popular")} title={t("store.offersTitle")} sub={t("store.offersSub")}
            action={<Link to={shopUrl} data-testid="see-all-link" className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${panelMuted} transition-colors hover:text-[color:hsl(var(--panel-ink))]`}>{t("common.seeAll")}<ArrowRight className="h-3.5 w-3.5" /></Link>} />
          <div className="mt-6 grid grid-cols-1 items-stretch gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" data-testid="popular-grid">
            {products === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-[14px]" />)}
            {products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} displayPopular />)}
          </div>
          {products?.length === 0 && <p className={`mt-6 text-sm ${panelMuted}`} data-testid="popular-empty">{t("store.noOffers")}</p>}
        </section>

        <section className={`${panel} px-6 py-10 sm:px-10 lg:px-14`} data-testid="subs-section">
          <SectionHead eyebrow={t("catalog.prime")} title={t("common.subsTitle")} sub={t("common.subsSub")}
            action={<Link to={subsUrl} data-testid="subs-more-link" className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${panelMuted} transition-colors hover:text-[color:hsl(var(--panel-ink))]`}>{t("common.seeAll")}<ArrowRight className="h-3.5 w-3.5" /></Link>} />
          <div className="mt-6 grid grid-cols-1 items-stretch gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" data-testid="subs-grid">
            {subs === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-[14px]" />)}
            {visibleSubs?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
          </div>
          {visibleSubs?.length === 0 && <p className={`mt-6 text-sm ${panelMuted}`} data-testid="subs-empty">{t("store.noOffers")}</p>}
        </section>

        <Steps />

        <WhyChoose />

        {events.map((ev) => (
          <section key={ev.id} className="overflow-hidden rounded-[28px] bg-card lg:grid lg:grid-cols-2" data-testid="home-event">
            <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-56 w-full border-b object-cover lg:h-full lg:border-b-0 lg:border-r" loading="lazy" />
            <div className="p-6 sm:p-10">
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--brand-ink)]">{t("common.promo")}</span>
              <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">{localized(ev, "title", lang)}</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{localized(ev, "description", lang)}</p>
              <div className="mt-6 flex items-end gap-3"><span className="num text-3xl sm:text-4xl">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-sm text-muted-foreground line-through">{ev.old_price_label}</span>}</div>
              <Button asChild className="mt-8 h-12 px-7" data-testid="home-event-cta"><Link to={ev.product_slug ? `/produit/${ev.product_slug}` : "/evenements"}>{t("events.buy")}</Link></Button>
            </div>
          </section>
        ))}

        <section className="grid gap-3 md:grid-cols-[1.4fr_1fr]" data-testid="home-support">
          <div className={`${panel} p-6 sm:p-10`}>
            <ShieldCheck className="h-7 w-7" />
            <h2 className="mt-6 font-display text-2xl font-bold sm:text-3xl">{t("store.deliveryNote")}</h2>
            <p className={`mt-3 max-w-md text-sm ${panelMuted}`}>{t("store.step2d")}</p>
          </div>
          <div className="flex flex-col justify-between gap-6 rounded-[28px] bg-ink p-6 text-[color:hsl(var(--cream))] sm:p-10">
            <div><p className="eyebrow-invert">{t("store.supportTitle")}</p><p className="mt-3 text-sm text-[color:hsl(var(--cream)/.75)]">{t("store.supportSub")}</p></div>
            <Button asChild className="h-12 w-fit border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-neon)] px-6 font-semibold text-[color:var(--brand-ink)]" data-testid="home-support-cta"><Link to="/chat"><MessageCircle className="mr-2 h-4 w-4" />{t("store.supportCta")}</Link></Button>
          </div>
        </section>

        <Faq />
      </div>
      <BackToTop />
    </div>
  );
}
