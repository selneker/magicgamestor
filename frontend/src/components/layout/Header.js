import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { Globe, LogOut, ShoppingBag, UserRound, Shield } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";

export function useStoreStatus() {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const load = () => api.get("/settings/status").then((r) => setOnline(r.data.online)).catch(() => setOnline(false));
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);
  return online;
}

export function StatusBadge() {
  const online = useStoreStatus();
  const { t } = useLang();
  return (
    <span data-testid="admin-status-badge" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
      {online ? t("status.online") : t("status.offline")}
    </span>
  );
}

export function Header() {
  const { t, lang, toggle } = useLang();
  const { user, isAdmin, logout } = useAuth();
  const { count, setOpen } = useCart();
  const link = ({ isActive }) => `text-sm font-semibold transition-colors ${isActive ? "text-primary" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <header className="sticky top-0 z-40 glass border-b border-slate-200/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" data-testid="header-logo" className="font-display text-lg font-800 tracking-tight text-slate-900 sm:text-xl">
          Magic<span className="text-primary">Game</span>Store
        </Link>
        <div className="hidden sm:block"><StatusBadge /></div>
        <nav className="ml-auto hidden items-center gap-6 md:flex">
          <NavLink to="/boutique?type=uc" className={link} data-testid="nav-uc">{t("nav.uc")}</NavLink>
          <NavLink to="/boutique?type=prime,prime_plus" className={link} data-testid="nav-prime">{t("nav.prime")}</NavLink>
          <NavLink to="/evenements" className={link} data-testid="nav-events">{t("nav.events")}</NavLink>
          <NavLink to="/suivi" className={link} data-testid="nav-track">{t("nav.track")}</NavLink>
          {isAdmin && <NavLink to="/admin" className={link} data-testid="nav-admin"><span className="inline-flex items-center gap-1"><Shield className="h-4 w-4" />{t("nav.admin")}</span></NavLink>}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Button variant="ghost" size="sm" onClick={toggle} data-testid="lang-toggle" className="gap-1 rounded-full px-2 text-xs font-bold uppercase">
            <Globe className="h-4 w-4" />{lang}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} data-testid="cart-button" className="relative rounded-full">
            <ShoppingBag className="h-5 w-5" />
            {count > 0 && <span data-testid="cart-count" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">{count}</span>}
          </Button>
          {user ? (
            <>
              <Button asChild variant="ghost" size="icon" className="rounded-full" data-testid="account-button"><Link to="/compte"><UserRound className="h-5 w-5" /></Link></Button>
              <Button variant="ghost" size="icon" className="hidden rounded-full md:inline-flex" onClick={logout} data-testid="logout-button"><LogOut className="h-5 w-5" /></Button>
            </>
          ) : (
            <Button asChild size="sm" className="rounded-full px-4" data-testid="login-button"><Link to="/connexion">{t("nav.login")}</Link></Button>
          )}
        </div>
      </div>
    </header>
  );
}
