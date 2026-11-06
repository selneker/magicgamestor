import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminLayout from "./AdminLayout";

// Sidebar admin desktop (MGS-FE-ADMIN-20261105-01) : elle lit ADMIN_NAV
// (source de vérité unique) et remplace la barre d'onglets qui débordait.
let mockPathname = "/admin";
let mockCan = () => true;
let mockLogout = jest.fn();

jest.mock("react-router-dom", () => {
  const React = require("react");
  const Anchor = ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children);
  return {
    Link: Anchor,
    NavLink: Anchor,
    Outlet: () => React.createElement("div", { "data-testid": "outlet-stub" }),
    useLocation: () => ({ pathname: mockPathname }),
  };
});
jest.mock("@/components/admin/AdminPush", () => ({ AdminPushPage: () => null, AdminPushBadge: () => null }));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key) => key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key,
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ can: (...a) => mockCan(...a), logout: mockLogout }),
}));
jest.mock("@/context/ChatContext", () => ({ useChat: () => ({ count: 7 }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockPathname = "/admin";
  mockCan = () => true;
  mockLogout = jest.fn();
  const { api } = require("@/lib/api");
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/admin/fazercards/price-alerts") return Promise.resolve({ data: { alerts: [], unacknowledged: 22 } });
    return Promise.resolve({ data: {} });
  });
});
afterEach(() => { document.body.innerHTML = ""; });

async function mountLayout() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AdminLayout />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

test("sidebar desktop : les 11 entrées sont présentes et groupées, plus aucun onglet horizontal", async () => {
  const { container, root } = await mountLayout();
  const sidebar = container.querySelector('[data-testid="admin-sidebar"]');
  expect(sidebar).not.toBeNull();
  const expected = [
    "dashboard", "orders", "payments", "chat", // Opérations
    "catalogue", "games", "events", "loyalty", // Boutique
    "fournisseur", "users", "notifications", // Système
  ];
  const ids = Array.from(sidebar.querySelectorAll('[data-testid^="admin-nav-"]')).map((el) => el.getAttribute("data-testid"));
  expect(ids).toEqual(expected.map((k) => `admin-nav-${k}`));
  // PL-NOTIF-2B : l'encadré de configuration push a quitté le layout —
  // ni l'encadré ni une ligne de journal ne doivent apparaître ici.
  expect(container.querySelector('[data-testid="admin-push"]')).toBeNull();
  expect(container.querySelector('[data-testid="push-alert"]')).toBeNull();
  // L'ancienne barre d'onglets débordante a disparu.
  expect(container.querySelector('[data-testid="admin-tab-dashboard"]')).toBeNull();
  expect(container.querySelector(".overflow-x-auto")).toBeNull();
  // Titres de groupes.
  expect(sidebar.textContent).toContain("Opérations");
  expect(sidebar.textContent).toContain("Boutique");
  expect(sidebar.textContent).toContain("Système");
  await act(async () => root.unmount());
});

test("entrée active : fond lime + texte encre, badge Fournisseur aligné à droite", async () => {
  mockPathname = "/admin/fournisseur";
  const { container, root } = await mountLayout();
  const fzr = container.querySelector('[data-testid="admin-nav-fournisseur"]');
  expect(fzr.className).toContain("bg-primary");
  expect(fzr.className).toContain("text-ink");
  expect(fzr.getAttribute("aria-current")).toBe("page");
  // Badge inactif-format sur les autres entrées à badge (Chat) : pill contrastée.
  const chatBadge = container.querySelector('[data-testid="admin-nav-chat"] .bg-foreground');
  expect(chatBadge).not.toBeNull();
  expect(chatBadge.textContent).toBe("7");
  await act(async () => root.unmount());
});

test("badge actif : texte encre sur lime (pas de pill) sur l'entrée active", async () => {
  mockPathname = "/admin/messages";
  const { container, root } = await mountLayout();
  const chat = container.querySelector('[data-testid="admin-nav-chat"]');
  expect(chat.className).toContain("bg-primary");
  const badge = Array.from(chat.querySelectorAll("span")).pop();
  expect(badge.textContent).toBe("7");
  expect(badge.className).toContain("text-ink");
  expect(badge.className).not.toContain("bg-foreground");
  await act(async () => root.unmount());
});

test("sans la permission users.manage, Utilisateurs disparaît de la sidebar", async () => {
  mockCan = () => false;
  const { container, root } = await mountLayout();
  expect(container.querySelector('[data-testid="admin-nav-users"]')).toBeNull();
  await act(async () => root.unmount());
});

test("le contenu de page reçoit un padding-bottom égal à la barre mobile (56px + safe-area)", async () => {
  const { container, root } = await mountLayout();
  const layout = container.querySelector('[data-testid="admin-layout"]');
  expect(layout.className).toContain("pb-[calc(56px+env(safe-area-inset-bottom))]");
  expect(layout.className).toContain("lg:pb-16");
  await act(async () => root.unmount());
});

test("sidebar épinglée : sticky sous l'en-tête, hauteur viewport, scroll propre", async () => {
  const { container, root } = await mountLayout();
  const sidebar = container.querySelector('[data-testid="admin-sidebar"]');
  // Épinglage : sticky calé sous l'en-tête (h-16) et hauteur = viewport - top - 16px.
  expect(sidebar.className).toContain("sticky");
  expect(sidebar.className).toContain("top-16");
  expect(sidebar.className).toContain("h-[calc(100dvh-4rem-16px)]");
  // Scroll vertical propre, confiné, scrollbar fine — uniquement sur les groupes.
  const scroll = sidebar.querySelector(".overflow-y-auto");
  expect(scroll).not.toBeNull();
  expect(scroll.className).toContain("overscroll-contain");
  expect(scroll.className).toContain("[scrollbar-width:thin]");
  expect(scroll.querySelector('[data-testid="admin-nav-dashboard"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("pied de sidebar fixe : Boutique et Déconnexion hors de la zone scrollée", async () => {
  const { container, root } = await mountLayout();
  const sidebar = container.querySelector('[data-testid="admin-sidebar"]');
  const scroll = sidebar.querySelector(".overflow-y-auto");
  const shop = sidebar.querySelector('[data-testid="admin-sidebar-shop"]');
  const logoutBtn = sidebar.querySelector('[data-testid="admin-sidebar-logout"]');
  expect(shop).not.toBeNull();
  expect(logoutBtn).not.toBeNull();
  // Hors de la zone qui défile.
  expect(scroll.contains(shop)).toBe(false);
  expect(scroll.contains(logoutBtn)).toBe(false);
  // Mêmes chaînes t() que le menu Plus mobile.
  expect(shop.textContent).toContain("Boutique");
  expect(logoutBtn.textContent).toContain("Déconnexion");
  // Déconnexion en couleur danger (lisible clair + sombre, tokens --destructive).
  expect(logoutBtn.className).toContain("text-destructive");
  await act(async () => root.unmount());
});

test("Déconnexion déclenche logout() du contexte auth", async () => {
  const { container, root } = await mountLayout();
  const logoutBtn = container.querySelector('[data-testid="admin-sidebar-logout"]');
  await act(async () => { logoutBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(mockLogout).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
