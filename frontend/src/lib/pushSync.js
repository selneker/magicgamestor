import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";

// Moteur de synchronisation push admin (PL-NOTIF-2B). Store singleton lu via
// useSyncExternalStore (même pattern que lib/favorites.js) : la synchro tourne
// à l'ouverture de l'admin, la page Notifications et la pastille du tableau de
// bord ne sont que de la présentation.
//
// Pourquoi ce store : l'ancien resync() (AdminPush.js PL-NOTIF-2) avalait tout
// échec dans un catch vide et s'arrêtait silencieusement avant le POST — en
// production le réabonnement a échoué sans aucun diagnostic. Ici chaque issue
// est enregistrée dans state.sync (catégorie lisible + code HTTP éventuel).

export const pushSupported = () =>
  window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const keyBytes = (key) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0));

// Réessai automatique borné : UNE seule tentative différée après un échec,
// ensuite seulement le bouton manuel. Garde-fou service worker : register()
// résout avant l'activation du worker (divergence exacte avec l'ancien chemin
// « Activer » qui attendait `ready`) — on borne l'attente de `ready`.
export const RETRY_DELAY = 4000;
export const SW_TIMEOUT = 10000;

const initialState = () => ({
  permission: null,      // Notification.permission (null = non supporté / pas encore lu)
  status: null,          // GET /admin/notifications/status
  deviceSynced: null,    // null = inconnu, true/false = issue de la dernière synchro
  off: false,            // désactivé volontairement via l'interrupteur (≠ « non synchronisé »)
  sync: { state: "idle", code: null, cat: "none" }, // dernière synchronisation
  busy: false,           // enable/disable/test en cours
  syncing: false,        // synchro (auto, réessai ou manuelle) en cours
  testResult: null,
  testFailed: false,
  actionError: false,
});

let state = initialState();
const listeners = new Set();

const set = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const setSync = (sync) => set({ sync });

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => state;

export const usePushSync = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

// Catégorisation d'un échec : seul {cat, code} survit — jamais l'endpoint, la
// clé ou un texte serveur (interdits à l'affichage comme au journal).
export const categorizeSyncError = (e) => {
  if (e && e.swError) return { cat: "sw", code: null };
  const code = e?.response?.status ?? null;
  if (code === 503) return { cat: "vapid", code };
  if (code === 401 || code === 403) return { cat: "auth", code };
  if (code === 422) return { cat: "invalid", code };
  if (code) return { cat: "http", code };
  return { cat: "network", code: null };
};

// register() puis `ready` : register() seul peut résoudre alors que le worker
// est encore en installation/activation — pushManager rejette alors. `ready`
// attend l'activation ; le garde-fou borne l'attente (catégorie « sw »).
const withActiveWorker = async () => {
  let timer;
  const ready = navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .catch((e) => {
      e.swError = true;
      throw e;
    });
  try {
    return await Promise.race([
      ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error("service worker non actif");
          err.swError = true;
          reject(err);
        }, SW_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

let retryTimer = null;
let retryUsed = false;
let started = false;

const clearRetry = () => {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
};

const scheduleRetry = () => {
  if (retryUsed || retryTimer) return;
  retryUsed = true;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    syncNow();
  }, RETRY_DELAY);
};

// Synchronisation (ré)abonnement + envoi au serveur. Aucun arrêt silencieux :
// chaque issue (réussite, catégorie d'échec, arrêt pour permission/clés) est
// enregistrée. L'inscription serveur est idempotente (upsert par endpoint).
const syncNow = async () => {
  if (!pushSupported() || state.syncing) return;
  clearRetry(); // un démarrage manuel annule le réessai programmé
  set({ syncing: true });
  try {
    // Le statut serveur est chargé même sans permission accordée : le journal
    // et le compteur d'appareils doivent rester visibles sur la page.
    const { data: st } = await api.get("/admin/notifications/status");
    set({ status: st });
    const permission = Notification.permission;
    set({ permission });
    if (permission !== "granted") {
      setSync({ state: "idle", code: null, cat: "none" });
      return;
    }
    if (!st?.vapid_configured) {
      setSync({ state: "failed", code: null, cat: "vapid" });
      return;
    }
    const { data: cfg } = await api.get("/admin/push/config");
    if (!cfg?.configured || !cfg.public_key) {
      setSync({ state: "failed", code: null, cat: "vapid" });
      return;
    }
    const registration = await withActiveWorker();
    let sub = await registration.pushManager.getSubscription();
    if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key) });
    await api.post("/admin/push/subscriptions", sub.toJSON());
    set({ deviceSynced: true, off: false });
    setSync({ state: "ok", code: null, cat: "none" });
    retryUsed = false;
  } catch (e) {
    const { cat, code } = categorizeSyncError(e);
    if (Notification.permission === "granted") set({ deviceSynced: false });
    setSync({ state: "failed", code, cat });
    scheduleRetry();
  } finally {
    set({ syncing: false });
  }
};

// Une seule synchro automatique par visite de l'admin : la pastille (montée
// dans AdminLayout) et la page l'appellent toutes les deux au montage.
const ensureStarted = () => {
  if (started || !pushSupported()) return;
  started = true;
  syncNow();
};

const refreshStatus = async () => {
  const { data } = await api.get("/admin/notifications/status");
  set({ status: data });
  return data;
};

// Activation = interrupteur ON ou demande de permission. Même requête que la
// synchro auto (même URL, même corps toJSON) — la seule différence historique
// était `ready` vs `register()`, ici on attend toujours `ready`.
const enable = async () => {
  if (state.busy || !pushSupported()) return;
  set({ busy: true, actionError: false });
  try {
    const granted = await Notification.requestPermission();
    set({ permission: granted });
    if (granted !== "granted") {
      setSync({ state: "idle", code: null, cat: "none" });
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();
    const { data: cfg } = await api.get("/admin/push/config");
    const key = cfg?.public_key ? keyBytes(cfg.public_key) : null;
    if (!key) {
      set({ actionError: true });
      setSync({ state: "failed", code: null, cat: "vapid" });
      return;
    }
    // Clé serveur changée : on remplace l'abonnement (rotation VAPID).
    if (sub?.options?.applicationServerKey && Array.from(new Uint8Array(sub.options.applicationServerKey)).some((v, i) => v !== key[i])) {
      await api.delete("/admin/push/subscriptions", { data: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.post("/admin/push/subscriptions", sub.toJSON());
    set({ deviceSynced: true, off: false });
    setSync({ state: "ok", code: null, cat: "none" });
    retryUsed = false;
    refreshStatus().catch(() => {});
  } catch (e) {
    set({ actionError: true });
    setSync({ state: "failed", ...categorizeSyncError(e) });
  } finally {
    set({ busy: false });
  }
};

const disable = async () => {
  if (state.busy || !pushSupported()) return;
  set({ busy: true, actionError: false });
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await api.delete("/admin/push/subscriptions", { data: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    set({ deviceSynced: false, off: true });
    setSync({ state: "idle", code: null, cat: "none" });
    refreshStatus().catch(() => {});
  } catch (_) {
    set({ actionError: true });
  } finally {
    set({ busy: false });
  }
};

// Vrai test : même chemin que les vraies alertes, résultat traduit selon
// status+reason uniquement (jamais de texte serveur brut).
const runTest = async () => {
  if (state.busy) return;
  set({ busy: true, testResult: null, testFailed: false });
  try {
    const { data } = await api.post("/admin/notifications/test");
    if (data && typeof data === "object") set({ testResult: data });
    else set({ testFailed: true });
    refreshStatus().catch(() => {});
  } catch (_) {
    set({ testFailed: true });
  } finally {
    set({ busy: false });
  }
};

// Isolation entre tests : annule les minuteries et repart d'un état vierge.
const __testReset = () => {
  clearRetry();
  retryUsed = false;
  started = false;
  state = initialState();
  listeners.forEach((l) => l());
};

export const pushSync = { ensureStarted, syncNow, enable, disable, runTest, refreshStatus, __testReset };
