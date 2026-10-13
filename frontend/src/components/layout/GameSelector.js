import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useGames } from "@/context/GameContext";
import { useLang } from "@/context/LanguageContext";

export function GameSelector() {
  const { games, selected, selectGame, open, setOpen } = useGames();
  const { t } = useLang();
  // Logo fallback: a missing OR broken `icon_url` falls back to the design-system icon.
  const [broken, setBroken] = useState({});

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
            <div className="grid max-h-[62vh] grid-cols-2 gap-2.5 overflow-y-auto p-4" data-testid="game-selector-list">
              {games.map((g) => {
                const isActive = g.id === selected?.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => selectGame(g.id)}
                    data-testid={`game-selector-item-${g.slug || g.id}`}
                    aria-pressed={isActive}
                    className={`group relative flex flex-col gap-2 rounded-[20px] p-2.5 text-left transition-colors ${isActive ? "bg-primary text-[#0A0A0A]" : "bg-background/10 text-background hover:bg-background/15"}`}
                  >
                    <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] bg-black/20">
                      {g.icon_url && !broken[g.id] ? (
                        <img src={g.icon_url} alt="" className="h-full w-full object-cover" loading="lazy"
                          onError={() => setBroken((b) => ({ ...b, [g.id]: true }))} />
                      ) : (
                        <Gamepad2 className="h-8 w-8" strokeWidth={2} />
                      )}
                      {isActive && <span className="absolute left-1.5 top-1.5 rounded-full bg-[#0A0A0A] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{t("games.active")}</span>}
                    </span>
                    <span className="flex items-center justify-between gap-1 px-0.5">
                      <span className="min-w-0 truncate font-display text-sm font-bold leading-tight">{g.name}</span>
                      {isActive
                        ? <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                        : <ArrowUpRight className="h-4 w-4 shrink-0 text-background/45 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2} aria-hidden="true" />}
                    </span>
                  </button>
                );
              })}
              {[0, 1, 2].map((i) => (
                <div key={`soon-${i}`} aria-disabled="true" data-testid={`game-selector-soon-${i}`}
                  className="pointer-events-none flex cursor-not-allowed flex-col gap-2 rounded-[20px] p-2.5 opacity-45">
                  <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-background/25 bg-background/5">
                    <Gamepad2 className="h-7 w-7 text-background/40" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="flex items-center justify-between gap-1 px-0.5">
                    <span className="text-sm font-bold text-background/50">—</span>
                    <span className="rounded-full border border-background/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-background/55">{t("games.comingSoon")}</span>
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
