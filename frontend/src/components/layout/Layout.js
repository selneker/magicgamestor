import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { AdminBottomNav } from "@/components/layout/AdminBottomNav";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/store/CartDrawer";
import { GameProvider } from "@/context/GameContext";
import { PageTransition } from "@/components/layout/PageTransition";

export default function Layout() {
  return (
    <GameProvider>
      <div className="min-h-screen bg-background overflow-x-hidden">
        <Header />
        <main className="mx-auto w-full max-w-7xl px-4 sm:px-6"><PageTransition /></main>
        <Footer />
        <BottomNav />
        <AdminBottomNav />
        <CartDrawer />
      </div>
    </GameProvider>
  );
}
