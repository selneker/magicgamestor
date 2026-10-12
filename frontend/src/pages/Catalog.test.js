import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Catalog from "./Catalog";
import { api } from "@/lib/api";

// Phase 3: Catalog reads the selected game from `?game=` and from GameContext.
// The mock keeps a real stateful URLSearchParams so `setParams` (used by the
// type tabs) actually re-renders the component.
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ children }) => <span>{children}</span>,
    useSearchParams: () => {
      const [params, setParams] = React.useState(
        new URLSearchParams("game=pubg-mobile&type=uc&popular=1"),
      );
      const set = (next) =>
        setParams(next instanceof URLSearchParams ? next : new URLSearchParams(next));
      return [params, set];
    },
  };
});
jest.mock("@/lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key }) }));
jest.mock("@/context/GameContext", () => ({
  useGames: () => ({
    games: [{ id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile" }],
    selectGame: jest.fn(),
  }),
}));
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
      game: "pubg-mobile", type: "evo", q: undefined, sort: "default", popular: undefined, min_price: undefined, max_price: undefined,
    } });
    expect(JSON.parse(container.querySelector("[data-offers]").getAttribute("data-offers"))).toEqual(evo);
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
