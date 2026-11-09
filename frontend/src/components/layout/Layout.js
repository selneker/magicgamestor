import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { AdminBottomNav } from "@/components/layout/AdminBottomNav";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/store/CartDrawer";
import { GameProvider } from "@/context/GameContext";
import { PageTransition } from "@/components/layout/PageTransition";
import { useLocation } from "react-router-dom";
import { hidesBottomChrome } from "@/lib/bottomChrome";

export default function Layout() {
  // PL-CHK-1 : sur les routes où le chrome bas n'est pas rendu (dont /commande),
  // la réserve de 7 rem sous <main> est de l'espace mort — la réduction garde
  // le contenu à distance du pied de page SANS défilement fantôme, requis pour
  // que le bouton épinglé du checkout touche le bas de l'écran à 360×640.
  const { pathname } = useLocation();
  const chromeHidden = hidesBottomChrome(pathname);
  return (
    <GameProvider>
      <div className="min-h-screen bg-background overflow-x-hidden">
        <Header />
        <main className={`mx-auto w-full max-w-7xl px-4 sm:px-6 md:pb-0 ${chromeHidden ? "pb-6" : "pb-[calc(7rem+var(--bottom-chrome-reserve,0px))]"}`}><PageTransition /></main>
        <Footer />
        <BottomNav />
        <AdminBottomNav />
        <CartDrawer />
      </div>
    </GameProvider>
  );
}
