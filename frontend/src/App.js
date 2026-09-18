import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
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
import Account from "@/pages/Account";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminOrders from "@/pages/admin/AdminOrders";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminEvents from "@/pages/admin/AdminEvents";

function AppRouter() {
  const location = useLocation();
  // Google OAuth returns with #session_id=…; exchange it before any route renders.
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
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
        <Route path="/compte" element={<ProtectedRoute><Account /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute admin><AdminLayout /></ProtectedRoute>}>
          <Route index element={<AdminDashboard />} />
          <Route path="commandes" element={<AdminOrders />} />
          <Route path="catalogue" element={<AdminProducts />} />
          <Route path="evenements" element={<AdminEvents />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <AppRouter />
            <Toaster position="top-center" richColors />
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
