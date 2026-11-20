import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Catalog from "./Catalog";
import { api } from "@/lib/api";

// The mock keeps URLSearchParams stateful so the category tabs rerender and preserve the selected game.
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ children }) => <span>{children}</span>,
    useSearchParams: () => React.useState(new URLSearchParams(global.mockQuery || "game=pubg-mobile&type=uc&popular=1")),
  };
});
jest.mock("@/lib/api", () => ({ api: { get: jest.fn() } }));
// t() RÉEL (translations fr/en + interpolation {label}) : les titres de section et les options
// de tri doivent afficher la monnaie du jeu, jamais la variable littérale « {label} ».
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path, vars) => {
    const value = path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
    return vars && typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`)) : value;
  };
  return { useLang: () => ({ t: make(global.mockLang || "fr"), lang: global.mockLang || "fr" }) };
});
const PUBG_TYPES = [{ key: "uc", label: "UC" }, { key: "prime", label: "Prime" }, { key: "prime_plus", label: "Prime+" }, { key: "evo", label: "Pack évolutif" }];
let mockGames = [];
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: mockGames, selectGame: jest.fn() }) }));
jest.mock("@/pages/Home", () => ({ GameLogo: () => null, BackToTop: () => null }));
beforeEach(() => {
  mockGames = [
    { id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", currency_label: "UC", product_types: PUBG_TYPES },
    { id: "free-fire", name: "Free Fire", slug: "free-fire", currency_label: "Diamants", product_types: [{ key: "diamonds", label: "Diamants" }] },
    { id: "codm", name: "Call of Duty Mobile", slug: "codm", currency_label: "CP", product_types: [{ key: "cp", label: "CP" }, { key: "battle_pass", label: "Battle Pass" }] },
  ];
});
jest.mock("@/components/store/ProductCard", () => ({ ProductCard: () => null }));
jest.mock("@/pages/PackEvolutif", () => ({ __esModule: true, default: ({ products }) => <div data-offers={JSON.stringify(products)} /> }));
jest.mock("@/components/ui/select", () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  return { Select: Wrapper, SelectContent: Wrapper, SelectItem: Wrapper, SelectTrigger: Wrapper, SelectValue: () => null };
});

test("the evolutionary tab requests only evo packs and clears the popular-only filter", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const evo = [{ id: "evo-1", type: "evo", slug: "evo-pack" }];
  api.get.mockImplementation((path, options) => Promise.resolve({ data: options.params.type === "evo" ? evo : [] }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Catalog />);
    });
    await act(async () => {
      container.querySelector('[data-testid="type-tab-evo"]').click();
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(api.get).toHaveBeenLastCalledWith("/products", { params: {
      game: "pubg-mobile", type: "evo", q: undefined, sort: "price_asc", popular: undefined, min_price: undefined, max_price: undefined,
    } });
    expect(JSON.parse(container.querySelector("[data-offers]").getAttribute("data-offers"))).toEqual(evo);
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
test("type tabs follow the selected game's configuration (no PUBG list for another game)", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.mockQuery = "game=codm";
  api.get.mockImplementation(() => Promise.resolve({ data: [] }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Catalog />); });
    const tabs = [...container.querySelectorAll('[data-testid^="type-tab-"]')].map((n) => n.dataset.testid);
    expect(tabs).toEqual(["type-tab-all", "type-tab-cp", "type-tab-battle_pass"]);
    expect(container.querySelector('[data-testid="type-tab-evo"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    delete global.mockQuery;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
test("Free Fire : la section des packs affiche « Packs Diamants », jamais {label} littéral", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.mockQuery = "game=free-fire";
  api.get.mockResolvedValue({ data: [{ id: "ff-100", slug: "ff-100", name: "100 Diamants", type: "diamonds", uc_amount: 100, price: 5000, game_id: "free-fire" }] });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Catalog />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(container.querySelector("#packs-uc-title").textContent).toBe("Packs Diamants");
    expect(container.textContent).toContain("Prix par Diamants");
    expect(container.textContent).not.toContain("{label}");
  } finally {
    await act(async () => root.unmount());
    delete global.mockQuery;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
test("Free Fire (en) : « Diamants packs » et « Price per Diamants »", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.mockQuery = "game=free-fire";
  global.mockLang = "en";
  api.get.mockResolvedValue({ data: [{ id: "ff-100", slug: "ff-100", name: "100 Diamonds", type: "diamonds", uc_amount: 100, price: 5000, game_id: "free-fire" }] });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Catalog />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(container.querySelector("#packs-uc-title").textContent).toBe("Diamants packs");
    expect(container.textContent).toContain("Price per Diamants");
    expect(container.textContent).not.toContain("{label}");
  } finally {
    await act(async () => root.unmount());
    delete global.mockQuery;
    delete global.mockLang;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
test("PUBG Mobile : libellés UC inchangés (« Packs UC », « Prix par UC »)", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.mockQuery = "game=pubg-mobile";
  api.get.mockResolvedValue({ data: [{ id: "pubg-60", slug: "pubg-60", name: "60 UC", type: "uc", uc_amount: 60, price: 900, game_id: "pubg-mobile" }] });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Catalog />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(container.querySelector("#packs-uc-title").textContent).toBe("Packs UC");
    expect(container.textContent).toContain("Prix par UC");
    expect(container.textContent).not.toContain("{label}");
  } finally {
    await act(async () => root.unmount());
    delete global.mockQuery;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

// PL-DS-002-V1 — bascule fournisseur : le catalogue ne publie plus que 6 lots UC
// (60/325/660/1800/3850/16200), « populaire » sur 325 et 660, prix jusqu'à 871 000 Ar,
// Prime/Prime+/Evo masqués. Verrou : aucun onglet ni section vide, grille 6 cartes, grands prix espacés.
test("bascule fournisseur : 6 lots UC, 2 populaires, aucun onglet/section Prime/Prime+/Évo vide", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.mockQuery = "game=pubg-mobile";
  // Le jeu ne publie plus que le type UC (Prime/Prime+/Évo retirés de product_types côté backend).
  mockGames = [{ id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", currency_label: "UC", product_types: [{ key: "uc", label: "UC" }] }];
  const lots = [
    { id: "uc-60", slug: "uc-60", name: "60 UC", type: "uc", uc_amount: 60, price: 900, game_id: "pubg-mobile" },
    { id: "uc-325", slug: "uc-325", name: "325 UC", type: "uc", uc_amount: 325, price: 4500, popular: true, game_id: "pubg-mobile" },
    { id: "uc-660", slug: "uc-660", name: "660 UC", type: "uc", uc_amount: 660, price: 8900, popular: true, game_id: "pubg-mobile" },
    { id: "uc-1800", slug: "uc-1800", name: "1800 UC", type: "uc", uc_amount: 1800, price: 24000, game_id: "pubg-mobile" },
    { id: "uc-3850", slug: "uc-3850", name: "3850 UC", type: "uc", uc_amount: 3850, price: 51000, game_id: "pubg-mobile" },
    { id: "uc-16200", slug: "uc-16200", name: "16200 UC", type: "uc", uc_amount: 16200, price: 871000, game_id: "pubg-mobile" },
  ];
  api.get.mockResolvedValue({ data: lots });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Catalog />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    // Onglets : « Tous » + « UC » uniquement — ni Prime, ni Prime+, ni Évolutif.
    const tabs = [...container.querySelectorAll('[data-testid^="type-tab-"]')].map((n) => n.dataset.testid);
    expect(tabs).toEqual(["type-tab-all", "type-tab-uc"]);
    // Sections : Populaire (325/660) + Packs UC présentes ; Prime et Évolutif absents (jamais de titre vide).
    expect(container.querySelector("#popular-title")).toBeTruthy();
    expect(container.querySelector("#packs-uc-title")).toBeTruthy();
    expect(container.querySelector("#prime")).toBeNull();
    expect(container.querySelector("#packs-evolutifs")).toBeNull();
    // Compte de résultats : 6 lots.
    expect(container.querySelector('[data-testid="results-count"]').textContent).toContain("6");
  } finally {
    await act(async () => root.unmount());
    delete global.mockQuery;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
test("bascule fournisseur : grand prix espacé (871 000 Ar, jamais 871000)", () => {
  const { formatAr } = jest.requireActual("@/lib/api");
  expect(formatAr(871000, "fr")).toBe("871 000 Ar");
  expect(formatAr(871000, "fr")).not.toContain("871000");
});
