import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Checkout from "./Checkout";

// PL-CHK-2 — la commande est créée À LA FIN DE L'ÉTAPE 2 (Méthode) pour toutes
// les méthodes, sans `manual_reference`, avec le captcha SEC-HARDEN ; un
// rechargement retrouve la commande en attente via sessionStorage. Les écrans
// de saisie sont simulés ; StepPay/ProofPay restent réels.

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
  PaymentFlow: ({ setMethod, setPhone, onContinue, busy }) => (
    <>
      <button data-testid="stub-method-pick" onClick={() => setMethod("mvola")}>pick-m</button>
      <button data-testid="stub-orange-pick" onClick={() => setMethod("orange")}>pick-o</button>
      <button data-testid="stub-manual-pick" onClick={() => setMethod("manual")}>pick-mf</button>
      <button data-testid="stub-binance-pick" onClick={() => setMethod("binance")}>pick-b</button>
      <button data-testid="stub-phone-set" onClick={() => setPhone("0341234567")}>phone</button>
      <button data-testid="stub-method-continue" disabled={busy} onClick={onContinue}>m</button>
    </>
  ),
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

// Commande « créée » renvoyée par POST /orders — le contrat PL-CHK-2 contient
// toujours le délai et la liste des preuves.
const mkOrder = (over = {}) => ({
  id: "o1", order_number: "MGS-T1", pubg_id: "123", subtotal: 2500, payment_fee: 0,
  items: [{ product_id: "p1", name: "660 UC", quantity: 1 }], status: "pending_payment",
  payment_method: "manual", payment_deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
  payment_proofs: [], ...over,
});

async function renderCheckout() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Checkout />); });
  // montages différés (config, captcha, reprise éventuelle)
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

async function toStepMethod(container) {
  await act(async () => { container.querySelector('[data-testid="stub-verify-continue"]').click(); });
  await act(async () => { await Promise.resolve(); });
}

const pick = async (container, testid) => {
  await act(async () => { container.querySelector(`[data-testid="${testid}"]`).click(); });
  await act(async () => { await Promise.resolve(); });
};

const { api } = require("@/lib/api");
const { toast } = require("sonner");

beforeEach(() => {
  delete process.env[ENV_VAR];
  delete window.turnstile;
  window.scrollTo = jest.fn();
  sessionStorage.clear();
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: {} }));
  api.post.mockImplementation((url, body) => {
    if (url === "/orders") return Promise.resolve({ data: mkOrder({ payment_method: body?.payment_method }) });
    if (url === "/payments/initiate" || url.includes("/payments/fiveone/initiate")) return Promise.resolve({ data: { payment_url: null, simulated: true } });
    if (url.startsWith("/crypto/")) return Promise.resolve({ data: { payment: null } });
    return Promise.resolve({ data: {} });
  });
  MOCK_CART_ITEMS = [{ id: "p1", name: "660 UC", name_en: "660 UC", qty: 1, price: 2500 }];
});
afterEach(() => {
  document.body.innerHTML = "";
  delete process.env[ENV_VAR];
  delete window.turnstile;
});

test("sans clé : la commande est créée à la fin de l'étape 2, sans champ captcha_token", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-method-pick");
  expect(api.post.mock.calls.some((c) => c[0] === "/orders")).toBe(false); // rien à l'étape 1
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const call = api.post.mock.calls.find((c) => c[0] === "/orders");
  expect(call[1].payment_method).toBe("mvola");
  expect(call[1].captcha_token).toBeUndefined(); // clé absente → champ omis
  expect(call[1].manual_reference).toBeUndefined();
  // PL-CHK-3 : la commande créée est mémorisée localement — { id, createdAt }
  // UNIQUEMENT (jamais de téléphone, nom ou autre donnée personnelle).
  const stored = JSON.parse(global.localStorage.getItem("mgs_pending_order_id"));
  expect(Object.keys(stored).sort()).toEqual(["createdAt", "id"]);
  expect(stored).toEqual({ id: "o1", createdAt: expect.any(String) });
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).not.toBeNull(); // écran Paiement
  // Le pay-now de l'étape 3 ne recrée PAS de commande.
  const count = api.post.mock.calls.filter((c) => c[0] === "/orders").length;
  await act(async () => { container.querySelector('[data-testid="checkout-pay-now"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post.mock.calls.filter((c) => c[0] === "/orders").length).toBe(count);
  expect(api.post.mock.calls.some((c) => c[0] === "/payments/initiate")).toBe(true);
  await act(async () => root.unmount());
});

test("manuel : création à l'étape 2 (step 3 = preuve), le payload n'a plus de manual_reference", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-manual-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ payment_method: "manual" }));
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body.manual_reference).toBeUndefined();
  // PL-CHK-2-FIX1 : le téléphone client n'existe pas pour le manuel (la
  // preuve passe par l'USSD marchand) — jamais de champ vide dans le payload.
  expect(body.payment_phone).toBeUndefined();
  expect(body.payment_method).toBe("manual");
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).not.toBeNull(); // écran Paiement (preuve)
  expect(container.querySelector('[data-testid="proof-drop-zone"]')).not.toBeNull();
  // Aucun champ de référence texte ne doit subsister.
  expect(container.querySelector('[data-testid="manual-reference"]')).toBeNull();
  await act(async () => root.unmount());
});

// PL-CHK-2-FIX1 — payload réellement posté à l'étape 2, pour chaque méthode.
// Tout numéro saisi part tel quel ; une méthode sans numéro (manuel, binance)
// n'embarque JAMAIS de téléphone, et les méthodes auto ne l'envoient pas vide.
test("MVola : le numéro à débiter saisi à l'étape 2 part dans le payload", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-phone-set");
  await pick(container, "stub-method-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body).toEqual(expect.objectContaining({ payment_method: "mvola", payment_phone: "0341234567" }));
  await act(async () => root.unmount());
});

test("Orange : le numéro à débiter part dans le payload", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-phone-set");
  await pick(container, "stub-orange-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body).toEqual(expect.objectContaining({ payment_method: "orange", payment_phone: "0341234567" }));
  await act(async () => root.unmount());
});

test("Binance : aucun téléphone dans le payload + initiation crypto", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-binance-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body.manual_reference).toBeUndefined();
  expect(body.payment_phone).toBeUndefined();
  expect(api.post.mock.calls.some((c) => c[0] === "/crypto/initiate")).toBe(true);
  await act(async () => root.unmount());
});

test("auto sans numéro saisi : le téléphone est omis (jamais envoyé vide)", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-orange-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
  expect(body.payment_method).toBe("orange");
  expect(body.payment_phone).toBeUndefined(); // pas ""
  await act(async () => root.unmount());
});

// PL-CHK-2-FIX1 — les 422 Pydantic sont affichées en français lisible.
test("422 « Invalid phone number » : message FR lisible + on reste à l'étape 2", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/orders") return Promise.reject({ response: { status: 422, data: { detail: [{ loc: ["body", "payment_phone"], msg: "Value error, Invalid phone number", type: "value_error" }] } } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-binance-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(toast.error).toHaveBeenCalledWith("Numéro à débiter invalide : vérifiez le numéro (10 chiffres).");
  expect(container.querySelector('[data-testid="checkout-screen-2"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).toBeNull();
  await act(async () => root.unmount());
});

test("422 sur un autre champ : message générique lisible (pas le texte technique)", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/orders") return Promise.reject({ response: { status: 422, data: { detail: [{ loc: ["body", "pseudo"], msg: "Value error, too short", type: "value_error" }] } } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-method-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(toast.error).toHaveBeenCalledWith("Impossible de créer la commande : vérifiez les informations saisies puis réessayez.");
  expect(container.querySelector('[data-testid="checkout-screen-2"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("double-clic à l'étape 2 : un seul POST /orders", async () => {
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-method-pick");
  await act(async () => {
    const btn = container.querySelector('[data-testid="stub-method-continue"]');
    btn.click(); btn.click(); btn.click();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(api.post.mock.calls.filter((c) => c[0] === "/orders").length).toBe(1);
  await act(async () => root.unmount());
});

test("erreur à la création : message + on reste à l'étape 2", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/orders") return Promise.reject({ message: "boom", response: { status: 500, data: {} } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-method-pick");
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(toast.error).toHaveBeenCalled();
  // On reste à l'écran Méthode (screen-2) : pas d'écran de paiement (screen-3).
  expect(container.querySelector('[data-testid="checkout-screen-2"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).toBeNull();
  await act(async () => root.unmount());
});

test("avec clé : la création attend le jeton puis l'envoie avec captcha_token", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-method-pick");
  expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post.mock.calls.some((c) => c[0] === "/orders")).toBe(false); // sans jeton : rien
  act(() => { turnstileOpts.callback("jeton-c1"); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ payment_method: "mvola", captcha_token: "jeton-c1" }));
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).not.toBeNull(); // écran Paiement
  await act(async () => root.unmount());
});

test("erreur CAPTCHA à la création : message dédié + on reste à l'étape 2", async () => {
  process.env[ENV_VAR] = TEST_KEY;
  stubTurnstile();
  api.post.mockImplementation((url) => {
    if (url === "/orders") return Promise.reject({ response: { status: 400, data: { code: "captcha_required", detail: "Vérification anti-robot requise." } } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await renderCheckout();
  await toStepMethod(container);
  await pick(container, "stub-method-pick");
  act(() => { turnstileOpts.callback("jeton-c1"); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { container.querySelector('[data-testid="stub-method-continue"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(toast.error).toHaveBeenCalledWith("Merci de refaire le contrôle de sécurité ci-dessus puis de réessayer.");
  expect(container.querySelector('[data-testid="checkout-screen-2"]')).not.toBeNull(); // reste Méthode
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).toBeNull();
  await act(async () => root.unmount());
});

test("recharge : la commande en attente est retrouvée (étape 3, preuve), pas recréée", async () => {
  const pending = mkOrder({ id: "o-reprise", order_number: "MGS-R1", payment_method: "manual" });
  sessionStorage.setItem("mgs_pending_order", JSON.stringify({ id: pending.id, order_number: pending.order_number, pubg_id: pending.pubg_id, method: "manual" }));
  api.get.mockImplementation((url) => (url === `/orders/${pending.id}` ? Promise.resolve({ data: pending }) : Promise.resolve({ data: {} })));
  const { container, root } = await renderCheckout();
  expect(container.querySelector('[data-testid="checkout-screen-3"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="proof-drop-zone"]')).not.toBeNull();
  expect(api.post.mock.calls.some((c) => c[0] === "/orders")).toBe(false);
  // La clé de reprise existe encore (statut non terminal).
  expect(sessionStorage.getItem("mgs_pending_order")).not.toBeNull();
  await act(async () => root.unmount());
});
