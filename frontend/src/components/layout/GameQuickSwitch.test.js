import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/context/LanguageContext";
import { CartProvider } from "@/context/CartContext";
import { GameProvider } from "@/context/GameContext";
import { BottomNav } from "./BottomNav";
import { CartDrawer } from "@/components/store/CartDrawer";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-router-dom", () => {
  const React = require("react");
  const state = { pathname: "/", search: "", navigate: jest.fn(), setQuery: jest.fn() };
  global.__rrState = state;
  const Anchor = ({ className, children, ...props }) => React.createElement("a", props, children);
  return {
    Link: Anchor,
    NavLink: Anchor,
    useLocation: () => ({ pathname: state.pathname }),
    useNavigate: () => state.navigate,
    useSearchParams: () => [new URLSearchParams(state.search), state.setQuery],
  };
});
// Seuls les services réseau sont simulés : les providers (Language/Cart/Game)
// sont réels, comme dans l'application.
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatAr: (n) => `${Number(n || 0).toLocaleString("fr-FR")} Ar`,
}));
jest.mock("@/context/ChatContext", () => ({ useChat: () => ({ panelOpen: false }) }));

import { api } from "@/lib/api";

const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", icon_url: "data:image/png;base64,iVBORw0KGgo=", active: true, sort_order: 0 },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", active: true, sort_order: 1 },
  { id: "genshin", slug: "genshin", name: "Genshin Impact", icon_url: "data:image/png;base64,iVBORw0KGgo=", active: true, sort_order: 2 },
  { id: "gta-v", slug: "gta-v", name: "GTA V", active: true, sort_order: 3 },
  { id: "coc", slug: "coc", name: "Clash of Clans", active: true, sort_order: 4 },
  { id: "fortnite", slug: "fortnite", name: "Fortnite", active: true, sort_order: 5 },
];

// Fonction-composant : chaque `root.render(<Chrome/>)` reconstruit l'arbre
// (un élément React constant ferait un bail-out sans re-rendu).
function Chrome() {
  return (
    <LanguageProvider><CartProvider><GameProvider><BottomNav /><CartDrawer /></GameProvider></CartProvider></LanguageProvider>
  );
}

let container;
let root;

function setViewport(w) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Chrome />); });
  await act(async () => {}); // laisse GameProvider finir son fetch des jeux
  return container;
}

const scope = (c) => (typeof c === "function" ? c() : c) || container;
const q = (sel, c) => scope(c).querySelector(sel);
const all = (sel, c) => Array.from(scope(c).querySelectorAll(sel));

beforeEach(() => {
  container = null;
  root = null;
  document.body.innerHTML = "";
  localStorage.clear();
  global.__rrState.pathname = "/";
  global.__rrState.search = "";
  global.__rrState.navigate.mockReset();
  api.get.mockReset();
  api.get.mockResolvedValue({ data: GAMES });
  setViewport(390);
  // jsdom n'a pas matchMedia : on simule « reduced motion » actif car les
  // animations 150-200 ms doivent alors être désactivées (framer-motion ne
  // bouge pas sous jsdom ; les sorties d'animation resteraient figées).
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    // framer-motion utilise encore l'API legacy addListener/removeListener.
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); }
  container = null;
});

// ---------------------------------------------------------------- PL-UI-BOTTOM-1

test("ci-1 : aucun rendu du composant au-dessus de 1024 px (desktop inchangé)", async () => {
  setViewport(1280);
  const c = await mount();
  expect(q('[data-testid="game-button"]', () => c)).toBeNull();
  expect(q('[data-testid="game-selector-panel"]', () => c)).toBeNull();
});

test("ci-2 : bouton manette présent sous 1024 px, aligné avec la navigation", async () => {
  const c = await mount();
  const button = q('[data-testid="game-button"]', () => c);
  expect(button).not.toBeNull();
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  // Icône manette générique hors route de jeu.
  expect(q('[data-testid="game-button-game-icon"] svg', () => c)).not.toBeNull();
});

test("ci-3 : sur une page de jeu, le bouton affiche le logo du jeu ouvert", async () => {
  global.__rrState.pathname = "/boutique";
  global.__rrState.search = "?game=pubg-mobile";
  const c = await mount();
  const button = q('[data-testid="game-button"]', () => c);
  expect(q("img", button)).not.toBeNull();
});

test("ci-4 : appui ouvre la pill (role=menu), Échap la ferme, clic extérieur la ferme", async () => {
  const c = await mount();
  const button = q('[data-testid="game-button"]', () => c);
  await act(async () => { button.click(); });
  const panel = q('[data-testid="game-selector-panel"]', () => c);
  expect(panel).not.toBeNull();
  expect(panel.getAttribute("role")).toBe("menu");
  expect(button.getAttribute("aria-expanded")).toBe("true");

  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).toBeNull();

  await act(async () => { button.click(); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).not.toBeNull();
  await act(async () => { document.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).toBeNull();
  // Le bouton manette lui-même ne referme pas par « clic extérieur » : il bascule.
  await act(async () => { button.click(); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).not.toBeNull();
  await act(async () => { button.click(); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).toBeNull();
});

test("ci-5 : le jeu actif est entouré (aria-checked), un appui navigue vers sa page", async () => {
  const c = await mount();
  await act(async () => { q('[data-testid="game-button"]', () => c).click(); });
  const active = q('[data-testid="game-selector-item-pubg-mobile"]', () => c);
  expect(active.getAttribute("aria-checked")).toBe("true");
  expect(all('[role="menuitemradio"]', () => c).filter((el) => el.getAttribute("aria-checked") === "true")).toHaveLength(1);

  await act(async () => { active.click(); });
  expect(global.__rrState.navigate).toHaveBeenCalledWith("/boutique?game=pubg-mobile");
  expect(q('[data-testid="game-selector-panel"]', () => c)).toBeNull();
});

test("ci-6 : au-delà de 5 jeux, 5 logos puis l'entrée « Tous » vers la liste des jeux", async () => {
  const c = await mount();
  await act(async () => { q('[data-testid="game-button"]', () => c).click(); });
  expect(all('[role="menuitemradio"]', () => c)).toHaveLength(5);
  const allBtn = q('[data-testid="game-selector-all"]', () => c);
  expect(allBtn).not.toBeNull();
  expect(allBtn.getAttribute("aria-label")).toBe("Tous");
  expect(all('[role="menuitemradio"]', () => c).length + 1).toBeGreaterThanOrEqual(6);
  await act(async () => { allBtn.click(); });
  expect(global.__rrState.navigate).toHaveBeenCalledWith("/boutique");
});

test("ci-7 : la pill se ferme au changement de route", async () => {
  const c = await mount();
  await act(async () => { q('[data-testid="game-button"]', () => c).click(); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).not.toBeNull();
  global.__rrState.pathname = "/suivi";
  // re-rendu complet : le composant Chrome recrée tout l'arbre avec le
  // nouveau pathname simulé → la pill doit se fermer au changement de route.
  await act(async () => { root.render(<Chrome />); });
  expect(q('[data-testid="game-selector-panel"]', () => c)).toBeNull();
});

test("ci-8 : aucune barre panier quand le panier est vide ; présente sinon, sans l'astuce de frais", async () => {
  // Panier vide → pas de barre.
  let c = await mount();
  expect(q('[data-testid="mobile-cart-bar"]', () => c)).toBeNull();
  await act(async () => { root.unmount(); });

  // Panier contenant 2 articles → barre flottante : compteur, total, Commande.
  localStorage.setItem("mgs_cart", JSON.stringify([
    { id: "i1", slug: "uc-660", name: "660 UC", type: "uc", price: 25000, game_id: "pubg-mobile", qty: 2 },
  ]));
  global.__rrState.pathname = "/boutique";
  global.__rrState.search = "?game=pubg-mobile";
  c = await mount();
  const bar = q('[data-testid="mobile-cart-bar"]', () => c);
  expect(bar).not.toBeNull();
  const text = bar.textContent.replace(/[\u00a0\u202f]/g, " ");
  expect(text).toContain("2 articles");
  expect(text).toContain("50 000 Ar");
  expect(text).toContain("Commander");
  // L'astuce « Des frais peuvent s'ajouter... » n'est plus affichée dans la barre.
  expect(bar.textContent).not.toContain("Des frais");
});

test("ci-9 : la variable CSS de réserve du bas de page est posée quand la barre est visible", async () => {
  localStorage.setItem("mgs_cart", JSON.stringify([
    { id: "i1", slug: "uc-660", name: "660 UC", type: "uc", price: 25000, game_id: "pubg-mobile", qty: 1 },
  ]));
  global.__rrState.pathname = "/boutique";
  const c = await mount();
  const reserve = document.documentElement.style.getPropertyValue("--bottom-chrome-reserve");
  expect(reserve).toContain("calc");
});

// ---------------------------------------------------------------- PL-NAV-1-COMPACT

test("nav-1 : la barre du bas est la pilule fixe de la maquette (.bottom-nav)", async () => {
  const c = await mount();
  const nav = q('[data-testid="bottom-nav"]', () => c);
  expect(nav).not.toBeNull();
  // PL-005-FE-03 : classes de la maquette (mg-components.css), bouton jeu
  // DANS la barre comme l'item --game de 01-accueil.html.
  expect(nav.className).toContain("bottom-nav");
  expect(nav.contains(q('[data-testid="game-button"]', () => c))).toBe(true);
  // Aucun onglet n'est étiré par un flexGrow inline (l'ancien style {flexGrow: ...}).
  for (const item of all('[data-testid^="bottom-nav-"]', () => c)) {
    expect(item.getAttribute("style")).toBeNull();
  }
});

test("nav-2 : items maquette — icône + libellé, état actif porté par .is--active", async () => {
  const c = await mount();
  // Le mock NavLink de test ignore className (les <a> n'en portent pas) :
  // on vérifie la structure (icône + libellé) et l'état actif via le rendu.
  const shop = q('[data-testid="bottom-nav-shop"]', () => c);
  expect(shop.querySelector("svg")).not.toBeNull(); // icône
  expect(shop.textContent).toContain("Boutique"); // libellé toujours visible
  const events = q('[data-testid="bottom-nav-events"]', () => c);
  expect(events.textContent).toContain("Event");
  // L'état actif suit la route (Boutique actif sur /boutique).
  global.__rrState.pathname = "/boutique";
  await act(async () => { root.render(<Chrome />); });
  const shopAgain = q('[data-testid="bottom-nav-shop"]', () => c);
  expect(shopAgain.getAttribute("aria-current")).toBe("page");
});

test("nav-3 : le sélecteur de jeu est une grille de 2 colonnes, jamais une rangée", async () => {
  const c = await mount();
  await act(async () => { q('[data-testid="game-button"]', () => c).click(); });
  const list = q('[data-testid="game-selector-list"]', () => c);
  expect(list).not.toBeNull();
  expect(list.className).toContain("grid-cols-2");
  expect(list.className).toContain("overflow-y-auto");
  expect(list.className).not.toContain("flex items-center");
  // Toutes les cibles restent >= 44 px de haut et ont un libellé de jeu.
  for (const card of all('[role="menuitemradio"]', () => c)) {
    expect(card.className).toContain("min-h-[44px]");
  }
  const active = q('[data-testid="game-selector-item-pubg-mobile"]', () => c);
  expect(active.getAttribute("aria-checked")).toBe("true");
  expect(active.className).toContain("bg-primary"); // jeu actif clairement marqué
  // Ancre : le panneau reste au-dessus du bouton manette (bottom + safe-area).
  const panel = q('[data-testid="game-selector-panel"]', () => c);
  expect(panel.className).toContain("bottom-[calc(max(0.75rem,env(safe-area-inset-bottom,0px))+4.5rem)]");
});

test("nav-4 : bouton manette — conteneur rond positionné, image qui remplit le cercle, icône centrée", async () => {
  global.__rrState.pathname = "/boutique";
  global.__rrState.search = "?game=pubg-mobile";
  const c = await mount();
  const button = q('[data-testid="game-button"]', () => c);
  // Le bouton est positionné : les calques absolus (image / icônes) ont le
  // bouton lui-même pour conteneur — plus jamais le wrapper fixed 12 px plus
  // bas (cause de l'image carrée qui débordait et de la manette décentrée).
  expect(button.className).toContain("relative");
  expect(button.className).toContain("overflow-hidden");
  expect(button.className).toContain("nav-pill"); // cercle (border-radius 9999px, CSS)
  const img = q("img", button);
  expect(img).not.toBeNull();
  expect(img.className).toContain("object-cover"); // remplit le cercle sans déformation
  expect(img.className).toContain("h-full");
  expect(img.className).toContain("w-full");
  // Sans jeu actif : l'icône manette vit dans un calque plein-bouton centré.
  global.__rrState.search = "";
  await act(async () => { root.render(<Chrome />); });
  const btn2 = q('[data-testid="game-button"]', () => c);
  const layer = q('[data-testid="game-button-game-icon"]', () => c);
  expect(layer.className).toContain("inset-0");
  expect(layer.className).toContain("items-center");
  expect(layer.className).toContain("justify-center");
  expect(q("svg", btn2)).not.toBeNull();
});
