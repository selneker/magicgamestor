import { Outlet, useLocation } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { SlushChrome } from "@/components/layout/SlushChrome";
import { PendingOrderBanner } from "@/components/store/PendingOrderBanner";
import { BottomNav } from "@/components/layout/BottomNav";
import { AdminBottomNav } from "@/components/layout/AdminBottomNav";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/store/CartDrawer";
import { GameProvider } from "@/context/GameContext";
import SeoManager from "@/components/layout/SeoManager";
import { hidesBottomChrome, isFocusedRoute, showsSiteFooter } from "@/lib/bottomChrome";

/* ── PL-005-FE-03 (refonte Slush) — structure de page de la maquette ──────
   01-accueil.html:977-1229 : .page-w englobe .nav-w (nav pilule), puis
   <main class="main-w"> (le conteneur que les transitions en volets
   remballent — lib/slush.js runTransitionOut/In), puis le footer.
   SlushChrome porte curseur, volets, Lenis et body[data-page] ; il doit
   vivre SOUS le Router (useNavigate/useLocation). Les transitions de page
   de la v1 (framer-motion PageTransition) sont remplacées par celles de
   la maquette : le contenu passe par <Outlet/> sans re-montage animé. */
export default function Layout() {
  // PL-CHK-1 : sur les routes où le chrome bas n'est pas rendu (dont /commande),
  // la réserve de 7 rem sous <main> est de l'espace mort — la réduction garde
  // le contenu à distance du pied de page SANS défilement fantôme, requis pour
  // que le bouton épinglé du checkout touche le bas de l'écran à 360×640.
  const { pathname } = useLocation();
  const chromeHidden = hidesBottomChrome(pathname);
  // PL-CHK-4 — mode focalisé (source unique : isFocusedRoute, lib/bottomChrome.js) :
  // ni header, ni footer, ni nav basse, ni barre panier, ni sélecteur rapide,
  // ni bannière « Commande en cours ». La page rend son propre en-tête minimal
  // et gère elle-même `env(safe-area-inset-bottom)` sous son bouton fixé.
  const focused = isFocusedRoute(pathname);
  // PL-UX-4 — l'admin n'affiche AUCUN pied de page (ni le footer du site ni
  // son bandeau) : les pages publiques, elles, gardent le leur.
  const withFooter = showsSiteFooter(pathname);
  // Nav pilule fixe (hors flux) : les pages non-accueil ont besoin de la
  // réserve .page-top (mg-components.css:723) sur bureau ; sur mobile la
  // barre reste sticky dans le flux (glue CSS : page-top ≥ 992 px seulement).
  const needsTopSpace = pathname !== "/" && !focused;
  return (
    <GameProvider>
      <SeoManager />
      <SlushChrome />
      <div className="page-w min-h-screen overflow-x-hidden">
        {!focused && <Header />}
        {!focused && <PendingOrderBanner />}
        {/* PL-CHK-4 — mode focalisé : pb-0 (l'écran gère lui-même son padding
            bas et doit tenir dans 100svh — tout padding du Layout crée un
            défilement fantôme de 24 px à 360×640). */}
        <main className={`main-w mx-auto w-full max-w-7xl px-4 sm:px-6 md:pb-0 ${needsTopSpace ? "page-top" : ""} ${focused ? "pb-0" : chromeHidden ? "pb-6" : "pb-[calc(7rem+var(--bottom-chrome-reserve,0px))]"}`}><Outlet /></main>
        {withFooter && <Footer />}
        {!focused && <BottomNav />}
        <AdminBottomNav />
        {!focused && <CartDrawer />}
      </div>
    </GameProvider>
  );
}
