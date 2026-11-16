import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { formatPointsCount } from "@/lib/pointsFormat";

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
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[color:var(--brand-ink)] md:h-5 md:w-5">
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
      {count > 0 && <span data-testid="cart-count" className="absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center bg-primary px-1 text-[10px] font-black text-[color:var(--brand-ink)]">{count}</span>}
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
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-display text-sm font-black text-[color:var(--brand-ink)]">
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
    <Button asChild size="sm" className="rounded-[10px] border border-[color:var(--rule-strong)] bg-primary px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--brand-ink)] hover:bg-foreground hover:text-background sm:px-4" data-testid="login-button">
      <Link to="/connexion" aria-label={t("nav.login")}><UserRound className="h-4 w-4 sm:hidden" strokeWidth={2} /><span className="hidden sm:inline">{t("nav.login")}</span></Link>
    </Button>
  );
}

/* ── PL-005-FE-03 — Navigation desktop « pilule » (maquette PL-DS-003) ────
   Pilule encre : logo rond à gauche, boutons colorés (Boutique / Événements /
   Commandes / Support), bouton menu. Mêmes entrées et mêmes routes que la nav
   desktop précédente (l'entrée Admin vit dans le menu, comme les actions
   compte / panier / points — la maquette n'a que 4 boutons). Reconstruction
   maison : AUCUN CSS tiers copié, PAS de transition 3D (navigation = routeur).
   L'état actif reprend les accents de la maquette (violet/bleu/vert/jaune). */

// Mêmes correspondances que la barre du bas (lib/bottomChrome) : la nav
// desktop et la nav mobile considèrent les mêmes pages comme actives.
const NAV_MATCHES = [
  { to: "/boutique", match: (p) => p === "/" || p.startsWith("/boutique") || p.startsWith("/produit") || p.startsWith("/pack-evolutif") },
  { to: "/evenements", match: (p) => p.startsWith("/evenements") },
  { to: "/suivi", match: (p) => p.startsWith("/suivi") || p.startsWith("/commande") || p.startsWith("/compte") },
  { to: "/chat", match: (p) => p.startsWith("/chat") || p.startsWith("/support") },
];

// Accents de la maquette, PAR POSITION (design-system.css 6623-6628 :
// .is--current prend l'accent *-700 de sa position — violet-700 lavande
// #e9ccff pour Boutique, bleu/vert/jaune pour les suivants). Texte FIXE encre
// (jamais thème-relatif) : sur ces accents clairs, l'encre passe dans les
// deux thèmes.
const NAV_ACCENTS = {
  violet: "bg-[color:var(--brand-violet-soft)] text-[color:var(--brand-ink)]",
  blue: "bg-[color:var(--brand-blue)] text-[color:var(--brand-ink)]",
  green: "bg-[color:var(--brand-green)] text-[color:var(--brand-ink)]",
  yellow: "bg-[color:var(--brand-yellow)] text-[color:var(--brand-ink)]",
};

// Bouton de nav (maquette .button-main theme « light ») : pilule CRÈME FIXE
// bordée d'ENCRE, texte encre — posée sur la barre glass (écart documenté :
// les pages ne réservent pas l'espace .page-top de la maquette, la nav vit
// dans la barre sticky existante). Pas de retournement 3D : le survol montre
// directement l'accent de la face arrière (règle « pas de transition 3D »).
function DesktopNavButton({ to, label, accent, active, testId }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center whitespace-nowrap rounded-full border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-cream)] px-3.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--brand-ink)] transition-transform motion-safe:duration-200 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 lg:px-4 ${active ? NAV_ACCENTS[accent] : ""}`}
    >
      {label}
    </Link>
  );
}

function DesktopMenu({ isAdmin }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { setOpen } = useCart();
  const [open, setOpenMenu] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpenMenu(false); };
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpenMenu(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const item = "flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-foreground hover:bg-[color:hsl(var(--muted))]";
  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        data-testid="desktop-menu-button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        onClick={() => setOpenMenu((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-cream)] text-[color:var(--brand-ink)] transition-transform motion-safe:duration-300 hover:rotate-90 motion-reduce:hover:rotate-0"
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          <span className="absolute h-[2px] w-3.5 bg-current" />
          <span className="absolute h-3.5 w-[2px] bg-current" />
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-[14px] border bg-card p-1.5 shadow-[0_1em_2.5em_hsl(0_0%_0%/.25)]" data-testid="desktop-menu" role="menu">
          {isAdmin && <Link to="/admin" role="menuitem" data-testid="desktop-menu-admin" className={item}>{t("nav.admin")}</Link>}
          {user ? (
            <>
              <Link to="/compte" role="menuitem" className={item}><UserRound className="h-4 w-4" strokeWidth={1.75} />{t("nav.account")}</Link>
              <Link to="/compte/points" role="menuitem" className={item}><Sparkles className="h-4 w-4" strokeWidth={1.75} />{t("nav.points")}</Link>
            </>
          ) : (
            <Link to="/connexion" role="menuitem" className={item}><UserRound className="h-4 w-4" strokeWidth={1.75} />{t("nav.login")}</Link>
          )}
          <button type="button" role="menuitem" onClick={() => { setOpenMenu(false); setOpen(true); }} className={`${item} w-full text-left`}>
            <ShoppingBag className="h-4 w-4" strokeWidth={1.75} />{t("nav.cart")}
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { t } = useLang();
  const { isAdmin, offline, loading, refresh } = useAuth();
  const { pathname } = useLocation();
  const collapsed = useHeaderCollapse();

  // Pastille logo ronde (maquette .nav-btn-circle : crème fixe + bordure
  // encre 0.125em) : notre logo principal, jamais celui de la maquette.
  // Couleurs FIXES de marque (l'encre se voit dans les deux thèmes).
  const logoCircle = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--brand-ink)] bg-[color:var(--brand-cream)] text-[color:var(--brand-ink)] transition-transform motion-safe:duration-300 hover:rotate-[360deg]";
  // Boutons de nav individuels (maquette : pilules crème bordées d'encre),
  // simplement alignés — PAS de conteneur encre.

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
      {/* Bureau (>= 768 px) — nav de la maquette dans la barre glass : logo
          rond à gauche, pilules crème bordées d'encre, menu croix à droite ;
          les actions (points / panier / compte) restent visibles après. */}
      <div className="mx-auto hidden h-16 max-w-7xl flex-nowrap items-center gap-3 px-3 sm:px-6 md:flex" data-testid="header-desktop">
        <Link to="/" data-testid="header-logo" aria-label="Magic Game Store" className={`${logoCircle} shrink-0`}>
          <Logo className="h-5 w-5" />
        </Link>
        <nav aria-label={t("nav.mainNav")} className="flex min-w-0 items-center gap-1.5" data-testid="desktop-nav">
          {[
            { to: "/boutique", label: t("nav.shop"), accent: "violet", id: "desktop-nav-shop" },
            { to: "/evenements", label: t("nav.eventsFull"), accent: "blue", id: "desktop-nav-events" },
            { to: "/suivi", label: t("nav.orders"), accent: "green", id: "desktop-nav-orders" },
            { to: "/chat", label: t("nav.messages"), accent: "yellow", id: "desktop-nav-support" },
          ].map(({ to, label, accent, id }, i) => (
            <DesktopNavButton key={to} to={to} label={label} accent={accent} active={NAV_MATCHES[i].match(pathname)} testId={id} />
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1 sm:gap-1.5">
          <LoyaltyChip />
          <CartButton />
          <DesktopMenu isAdmin={isAdmin} />
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
