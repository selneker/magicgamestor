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
      <p className="eyebrow">Magic Game Store</p>
      <h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{t("events.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("events.subtitle")}</p>
      {events.length === 0 && <p className="mt-10 text-slate-500" data-testid="events-empty">{t("events.empty")}</p>}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {events.map((ev) => (
          <article key={ev.id} id={ev.slug} data-testid={`event-card-${ev.slug}`} className="card-lift flex flex-col overflow-hidden border border-foreground bg-card">
            <div className="relative h-52 border-b border-foreground">
              {ev.image_url && <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-full w-full object-cover" loading="lazy" />}
              {ev.badge && <span className="absolute right-0 top-0 bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-[#0A0A0A]">{ev.badge}</span>}
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h2 className="font-display text-2xl font-black uppercase leading-[0.95] tracking-tight">{localized(ev, "title", lang)}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{localized(ev, "description", lang)}</p>
              {ev.price_label && <div className="mt-5 flex items-end gap-3 border-t border-foreground pt-4"><span className="num text-3xl">{ev.price_label}</span>{ev.old_price_label && <span className="pb-1 text-sm text-muted-foreground line-through">{ev.old_price_label}</span>}</div>}
              {ev.product_slug && <Button asChild className="mt-5 h-12 w-full" data-testid={`event-cta-${ev.slug}`}><Link to={`/produit/${ev.product_slug}`}>{t("events.buy")}</Link></Button>}
              <div className="mt-auto flex items-center gap-5 pt-5 text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">
                <button data-testid={`event-like-${ev.slug}`} onClick={() => like(ev)} className={`inline-flex items-center gap-1.5 transition-colors ${liked.has(ev.id) ? "text-foreground" : "hover:text-foreground"}`}><Heart className={`h-4 w-4 ${liked.has(ev.id) ? "fill-current" : ""}`} strokeWidth={2} />{ev.likes}</button>
                <button data-testid={`event-share-${ev.slug}`} onClick={() => share(ev)} className="inline-flex items-center gap-1.5 hover:text-foreground"><Share2 className="h-4 w-4" strokeWidth={2} />{ev.shares}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
