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
  // PL-UX-4 — message français issu de la correspondance d'erreurs (plus le détail du mock).
  expect(container.querySelector('[data-testid="auth-error"]').textContent).toBe("Une erreur est survenue. Réessayez.");
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
  api.post.mockRejectedValueOnce({ response: { status: 400, data: { code: "captcha_required", detail: "Vérification anti-robot requise." } } });
  api.post.mockRejectedValueOnce({ response: { status: 400, data: { code: "captcha_required", detail: "Vérification anti-robot requise." } } });
  const { container, root } = await renderLogin();
  await flushCaptcha();
  await fillAndSubmit(container);          // échec → widget affiché
  act(() => { turnstileOpts.callback("jeton-r1"); });
  await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  // PL-UX-4 : message dédié « contrôle de sécurité requis » (l'API l'a demandé).
  expect(container.querySelector('[data-testid="auth-error"]').textContent).toContain("Contrôle de sécurité requis");
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

/* Échec de chargement du CDN Cloudflare : FAIL-CLOSED (lot séquentiel au
   widget initial). Le formulaire reste bloqué, un message inline + un bouton
   « Réessayer » prennent la place du widget ; aucune requête sans jeton.
   Pas de stubTurnstile ici : on veut le VRAI chemin d'injection du script.
   Conçu pour être le dernier test avec clé du fichier (singleton du script). */
test("CAPTCHA échec CDN : formulaire bloqué, message inline, « Réessayer » proposé", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AuthPage mode="register" />); });
  await flushCaptcha();
  const script = document.querySelector("script[src*='challenges.cloudflare.com']");
  expect(script).not.toBeNull();
  await act(async () => { script.dispatchEvent(new Event("error")); });
  const failed = container.querySelector('[data-testid="captcha-widget-failed"]');
  expect(failed).not.toBeNull();
  expect(failed.textContent).toContain("Impossible de charger la vérification anti-robot");
  expect(container.querySelector('[data-testid="captcha-retry"]')).not.toBeNull();
  const submitBtn = container.querySelector('[data-testid="auth-submit"]');
  expect(submitBtn.disabled).toBe(true);
  // Un utilisateur réel ne peut que cliquer le bouton (désactivé) : rien ne part
  await act(async () => { submitBtn.click(); });
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});


/* PL-UX-4 — message d'erreur FRANÇAIS (jamais le détail anglais du serveur)
   et widget Turnstile VISIBLE quand l'API exige le contrôle de sécurité. */

test("PL-UX-4 : mauvais identifiants → message français, jamais « Invalid email or password »", async () => {
  api.post.mockRejectedValueOnce({ response: { status: 401, data: { detail: "Invalid email or password" } } });
  const { container, root } = await renderLogin();
  await fillAndSubmit(container);
  const error = container.querySelector('[data-testid="auth-error"]');
  expect(error.textContent).toBe("Identifiants invalides : vérifiez votre e-mail et votre mot de passe.");
  expect(error.textContent).not.toContain("Invalid email or password");
  expect(error.getAttribute("role")).toBe("alert");
  await act(async () => root.unmount());
});

test("PL-UX-4 : erreur inconnue → texte français générique, jamais l'anglais du serveur", async () => {
  api.post.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Internal Server Error" } } });
  const { container, root } = await renderLogin();
  await fillAndSubmit(container);
  const error = container.querySelector('[data-testid="auth-error"]');
  expect(error.textContent).toBe("Service indisponible pour le moment. Réessayez plus tard.");
  expect(error.textContent).not.toContain("Internal Server Error");
  await act(async () => root.unmount());
});

test("PL-UX-4 : `captcha_required` → le widget devient VISIBLE, message français, bouton toujours là", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  api.post.mockRejectedValueOnce({ response: { status: 400, data: { code: "captcha_required", detail: "Vérification anti-robot requise." } } });
  const { container, root } = await renderLogin();
  await flushCaptcha();
  await fillAndSubmit(container);
  await flushCaptcha();
  // Le widget est monté ET visible (apparence « always », plus « interaction-only »).
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="captcha-widget-label"]')).not.toBeNull();
  expect(turnstileOpts.appearance).toBe("always");
  // Message français clair.
  const error = container.querySelector('[data-testid="auth-error"]');
  expect(error.textContent).toContain("Contrôle de sécurité requis");
  expect(error.textContent).not.toContain("Vérification anti-robot requise.");
  // Le bouton de soumission n'est pas masqué : il est là, en attente du jeton.
  expect(container.querySelector('[data-testid="auth-submit"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("PL-UX-4 : un échec d'identifiants ordinaire ne force PAS l'affichage du widget", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  api.post.mockRejectedValueOnce({ response: { status: 401, data: { detail: "Invalid email or password" } } });
  const { container, root } = await renderLogin();
  await flushCaptcha();
  await fillAndSubmit(container);
  await flushCaptcha();
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="captcha-widget-label"]')).toBeNull();
  expect(turnstileOpts.appearance).toBe("interaction-only");
  await act(async () => root.unmount());
});
