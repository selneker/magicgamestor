import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUp, ArrowUpRight, ChevronLeft, ChevronRight, Gamepad2, HelpCircle, Lock, MessageCircle, Receipt, ShieldCheck, Wallet, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useGames } from "@/context/GameContext";
import { useLang, localized } from "@/context/LanguageContext";
import { ProductCard } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { usePageMeta } from "@/lib/catalog";
import ucBackground from "@/assets/carousel-uc.jpg";
import primeBackground from "@/assets/carousel-prime.jpg";

const rise = (i = 0) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.06 * i, duration: 0.45, ease: "easeOut" } });

export function GameLogo({ game, className = "h-14 w-14" }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A] ${className}`}>
      {game.icon_url && !broken
        ? <img src={game.icon_url} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />
        : <Gamepad2 className="h-1/2 w-1/2" strokeWidth={2} aria-hidden="true" />}
    </span>
  );
}

function SectionHead({ eyebrow, title, sub, action }) {
  return (
    <div className="section-head flex flex-wrap items-end justify-between gap-3 border-b-2 pb-4">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {sub && <p className="mt-2 max-w-xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const SLIDE_GRADIENTS = {
  uc: "linear-gradient(135deg,#0a1636 0%,#1b1152 55%,#3a1060 100%)",
  prime: "linear-gradient(135deg,#0b1030 0%,#241049 60%,#3d0f5c 100%)",
  manual: "linear-gradient(140deg,#0c1838 0%,#1a1046 60%,#2e0f52 100%)",
};

// Thin luminous "viewfinder" lines over the slide — decorative, pointer-none.
function HudFrame() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="0.12">
        <line x1="0" y1="20" x2="100" y2="20" />
        <line x1="0" y1="80" x2="100" y2="80" />
        <rect x="26" y="26" width="48" height="48" />
      </g>
      <g fill="none" stroke="hsl(72 99% 50%)" strokeOpacity="0.55" strokeWidth="0.22">
        <path d="M26 31 V26 H31" /><path d="M69 26 H74 V31" />
        <path d="M74 69 V74 H69" /><path d="M31 74 H26 V69" />
      </g>
    </svg>
  );
}

function Hero({ event }) {
  const { t, lang } = useLang();
  const trackRef = useRef(null);
  const pausedRef = useRef(false);
  const reduceRef = useRef(false);
  const [active, setActive] = useState(0);

  const slides = [
    { id: "uc", title: t("hero.ucTitle"), sub: t("hero.ucSub"), cta: t("hero.ucCta"), to: "/boutique?type=uc", testid: "hero-cta-uc", image: ucBackground },
    { id: "prime", title: t("hero.primeTitle"), sub: t("hero.primeSub"), cta: t("hero.primeCta"), to: "/boutique?type=prime,prime_plus", testid: "hero-cta-prime", image: primeBackground },
    ...(event ? [{ id: "event", title: localized(event, "title", lang), sub: localized(event, "description", lang) || t("hero.eventSub"), cta: t("hero.eventCta"), to: "/evenements", testid: "hero-cta-event", image: event.image_url || ucBackground, badge: event.badge || t("common.promo") }] : []),
    { id: "manual", title: t("hero.manualTitle"), sub: t("hero.manualSub"), cta: t("hero.manualCta"), to: "/boutique", testid: "hero-cta-manual" },
  ];
  const n = slides.length;

  useEffect(() => { reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);

  const goTo = (i) => {
    const el = trackRef.current; if (!el) return;
    el.scrollTo({ left: (((i % n) + n) % n) * el.clientWidth, behavior: reduceRef.current ? "auto" : "smooth" });
  };

  useEffect(() => {
    if (reduceRef.current || n < 2) return;
    const id = setInterval(() => { if (!pausedRef.current) goTo(active + 1); }, 5500);
    return () => clearInterval(id);
  }, [active, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => { const el = trackRef.current; if (el) setActive(Math.round(el.scrollLeft / el.clientWidth)); };
  const onKeyDown = (e) => { if (e.key === "ArrowLeft") { e.preventDefault(); goTo(active - 1); } else if (e.key === "ArrowRight") { e.preventDefault(); goTo(active + 1); } };
  const pause = () => { pausedRef.current = true; };
  const resume = () => { pausedRef.current = false; };

  return (
    <section className="mt-6" data-testid="hero">
      <div role="region" aria-roledescription="carousel" aria-label={t("hero.carouselLabel")} tabIndex={0} onKeyDown={onKeyDown}
        className="brutal-panel relative overflow-hidden rounded-[10px] border-2 focus-visible:outline-2 focus-visible:outline-[hsl(var(--primary))]">
        <div ref={trackRef} onScroll={onScroll} onPointerDown={pause} onPointerUp={resume} onPointerCancel={resume} onMouseEnter={pause} onMouseLeave={resume} onFocusCapture={pause} onBlurCapture={resume}
          className="no-scrollbar flex h-[80svh] min-h-[460px] w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden sm:h-[70svh] sm:max-h-[720px]">
          {slides.map((s, i) => (
            <div key={s.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${n}`} aria-hidden={active !== i}
              className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden">
              {s.image
                ? <img src={s.image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover" style={{ filter: "blur(5px)" }} loading={i < 2 ? "eager" : "lazy"} />
                : <div className="absolute inset-0" style={{ background: SLIDE_GRADIENTS[s.id] }} />}
              <div className="grain absolute inset-0" aria-hidden="true" />
              <HudFrame />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/45" aria-hidden="true" />
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
                {s.badge && <span className="mb-5 rounded-full border border-white/30 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">{s.badge}</span>}
                <h1 data-testid={active === i ? "hero-rotating-title" : undefined}
                  className="max-w-3xl font-display text-4xl font-bold leading-[1.03] tracking-[-0.02em] drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:text-5xl lg:text-6xl">{s.title}</h1>
                <p className="mt-5 max-w-md text-sm leading-relaxed text-white/85 sm:text-base">{s.sub}</p>
                <Button asChild size="lg" className="brutal-button mt-8 h-12 rounded-[8px] px-8 text-sm font-semibold hover-slide">
                  <Link to={s.to} data-testid={s.testid}>{s.cta}<ArrowRight className="ml-1.5 h-4 w-4" /></Link>
                </Button>
              </div>
            </div>
          ))}
        </div>

        <button type="button" aria-label={t("hero.prev")} onClick={() => goTo(active - 1)} data-testid="hero-prev"
          className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:flex">
          <ChevronLeft className="h-5 w-5" /></button>
        <button type="button" aria-label={t("hero.next")} onClick={() => goTo(active + 1)} data-testid="hero-next"
          className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:flex">
          <ChevronRight className="h-5 w-5" /></button>

        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" role="tablist" aria-label={t("hero.carouselLabel")}>
          {slides.map((s, i) => (
            <button key={s.id} type="button" role="tab" aria-selected={active === i} aria-label={`${t("hero.goTo")} ${i + 1}`} onClick={() => goTo(i)} data-testid={`hero-dot-${i}`}
              className={`h-2 rounded-full transition-all duration-300 ${active === i ? "w-8 bg-primary" : "w-2 bg-white/50 hover:bg-white/80"}`} />
          ))}
        </div>
      </div>

      {/* Trust band + payment methods (kept from the old hero) */}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_auto]" data-testid="hero-trust">
        {[[Zap, t("hero.trust1t"), t("hero.trust1d")], [Lock, t("hero.trust2t"), t("hero.trust2d")], [MessageCircle, t("hero.trust3t"), t("hero.trust3d")]].map(([Icon, title, desc]) => (
          <div key={title} className="brutal-card flex items-center gap-3 border-2 bg-card p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]"><Icon className="h-5 w-5" strokeWidth={2} /></span>
            <div className="min-w-0"><p className="font-display text-sm font-bold leading-tight">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{desc}</p></div>
          </div>
        ))}
        <div className="panel-neon flex flex-col justify-center gap-2 p-4" data-testid="hero-pay-card">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4" /><p className="text-[10px] font-semibold uppercase tracking-[0.18em]">{t("store.payTitle")}</p></div>
          <div className="flex flex-wrap gap-1.5">
            {["MVola", "Orange Money", "Binance USDT"].map((m) => <span key={m} className="rounded-full border border-[#0A0A0A]/30 px-2.5 py-0.5 text-[11px] font-semibold">{m}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function Steps() {
  const { t } = useLang();
  const steps = [[t("store.step1"), t("store.step1d")], [t("store.step2"), t("store.step2d")], [t("store.step3"), t("store.step3d")]];
  return (
    <section className="mt-20" data-testid="home-steps">
      <SectionHead eyebrow="01 — 03" title={t("store.stepsTitle")} />
      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {steps.map(([title, desc], i) => (
          <li key={title} className={`rounded-[16px] border p-6 sm:p-8 ${i === 1 ? "bg-foreground text-background" : "bg-card"}`}>
            <span className={`num text-4xl ${i === 1 ? "text-primary" : "text-muted-foreground"}`}>0{i + 1}</span>
            <h3 className="mt-6 font-display text-xl font-bold">{title}</h3>
            <p className={`mt-2 text-sm leading-relaxed ${i === 1 ? "text-background/70" : "text-muted-foreground"}`}>{desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function GamesBento({ games, selectGame }) {
  const { t, lang } = useLang();
  return (
    <section className="mt-20" data-testid="home-game-selection">
      <SectionHead eyebrow={t("games.title")} title={t("store.gamesTitle")} sub={t("store.gamesSub")} />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g, i) => (
          <Link key={g.id} to={`/boutique?game=${g.id}`} onClick={() => selectGame(g.id)} data-testid={`home-game-${g.slug || g.id}`}
            className={`brutal-card card-lift group relative flex min-h-[200px] flex-col justify-between overflow-hidden border-2 bg-card p-6 ${i === 0 && games.length === 2 ? "sm:col-span-2" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <GameLogo game={g} className="h-16 w-16" />
              <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <div className="mt-8">
              <p className="font-display text-2xl font-bold uppercase leading-tight">{g.name}</p>
              {(localized(g, "description", lang)) && <p className="mt-1 text-sm text-muted-foreground">{localized(g, "description", lang)}</p>}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {(g.product_types || []).map((pt) => <span key={pt.key} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]">{(lang === "en" && pt.label_en) || pt.label}</span>)}
              </div>
            </div>
          </Link>
        ))}
        {games.length === 0 && <p className="text-sm text-muted-foreground" data-testid="home-games-empty">{t("games.empty")}</p>}
      </div>
    </section>
  );
}

function WhyChoose() {
  const { t } = useLang();
  const items = [
    [ShieldCheck, t("store.why1t"), t("store.why1d")],
    [Wallet, t("store.why2t"), t("store.why2d")],
    [Receipt, t("store.why3t"), t("store.why3d")],
    [MessageCircle, t("store.why4t"), t("store.why4d")],
  ];
  return (
    <section className="mt-20" data-testid="home-why">
      <SectionHead eyebrow={t("store.whyEyebrow")} title={t("store.whyTitle")} sub={t("store.whySub")} />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([Icon, title, desc], i) => (
          <motion.div key={title} {...rise(i)} className="card-lift flex flex-col gap-4 rounded-[16px] border bg-card p-6" data-testid={`home-why-${i}`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]"><Icon className="h-5 w-5" strokeWidth={2} /></span>
            <div>
              <h3 className="font-display text-lg font-bold leading-tight">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const { t } = useLang();
  const qa = [
    [t("store.faq1q"), t("store.faq1a")],
    [t("store.faq2q"), t("store.faq2a")],
    [t("store.faq3q"), t("store.faq3a")],
    [t("store.faq4q"), t("store.faq4a")],
  ];
  return (
    <section className="mt-20" data-testid="home-faq">
      <SectionHead eyebrow={t("store.faqEyebrow")} title={t("store.faqTitle")}
        action={<span className="hidden h-12 w-12 items-center justify-center rounded-[12px] border border-[color:var(--rule-strong)] bg-foreground text-background sm:flex"><HelpCircle className="h-5 w-5" /></span>} />
      <Accordion type="single" collapsible className="mt-6 overflow-hidden rounded-[16px] border bg-card">
        {qa.map(([q, a], i) => (
          <AccordionItem key={i} value={`faq-${i}`} className="border-b px-5 last:border-b-0" data-testid={`home-faq-item-${i}`}>
            <AccordionTrigger className="py-5 text-left font-display text-base font-bold hover:no-underline">{q}</AccordionTrigger>
            <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

// Horizontal, card-by-card (scroll-snap) product row with a left header and a
// "See more" link on the right. Cards keep peeking so touch scroll is discoverable.
function ProductRow({ eyebrow, title, sub, products, seeMoreTo, gridTestid, moreTestid }) {
  const { t } = useLang();
  return (
    <section className="mt-16" data-testid={`${gridTestid}-section`}>
      <div className="flex items-end justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          {sub && <p className="mt-1.5 text-sm text-muted-foreground">{sub}</p>}
        </div>
        <Link to={seeMoreTo} data-testid={moreTestid} className="group inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">
          {t("common.seeMore")}<ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="no-scrollbar -mx-4 mt-6 flex w-fit max-w-full snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" data-testid={gridTestid}>
        {products === null && Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-[40vw] max-w-[11.5rem] shrink-0 snap-start sm:w-44">
            <Skeleton className="aspect-[4/5] w-full rounded-[20px]" />
            <Skeleton className="mt-2 h-4 w-3/4 rounded" />
            <Skeleton className="mt-2 h-4 w-1/2 rounded" />
          </div>
        ))}
        {products?.map((p, i) => (
          <div key={p.id} className="w-[40vw] max-w-[11.5rem] shrink-0 snap-start sm:w-44">
            <ProductCard product={p} index={i} />
          </div>
        ))}
      </div>
      {products?.length === 0 && <p className="mt-2 text-sm text-muted-foreground" data-testid={`${gridTestid}-empty`}>{t("store.noOffers")}</p>}
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
  usePageMeta(null, t("store.heroSub"));
  useEffect(() => {
    api.get("/products", { params: { popular: true } }).then((r) => setProducts(r.data.slice(0, 10))).catch(() => setProducts([]));
    api.get("/products", { params: { type: "prime,prime_plus" } }).then((r) => setSubs(r.data.slice(0, 10))).catch(() => setSubs([]));
    api.get("/events").then((r) => setEvents(r.data.slice(0, 1))).catch(() => {});
  }, []);
  const shopUrl = games.length === 1 ? `/boutique?game=${games[0].id}` : "/boutique";
  const popularIds = new Set((products || []).map((product) => product.id));
  const visibleSubs = subs?.filter((product, index, list) => !popularIds.has(product.id) && list.findIndex((item) => item.id === product.id) === index);

  return (
    <div className="pb-28">
      <Hero event={events[0]} />
      <GamesBento games={games} selectGame={selectGame} />

      <ProductRow eyebrow={t("catalog.popular")} title={t("store.offersTitle")} sub={t("store.offersSub")} products={products} seeMoreTo={shopUrl} gridTestid="popular-grid" moreTestid="see-all-link" />

      <ProductRow eyebrow={t("catalog.prime")} title={t("common.subsTitle")} sub={t("common.subsSub")} products={visibleSubs} seeMoreTo={`${shopUrl}${shopUrl.includes("?") ? "&" : "?"}type=prime,prime_plus`} gridTestid="subs-grid" moreTestid="subs-more-link" />

      <Steps />

      <WhyChoose />

      {events.map((ev) => (
        <section key={ev.id} className="mt-20 overflow-hidden rounded-[18px] border bg-card lg:grid lg:grid-cols-2" data-testid="home-event">
          <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-56 w-full border-b object-cover lg:h-full lg:border-b-0 lg:border-r" loading="lazy" />
          <div className="p-6 sm:p-10">
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0A0A0A]">{t("common.promo")}</span>
            <h2 className="mt-4 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">{localized(ev, "title", lang)}</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{localized(ev, "description", lang)}</p>
            <div className="mt-6 flex items-end gap-3"><span className="num text-3xl sm:text-4xl">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-sm text-muted-foreground line-through">{ev.old_price_label}</span>}</div>
            <Button asChild className="mt-8 h-12 px-7" data-testid="home-event-cta"><Link to={ev.product_slug ? `/produit/${ev.product_slug}` : "/evenements"}>{t("events.buy")}</Link></Button>
          </div>
        </section>
      ))}

      <section className="mt-20 grid gap-3 md:grid-cols-[1.4fr_1fr]" data-testid="home-support">
        <div className="rounded-[18px] border bg-card p-6 sm:p-10">
          <ShieldCheck className="h-7 w-7" />
          <h2 className="mt-6 font-display text-2xl font-bold sm:text-3xl">{t("store.deliveryNote")}</h2>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">{t("store.step2d")}</p>
        </div>
        <div className="panel-black flex flex-col justify-between gap-6 p-6 sm:p-10">
          <div><p className="eyebrow-invert">{t("store.supportTitle")}</p><p className="mt-3 text-sm text-background/75">{t("store.supportSub")}</p></div>
          <Button asChild className="h-12 w-fit px-6" data-testid="home-support-cta"><Link to="/chat"><MessageCircle className="mr-2 h-4 w-4" />{t("store.supportCta")}</Link></Button>
        </div>
      </section>

      <Faq />
      <BackToTop />
    </div>
  );
}
