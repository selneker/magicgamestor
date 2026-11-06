import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AdminPushPage, AdminPushBadge, testResultKey, syncResultText } from "./AdminPush";
import { pushSync, categorizeSyncError, RETRY_DELAY } from "@/lib/pushSync";

// PL-NOTIF-2B : page Notifications + pastille + moteur de synchronisation.
// Aucun réseau : l'API et le navigateur (service worker, Notification) sont
// simulés. Le store pushSync est un singleton : __testReset() l'isole.
const STATUS = { vapid_configured: true, push_subscriptions: 2, alerts: [] };
const STATUS_ZERO = { vapid_configured: true, push_subscriptions: 0, alerts: [] };
const PUBLIC_KEY = window.btoa("k".repeat(65)); // clé factice : seul atob est utilisé côté client
const ENDPOINT = "https://push.example/abc";

const makeSub = (endpoint = ENDPOINT) => ({
  endpoint,
  options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
  unsubscribe: jest.fn(() => Promise.resolve()),
  toJSON: () => ({ endpoint, keys: { p256dh: "k", auth: "a" } }),
});

let mockPermission = "granted";
let mockSubscription = null;
let mockRequestPermission = null;
let pushManager;

function setupBrowser({ permission = "granted", subscription = null } = {}) {
  mockPermission = permission;
  mockSubscription = subscription;
  mockRequestPermission = jest.fn(() => Promise.resolve(permission));
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
  window.Notification = { permission, requestPermission: mockRequestPermission };
  return registration;
}

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
// react-router-dom v7 ne résout pas sous jest (voir Header.test.js) — la
// pastille est rendue comme un <a href> équivalent et useLocation est simulé.
let mockPathname = "/admin";
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useLocation: () => ({ pathname: mockPathname }),
  };
});
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

global.IS_REACT_ACT_ENVIRONMENT = true;

const roots = [];
async function mount(el) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(el));
  await drain();
  return { container, root };
}

const mountPage = () => mount(<AdminPushPage />);
const mountBadge = () => mount(<AdminPushBadge />);

// Vide les microtâches uniquement — compatible fake timers.
const drain = async () => act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });
// Vide microtâches + minuteries réelles — à n'utiliser qu'avec les vraies minuteries.
const flush = async () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
const text = (container, testid) => container.querySelector(`[data-testid="${testid}"]`)?.textContent;
const postCalls = (url) => api.post.mock.calls.filter(([u]) => u === url);
const deferred = () => {
  let resolve;
  const p = new Promise((res) => { resolve = res; });
  p.resolve = resolve;
  return p;
};

beforeEach(() => {
  mockPathname = "/admin";
  pushSync.__testReset();
  api.get.mockImplementation(defaultGet);
  api.post.mockResolvedValue({ data: { registered: true } });
  api.delete.mockResolvedValue({ data: {} });
});

afterEach(async () => {
  pushSync.__testReset();
  // Démontage propre : le store est un singleton, chaque racine détachée qui
  // resterait abonnée re-renderait à chaque changement d'état des tests suivants.
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
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

describe("categorizeSyncError (pur)", () => {
  test.each([
    [{ response: { status: 503 } }, { cat: "vapid", code: 503 }],
    [{ response: { status: 401 } }, { cat: "auth", code: 401 }],
    [{ response: { status: 403 } }, { cat: "auth", code: 403 }],
    [{ response: { status: 422 } }, { cat: "invalid", code: 422 }],
    [{ response: { status: 500 } }, { cat: "http", code: 500 }],
    [new Error("network"), { cat: "network", code: null }],
    [Object.assign(new Error("sw"), { swError: true }), { cat: "sw", code: null }],
    [undefined, { cat: "network", code: null }],
  ])("%j → %j", (input, expected) => {
    expect(categorizeSyncError(input)).toEqual(expected);
  });
});

describe("synchronisation automatique (page)", () => {
  test("permission accordée sans abonnement : s'abonne puis envoie une fois, interrupteur activé", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    const { container } = await mountPage();
    await flush();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    expect(text(container, "push-device")).toContain("appareil synchronisé");
    expect(text(container, "push-sync-result")).toContain("réussie");
    expect(container.querySelector('[data-testid="push-switch"]').getAttribute("aria-checked")).toBe("true");
    // Pas de boucle : un second cycle ne rajoute rien.
    await flush();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
  });

  test("abonnement existant : renvoyé au serveur sans réabonnement (inscription idempotente)", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountPage();
    await flush();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    expect(postCalls("/admin/push/subscriptions")[0][1].endpoint).toBe(ENDPOINT);
    expect(text(container, "push-device")).toContain("appareil synchronisé");
  });

  test("permission par défaut : aucun POST ni abonnement automatique, interrupteur présent mais inactif", async () => {
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountPage();
    await flush();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    const sw = container.querySelector('[data-testid="push-switch"]');
    expect(sw).not.toBeNull();
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(text(container, "push-device")).toContain("appareil inconnu du serveur");
    expect(text(container, "push-sync-result")).toContain("pas encore effectuée");
  });

  test("permission refusée : aide affichée, aucun POST", async () => {
    setupBrowser({ permission: "denied", subscription: null });
    const { container } = await mountPage();
    await flush();
    expect(api.post).not.toHaveBeenCalled();
    expect(text(container, "push-denied-help")).toContain("réglages du site");
  });

  test("échec du POST 503 : état non synchronisé, résultat lisible avec la catégorie et le code", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    api.post.mockImplementation((url) => (url === "/admin/push/subscriptions" ? Promise.reject(Object.assign(new Error("fail"), { response: { status: 503 } })) : Promise.resolve({ data: {} })));
    const { container } = await mountPage();
    await flush();
    expect(text(container, "push-device")).toContain("appareil non synchronisé");
    expect(text(container, "push-sync-result")).toContain("clés serveur manquantes");
    expect(text(container, "push-sync-result")).toContain("503");
    expect(container.querySelector('[data-testid="push-retry"]')).not.toBeNull();
    expect(text(container, "push-error")).toBeUndefined(); // aucune trace technique
  });

  test("échec réseau : catégorie lisible sans code HTTP", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    api.post.mockImplementation((url) => (url === "/admin/push/subscriptions" ? Promise.reject(new Error("offline")) : Promise.resolve({ data: {} })));
    const { container } = await mountPage();
    await flush();
    expect(text(container, "push-sync-result")).toContain("réseau indisponible");
    expect(text(container, "push-sync-result")).not.toContain("code");
  });

  test("navigateur non compatible (PushManager absent) : aide écran d'accueil, aucun appel", async () => {
    // Pas de setupBrowser : ni serviceWorker ni Notification → non supporté.
    const { container } = await mountPage();
    expect(text(container, "push-unsupported-help")).toContain("écran d'accueil");
    expect(api.get).not.toHaveBeenCalled();
  });

  test("aucune fuite : ni l'adresse d'abonnement ni la clé publique ne sont affichées", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountPage();
    await flush();
    expect(container.textContent).not.toContain("push.example");
    expect(container.textContent).not.toContain(PUBLIC_KEY);
  });
});

describe("réessai automatique borné (fausses minuteries)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("après un échec : une seule tentative différée, puis plus rien", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    let postCount = 0;
    api.post.mockImplementation((url) => {
      if (url !== "/admin/push/subscriptions") return Promise.resolve({ data: {} });
      postCount += 1;
      return postCount === 1 ? Promise.reject(new Error("fail")) : Promise.resolve({ data: { registered: true } });
    });
    const { container } = await mountPage();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    // Le réessai unique part après le délai.
    await act(async () => { jest.advanceTimersByTime(RETRY_DELAY); });
    await drain();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
    expect(text(container, "push-sync-result")).toContain("réussie");
    // Aucun autre réessai automatique ensuite.
    await act(async () => { jest.advanceTimersByTime(60000); });
    await drain();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
  });

  test("si le réessai échoue aussi : pas de troisième tentative automatique", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    api.post.mockImplementation((url) => (url === "/admin/push/subscriptions" ? Promise.reject(new Error("fail")) : Promise.resolve({ data: {} })));
    await mountPage();
    await act(async () => { jest.advanceTimersByTime(RETRY_DELAY); });
    await drain();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
    await act(async () => { jest.advanceTimersByTime(60000); });
    await drain();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
  });
});

describe("réessai manuel (bouton Réessayer)", () => {
  test("désactivé pendant la requête, un seul envoi, succès affiché", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    let postCount = 0;
    let second;
    api.post.mockImplementation((url) => {
      if (url !== "/admin/push/subscriptions") return Promise.resolve({ data: {} });
      postCount += 1;
      if (postCount === 1) return Promise.reject(new Error("fail"));
      second = deferred();
      return second;
    });
    const { container } = await mountPage();
    await flush();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    const retry = container.querySelector('[data-testid="push-retry"]');
    expect(retry.disabled).toBe(false);
    await click(retry);
    await flush();
    // Pendant la requête : désactivé (garde anti double envoi).
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
    expect(container.querySelector('[data-testid="push-retry"]').disabled).toBe(true);
    second.resolve({ data: { registered: true } });
    await flush();
    expect(text(container, "push-device")).toContain("appareil synchronisé");
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(2);
  });

  test("garde du store : deux syncNow concurrents ne déclenchent qu'un envoi", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    const pending = deferred();
    api.get.mockImplementation((url) => {
      if (url === "/admin/notifications/status") return pending;
      if (url === "/admin/push/config") return Promise.resolve({ data: { configured: true, public_key: PUBLIC_KEY } });
      return Promise.resolve({ data: {} });
    });
    const p1 = pushSync.syncNow();
    const p2 = pushSync.syncNow(); // pendant la première : no-op
    pending.resolve({ data: STATUS });
    await Promise.all([p1, p2]);
    await drain();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
  });
});

describe("interrupteur activer / désactiver", () => {
  test("permission par défaut → activer via l'interrupteur : permission demandée, abonnement envoyé", async () => {
    setupBrowser({ permission: "default", subscription: null });
    mockRequestPermission.mockResolvedValue("granted");
    const { container } = await mountPage();
    await flush();
    await click(container.querySelector('[data-testid="push-switch"]'));
    await flush();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    expect(container.querySelector('[data-testid="push-switch"]').getAttribute("aria-checked")).toBe("true");
    expect(text(container, "push-device")).toContain("appareil synchronisé");
  });

  test("activé → désactiver via l'interrupteur : suppression serveur + locale, état « off »", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountPage();
    await flush();
    expect(container.querySelector('[data-testid="push-switch"]').getAttribute("aria-checked")).toBe("true");
    await click(container.querySelector('[data-testid="push-switch"]'));
    await flush();
    expect(api.delete).toHaveBeenCalledWith("/admin/push/subscriptions", { data: { endpoint: ENDPOINT } });
    expect(text(container, "push-device")).toContain("appareil non synchronisé");
    expect(container.querySelector('[data-testid="push-switch"]').getAttribute("aria-checked")).toBe("false");
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
    const { container } = await mountPage();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    expect(text(container, "push-test-result")).toContain(expected);
  });

  test("raison serveur inconnue → message générique, jamais le texte brut", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.post.mockImplementation((url) => (url === "/admin/notifications/test"
      ? Promise.resolve({ data: { status: "failed", reason: "phrase_technique_du_serveur", sent: 0 } })
      : Promise.resolve({ data: {} })));
    const { container } = await mountPage();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    const shown = text(container, "push-test-result");
    expect(shown).toContain("Erreur d'envoi");
    expect(shown).not.toContain("phrase_technique_du_serveur");
  });

  test("erreur réseau → message générique, jamais le détail technique", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.post.mockImplementation((url) => (url === "/admin/notifications/test" ? Promise.reject(new Error("boom-detail")) : Promise.resolve({ data: {} })));
    const { container } = await mountPage();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    const shown = text(container, "push-test-result");
    expect(shown).toContain("Résultat indisponible");
    expect(shown).not.toContain("boom-detail");
  });

  test("l'ancienne route /admin/push/test n'est plus appelée", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountPage();
    await click(container.querySelector('[data-testid="push-test"]'));
    await flush();
    expect(api.post.mock.calls.map(([u]) => u)).not.toContain("/admin/push/test");
    expect(api.post.mock.calls.map(([u]) => u)).toContain("/admin/notifications/test");
  });
});

describe("journal des alertes (replié par défaut)", () => {
  const alert = (i) => ({ _id: `a${i}`, created_at: "2026-11-06T10:00:00Z", event: ["order_created", "chat_message", "test"][i % 3], channel: "push", status: ["sent", "failed", "skipped"][i % 3], reason: [null, "send_error", "no_subscription"][i % 3] });

  test("replié par défaut : aucune ligne visible ; ouvert à la demande : 5 dernières traduites", async () => {
    setupBrowser({ permission: "default", subscription: null });
    api.get.mockImplementation((url) => (url === "/admin/notifications/status" ? Promise.resolve({ data: { ...STATUS, alerts: [0, 1, 2, 3, 4, 5, 6].map(alert) } }) : Promise.resolve({ data: {} })));
    const { container } = await mountPage();
    // Replié : pas de ligne de journal dans la page.
    expect(container.querySelector('[data-testid="push-alert"]')).toBeNull();
    const toggle = container.querySelector('[data-testid="push-alerts-toggle"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const items = container.querySelectorAll('[data-testid="push-alert"]');
    expect(items).toHaveLength(5);
    expect(container.textContent).toContain("commande");
    expect(container.textContent).toContain("erreur d'envoi");
    expect(container.textContent).not.toContain("order_created");
    expect(container.textContent).not.toContain("send_error");
  });

  test("ouvert sans alerte : état vide explicite + bouton d'actualisation qui recharge", async () => {
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountPage();
    await click(container.querySelector('[data-testid="push-alerts-toggle"]'));
    expect(text(container, "push-alerts-empty")).toContain("Aucune alerte");
    const before = api.get.mock.calls.filter(([u]) => u === "/admin/notifications/status").length;
    await click(container.querySelector('[data-testid="push-refresh"]'));
    await flush();
    const after = api.get.mock.calls.filter(([u]) => u === "/admin/notifications/status").length;
    expect(after).toBe(before + 1);
  });
});

describe("état serveur visible (page)", () => {
  test("nombre d'appareils abonnés et clés manquantes affichés", async () => {
    setupBrowser({ permission: "default", subscription: null });
    api.get.mockImplementation((url) => (url === "/admin/notifications/status" ? Promise.resolve({ data: { vapid_configured: false, push_subscriptions: 0, alerts: [] } }) : Promise.resolve({ data: {} })));
    const { container } = await mountPage();
    await flush();
    expect(text(container, "push-devices-count")).toContain("0 appareil(s) abonné(s)");
    expect(text(container, "push-not-configured")).toContain("VAPID");
  });
});

describe("pastille du tableau de bord", () => {
  test("rien quand tout va bien (permission accordée, appareil synchronisé, abonnés présents)", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    const { container } = await mountBadge();
    await flush();
    expect(container.querySelector('[data-testid="admin-push-badge"]')).toBeNull();
  });

  test("permission à activer : pastille visible, renvoi vers la page, libellé traduit", async () => {
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountBadge();
    await flush();
    const badge = container.querySelector('[data-testid="admin-push-badge"]');
    expect(badge).not.toBeNull();
    expect(badge.getAttribute("href")).toBe("/admin/notifications");
    expect(badge.textContent).toContain("Notifications à vérifier");
  });

  test("appareil non synchronisé (échec POST) : pastille visible", async () => {
    setupBrowser({ permission: "granted", subscription: null });
    api.post.mockImplementation((url) => (url === "/admin/push/subscriptions" ? Promise.reject(new Error("fail")) : Promise.resolve({ data: {} })));
    const { container } = await mountBadge();
    await flush();
    expect(container.querySelector('[data-testid="admin-push-badge"]')).not.toBeNull();
  });

  test("0 appareil abonné côté serveur alors que l'appareil est synchronisé : pastille visible", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.get.mockImplementation((url) => {
      if (url === "/admin/notifications/status") return Promise.resolve({ data: STATUS_ZERO });
      if (url === "/admin/push/config") return Promise.resolve({ data: { configured: true, public_key: PUBLIC_KEY } });
      return Promise.resolve({ data: {} });
    });
    const { container } = await mountBadge();
    await flush();
    expect(container.querySelector('[data-testid="admin-push-badge"]')).not.toBeNull();
  });

  test("désactivé volontairement (off) : pas de pastille malgré l'appareil non synchronisé", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    await mountBadge();
    await flush();
    await pushSync.disable();
    await drain();
    const container = document.body;
    expect(container.querySelector('[data-testid="admin-push-badge"]')).toBeNull();
  });

  test("navigateur non compatible : pas de pastille", async () => {
    const { container } = await mountBadge();
    await drain();
    expect(container.querySelector('[data-testid="admin-push-badge"]')).toBeNull();
  });

  // PL-NOTIF-2C : la page Notifications montre déjà l'état complet.
  test("masquée sur la page Notifications elle-même, même en cas de problème", async () => {
    mockPathname = "/admin/notifications";
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountBadge();
    await flush();
    expect(container.querySelector('[data-testid="admin-push-badge"]')).toBeNull();
  });

  test("présente sur une autre page admin pour le même problème", async () => {
    setupBrowser({ permission: "default", subscription: null });
    const { container } = await mountBadge();
    await flush();
    expect(container.querySelector('[data-testid="admin-push-badge"]')).not.toBeNull();
  });

  test("compteur relu après synchro réussie : count 0 → 2, pastille disparaît", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    let statusCalls = 0;
    api.get.mockImplementation((url) => {
      if (url === "/admin/notifications/status") {
        statusCalls += 1;
        return Promise.resolve({ data: statusCalls === 1 ? STATUS_ZERO : STATUS });
      }
      if (url === "/admin/push/config") return Promise.resolve({ data: { configured: true, public_key: PUBLIC_KEY } });
      return Promise.resolve({ data: {} });
    });
    const { container } = await mountPage();
    await flush();
    // Le POST a réussi puis le statut a été relu : le compteur reflète le serveur.
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1);
    expect(text(container, "push-devices-count")).toContain("2 appareil(s) abonné(s)");
    expect(container.querySelector('[data-testid="admin-push-badge"]')).toBeNull();
  });

  test("count toujours 0 après relecture : pastille présente", async () => {
    setupBrowser({ permission: "granted", subscription: makeSub() });
    api.get.mockImplementation((url) => {
      if (url === "/admin/notifications/status") return Promise.resolve({ data: STATUS_ZERO });
      if (url === "/admin/push/config") return Promise.resolve({ data: { configured: true, public_key: PUBLIC_KEY } });
      return Promise.resolve({ data: {} });
    });
    const { container } = await mountBadge();
    await flush();
    expect(postCalls("/admin/push/subscriptions")).toHaveLength(1); // synchro réussie…
    expect(container.querySelector('[data-testid="admin-push-badge"]')).not.toBeNull(); // …mais 0 abonné côté serveur
  });
});

describe("syncResultText (pur)", () => {
  const t = (key, vars) => {
    const value = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
    return vars && typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`)) : value;
  };

  test("idle → pas encore effectuée ; ok → réussie ; échec avec et sans code", () => {
    expect(syncResultText({ state: "idle" }, t)).toContain("pas encore effectuée");
    expect(syncResultText({ state: "ok" }, t)).toContain("réussie");
    expect(syncResultText({ state: "failed", cat: "auth", code: 401 }, t)).toBe("échec — session refusée (code 401)");
    expect(syncResultText({ state: "failed", cat: "network", code: null }, t)).toBe("échec — réseau indisponible");
    expect(syncResultText({ state: "failed", cat: "inconnu" }, t)).toContain("cause inconnue");
  });
});

describe("parité FR/EN", () => {
  test("les clés push existent dans les deux langues", () => {
    const { translations } = require("@/i18n/translations");
    const fr = Object.keys(translations.fr.admin.push).sort();
    const en = Object.keys(translations.en.admin.push).sort();
    expect(en).toEqual(fr);
    expect(fr.length).toBeGreaterThan(45);
  });
});
