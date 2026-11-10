import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OrderTrack, { OrderCard } from "./OrderTrack";

// PL-PAYLABEL-1 : le suivi client ne doit plus afficher « USSD » pour une
// commande binance (l'ancien ternaire imbriqué en repli) ni déformer les
// marques avec la classe `capitalize` (« Mvola », « Ussd »).
let mockTrackOrder = null;
let mockPayStatus = {};
// PL-CHK-3 — écran de reprise (/orders/:orderId) : paramètres de route et API.
let mockParams = null; // useParams forcé (ex. { orderId: "ord-uuid-1" })
let mockOrderGet = null; // GET /orders/{id}
let mockCryptoStatus = {}; // GET /crypto/{id}/status
let mockHistory = []; // GET /orders/me (connecté)
let mockUser = null; // useAuth().user
const mockPayConfig = { providers: { mvola: { merchant: "534341234" }, orange: { merchant: "534341234" } } };

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useParams: () => mockParams || { orderNumber: mockTrackOrder?.order_number || "" },
    useSearchParams: () => [new URLSearchParams(mockTrackOrder ? `pubg_id=${mockTrackOrder.pubg_id}` : ""), jest.fn()],
  };
});
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
  errorMessage: () => "erreur",
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key, vars) => {
      let s = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
      if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
      return s;
    },
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: [] }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const baseOrder = {
  order_number: "MGS-B1", status: "pending_payment", pubg_id: "123456789", pseudo: "Joueur",
  game_id: "pubg-mobile", items: [{ quantity: 1, name: "660 UC", line_total: 2500 }],
  created_at: "2026-11-07T10:00:00Z", total: 2500, payment_fee: 0,
};

beforeEach(() => {
  const { api } = require("@/lib/api");
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/orders/track")) return Promise.resolve({ data: mockTrackOrder });
    if (url.includes("/payments/") && url.endsWith("/status")) return Promise.resolve({ data: mockPayStatus });
    if (url === "/payments/config") return Promise.resolve({ data: mockPayConfig });
    if (url.startsWith("/crypto/") && url.endsWith("/status")) return Promise.resolve({ data: mockCryptoStatus });
    if (url === "/orders/me") return Promise.resolve({ data: mockHistory });
    if (url.startsWith("/orders/")) return Promise.resolve({ data: mockOrderGet }); // GET /orders/{id}
    return Promise.resolve({ data: [] });
  });
  mockTrackOrder = null;
  mockPayStatus = {};
  mockParams = null;
  mockOrderGet = null;
  mockCryptoStatus = {};
  mockHistory = [];
  mockUser = null;
});

afterEach(() => { document.body.innerHTML = ""; });

async function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

describe("OrderCard (carte de suivi)", () => {
  test.each([
    ["binance", "Binance USDT"],
    ["manual", "USSD"],
    ["mvola", "MVola"],
    ["orange", "Orange Money"],
    ["fiveone", "fiveone"],
  ])("méthode %s → libellé « %s »", async (method, expected) => {
    const { container, root } = await mount(<OrderCard order={{ ...baseOrder, payment_method: method }} />);
    expect(container.querySelector('[data-testid="order-card-MGS-B1"]').textContent).toContain(expected);
    // Plus de `capitalize` : les marques restent correctement casées.
    const span = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === expected);
    expect(span).toBeDefined();
    expect(span.className).not.toContain("capitalize");
    await act(async () => root.unmount());
  });

  test("méthode absente → « Autre », jamais « USSD » ni « Orange Money »", async () => {
    const { container, root } = await mount(<OrderCard order={{ ...baseOrder, payment_method: undefined }} />);
    const text = container.querySelector('[data-testid="order-card-MGS-B1"]').textContent;
    expect(text).toContain("Autre");
    expect(text).not.toContain("USSD");
    expect(text).not.toContain("Orange Money");
    await act(async () => root.unmount());
  });
});

// NOTE on the resume button colour: this jest environment drops ALL inline
// style props at render (even on plain elements — a React 19/jsdom quirk in
// this setup, pre-existing; no test in this repo asserts inline styles).
// The button's rendered colour is therefore verified in a real browser by
// scripts/capture-brand-paylabel.mjs (getComputedStyle on the resume button).
describe("Bouton « Reprendre le paiement » (page complète)", () => {
  test("commande binance en attente : le bouton de reprise se rend (couleur vérifiée en navigateur)", async () => {
    mockTrackOrder = { ...baseOrder, payment_method: "binance" };
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false, expires_at: "2026-11-07T10:15:00Z" };
    const { container, root } = await mount(<OrderTrack />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const btn = container.querySelector('[data-testid="resume-payment-button"]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Reprendre le paiement");
    await act(async () => root.unmount());
  });

  test("commande manual en attente : pas de bouton de reprise (flux USSD n'a pas d'URL de paiement)", async () => {
    mockTrackOrder = { ...baseOrder, payment_method: "manual" };
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false };
    const { container, root } = await mount(<OrderTrack />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // manual never polls (/payments status) — the button must not appear.
    expect(container.querySelector('[data-testid="resume-payment-button"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

// ------------------------------------------------- PL-CHK-3 — écran de reprise /orders/:id

const resumeOrder = (overrides = {}) => ({
  ...baseOrder, id: "ord-uuid-1", payment_deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(), ...overrides,
});

async function mountResume() {
  mockParams = { orderId: "ord-uuid-1" };
  return mount(<OrderTrack />);
}

describe("PL-CHK-3 — écran de reprise /orders/:id", () => {
  test("pending + manual : picker opérateur + ProofPay complet (USSD, montant, zone de preuve)", async () => {
    mockOrderGet = resumeOrder({ payment_method: "manual" });
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-resume"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-card-MGS-B1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="manual-provider-mvola"]').getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="ussd-code"]').textContent).toBe("#111*1*2*534341234*2500*1*0#");
    expect(container.querySelector('[data-testid="proof-drop-zone"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("reprise manual : changement d'opérateur met à jour le code USSD (non persisté côté API)", async () => {
    mockOrderGet = resumeOrder({ payment_method: "manual" });
    const { container, root } = await mountResume();
    await act(async () => { container.querySelector('[data-testid="manual-provider-orange"]').click(); });
    expect(container.querySelector('[data-testid="ussd-code"]').textContent).toBe("#144*1*1*534341234*534341234*2500*1#");
    await act(async () => root.unmount());
  });

  test("pending + auto (mvola) : compte à rebours + bouton de reprise, JAMAIS de zone de preuve", async () => {
    mockOrderGet = resumeOrder({ payment_method: "mvola" });
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false, expires_at: new Date(Date.now() + 20 * 60_000).toISOString() };
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="payment-countdown"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="resume-payment-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-drop-zone"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("pending + binance : slot rouvert via GET /crypto/{id}/status — JAMAIS de 2e initiation", async () => {
    mockOrderGet = resumeOrder({ payment_method: "binance" });
    mockCryptoStatus = { payment: { status: "WAITING", amount_usdt: "1.5", address: "0xabc", network: "BSC", expires_at: new Date(Date.now() + 20 * 60_000).toISOString() } };
    const { container, root } = await mountResume();
    const { api } = require("@/lib/api");
    expect(container.querySelector('[data-testid="checkout-step-pay-binance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crypto-address"]').textContent).toContain("0xabc");
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("pending + binance sans slot actif : compte à rebours seul, aucune initiation", async () => {
    mockOrderGet = resumeOrder({ payment_method: "binance" });
    mockCryptoStatus = {};
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="payment-countdown"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="checkout-step-pay-binance"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test.each([
    ["proof_submitted", "proof-waiting"], ["late_payment", "proof-late"],
    ["expired", "proof-expired"], ["failed", "proof-cancelled"],
  ])("statut %s → écran dédié réutilisé de l'étape 3 (%s)", async (status, testid) => {
    mockOrderGet = resumeOrder({ status });
    const { container, root } = await mountResume();
    expect(container.querySelector(`[data-testid="${testid}"]`)).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("proof_submitted : bouton Relancer + nombre de captures envoyées", async () => {
    mockOrderGet = resumeOrder({ status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] });
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="remind-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-sent-count"]').textContent).toContain("1");
    await act(async () => root.unmount());
  });

  test("paid : carte seule (ni saisie, ni zone de preuve)", async () => {
    mockOrderGet = resumeOrder({ status: "paid" });
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-card-MGS-B1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-drop-zone"]')).toBeNull();
    expect(container.querySelector('[data-testid="proof-waiting"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("403 / 404 : message générique + retour accueil, jamais de détail", async () => {
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/payments/config"
      ? Promise.resolve({ data: mockPayConfig })
      : Promise.reject(Object.assign(new Error("nope"), { response: { status: 403 } })));
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-not-available"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-not-available"]').textContent).not.toContain("MGS-B1");
    expect(container.querySelector('[data-testid="order-back-home"]').getAttribute("href")).toBe("/");
    await act(async () => root.unmount());
  });

  test("sondage auto : arrêt au démontage", async () => {
    // Temps RÉEL (fake timers cassent le démarrage du sondage via le scheduler) :
    // le 1er refresh est immédiat, l'intervalle 5 s est attendu en vrai temps.
    mockOrderGet = resumeOrder({ payment_method: "mvola" });
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false };
    const { api } = require("@/lib/api");
    const payCalls = () => api.get.mock.calls.filter(([u]) => u.includes("/payments/") && u.endsWith("/status")).length;
    const { container, root } = await mountResume();
    const n1 = payCalls(); // 1er refresh immédiat
    expect(n1).toBeGreaterThan(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 5300)); });
    const n2 = payCalls();
    expect(n2).toBeGreaterThan(n1); // intervalle 5 s a re-sondé
    await act(async () => root.unmount());
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(payCalls()).toBe(n2); // plus aucun appel après démontage
  }, 12000);
});

describe("PL-CHK-3 — boutons de reprise dans la liste des commandes", () => {
  const hist = (overrides = {}) => ({ ...baseOrder, id: "ord-uuid-1", ...overrides });

  test("pending manual → « Envoyer la preuve », pending auto → « Continuer le paiement », proof_submitted → « Voir l'état »", async () => {
    mockUser = { user_id: "u1" };
    mockHistory = [
      hist({ order_number: "MGS-D1", payment_method: "manual" }),
      hist({ order_number: "MGS-D2", id: "ord-auto", payment_method: "mvola" }),
      hist({ order_number: "MGS-D3", id: "ord-proof", status: "proof_submitted" }),
      hist({ order_number: "MGS-D4", id: "ord-done", status: "delivered" }),
    ];
    const { container, root } = await mount(<OrderTrack />);
    expect(container.querySelector('[data-testid="history-resume-MGS-D1"]').getAttribute("href")).toBe("/orders/ord-uuid-1");
    expect(container.querySelector('[data-testid="history-resume-MGS-D1"]').textContent).toBe("Envoyer la preuve");
    expect(container.querySelector('[data-testid="history-resume-MGS-D2"]').textContent).toBe("Continuer le paiement");
    expect(container.querySelector('[data-testid="history-resume-MGS-D3"]').textContent).toBe("Voir l'état");
    expect(container.querySelector('[data-testid="history-resume-MGS-D4"]')).toBeNull(); // statut final : pas de bouton
    await act(async () => root.unmount());
  });
});
