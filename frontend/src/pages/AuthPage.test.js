import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AuthPage from "./AuthPage";
import { api } from "@/lib/api";

// « Rester connecté » : case cochée par défaut (session 30 jours), décochée → cookie de session.
// (react-router-dom est moqué comme dans les autres tests : le vrai paquet v7 ne se résout pas sous jest)
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, state, children, ...props }) => React.createElement("a", props, children),
    Navigate: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: "/connexion", search: "", hash: "", state: null }),
  };
});
jest.mock("sonner", () => ({ toast: { message: jest.fn(), error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null, setUser: jest.fn() }) }));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path) => path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
  return { useLang: () => ({ t: make("fr"), lang: "fr" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom n'implémente pas ResizeObserver (utilisé par Radix Checkbox)
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderLogin() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AuthPage mode="login" />);
  });
  return { container, root };
}

async function fillAndSubmit(container) {
  await act(async () => {
    setValue(container.querySelector('[data-testid="email-input"]'), "a@b.c");
    setValue(container.querySelector('[data-testid="password-input"]'), "secret1");
  });
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { user: { user_id: "u1" }, access_token: "a" } });
});
afterEach(() => { document.body.innerHTML = ""; });

test("cochée par défaut : le login envoie remember=true (session persistante 30 jours)", async () => {
  const { container, root } = await renderLogin();
  const checkbox = container.querySelector('[data-testid="remember-checkbox"]');
  expect(checkbox).toBeTruthy();
  expect(checkbox.getAttribute("data-state")).toBe("checked");
  await fillAndSubmit(container);
  expect(api.post).toHaveBeenCalledWith("/auth/login", { email: "a@b.c", password: "secret1", remember: true });
  await act(async () => root.unmount());
});

test("décochée : le login envoie remember=false (cookie de session, appareil partagé)", async () => {
  const { container, root } = await renderLogin();
  await act(async () => { container.querySelector('[data-testid="remember-checkbox"]').click(); });
  expect(container.querySelector('[data-testid="remember-checkbox"]').getAttribute("data-state")).toBe("unchecked");
  await fillAndSubmit(container);
  expect(api.post).toHaveBeenLastCalledWith("/auth/login", { email: "a@b.c", password: "secret1", remember: false });
  await act(async () => root.unmount());
});
