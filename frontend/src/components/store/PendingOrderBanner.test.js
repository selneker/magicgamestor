import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PendingOrderBanner } from "./PendingOrderBanner";
import { writePendingOrderId, clearPendingOrderId } from "@/lib/pendingOrder";

// PL-CHK-3 — bannière « Commande en cours » : visible sur l'accueil et le
// parcours de jeu UNIQUEMENT (jamais checkout / page de commande), connecté
// via l'API (plus récente, lien « Voir mes commandes » si plusieurs), invité
// via stockage local VÉRIFIÉ par l'API (entrée périmée/inconnue/statut final
// supprimée en silence, site fonctionnel sans stockage).

let mockPath = "/";
let mockUser = null;

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useLocation: () => ({ pathname: mockPath }),
  };
});
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
  errorMessage: () => "erreur",
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key, vars) => {
      let s = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
      if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
      return s;
    },
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: [{ id: "pubg-mobile", name: "PUBG Mobile" }] }) }));
jest.mock("@/pages/Home", () => {
  const React = require("react");
  return { GameLogo: (props) => React.createElement("span", { ...props, "data-testid": "banner-logo" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const future = (mins = 20) => new Date(Date.now() + mins * 60 * 1000).toISOString();

const baseOrder = {
  id: "ord-uuid-1", order_number: "MGS-C1", status: "pending_payment", payment_method: "manual",
  manual_operator: "mvola", // PL-CHK-5/6 : toute commande manuelle neuve porte l'opérateur
  pubg_id: "123456789", pseudo: "Joueur", game_id: "pubg-mobile",
  items: [{ quantity: 1, name: "660 UC", line_total: 2500 }],
  created_at: "2026-11-07T10:00:00Z", created_at_desc: undefined, total: 2500, payment_fee: 0,
  payment_deadline_at: future(),
};

beforeEach(() => {
  mockPath = "/"; mockUser = null;
  const { api } = require("@/lib/api");
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/orders/me") return Promise.resolve({ data: [] });
    if (url.startsWith("/orders/")) return Promise.resolve({ data: baseOrder });
    return Promise.resolve({ data: {} });
  });
  global.localStorage.clear();
  clearPendingOrderId();
});

afterEach(() => { document.body.innerHTML = ""; });

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PendingOrderBanner />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

describe("PendingOrderBanner", () => {
  test("jamais affichée sur le checkout ni la page de commande (aucun appel API)", async () => {
    for (const p of ["/commande", "/commande/confirmation", "/orders/ord-uuid-1", "/suivi"]) {
      mockPath = p;
      const { container, root } = await mount();
      expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
      expect(container.querySelector('[data-testid="pending-order-banner-loading"]')).toBeNull();
      const { api } = require("@/lib/api");
      expect(api.get).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    }
  });

  test("connecté : commande la plus récente + lien « Voir mes commandes » si plusieurs actives", async () => {
    mockUser = { user_id: "u1" };
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/orders/me"
      ? Promise.resolve({ data: [
          { ...baseOrder, payment_method: "mvola" },
          { ...baseOrder, id: "ord-old", order_number: "MGS-C0", created_at: "2026-11-06T10:00:00Z" },
        ] })
      : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="pending-order-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="banner-continue"]').getAttribute("href")).toBe("/orders/ord-uuid-1");
    expect(container.querySelector('[data-testid="banner-view-orders"]').getAttribute("href")).toBe("/suivi");
    await act(async () => root.unmount());
  });

  test("connecté : une seule commande active → pas de lien « Voir mes commandes »", async () => {
    mockUser = { user_id: "u1" };
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/orders/me" ? Promise.resolve({ data: [baseOrder] }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="banner-continue"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="banner-view-orders"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("connecté : statut final filtré → bannière absente", async () => {
    mockUser = { user_id: "u1" };
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/orders/me" ? Promise.resolve({ data: [{ ...baseOrder, status: "delivered" }] }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("connecté (PL-CHK-6) : commande manuelle sans opérateur JAMAIS retenue — la valide plus récente passe devant", async () => {
    mockUser = { user_id: "u1" };
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/orders/me" ? Promise.resolve({ data: [
      { ...baseOrder, manual_operator: null }, // plus récente mais invalide
      { ...baseOrder, id: "ord-ok", order_number: "MGS-C2", manual_operator: "mvola", created_at: "2026-11-06T10:00:00Z" },
    ] }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="banner-continue"]').getAttribute("href")).toBe("/orders/ord-ok");
    expect(container.querySelector('[data-testid="banner-view-orders"]')).toBeNull(); // une seule VALIDE
    await act(async () => root.unmount());
  });

  test("connecté (PL-CHK-6) : aucune commande valide (toutes sans opérateur) → bannière absente", async () => {
    mockUser = { user_id: "u1" };
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/orders/me" ? Promise.resolve({ data: [{ ...baseOrder, manual_operator: null }] }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("invité (PL-CHK-6) : commande manuelle sans opérateur → jamais affichée, entrée purgée", async () => {
    writePendingOrderId("ord-uuid-1", new Date().toISOString());
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url.startsWith("/orders/") ? Promise.resolve({ data: { ...baseOrder, manual_operator: null } }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
    expect(global.localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test("invité : entrée locale vérifiée par l'API avant affichage", async () => {
    writePendingOrderId("ord-uuid-1", new Date().toISOString());
    const { container, root } = await mount();
    const { api } = require("@/lib/api");
    expect(api.get).toHaveBeenCalledWith("/orders/ord-uuid-1");
    expect(container.querySelector('[data-testid="banner-continue"]').getAttribute("href")).toBe("/orders/ord-uuid-1");
    expect(container.querySelector('[data-testid="banner-view-orders"]')).toBeNull(); // invité : jamais
    await act(async () => root.unmount());
  });

  test("invité : entrée inconnue (404) supprimée en silence", async () => {
    writePendingOrderId("ord-unknown", new Date().toISOString());
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url.startsWith("/orders/")
      ? Promise.reject(Object.assign(new Error("not found"), { response: { status: 404 } }))
      : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
    expect(global.localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test("invité : statut final vu par l'API → bannière absente, entrée purgée", async () => {
    writePendingOrderId("ord-uuid-1", new Date().toISOString());
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url.startsWith("/orders/") ? Promise.resolve({ data: { ...baseOrder, status: "expired" } }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
    expect(global.localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test("commande proof_submitted → texte « Preuve envoyée »", async () => {
    mockUser = { user_id: "u1" };
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/orders/me" ? Promise.resolve({ data: [{ ...baseOrder, status: "proof_submitted" }] }) : Promise.resolve({ data: {} }));
    const { container, root } = await mount();
    expect(container.textContent).toContain("Preuve envoyée · vérification en cours");
    expect(container.querySelector('[data-testid="payment-countdown"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("invité sans stockage disponible : aucun plantage, rien d'affiché", async () => {
    writePendingOrderId("ord-uuid-2", new Date().toISOString());
    const saved = { getItem: Storage.prototype.getItem, removeItem: Storage.prototype.removeItem, setItem: Storage.prototype.setItem };
    const boom = () => { throw new Error("SecurityError"); };
    Object.assign(Storage.prototype, { getItem: boom, setItem: boom, removeItem: boom });
    try {
      const { container, root } = await mount();
      expect(container.querySelector('[data-testid="pending-order-banner"]')).toBeNull();
      await act(async () => root.unmount());
    } finally {
      Object.assign(Storage.prototype, saved);
    }
  });
});
