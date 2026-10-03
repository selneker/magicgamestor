import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { ShoppingBag, Sparkles, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
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
    <span data-testid="admin-status-badge" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-[0.08em] ${online ? "border-[color:var(--rule-strong)] bg-primary text-[#0A0A0A]" : "text-muted-foreground"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "animate-pulse bg-[#0A0A0A]" : "bg-current"}`} />
      {online ? t("status.online") : t("status.offline")}
    </span>
  );
}

// Loyalty points chip for the mobile header. Reference-matched hierarchy:
// a prominent numeric value (bold, 15px) with a secondary "pts" label and a
// lime star icon. Readable at a glance; keeps the pill compact for mobile.
function LoyaltyChip() {
  const { user } = useAuth();
  const [total, setTotal] = useState(null);

  useEffect(() => {
    if (!user) { setTotal(null); return; }
    let cancelled = false;
    api.get("/loyalty/me")
      .then((r) => { if (!cancelled) setTotal(r.data?.balance?.total ?? 0); })
      .catch(() => { if (!cancelled) setTotal(null); });
    return () => { cancelled = true; };
  }, [user]);

  if (!user || total === null) return null;

  return (
    <Link
      to="/compte/points"
      data-testid="header-loyalty-chip"
      aria-label={`${total} points fidélité`}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[color:var(--rule-strong)] bg-foreground px-2.5 text-background transition-transform hover:-translate-y-0.5 active:scale-[0.96] md:h-10 md:px-3"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[#0A0A0A] md:h-5 md:w-5">
        <Sparkles className="h-3 w-3" strokeWidth={2.5} />
      </span>
      <span className="num leading-none text-background text-[15px] font-bold md:text-[16px]" data-testid="header-loyalty-value">{total}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-background/70 leading-none">pts</span>
    </Link>
  );
}

export function Header() {
  const { t } = useLang();
  const { user, isAdmin } = useAuth();
  const { count, setOpen } = useCart();
  const link = ({ isActive }) => `relative whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${isActive ? "text-foreground after:absolute after:-bottom-1.5 after:left-0 after:h-[3px] after:w-full after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <header className="glass sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 max-w-7xl flex-nowrap items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link to="/" data-testid="header-logo" className="shrink-0 whitespace-nowrap font-display text-[13px] font-bold uppercase leading-none tracking-tight text-foreground sm:text-lg">
          Magic<span className="rounded-[4px] bg-primary px-1 text-[#0A0A0A]">Game</span>Store
        </Link>
        <div className="hidden shrink-0 xl:block"><StatusBadge /></div>
        <nav className="ml-auto hidden shrink-0 items-center gap-5 md:flex lg:gap-6">
          <NavLink to="/boutique?type=uc" className={link} data-testid="nav-uc">{t("nav.uc")}</NavLink>
          <NavLink to="/boutique?type=prime,prime_plus" className={link} data-testid="nav-prime">{t("nav.prime")}</NavLink>
          <NavLink to="/pack-evolutif" className={link} data-testid="nav-evo">{t("nav.evo")}</NavLink>
          <NavLink to="/evenements" className={link} data-testid="nav-events">{t("nav.eventsFull")}</NavLink>
          <NavLink to="/suivi" className={link} data-testid="nav-track">{t("nav.orders")}</NavLink>
          {isAdmin && <NavLink to="/admin" className={link} data-testid="nav-admin">{t("nav.admin")}</NavLink>}
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1 md:ml-0 md:gap-1.5">
          <LoyaltyChip />
          <ChatLink />
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} data-testid="cart-button" className="relative rounded-none">
            <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
            {count > 0 && <span data-testid="cart-count" className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center bg-primary px-1 text-[10px] font-black text-[#0A0A0A]">{count}</span>}
          </Button>
          {user ? (
            <>
              <Button asChild variant="ghost" size="icon" className="rounded-none" data-testid="account-button"><Link to="/compte"><UserRound className="h-5 w-5" strokeWidth={1.75} /></Link></Button>
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
