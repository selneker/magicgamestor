import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Header } from "./Header";
import { AuthProvider } from "@/context/AuthContext";
import { api } from "@/lib/api";

// Pendant la vérification de session (réveil Render compris), le header ne doit PAS afficher
// « Connexion » : cela ferait croire à tort à un compte déconnecté.
// (react-router-dom est moqué comme dans les autres tests : le vrai paquet v7 ne se résout pas sous jest)
jest.mock("react-router-dom", () => {
  const React = require("react");
  const Anchor = ({ to, end, className, children, ...props }) => {
    const cls = typeof className === "function" ? className({ isActive: false }) : className;
    return React.createElement("a", { ...props, className: cls }, children);
  };
  return { Link: Anchor, NavLink: Anchor };
});
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (k, vars) => (k === "nav.pointsAria" && vars ? `${vars.n} points` : k), lang: "fr" }) }));
jest.mock("@/context/CartContext", () => ({ useCart: () => ({ count: 0, setOpen: jest.fn() }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

let resolveMe;
beforeEach(() => {
  resolveMe = null;
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return new Promise((resolve) => { resolveMe = resolve; });
    if (url === "/settings/status") return Promise.resolve({ data: { online: true } });
    return Promise.resolve({ data: { balance: { total: 0 } } });
  });
});
afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ""; });

async function mountHeader() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AuthProvider><Header /></AuthProvider>);
  });
  return { container, root };
}

test("header : placeholder pendant le chargement, bouton compte une fois la session confirmée", async () => {
  const { container, root } = await mountHeader();
  expect(container.querySelector('[data-testid="login-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="account-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="auth-loading-icon"]')).not.toBeNull();

  await act(async () => { resolveMe({ data: { user_id: "u1", role: "customer" } }); });
  expect(container.querySelector('[data-testid="auth-loading-icon"]')).toBeNull();
  expect(container.querySelector('[data-testid="account-button"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="login-button"]')).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

test("header : serveur injoignable → bandeau Réessayer, jamais le bouton Connexion", async () => {
  jest.useFakeTimers();
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.reject(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
    if (url === "/settings/status") return Promise.resolve({ data: { online: true } });
    return Promise.resolve({ data: { balance: { total: 0 } } });
  });
  const { container, root } = await mountHeader();
  expect(container.querySelector('[data-testid="auth-offline-banner"]')).toBeNull();
  await act(async () => { jest.advanceTimersByTime(3000); });
  await act(async () => { jest.advanceTimersByTime(8000); });
  await act(async () => {});
  expect(container.querySelector('[data-testid="auth-offline-banner"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="auth-offline-retry"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="auth-offline-button"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="login-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="account-button"]')).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

test("header : utilisateur déconnecté (401 confirmé) → le bouton Connexion apparaît", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.reject(Object.assign(new Error("401"), { response: { status: 401 } }));
    if (url === "/settings/status") return Promise.resolve({ data: { online: true } });
    return Promise.resolve({ data: { balance: { total: 0 } } });
  });
  const { container, root } = await mountHeader();
  await act(async () => {});
  expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="account-button"]')).toBeNull();
  expect(container.querySelector('[data-testid="auth-loading-icon"]')).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

// ---- PL-BRAND-1 : logo, pastille compacte, repli au défilement ----

function setScrollY(y) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}
// jsdom fait 1024 px de large : le repli n'agit que sous 768 px.
function setViewportWidth(w) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
}
async function scroll(container, root, y) {
  setScrollY(y);
  await act(async () => { window.dispatchEvent(new Event("scroll")); });
}

test("header : le texte de marque est remplacé par le logo SVG (aria-label = nom du magasin)", async () => {
  const { container, root } = await mountHeader();
  const logo = container.querySelector('[data-testid="header-logo"]');
  expect(logo).not.toBeNull();
  expect(logo.querySelector("svg")).not.toBeNull();
  expect(logo.getAttribute("aria-label")).toBe("Magic Game Store");
  expect(logo.textContent).not.toContain("Magic"); // plus de texte de marque
  await act(async () => root.unmount());
  container.remove();
});

test("pastille de points mobile : valeur abrégée, pas de libellé pts, solde exact dans l'aria-label", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.resolve({ data: { user_id: "u1", role: "customer", name: "Test" } });
    if (url === "/settings/status") return Promise.resolve({ data: { online: true } });
    if (url === "/loyalty/me") return Promise.resolve({ data: { balance: { total: 12500 } } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await mountHeader();
  await act(async () => {});
  const pill = container.querySelector('[data-testid="header-loyalty-pill"]');
  expect(pill).not.toBeNull();
  expect(pill.getAttribute("aria-label")).toBe("12500 points");
  expect(container.querySelector('[data-testid="header-loyalty-pill-value"]').textContent).toBe("12,5\u00A0k");
  expect(pill.textContent).not.toContain("pts"); // libellé retiré sur mobile
  await act(async () => root.unmount());
  container.remove();
});

test("repli au défilement : caché en descendant, réapparaît en remontant", async () => {
  setViewportWidth(390);
  const { container, root } = await mountHeader();
  const header = container.querySelector("header");
  expect(header.getAttribute("data-collapsed")).toBe("false");
  await scroll(container, root, 300);
  await scroll(container, root, 500);
  expect(header.getAttribute("data-collapsed")).toBe("true");
  await scroll(container, root, 200);
  expect(header.getAttribute("data-collapsed")).toBe("false");
  await act(async () => root.unmount());
  container.remove();
  setScrollY(0);
  setViewportWidth(1024);
});

test("repli au défilement : désactivé avec prefers-reduced-motion", async () => {
  setViewportWidth(390);
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  try {
    const { container, root } = await mountHeader();
    const header = container.querySelector("header");
    await scroll(container, root, 300);
    await scroll(container, root, 500);
    expect(header.getAttribute("data-collapsed")).toBe("false");
    await act(async () => root.unmount());
    container.remove();
  } finally {
    delete window.matchMedia;
    setScrollY(0);
    setViewportWidth(1024);
  }
});
