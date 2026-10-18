import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductCard } from "./ProductCard";

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
  };
});
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({ lang: "fr", t: (key) => key }),
}));
jest.mock("@/context/GameContext", () => ({
  useGames: () => ({
    games: [
      { id: "pubg-mobile", currency_label: "UC", product_types: [{ key: "uc", label: "UC" }, { key: "prime", label: "Prime" }, { key: "prime_plus", label: "Prime+" }, { key: "evo", label: "Évolutif" }] },
      { id: "codm", currency_label: "CP", product_types: [{ key: "cp", label: "CP" }, { key: "battle_pass", label: "Battle Pass" }] },
    ],
  }),
}));
jest.mock("@/lib/api", () => ({ formatAr: (value) => String(value) + " Ar" }));

const sample = {
  id: "p-60",
  slug: "pack-60",
  name: "Pack Premium",
  type: "uc",
  game_id: "pubg-mobile",
  uc_amount: 60,
  price: 4600,
  old_price: 5000,
  purchasable: true,
};

function mount(props = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(<ProductCard product={sample} {...props} />);
  });
  return {
    container,
    unmount: () => act(() => root.unmount()),
  };
}

test("add action calls the provided handler with the product", () => {
  const onAdd = jest.fn();
  const view = mount({ onAdd });
  try {
    act(() => view.container.querySelector('[data-testid="add-to-cart-pack-60"]').click());
    expect(onAdd).toHaveBeenCalledWith(sample);
  } finally {
    view.unmount();
  }
});

test("favorite control is accessible and calls its handler", () => {
  const onToggleFavorite = jest.fn();
  const view = mount({ favorite: true, onToggleFavorite });
  try {
    const button = view.container.querySelector('[data-testid="favorite-button-pack-60"]');
    expect(button.getAttribute("aria-pressed")).toBe("true");
    act(() => button.click());
    expect(onToggleFavorite).toHaveBeenCalledWith(sample);
  } finally {
    view.unmount();
  }
});

test("quantity controls call handlers and enforce the cart limit", () => {
  const onIncrease = jest.fn();
  const onDecrease = jest.fn();
  const view = mount({ qty: 20, onIncrease, onDecrease });
  try {
    const inc = view.container.querySelector('[data-testid="cart-inc-pack-60"]');
    const dec = view.container.querySelector('[data-testid="cart-dec-pack-60"]');
    expect(inc.disabled).toBe(true);
    act(() => dec.click());
    expect(onDecrease).toHaveBeenCalledWith(sample);
    expect(onIncrease).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

test("labels and currency figure follow the selected game configuration", () => {
  const view = mount({
    product: { ...sample, id: "codm-pack", slug: "codm-pack", name: "80 CP Pack", type: "cp", game_id: "codm", uc_amount: 80 },
  });
  try {
    expect(view.container.querySelector('[data-testid="product-type-codm-pack"]').textContent).toBe("CP");
    expect(view.container.querySelector('[data-testid="product-figure-codm-pack"]').textContent).toContain("80");
    expect(view.container.querySelector('[data-testid="product-figure-codm-pack"]').textContent).toContain("CP");
  } finally {
    view.unmount();
  }
});

test("discount badge only appears for a real saving of at least five percent", () => {
  const realDiscount = mount();
  const noDiscount = mount({ product: { ...sample, id: "no-discount", slug: "no-discount", old_price: 4500 } });
  try {
    expect(realDiscount.container.querySelector('[data-testid="product-discount-pack-60"]').textContent).toBe("-8%");
    expect(noDiscount.container.querySelector('[data-testid="product-discount-no-discount"]')).toBeNull();
  } finally {
    realDiscount.unmount();
    noDiscount.unmount();
  }
});
