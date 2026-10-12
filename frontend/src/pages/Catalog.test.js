import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Catalog from "./Catalog";
import { api } from "@/lib/api";

jest.mock("react-router-dom", () => ({
  useSearchParams: () => require("react").useState(new URLSearchParams("type=uc&popular=1")),
}));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key }) }));
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
      type: "evo", q: undefined, sort: "default", popular: undefined, min_price: undefined, max_price: undefined,
    } });
    expect(JSON.parse(container.querySelector("[data-offers]").getAttribute("data-offers"))).toEqual(evo);
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});