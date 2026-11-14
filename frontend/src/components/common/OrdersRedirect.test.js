import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OrdersRedirect from "./OrdersRedirect";

// PL-005-FE-02 (tâche 1) — /commandes devient une redirection REPLACE vers
// /suivi (la liste vit sur /suivi) : aucune trace d'historique empilé, un
// client qui revient en arrière ne retombe pas sur /commandes.
// react-router-dom v7 ne se résout pas sous jest (voir Header.test.js:9-10) :
// Navigate est mocké et on affirme ses props — replace inclus.

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockNavigateProps = null;

jest.mock("react-router-dom", () => ({
  Navigate: (props) => {
    mockNavigateProps = props;
    return null;
  },
}));

afterEach(() => {
  document.body.innerHTML = "";
  mockNavigateProps = null;
});

async function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

test("/commandes → /suivi en replace (pas un push)", async () => {
  await mount(<OrdersRedirect />);
  expect(mockNavigateProps).toEqual({ to: "/suivi", replace: true });
});
