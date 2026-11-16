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
import { initMenu } from "@/lib/slush";

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

/* ── PL-005-FE-03 refonte Slush — nav pilule FLOTTANTE de la maquette ──────
   Markup et classes EXACTS de 01-accueil.html (981-1003) : .nav-w fixe,
   #navContainer, .nav-inner, logo rond .nav-btn-circle, pilules
   .button-main (thème light + accent par position ; .is--current prend
   l'accent *-700 de sa position via design-system.css 6625-6628), burger
   .nav-btn-menu. Les animations (descente au chargement, masquage au
   scroll, hover du burger, slide mobile) vivent dans lib/slush.js.
   Les actions compte (points / panier / admin / connexion) n'ont pas
   d'équivalent dans la maquette : elles restent dans le panneau du burger
   (desktop) et dans la barre mobile conservée (< 992 px). */

// Mêmes correspondances que la barre du bas (lib/bottomChrome) : la nav
// desktop et la nav mobile considèrent les mêmes pages comme actives.
const NAV_MATCHES = [
  { to: "/boutique", match: (p) => p === "/" || p.startsWith("/boutique") || p.startsWith("/produit") || p.startsWith("/pack-evolutif") },
  { to: "/evenements", match: (p) => p.startsWith("/evenements") },
  { to: "/suivi", match: (p) => p.startsWith("/suivi") || p.startsWith("/commande") || p.startsWith("/compte") },
  { to: "/chat", match: (p) => p.startsWith("/chat") || p.startsWith("/support") },
];

// Pilule de nav (maquette .button-main, thème « light ») : face avant crème
// bordée d'encre, texte encre ; la face ARRIÈRE (hover 3D) porte l'accent.
// .is--current peint la face avant avec l'accent *-700 de la position
// (design-system.css 6625-6628) — le texte reste encre.
function DesktopNavButton({ to, label, accent, active, testId }) {
  return (
    <li className="nav-inner-li">
      <Link
        to={to}
        data-testid={testId}
        aria-current={active ? "page" : undefined}
        className={`button-main${active ? " is--current" : ""}`}
        data-button-theme="light"
        data-button-accent={accent}
      >
        <span className="button-main-inner full-h">
          <span className="button-main-inner__back" data-text={label}></span>
          <span className="button-main-inner__front">
            <span className="button-main-inner__bg"></span>
            <span className="button-main-inner__text"><span>{label}</span></span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function DesktopMenu({ isAdmin, burgerRef }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { setOpen } = useCart();
  const [open, setOpenMenu] = useState(false);
  const wrapRef = useRef(null);
  const localRef = useRef(null);
  const btnRef = burgerRef || localRef;

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
        id="menuButton"
        ref={btnRef}
        data-testid="desktop-menu-button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        onClick={() => {
          // Desktop = survol (initMenu) ; le toggle n'a de sens qu'en mobile.
          // matchMedia absent (jsdom) : on considère le bureau.
          const desktop = typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 992px)").matches;
          if (desktop) setOpenMenu((v) => !v);
        }}
        className="nav-btn-circle nav-btn-menu pointer-events-auto"
      >
        <span className="nav-btn-menu__lines">
          <span className="nav-btn-menu__line is--h"></span>
          <span className="nav-btn-menu__line is--v"></span>
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
  const burgerRef = useRef(null);

  // Menu de la maquette : hover du burger → les pilules réapparaissent
  // (desktop), scroll vers le bas → elles s'envolent, burger mobile →
  // slide des pilules. Portage dans lib/slush.js (initMenu).
  useEffect(() => {
    if (!burgerRef.current) return undefined;
    return initMenu(burgerRef.current);
  }, []);

  return (
    <>
      {/* ── Nav pilule flottante de la maquette (≥ 992 px, comme Slush) ── */}
      <div className="nav-w hidden min-[992px]:block" data-testid="header-desktop">
        <div id="navContainer" className="nav-container container">
          <nav className="nav-inner" aria-label={t("nav.mainNav")} data-testid="desktop-nav">
            <Link to="/" className="nav-btn-circle is--nav-logo" aria-label="Magic Game Store" data-testid="header-logo">
              <Logo className="nav-button-logo" />
            </Link>
            <div className="nav-inner-right">
              <ul className="nav-inner-list" role="list">
                {[
                  { to: "/boutique", label: t("nav.shop"), accent: "violet", id: "desktop-nav-shop" },
                  { to: "/evenements", label: t("nav.eventsFull"), accent: "blue", id: "desktop-nav-events" },
                  { to: "/suivi", label: t("nav.orders"), accent: "green", id: "desktop-nav-orders" },
                  { to: "/chat", label: t("nav.messages"), accent: "yellow", id: "desktop-nav-support" },
                ].map(({ to, label, accent, id }, i) => (
                  <DesktopNavButton key={to} to={to} label={label} accent={accent} active={NAV_MATCHES[i].match(pathname)} testId={id} />
                ))}
              </ul>
              <DesktopMenu isAdmin={isAdmin} burgerRef={burgerRef} />
              <div className="ml-1 flex shrink-0 items-center gap-1">
                <LoyaltyChip />
                <span className="[&_button]:pointer-events-auto"><CartButton /></span>
              </div>
            </div>
          </nav>
        </div>
        {offline && !loading && (
          <div role="status" className="pointer-events-auto mx-auto mt-2 w-fit rounded-full border bg-card px-4 py-1.5 text-center text-[11px] font-medium leading-snug text-foreground" data-testid="auth-offline-banner">
            {t("auth.wakeFailed")}{" "}
            <button type="button" onClick={refresh} className="font-semibold underline underline-offset-2" data-testid="auth-offline-retry">
              {t("auth.retry")}
            </button>
          </div>
        )}
      </div>
      {/* ── Barre mobile conservée (< 992 px) : compte / logo / points / panier.
             Écart documenté : la maquette mobile n'a que logo + burger, mais
             ni le compte ni le panier n'ont d'autre point d'entrée sur mobile
             (la bottom-nav ne porte ni l'un ni l'autre). ── */}
      <header
        className="glass sticky top-0 z-40 border-b will-change-transform motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out max-[991px]:block hidden"
        style={{ transform: collapsed ? "translateY(-100%)" : "translateY(0)" }}
        data-collapsed={collapsed ? "true" : "false"}
        data-testid="header-mobile-bar"
      >
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-1 px-3">
          <div className="justify-self-start">
            <AccountAction avatar />
          </div>
          <Link to="/" aria-label="Magic Game Store" className="flex h-11 w-11 items-center justify-center justify-self-center text-foreground">
            <Logo className="h-8 w-8" />
          </Link>
          <div className="flex items-center justify-self-end gap-0.5">
            <MobilePointsPill />
            <CartButton />
          </div>
        </div>
        {offline && !loading && (
          <div role="status" className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-medium leading-snug text-amber-950" data-testid="auth-offline-banner-mobile">
            {t("auth.wakeFailed")}{" "}
            <button type="button" onClick={refresh} className="font-semibold underline underline-offset-2">
              {t("auth.retry")}
            </button>
          </div>
        )}
      </header>
    </>
  );
}
