import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminOrders from "./AdminOrders";

// PL-PAYLABEL-1 : la liste admin doit afficher le vrai moyen de paiement —
// « Binance USDT » pour binance (le bug : elle tombait dans le repli
// « Orange Money »), « USSD · réf » pour manual, marque correcte sinon.
let mockOrders = [];

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useSearchParams: () => [new URLSearchParams(), jest.fn()],
  };
});
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
  errorMessage: () => "erreur",
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key) => key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key,
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: false }) }));
jest.mock("@/components/admin/FzrFulfillment", () => ({
  FzrFulfillment: () => null,
  lineRecord: () => ({}),
  repRecord: () => ({}),
  lineSendable: () => false,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const order = (overrides) => ({
  id: overrides.order_number, order_number: overrides.order_number,
  created_at: "2026-11-07T10:00:00Z", status: "paid", pseudo: "Joueur", pubg_id: "123456789",
  items: [{ quantity: 1, name: "660 UC" }], email: "joueur@exemple.test", total: 2500,
  ...overrides,
});

beforeEach(() => {
  const { api } = require("@/lib/api");
  api.get.mockReset(); api.post.mockReset(); api.patch.mockReset(); api.delete.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/admin/fazercards/mappings") return Promise.resolve({ data: { products: [] } });
    if (url === "/admin/orders") return Promise.resolve({ data: mockOrders });
    return Promise.resolve({ data: {} });
  });
  mockOrders = [
    order({ order_number: "MGS-MV", payment_method: "mvola", payment_phone: "0340000001" }),
    order({ order_number: "MGS-OR", payment_method: "orange", payment_phone: "0320000002" }),
    order({ order_number: "MGS-US", payment_method: "manual", manual_reference: "REF123" }),
    order({ order_number: "MGS-BN", payment_method: "binance" }),
  ];
});

afterEach(() => { document.body.innerHTML = ""; });

async function mountOrders() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AdminOrders />); });
  // Le chargement des commandes est différée de 200 ms dans le composant.
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  return { container, root };
}

const rowText = (container, number) =>
  container.querySelector(`[data-testid="admin-order-${number}"]`)?.textContent || "";

test.each([
  ["MGS-MV", "MVola · 0340000001"],
  ["MGS-OR", "Orange Money · 0320000002"],
  ["MGS-US", "USSD · REF123"],
  ["MGS-BN", "Binance USDT"],
])("liste admin : %s affiche « %s »", async (number, expected) => {
  const { container, root } = await mountOrders();
  expect(rowText(container, number)).toContain(expected);
  await act(async () => root.unmount());
});

test("liste admin : la commande binance n'affiche jamais « Orange Money » ni de numéro à débiter", async () => {
  const { container, root } = await mountOrders();
  const text = rowText(container, "MGS-BN");
  expect(text).toContain("Binance USDT");
  expect(text).not.toContain("Orange Money");
  expect(container.querySelector('[data-testid="copy-phone-MGS-BN"]')).toBeNull();
  await act(async () => root.unmount());
});

test("liste admin : la commande manuelle garde la copie de référence, binance l'email seul", async () => {
  const { container, root } = await mountOrders();
  expect(container.querySelector('[data-testid="copy-ref-MGS-US"]')).not.toBeNull();
  expect(rowText(container, "MGS-BN")).toContain("joueur@exemple.test");
  await act(async () => root.unmount());
});
