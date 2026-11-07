import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PaymentStatus } from "./PaymentStatus";

// react-router-dom v7 does not resolve under jest (see Header.test.js) —
// PaymentStatus only uses Link for the post-completion button.
jest.mock("react-router-dom", () => {
  const React = require("react");
  return { Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children) };
});

// PL-PAYLABEL-1 : l'écran d'attente de paiement doit afficher le vrai moyen
// de paiement et ne plus donner la couleur Orange à binance.
let mockStatus = "pending";

jest.mock("@/lib/api", () => ({
  api: {
    get: jest.fn(() => Promise.resolve({ data: { payment_status: mockStatus, simulated: false } })),
  },
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key) => key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key,
    lang: "fr",
  }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const baseOrder = { id: "o1", order_number: "MGS-C1", simulated: false, total: 2500 };

beforeEach(() => {
  const { api } = require("@/lib/api");
  api.get.mockClear();
  mockStatus = "pending";
});

afterEach(() => { document.body.innerHTML = ""; });

async function mount(order) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PaymentStatus order={order} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

test.each([
  ["binance", "Binance USDT"],
  ["manual", "USSD"],
  ["mvola", "MVola · 0340000001"],
  ["orange", "Orange Money · 0320000002"],
])("attente paiement %s → « %s »", async (method, expected) => {
  const order = { ...baseOrder, payment_method: method, payment_phone: method === "mvola" ? "0340000001" : method === "orange" ? "0320000002" : undefined };
  const { container, root } = await mount(order);
  expect(container.querySelector('[data-testid="payment-status"]').textContent).toContain(expected);
  await act(async () => root.unmount());
});

test("binance : le statut d'attente se rend avec le libellé correct (couleur du disque vérifiée en navigateur)", async () => {
  const { container, root } = await mount({ ...baseOrder, payment_method: "binance" });
  const text = container.querySelector('[data-testid="payment-status"]').textContent;
  expect(text).toContain("Binance USDT");
  expect(text).not.toContain("Orange Money");
  await act(async () => root.unmount());
});

test("valeur inconnue : libellé brut, pas « Orange Money »", async () => {
  const { container, root } = await mount({ ...baseOrder, payment_method: "fiveone" });
  const text = container.querySelector('[data-testid="payment-status"]').textContent;
  expect(text).toContain("fiveone");
  expect(text).not.toContain("Orange Money");
  await act(async () => root.unmount());
});
