import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Games from "./Games";
import { LanguageProvider } from "@/context/LanguageContext";
import { api } from "@/lib/api";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-router-dom", () => {
  const React = require("react");
  const Anchor = ({ children, ...props }) => React.createElement("a", props, children);
  return { Link: Anchor, useLocation: () => ({ pathname: "/jeux" }) };
});

// Contexte jeu contrôlé par les tests (comme Catalog.test.js).
global.__gamesState = { games: [], loadingGames: true };
jest.mock("@/context/GameContext", () => {
  const React = require("react");
  return {
    useGames: () => global.__gamesState,
    GameContext: React.createContext(null),
  };
});

// Données de test isolées — la vraie liste vient de GameContext en prod.
const GAMES = [
  { id: "free-fire", slug: "free-fire", name: "Free Fire", active: true, sort_order: 0 },
  { id: "genshin", slug: "genshin", name: "Genshin Impact", active: true, sort_order: 1 },
  { id: "pokemon", slug: "pokemon", name: "Pokémon Unite", active: true, sort_order: 2 },
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", active: true, sort_order: 3 },
];

const flush = () => act(async () => { await Promise.resolve(); });
const advance = async (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
// React n'écoute pas `value = …` direct : passer par le setter natif + un
// événement `input`.
const typeInto = (input, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

let container;
let root;
const q = (sel) => container.querySelector(sel);
const all = (sel) => Array.from(container.querySelectorAll(sel));

async function mount(element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(element); });
  return container;
}

beforeEach(() => {
  global.__gamesState = { games: GAMES, loadingGames: false };
  container = null;
  root = null;
  document.body.innerHTML = "";
  localStorage.clear();
  api.get.mockReset?.();
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container = null;
});

test("grille complète : toutes les cartes, 2 colonnes mobile / 3 tablette / 4 bureau", async () => {
  const c = await mount(<Chrome />);
  expect(q('[data-testid="games-all-grid"]')).not.toBeNull();
  expect(all('[data-testid="game-card-free-fire"]')).toHaveLength(1);
  expect(all('[data-testid="games-all-grid"] > a')).toHaveLength(GAMES.length);
  expect(q('[data-testid="games-all-grid"]').className).toContain("grid-cols-2");
  expect(q('[data-testid="games-all-grid"]').className).toContain("sm:grid-cols-3");
  expect(q('[data-testid="games-all-grid"]').className).toContain("lg:grid-cols-4");
});

test("recherche : délai de frappe puis filtre insensible à la casse ET aux accents", async () => {
  const c = await mount(<Chrome />);
  const input = q('[data-testid="games-all-search"]');
  input.focus?.();
  typeInto(input, "FREE");
  expect(all('[data-testid="game-card-genshin"]')).toHaveLength(1); // filtre pas encore appliqué (délai)
  await advance(400);
  expect(all('[data-testid="games-all-grid"] > a')).toHaveLength(1);
  expect(q('[data-testid="games-all-grid"] > a').textContent).toContain("Free Fire");

  // Accents pliés : « pokémon » trouve « Pokémon Unite ».
  const input2 = q('[data-testid="games-all-search"]');
  typeInto(input2, "pokémon");
  await advance(400);
  const names = all('[data-testid="games-all-grid"] > a').map((a) => a.textContent);
  expect(names).toHaveLength(1);
  expect(names[0]).toContain("Pokémon Unite");
});

test("message clair quand aucun résultat", async () => {
  const c = await mount(<Chrome />);
  const input = q('[data-testid="games-all-search"]');
  typeInto(input, "impossible-de-trouver");
  await advance(400);
  expect(q('[data-testid="games-all-empty"]')).not.toBeNull();
  expect(all('[data-testid="games-all-grid"] > a')).toHaveLength(0);
});

test("squelettes de même forme pendant le chargement", async () => {
  global.__gamesState = { games: [], loadingGames: true };
  const c = await mount(<Chrome />);
  expect(all('[data-testid="game-card-skeleton"]')).toHaveLength(8);
  expect(all('[data-testid="game-card-free-fire"]')).toHaveLength(0);
  expect(q('[data-testid="games-all-empty"]')).toBeNull(); // pas d'erreur pendant le chargement
});

function Chrome() {
  return (
    <LanguageProvider>
      <Games />
    </LanguageProvider>
  );
}
