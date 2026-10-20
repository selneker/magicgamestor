// Mobile bottom chrome (bottom nav + floating game button) and the cart bar.
//
// The route list was duplicated in BottomNav.js and GameButton.js; it is now
// shared so the cart bar can never disagree with the nav about which chrome is
// on screen. If you change one, change it here.

const HIDDEN_BOTTOM_CHROME_PREFIXES = ["/admin", "/compte", "/privacy", "/terms", "/commande"];

// True on routes where the mobile bottom navigation and its FAB are not rendered.
export const hidesBottomChrome = (pathname = "") =>
  HIDDEN_BOTTOM_CHROME_PREFIXES.some((prefix) => pathname.startsWith(prefix));

// A product page renders its own sticky buy bar (Product.js), which occupies the
// same slot just above the bottom nav.
export const isProductRoute = (pathname = "") => pathname.startsWith("/produit/");

// The cart bar is the mobile "browse -> checkout" CTA. It exists only where the
// bottom nav exists (so it never floats over an empty gap), never on a product
// page (own buy bar), and never while an overlay is open (cart drawer, game
// selector, chat panel) — a modal must not have a floating CTA painted over it.
export const showsCartBar = ({ pathname = "", hasItems = false, drawerOpen = false, panelOpen = false, selectorOpen = false } = {}) =>
  hasItems && !drawerOpen && !panelOpen && !selectorOpen && !hidesBottomChrome(pathname) && !isProductRoute(pathname);
