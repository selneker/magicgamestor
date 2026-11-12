// Mobile bottom chrome (bottom nav + floating game button) and the cart bar.
//
// The route list was duplicated in BottomNav.js and GameButton.js; it is now
// shared so the cart bar can never disagree with the nav about which chrome is
// on screen. If you change one, change it here.

const HIDDEN_BOTTOM_CHROME_PREFIXES = ["/admin", "/compte", "/privacy", "/terms", "/commande"];

// True on routes where the mobile bottom navigation and its FAB are not rendered.
export const hidesBottomChrome = (pathname = "") =>
  HIDDEN_BOTTOM_CHROME_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// PL-CHK-4 — mode « focalisé » : AUCUN chrome du site (header, footer, nav
// basse, barre panier, sélecteur rapide de jeu, bannière « Commande en cours »)
// sur le tunnel de commande (/commande…), l'écran de paiement /orders/:id et
// les pages de connexion / inscription / mot de passe oublié. Chaque page y
// rend son PROPRE en-tête minimal (flèche retour, logo). Source unique : le
// Layout et les pages lisent toutes cette liste — pas de logique dispersée.
const FOCUSED_PREFIXES = ["/commande", "/orders/", "/connexion", "/inscription", "/mot-de-passe-oublie"];

export const isFocusedRoute = (pathname = "") =>
  FOCUSED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// PL-UX-4 — l'admin n'a pas de pied de page : ni le footer du site, ni son
// bandeau. Les pages PUBLIQUES gardent le leur. (La barre de navigation basse
// de l'admin reste : c'est la navigation mobile de l'admin, l'équivalent de
// sa barre latérale desktop — sans elle, l'admin serait inaccessible en
// mobile.)
export const isAdminRoute = (pathname = "") => pathname.startsWith("/admin");

// PL-UX-4 — le footer du site est montré partout SAUF en mode « focalisé »
// et dans l'admin (qui n'a aucun pied de page).
export const showsSiteFooter = (pathname = "") => !isFocusedRoute(pathname) && !isAdminRoute(pathname);

// A product page renders its own sticky buy bar (Product.js), which occupies the
// same slot just above the bottom nav.
export const isProductRoute = (pathname = "") => pathname.startsWith("/produit/");

// The cart bar is the mobile "browse -> checkout" CTA. It exists only where the
// bottom nav exists (so it never floats over an empty gap), never on a product
// page (own buy bar), and never while an overlay is open (cart drawer, game
// selector, chat panel) — a modal must not have a floating CTA painted over it.
export const showsCartBar = ({ pathname = "", hasItems = false, drawerOpen = false, panelOpen = false, selectorOpen = false } = {}) =>
  hasItems && !drawerOpen && !panelOpen && !selectorOpen && !hidesBottomChrome(pathname) && !isProductRoute(pathname);
