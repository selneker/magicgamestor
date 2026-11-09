import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CheckoutConfirm from "./CheckoutConfirm";

// PL-SEC-HARDEN-1-CAPTCHA — la page /commande/confirmation crée aussi des
// commandes : même contrat captcha_token que le tunnel /commande.

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    Navigate: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: "/commande/confirmation", state: MOCK_CTX }),
    useSearchParams: () => [new URLSearchParams(), jest.fn()],
  };
});
let MOCK_CTX = { method: "mvola", pubgId: "123456789", phone: "0340000001", email: "", verified: { name: "Joueur" }, reference: { provider: "mvola", value: "" } };
jest.mock("sonner", () => ({ toast: { message: jest.fn(), error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errorMessage: (e) => `Erreur: ${e?.message || e?.response?.data?.code || "inconnue"}`,
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
}));
jest.mock("@/context/CartContext", () => ({
  useCart: () => ({ items: [{ id: "p1", name: "660 UC", name_en: "660 UC", qty: 1 }], total: 2500, clear: jest.fn() }),
}));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path) => path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
  return { useLang: () => ({ t: make("fr"), lang: "fr" }), localized: (o) => o };
});

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

async function renderConfirm() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<CheckoutConfirm />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

const { api } = require("@/lib/api");

beforeEach(() => {
  delete process.env[ENV_VAR];
  delete window.turnstile;
  MOCK_CTX = { method: "mvola", pubgId: "123456789", phone: "0340000001", email: "", verified: { name: "Joueur" }, reference: { provider: "mvola", value: "" } };
  api.get.mockReset(); api.post.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockImplementation((url) => {
    if (url.startsWith("/payments/")) return Promise.resolve({ data: { payment_url: null, simulated: true } });
    return Promise.resolve({ data: { id: "o1", order_number: "MGS-R1", pubg_id: "123456789", subtotal: 2500, payment_fee: 0, items: [], status: "pending_payment" } });
  });
});
afterEach(() => {
  document.body.innerHTML = "";
  delete process.env[ENV_VAR];
  delete window.turnstile;
});

test("sans clé : envoi inchangé, sans champ captcha_token", async () => {
  const { container, root } = await renderConfirm();
  expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
  const btn = container.querySelector('[data-testid="confirm-and-pay-button"]');
  expect(btn.disabled).toBe(false);
  await act(async () => { btn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body.payment_method).toBe("mvola");
  expect(body.captcha_token).toBeUndefined();
  await act(async () => root.unmount());
});

test("avec clé : le bouton attend le jeton, l'envoi inclut captcha_token", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { container, root } = await renderConfirm();
  expect(container.querySelector('[data-testid="checkout-confirm-captcha"]')).not.toBeNull();
  const btn = container.querySelector('[data-testid="confirm-and-pay-button"]');
  expect(btn.disabled).toBe(true);
  act(() => { turnstileOpts.callback("jeton-cc1"); });
  await act(async () => { await Promise.resolve(); });
  expect(btn.disabled).toBe(false);
  await act(async () => { btn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ payment_method: "mvola", captcha_token: "jeton-cc1" }));
  await act(async () => root.unmount());
});
