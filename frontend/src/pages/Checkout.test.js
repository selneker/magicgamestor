import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Checkout from "./Checkout";

// PL-CHK-4 — écran 1 « Commande » : une seule étape, méthodes en lignes
// (MVola manuel / Orange Money manuel / Binance USDT — uniquement les méthodes
// réellement actives), remarque courte par méthode, CTA désactivé tant que
// l'ID joueur n'est pas vérifié, payload par méthode avec `manual_operator`
// (jamais de manual_reference, jamais de téléphone vide), redirection vers
// /orders/:id. La vérification d'identité est simulée (le contrat réel est
// couvert par IdentityFieldsVerify.test.js).

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    Navigate: () => null,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/commande", state: null }),
    useSearchParams: () => [new URLSearchParams(), jest.fn()],
  };
});
const mockNavigate = jest.fn();
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
  useGames: () => ({ games: [{ id: "pubg-mobile", name: "PUBG Mobile", identity_fields: [{ key: "player_id", primary: true, label: "ID joueur" }] }], selectedId: "pubg-mobile" }),
}));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path, vars) => {
    let v = path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]);
    if (typeof v !== "string") return path;
    return v.replace(/\{(\w+)\}/g, (_, k) => (vars?.[k] !== undefined ? vars[k] : `{${k}}`));
  };
  return { useLang: () => ({ t: make("fr"), lang: "fr" }), localized: (o) => o };
});
// Vérification d'identité simulée : un clic remplit les champs puis « vérifie »
// après un cycle (comme le vrai flux IdentityFieldsVerify : le verdict arrive
// APRÈS le re-render des champs — jamais dans le même tick).
jest.mock("@/components/store/checkout/IdentityFieldsVerify", () => ({
  IdentityFieldsVerify: ({ onVerified, setValues }) => (
    <button data-testid="stub-verify" onClick={() => {
      setValues({ player_id: "123456789" });
      setTimeout(() => onVerified({ name: "Joueur", region: null, fields: { player_id: "123456789" } }), 0);
    }}>v</button>
  ),
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

const mkOrder = (over = {}) => ({
  id: "o1", order_number: "MGS-T1", pubg_id: "123456789", subtotal: 2500, payment_fee: 0,
  items: [{ product_id: "p1", name: "660 UC", quantity: 1 }], status: "pending_payment",
  payment_method: "manual", manual_operator: "mvola", created_at: new Date().toISOString(),
  payment_deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
  payment_proofs: [], ...over,
});

const CONFIG_ACTIVE = {
  providers: { mvola: { configured: true }, orange: { configured: true } },
  payment_fees: {},
};
const CONFIG_NO_ORANGE = {
  providers: { mvola: { configured: true }, orange: { configured: false } },
  payment_fees: {},
};
const CRYPTO_ON = { available: true, networks: [{ key: "BSC", label: "BNB Smart Chain" }] };

async function renderCheckout() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Checkout />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

const verify = async (container) => {
  await act(async () => { container.querySelector('[data-testid="stub-verify"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); // verdict différé d'un cycle
};

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
  localStorage.clear();
  mockNavigate.mockClear();
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/payments/config") return Promise.resolve({ data: CONFIG_ACTIVE });
    if (url === "/crypto/config") return Promise.resolve({ data: CRYPTO_ON });
    return Promise.resolve({ data: {} });
  });
  api.post.mockImplementation((url, body) => {
    if (url === "/orders") return Promise.resolve({ data: mkOrder({ payment_method: body?.payment_method, manual_operator: body?.manual_operator }) });
    if (url === "/crypto/initiate") return Promise.resolve({ data: { payment: { status: "NEW" } } });
    return Promise.resolve({ data: {} });
  });
  MOCK_CART_ITEMS = [{ id: "p1", name: "660 UC", name_en: "660 UC", qty: 1, price: 2500 }];
});
afterEach(() => {
  document.body.innerHTML = "";
  delete process.env[ENV_VAR];
  delete window.turnstile;
});

describe("écran 1 — méthodes actives et remarque", () => {
  test("les trois méthodes actives s'affichent en lignes séparées", async () => {
    const { container, root } = await renderCheckout();
    expect(container.querySelector('[data-testid="method-mvola"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="method-orange"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="method-binance"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="payment-methods"] > *').length).toBe(3);
    await act(async () => root.unmount());
  });

  test("une méthode désactivée par la config n'est JAMAIS affichée", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/payments/config") return Promise.resolve({ data: CONFIG_NO_ORANGE });
      if (url === "/crypto/config") return Promise.resolve({ data: { available: false } });
      return Promise.resolve({ data: {} });
    });
    const { container, root } = await renderCheckout();
    expect(container.querySelector('[data-testid="method-mvola"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="method-orange"]')).toBeNull();
    expect(container.querySelector('[data-testid="method-binance"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("une remarque courte par méthode (une seule affichée à la fois)", async () => {
    const { container, root } = await renderCheckout();
    expect(container.querySelector('[data-testid="checkout-remark"]')).toBeNull(); // rien sans méthode
    await verify(container);
    await pick(container, "method-mvola");
    expect(container.querySelector('[data-testid="checkout-remark"]').textContent)
      .toContain("Envoyez le montant exact via MVola");
    await pick(container, "method-orange");
    expect(container.querySelector('[data-testid="checkout-remark"]').textContent)
      .toContain("Envoyez le montant exact via Orange Money");
    await pick(container, "method-binance");
    expect(container.querySelector('[data-testid="checkout-remark"]').textContent)
      .toContain("montant USDT exact");
    expect(container.querySelectorAll('[data-testid="checkout-remark"]').length).toBe(1);
    await act(async () => root.unmount());
  });

  test("Binance : le choix du réseau s'affiche dans la ligne sélectionnée", async () => {
    const { container, root } = await renderCheckout();
    await verify(container);
    expect(container.querySelector('[data-testid="payment-expanded-binance"]')).toBeNull();
    await pick(container, "method-binance");
    expect(container.querySelector('[data-testid="payment-expanded-binance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="binance-network-BSC"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("ID vérifié : ID et pseudo sur deux lignes distinctes + coche", async () => {
    const { container, root } = await renderCheckout();
    await verify(container);
    const ok = container.querySelector('[data-testid="checkout-player-ok"]');
    expect(ok).not.toBeNull();
    expect(ok.querySelector('[data-testid="checkout-player-pseudo"]').textContent).toBe("Joueur");
    expect(container.querySelector('[data-testid="checkout-player-id"]').textContent).toBe("123456789");
    expect(container.querySelector('[data-testid="checkout-change-id"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});

describe("écran 1 — CTA et création", () => {
  test("le CTA est désactivé tant que l'ID n'est pas vérifié ou sans méthode", async () => {
    const { container, root } = await renderCheckout();
    const btn = () => container.querySelector('[data-testid="checkout-submit"]');
    expect(btn().disabled).toBe(true); // ni vérifié ni méthode
    await verify(container);
    expect(btn().disabled).toBe(true); // vérifié mais sans méthode
    await pick(container, "method-mvola");
    expect(btn().disabled).toBe(false);
    await act(async () => root.unmount());
  });

  test("Binance sans réseau : CTA désactivé ; réseau choisi : actif", async () => {
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-binance");
    expect(container.querySelector('[data-testid="checkout-submit"]').disabled).toBe(true);
    await pick(container, "binance-network-BSC");
    expect(container.querySelector('[data-testid="checkout-submit"]').disabled).toBe(false);
    await act(async () => root.unmount());
  });

  test.each([
    ["mvola", "method-mvola"],
    ["orange", "method-orange"],
  ])("MVola/Orange manuels : payload payment_method=manual + manual_operator=%s, jamais de téléphone ni de manual_reference", async (op, testid) => {
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, testid);
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const call = api.post.mock.calls.find((c) => c[0] === "/orders");
    expect(call[1]).toEqual(expect.objectContaining({ payment_method: "manual", manual_operator: op }));
    expect(call[1].payment_phone).toBeUndefined(); // jamais de téléphone vide
    expect(call[1].manual_reference).toBeUndefined();
    // PL-CHK-3 : mémorisation minimale { id, createdAt }.
    const stored = JSON.parse(localStorage.getItem("mgs_pending_order_id"));
    expect(Object.keys(stored).sort()).toEqual(["createdAt", "id"]);
    // Redirection vers l'écran de paiement (remplacement d'historique).
    expect(mockNavigate).toHaveBeenCalledWith("/orders/o1", { replace: true });
    await act(async () => root.unmount());
  });

  test("Binance : payload payment_method=binance + initiation USDT, redirection", async () => {
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-binance");
    await pick(container, "binance-network-BSC");
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const call = api.post.mock.calls.find((c) => c[0] === "/orders");
    expect(call[1].payment_method).toBe("binance");
    expect(call[1].manual_operator).toBeUndefined();
    expect(call[1].payment_phone).toBeUndefined();
    expect(call[1].manual_reference).toBeUndefined();
    expect(api.post.mock.calls.some((c) => c[0] === "/crypto/initiate")).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith("/orders/o1", { replace: true });
    await act(async () => root.unmount());
  });

  test("double-clic : un seul POST /orders", async () => {
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    await act(async () => {
      const btn = container.querySelector('[data-testid="checkout-submit"]');
      btn.click(); btn.click(); btn.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.post.mock.calls.filter((c) => c[0] === "/orders").length).toBe(1);
    await act(async () => root.unmount());
  });

  test("422 sur payment_phone : message FR lisible, on reste à l'écran 1", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/orders") return Promise.reject({ response: { status: 422, data: { detail: [{ loc: ["body", "payment_phone"], msg: "Value error, Invalid phone number", type: "value_error" }] } } });
      return Promise.resolve({ data: {} });
    });
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(toast.error).toHaveBeenCalledWith("Numéro à débiter invalide : vérifiez le numéro (10 chiffres).");
    expect(container.querySelector('[data-testid="checkout-form"]')).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("422 sur un autre champ : message générique lisible (pas le texte technique)", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/orders") return Promise.reject({ response: { status: 422, data: { detail: [{ loc: ["body", "pseudo"], msg: "Value error, too short", type: "value_error" }] } } });
      return Promise.resolve({ data: {} });
    });
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(toast.error).toHaveBeenCalledWith("Impossible de créer la commande : vérifiez les informations saisies puis réessayez.");
    await act(async () => root.unmount());
  });

  test("erreur CAPTCHA à la création : message dédié + on reste à l'écran 1", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    api.post.mockImplementation((url) => {
      if (url === "/orders") return Promise.reject({ response: { status: 400, data: { code: "captcha_required", detail: "Vérification anti-robot requise." } } });
      return Promise.resolve({ data: {} });
    });
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    // CTA sans jeton : la feuille « Vérification de sécurité » s'ouvre (Radix
    // portalisé dans document.body), la création est armée (pendingSubmit) ;
    // le jeton déclenche l'envoi.
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="captcha-sheet"]').className).not.toContain("invisible");
    act(() => { turnstileOpts.callback("jeton-c1"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(toast.error).toHaveBeenCalledWith("Merci de refaire le contrôle de sécurité ci-dessus puis de réessayer.");
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

describe("écran 1 — CAPTCHA (écran 9)", () => {
  test("sans clé : aucune feuille de vérification, payload sans captcha_token", async () => {
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.querySelector('[data-testid="captcha-sheet"]')).toBeNull();
    const body = api.post.mock.calls.find((c) => c[0] === "/orders")[1];
    expect(body.captcha_token).toBeUndefined();
    await act(async () => root.unmount());
  });

  test("avec clé : le CTA ouvre la feuille « Vérification de sécurité », le jeton crée la commande", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await Promise.resolve(); });
    // Feuille Radix portalisée dans document.body (coquille partagée PL-CHK-5).
    const sheet = document.querySelector('[data-testid="captcha-sheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet.className).not.toContain("invisible"); // feuille ouverte = visible
    expect(document.querySelector('[data-testid="captcha-sheet-title"]').textContent)
      .toBe("Vérification de sécurité");
    expect(api.post.mock.calls.some((c) => c[0] === "/orders")).toBe(false);
    act(() => { turnstileOpts.callback("jeton-c9"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.post).toHaveBeenCalledWith("/orders", expect.objectContaining({ captcha_token: "jeton-c9" }));
    expect(mockNavigate).toHaveBeenCalledWith("/orders/o1", { replace: true });
    await act(async () => root.unmount());
  });

  test("Cloudflare demande une action : before-interactive-callback ouvre la feuille", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    // CTA sans jeton : la feuille est TOUJOURS montée (widget invisible dedans)
    // mais fermée ; l'ouverture arme la création (pendingSubmit). Radix
    // portalisé dans document.body.
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await Promise.resolve(); });
    const sheet = () => document.querySelector('[data-testid="captcha-sheet"]');
    expect(sheet()).not.toBeNull();
    expect(sheet().className).not.toContain("invisible");
    act(() => { turnstileOpts["before-interactive-callback"](); });
    expect(sheet().className).not.toContain("invisible");
    act(() => { turnstileOpts.callback("jeton-c10"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.post.mock.calls.some((c) => c[0] === "/orders")).toBe(true);
    await act(async () => root.unmount());
  });
});

describe("PL-CHK-6 — le tunnel n'impose jamais une commande en attente", () => {
  test("commande en attente mémorisée : AUCUN appel /orders/{id}, AUCUNE redirection — l'écran 1 reste utilisable", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o-reprise", createdAt: new Date().toISOString() }));
    const { container, root } = await renderCheckout();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.get.mock.calls.some(([u]) => u.startsWith("/orders/"))).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="checkout-form"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("commande mémorisée invalide (manuelle sans opérateur) : l'écran 1 reste utilisable, aucune lecture API", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o-invalide", createdAt: new Date().toISOString() }));
    api.get.mockImplementation((url) => {
      if (url === "/payments/config") return Promise.resolve({ data: CONFIG_ACTIVE });
      if (url === "/crypto/config") return Promise.resolve({ data: CRYPTO_ON });
      if (url === "/orders/o-invalide") return Promise.resolve({ data: mkOrder({ id: "o-invalide", manual_operator: null }) });
      return Promise.resolve({ data: {} });
    });
    const { container, root } = await renderCheckout();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.get.mock.calls.some(([u]) => u.startsWith("/orders/"))).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="checkout-form"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("création réussie : la clé est REMPLACÉE (l'ancienne commande mémorisée est écrasée)", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o-ancienne", createdAt: new Date().toISOString() }));
    const { container, root } = await renderCheckout();
    await verify(container);
    await pick(container, "method-mvola");
    await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const stored = JSON.parse(localStorage.getItem("mgs_pending_order_id"));
    expect(stored.id).toBe("o1"); // plus jamais "o-ancienne"
    expect(mockNavigate).toHaveBeenCalledWith("/orders/o1", { replace: true });
    await act(async () => root.unmount());
  });

  test("panier vide + commande mémorisée : écran « panier vide », jamais de redirection (la bannière offre la commande)", async () => {
    MOCK_CART_ITEMS = [];
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o-reprise", createdAt: new Date().toISOString() }));
    const { container, root } = await renderCheckout();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector('[data-testid="checkout-empty"]')).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("stockage indisponible : l'écran 1 fonctionne et la création réussit (clé ignorée en silence)", async () => {
    const saved = { getItem: Storage.prototype.getItem, setItem: Storage.prototype.setItem, removeItem: Storage.prototype.removeItem };
    const boom = () => { throw new Error("SecurityError"); };
    Object.assign(Storage.prototype, { getItem: boom, setItem: boom, removeItem: boom });
    try {
      const { container, root } = await renderCheckout();
      await verify(container);
      await pick(container, "method-mvola");
      await act(async () => { container.querySelector('[data-testid="checkout-submit"]').click(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(mockNavigate).toHaveBeenCalledWith("/orders/o1", { replace: true });
      await act(async () => root.unmount());
    } finally {
      Object.assign(Storage.prototype, saved);
    }
  });
});
