import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CartProvider, useCart } from "@/context/CartContext";
import { ProductCard } from "./ProductCard";

// Le « + » de la carte produit doit suivre EXACTEMENT la règle de quantité du panier (CartContext) :
// abonnements/évo = 1 max, jetons de monnaie de TOUT jeu = plafond 20 — jamais « type === "uc" ».
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key, lang: "fr" }) }));
jest.mock("@/lib/favorites", () => ({ useFavorites: () => [[], jest.fn()] }));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn() }, formatAr: (n) => `${n} Ar` }));
jest.mock("react-router-dom", () => {
  const R = require("react");
  return { Link: ({ children }) => R.createElement("span", null, children) };
});
// Les badges des cartes doivent suivre la monnaie du jeu (données /games), pas un « UC » codé en dur.
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: global.mockGames || [] }) }));

const FF = { id: "ff-310", slug: "ff-310-diamants", name: "310 Diamants", type: "diamonds", price: 2500,
             game_id: "free-fire", uc_amount: 310, purchasable: true };
const PUBG = { id: "pubg-60", slug: "pubg-60-uc", name: "60 UC", type: "uc", price: 900,
               game_id: "pubg-mobile", uc_amount: 60, purchasable: true };
const PRIME = { id: "pubg-prime", slug: "pubg-prime", name: "Prime", type: "prime", price: 1100,
                game_id: "pubg-mobile", duration_months: 1, purchasable: true };
const CODM = { id: "codm-80", slug: "codm-80-cp", name: "80 CP", type: "cp", price: 700,
               game_id: "codm", uc_amount: 80, purchasable: true };
const FF_OFF = { ...FF, id: "ff-off", slug: "ff-off", name: "Pack épuisé", purchasable: false };

function ItemsProbe() {
  const { items, setQty } = useCart();
  return (
    <div>
      <div data-testid="probe">{JSON.stringify(items.map((i) => [i.id, i.qty]))}</div>
      <button data-testid="probe-set-5" onClick={() => setQty("ff-310", 5)}>set5</button>
    </div>
  );
}

const byLabel = (c, label) => [...c.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
const probeQty = (c) => JSON.parse(c.querySelector('[data-testid="probe"]').textContent);

async function mountCard(product) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CartProvider><ProductCard product={product} /><ItemsProbe /></CartProvider>);
  });
  return { container, root };
}

async function unmountCard(container, root) {
  await act(async () => root.unmount());
  container.remove();
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  global.mockGames = [
    { id: "pubg-mobile", currency_label: "UC", product_types: [{ key: "uc", label: "UC" }, { key: "prime", label: "Prime" }, { key: "prime_plus", label: "Prime+" }, { key: "evo", label: "Pack évolutif" }] },
    { id: "free-fire", currency_label: "Diamants", product_types: [{ key: "diamonds", label: "Diamants" }] },
    { id: "codm", currency_label: "CP", product_types: [{ key: "cp", label: "CP" }] },
  ];
});
afterEach(() => { delete global.mockGames; delete global.IS_REACT_ACT_ENVIRONMENT; });

test("Free Fire : l'ajout puis le « + » incrémentent la carte ET le panier", async () => {
  const { container, root } = await mountCard(FF);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 310 Diamants").click(); });
    expect(probeQty(container)).toEqual([["ff-310", 1]]);
    const inc = byLabel(container, "Ajouter un exemplaire : 310 Diamants");
    expect(inc.disabled).toBe(false);
    await act(async () => { inc.click(); });
    expect(probeQty(container)).toEqual([["ff-310", 2]]);
    expect(container.querySelector('[aria-live="polite"]').textContent).toContain("2");
  } finally { await unmountCard(container, root); }
});

test("Free Fire : le plafond réel du panier (20) est respecté, carte/panier alignés", async () => {
  const { container, root } = await mountCard(FF);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 310 Diamants").click(); });
    for (let i = 0; i < 25; i++) {
      const inc = byLabel(container, "Ajouter un exemplaire : 310 Diamants");
      if (inc.disabled) break;
      await act(async () => { inc.click(); });
    }
    expect(probeQty(container)).toEqual([["ff-310", 20]]);
    expect(byLabel(container, "Ajouter un exemplaire : 310 Diamants").disabled).toBe(true);
  } finally { await unmountCard(container, root); }
});

test("Abonnements (Prime) : « + » toujours désactivé, quantité forcée à 1", async () => {
  const { container, root } = await mountCard(PRIME);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : Prime").click(); });
    expect(probeQty(container)).toEqual([["pubg-prime", 1]]);
    expect(byLabel(container, "Ajouter un exemplaire : Prime").disabled).toBe(true);
  } finally { await unmountCard(container, root); }
});

test("PUBG Mobile : ajout + « + » inchangés (plafond 20)", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 60 UC").click(); });
    await act(async () => { byLabel(container, "Ajouter un exemplaire : 60 UC").click(); });
    expect(probeQty(container)).toEqual([["pubg-60", 2]]);
  } finally { await unmountCard(container, root); }
});

test("Produit indisponible : aucun bouton d'ajout sur la carte", async () => {
  const { container, root } = await mountCard(FF_OFF);
  try {
    expect(container.textContent).toContain("Indisponible");
    expect(byLabel(container, "Ajouter au panier : Pack épuisé")).toBeUndefined();
    expect(byLabel(container, "Ajouter un exemplaire : Pack épuisé")).toBeUndefined();
  } finally { await unmountCard(container, root); }
});

test("Parcours panier : setQty met à jour la carte (même source de vérité)", async () => {
  const { container, root } = await mountCard(FF);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 310 Diamants").click(); });
    await act(async () => { container.querySelector('[data-testid="probe-set-5"]').click(); });
    expect(probeQty(container)).toEqual([["ff-310", 5]]);
    expect(container.querySelector('[aria-live="polite"]').textContent).toContain("5");
  } finally { await unmountCard(container, root); }
});

test("Free Fire : badges « Diamants » et « Pack Diamants », jamais UC", async () => {
  const { container, root } = await mountCard(FF);
  try {
    expect(container.querySelector('[data-testid="card-type-ff-310-diamants"]').textContent).toBe("Diamants");
    expect(container.querySelector('[data-testid="card-context-ff-310-diamants"]').textContent).toBe("Pack Diamants");
    expect(container.textContent).not.toMatch(/\bUC\b/);
  } finally { await unmountCard(container, root); }
});

test("PUBG Mobile : badges « UC » et « Pack UC » inchangés", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    expect(container.querySelector('[data-testid="card-type-pubg-60-uc"]').textContent).toBe("UC");
    expect(container.querySelector('[data-testid="card-context-pubg-60-uc"]').textContent).toBe("Pack UC");
  } finally { await unmountCard(container, root); }
});

test("CODM : badges « CP » et « Pack CP » (monnaie du jeu, pas UC)", async () => {
  const { container, root } = await mountCard(CODM);
  try {
    expect(container.querySelector('[data-testid="card-type-codm-80-cp"]').textContent).toBe("CP");
    expect(container.querySelector('[data-testid="card-context-codm-80-cp"]').textContent).toBe("Pack CP");
    expect(container.textContent).not.toMatch(/\bUC\b/);
  } finally { await unmountCard(container, root); }
});
