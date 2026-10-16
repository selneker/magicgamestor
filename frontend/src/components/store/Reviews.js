import { useLang } from "@/context/LanguageContext";

export function Reviews({ reviews = [] }) {
  const { t } = useLang();
  if (!Array.isArray(reviews) || reviews.length === 0) return null;

  return (
    <section className="mt-20" aria-labelledby="reviews-title" data-testid="reviews">
      <div className="border-b pb-4">
        <h2 id="reviews-title" className="font-display text-2xl font-bold tracking-tight sm:text-4xl">{t("reviews.title")}</h2>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((review) => (
          <article key={review.id || `${review.name}-${review.text}`} className="rounded-[18px] border-2 border-[color:var(--rule)] bg-card p-5">
            <p className="text-sm leading-relaxed">{review.text}</p>
            <p className="mt-4 text-xs font-bold">{review.name || t("reviews.customer")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[review.game, review.pack].filter(Boolean).join(" · ")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
