import { NavLink, useLocation } from "react-router-dom";
import { MessageCircle, Receipt, Sparkles, Store } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { GameButton } from "@/components/layout/GameButton";
import { GameSelector } from "@/components/layout/GameSelector";
import { hidesBottomChrome } from "@/lib/bottomChrome";

/* ── PL-005-FE-03 (refonte Slush) — barre du bas = celle de la maquette ────
   01-accueil.html:1263 + mg-components.css:345 : pilule sombre fixe
   (.bottom-nav, inset .75em + safe-area, masquée ≥ 992 px par la CSS),
   items .bottom-nav__item (icône + libellé, opacité 65 %) et état actif
   .is--active (voile néon 18 % + texte néon, sur l'encre fixe de la barre).
   Le bouton de changement de jeu vit DANS la barre, comme l'item
   « bottom-nav__item--game » de la maquette : GameButton et GameSelector
   sont conservés tels quels (testids et comportements inchangés), seul le
   conteneur du bouton passe du flot fixe v1 au flux de la barre. */

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

  if (hidesBottomChrome(pathname)) return null;

  return (
    <>
      {/* Navigation principale — la pilule fixe de la maquette (le CSS
          .bottom-nav de mg-components.css porte la position, le fond encre
          fixe et le masquage ≥ 992 px). */}
      <nav className="bottom-nav" data-testid="bottom-nav" aria-label={t("nav.mainNav")}>
        {items.map(({ to, icon: Icon, label, id, match }) => {
          const active = match(pathname);
          return (
            <NavLink
              key={id}
              to={to}
              data-testid={id}
              aria-current={active ? "page" : undefined}
              className={`bottom-nav__item${active ? " is--active" : ""}`}
            >
              <Icon className="ic-use" strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          );
        })}
        <GameButton />
      </nav>
      <GameSelector />
    </>
  );
}
