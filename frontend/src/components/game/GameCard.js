import { Link } from "react-router-dom";
import { Gamepad2, Star } from "lucide-react";
import { useState } from "react";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";

// PL-UI-GAMES-1 — Étoiles de note : ★ 4.8 (123). Règle stricte, le composant
// ne reçoit QUE des données réelles en props optionnelles ; s'il n'y a ni note
// ni avis réels (ou moins de 5 avis), il n'affiche RIEN — aucune valeur de
// secours, jamais de note/avis inventés dans le code livré.
export function RatingStars({ rating, reviewCount, testId = "game-rating" }) {
  const { lang } = useLang();
  const r = Number(rating);
  const c = Number(reviewCount);
  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(c) || c < 5) return null;
  const fmt = (n, opts) => Number(n).toLocaleString(lang === "en" ? "en-US" : "fr-FR", opts);
  return (
    <span
      data-testid={testId}
      className="flex shrink-0 items-center gap-1 text-[11px] font-semibold tabular-nums text-muted-foreground"
      aria-label={`${fmt(r, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5 — ${fmt(c)} ${(lang === "en" ? "reviews" : "avis")}`}
    >
      <Star className="h-3.5 w-3.5 text-[color:hsl(var(--primary))]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
      {fmt(r, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      <span className="font-normal">({fmt(c)})</span>
    </span>
  );
}

// PL-UI-GAMES-1 — Carte de jeu (style grille Bang Studio revisitée avec NOS
// jetons : fond `bg-card` une teinte au-dessus du fond, bordure 1 px, coins
// 24 px, vignette carrée 20 px). Elle n'utilise QUE les champs qui existent
// réellement côté `/api/games` : name, slug, id, icon_url, description(_en),
// product_types (non affiché : c'était les pastilles, supprimées). Les champs
// `rating`/`review_count`/`min_price` n'existent pas encore dans la donnée :
// les rangées correspondantes sont rendues conditionnellement (rien sinon).
export function GameCard({ game, className = "", testId }) {
  const { selectGame } = useGames();
  const { lang } = useLang();
  const [broken, setBroken] = useState(false);
  const desc = (lang === "en" && game.description_en) || game.description || "";
  // Prix minimum : affiché seulement si le backend l'envoie déjà — à ce jour
  // il n'existe pas (aucun nouvel appel API autorisé).
  const minPrice = game.min_price;
  return (
    <Link
      to={`/boutique?game=${game.id}`}
      onClick={() => selectGame(game.id)}
      data-testid={testId || `game-card-${game.slug || game.id}`}
      className={`group relative flex min-h-0 flex-col gap-2.5 overflow-hidden rounded-[24px] border border-[color:var(--rule-strong)] bg-card p-3 transition-transform duration-150 motion-reduce:transition-none hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-lime)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:hsl(var(--background))] ${className}`}
    >
      {/* Vignette 1:1 : ratio réservé (aspect-square) donc aucun saut de
          mise en page, largeur/hauteur déclarées sur l'img. Decorative :
          le nom est lisible juste dessous → alt="". */}
      <span className="block w-full aspect-square overflow-hidden rounded-[20px] border border-[color:var(--rule)] bg-primary text-[#0A0A0A]">
        {game.icon_url && !broken ? (
          <img
            src={game.icon_url}
            alt=""
            width={200}
            height={200}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <Gamepad2 className="h-1/3 w-1/3" strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
        {/* Un seul badge max, en lime, uniquement pour un indicateur qui
            existe déjà dans la donnée (aucun champ badge/exclusif à ce
            jour → aucune pastille rendue). */}
      </span>
      <span className="flex min-h-0 flex-1 flex-col gap-0.5">
        {game.name && (
          <span className="truncate font-display text-[15px] font-bold leading-tight" title={game.name}>
            {game.name}
          </span>
        )}
        {desc && <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{desc}</span>}
      </span>
      {/* Rangée du bas : seulement du réel. Étoiles si la note + avis
          réels existent (≥ 5 avis), prix dès X si `min_price` existe.
          flex-wrap : à 320 px (2 colonnes ≈ 146 px par carte), le prix
          passe sous les étoiles au lieu d'être coupé. */}
      <span className="mt-auto flex min-h-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-1 pb-1">
        <RatingStars rating={game.rating} reviewCount={game.review_count} />
        {minPrice != null && (
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {lang === "en" ? "from" : "dès"} {formatAr(minPrice)}
          </span>
        )}
      </span>
    </Link>
  );
}
