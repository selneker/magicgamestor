import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, sessionId } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/common/ErrorState";
import { usePageMeta } from "@/lib/catalog";

export default function Events() {
  const { t, lang } = useLang();
  usePageMeta(t("seo.eventsTitle"), t("seo.eventsDescription"));
  const [events, setEvents] = useState([]);
  const [liked, setLiked] = useState(() => new Set(JSON.parse(localStorage.getItem("mgs_liked") || "[]")));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setError(null);
    setLoading(true);
    api.get("/events")
      .then((r) => { setEvents(Array.isArray(r.data) ? r.data : []); setLoading(false); })
      .catch(() => { setLoading(false); setError(true); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
      {loading ? (
        <div className="mt-10 grid gap-6 md:grid-cols-2" data-testid="events-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card-lift flex flex-col overflow-hidden border border-foreground bg-card rounded-lg p-6">
              <div className="h-40 w-full rounded-t-lg bg-muted animate-pulse" />
              <h2 className="mt-4 h-8 w-3/4 rounded bg-muted animate-pulse" />
              <p className="mt-3 h-4 w-1/2 rounded bg-muted animate-pulse" />
              <div className="mt-auto pt-4"><div className="h-8 w-1/3 rounded bg-muted animate-pulse" /></div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState title={t("common.error")} description={t("events.error")} retryLabel={t("common.retry")} onRetry={reload} className="mt-10" />
      ) : events.length === 0 ? (
        <p className="mt-10 text-muted-foreground" data-testid="events-empty">{t("events.empty")}</p>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {events.map((ev) => (
            <article key={ev.id} id={ev.slug} data-testid={`event-card-${ev.slug}`} className="card-lift flex flex-col overflow-hidden border border-foreground bg-card">
              <div className="relative h-52 border-b border-foreground">
                {ev.image_url && <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-full w-full object-cover" loading="lazy" />}
                {ev.badge && <span className="absolute right-0 top-0 bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-primary-foreground">{ev.badge}</span>}
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
      )}
    </div>
  );
}
