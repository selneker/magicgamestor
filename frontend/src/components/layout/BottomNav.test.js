import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { BottomNav } from "./BottomNav";

// PL-005-FE-03 — la base design system agrandit la barre du bas (cible 48 px,
// icônes 24 px) sans rien changer aux entrées : mêmes 4 onglets, mêmes routes,
// mêmes correspondances actives que la nav desktop (Header NAV_MATCHES).
//
// (react-router-dom est moqué comme dans les autres tests : le vrai paquet v7
// ne se résout pas sous jest — voir Header.test.js:9-10.)
jest.mock("react-router-dom", () => {
  const React = require("react");
  const Anchor = ({ to, children, ...props }) =>
    React.createElement("a", { ...props, "data-to": to, href: to }, children);
  return { NavLink: Anchor, useLocation: () => ({ pathname: global.mockPathname || "/" }) };
});
// La pilule animée et le libellé coulissant sont décoratifs : span simple.
jest.mock("framer-motion", () => {
  const React = require("react");
  return { motion: { span: ({ children, className }) => React.createElement("span", { className }, children) } };
});
// t() RÉEL (pattern Catalog.test.js) : les libellés affichés doivent être les
// vraies traductions, jamais la clé brute.
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path) =>
    path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
  return { useLang: () => ({ t: make("fr"), lang: "fr" }) };
});
jest.mock("@/components/layout/GameButton", () => ({ GameButton: () => null }));
jest.mock("@/components/layout/GameSelector", () => ({ GameSelector: () => null }));

global.IS_REACT_ACT_ENVIRONMENT = true;

async function mountNav() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<BottomNav />); });
  return { container, root };
}

afterEach(() => { global.mockPathname = undefined; document.body.innerHTML = ""; });

test("PL-005-FE-03 : 4 entrées, mêmes routes et mêmes data-testid qu'avant le lot", async () => {
  const { container, root } = await mountNav();
  const entries = [...container.querySelectorAll("nav a")].map((a) => ({
    to: a.getAttribute("data-to"),
    id: a.getAttribute("data-testid"),
  }));
  expect(entries).toEqual([
    { to: "/boutique", id: "bottom-nav-shop" },
    { to: "/evenements", id: "bottom-nav-events" },
    { to: "/suivi", id: "bottom-nav-orders" },
    { to: "/chat", id: "bottom-nav-support" },
  ]);
  // Libellés réels (t() réel) — jamais la clé brute.
  const labels = entries.map((_, i) => container.querySelectorAll("nav a")[i].textContent);
  expect(labels).toEqual(["Boutique", "Event", "Commandes", "Support"]);
  await act(async () => root.unmount());
  container.remove();
});

test("PL-005-FE-03 : entrée active = aria-current (accueil → Boutique)", async () => {
  global.mockPathname = "/";
  const { container, root } = await mountNav();
  const active = container.querySelector('[aria-current="page"]');
  expect(active).not.toBeNull();
  expect(active.getAttribute("data-testid")).toBe("bottom-nav-shop");
  // Une seule entrée active à la fois.
  expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
  await act(async () => root.unmount());
  container.remove();
});

test("PL-005-FE-03 : Commandes active sur /suivi (mêmes correspondances que la nav desktop)", async () => {
  global.mockPathname = "/suivi";
  const { container, root } = await mountNav();
  const active = container.querySelector('[aria-current="page"]');
  expect(active?.getAttribute("data-testid")).toBe("bottom-nav-orders");
  await act(async () => root.unmount());
  container.remove();
});

test("PL-005-FE-03 : barre masquée sur /commande et /compte (barres FE-02 inchangées)", async () => {
  for (const pathname of ["/commande/abc", "/compte/points"]) {
    global.mockPathname = pathname;
    const { container, root } = await mountNav();
    expect(container.querySelector('[data-testid="bottom-nav"]')).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  }
});

test("PL-005-FE-03 : la barre reste absente sur /admin (hidesBottomChrome inchangé)", async () => {
  global.mockPathname = "/admin";
  const { container, root } = await mountNav();
  expect(container.querySelector('[data-testid="bottom-nav"]')).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});
