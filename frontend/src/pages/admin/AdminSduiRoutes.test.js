// Tests du branchement des écrans SDUI (FE-006) : paire path ↔ écran, élément
// de route (gameId lu de l'URL, encodé dans l'URL d'API par le moteur), et
// accès direct sans droit (le serveur répond 403 → erreur du serveur affichée).
// react-router-dom v7 ne se résout pas sous jest (motif du dépôt) : useParams
// est une mock fn dont chaque test fixe la valeur — le vrai composant n'utilise
// que useParams et Link.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ADMIN_SDUI_ROUTES, SduiRoute } from "./AdminSduiRoutes";
import providerFixture from "@/sdui/__fixtures__/screen-provider.json";
import mappingFixture from "@/sdui/__fixtures__/screen-mapping.json";
import { api } from "@/lib/api";

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockUseParams = jest.fn(() => ({}));

jest.mock("react-router-dom", () => ({
  useParams: (...args) => mockUseParams(...args),
  Link: ({ to, children, ...props }) => {
    const React = require("react");
    return React.createElement("a", { ...props, href: to }, children);
  },
}));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), put: jest.fn(), post: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (p) => p, lang: "fr" }) }));

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
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ——— Table path ↔ écran (source unique importée par App.js) —————————————————

test("la table de routes relie fournisseur→provider et mapping→mapping (l'inversion est rouge)", () => {
  expect(ADMIN_SDUI_ROUTES).toEqual([
    { path: "jeux/:gameId/fournisseur", screen: "provider" },
    { path: "jeux/:gameId/mapping", screen: "mapping" },
  ]);
});

// ——— SduiRoute : le bon écran avec le bon gameId ————————————————————————————

test("route fournisseur : GET /admin/games/:gameId/provider, écran rendu", async () => {
  mockUseParams.mockReturnValue({ gameId: "jeu 1" });
  api.get.mockResolvedValue({ data: providerFixture });
  const { container, root } = await mount(<SduiRoute screen="provider" />);
  expect(api.get).toHaveBeenCalledWith("/admin/games/jeu%201/provider"); // gameId encodé
  expect(container.querySelector("h1").textContent).toBe("Fournisseur du jeu");
  await act(async () => root.unmount());
});

test("route mapping : GET /admin/games/:gameId/aluu-mapping, écran rendu", async () => {
  mockUseParams.mockReturnValue({ gameId: "jeu 1" });
  api.get.mockResolvedValue({ data: mappingFixture });
  const { container, root } = await mount(<SduiRoute screen="mapping" />);
  expect(api.get).toHaveBeenCalledWith("/admin/games/jeu%201/aluu-mapping");
  expect(container.querySelector("h1").textContent).toBe("Correspondance produits ↔ packs");
  await act(async () => root.unmount());
});

test("gameId « bizarre » : encodé dans l'URL de l'API, jamais de détournement de route", async () => {
  mockUseParams.mockReturnValue({ gameId: "a b/c?d" });
  api.get.mockResolvedValue({ data: providerFixture });
  const { container, root } = await mount(<SduiRoute screen="provider" />);
  expect(api.get).toHaveBeenCalledWith("/admin/games/a%20b%2Fc%3Fd/provider");
  expect(String(api.get.mock.calls[0][0])).toMatch(/^\/admin\//); // reste dans /admin/
  expect(container.querySelector("h1").textContent).toBe("Fournisseur du jeu");
  await act(async () => root.unmount());
});

// ——— Accès direct sans droit : l'erreur du SERVEUR s'affiche —————————————————

test("accès direct sans droit : 403 du GET → errors.permission_denied affiché, pas une page vide", async () => {
  mockUseParams.mockReturnValue({ gameId: "example_game" });
  api.get.mockRejectedValue({ response: { status: 403, data: { detail: "Not authenticated" } } });
  const { container, root } = await mount(<SduiRoute screen="provider" />);
  const error = q(container, "sdui-error");
  expect(error).not.toBeNull();
  expect(error.getAttribute("role")).toBe("alert");
  expect(error.textContent).toContain("Vous n'avez pas la permission requise.");
  expect(container.textContent).not.toContain("Not authenticated"); // detail jamais affiché
  expect(container.querySelector("h1")).toBeNull();
  await act(async () => root.unmount());
});
