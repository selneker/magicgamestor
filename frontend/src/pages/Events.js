import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, sessionId } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
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
    <div className="container section page-top page-bottom" style={{ maxWidth: "78em" }}>
      <p className="eyebrow">Magic Game Store</p>
      <h1 className="h-l">{t("events.title")}</h1>
      <p className="p-m" style={{ marginTop: ".5em" }}>{t("events.subtitle")}</p>
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2" style={{ marginTop: "2em" }} data-testid="events-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="review-card">
              <div className="h-40 w-full rounded-[1em] bg-muted animate-pulse" />
              <h2 className="mt-4 h-8 w-3/4 rounded bg-muted animate-pulse" />
              <p className="mt-3 h-4 w-1/2 rounded bg-muted animate-pulse" />
              <div className="mt-auto pt-4"><div className="h-8 w-1/3 rounded bg-muted animate-pulse" /></div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState title={t("common.error")} description={t("events.error")} retryLabel={t("common.retry")} onRetry={reload} className="mt-10" />
      ) : events.length === 0 ? (
        <p className="p-m" style={{ marginTop: "2em" }} data-testid="events-empty">{t("events.empty")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2" style={{ marginTop: "2em" }}>
          {events.map((ev) => (
            <article key={ev.id} id={ev.slug} data-testid={`event-card-${ev.slug}`} className="review-card" style={{ padding: 0, overflow: "hidden", gap: 0 }}>
              <div className="relative h-52" style={{ borderBottom: ".125em solid var(--color--dark)" }}>
                {ev.image_url && <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-full w-full object-cover" loading="lazy" />}
                {ev.badge && <span className="badge-pop" style={{ position: "absolute", right: ".6em", top: ".6em" }}>{ev.badge}</span>}
              </div>
              <div className="flex flex-1 flex-col" style={{ padding: "1.4em" }}>
                <h2 className="h-c">{localized(ev, "title", lang)}</h2>
                <p className="p-m" style={{ marginTop: ".6em" }}>{localized(ev, "description", lang)}</p>
                {ev.price_label && <div className="flex items-end gap-3" style={{ marginTop: "1em", borderTop: "1px solid hsl(0 0% 7% / .12)", paddingTop: "1em" }}><span className="num" style={{ fontSize: "1.8em", fontWeight: 800 }}>{ev.price_label}</span>{ev.old_price_label && <span className="p-m" style={{ textDecoration: "line-through", opacity: .6 }}>{ev.old_price_label}</span>}</div>}
                {ev.product_slug && (
                  <Link to={`/produit/${ev.product_slug}`} className="button-main" data-button-theme="dark" data-button-accent="violet" data-testid={`event-cta-${ev.slug}`} style={{ marginTop: "1em", width: "100%" }}>
                    <span className="button-main-inner full-h">
                      <span className="button-main-inner__back" data-text={t("events.buy")}></span>
                      <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("events.buy")}</span></span></span>
                    </span>
                  </Link>
                )}
                <div className="flex items-center gap-3" style={{ marginTop: "auto", paddingTop: "1em" }}>
                  <button data-testid={`event-like-${ev.slug}`} onClick={() => like(ev)} aria-pressed={liked.has(ev.id)} className="chip min-h-11"><Heart className={`h-4 w-4 ${liked.has(ev.id) ? "fill-current" : ""}`} strokeWidth={2} />{ev.likes}</button>
                  <button data-testid={`event-share-${ev.slug}`} onClick={() => share(ev)} className="chip min-h-11"><Share2 className="h-4 w-4" strokeWidth={2} />{ev.shares}</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
