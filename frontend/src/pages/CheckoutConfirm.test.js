import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CheckoutConfirm from "./CheckoutConfirm";
import { writePendingOrderId } from "@/lib/pendingOrder";

// PL-CHK-4 — /commande/confirmation n'est plus qu'une REDIRECTION : écran de
// paiement /orders/:id de la commande en attente (valide < 24 h, PL-CHK-3),
// sinon l'accueil. L'ancien envoi manual_reference n'existe plus.

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Navigate: ({ to }) => React.createElement("div", { "data-testid": "redirect", "data-to": to }),
  };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

async function renderConfirm() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<CheckoutConfirm />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = "";
});

test("sans commande en attente : redirige vers l'accueil", async () => {
  const { container, root } = await renderConfirm();
  expect(container.querySelector('[data-testid="redirect"]').getAttribute("data-to")).toBe("/");
  await act(async () => root.unmount());
});

test("avec commande en attente valide : redirige vers /orders/:id", async () => {
  act(() => { writePendingOrderId("ord-123", new Date().toISOString()); });
  const { container, root } = await renderConfirm();
  expect(container.querySelector('[data-testid="redirect"]').getAttribute("data-to")).toBe("/orders/ord-123");
  await act(async () => root.unmount());
});

test("avec commande en attente périmée : redirige vers l'accueil et purge la mémorisation", async () => {
  act(() => { writePendingOrderId("ord-old", new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()); });
  const { container, root } = await renderConfirm();
  expect(container.querySelector('[data-testid="redirect"]').getAttribute("data-to")).toBe("/");
  await act(async () => root.unmount());
  expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
});
