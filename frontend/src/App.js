import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/context/AuthContext";
import { ChatProvider } from "@/context/ChatContext";
import Chat from "@/pages/Chat";
import AdminChat from "@/pages/admin/AdminChat";
import { CartProvider } from "@/context/CartContext";
import AuthCallback from "@/components/AuthCallback";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Layout from "@/components/layout/Layout";
import Home from "@/pages/Home";
import Catalog from "@/pages/Catalog";
import Product from "@/pages/Product";
import Checkout from "@/pages/Checkout";
import OrderTrack from "@/pages/OrderTrack";
import Events from "@/pages/Events";
import AuthPage from "@/pages/AuthPage";
import { ForgotPassword, ResetPassword, VerifyEmail } from "@/pages/AuthExtras";
import Account from "@/pages/Account";
import Loyalty from "@/pages/Loyalty";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminEvents from "@/pages/admin/AdminEvents";
import AdminLoyalty from "@/pages/admin/AdminLoyalty";

function AppRouter() {
  return (
    <>
      <AuthCallback />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/boutique" element={<Catalog />} />
          <Route path="/produit/:slug" element={<Product />} />
          <Route path="/commande" element={<Checkout />} />
          <Route path="/suivi" element={<OrderTrack />} />
          <Route path="/suivi/:orderNumber" element={<OrderTrack />} />
          <Route path="/evenements" element={<Events />} />
          <Route path="/connexion" element={<AuthPage mode="login" />} />
          <Route path="/inscription" element={<AuthPage mode="register" />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
          <Route path="/reinitialiser/:token" element={<ResetPassword />} />
          <Route path="/verifier-email/:token" element={<VerifyEmail />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/compte" element={<ProtectedRoute><Account /></ProtectedRoute>} />
          <Route path="/compte/points" element={<ProtectedRoute><Loyalty /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute admin><AdminLayout /></ProtectedRoute>}>
            <Route index element={<AdminDashboard />} />
            <Route path="commandes" element={<AdminOrders />} />
            <Route path="catalogue" element={<AdminProducts />} />
            <Route path="evenements" element={<AdminEvents />} />
            <Route path="messages" element={<AdminChat />} />
            <Route path="fidelite" element={<AdminLoyalty />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider attribute="class" storageKey="mgs-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
    <LanguageProvider>
      <AuthProvider>
        <ChatProvider>
        <CartProvider>
          <BrowserRouter>
            <AppRouter />
            <Toaster position="top-center" richColors />
          </BrowserRouter>
        </CartProvider>
        </ChatProvider>
      </AuthProvider>
    </LanguageProvider>
    </ThemeProvider>
  );
}
