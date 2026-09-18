import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Zap, MessageCircle, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { StatusBadge } from "@/components/layout/Header";
import { ProductCard } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/button";

const HERO = "https://images.unsplash.com/photo-1564049489314-60d154ff107d?crop=entropy&cs=srgb&fm=jpg&q=80&w=1600";

export default function Home() {
  const { t, lang } = useLang();
  const [products, setProducts] = useState([]);
  const [events, setEvents] = useState([]);
  useEffect(() => {
    api.get("/products", { params: { popular: true } }).then((r) => setProducts(r.data)).catch(() => {});
    api.get("/events").then((r) => setEvents(r.data.slice(0, 1))).catch(() => {});
  }, []);

  return (
    <div className="pb-24">
      <section className="relative mt-4 overflow-hidden rounded-[2rem] bg-slate-950 text-white grain" data-testid="hero">
        <img src={HERO} alt="PUBG Mobile" className="absolute inset-0 h-full w-full object-cover opacity-50" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
        <div className="relative grid gap-10 px-6 py-14 sm:px-12 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <StatusBadge />
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.3em] text-[var(--pubg)]">{t("hero.eyebrow")}</p>
            <h1 className="mt-3 max-w-xl font-display text-4xl font-800 leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{t("hero.title")}</h1>
            <p className="mt-5 max-w-lg text-base text-slate-300 sm:text-lg">{t("hero.subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 rounded-full bg-[var(--pubg)] px-6 text-base font-bold text-slate-950 hover:bg-yellow-300" data-testid="hero-cta-uc"><Link to="/boutique?type=uc">{t("hero.ctaUc")}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/30 bg-white/10 px-6 text-base font-semibold text-white hover:bg-white/20" data-testid="hero-cta-prime"><Link to="/boutique?type=prime,prime_plus">{t("hero.ctaPrime")}</Link></Button>
            </div>
          </motion.div>
          <motion.ul initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.15 }} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[[Zap, t("hero.trust1")], [ShieldCheck, t("hero.trust2")], [MessageCircle, t("hero.trust3")]].map(([Icon, label]) => (
              <li key={label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md"><Icon className="h-5 w-5 text-[var(--pubg)]" /><span className="text-sm font-semibold">{label}</span></li>
            ))}
            <li className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
              <Smartphone className="h-5 w-5 text-[var(--pubg)]" />
              <span className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-md bg-[var(--mvola)] px-1.5 py-0.5 text-[10px]">MVola</span><span className="rounded-md bg-[var(--orange)] px-1.5 py-0.5 text-[10px]">Orange Money</span></span>
            </li>
          </motion.ul>
        </div>
      </section>

      <section className="mt-16">
        <div className="flex items-end justify-between">
          <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("catalog.popular")}</p><h2 className="font-display text-2xl font-bold text-slate-900 sm:text-3xl">{t("catalog.uc")} & Prime</h2></div>
          <Link to="/boutique" data-testid="see-all-link" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">{t("common.seeAll")}<ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="popular-grid">
          {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      </section>

      {events.map((ev) => (
        <section key={ev.id} className="mt-16 overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] lg:grid lg:grid-cols-2" data-testid="home-event">
          <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-56 w-full object-cover lg:h-full" loading="lazy" />
          <div className="p-8 sm:p-10">
            <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold uppercase text-orange-600">{t("common.promo")}</span>
            <h2 className="mt-4 font-display text-2xl font-bold text-slate-900 sm:text-3xl">{localized(ev, "title", lang)}</h2>
            <p className="mt-3 text-slate-500">{localized(ev, "description", lang)}</p>
            <div className="mt-6 flex items-end gap-3"><span className="font-display text-3xl font-bold text-primary">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-slate-400 line-through">{ev.old_price_label}</span>}</div>
            <Button asChild className="mt-6 rounded-full px-6 font-bold" data-testid="home-event-cta"><Link to={ev.product_slug ? `/produit/${ev.product_slug}` : "/evenements"}>{t("events.buy")}</Link></Button>
          </div>
        </section>
      ))}
    </div>
  );
}
