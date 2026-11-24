// PL-007-ADMIN-RESTORE — page admin autonome.
// Monte l'admin de la PR #100 (commit 2242ea8) tel quel sur /admin.html.
// La page utilisateur (public/index.html, prototype statique) n'est pas touchée :
// ce bundle et son CSS ne sont chargés que par admin.html.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/index.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ChatProvider } from "@/context/ChatContext";
import { CartProvider } from "@/context/CartContext";
import { Toaster } from "@/components/ui/sonner";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminGames from "@/pages/admin/AdminGames";
import AdminFazercards from "@/pages/admin/AdminFazercards";
import AdminEvents from "@/pages/admin/AdminEvents";
import AdminChat from "@/pages/admin/AdminChat";
import AdminLoyalty from "@/pages/admin/AdminLoyalty";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminPayments from "@/pages/admin/AdminPayments";
import AdminNotifications from "@/pages/admin/AdminNotifications";

// Même règle que components/ProtectedRoute.js:25-30, mais sans redirection de
// routeur : cette page n'héberge pas les écrans publics de connexion.
function AdminGate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Chargement…</p>;
  if (!user) {
    window.location.replace("/connexion");
    return null;
  }
  if (!["admin", "super_admin"].includes(user.role)) return <p style={{ padding: 24 }}>Accès réservé à l'administration.</p>;
  return children;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

function AdminApp() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminGate><AdminLayout /></AdminGate>}>
        <Route index element={<AdminDashboard />} />
        <Route path="commandes" element={<AdminOrders />} />
        <Route path="catalogue" element={<AdminProducts />} />
        <Route path="jeux" element={<AdminGames />} />
        <Route path="fournisseur" element={<AdminFazercards />} />
        <Route path="evenements" element={<AdminEvents />} />
        <Route path="messages" element={<AdminChat />} />
        <Route path="fidelite" element={<AdminLoyalty />} />
        <Route path="utilisateurs" element={<AdminUsers />} />
        <Route path="paiements" element={<AdminPayments />} />
        <Route path="paiements/binance" element={<Navigate to="/admin/paiements" replace />} />
        <Route path="notifications" element={<AdminNotifications />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" storageKey="mgs-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
          <LanguageProvider>
            <AuthProvider>
              <ChatProvider>
                <CartProvider>
                  <HashRouter>
                    <AdminApp />
                    <Toaster position="top-center" richColors />
                  </HashRouter>
                </CartProvider>
              </ChatProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
