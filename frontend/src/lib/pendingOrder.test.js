import {
  readPendingOrderId, writePendingOrderId, clearPendingOrderId, candidateOrderId,
} from "./pendingOrder";

// PL-CHK-3 — mémorisation minimale de la commande en attente (invité) :
// uniquement { id, createdAt }, try/catch partout, péremption 24 h.

const KEY = "mgs_pending_order_id";
let rawStore = global.localStorage;

beforeEach(() => {
  rawStore = global.localStorage;
  global.localStorage.clear();
  expect(() => clearPendingOrderId()).not.toThrow();
});

afterEach(() => { global.localStorage = rawStore; });

test("écrit puis relit {id, createdAt} — et rien d'autre", () => {
  const now = new Date("2026-11-10T12:00:00Z").toISOString();
  writePendingOrderId("ord_1", now);
  const raw = JSON.parse(global.localStorage.getItem(KEY));
  expect(Object.keys(raw).sort()).toEqual(["createdAt", "id"]); // aucun autre champ (téléphone, nom…)
  expect(raw).toEqual({ id: "ord_1", createdAt: now });
  expect(candidateOrderId()).toBe("ord_1");
});

test("entrée inconnue / corrompue : read renvoie null (jamais de plantage)", () => {
  global.localStorage.setItem(KEY, "{pas-du-json");
  expect(readPendingOrderId()).toBeNull();
  expect(candidateOrderId()).toBeNull();
});

test("entrée de plus de 24 h : candidateOrderId la purge", () => {
  global.localStorage.setItem(KEY, JSON.stringify({ id: "ord_old", createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() }));
  expect(candidateOrderId()).toBeNull();
  expect(global.localStorage.getItem(KEY)).toBeNull(); // périmée → retirée
});

test("stockage indisponible : aucun plantage", () => {
  writePendingOrderId("ord_2", new Date().toISOString());
  // jsdom : localStorage est un Proxy — seule la surcharge au niveau du
  // prototype simule un storage bloqué (onglet privé, quota, sandbox).
  const saved = { getItem: Storage.prototype.getItem, setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem, clear: Storage.prototype.clear };
  const boom = () => { throw new Error("SecurityError"); };
  Object.assign(Storage.prototype, { getItem: boom, setItem: boom, removeItem: boom, clear: boom });
  try {
    expect(readPendingOrderId()).toBeNull();
    expect(candidateOrderId()).toBeNull();
    expect(() => writePendingOrderId("x", null)).not.toThrow();
    expect(() => clearPendingOrderId()).not.toThrow();
  } finally {
    Object.assign(Storage.prototype, saved);
  }
  expect(global.localStorage.getItem(KEY)).toContain("ord_2"); // prototype restauré, donnée intacte
});
