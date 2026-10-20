import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, X } from "lucide-react";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";
import { hidesBottomChrome } from "@/lib/bottomChrome";

// Fixed 🎮 button rendered next to the mobile bottom navigation. It is not a
// floating-action-button bound to content, it never scrolls with the page and
// it owns its own stacking layer so it stays sharp above the selector backdrop.
//
// The disc is the brand neon on an ink border (like the active pill of the
// nav), with an ink glyph: no hardcoded colour, and nothing white on the black
// nav. The soft shadow is theme-relative and therefore useless on the dark
// nav — it is dropped there (`dark:shadow-none`).
export function GameButton() {
  const { pathname } = useLocation();
  const { setOpen, open, selected } = useGames();
  const { t } = useLang();

  if (hidesBottomChrome(pathname)) return null;

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
        aria-label={open ? t("common.close") : `${t("games.title")}${selected ? ` – ${selected.name}` : ""}`}
        data-testid="game-button"
        data-open={open ? "true" : "false"}
        initial={false}
        className="nav-pill pointer-events-auto relative flex h-[60px] w-[60px] shrink-0 items-center justify-center overflow-hidden border-2 border-ink bg-primary text-primary-foreground shadow-[0_6px_18px_hsl(var(--foreground)_/_.28)] dark:shadow-none active:scale-[0.96]"
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
              <Gamepad2 className="h-[22px] w-[22px]" strokeWidth={2.25} />
            </motion.span>
          )}
        </AnimatePresence>
        <span className="sr-only">{selected?.name}</span>
      </motion.button>
    </div>
  );
}
