import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AdminBottomNav } from "./AdminBottomNav";

// Navigation admin mobile (MGS-FE-ADMIN-20261105-01) : la barre du bas et le
// menu Plus lisent ADMIN_NAV (source de vérité unique) — Jeux doit y être.
// (react-router-dom est moqué comme dans les autres tests : le vrai paquet v7
// ne se résout pas sous jest)
let mockPathname = "/admin";
let mockCan = () => true;

jest.mock("react-router-dom", () => {
  const React = require("react");
  const Anchor = ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children);
  return {
    Link: Anchor,
    NavLink: Anchor,
    useLocation: () => ({ pathname: mockPathname }),
  };
});
jest.mock("framer-motion", () => {
  const React = require("react");
  const strip = ({ initial, animate, exit, transition, ...rest }) => rest;
  return {
    motion: new Proxy({}, { get: (_, tag) => (props) => React.createElement(tag, strip(props)) }),
    AnimatePresence: ({ children }) => children,
  };
});
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key) => key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key,
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ can: (...a) => mockCan(...a), logout: jest.fn() }),
}));
jest.mock("@/context/ChatContext", () => ({ useChat: () => ({ count: 7 }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockPathname = "/admin";
  mockCan = () => true;
  const { api } = require("@/lib/api");
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/admin/fazercards/price-alerts") return Promise.resolve({ data: { alerts: [], unacknowledged: 22 } });
    return Promise.resolve({ data: {} });
  });
});
afterEach(() => { document.body.innerHTML = ""; });

async function mountNav() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AdminBottomNav />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

test("barre mobile : 4 entrées + Plus, collée en bas (h-14, 5 colonnes), libellés courts sans troncature", async () => {
  const { container, root } = await mountNav();
  for (const key of ["dashboard", "orders", "catalogue", "chat"]) {
    expect(container.querySelector(`[data-testid="admin-bnav-${key}"]`)).not.toBeNull();
  }
  expect(container.querySelector('[data-testid="admin-bnav-more"]')).not.toBeNull();
  const nav = container.querySelector('[data-testid="admin-bottom-nav"]');
  expect(nav.className).toContain("h-14");
  expect(nav.className).toContain("grid-cols-5");
  // Libellés courts en minuscules (via shortLabelKey), jamais tronqués.
  const labels = Array.from(nav.querySelectorAll("a > span:last-child, button > span:last-child")).map((s) => s.textContent);
  expect(labels).toEqual(["accueil", "commandes", "catalogue", "chat", "plus"]);
  const truncated = Array.from(nav.querySelectorAll("[class]")).filter((el) => /truncate|text-ellipsis/.test(el.className));
  expect(truncated).toEqual([]);
  // Badge Chat (compteur du contexte) sur le coin de l'icône.
  const chat = container.querySelector('[data-testid="admin-bnav-chat"]');
  expect(chat.textContent).toContain("7");
  await act(async () => root.unmount());
});

test("menu Plus : Jeux, Fournisseur, Paiements, Événements, Fidélité, Utilisateurs, Boutique, Déconnexion — avec badges", async () => {
  const { container, root } = await mountNav();
  await act(async () => { container.querySelector('[data-testid="admin-bnav-more"]').click(); });
  const sheet = container.querySelector('[data-testid="admin-more-sheet"]');
  expect(sheet).not.toBeNull();
  const expected = [
    ["admin-bnav-games", "/admin/jeux"],
    ["admin-bnav-fournisseur", "/admin/fournisseur"],
    ["admin-bnav-payments", "/admin/paiements"],
    ["admin-bnav-events", "/admin/evenements"],
    ["admin-bnav-loyalty", "/admin/fidelite"],
    ["admin-bnav-users", "/admin/utilisateurs"],
  ];
  const items = Array.from(sheet.querySelectorAll("li [data-testid]")).map((el) => [el.getAttribute("data-testid"), el.getAttribute("href")]);
  expect(items.slice(0, 6)).toEqual(expected);
  expect(items.map(([id]) => id)).toContain("admin-bnav-go-shop");
  expect(items.map(([id]) => id)).toContain("admin-bnav-logout");
  // Badge Fournisseur (alertes prix) affiché aussi dans le menu Plus.
  expect(sheet.querySelector('[data-testid="admin-bnav-fournisseur"]').textContent).toContain("22");
  await act(async () => root.unmount());
});

test("Jeux est atteignable : son lien pointe vers /admin/jeux (absent des deux surfaces avant unification)", async () => {
  const { container, root } = await mountNav();
  await act(async () => { container.querySelector('[data-testid="admin-bnav-more"]').click(); });
  const games = container.querySelector('[data-testid="admin-bnav-games"]');
  expect(games).not.toBeNull();
  expect(games.getAttribute("href")).toBe("/admin/jeux");
  expect(container.querySelector('[data-testid="admin-bnav-games"]')?.closest('[data-testid="admin-bottom-nav"]')).toBeNull();
  await act(async () => root.unmount());
});

test("hors /admin, la barre ne rend rien", async () => {
  mockPathname = "/";
  const { container, root } = await mountNav();
  expect(container.querySelector('[data-testid="admin-bottom-nav"]')).toBeNull();
  await act(async () => root.unmount());
});

test("sans la permission users.manage, Utilisateurs disparaît du menu Plus", async () => {
  mockCan = () => false;
  const { container, root } = await mountNav();
  await act(async () => { container.querySelector('[data-testid="admin-bnav-more"]').click(); });
  expect(container.querySelector('[data-testid="admin-bnav-users"]')).toBeNull();
  await act(async () => root.unmount());
});
