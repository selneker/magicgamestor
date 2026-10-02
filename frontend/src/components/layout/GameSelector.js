import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Gamepad2 } from "lucide-react";
import { useEffect } from "react";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";

export function GameSelector() {
  const { games, selected, selectGame, open, setOpen } = useGames();
  const { t } = useLang();

  // Lock body scroll while the overlay is open and allow ESC to close it.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="game-selector-backdrop"
            data-testid="game-selector-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => setOpen(false)}
            className="game-backdrop fixed inset-0 z-[60]"
            aria-hidden="true"
          />
          <motion.div
            key="game-selector-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("games.title")}
            data-testid="game-selector-panel"
            initial={{ opacity: 0, y: 48, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.9 }}
            className="fixed inset-x-3 z-[61] mx-auto overflow-hidden rounded-[28px] border border-[color:var(--rule-strong)] bg-foreground text-background shadow-[0_18px_50px_hsl(0_0%_0%_/_.45)]
                       bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)]
                       md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:w-[26rem] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:-translate-y-1/2"
          >
            <p className="px-5 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-background/45">{t("games.title")}</p>
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto p-3" data-testid="game-selector-list">
              {games.map((g) => {
                const isActive = g.id === selected?.id;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => selectGame(g.id)}
                      data-testid={`game-selector-item-${g.slug || g.id}`}
                      aria-pressed={isActive}
                      className={`group flex w-full items-center gap-4 rounded-[20px] px-3 py-3 text-left transition-colors ${
                        isActive ? "bg-background/10" : "hover:bg-background/5"
                      }`}
                    >
                      <span className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-[#0A0A0A] ${isActive ? "ring-2 ring-primary ring-offset-2 ring-offset-[hsl(var(--foreground))]" : ""}`}>
                        {g.icon_url ? (
                          <img src={g.icon_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Gamepad2 className="h-6 w-6" strokeWidth={2} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[17px] font-semibold leading-tight text-background">{g.name}</span>
                        {g.description && (
                          <span className="mt-0.5 block truncate text-[12px] font-normal text-background/55">{g.description}</span>
                        )}
                      </span>
                      <ArrowUpRight className="h-5 w-5 shrink-0 text-background/45 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
