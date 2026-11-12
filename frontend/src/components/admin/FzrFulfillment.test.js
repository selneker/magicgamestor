import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { FzrFulfillment } from "./FzrFulfillment";

// PL-UX-4 — le bloc de livraison ne porte PLUS le nom du fournisseur : il
// s'appelle « Détails » et garde l'information utile (état, référence,
// action « Envoyer »).

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = require("@/i18n/translations");
  const t = (path, vars) => {
    let s = path.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), translations.fr) ?? path;
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  };
  return { useLang: () => ({ t, lang: "fr" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const order = {
  id: "ord-1", order_number: "MGS-1", status: "paid",
  items: [{ product_id: "p1", quantity: 1, name: "660 UC" }],
  fazercards: { provider_order_id: "FZ-42", provider_status: "completed" },
};

async function mount(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<FzrFulfillment order={order} readyCount={0} {...props} />); });
  return { container, root };
}

afterEach(() => { document.body.innerHTML = ""; });

test("PL-UX-4 : le bloc s'appelle « Détails » et n'affiche plus le nom du fournisseur", async () => {
  const { container, root } = await mount();
  const block = container.querySelector('[data-testid="fzr-block-MGS-1"]');
  expect(block).not.toBeNull();
  expect(block.textContent).toContain("Détails");
  expect(block.textContent).not.toContain("FazerCards");
  expect(block.textContent).not.toContain("FAZERCARDS");
  await act(async () => root.unmount());
});

test("PL-UX-4 : l'information de livraison reste accessible (référence fournisseur, action d'envoi)", async () => {
  const { container, root } = await mount({ readyCount: 2, mappedIds: { p1: true } });
  // L'action « Envoyer » reste disponible (elle porte le nombre de lignes prêtes).
  expect(container.querySelector('[data-testid="fzr-send-MGS-1"]')).not.toBeNull();
  // Le contenu détaillé reste dépliable.
  const toggle = container.querySelector('[data-testid="fzr-toggle-MGS-1"]');
  expect(toggle).not.toBeNull();
  await act(async () => { toggle.click(); });
  expect(container.textContent).toContain("FZ-42");
  await act(async () => root.unmount());
});

// PL-UX-5 — maquette : plus de grande barre grise, le lien discret
// « Détails » + chevron devient le repli, rayons 8 px sur les boutons.
test("PL-UX-5 : plus de barre grise, lien « Détails » + chevron, rayons 8 px", async () => {
  const { container, root } = await mount({ readyCount: 2, mappedIds: { p1: true } });
  const block = container.querySelector('[data-testid="fzr-block-MGS-1"]');
  expect(block.className).not.toContain("bg-slate-50");
  const toggle = container.querySelector('[data-testid="fzr-toggle-MGS-1"]');
  expect(toggle.textContent).toContain("Détails");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.className).toContain("font-semibold");
  expect(container.querySelector('[data-testid="fzr-send-MGS-1"]').className).toContain("rounded-[8px]");
  // Le contenu détaillé reste caché tant que le lien n'est pas actionné.
  expect(container.textContent).not.toContain("FZ-42");
  await act(async () => { toggle.click(); });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("FZ-42");
  await act(async () => root.unmount());
});
