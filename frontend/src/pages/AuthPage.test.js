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
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, errorMessage: (e) => `Erreur: ${e?.message || e?.response?.data?.code || "inconnue"}` }));
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

/* PL-SEC-HARDEN-1-CAPTCHA — widget Turnstile sur les formulaires auth.
   La clé est lue au rendu (pas aux imports) : chaque test pose la sienne. */
const ENV_VAR = "REACT_APP_TURNSTILE_SITE_KEY";
const TEST_KEY = "0xAAAABBBB000000000000000000000001";

let turnstileOpts;
const stubTurnstile = () => {
  turnstileOpts = null;
  window.turnstile = {
    render: (el, opts) => { turnstileOpts = opts; el.innerHTML = "<div class='mock-cf'>mock</div>"; return "w1"; },
    remove: () => {},
    reset: () => {},
  };
};

const flushCaptcha = async () => { await act(async () => { await Promise.resolve(); }); };

afterEach(() => { delete process.env[ENV_VAR]; delete window.turnstile; });

test("CAPTCHA avec clé : l'inscription bloque l'envoi tant que le widget n'est pas résolu", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AuthPage mode="register" />); });
  await flushCaptcha();
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  setValue(container.querySelector('[data-testid="name-input"]'), "Joueur");
  setValue(container.querySelector('[data-testid="email-input"]'), "a@b.c");
  setValue(container.querySelector('[data-testid="password-input"]'), "secret1");
  const submitBtn = container.querySelector('[data-testid="auth-submit"]');
  expect(submitBtn.disabled).toBe(true);
  act(() => { turnstileOpts.callback("jeton-r1"); });
  expect(submitBtn.disabled).toBe(false);
  await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(api.post).toHaveBeenLastCalledWith("/auth/register", expect.objectContaining({ captcha_token: "jeton-r1" }));
  await act(async () => root.unmount());
});

test("CAPTCHA avec clé : connexion — pas de widget au départ, il apparaît après un échec", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  api.post.mockRejectedValueOnce(new Error("bad credentials"));
  const { container, root } = await renderLogin();
  await flushCaptcha();
  expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
  // premier essai (sans jeton — pas encore exigé côté client)
  await fillAndSubmit(container);
  expect(api.post).toHaveBeenLastCalledWith("/auth/login", expect.not.objectContaining({ captcha_token: "jeton" }));
  expect(container.querySelector('[data-testid="auth-error"]').textContent).toContain("Erreur");
  // le widget apparaît maintenant (laisser le temps de le résoudre)
  await flushCaptcha();
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  const submitBtn = container.querySelector('[data-testid="auth-submit"]');
  expect(submitBtn.disabled).toBe(true); // en attente du nouveau jeton
  act(() => { turnstileOpts.callback("jeton-r2"); });
  expect(submitBtn.disabled).toBe(false);
  await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(api.post).toHaveBeenLastCalledWith("/auth/login", expect.objectContaining({ captcha_token: "jeton-r2" }));
  await act(async () => root.unmount());
});

test("CAPTCHA : erreur serveur liée au CAPTCHA → message dédié + widget réinitialisé", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  api.post.mockRejectedValueOnce({ response: { status: 428, data: { code: "captcha_required" } } });
  api.post.mockRejectedValueOnce({ response: { status: 428, data: { code: "captcha_required" } } });
  const { container, root } = await renderLogin();
  await flushCaptcha();
  await fillAndSubmit(container);          // échec → widget affiché
  act(() => { turnstileOpts.callback("jeton-r1"); });
  await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(container.querySelector('[data-testid="auth-error"]').textContent).toContain("Merci de refaire le contrôle de sécurité");
  const submitBtn = container.querySelector('[data-testid="auth-submit"]');
  expect(submitBtn.disabled).toBe(true); // jeton à usage unique : l'ancien ne sert plus
  await act(async () => root.unmount());
});

test("CAPTCHA sans clé configurée : ni widget ni champ captcha_token, comportement inchangé", async () => {
  const { container, root } = await renderLogin();
  await fillAndSubmit(container);
  expect(api.post).toHaveBeenLastCalledWith("/auth/login", { email: "a@b.c", password: "secret1", remember: true });
  expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
  const submitBtn = container.querySelector('[data-testid="auth-submit"]');
  expect(submitBtn.disabled).toBe(false);
  await act(async () => root.unmount());
});
