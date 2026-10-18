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
