import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, sessionId } from "@/lib/api";
import { useLang, localized } from "@/context/LanguageContext";
import { ErrorState } from "@/components/common/ErrorState";
import { usePageMeta } from "@/lib/catalog";
import { Icon } from "@/components/ui/icon";

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

  // PL-DS-V3 — page événements du prototype : mgs-head (eyebrow + mgs-title +
  // mgs-sub), grille mgs-grid--2 de mgs-card (media image réelle ou coloré,
  // chip, nom, description, pied CTA + like/share). Logique inchangée.
  return (
    <section className="section">
      <div className="container">
        <div className="mgs-shell">
          <div className="mgs-head">
            <p className="eyebrow">{t("events.eyebrow")}</p>
            <h1 className="mgs-title">{t("events.title")}</h1>
            <p className="mgs-sub">{t("events.subtitle")}</p>
          </div>
          {loading ? (
            <div className="mgs-grid mgs-grid--2" data-testid="events-loading">
              {[1, 2, 3].map((i) => (
                <div key={i} className="mgs-card">
                  <div className="mgs-card__media u--bg--yellow animate-pulse" style={{ aspectRatio: "16/10" }} />
                  <div className="h-8 w-3/4 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorState title={t("common.error")} description={t("events.error")} retryLabel={t("common.retry")} onRetry={reload} className="mt-10" />
          ) : events.length === 0 ? (
            <p className="mgs-sub" data-testid="events-empty">{t("events.empty")}</p>
          ) : (
            <div className="mgs-grid mgs-grid--2">
              {events.map((ev) => (
                <article key={ev.id} id={ev.slug} data-testid={`event-card-${ev.slug}`} className="mgs-card">
                  <div className={`mgs-card__media ${ev.image_url ? "" : "u--bg--yellow"}`} style={{ aspectRatio: "16/10" }}>
                    {ev.image_url
                      ? <img src={ev.image_url} alt={localized(ev, "title", lang)} className="h-full w-full object-cover" loading="lazy" />
                      : <Icon name="manette" className="bold-ic" />}
                    {ev.badge && <span className="mgs-chip" style={{ position: "absolute", right: ".6em", top: ".6em" }}>{ev.badge}</span>}
                  </div>
                  <h2 className="mgs-card__name" style={{ fontSize: "1.2em" }}>{localized(ev, "title", lang)}</h2>
                  <p className="mgs-card__desc">{localized(ev, "description", lang)}</p>
                  {ev.price_label && (
                    <div className="flex items-end gap-3">
                      <span className="num" style={{ fontSize: "1.8em", fontWeight: 800 }}>{ev.price_label}</span>
                      {ev.old_price_label && <span className="mgs-card__desc" style={{ textDecoration: "line-through", opacity: .6 }}>{ev.old_price_label}</span>}
                    </div>
                  )}
                  <div className="mgs-card__foot">
                    {ev.product_slug && (
                      <Link to={`/produit/${ev.product_slug}`} className="button-main" data-button-theme="dark" data-button-accent="yellow" data-testid={`event-cta-${ev.slug}`}>
                        <span className="button-main-inner full-h">
                          <span className="button-main-inner__back" data-text={t("events.buy")}></span>
                          <span className="button-main-inner__front"><span className="button-main-inner__bg"></span><span className="button-main-inner__text"><span>{t("events.buy")}</span></span></span>
                        </span>
                      </Link>
                    )}
                    <button data-testid={`event-like-${ev.slug}`} onClick={() => like(ev)} aria-pressed={liked.has(ev.id)} className="mgs-chip min-h-11"><Heart className={`h-4 w-4 ${liked.has(ev.id) ? "fill-current" : ""}`} strokeWidth={2} />{ev.likes}</button>
                    <button data-testid={`event-share-${ev.slug}`} onClick={() => share(ev)} className="mgs-chip min-h-11"><Share2 className="h-4 w-4" strokeWidth={2} />{ev.shares}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}