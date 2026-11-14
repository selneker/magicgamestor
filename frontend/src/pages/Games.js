import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { GameCard } from "@/components/game/GameCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";
import { usePageMeta } from "@/lib/catalog";

// PL-UI-GAMES-1 — « Tous les jeux » : grille complète avec recherche client
// (délai de frappe, insensible à la casse ET aux accents). Aucun filtre par
// catégorie : la donnée n'existe pas encore.
// Pliage d'accents + casse : "Réinitialisation" ≡ "reinitialisation".
const fold = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const DEBOUNCE_MS = 250;

export default function Games() {
  const { t } = useLang();
  const { games, loadingGames } = useGames();
  usePageMeta(t("seo.gamesTitle"), t("seo.gamesDescription"));
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  // Délai de frappe : l'état de recherche suit la saisie avec DEBOUNCE_MS.
  useEffect(() => {
    const id = setTimeout(() => setQuery(raw), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  const folded = fold(query);
  const visible = useMemo(
    () => (folded ? games.filter((g) => fold(g.name).includes(folded)) : games),
    [games, folded]
  );

  return (
    <div className="pb-28">
      <section className="pt-2">
        <p className="eyebrow" data-testid="games-all-eyebrow">{t("games.eyebrow")}</p>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-tight sm:text-5xl" data-testid="games-all-title">
          {t("games.title")}
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">{t("games.allSub")}</p>
      </section>

      {/* Barre de recherche — même style que la recherche catalogue. */}
      <div className="relative mt-5 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <Input
          type="search"
          data-testid="games-all-search"
          aria-label={t("games.search")}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t("games.search")}
          className="h-10 rounded-full pl-9"
        />
        {raw && (
          <button
            type="button"
            data-testid="games-all-search-clear"
            aria-label={t("common.close")}
            onClick={() => setRaw("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="games-all-grid">
        {loadingGames
          ? // Squelettes de même forme que les cartes.
            Array.from({ length: 8 }).map((_, i) => <GameCardSkeleton key={i} />)
          : visible.map((g) => <GameCard key={g.id} game={g} />)}
      </div>
      {!loadingGames && visible.length === 0 && (
        <div className="mt-10 text-center" data-testid="games-all-empty">
          <p className="font-display text-lg font-bold">{t("games.searchEmptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{folded ? t("games.searchEmpty") : t("games.empty")}</p>
        </div>
      )}
      {!loadingGames && games.length > 0 && visible.length > 0 && (
        <p className="mt-4 text-center text-xs text-muted-foreground" data-testid="games-all-count">
          {t("games.allCount").replace("{n}", visible.length)}
        </p>
      )}
    </div>
  );
}

// Squelette : même grille, même vignette carrée et mêmes textes fantômes
// qu'une GameCard, pour éviter tout saut de déterminisme/CLers au chargement.
function GameCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-[24px] border border-[color:var(--rule-strong)] bg-card p-3" data-testid="game-card-skeleton">
      <Skeleton className="aspect-square w-full rounded-[20px]" />
      <Skeleton className="h-4 w-3/4 rounded-full" />
      <Skeleton className="h-3 w-full rounded-full" />
      <Skeleton className="h-3 w-2/3 rounded-full" />
    </div>
  );
}
