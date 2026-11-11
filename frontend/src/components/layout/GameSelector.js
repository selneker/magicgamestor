import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, LayoutGrid } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";
import { hidesBottomChrome } from "@/lib/bottomChrome";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";

// PL-UI-BOTTOM-1 — Changement rapide de jeu en pill flottante, ancrée juste
// au-dessus du bouton manette (8 px d'écart). Desktop (>= 1024 px) : non
// rendu du tout.
// PL-NAV-1-COMPACT — la pill redevient la GRILLE de 2 colonnes du début de la
// fonctionnalité (f1d6e82) : une carte (pastille + nom) par jeu, jeu actif
// marqué (fond néon + anneau), hauteur plafonnée à défilement vertical seul,
// jamais de rangée horizontale ni de débord à 320 px.
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
                     max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[24px]
                     border border-[color:var(--rule-strong)] bg-card text-[color:hsl(var(--card-foreground))]
                     shadow-[0_18px_44px_hsl(0_0%_0%_/_.22)] backdrop-blur-md md:hidden"
        >
          {/* PL-NAV-1-COMPACT — grille de 2 colonnes (état d'origine de la
              fonctionnalité, f1d6e82) : une carte par jeu, jamais de rangée
              horizontale ; ancrée au-dessus du bouton manette, hauteur plafonnée
              avec défilement VERTICAL seul, jamais masquée par la barre. */}
          <ul
            className="grid max-h-[min(58vh,320px)] grid-cols-2 gap-1.5 overflow-y-auto overflow-x-hidden p-1.5"
            data-testid="game-selector-list"
          >
            {games.slice(0, MAX_ITEMS).map((g) => {
              const isActive = g.id === selected?.id;
              return (
                <li key={g.id} className="min-w-0">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    aria-label={g.name}
                    title={g.name}
                    data-testid={`game-selector-item-${g.slug || g.id}`}
                    onClick={() => { selectGame(g.id); navigate(`/boutique?game=${g.id}`); }}
                    className={`flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-[16px] p-2 transition-colors ${
                      isActive
                        ? "bg-primary text-[#0A0A0A] ring-2 ring-[color:var(--brand-lime)] ring-offset-2 ring-offset-[color:hsl(var(--card))]"
                        : "border border-[color:var(--rule-strong)] text-[color:hsl(var(--foreground))]"
                    }`}
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full ${isActive ? "" : "border border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]"}`}>
                      {g.icon_url && !broken[g.id] ? (
                        <img src={g.icon_url} alt="" className="h-full w-full object-cover" loading="lazy"
                          onError={() => setBroken((b) => ({ ...b, [g.id]: true }))} />
                      ) : (
                        <Gamepad2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                      )}
                    </span>
                    <span className="max-w-full truncate text-[11px] font-semibold leading-tight">{g.name}</span>
                  </button>
                </li>
              );
            })}
            {games.length > MAX_ITEMS && (
              <li className="min-w-0">
                <button
                  type="button"
                  role="menuitem"
                  aria-label={t("games.all")}
                  title={t("games.all")}
                  data-testid="game-selector-all"
                  onClick={() => navigate("/boutique")}
                  className="flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-[16px] border border-[color:var(--rule-strong)] p-2 text-[color:hsl(var(--muted-foreground))] transition-colors hover:bg-[color:hsl(var(--muted))] hover:text-[color:hsl(var(--foreground))]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[color:var(--rule-strong)]">
                    <LayoutGrid className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate text-[11px] font-semibold leading-tight">{t("games.all")}</span>
                </button>
              </li>
            )}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
