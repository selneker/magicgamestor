import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OrderTrack, { OrderCard } from "./OrderTrack";

// PL-CHK-4 — écran 2 « Paiement » (/orders/:id) : titres par méthode, compte à
// rebours, étapes losanges avec numéros marchands ISSUS DE LA CONFIG (jamais
// écrits en dur), bouton de preuve fixé en bas, feuille d'annulation (écran 7),
// branches de statuts, 403/404 → message générique. La page de recherche
// (/suivi) reste couverte par ses propres tests (PL-CHK-3 conservés).
let mockTrackOrder = null;
let mockPayStatus = {};
// Écran de reprise : paramètres de route et API.
let mockParams = null; // useParams forcé (ex. { orderId: "ord-uuid-1" })
let mockOrderGet = null; // GET /orders/{id}
let mockCryptoStatus = {}; // GET /crypto/{id}/status
let mockHistory = []; // GET /orders/me (connecté)
let mockUser = null; // useAuth().user
// Numéro + nom marchands issus de /payments/config (JAMAIS écrits en dur côté client).
const mockPayConfig = {
  providers: {
    mvola: { merchant: "0343412345", name: "Selneker Dino" },
    orange: { merchant: "0343412345", name: "Selneker Dino" },
  },
};

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useParams: () => mockParams || { orderNumber: mockTrackOrder?.order_number || "" },
    useSearchParams: () => [new URLSearchParams(mockTrackOrder ? `pubg_id=${mockTrackOrder.pubg_id}` : ""), jest.fn()],
    useNavigate: () => mockNavigate,
  };
});
const mockNavigate = jest.fn();
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
  created_at: "2026-11-07T10:00:00Z", total: 2500, payment_fee: 0, subtotal: 2500,
};

beforeEach(() => {
  const { api } = require("@/lib/api");
  api.get.mockReset(); api.post.mockReset();
  localStorage.clear();
  mockNavigate.mockClear();
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

// ------------------------------------------------- PL-CHK-4 — écran 2 /orders/:id

const resumeOrder = (overrides = {}) => ({
  ...baseOrder, id: "ord-uuid-1", payment_method: "manual", manual_operator: "mvola",
  payment_deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(), payment_proofs: [], ...overrides,
});

async function mountResume() {
  mockParams = { orderId: "ord-uuid-1" };
  return mount(<OrderTrack />);
}

describe("écran 2 — paiement manuel (MVola / Orange)", () => {
  test("titre par opérateur, compte à rebours, étapes losanges et numéros ISSUS DE LA CONFIG", async () => {
    mockOrderGet = resumeOrder();
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-resume"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="resume-pay-title"]').textContent).toBe("Ouvrir MVola pour payer");
    expect(container.querySelector('[data-testid="payment-countdown"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="resume-operator-picker"]')).toBeNull(); // opérateur persisté
    // Étape 1 : montant à payer + nom + numéro marchand (config API, espaces posés par pretty()).
    expect(container.querySelector('[data-testid="resume-steps"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pay-amount"]').textContent).toMatch(/2[\s\u00a0\u202f]500/);
    expect(container.querySelector('[data-testid="merchant-name"]').textContent).toBe("Selneker Dino");
    expect(container.querySelector('[data-testid="merchant-number"]').textContent).toBe("034 34 123 45");
    // Boutons de copie pour chaque valeur (montant, nom, numéro).
    expect(container.querySelector('[data-testid="copy-pay-amount"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copy-merchant-name"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="copy-merchant-number"]')).not.toBeNull();
    // Étape 2 : consigne de preuve + bouton fixé en bas.
    expect(container.querySelector('[data-testid="resume-proof-step"]').textContent).toContain("envoyer la preuve");
    expect(container.querySelector('[data-testid="send-proof-button"]').textContent).toBe("Envoyer la preuve de paiement");
    await act(async () => root.unmount());
  });

  test("ancienne commande sans manual_operator : AUCUN sélecteur, AUCUN numéro — message + « Recommencer » effectif (PL-CHK-6)", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "ord-uuid-1", createdAt: new Date().toISOString() }));
    mockOrderGet = resumeOrder({ manual_operator: null });
    const { container, root } = await mountResume();
    // PL-CHK-5 : une méthode = un écran. Opérateur null → écran dédié, le
    // sélecteur PL-CHK-3 a été retiré (jamais rendu, jamais de numéro).
    expect(container.querySelector('[data-testid="manual-provider-mvola"]')).toBeNull();
    expect(container.querySelector('[data-testid="manual-provider-orange"]')).toBeNull();
    expect(container.querySelector('[data-testid="resume-operator-picker"]')).toBeNull();
    expect(container.querySelector('[data-testid="resume-pay-title"]')).toBeNull();
    expect(container.querySelector('[data-testid="merchant-number"]')).toBeNull();
    expect(container.querySelector('[data-testid="send-proof-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="resume-unpayable"]').textContent)
      .toContain("ne peut plus être payée");
    // PL-CHK-6 — sortie discrète vers l'accueil + « Recommencer » : la clé
    // meurt PUIS l'écran 1 du jeu concerné (boutique filtrée sur ce jeu).
    expect(container.querySelector('[data-testid="resume-back-home"]').getAttribute("href")).toBe("/");
    const restart = container.querySelector('[data-testid="restart-button"]');
    expect(restart).not.toBeNull();
    expect(restart.textContent).toBe("Recommencer");
    await act(async () => { restart.click(); });
    expect(mockNavigate).toHaveBeenCalledWith("/boutique?game=pubg-mobile", { replace: true });
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test("commande manuelle sans opérateur vue par l'API : la clé qui la pointe est purgée en silence", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "ord-uuid-1", createdAt: new Date().toISOString() }));
    mockOrderGet = resumeOrder({ manual_operator: null });
    await mountResume();
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
  });

  test("statut final sur une AUTRE commande : la clé d'une autre commande n'est JAMAIS purgée", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o-autre", createdAt: new Date().toISOString() }));
    mockOrderGet = resumeOrder({ status: "paid" });
    await mountResume();
    expect(JSON.parse(localStorage.getItem("mgs_pending_order_id")).id).toBe("o-autre");
  });

  test("AUCUN récapitulatif (il vit à l'écran 4) et AUCUN code USSD", async () => {
    mockOrderGet = resumeOrder();
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="ussd-code"]')).toBeNull();
    expect(container.querySelector('[data-testid="checkout-summary"]')).toBeNull();
    expect(container.textContent).not.toContain("#111*1*");
    expect(container.textContent).not.toContain("Récapitulatif");
    await act(async () => root.unmount());
  });

  test("annulation (écran 7) : l'ouverture affiche 5 raisons + « Garder ma commande »", async () => {
    mockOrderGet = resumeOrder();
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-cancel-open"]')).not.toBeNull();
    await act(async () => { container.querySelector('[data-testid="order-cancel-open"]').click(); });
    // Contenu Radix portalisé dans document.body.
    expect(document.querySelector('[data-testid="cancel-sheet"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="cancel-sheet-title"]').textContent).toBe("Pourquoi annulez-vous ?");
    expect(document.querySelectorAll('[data-testid="cancel-reasons"] [role="radio"]').length).toBe(5);
    for (const k of ["wrong_info", "change_method", "too_short", "cannot_pay_now", "other"]) {
      expect(document.querySelector(`[data-testid="cancel-reason-${k}"]`)).not.toBeNull();
    }
    expect(document.querySelector('[data-testid="cancel-keep"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="cancel-confirm"]').disabled).toBe(true); // sans raison
    await act(async () => { document.querySelector('[data-testid="cancel-reason-wrong_info"]').click(); });
    expect(document.querySelector('[data-testid="cancel-confirm"]').disabled).toBe(false);
    await act(async () => root.unmount());
  });

  test("annulation confirmée : POST /orders/{id}/cancel avec la raison", async () => {
    const { api } = require("@/lib/api");
    api.post.mockResolvedValue({ data: { ok: true, status: "cancelled" } });
    mockOrderGet = resumeOrder();
    const { container, root } = await mountResume();
    await act(async () => { container.querySelector('[data-testid="order-cancel-open"]').click(); });
    await act(async () => { document.querySelector('[data-testid="cancel-reason-other"]').click(); });
    await act(async () => { document.querySelector('[data-testid="cancel-confirm"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/orders/ord-uuid-1/cancel", { reason: "other" });
    await act(async () => root.unmount());
  });

  test("preuve envoyée : la feuille (écran 3) s'ouvre via le bouton fixé", async () => {
    mockOrderGet = resumeOrder();
    const { container, root } = await mountResume();
    await act(async () => { container.querySelector('[data-testid="send-proof-button"]').click(); });
    expect(document.querySelector('[data-testid="proof-sheet-title"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});

describe("écran 2 — Binance (détection automatique)", () => {
  test("pending + binance : slot rouvert via GET /crypto/{id}/status — JAMAIS de 2e initiation", async () => {
    const { api } = require("@/lib/api");
    mockOrderGet = resumeOrder({ payment_method: "binance" });
    mockCryptoStatus = { payment: { status: "WAITING", amount_usdt: "1.5", address: "0xabc", network: "BSC", expires_at: new Date(Date.now() + 20 * 60_000).toISOString() } };
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="resume-pay-title"]').textContent).toBe("Envoyer des USDT");
    expect(container.querySelector('[data-testid="checkout-step-pay-binance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crypto-address"]').textContent).toContain("0xabc");
    expect(container.querySelector('[data-testid="binance-waiting"]').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("pending + binance sans slot actif : compte à rebours seul, aucune initiation, message « aucune preuve »", async () => {
    const { api } = require("@/lib/api");
    mockOrderGet = resumeOrder({ payment_method: "binance" });
    mockCryptoStatus = {};
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="payment-countdown"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="checkout-step-pay-binance"]')).toBeNull();
    expect(container.querySelector('[data-testid="resume-binance-noproof"]').textContent).toContain("détecté automatiquement");
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

describe("écran 2 — branches de statuts", () => {
  test("pending + auto (mvola PAPI) : compte à rebours + bouton de reprise, jamais de zone de preuve", async () => {
    mockOrderGet = resumeOrder({ payment_method: "mvola" });
    mockPayStatus = { payment_url: "https://pay.exemple.test/x", simulated: false, expires_at: new Date(Date.now() + 20 * 60_000).toISOString() };
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="payment-countdown"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="resume-payment-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="send-proof-button"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test.each([
    ["proof_submitted", "proof-waiting"], ["late_payment", "proof-late"],
    ["expired", "proof-expired"], ["cancelled", "proof-cancelled"], ["failed", "proof-cancelled"],
  ])("statut %s → écran dédié réutilisé (%s)", async (status, testid) => {
    mockOrderGet = resumeOrder({ status, manual_operator: null });
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

  test("paid : carte seule (ni bouton de preuve, ni écran d'attente)", async () => {
    mockOrderGet = resumeOrder({ status: "paid" });
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-card-MGS-B1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-waiting"]')).toBeNull();
    expect(container.querySelector('[data-testid="send-proof-button"]')).toBeNull();
    // Statut final : la mémorisation de reprise est purgée (PL-CHK-3).
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test.each([
    ["expired", "proof-expired"], ["cancelled", "proof-cancelled"], ["failed", "proof-cancelled"],
  ])("statut %s (PL-CHK-6) : « Recommencer » purge la clé et ramène à l'écran 1 du jeu", async (status, testid) => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "ord-uuid-1", createdAt: new Date().toISOString() }));
    mockOrderGet = resumeOrder({ status, manual_operator: null });
    const { container, root } = await mountResume();
    expect(container.querySelector(`[data-testid="${testid}"]`)).not.toBeNull();
    const restart = container.querySelector('[data-testid="proof-restart"]');
    expect(restart).not.toBeNull();
    await act(async () => { restart.click(); });
    expect(mockNavigate).toHaveBeenCalledWith("/boutique?game=pubg-mobile", { replace: true });
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test.each([
    ["expired", "proof-expired"], ["cancelled", "proof-cancelled"], ["failed", "proof-cancelled"],
  ])("statut %s : « Recommencer » avec un jeu inconnu ramène à l'accueil", async (status, testid) => {
    mockOrderGet = resumeOrder({ status, manual_operator: null, game_id: undefined });
    const { container, root } = await mountResume();
    await act(async () => { container.querySelector(`[data-testid="${testid}"] [data-testid="proof-restart"]`).click(); });
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    await act(async () => root.unmount());
  });

  test("403/404 sur une commande mémorisée : la clé est purgée en silence", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "ord-uuid-1", createdAt: new Date().toISOString() }));
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => url === "/payments/config"
      ? Promise.resolve({ data: mockPayConfig })
      : Promise.reject(Object.assign(new Error("nope"), { response: { status: 404 } })));
    const { container, root } = await mountResume();
    expect(container.querySelector('[data-testid="order-not-available"]')).not.toBeNull();
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test("annulation confirmée : la clé de reprise est purgée (PL-CHK-6)", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "ord-uuid-1", createdAt: new Date().toISOString() }));
    const { api } = require("@/lib/api");
    api.post.mockResolvedValue({ data: { ok: true, status: "cancelled" } });
    mockOrderGet = resumeOrder();
    const { container, root } = await mountResume();
    await act(async () => { container.querySelector('[data-testid="order-cancel-open"]').click(); });
    await act(async () => { document.querySelector('[data-testid="cancel-reason-other"]').click(); });
    await act(async () => { document.querySelector('[data-testid="cancel-confirm"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/orders/ord-uuid-1/cancel", { reason: "other" });
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
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
