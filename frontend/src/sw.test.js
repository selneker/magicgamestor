/**
 * PL-NOTIF-2 : le service worker public/sw.js garde push + notificationclick
 * et gère désormais pushsubscriptionchange (réabonnement + réenvoi serveur).
 * Le fichier réel est évalué dans un bac à sable avec un `self` simulé :
 * aucun réseau, fetch est un mock.
 */
const fs = require("fs");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");

function loadSW() {
  const listeners = {};
  const registration = {
    showNotification: jest.fn(() => Promise.resolve()),
    pushManager: {
      getSubscription: jest.fn(() => Promise.resolve(null)),
      subscribe: jest.fn(() => Promise.resolve(null)),
    },
  };
  const sandbox = {
    registration,
    clients: { matchAll: jest.fn(() => Promise.resolve([])), openWindow: jest.fn(() => Promise.resolve()) },
    location: { origin: "https://admin.example" },
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  new Function("self", code)(sandbox);
  return { listeners, registration, sandbox };
}

const makeSub = (endpoint = "https://push.example/new") => ({
  endpoint,
  options: { applicationServerKey: new Uint8Array([9, 8, 7]).buffer },
  toJSON: () => ({ endpoint, keys: { p256dh: "k", auth: "a" } }),
});

const waitEvent = (listeners, name, event) => {
  // waitUntil est fourni AVANT d'appeler le handler : la promesse capte celle
  // passée par le worker et le test attend sa résolution.
  const done = new Promise((resolve, reject) => { event.waitUntil = (p) => Promise.resolve(p).then(resolve, reject); });
  listeners[name](event);
  return done;
};

describe("public/sw.js", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn(() => Promise.resolve({ ok: true }));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    delete global.fetch;
  });

  test("push et notificationclick restent enregistrés et fonctionnels", async () => {
    const { listeners, registration, sandbox } = loadSW();
    expect(typeof listeners.push).toBe("function");
    expect(typeof listeners.notificationclick).toBe("function");
    await waitEvent(listeners, "push", { data: { json: () => ({ title: "T", body: "B" }) } });
    expect(registration.showNotification).toHaveBeenCalledWith("T", expect.objectContaining({ body: "B", icon: "/push-icon-192.png", badge: "/badge-72.png" }));
    await waitEvent(listeners, "notificationclick", { notification: { close: jest.fn(), data: { url: "/admin/commandes" } } });
    expect(sandbox.clients.openWindow).toHaveBeenCalledWith("https://admin.example/admin/commandes");
  });

  test("pushsubscriptionchange avec abonnement existant : réenvoi serveur avec cookies, sans réabonnement", async () => {
    const { listeners, registration } = loadSW();
    expect(typeof listeners.pushsubscriptionchange).toBe("function");
    registration.pushManager.getSubscription.mockResolvedValue(makeSub());
    await waitEvent(listeners, "pushsubscriptionchange", {});
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/push/subscriptions", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify(makeSub().toJSON()),
    }));
  });

  test("pushsubscriptionchange sans abonnement : réabonne avec la clé de l'ancien abonnement", async () => {
    const { listeners, registration } = loadSW();
    registration.pushManager.subscribe.mockResolvedValue(makeSub());
    await waitEvent(listeners, "pushsubscriptionchange", { oldSubscription: { options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer } } });
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
      applicationServerKey: expect.anything(),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/push/subscriptions", expect.objectContaining({ method: "POST", credentials: "include" }));
  });

  test("pushsubscriptionchange sans abonnement ni ancienne clé : ne fait rien (le chargement admin rattrape)", async () => {
    const { listeners, registration } = loadSW();
    await waitEvent(listeners, "pushsubscriptionchange", {});
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("échec réseau du réenvoi : silencieux, aucune exception", async () => {
    const { listeners, registration } = loadSW();
    registration.pushManager.getSubscription.mockResolvedValue(makeSub());
    fetchMock.mockRejectedValue(new Error("offline"));
    await waitEvent(listeners, "pushsubscriptionchange", {});
    expect(fetchMock).toHaveBeenCalled();
  });

  test("le worker reste push-only : aucun handler fetch (pas de cache, pas d'interception)", () => {
    const { listeners } = loadSW();
    expect(listeners.fetch).toBeUndefined();
  });
});
