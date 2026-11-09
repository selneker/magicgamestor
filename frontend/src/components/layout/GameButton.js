import { useLocation, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";
import { hidesBottomChrome } from "@/lib/bottomChrome";
import { useIsMobileViewport } from "@/hooks/useIsMobileViewport";

// PL-UI-BOTTOM-1 — le bouton manette rejoint la barre de navigation (même
// hauteur, même alignement) et ouvre le nouveau sélecteur en pill. Il affiche
// l'icône du jeu courant quand la route en porte un (`?game=`), sinon la
// manette générique. Desktop (>= 1024 px) : non rendu du tout.
export function GameButton() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { games, selected, setOpen, open } = useGames();
  const { t } = useLang();
  const mobile = useIsMobileViewport();
  const [broken, setBroken] = useState(false);

  // Jeu courant si la route en porte un (`/boutique?game=…`), sinon null.
  const currentGame = games.find((g) => g.id === searchParams.get("game"));
  useEffect(() => setBroken(false), [currentGame?.id]);

  if (hidesBottomChrome(pathname) || !mobile) return null;

  return (
    <div
      className={`pointer-events-none fixed bottom-0 right-3 flex items-center pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden ${
        open ? "z-[70]" : "z-40"
      }`}
    >
      <motion.button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? t("common.close") : `${t("games.select")}${selected ? ` – ${selected.name}` : ""}`}
        data-testid="game-button"
        data-open={open ? "true" : "false"}
        initial={false}
        className="nav-pill pointer-events-auto flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden border-2 border-ink bg-primary text-primary-foreground shadow-[0_6px_18px_hsl(var(--foreground)_/_.28)] dark:shadow-none active:scale-[0.96]"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {open ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="absolute inset-0 flex items-center justify-center"
              data-testid="game-button-close-icon"
            >
              <X className="h-[22px] w-[22px]" strokeWidth={2.5} />
            </motion.span>
          ) : (
            <motion.span
              key="game"
              initial={{ opacity: 0, rotate: 90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: -90 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="absolute inset-0 flex items-center justify-center"
              data-testid="game-button-game-icon"
            >
              {currentGame?.icon_url && !broken ? (
                <img
                  src={currentGame.icon_url}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setBroken(true)}
                />
              ) : (
                <Gamepad2 className="h-[22px] w-[22px]" strokeWidth={2.25} aria-hidden="true" />
              )}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="sr-only">{selected?.name}</span>
      </motion.button>
    </div>
  );
}
