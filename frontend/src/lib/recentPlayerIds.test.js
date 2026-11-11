import {
  MAX_RECENT_PLAYER_IDS,
  RECENT_PLAYER_IDS_KEY,
  readRecentPlayerIds,
  recentPlayerIdList,
  rememberPlayerId,
} from "./recentPlayerIds";

// PL-UX-3 — mémorisation locale des ID joueur : ordre (plus récent d'abord),
// doublons, plafond de 10 par jeu, stockage indisponible, valeurs invalides.

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  global.localStorage.clear();
});

const store = () => JSON.parse(global.localStorage.getItem(RECENT_PLAYER_IDS_KEY) || "{}");

test("aucun ID mémorisé au départ", () => {
  expect(readRecentPlayerIds("pubg-mobile")).toEqual([]);
  expect(recentPlayerIdList("pubg-mobile")).toEqual([]);
});

test("un ID enregistré puis relu : il passe en tête", () => {
  rememberPlayerId("pubg-mobile", "123456789");
  expect(recentPlayerIdList("pubg-mobile")).toEqual(["123456789"]);
  expect(store()["pubg-mobile"][0]).toEqual({ id: "123456789", usedAt: expect.any(Number) });
});

test("les ID sont rangés par ordre d'utilisation (le plus récent d'abord)", () => {
  rememberPlayerId("g", "111");
  rememberPlayerId("g", "222");
  rememberPlayerId("g", "333");
  expect(recentPlayerIdList("g")).toEqual(["333", "222", "111"]);
});

test("un ID déjà présent remonte en tête sans doublon", () => {
  rememberPlayerId("g", "111");
  rememberPlayerId("g", "222");
  rememberPlayerId("g", "111");
  const ids = recentPlayerIdList("g");
  expect(ids).toEqual(["111", "222"]);
  expect(new Set(ids).size).toBe(ids.length);
});

test("10 ID maximum par jeu : les plus anciens sortent", () => {
  for (let i = 1; i <= 12; i += 1) rememberPlayerId("g", `id-${i}`);
  const ids = recentPlayerIdList("g");
  expect(ids).toHaveLength(MAX_RECENT_PLAYER_IDS);
  expect(ids[0]).toBe("id-12");
  expect(ids).not.toContain("id-1");
  expect(ids).not.toContain("id-2");
});

test("les jeux sont cloisonnés", () => {
  rememberPlayerId("g1", "aaa");
  rememberPlayerId("g2", "bbb");
  expect(recentPlayerIdList("g1")).toEqual(["aaa"]);
  expect(recentPlayerIdList("g2")).toEqual(["bbb"]);
});

test("valeurs invalides ignorées (vide, non-chaîne, trop long)", () => {
  rememberPlayerId("g", "");
  rememberPlayerId("g", "   ");
  rememberPlayerId("g", 42);
  rememberPlayerId("g", null);
  rememberPlayerId("g", "x".repeat(61));
  expect(recentPlayerIdList("g")).toEqual([]);
});

test("structure de stockage invalide : lecture vide, jamais d'exception", () => {
  global.localStorage.setItem(RECENT_PLAYER_IDS_KEY, "{pas du json");
  expect(readRecentPlayerIds("g")).toEqual([]);
  global.localStorage.setItem(RECENT_PLAYER_IDS_KEY, "[1,2,3]");
  expect(readRecentPlayerIds("g")).toEqual([]);
  global.localStorage.setItem(RECENT_PLAYER_IDS_KEY, JSON.stringify({ g: "nimporte" }));
  expect(readRecentPlayerIds("g")).toEqual([]);
  global.localStorage.setItem(RECENT_PLAYER_IDS_KEY, JSON.stringify({ g: [{ id: 5 }, null, "x", { id: "ok", usedAt: 3 }] }));
  expect(recentPlayerIdList("g")).toEqual(["ok"]);
});

test("stockage indisponible : aucune exception, l'écran reste utilisable", () => {
  const saved = { getItem: Storage.prototype.getItem, setItem: Storage.prototype.setItem };
  const boom = () => { throw new Error("SecurityError"); };
  Object.assign(Storage.prototype, { getItem: boom, setItem: boom });
  try {
    expect(readRecentPlayerIds("g")).toEqual([]);
    expect(() => rememberPlayerId("g", "123")).not.toThrow();
    expect(recentPlayerIdList("g")).toEqual([]);
  } finally {
    Object.assign(Storage.prototype, saved);
  }
});

test("aucun pseudo mémorisé : seuls id et usedAt sont écrits", () => {
  rememberPlayerId("g", "123456789");
  const entries = store().g;
  expect(Object.keys(entries[0]).sort()).toEqual(["id", "usedAt"]);
});
