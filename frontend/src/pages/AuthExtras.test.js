import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ForgotPassword } from "./AuthExtras";

// PL-SEC-HARDEN-1-CAPTCHA — le formulaire « mot de passe oublié » envoie
// captcha_token quand le widget est configuré, rien de nouveau sinon.
// (react-router-dom v7 ne se résout pas sous jest — voir Header.test.js)
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useParams: () => ({}),
    useNavigate: () => jest.fn(),
  };
});
jest.mock("sonner", () => ({ toast: { message: jest.fn(), error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errorMessage: (e) => `Erreur: ${e?.message || e?.response?.data?.code || "inconnue"}`,
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path) => path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
  return { useLang: () => ({ t: make("fr"), lang: "fr" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const ENV_VAR = "REACT_APP_TURNSTILE_SITE_KEY";
const TEST_KEY = "0xAAAABBBB000000000000000000000001";

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

let turnstileOpts;
const stubTurnstile = () => {
  turnstileOpts = null;
  window.turnstile = {
    render: (el, opts) => { turnstileOpts = opts; el.innerHTML = "<div class='mock-cf'>mock</div>"; return "w1"; },
    remove: () => {},
    reset: () => {},
  };
};

async function renderForgot() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ForgotPassword />); });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}
const submitForm = async (container) => {
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  delete process.env[ENV_VAR];
  delete window.turnstile;
  const { api } = require("@/lib/api");
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => {
  document.body.innerHTML = "";
  delete process.env[ENV_VAR];
  delete window.turnstile;
});

test("sans clé : pas de widget, envoi inchangé, champ captcha_token omis", async () => {
  const { container, root } = await renderForgot();
  expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
  setValue(container.querySelector('[data-testid="forgot-email-input"]'), "a@b.c");
  await submitForm(container);
  expect(require("@/lib/api").api.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "a@b.c", captcha_token: undefined });
  expect(container.querySelector('[data-testid="forgot-sent"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("avec clé : le bouton est bloqué sans jeton, l'envoi inclut captcha_token", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { container, root } = await renderForgot();
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  setValue(container.querySelector('[data-testid="forgot-email-input"]'), "a@b.c");
  const btn = container.querySelector('[data-testid="forgot-submit"]');
  expect(btn.disabled).toBe(true); // jeton pas encore obtenu
  act(() => { turnstileOpts.callback("jeton-f1"); });
  expect(btn.disabled).toBe(false);
  await submitForm(container);
  expect(require("@/lib/api").api.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "a@b.c", captcha_token: "jeton-f1" });
  await act(async () => root.unmount());
});

test("erreur serveur CAPTCHA : message dédié « Merci de refaire le contrôle de sécurité »", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { api, errorMessage } = require("@/lib/api");
  const { toast } = require("sonner");
  api.post.mockRejectedValue({ response: { status: 428, data: { code: "captcha_invalid" } } });
  const { container, root } = await renderForgot();
  setValue(container.querySelector('[data-testid="forgot-email-input"]'), "a@b.c");
  act(() => { turnstileOpts.callback("jeton-f1"); });
  await submitForm(container);
  expect(toast.error).toHaveBeenCalledWith("Merci de refaire le contrôle de sécurité ci-dessus puis de réessayer.");
  expect(container.querySelector('[data-testid="forgot-submit"]').disabled).toBe(true); // jeton à usage unique vidé
  await act(async () => root.unmount());
});
