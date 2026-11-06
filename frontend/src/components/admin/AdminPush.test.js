import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AdminPush, testResultKey } from "./AdminPush";

// PL-NOTIF-2 : réabonnement automatique, état réel et vrai test.
// Aucun réseau : l'API et le navigateur (service worker, Notification) sont
// simulés. react-router-dom n'est pas utilisé ici — pas besoin de mock.
const STATUS = { vapid_configured: true, push_subscriptions: 2, alerts: [] };
const PUBLIC_KEY = window.btoa("k".repeat(65)); // clé factice : seul atob est utilisé côté client

const makeSub = (endpoint = "https://push.example/abc") => ({
  endpoint,
  options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
  toJSON: () => ({ endpoint, keys: { p256dh: "k", auth: "a" } }),
});

let mockPermission = "granted";
let mockSubscription = null;
let pushManager;

function setupBrowser({ permission = "granted", subscription = null } = {}) {
  mockPermission = permission;
  mockSubscription = subscription;
  pushManager = {
    getSubscription: jest.fn(() => Promise.resolve(mockSubscription)),
    subscribe: jest.fn(() => Promise.resolve(makeSub())),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: jest.fn(() => Promise.resolve(registration)), ready: Promise.resolve(registration) },
  });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  window.PushManager = function PushManager() {}; // absent de jsdom : présent dans tout navigateur compatible
  window.Notification = { permission, requestPermission: jest.fn(() => Promise.resolve(permission)) };
  return registration;
}

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key, vars) => {
      const value = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
      return vars && typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`)) : value;
    },
    lang: "fr",
  }),
}));

const { api } = require("@/lib/api");

const defaultGet = (url) => {
  if (url === "/admin/notifications/status") return Promise.resolve({ data: STATUS });
  if (url === "/admin/push/config") return Promise.resolve({ data: { configured: true, public_key: PUBLIC_KEY } });
  return Promise.resolve({ data: {} });
};

async function mountPush() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<AdminPush />));
  await flush();
  return { container, root };
}

const flush = async () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
const text = (container, testid) => container.querySelector(`[data-testid="${testid}"]`)?.textContent;
const postCalls = (url) => api.post.mock.calls.filter(([u]) => u === url);

beforeEach(() => {
  api.get.mockImplementation(defaultGet);
  api.post.mockResolvedValue({ data: { registered: true } });
  api.delete.mockResolvedValue({ data: {} });
});

afterEach(() => {
  delete window.Notification;
  delete navigator.serviceWorker;
  delete window.isSecureContext;
  delete window.PushManager;
  document.body.innerHTML = "";
  jest.resetAllMocks();
});

describe("testResultKey (pur)", () => {
  test.each([
    [{ status: "sent", sent: 3 }, "testSent"],
    [{ status: "skipped", reason: "no_subscription" }, "testNoSubscription"],
    [{ status: "skipped", reason: "vapid_not_configured" }, "testVapidMissing"],
    [{ status: "failed", reason: "subscription_gone" }, "testSubscriptionGone"],
    [{ status: "failed", reason: "send_error" }, "testSendError"],
    [{ status: "failed", reason: "timeout" }, "testTimeout"],
    [{ status: "failed", reason: "peu_importe" }, "testSendError"],
    [{ status: "inconnu" }, "testGeneric"],
    [{ foo: 1 }, "testGeneric"],
    [null, "testGeneric"],
    ["texte serveur", "testGeneric"],
  ])("%j → %s", (input, expected) => {
    expect(testResultKey(input)).toBe(expected);
  });
});

describe("synchronisation automatique", () => {
  test("permission accordée sans abonnement : s'abonne puis envoie une fois, appareil synchronisé", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    const { container } = await mountPush();
    await flush();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    expect(text(container, "push-device")).toContain("appareil synchronisé");
    // Pas de boucle : un second cycle de microtâches ne rajoute rien.
    await flush();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
  });

  test("abonnement existant : renvoyé au serveur sans réabonnement (inscription idempotente)", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountPush();
    await flush();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    expect(postCalls("/admin/push/subscriptions")[0][1].endpoint).toBe("https://push.example/abc");
    expect(text(container, "push-device")).toContain("appareil synchronisé");
  });

  test("permission par défaut : aucun POST ni abonnement automatique, bouton Activer", async () => {
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountPush();
    await flush();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="push-enable"]')).not.toBeNull();
    expect(text(container, "push-device")).toContain("appareil inconnu du serveur");
  });

  test("permission refusée : aide affichée, aucun POST", async () => {
    setupBrowser({ permission: "denied", subscription: null });
    const { container } = await mountPush();
    await flush();
    expect(api.post).not.toHaveBeenCalled();
    expect(text(container, "push-denied-help")).toContain("réglages du site");
  });

  test("échec du POST : état non synchronisé + réessai manuel qui resynchronise", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    api.post.mockImplementation((url) => (url === "/admin/push/subscriptions" ? Promise.reject(new Error("network")) : Promise.resolve({ data: {} })));
    const { container } = await mountPush();
    await flush();
    expect(text(container, "push-device")).toContain("appareil non synchronisé");
    expect(text(container, "push-error")).toBeUndefined(); // aucune trace technique
    const retry = container.querySelector('[data-testid="push-retry"]');
    expect(retry).not.toBeNull();
    api.post.mockResolvedValue({ data: { registered: true } });
    await click(retry);
    await flush();
    expect(text(container, "push-device")).toContain("appareil synchronisé");
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
  });

  test("navigateur non compatible (PushManager absent) : aide écran d'accueil, aucun appel", async () => {
    // Pas de setupBrowser : ni serviceWorker ni Notification → non supporté.
    const { container } = await mountPush();
    expect(text(container, "push-unsupported-help")).toContain("écran d'accueil");
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("vrai test via /admin/notifications/test", () => {
  const cases = [
    ["sent", { status: "sent", reason: null, sent: 3, targeted: 3 }, "envoyée à 3 appareil(s)"],
    ["skipped/no_subscription", { status: "skipped", reason: "no_subscription", sent: 0 }, "Aucun appareil abonné"],
    ["skipped/vapid_not_configured", { status: "skipped", reason: "vapid_not_configured", sent: 0 }, "Clés du serveur manquantes"],
    ["failed/subscription_gone", { status: "failed", reason: "subscription_gone", sent: 0, removed: 1 }, "Abonnement expiré supprimé"],
    ["failed/send_error", { status: "failed", reason: "send_error", sent: 0 }, "Erreur d'envoi"],
    ["failed/timeout", { status: "failed", reason: "timeout", sent: 0 }, "Délai dépassé"],
    ["réponse inattendue", { foo: "bar" }, "Résultat indisponible"],
  ];

  test.each(cases)("%s → message traduit", async (_name, payload, expected) => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.post.mockImplementation((url) => (url === "/admin/notifications/test" ? Promise.resolve({ data: payload }) : Promise.resolve({ data: {} })));
    const { container } = await mountPush();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    expect(text(container, "push-test-result")).toContain(expected);
  });

  test("raison serveur inconnue → message générique, jamais le texte brut", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.post.mockImplementation((url) => (url === "/admin/notifications/test"
      ? Promise.resolve({ data: { status: "failed", reason: "phrase_technique_du_serveur", sent: 0 } })
      : Promise.resolve({ data: {} })));
    const { container } = await mountPush();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    const shown = text(container, "push-test-result");
    expect(shown).toContain("Erreur d'envoi");
    expect(shown).not.toContain("phrase_technique_du_serveur");
  });

  test("erreur réseau → message générique, jamais le détail technique", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.post.mockImplementation((url) => (url === "/admin/notifications/test" ? Promise.reject(new Error("boom-detail")) : Promise.resolve({ data: {} })));
    const { container } = await mountPush();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    const shown = text(container, "push-test-result");
    expect(shown).toContain("Résultat indisponible");
    expect(shown).not.toContain("boom-detail");
  });

  test("l'ancienne route /admin/push/test n'est plus appelée", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountPush();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    expect(api.post.mock.calls.map(([u]) => u)).not.toContain("/admin/push/test");
    expect(api.post.mock.calls.map(([u]) => u)).toContain("/admin/notifications/test");
  });
});

describe("journal des alertes", () => {
  const alert = (i) => ({ _id: `a${i}`, created_at: "2026-11-06T10:00:00Z", event: ["order_created", "chat_message", "test"][i % 3], channel: "push", status: ["sent", "failed", "skipped"][i % 3], reason: [null, "send_error", "no_subscription"][i % 3] });

  test("5 dernières alertes affichées avec statut et raison traduits", async () => {
    setupBrowser({ permission: "default", subscription: null });
    api.get.mockImplementation((url) => (url === "/admin/notifications/status" ? Promise.resolve({ data: { ...STATUS, alerts: [0, 1, 2, 3, 4, 5, 6].map(alert) } }) : Promise.resolve({ data: {} })));
    const { container } = await mountPush();
    const items = container.querySelectorAll('[data-testid="push-alert"]');
    expect(items).toHaveLength(5);
    expect(container.textContent).toContain("commande");
    expect(container.textContent).toContain("erreur d'envoi");
    expect(container.textContent).not.toContain("order_created");
    expect(container.textContent).not.toContain("send_error");
  });

  test("aucune alerte : état vide explicite + bouton d'actualisation qui recharge", async () => {
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountPush();
    expect(text(container, "push-alerts-empty")).toContain("Aucune alerte");
    const before = api.get.mock.calls.filter(([u]) => u === "/admin/notifications/status").length;
    await click(container.querySelector('[data-testid="push-refresh"]'));
    await flush();
    const after = api.get.mock.calls.filter(([u]) => u === "/admin/notifications/status").length;
    expect(after).toBe(before + 1);
  });
});

describe("état serveur visible", () => {
  test("nombre d'appareils abonnés et clés manquantes affichés", async () => {
    setupBrowser({ permission: "default", subscription: null });
    api.get.mockImplementation((url) => (url === "/admin/notifications/status" ? Promise.resolve({ data: { vapid_configured: false, push_subscriptions: 0, alerts: [] } }) : Promise.resolve({ data: {} })));
    const { container } = await mountPush();
    await flush();
    expect(text(container, "push-devices-count")).toContain("0 appareil(s) abonné(s)");
    expect(text(container, "push-not-configured")).toContain("VAPID");
  });
});

describe("parité FR/EN", () => {
  test("les clés push existent dans les deux langues", () => {
    const { translations } = require("@/i18n/translations");
    const fr = Object.keys(translations.fr.admin.push).sort();
    const en = Object.keys(translations.en.admin.push).sort();
    expect(en).toEqual(fr);
    expect(fr.length).toBeGreaterThan(30);
  });
});
