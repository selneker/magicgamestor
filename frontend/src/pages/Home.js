import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { StatusBadge } from "@/components/layout/Header";
import { ProductCard } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { t, lang } = useLang();
  const [products, setProducts] = useState([]);
  const [events, setEvents] = useState([]);
  const [slide, setSlide] = useState(0);
  const rotating = t("hero.rotate");
  useEffect(() => {
    api.get("/products", { params: { popular: true } }).then((r) => setProducts(r.data)).catch(() => {});
    api.get("/events").then((r) => setEvents(r.data.slice(0, 1))).catch(() => {});
  }, []);
  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % rotating.length), 5200);
    return () => clearInterval(id);
  }, [rotating.length]);
  const current = rotating[slide] || rotating[0];

  return (
    <div className="pb-28">
      {/* HERO — editorial, asymmetric */}
      <section className="mt-6 border border-foreground bg-card" data-testid="hero">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground px-4 py-2.5 sm:px-8">
          <p className="eyebrow">{t("hero.eyebrow")}</p>
          <StatusBadge />
        </div>
        <div className="grid lg:grid-cols-[1.45fr_0.55fr]">
          <div className="px-4 py-10 sm:px-8 sm:py-16">
            <div className="min-h-[8rem] sm:min-h-[10.5rem] lg:min-h-[12rem]">
              <AnimatePresence mode="wait">
                <motion.h1 key={slide} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.4 }}
                  data-testid="hero-rotating-title"
                  className="max-w-3xl whitespace-pre-line font-display text-4xl font-black uppercase leading-[0.92] tracking-[-0.03em] text-foreground sm:text-6xl lg:text-7xl">
                  {current.split("\n").map((line, i) => (
                    <span key={i} className="block">{i === 1 ? <span className="bg-primary px-1.5 text-[#0A0A0A]">{line}</span> : line}</span>
                  ))}
                </motion.h1>
              </AnimatePresence>
            </div>
            <p className="mt-8 max-w-md text-sm text-muted-foreground sm:text-base">{t("hero.subtitle")}</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 px-7 text-sm" data-testid="hero-cta-uc"><Link to="/boutique?type=uc">{t("hero.ctaUc")}<ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-7 text-sm" data-testid="hero-cta-prime"><Link to="/boutique?type=prime,prime_plus">{t("hero.ctaPrime")}</Link></Button>
            </div>
            <div className="mt-10 flex gap-1.5" role="tablist" aria-label="Messages">
              {rotating.map((_, i) => (
                <button key={i} type="button" aria-label={`${i + 1}`} aria-selected={i === slide} role="tab" onClick={() => setSlide(i)}
                  className={`h-1 w-8 transition-colors ${i === slide ? "bg-foreground" : "bg-foreground/20"}`} />
              ))}
            </div>
          </div>
          <ul className="grid divide-y divide-foreground border-t border-foreground lg:border-l lg:border-t-0">
            {[[t("hero.trust1"), "01"], [t("hero.trust2"), "02"], [t("hero.trust3"), "03"]].map(([label, n]) => (
              <li key={n} className="flex items-baseline gap-4 px-4 py-6 sm:px-6">
                <span className="num text-2xl text-muted-foreground">{n}</span>
                <span className="text-sm font-bold uppercase tracking-tight">{label}</span>
              </li>
            ))}
            <li className="panel-black flex flex-wrap items-center gap-2 px-4 py-6 sm:px-6">
              <span className="eyebrow text-background/60">{t("checkout.payment")}</span>
              <span className="border border-background px-2 py-0.5 text-[11px] font-black uppercase">MVola</span>
              <span className="border border-background px-2 py-0.5 text-[11px] font-black uppercase">Orange Money</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-end justify-between border-b border-foreground pb-3">
          <div>
            <p className="eyebrow">{t("catalog.popular")}</p>
            <h2 className="font-display text-2xl font-black uppercase tracking-tight sm:text-3xl">{t("catalog.uc")} / Prime</h2>
          </div>
          <Link to="/boutique" data-testid="see-all-link" className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.14em] hover:text-muted-foreground">{t("common.seeAll")}<ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="popular-grid">
          {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      </section>

      {events.map((ev) => (
        <section key={ev.id} className="mt-20 border border-foreground bg-card lg:grid lg:grid-cols-2" data-testid="home-event">
          <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-56 w-full border-b border-foreground object-cover lg:h-full lg:border-b-0 lg:border-r" loading="lazy" />
          <div className="p-6 sm:p-10">
            <span className="bg-primary px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#0A0A0A]">{t("common.promo")}</span>
            <h2 className="mt-4 font-display text-2xl font-black uppercase leading-[0.95] tracking-tight sm:text-4xl">{localized(ev, "title", lang)}</h2>
            <p className="mt-4 text-sm text-muted-foreground">{localized(ev, "description", lang)}</p>
            <div className="mt-6 flex items-end gap-3"><span className="num text-3xl sm:text-4xl">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-sm text-muted-foreground line-through">{ev.old_price_label}</span>}</div>
            <Button asChild className="mt-8 h-12 px-7" data-testid="home-event-cta"><Link to={ev.product_slug ? `/produit/${ev.product_slug}` : "/evenements"}>{t("events.buy")}</Link></Button>
          </div>
        </section>
      ))}
    </div>
  );
}
