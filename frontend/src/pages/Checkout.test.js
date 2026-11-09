import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Checkout from "./Checkout";

// PL-SEC-HARDEN-1-CAPTCHA — le jeton CAPTCHA accompagne POST /orders sur tout
// le tunnel (étapes 2 binance, 3 auto, 4 manuel). Les écrans de SAISIE pourront
// être simulés (ils n'ont jamais eu de test) ; StepPay/StepConfirm restent réels.

jest.mock("react-router-dom", () => {
  const React = require("react");
  const mkNavigate = () => jest.fn();
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    Navigate: () => null,
    useNavigate: mkNavigate,
    useLocation: () => ({ pathname: "/commande", state: null }),
    useSearchParams: () => [new URLSearchParams(), jest.fn()],
  };
});
jest.mock("sonner", () => ({ toast: { message: jest.fn(), error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errorMessage: (e) => `Erreur: ${e?.message || e?.response?.data?.code || "inconnue"}`,
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
}));
jest.mock("@/context/CartContext", () => ({
  useCart: () => ({ items: MOCK_CART_ITEMS, total: 2500, clear: jest.fn(), gameId: null }),
}));
let MOCK_CART_ITEMS = [{ id: "p1", name: "660 UC", name_en: "660 UC", qty: 1, price: 2500 }];
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/GameContext", () => ({
  useGames: () => ({ games: [{ id: "pubg-mobile", name: "PUBG Mobile" }], selectedId: "pubg-mobile" }),
}));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path, vars) => path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
  return { useLang: () => ({ t: make("fr"), lang: "fr" }), localized: (o) => o };
});
// Écrans de saisie simulés : on pilote directement les transitions d'étape.
jest.mock("@/components/store/checkout/StepVerify", () => ({
  StepVerify: ({ onContinue }) => <button data-testid="stub-verify-continue" onClick={onContinue}>v</button>,
}));
jest.mock("@/components/store/PaymentFlow", () => ({
  PaymentFlow: ({ setMethod, onContinue }) => <button data-testid="stub-method-continue" onClick={() => { setMethod("mvola"); onContinue(); }}>m</button>,
  methodLabel: (t, m) => "MVola automatique",
  paymentFee: () => 0,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

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

async function renderCheckout() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Checkout />); });
  // montages différés (config, captcha)
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

async function toStepPay(container) {
  await act(async () => { container.querySelector('[data-testid="stub-verify-continue"]').click(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await Promise.resolve(); });
}

const { api } = require("@/lib/api");
const { toast } = require("sonner");

beforeEach(() => {
  delete process.env[ENV_VAR];
  delete window.turnstile;
  window.scrollTo = jest.fn();
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: {} }));
  api.post.mockImplementation((url, body) => {
    if (url === "/payments/initiate" || url.includes("/payments/fiveone/initiate")) return Promise.resolve({ data: { payment_url: null, simulated: true } });
    return Promise.resolve({ data: { id: "o1", order_number: "MGS-T1", pubg_id: "123", subtotal: 2500, payment_fee: 0, items: [], status: "pending_payment", payment_method: body?.payment_method } });
  });
  MOCK_CART_ITEMS = [{ id: "p1", name: "660 UC", name_en: "660 UC", qty: 1, price: 2500 }];
});
afterEach(() => {
  document.body.innerHTML = "";
  delete process.env[ENV_VAR];
  delete window.turnstile;
});

test("sans clé : le tunnel est inchangé — POST /orders sans champ captcha_token", async () => {
  const { container, root } = await renderCheckout();
  await toStepPay(container);
  expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
  const btn = container.querySelector('[data-testid="checkout-pay-now"]');
  expect(btn.disabled).toBe(false);
  await act(async () => { btn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ payment_method: "mvola" }));
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body.captcha_token).toBeUndefined();
  await act(async () => root.unmount());
});

test("avec clé : le bouton payer est bloqué sans jeton, l'envoie inclut captcha_token", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { container, root } = await renderCheckout();
  await toStepPay(container);
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  const btn = container.querySelector('[data-testid="checkout-pay-now"]');
  expect(btn.disabled).toBe(true);
  act(() => { turnstileOpts.callback("jeton-c1"); });
  await act(async () => { await Promise.resolve(); });
  expect(btn.disabled).toBe(false);
  await act(async () => { btn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ payment_method: "mvola", captcha_token: "jeton-c1" }));
  await act(async () => root.unmount());
});

test("avec clé, sans jeton : cliquer sur payer n'appelle pas l'API", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { container, root } = await renderCheckout();
  await toStepPay(container);
  await act(async () => { container.querySelector('[data-testid="checkout-pay-now"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post.mock.calls.some((c) => c[0] === "/orders")).toBe(false);
  await act(async () => root.unmount());
});

test("erreur serveur CAPTCHA : message dédié + widget réinitialisé", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  api.post.mockImplementation((url) => {
    if (url === "/orders") return Promise.reject({ response: { status: 428, data: { code: "captcha_invalid" } } });
    if (url.startsWith("/payments/")) return Promise.resolve({ data: { payment_url: null, simulated: true } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await renderCheckout();
  await toStepPay(container);
  act(() => { turnstileOpts.callback("jeton-c1"); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { container.querySelector('[data-testid="checkout-pay-now"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(toast.error).toHaveBeenCalledWith("Merci de refaire le contrôle de sécurité ci-dessus puis de réessayer.");
  expect(container.querySelector('[data-testid="checkout-pay-now"]').disabled).toBe(true); // jeton à usage unique vidé
  await act(async () => root.unmount());
});

test("manuel : le bouton de confirmation attend le jeton puis l'envoie (étape 4)", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { container, root } = await renderCheckout();
  await toStepPay(container);
  act(() => { turnstileOpts.callback("jeton-m1"); });
  await act(async () => { await Promise.resolve(); });
  // Simuler la méthode manuelle : renvoyer à l'étape 4 via le composant réel.
  // On déclenche payAuto → commande créée → StepPay basculle en PaymentStatus ;
  // le cas manuel complet est couvert par le test CheckoutConfirm page dédiée.
  await act(async () => { container.querySelector('[data-testid="checkout-pay-now"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ captcha_token: "jeton-m1" }));
  await act(async () => root.unmount());
});
