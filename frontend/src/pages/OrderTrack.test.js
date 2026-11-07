import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OrderTrack, { OrderCard } from "./OrderTrack";

// PL-PAYLABEL-1 : le suivi client ne doit plus afficher « USSD » pour une
// commande binance (l'ancien ternaire imbriqué en repli) ni déformer les
// marques avec la classe `capitalize` (« Mvola », « Ussd »).
let mockTrackOrder = null;
let mockPayStatus = {};

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useParams: () => ({ orderNumber: mockTrackOrder?.order_number || "" }),
    useSearchParams: () => [new URLSearchParams(mockTrackOrder ? `pubg_id=${mockTrackOrder.pubg_id}` : ""), jest.fn()],
  };
});
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
  errorMessage: () => "erreur",
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key) => key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key,
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: [] }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const baseOrder = {
  order_number: "MGS-B1", status: "pending_payment", pubg_id: "123456789", pseudo: "Joueur",
  game_id: "pubg-mobile", items: [{ quantity: 1, name: "660 UC", line_total: 2500 }],
  created_at: "2026-11-07T10:00:00Z", total: 2500, payment_fee: 0,
};

beforeEach(() => {
  const { api } = require("@/lib/api");
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/orders/track")) return Promise.resolve({ data: mockTrackOrder });
    if (url.includes("/payments/") && url.endsWith("/status")) return Promise.resolve({ data: mockPayStatus });
    return Promise.resolve({ data: [] });
  });
  mockTrackOrder = null;
  mockPayStatus = {};
});

afterEach(() => { document.body.innerHTML = ""; });

async function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

describe("OrderCard (carte de suivi)", () => {
  test.each([
    ["binance", "Binance USDT"],
    ["manual", "USSD"],
    ["mvola", "MVola"],
    ["orange", "Orange Money"],
    ["fiveone", "fiveone"],
  ])("méthode %s → libellé « %s »", async (method, expected) => {
    const { container, root } = await mount(<OrderCard order={{ ...baseOrder, payment_method: method }} />);
    expect(container.querySelector('[data-testid="order-card-MGS-B1"]').textContent).toContain(expected);
    // Plus de `capitalize` : les marques restent correctement casées.
    const span = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === expected);
    expect(span).toBeDefined();
    expect(span.className).not.toContain("capitalize");
    await act(async () => root.unmount());
  });

  test("méthode absente → « Autre », jamais « USSD » ni « Orange Money »", async () => {
    const { container, root } = await mount(<OrderCard order={{ ...baseOrder, payment_method: undefined }} />);
    const text = container.querySelector('[data-testid="order-card-MGS-B1"]').textContent;
    expect(text).toContain("Autre");
    expect(text).not.toContain("USSD");
    expect(text).not.toContain("Orange Money");
    await act(async () => root.unmount());
  });
});

// NOTE on the resume button colour: this jest environment drops ALL inline
// style props at render (even on plain elements — a React 19/jsdom quirk in
// this setup, pre-existing; no test in this repo asserts inline styles).
// The button's rendered colour is therefore verified in a real browser by
// scripts/capture-brand-paylabel.mjs (getComputedStyle on the resume button).
describe("Bouton « Reprendre le paiement » (page complète)", () => {
  test("commande binance en attente : le bouton de reprise se rend (couleur vérifiée en navigateur)", async () => {
    mockTrackOrder = { ...baseOrder, payment_method: "binance" };
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false, expires_at: "2026-11-07T10:15:00Z" };
    const { container, root } = await mount(<OrderTrack />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const btn = container.querySelector('[data-testid="resume-payment-button"]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Reprendre le paiement");
    await act(async () => root.unmount());
  });

  test("commande manual en attente : pas de bouton de reprise (flux USSD n'a pas d'URL de paiement)", async () => {
    mockTrackOrder = { ...baseOrder, payment_method: "manual" };
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false };
    const { container, root } = await mount(<OrderTrack />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // manual never polls (/payments status) — the button must not appear.
    expect(container.querySelector('[data-testid="resume-payment-button"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
