import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, LayoutGrid } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";
import { hidesBottomChrome } from "@/lib/bottomChrome";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";

// PL-UI-BOTTOM-1 — Changement rapide de jeu en pill flottante, ancrée juste
// au-dessus du bouton manette (8 px d'écart). Remplace l'ancien panneau plein
// : une rangée de logos (cibles 44 px), jetons existants uniquement, 5 jeux
// puis un entrée « Tous ». Desktop (>= 1024 px) : non rendu du tout.
const MAX_ITEMS = 5;

export function GameSelector() {
  const { games, selected, selectGame, open, setOpen } = useGames();
  const { t } = useLang();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobile = useIsMobileViewport();
  const panelRef = useRef(null);
  // Logo fallback : un `icon_url` manquant OU cassé retombe sur l'icône design-system.
  const [broken, setBroken] = useState({});
  const prefersReduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Fermé au changement de route (chaque appui sur un jeu navigue, donc tout
  // reste ouvert uniquement tant que l'utilisateur laisse la pill ouverte).
  useEffect(() => {
    if (open) setOpen(false);
  }, [pathname, setOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Échap + roving focus (flèches / Home / End) pendant que la pill est ouverte.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      const panel = panelRef.current;
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); return; }
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll("button:not([disabled])"));
      if (!items.length || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Home") { items[0].focus(); return; }
      if (e.key === "End") { items[items.length - 1].focus(); return; }
      const index = items.indexOf(document.activeElement);
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      items[index === -1 ? 0 : (index + (forward ? 1 : -1) + items.length) % items.length].focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // À l'ouverture le focus entre dans la pill : l'utilisateur clavier atterrit
  // dessus sans avoir à tabuler à travers la page masquée derrière.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector("button");
    first?.focus({ preventScroll: true });
  }, [open]);

  // Clic extérieur → fermeture (le bouton manette est exclu : c'est lui qui bascule).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!e.target.closest?.("[data-testid='game-selector-panel'], [data-testid='game-button']")) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  if (!mobile || hidesBottomChrome(pathname)) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="menu"
          ref={panelRef}
          aria-label={t("games.title")}
          data-testid="game-selector-panel"
          initial={prefersReduced ? false : { opacity: 0, y: 14, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
          transition={{ duration: prefersReduced ? 0 : 0.18, ease: "easeOut" }}
          className="fixed right-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom,0px))+4.5rem)] z-[61]
                     flex max-w-[calc(100vw-1.5rem)] items-center overflow-hidden rounded-[24px]
                     border border-[color:var(--rule-strong)] bg-card px-1.5 py-1.5 text-[color:hsl(var(--card-foreground))]
                     shadow-[0_18px_44px_hsl(0_0%_0%_/_.22)] backdrop-blur-md md:hidden"
        >
          {/* gap-1 (et non gap-2) : à 320 px la rangée de 6 cibles 44 px doit
              tenir dans max-w 304 px (6*44 + 5*4 + 2*12 = 296 px), sinon
              l'entrée « Tous » serait rognée par overflow-hidden. */}
          <ul className="flex items-center gap-1" data-testid="game-selector-list">
            {games.slice(0, MAX_ITEMS).map((g) => {
              const isActive = g.id === selected?.id;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    aria-label={g.name}
                    title={g.name}
                    data-testid={`game-selector-item-${g.slug || g.id}`}
                    onClick={() => { selectGame(g.id); navigate(`/boutique?game=${g.id}`); }}
                    className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A] ${
                      isActive ? "ring-2 ring-[color:var(--brand-lime)] ring-offset-2 ring-offset-[color:hsl(var(--card))]" : ""
                    }`}
                  >
                    {g.icon_url && !broken[g.id] ? (
                      <img src={g.icon_url} alt="" className="h-full w-full object-cover" loading="lazy"
                        onError={() => setBroken((b) => ({ ...b, [g.id]: true }))} />
                    ) : (
                      <Gamepad2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
            {games.length > MAX_ITEMS && (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={t("games.all")}
                  title={t("games.all")}
                  data-testid="game-selector-all"
                  onClick={() => navigate("/boutique")}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--rule-strong)] text-[color:hsl(var(--muted-foreground))] transition-colors hover:bg-[color:hsl(var(--muted))] hover:text-[color:hsl(var(--foreground))]"
                >
                  <LayoutGrid className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            )}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
