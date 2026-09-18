import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, sessionId } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

export default function Events() {
  const { t, lang } = useLang();
  const [events, setEvents] = useState([]);
  const [liked, setLiked] = useState(() => new Set(JSON.parse(localStorage.getItem("mgs_liked") || "[]")));

  useEffect(() => { api.get("/events").then((r) => setEvents(r.data)).catch(() => {}); }, []);

  const like = async (ev) => {
    const { data } = await api.post(`/events/${ev.id}/like`, { session_id: sessionId() });
    setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, likes: data.likes } : e)));
    const next = new Set(liked); data.liked ? next.add(ev.id) : next.delete(ev.id);
    setLiked(next); localStorage.setItem("mgs_liked", JSON.stringify([...next]));
  };
  const share = async (ev) => {
    const url = `${window.location.origin}/evenements#${ev.slug}`;
    try { if (navigator.share) await navigator.share({ title: localized(ev, "title", lang), url }); else { await navigator.clipboard.writeText(url); toast.success(t("events.shared")); } } catch (_) { return; }
    const { data } = await api.post(`/events/${ev.id}/share`, { session_id: sessionId() });
    setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, shares: data.shares } : e)));
  };

  return (
    <div className="pb-24 pt-6">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Magic Game Store</p>
      <h1 className="font-display text-3xl font-bold text-slate-900 sm:text-4xl">{t("events.title")}</h1>
      <p className="mt-1 text-slate-500">{t("events.subtitle")}</p>
      {events.length === 0 && <p className="mt-10 text-slate-500" data-testid="events-empty">{t("events.empty")}</p>}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {events.map((ev) => (
          <article key={ev.id} id={ev.slug} data-testid={`event-card-${ev.slug}`} className="card-lift overflow-hidden rounded-[2rem] border border-slate-100 bg-white">
            <div className="relative h-52">
              {ev.image_url && <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-full w-full object-cover" loading="lazy" />}
              <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-slate-900 backdrop-blur">Magic Game Store ✓</span>
              {ev.badge && <span className="absolute right-4 top-4 rounded-full bg-orange-500 px-3 py-1 text-xs font-bold uppercase text-white">{ev.badge}</span>}
            </div>
            <div className="p-6">
              <h2 className="font-display text-2xl font-bold text-slate-900">{localized(ev, "title", lang)}</h2>
              <p className="mt-2 text-sm text-slate-500">{localized(ev, "description", lang)}</p>
              {ev.price_label && <div className="mt-4 flex items-end gap-3"><span className="font-display text-3xl font-bold text-primary">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-slate-400 line-through">{ev.old_price_label}</span>}</div>}
              {ev.product_slug && <Button asChild className="mt-5 w-full rounded-full font-bold" data-testid={`event-cta-${ev.slug}`}><Link to={`/produit/${ev.product_slug}`}>{t("events.buy")}</Link></Button>}
              <div className="mt-5 flex items-center gap-4 border-t pt-4 text-sm font-semibold text-slate-500">
                <button data-testid={`event-like-${ev.slug}`} onClick={() => like(ev)} className={`inline-flex items-center gap-1.5 transition-colors ${liked.has(ev.id) ? "text-rose-500" : "hover:text-rose-500"}`}><Heart className={`h-4 w-4 ${liked.has(ev.id) ? "fill-current" : ""}`} />{ev.likes}</button>
                <button data-testid={`event-share-${ev.slug}`} onClick={() => share(ev)} className="inline-flex items-center gap-1.5 hover:text-primary"><Share2 className="h-4 w-4" />{ev.shares}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
