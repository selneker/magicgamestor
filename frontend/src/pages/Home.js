import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUp, ArrowUpRight, Gamepad2, HelpCircle, MessageCircle, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useGames } from "@/context/GameContext";
import { useLang, localized } from "@/context/LanguageContext";
import { StatusBadge } from "@/components/layout/Header";
import { ProductCard } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { usePageMeta } from "@/lib/catalog";

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
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {sub && <p className="mt-2 max-w-xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Hero({ games, shopUrl }) {
  const { t } = useLang();
  return (
    <section className="mt-6 grid gap-3 lg:grid-cols-12 lg:grid-rows-[auto_auto]" data-testid="hero">
      <motion.div {...rise(0)} className="grain relative overflow-hidden rounded-[18px] border bg-card p-6 sm:p-10 lg:col-span-8 lg:row-span-2 lg:p-14">
        <div className="flex flex-wrap items-center gap-3"><p className="eyebrow">{t("store.heroEyebrow")}</p><StatusBadge /></div>
        <h1 className="mt-8 max-w-3xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-7xl" data-testid="hero-title">
          <span className="block">{t("store.heroA")}</span>
          <span className="mt-2 inline-block rounded-[8px] bg-primary px-2 text-[#0A0A0A]">{t("store.heroB")}</span>
        </h1>
        <p className="mt-8 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">{t("store.heroSub")}</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-12 px-7 text-sm hover-slide" data-testid="hero-cta-shop"><Link to={shopUrl}>{t("store.ctaShop")}<ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-7 text-sm" data-testid="hero-cta-track"><Link to="/suivi">{t("store.ctaTrack")}</Link></Button>
        </div>
        <div className="mt-10 grid max-w-xl grid-cols-3 border-t border-[color:var(--rule)] pt-4">
          {[t("store.step1"), t("store.step2"), t("store.step3")].map((label, index) => (
            <div key={label} className="pr-3 first:border-r last:border-l last:pl-3 sm:pr-5 sm:last:pl-5">
              <span className="num text-lg text-primary">0{index + 1}</span>
              <p className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-muted-foreground sm:text-[11px]">{label}</p>
            </div>
          ))}
        </div>
      </motion.div>
      <motion.div {...rise(1)} className="panel-black flex flex-col justify-between gap-6 p-6 sm:p-8 lg:col-span-4" data-testid="hero-games-card">
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow-invert">{t("store.gamesTitle")}</p>
          <span className="num text-5xl leading-none text-primary" data-testid="hero-games-count">{games.length}</span>
        </div>
        <p className="max-w-xs text-sm text-background/70">{t("store.gamesSub")}</p>
        <div className="flex flex-wrap gap-2">
          {games.map((g) => (
            <Link key={g.id} to={`/boutique?game=${g.id}`} className="group flex items-center gap-2 rounded-full border border-background/25 py-1 pl-1 pr-3 transition-colors hover:bg-primary hover:text-[#0A0A0A]" data-testid={`hero-game-${g.id}`}>
              <GameLogo game={g} className="h-8 w-8 rounded-full" /><span className="text-xs font-semibold">{g.name}</span>
            </Link>
          ))}
        </div>
      </motion.div>
      <motion.div {...rise(2)} className="panel-black flex flex-col justify-between gap-5 p-6 sm:p-8 lg:col-span-4" data-testid="hero-trust">
        <div>
          <p className="eyebrow-invert">{t("store.stepsTitle")}</p>
          <ol className="mt-3 grid gap-2">
            {[[t("store.step1"), Gamepad2], [t("store.step2"), ShieldCheck], [t("store.step3"), Receipt]].map(([label, Icon], i) => (
              <li key={label} className="flex items-center gap-2 text-xs text-background/85"><span className="flex h-7 w-7 shrink-0 items-center justify-center border border-primary bg-primary font-display text-sm font-bold text-[#0A0A0A]">{i + 1}</span><span>{label}</span><Icon className="ml-auto h-3.5 w-3.5 text-primary" aria-hidden="true" /></li>
            ))}
          </ol>
        </div>
        <div className="border-t border-background/20 pt-4"><div className="flex items-center gap-2 text-primary"><Wallet className="h-4 w-4" aria-hidden="true" /><p className="text-[10px] font-semibold uppercase tracking-[0.18em]">{t("store.payTitle")}</p></div><div className="mt-2 flex flex-wrap gap-1.5">{["MVola", "Orange Money", "Binance USDT"].map((m) => <span key={m} className="border border-background/30 px-2.5 py-0.5 text-[11px] font-semibold text-background">{m}</span>)}</div></div>
        <Link to="/chat" className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-primary bg-primary px-4 text-xs font-bold text-[#0A0A0A] transition-transform hover:-translate-y-0.5" data-testid="hero-support-link"><MessageCircle className="h-4 w-4" aria-hidden="true" />{t("store.supportCta")}</Link>
      </motion.div>
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
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {games.map((g, i) => (
          <Link key={g.id} to={`/boutique?game=${g.id}`} onClick={() => selectGame(g.id)} data-testid={`home-game-${g.slug || g.id}`}
            className={`card-lift group relative flex min-h-[200px] flex-col justify-between overflow-hidden rounded-[16px] border bg-card p-6 ${i === 0 && games.length === 2 ? "sm:col-span-2" : ""}`}>
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
    Promise.all([
      api.get("/products", { params: { popular: true } }),
      api.get("/products", { params: { type: "prime,prime_plus" } }),
      api.get("/products", { params: { type: "evo" } }),
    ]).then(([popularResponse, primeResponse, evoResponse]) => {
      const unique = new Map();
      [...popularResponse.data, ...primeResponse.data, ...evoResponse.data].forEach((product) => unique.set(product.id, product));
      const all = [...unique.values()];
      const selected = [
        ...all.filter((product) => Number(product.uc_amount) > 0).slice(0, 2),
        ...all.filter((product) => ["prime", "prime_plus"].includes(product.type)).slice(0, 1),
        ...all.filter((product) => product.type === "evo").slice(0, 1),
      ];
      setProducts([...new Map(selected.map((product) => [product.id, product])).values()].slice(0, 4));
      setSubs(primeResponse.data.slice(0, 8));
    }).catch(() => { setProducts([]); setSubs([]); });
    api.get("/events").then((r) => setEvents(r.data.slice(0, 1))).catch(() => {});
  }, []);
  const shopUrl = games.length === 1 ? `/boutique?game=${games[0].id}` : "/boutique";
  const subsUrl = `${shopUrl}${shopUrl.includes("?") ? "&" : "?"}type=prime,prime_plus`;
  const popularIds = new Set((products || []).map((product) => product.id));
  const visibleSubs = subs?.filter((product, index, list) => !popularIds.has(product.id) && list.findIndex((item) => item.id === product.id) === index);

  return (
    <div className="pb-28">
      <Hero games={games} shopUrl={shopUrl} />
      <GamesBento games={games} selectGame={selectGame} />

      <section className="mt-20">
        <SectionHead eyebrow={t("catalog.popular")} title={t("store.offersTitle")} sub={t("store.offersSub")}
          action={<Link to={shopUrl} data-testid="see-all-link" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">{t("common.seeAll")}<ArrowRight className="h-3.5 w-3.5" /></Link>} />
        <div className="mt-6 grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="popular-grid">
          {products === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-[14px]" />)}
          {products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} displayPopular />)}
        </div>
        {products?.length === 0 && <p className="mt-6 text-sm text-muted-foreground" data-testid="popular-empty">{t("store.noOffers")}</p>}
      </section>

      <section className="mt-20" data-testid="subs-section">
        <SectionHead eyebrow={t("catalog.prime")} title={t("common.subsTitle")} sub={t("common.subsSub")}
          action={<Link to={subsUrl} data-testid="subs-more-link" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">{t("common.seeAll")}<ArrowRight className="h-3.5 w-3.5" /></Link>} />
        <div className="mt-6 grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="subs-grid">
          {subs === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-[14px]" />)}
          {visibleSubs?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
        {visibleSubs?.length === 0 && <p className="mt-6 text-sm text-muted-foreground" data-testid="subs-empty">{t("store.noOffers")}</p>}
      </section>

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
