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
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (k) => k, lang: "fr" }) }));
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
