import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

const GameContext = createContext(null);

// Fallback used while the backend `/api/games` endpoint is not yet live.
// Keeps PUBG Mobile as the single active game and preserves the shape the
// GameSelector + admin screens will consume once the endpoint ships.
const DEFAULT_GAMES = [
  {
    id: "pubg-mobile",
    name: "PUBG Mobile",
    slug: "pubg-mobile",
    icon_url: "https://customer-assets-0z36b82j.emergentagent.net/job_games-nav-polish/artifacts/ih6044zb_pubgm_app-icon_512x512%281%29.e9f7efc0.png",
    active: true,
    sort_order: 0,
    description: "UC, Prime, Prime+ & Pack évolutif",
  },
];

const STORAGE_KEY = "mgs_selected_game";

export function GameProvider({ children }) {
  const [games, setGames] = useState(DEFAULT_GAMES);
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_GAMES[0].id; }
    catch (_) { return DEFAULT_GAMES[0].id; }
  });
  // Phase 3 — `explicit` is true only once the user really picked a game (or a
  // `?game=` param was honoured). The stored value is a convenience for the
  // checkout/GameButton, it must NEVER skip the storefront game-selection page:
  // that decision is driven by the URL (`/boutique` without `?game=`).
  const [explicit, setExplicit] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Soft call: if the endpoint is missing we keep the default list.
    api.get("/games")
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data.filter((g) => g.active !== false) : [];
        if (list.length > 0) {
          list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          setGames(list);
          if (!list.find((g) => g.id === selectedId)) {
            setSelectedId(list[0].id);
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, selectedId); } catch (_) {}
  }, [selectedId]);

  const selectGame = useCallback((id) => {
    setSelectedId(id);
    setExplicit(true);
    setOpen(false);
  }, []);

  const selected = useMemo(
    () => games.find((g) => g.id === selectedId) || games[0] || DEFAULT_GAMES[0],
    [games, selectedId]
  );

  const value = useMemo(() => ({
    games,
    selected,
    selectedId: selected?.id,
    explicit,
    selectGame,
    open,
    setOpen,
  }), [games, selected, explicit, selectGame, open]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export const useGames = () => useContext(GameContext);
