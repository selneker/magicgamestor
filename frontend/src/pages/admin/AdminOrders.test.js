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
    // PL-UX-4 — le mock interpete les variables ({n}) comme le vrai `t()`.
    t: (key, vars) => {
      let s = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
      if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
      return s;
    },
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

// PL-UX-4 — le rendu admin (Radix Select par commande) dépasse 5 s sur cette
// machine : on élargit le délai plutôt que de laisser un test au hasard.
jest.setTimeout(30000);

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

// PL-CHK-2 — section « Preuves » : vignettes auth par index (blob), états d'
// erreur 410 (purgée) / 404 (indisponible), et l'affichage des badges des deux
// nouveau statuts de preuve.
// Le polyfill core-js (importé via la chaîne api/OrderProofs) remplace
// l'objet URL global APRÈS l'éval du fichier : le stub est posé dans beforeEach,
// au moment du test, sur l'URL réellement référencée.
beforeEach(() => {
  URL.createObjectURL = jest.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
  URL.revokeObjectURL = jest.fn();
});

test("liste admin : les statuts proof_submitted et late_payment ont leur libellé", async () => {
  mockOrders = [order({ order_number: "MGS-PS", payment_method: "manual", status: "proof_submitted" }), order({ order_number: "MGS-LP", payment_method: "manual", status: "late_payment" })];
  const { container, root } = await mountOrders();
  expect(rowText(container, "MGS-PS")).toContain("Preuve en vérification");
  expect(rowText(container, "MGS-LP")).toContain("Paiement tardif, en vérification");
  await act(async () => root.unmount());
});

// PL-UX-4 — la liste n'affiche PLUS de vignette : un seul bouton
// « Preuves (n) », et les images ne sont téléchargées qu'au clic.
test("liste admin : bouton « Preuves (n) », AUCUNE image chargée ni affichée dans la liste", async () => {
  const { api } = require("@/lib/api");
  api.get.mockImplementation((url) => {
    if (url === "/admin/fazercards/mappings") return Promise.resolve({ data: { products: [] } });
    if (url === "/admin/orders") return Promise.resolve({ data: mockOrders });
    if (url.startsWith("/admin/orders/MGS-PS/proofs/")) return Promise.resolve({ data: new Blob(["x"], { type: "image/png" }) });
    return Promise.resolve({ data: {} });
  });
  mockOrders = [order({ order_number: "MGS-PS", payment_method: "manual", status: "proof_submitted", payment_proofs: [{ size: 10, uploaded_at: "2026-11-10T10:00:00Z" }, { size: 10, uploaded_at: "2026-11-10T10:01:00Z" }] })];
  const { container, root } = await mountOrders();
  const button = container.querySelector('[data-testid="admin-proofs-button-MGS-PS"]');
  expect(button).not.toBeNull();
  expect(button.textContent).toContain("Preuves (2)");
  // AUCUNE requête d'image avant le clic, AUCUNE vignette dans la liste.
  expect(api.get).not.toHaveBeenCalledWith("/admin/orders/MGS-PS/proofs/0", { responseType: "blob" });
  expect(container.querySelector('[data-testid="admin-proof-0"]')).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  await act(async () => root.unmount());
});

test("liste admin : clic sur « Preuves » → la visionneuse s'ouvre et charge l'image", async () => {
  const { api } = require("@/lib/api");
  api.get.mockImplementation((url) => {
    if (url === "/admin/fazercards/mappings") return Promise.resolve({ data: { products: [] } });
    if (url === "/admin/orders") return Promise.resolve({ data: mockOrders });
    if (url.startsWith("/admin/orders/MGS-PS/proofs/")) return Promise.resolve({ data: new Blob(["x"], { type: "image/png" }) });
    return Promise.resolve({ data: {} });
  });
  mockOrders = [order({ order_number: "MGS-PS", payment_method: "manual", status: "proof_submitted", payment_proofs: [{ size: 10, uploaded_at: "2026-11-10T10:00:00Z" }] })];
  const { container, root } = await mountOrders();
  await act(async () => { container.querySelector('[data-testid="admin-proofs-button-MGS-PS"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(container.querySelector('[data-testid="proof-viewer"]')).not.toBeNull();
  expect(api.get).toHaveBeenCalledWith("/admin/orders/MGS-PS/proofs/0", { responseType: "blob" });
  await act(async () => root.unmount());
});

// --- PL-UX-3 : filtre de méthode de paiement --------------------------------
// Depuis PL-ORDER-CLIENT-1, MVola/Orange Money sont des commandes
// `payment_method: "manual"` + `manual_operator`. Le backend ne filtre que
// par `payment_method` → le filtre opérateur est appliqué côté client.

test("PL-UX-3 : toutes les méthodes sont proposées dans le filtre (Tous, MVola, Orange, USSD, USDT)", async () => {
  const { METHOD_FILTERS } = require("./AdminOrders");
  expect(METHOD_FILTERS.map((m) => m.value)).toEqual(["all", "mvola", "orange", "manual", "binance"]);
  const t = (key) => key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
  const labels = METHOD_FILTERS.map((m) => m.label(t));
  expect(labels).toEqual(["Tous paiements", "MVola", "Orange Money", "USSD", "Binance USDT"]);
});

test("PL-UX-3 : un filtre opérateur n'envoie AUCUN `method` à l'API (le serveur ne le comprend pas)", () => {
  const { adminOrdersParams } = require("./AdminOrders");
  expect(adminOrdersParams({ status: "all", method: "mvola", q: "" })).toEqual({ status: "all", q: "" });
  expect(adminOrdersParams({ status: "paid", method: "orange", q: "abc" })).toEqual({ status: "paid", q: "abc" });
  // Les autres méthodes restent filtrées par le serveur.
  expect(adminOrdersParams({ status: "all", method: "binance", q: "" })).toEqual({ status: "all", method: "binance", q: "" });
  expect(adminOrdersParams({ status: "all", method: "manual", q: "" })).toEqual({ status: "all", method: "manual", q: "" });
});

test("PL-UX-3 : le filtre opérateur sépare MVola et Orange Money", () => {
  const { filterOrdersByMethod, orderOperator } = require("./AdminOrders");
  const orders = [
    { order_number: "A", payment_method: "manual", manual_operator: "mvola" },
    { order_number: "B", payment_method: "manual", manual_operator: "orange" },
    { order_number: "C", payment_method: "manual", manual_operator: null },
    { order_number: "D", payment_method: "mvola" }, // commande antérieure
    { order_number: "E", payment_method: "binance" },
  ];
  expect(filterOrdersByMethod(orders, "mvola").map((o) => o.order_number)).toEqual(["A", "D"]);
  expect(filterOrdersByMethod(orders, "orange").map((o) => o.order_number)).toEqual(["B"]);
  // « Tous » et les méthodes filtrées par le serveur ne sont pas re-filtrées
  // côté client (le serveur s'en charge).
  expect(filterOrdersByMethod(orders, "all")).toHaveLength(5);
  expect(filterOrdersByMethod(orders, "binance")).toHaveLength(5);
  // Les commandes sans opérateur ne sont NI MVola NI Orange.
  expect(orderOperator(orders[2])).toBeNull();
});

test("PL-UX-3 : la commande manuelle affiche son opérateur (MVola / Orange Money)", async () => {
  mockOrders = [
    order({ order_number: "MGS-MV2", payment_method: "manual", manual_operator: "mvola", manual_reference: "REF9" }),
    order({ order_number: "MGS-OR2", payment_method: "manual", manual_operator: "orange" }),
  ];
  const { container, root } = await mountOrders();
  expect(rowText(container, "MGS-MV2")).toContain("USSD · MVola · REF9");
  expect(rowText(container, "MGS-OR2")).toContain("USSD · Orange Money");
  await act(async () => root.unmount());
});

test("PL-UX-3 : le chargement initial interroge l'API avec le filtre « Tous »", async () => {
  const { api } = require("@/lib/api");
  await mountOrders();
  expect(api.get).toHaveBeenCalledWith("/admin/orders", { params: { status: "all", method: "all", q: "" } });
});

test("PL-UX-3 : la limite du filtre opérateur est affichée (jamais cachée)", async () => {
  const { AdminMethodOperatorNote } = require("./AdminOrders");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AdminMethodOperatorNote method="mvola" />); });
  const note = container.querySelector('[data-testid="admin-method-operator-note"]');
  expect(note).not.toBeNull();
  expect(note.textContent).toContain("Filtre opérateur");
  await act(async () => root.unmount());

  const container2 = document.createElement("div");
  document.body.appendChild(container2);
  const root2 = createRoot(container2);
  await act(async () => { root2.render(<AdminMethodOperatorNote method="all" />); });
  expect(container2.querySelector('[data-testid="admin-method-operator-note"]')).toBeNull();
  await act(async () => root2.unmount());
});

test("PL-UX-3 : sans filtre opérateur, aucune note de limite dans la liste", async () => {
  const { container, root } = await mountOrders();
  expect(container.querySelector('[data-testid="admin-method-operator-note"]')).toBeNull();
  await act(async () => root.unmount());
});


// --- PL-UX-4 : carte de commande épurée (mobile/desktop) + bloc « Détails » ---

test("PL-UX-4 : la carte empile ses blocs sur mobile (colonne unique) et se range en colonnes au-dessus de 640 px", async () => {
  mockOrders = [order({ order_number: "MGS-C1", payment_method: "manual", manual_operator: "mvola", total: 25000 })];
  const { container, root } = await mountOrders();
  const card = container.querySelector('[data-testid="admin-order-MGS-C1"]');
  expect(card.className).toContain("grid-cols-1");
  expect(card.className).toContain("sm:grid-cols-[auto_1fr_auto]");
  // Montant : ligne 2 du mobile, colonne 3 du desktop.
  const total = container.querySelector('[data-testid="admin-order-total-MGS-C1"]');
  expect(total).not.toBeNull();
  expect(total.className).toContain("shrink-0");
  expect(total.className).toContain("sm:col-start-3");
  // Sélecteur de statut : pleine largeur sur mobile (cible 44 px).
  const select = container.querySelector('[data-testid="admin-status-select-MGS-C1"]');
  expect(select.className).toContain("w-full");
  expect(select.className).toContain("h-11");
  // Email : coupé proprement (jamais de débordement).
  const email = container.querySelector('[data-testid="admin-order-email-MGS-C1"]');
  expect(email.className).toContain("truncate");
  await act(async () => root.unmount());
});

// Le bloc « Détails » (ex-« FAZERCARDS ») est testé dans son propre fichier
// (components/admin/FzrFulfillment.test.js) : ici il est mocké.

test("PL-UX-4 : aucun bouton « Preuves » quand la commande n'a pas de preuve", async () => {
  mockOrders = [order({ order_number: "MGS-NP", payment_method: "manual" })];
  const { container, root } = await mountOrders();
  expect(container.querySelector('[data-testid="admin-proofs-button-MGS-NP"]')).toBeNull();
  await act(async () => root.unmount());
});
