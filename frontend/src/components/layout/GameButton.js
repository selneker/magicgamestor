import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Gamepad2, X } from "lucide-react";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";

// Fixed 🎮 button rendered next to the mobile bottom navigation. It is not a
// floating-action-button bound to content, it never scrolls with the page and
// it owns its own stacking layer so it stays sharp above the selector backdrop.
export function GameButton() {
  const { pathname } = useLocation();
  const { setOpen, open, selected } = useGames();
  const { t } = useLang();

  if (pathname.startsWith("/admin") || pathname.startsWith("/compte") || pathname.startsWith("/privacy") || pathname.startsWith("/terms") || pathname.startsWith("/commande")) return null;

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
        animate={{
          backgroundColor: "#FFFFFF",
        }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="nav-pill pointer-events-auto relative flex h-[60px] w-[60px] shrink-0 items-center justify-center overflow-hidden border border-[color:var(--rule-strong)] text-[#0A0A0A] shadow-[0_6px_18px_hsl(0_0%_0%_/_.28)] active:scale-[0.96]"
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
