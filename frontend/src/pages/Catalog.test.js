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
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key, lang: "fr" }) }));
const PUBG_TYPES = [{ key: "uc", label: "UC" }, { key: "prime", label: "Prime" }, { key: "prime_plus", label: "Prime+" }, { key: "evo", label: "Pack évolutif" }];
let mockGames = [];
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: mockGames, selectGame: jest.fn() }) }));
jest.mock("@/pages/Home", () => ({ GameLogo: () => null, BackToTop: () => null }));
beforeEach(() => {
  mockGames = [
    { id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", currency_label: "UC", product_types: PUBG_TYPES },
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
