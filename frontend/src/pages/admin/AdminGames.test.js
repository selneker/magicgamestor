// Tests des liens SDUI de la liste des jeux (FE-006) : visibles seulement avec
// la permission catalog.manage (mécanisme useAuth().can des pages admin
// voisines), nom accessible incluant le nom du jeu, cible ≥ 44 px, href exacts.
// Motif du dépôt : react-router-dom moqué (v7 ne se résout pas sous jest), api
// moqué, useLang en passthrough.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminGames from "./AdminGames";
import { api } from "@/lib/api";

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCan = jest.fn(() => false);

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }) => {
    const React = require("react");
    return React.createElement("a", { ...props, href: to }, children);
  },
}));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), put: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (p, vars) => (vars && typeof p === "string" ? p : p), lang: "fr" }) }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: false, can: (...args) => mockCan(...args) }) }));

const GAMES = [
  { id: "example_game", slug: "example-game", name: "Example Game", active: true },
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", active: true },
];

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

const q = (container, testid) => container.querySelector(`[data-testid="${testid}"]`);

beforeEach(() => {
  jest.resetAllMocks();
  mockCan.mockReturnValue(false);
  api.get.mockResolvedValue({ data: GAMES });
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("sans catalog.manage : aucun lien SDUI", async () => {
  const { container, root } = await mount(<AdminGames />);
  expect(q(container, "sdui-link-provider-example-game")).toBeNull();
  expect(q(container, "sdui-link-mapping-example-game")).toBeNull();
  expect(q(container, "sdui-link-provider-pubg-mobile")).toBeNull();
  expect(q(container, "sdui-link-mapping-pubg-mobile")).toBeNull();
  await act(async () => root.unmount());
});

test("avec catalog.manage : deux liens par jeu, href exacts, nom accessible unique avec le nom du jeu", async () => {
  mockCan.mockReturnValue(true);
  const { container, root } = await mount(<AdminGames />);
  const provider = q(container, "sdui-link-provider-example-game");
  const mapping = q(container, "sdui-link-mapping-example-game");
  expect(provider.getAttribute("href")).toBe("/admin/jeux/example_game/fournisseur");
  expect(mapping.getAttribute("href")).toBe("/admin/jeux/example_game/mapping");
  expect(provider.getAttribute("aria-label")).toBe("admin.sdui.providerFor"); // passthrough : la clé
  // cible ≥ 44 px : h-11 fusionné sur le <a> par le Slot du Button
  expect(provider.className).toContain("h-11");
  expect(mapping.className).toContain("h-11");
  await act(async () => root.unmount());
});

test("les deux jeux obtiennent leurs liens (un par carte, portés par leur jeu)", async () => {
  mockCan.mockReturnValue(true);
  const { container, root } = await mount(<AdminGames />);
  expect(q(container, "sdui-link-provider-pubg-mobile").getAttribute("href")).toBe("/admin/jeux/pubg-mobile/fournisseur");
  expect(q(container, "sdui-link-mapping-pubg-mobile").getAttribute("href")).toBe("/admin/jeux/pubg-mobile/mapping");
  expect(container.querySelectorAll("[data-testid^=sdui-link-]")).toHaveLength(4); // 2 jeux × 2 liens
  await act(async () => root.unmount());
});
