import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageCircle, Receipt, Sparkles, Store } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { GameButton } from "@/components/layout/GameButton";
import { GameSelector } from "@/components/layout/GameSelector";

export function BottomNav() {
  const { pathname } = useLocation();
  const { t } = useLang();

  // Keep legacy routes working: /suivi + /compte still map to the Commandes
  // tab, /chat still maps to Support, so no catalog or order flow is broken.
  const items = [
    {
      to: "/boutique",
      icon: Store,
      label: t("nav.shop"),
      id: "bottom-nav-shop",
      match: (p) => p === "/" || p.startsWith("/boutique") || p.startsWith("/produit") || p.startsWith("/pack-evolutif"),
    },
    {
      to: "/evenements",
      icon: Sparkles,
      label: t("nav.events"),
      id: "bottom-nav-events",
      match: (p) => p.startsWith("/evenements"),
    },
    {
      to: "/suivi",
      icon: Receipt,
      label: t("nav.orders"),
      id: "bottom-nav-orders",
      match: (p) => p.startsWith("/suivi") || p.startsWith("/commande") || p.startsWith("/compte"),
    },
    {
      to: "/chat",
      icon: MessageCircle,
      label: t("nav.support"),
      id: "bottom-nav-support",
      match: (p) => p.startsWith("/chat") || p.startsWith("/support"),
    },
  ];

  if (pathname.startsWith("/admin") || pathname.startsWith("/compte") || pathname.startsWith("/privacy") || pathname.startsWith("/terms") || pathname.startsWith("/commande")) return null;

  return (
    <>
      {/* Main navigation layer — stays behind the game-selector backdrop. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center px-3 pr-[5rem] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
        data-testid="bottom-nav-wrapper"
      >
        <nav
          className="liquid-nav nav-outer pointer-events-auto flex min-w-0 flex-1 items-center gap-1 px-1"
          data-testid="bottom-nav"
          aria-label={t("nav.shop")}
        >
          {items.map(({ to, icon: Icon, label, id, match }) => {
            const active = match(pathname);
            return (
              <NavLink
                key={id}
                to={to}
                data-testid={id}
                aria-current={active ? "page" : undefined}
                style={{ flexGrow: active ? 2.4 : 1, flexBasis: 0 }}
                className={`nav-item-pill relative flex min-w-0 items-center justify-center overflow-hidden px-2 transition-[flex-grow,color] duration-[420ms] ease-out active:scale-[0.96] ${
                  active ? "text-[#0A0A0A]" : "text-[#F4F3EE]/65"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active-pill"
                    className="nav-item-pill absolute inset-0 bg-primary shadow-[0_2px_10px_hsl(72_99%_50%_/_.28)]"
                    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10 flex items-center">
                  <Icon className="h-[21px] w-[21px] shrink-0" strokeWidth={active ? 2.25 : 2} />
                  <motion.span
                    initial={false}
                    animate={{ width: active ? "auto" : 0, opacity: active ? 1 : 0 }}
                    transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden whitespace-nowrap text-[13.5px] font-semibold leading-none tracking-[-0.01em]"
                  >
                    <span className="block pl-2">{label}</span>
                  </motion.span>
                </span>
              </NavLink>
            );
          })}
        </nav>
      </div>
      <GameSelector />
      {/* Game button lives in its own stacking layer so it stays sharp above
          the backdrop while the main nav remains blurred behind it. */}
      <GameButton />
    </>
  );
}
