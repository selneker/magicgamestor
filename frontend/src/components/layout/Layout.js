import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { AdminBottomNav } from "@/components/layout/AdminBottomNav";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/store/CartDrawer";
import { GameProvider } from "@/context/GameContext";
import { PageTransition } from "@/components/layout/PageTransition";
import { useCart } from "@/context/CartContext";

export default function Layout() {
  const { count } = useCart();
  return (
    <GameProvider>
      <div className="min-h-screen bg-background overflow-x-hidden">
        <Header />
        <main className="mx-auto w-full max-w-7xl px-4 pb-28 sm:px-6 md:pb-0"><PageTransition /></main>
        <Footer />
        {/* The mobile cart bar floats above the bottom nav, so the page needs that
            much extra room at the very bottom or it would cover the footer. */}
        {count > 0 && <div className="h-[calc(1.25rem+max(0.75rem,env(safe-area-inset-bottom)))] md:hidden" aria-hidden="true" data-testid="cart-bar-spacer" />}
        <BottomNav />
        <AdminBottomNav />
        <CartDrawer />
      </div>
    </GameProvider>
  );
}
