import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { LogOut, ShoppingBag, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ChatLink } from "@/components/chat/ChatLink";

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
    <span data-testid="admin-status-badge" className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${online ? "border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]" : "text-muted-foreground"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "animate-pulse bg-[#0A0A0A]" : "bg-current"}`} />
      {online ? t("status.online") : t("status.offline")}
    </span>
  );
}

export function Header() {
  const { t, lang, toggle } = useLang();
  const { user, isAdmin, logout } = useAuth();
  const { count, setOpen } = useCart();
  const link = ({ isActive }) => `relative text-xs font-medium uppercase tracking-[0.1em] transition-colors ${isActive ? "text-foreground after:absolute after:-bottom-1.5 after:left-0 after:h-[3px] after:w-full after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <header className="glass sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-1.5 px-2 sm:gap-6 sm:px-6">
        <Link to="/" data-testid="header-logo" className="shrink-0 font-display text-[13px] font-bold uppercase leading-none tracking-tight text-foreground sm:text-lg">
          Magic<span className="rounded-[4px] bg-primary px-1 text-[#0A0A0A]">Game</span>Store
        </Link>
        <div className="hidden lg:block"><StatusBadge /></div>
        <nav className="ml-auto hidden items-center gap-7 md:flex">
          <NavLink to="/boutique?type=uc" className={link} data-testid="nav-uc">{t("nav.uc")}</NavLink>
          <NavLink to="/boutique?type=prime,prime_plus" className={link} data-testid="nav-prime">{t("nav.prime")}</NavLink>
          <NavLink to="/pack-evolutif" className={link} data-testid="nav-evo">{t("nav.evo")}</NavLink>
          <NavLink to="/evenements" className={link} data-testid="nav-events">{t("nav.events")}</NavLink>
          <NavLink to="/suivi" className={link} data-testid="nav-track">{t("nav.track")}</NavLink>
          {isAdmin && <NavLink to="/admin" className={link} data-testid="nav-admin">{t("nav.admin")}</NavLink>}
        </nav>
        <div className="ml-auto flex min-w-0 shrink items-center gap-0 md:ml-0 md:gap-0.5">
          <ThemeToggle />
          <ChatLink />
          <Button variant="ghost" size="sm" onClick={toggle} data-testid="lang-toggle" className="rounded-none px-2 text-[11px] font-black uppercase tracking-[0.14em]">{lang}</Button>
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} data-testid="cart-button" className="relative rounded-none">
            <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
            {count > 0 && <span data-testid="cart-count" className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center bg-primary px-1 text-[10px] font-black text-[#0A0A0A]">{count}</span>}
          </Button>
          {user ? (
            <>
              <Button asChild variant="ghost" size="icon" className="rounded-none" data-testid="account-button"><Link to="/compte"><UserRound className="h-5 w-5" strokeWidth={1.75} /></Link></Button>
              <Button variant="ghost" size="icon" className="hidden rounded-none md:inline-flex" onClick={logout} data-testid="logout-button"><LogOut className="h-5 w-5" strokeWidth={1.75} /></Button>
            </>
          ) : (
            <Button asChild size="sm" className="rounded-[10px] border border-[color:var(--rule-strong)] bg-primary px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0A0A0A] hover:bg-foreground hover:text-background sm:px-4" data-testid="login-button">
              <Link to="/connexion" aria-label={t("nav.login")}><UserRound className="h-4 w-4 sm:hidden" strokeWidth={2} /><span className="hidden sm:inline">{t("nav.login")}</span></Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
