import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GameCard, RatingStars } from "./GameCard";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
  };
});
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({ lang: "fr" }),
}));
jest.mock("@/context/GameContext", () => ({
  useGames: () => ({ selectGame: jest.fn() }),
}));

// Données de test ISOLÉES : les notes/avis ici n'existent que dans ce fichier
// de test (il est interdit de livrer des valeurs en dur dans le composant).
const RATED = { id: "g1", slug: "g1", name: "Jeu Noté", rating: 4.8, review_count: 123 };
const FEW_REVIEWS = { id: "g2", slug: "g2", name: "Jeu Peu Noté", rating: 4.8, review_count: 3 };
const UNRATED = { id: "g3", slug: "g3", name: "Jeu Sans Note", description: "Diamants", icon_url: null };
const PricED = { id: "g4", slug: "g4", name: "Jeu Prix", min_price: 25000, description: "UC" };

let container;
let root;
const q = (sel) => container.querySelector(sel);

async function mount(elem) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(elem); });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container = null;
});

test("la carte est un lien vers la page du jeu, nom + description affichés", async () => {
  const c = await mount(<GameCard game={UNRATED} />);
  const a = q("a");
  expect(a.getAttribute("href")).toBe("/boutique?game=g3");
  expect(a.textContent).toContain("Jeu Sans Note");
  expect(a.textContent).toContain("Diamants");
});

test("les pastilles product_types ne sont plus rendues", async () => {
  const c = await mount(<GameCard game={{ ...UNRATED, product_types: [{ key: "uc", label: "UC" }] }} />);
  expect(q("a").className).not.toContain("rounded-full");
  expect(q("a").textContent).not.toContain("UC");
});

// ---------------------------------------------------------------- Étoiles
test("étoiles masquées quand la donnée est absente (règle stricte : rien n'est inventé)", async () => {
  const c = await mount(<GameCard game={UNRATED} />);
  expect(q('[data-testid="game-rating"]')).toBeNull();
});

test("étoiles masquées sous 5 avis", async () => {
  const c = await mount(<GameCard game={FEW_REVIEWS} />);
  expect(q('[data-testid="game-rating"]')).toBeNull();
});

test("RatingStars brut : null sans note ou avec reviewCount < 5", () => {
  expect(RatingStars({})).toBeNull();
  expect(RatingStars({ rating: 4.8 })).toBeNull();
  expect(RatingStars({ rating: 4.8, reviewCount: 4 })).toBeNull();
  expect(RatingStars({ rating: null, reviewCount: 99 })).toBeNull();
});

test("étoiles affichées avec note >= 5 avis : ★ 4.8 (123)", async () => {
  const c = await mount(<GameCard game={RATED} />);
  const stars = q('[data-testid="game-rating"]');
  expect(stars).not.toBeNull();
  expect(stars.textContent).toContain("4,8");
  expect(stars.textContent).toContain("(123)");
  expect(stars.textContent).not.toContain("(3)");
});

test("prix « dès X Ar » affiché seulement si min_price existe dans la donnée", async () => {
  const c = await mount(<GameCard game={PricED} />);
  expect(q("a").textContent).toContain("dès");
  expect(q("a").textContent).toContain("25 000");
  // Sans prix : rien n'est affiché dans la rangée du bas.
  const c2 = await mount(<GameCard game={UNRATED} />);
  expect(q("a").textContent).not.toContain("dès");
});
