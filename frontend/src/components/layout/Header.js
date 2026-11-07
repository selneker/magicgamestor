import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { formatPointsCount } from "@/lib/pointsFormat";

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

// Repli de l'en-tête au défilement (PL-BRAND-1, mobile uniquement) : en
// descendant l'en-tête se replie (transform seul — aucun saut de mise en
// page), en remontant il réapparaît. Désactivé avec prefers-reduced-motion
// et sur bureau (>= 768 px). (matchMedia gardé : jsdom ne le fournit pas.)
export function useHeaderCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < 4) return;
      if (window.innerWidth >= 768 || reduced) {
        setCollapsed(false);
      } else {
        setCollapsed(y > lastY && y > 56);
      }
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return collapsed;
}

// Loyalty points chip for the desktop header. Reference-matched hierarchy:
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

// Pastille de points compacte (PL-BRAND-1, mobile uniquement) : hauteur
// visuelle 28 px dans une cible tactile de 44 px, valeur abrégée
// (formatPointsCount), pas de libellé « pts » visible (dans l'aria-label).
// Le solde exact reste visible sur la page Points, destination du lien.
function MobilePointsPill() {
  const { user } = useAuth();
  const { t, lang } = useLang();
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
      data-testid="header-loyalty-pill"
      aria-label={t("nav.pointsAria", { n: total })}
      className="flex h-11 items-center rounded-full"
    >
      <span className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border border-[color:var(--rule-strong)] bg-foreground px-2 text-background">
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary">
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <span className="num text-[13px] font-bold leading-none text-background" data-testid="header-loyalty-pill-value">
          {formatPointsCount(total, lang)}
        </span>
      </span>
    </Link>
  );
}

function CartButton() {
  const { t } = useLang();
  const { count, setOpen } = useCart();
  return (
    <Button variant="ghost" size="icon" onClick={() => setOpen(true)} data-testid="cart-button" aria-label={t("nav.cart")} className="relative rounded-none">
      <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
      {count > 0 && <span data-testid="cart-count" className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center bg-primary px-1 text-[10px] font-black text-[#0A0A0A]">{count}</span>}
    </Button>
  );
}

// État du compte : spinner pendant la vérification, réessai si le serveur ne
// répond pas, avatar rond 32 px (mobile) ou icône (bureau) si connecté,
// bouton Connexion sinon. Partagé par la barre mobile et la barre bureau.
function AccountAction({ avatar = false }) {
  const { t } = useLang();
  const { user, loading, offline, refresh } = useAuth();

  if (loading) {
    return (
      <Button variant="ghost" size="icon" disabled data-testid="auth-loading-icon" aria-label={t("auth.loading")} className="rounded-none">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" strokeWidth={1.75} />
      </Button>
    );
  }
  if (offline) {
    return (
      <Button variant="ghost" size="icon" onClick={refresh} className="rounded-none" data-testid="auth-offline-button" aria-label={t("auth.retry")} title={t("auth.wakeFailed")}>
        <RefreshCw className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
      </Button>
    );
  }
  if (user) {
    return (
      <Button asChild variant="ghost" size="icon" className="rounded-none" data-testid="account-button">
        <Link to="/compte" aria-label={t("nav.account")}>
          {avatar ? (
            user.picture ? (
              <img src={user.picture} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-display text-sm font-black text-[#0A0A0A]">
                {(user.name || user.email || "?")[0].toUpperCase()}
              </span>
            )
          ) : (
            <UserRound className="h-5 w-5" strokeWidth={1.75} />
          )}
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" className="rounded-[10px] border border-[color:var(--rule-strong)] bg-primary px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0A0A0A] hover:bg-foreground hover:text-background sm:px-4" data-testid="login-button">
      <Link to="/connexion" aria-label={t("nav.login")}><UserRound className="h-4 w-4 sm:hidden" strokeWidth={2} /><span className="hidden sm:inline">{t("nav.login")}</span></Link>
    </Button>
  );
}

export function Header() {
  const { t } = useLang();
  const { user, loading, offline, refresh, isAdmin } = useAuth();
  const collapsed = useHeaderCollapse();
  const link = ({ isActive }) => `relative whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${isActive ? "text-foreground after:absolute after:-bottom-1.5 after:left-0 after:h-[3px] after:w-full after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <header
      className="glass sticky top-0 z-40 border-b will-change-transform motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"
      style={{ transform: collapsed ? "translateY(-100%)" : "translateY(0)" }}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* Mobile (< 768 px) : 3 zones en grille 1fr auto 1fr — le logo reste
          exactement centré quelle que soit la largeur de la pastille de points.
          Pas de rangée d'onglets : la navigation reste la barre du bas. */}
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-1 px-3 md:hidden" data-testid="header-mobile-bar">
        <div className="justify-self-start">
          <AccountAction avatar />
        </div>
        <Link to="/" data-testid="header-logo" aria-label="Magic Game Store" className="flex h-11 w-11 items-center justify-center justify-self-center text-foreground">
          <Logo className="h-8 w-8" />
        </Link>
        <div className="flex items-center justify-self-end gap-0.5">
          <MobilePointsPill />
          <CartButton />
        </div>
      </div>
      {/* Bureau (>= 768 px) : structure inchangée, le texte de marque devient
          le logo (aria-label = nom du magasin). */}
      <div className="mx-auto hidden h-16 max-w-7xl flex-nowrap items-center gap-2 px-3 sm:gap-4 sm:px-6 md:flex">
        <Link to="/" data-testid="header-logo" aria-label="Magic Game Store" className="shrink-0 text-foreground">
          <Logo className="h-9 w-9" />
        </Link>
        <div className="hidden shrink-0 xl:block"><StatusBadge /></div>
        <nav className="ml-auto hidden shrink-0 items-center gap-5 md:flex lg:gap-6">
          <NavLink to="/boutique" end className={link} data-testid="nav-shop">{t("nav.shop")}</NavLink>
          <NavLink to="/evenements" className={link} data-testid="nav-events">{t("nav.eventsFull")}</NavLink>
          <NavLink to="/suivi" className={link} data-testid="nav-track">{t("nav.orders")}</NavLink>
          <NavLink to="/chat" className={link} data-testid="nav-messages">{t("nav.messages")}</NavLink>
          {isAdmin && <NavLink to="/admin" className={link} data-testid="nav-admin">{t("nav.admin")}</NavLink>}
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1 md:ml-0 md:gap-1.5">
          <LoyaltyChip />
          <CartButton />
          <AccountAction />
        </div>
      </div>
      {offline && !loading && (
        <div role="status" className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-medium leading-snug text-amber-950" data-testid="auth-offline-banner">
          {t("auth.wakeFailed")}{" "}
          <button type="button" onClick={refresh} className="font-semibold underline underline-offset-2" data-testid="auth-offline-retry">
            {t("auth.retry")}
          </button>
        </div>
      )}
    </header>
  );
}
