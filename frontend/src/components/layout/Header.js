import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/Logo";
import { formatPointsCount } from "@/lib/pointsFormat";
import { initMenu } from "@/lib/slush";

// PL-005-FE-08 : le repli au scroll de l'ancienne barre mobile est retiré —
// la pilule mobile est FIXE et ne se masque plus (le panier épinglé doit
// rester visible en permanence, cf. point 5 de la mission). La fonction
// useHeaderCollapse n'a plus d'usage.

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
        <Icon name="jeton-vert" className="h-3 w-3" />
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
          <Icon name="jeton-vert" className="h-3 w-3" />
        </span>
        <span className="num text-[13px] font-bold leading-none text-background" data-testid="header-loyalty-pill-value">
          {formatPointsCount(total, lang)}
        </span>
      </span>
    </Link>
  );
}

function CartButton({ circle = false }) {
  const { t } = useLang();
  const { count, setOpen } = useCart();
  if (circle) {
    // PL-005-FE-08 point 5 — panier ÉPINGLÉ dans la pilule mobile : bouton
    // rond maquette (.nav-btn-circle, 44 px), badge interne (le cercle a
    // overflow:clip). L'ensemble de la pilule est fixe : le panier reste
    // visible à l'écran en permanence.
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="cart-button-mobile" aria-label={t("nav.cart")} className="nav-btn-circle relative">
        <Icon name="portefeuille" className="h-5 w-5" />
        {count > 0 && <span data-testid="cart-count" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-black text-[color:var(--brand-ink)]">{count}</span>}
      </button>
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={() => setOpen(true)} data-testid="cart-button" aria-label={t("nav.cart")} className="relative rounded-none">
      <Icon name="portefeuille" className="h-5 w-5" />
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

function DesktopMenu({ isAdmin, burgerRef, toggleable = false, withLinks = false }) {
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
        id={toggleable ? undefined : "menuButton"}
        ref={btnRef}
        data-testid="desktop-menu-button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        onClick={() => {
          // Desktop = survol (initMenu) ; le toggle n'a de sens que pour
          // l'instance mobile de la pilule (toggleable). matchMedia absent
          // (jsdom) : on considère le bureau.
          const desktop = typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 992px)").matches;
          if (toggleable || desktop) setOpenMenu((v) => !v);
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
          {withLinks && [
            { to: "/boutique", label: t("nav.shop") },
            { to: "/evenements", label: t("nav.eventsFull") },
            { to: "/suivi", label: t("nav.orders") },
            { to: "/chat", label: t("nav.messages") },
          ].map(({ to, label }) => (
            <Link key={to} to={to} role="menuitem" className={item} onClick={() => setOpenMenu(false)}>{label}</Link>
          ))}
          {isAdmin && <Link to="/admin" role="menuitem" data-testid="desktop-menu-admin" className={item}>{t("nav.admin")}</Link>}
          {user ? (
            <>
              <Link to="/compte" role="menuitem" className={item}><UserRound className="h-4 w-4" strokeWidth={1.75} />{t("nav.account")}</Link>
              <Link to="/compte/points" role="menuitem" className={item}><Icon name="jeton-vert" className="h-4 w-4" />{t("nav.points")}</Link>
            </>
          ) : (
            <Link to="/connexion" role="menuitem" className={item}><UserRound className="h-4 w-4" strokeWidth={1.75} />{t("nav.login")}</Link>
          )}
          <button type="button" role="menuitem" onClick={() => { setOpenMenu(false); setOpen(true); }} className={`${item} w-full text-left`}>
            <Icon name="portefeuille" className="h-4 w-4" />{t("nav.cart")}
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
      {/* ── PL-005-FE-08 point 5 — pilule Slush mobile (< 992 px) ──────────
           Même structure maquette que la nav desktop (.nav-w fixe +
           .nav-inner + .nav-btn-circle), adaptée : les pilules de pages
           sont masquées (la barre du bas les porte) et le panneau du burger
           les liste (withLinks). Actions compte (points / avatar) et
           PANIER ÉPINGLÉ dedans : l'ensemble est fixe à l'écran et ne se
           replie plus au scroll. Écart documenté : la maquette mobile n'a
           que logo + burger, mais ni le compte ni le panier n'ont d'autre
           point d'entrée sur mobile (la bottom-nav ne porte ni l'un ni
           l'autre). L'ancien « panier flottant » d'avant redesign est
           introuvable dans l'historique (git log -S sur toutes les
           branches) — choix retenu : fixe en haut à droite, dans la
           pilule. ── */}
      <div className="nav-w nav-w--mobile min-[992px]:hidden" data-testid="header-mobile">
        <div className="nav-container container">
          <nav className="nav-inner" aria-label={t("nav.mainNav")}>
            <Link to="/" className="nav-btn-circle is--nav-logo" aria-label="Magic Game Store" data-testid="header-logo-mobile">
              <Logo className="nav-button-logo" />
            </Link>
            <div className="nav-inner-right">
              <MobilePointsPill />
              <AccountAction avatar />
              <CartButton circle />
              <DesktopMenu isAdmin={isAdmin} toggleable withLinks />
            </div>
          </nav>
        </div>
        {offline && !loading && (
          <div role="status" className="pointer-events-auto mx-3 mt-2 rounded-full border bg-card px-4 py-1.5 text-center text-[11px] font-medium leading-snug text-foreground" data-testid="auth-offline-banner-mobile">
            {t("auth.wakeFailed")}{" "}
            <button type="button" onClick={refresh} className="font-semibold underline underline-offset-2" data-testid="auth-offline-retry-mobile">
              {t("auth.retry")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
