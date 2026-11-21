/**
 * proto-logic.test.mjs — tests Node des deux modules de logique du prototype.
 *
 * Aucun réseau, aucun navigateur, aucune dépendance : chaque module est chargé
 * dans un contexte `node:vm` isolé, avec un DOM factice minimal (captcha) et un
 * transport HTTP simulé (crypto).
 *
 * Lancer : cd frontend && node scripts/proto-logic.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

/* ---------- chargeur ---------- */
function loadModule(file, globals) {
  const source = fs.readFileSync(path.join(PUBLIC, file), "utf8");
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, ...globals });
  vm.runInContext(source, ctx, { filename: file });
  return ctx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- DOM factice (captcha) ---------- */
function makeDom() {
  const dom = {
    ok: true,
    key: "",
    appended: [],
    documentElement: { classList: { contains: () => false }, lang: "fr" },
    head: {
      children: [],
      appendChild(el) {
        this.children.push(el);
        el.parentNode = this;
        dom.appended.push(el.src);
        Promise.resolve().then(() => {
          if (!dom.ok) { if (el.onerror) el.onerror(); return; }
          if (el.onload) el.onload();
        });
      },
      removeChild(el) {
        const i = this.children.indexOf(el);
        if (i >= 0) this.children.splice(i, 1);
      },
    },
    querySelector(sel) {
      if (sel === 'meta[name="mgs-turnstile-sitekey"]') {
        return dom.key ? { getAttribute: () => dom.key } : null;
      }
      return null;
    },
    createElement() {
      return { src: "", async: false, onload: null, onerror: null, parentNode: null };
    },
  };
  return dom;
}

function makeTurnstile() {
  const calls = { render: [], reset: [], remove: [] };
  let opts = null;
  const stub = {
    calls,
    render(container, o) { opts = o; calls.render.push({ container, o }); return 7; },
    reset(id) { calls.reset.push(id); },
    remove(id) { calls.remove.push(id); },
    solve(token) { if (opts && opts.callback) opts.callback(token); },
    expire() { if (opts && opts["expired-callback"]) opts["expired-callback"](); },
    fail() { if (opts && opts["error-callback"]) opts["error-callback"](); },
    get opts() { return opts; },
  };
  return stub;
}

/* deepStrictEqual compare aussi les prototypes : les objets créés dans un
 * contexte vm n'ont pas celui du test. On compare la forme sérialisée. */
function same(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

/* ---------- runner ---------- */
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log("  ✓ " + name); }
  catch (e) { results.push({ name, ok: false, error: e }); console.log("  ✗ " + name + "\n      " + (e && e.message ? e.message.split("\n")[0] : e)); }
}

/* ===================================================================== */
/*  CAPTCHA                                                              */
/* ===================================================================== */
console.log("MGS_CAPTCHA");

await test("sans clé : désactivé, jeton vide, render refusé sans script", async () => {
  const dom = makeDom();
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom });
  assert.equal(ctx.MGS_CAPTCHA.enabled(), false);
  assert.equal(ctx.MGS_CAPTCHA.getToken(), "");
  const r = await ctx.MGS_CAPTCHA.render({}, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "disabled");
  assert.equal(dom.appended.length, 0, "aucun <script> injecté sans clé");
});

await test("clé injectée : options identiques à main, jeton, reset, expiration", async () => {
  const dom = makeDom();
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom, MGS_TURNSTILE_SITE_KEY: "0x4AAAA-test" });
  const ts = makeTurnstile();
  ctx.turnstile = undefined; // force le chargement du script
  const events = { token: [], expire: 0 };
  const container = { id: "slot" };

  const p = ctx.MGS_CAPTCHA.render(container, {
    onToken: (v) => events.token.push(v),
    onExpire: () => { events.expire++; },
  });
  // le script n'est pas encore chargé : le faux DOM va le poser
  dom.head.children[0] && (ctx.turnstile = ts);
  // le faux onload lit ctx.turnstile au moment du callback
  ctx.turnstile = ts;
  const r = await p;

  assert.equal(r.ok, true);
  assert.equal(r.code, "ready");
  assert.equal(dom.appended.length, 1);
  assert.match(dom.appended[0], /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);

  const o = ts.opts;
  assert.equal(o.sitekey, "0x4AAAA-test");
  assert.equal(o.size, "flexible");
  assert.equal(o.appearance, "interaction-only");
  assert.equal(o.theme, "light");
  assert.equal(o.language, "fr");
  assert.equal(ts.calls.render[0].container, container);

  assert.equal(ctx.MGS_CAPTCHA.getToken(), "");
  ts.solve("jeton-1");
  same(events.token, ["jeton-1"]);
  assert.equal(ctx.MGS_CAPTCHA.getToken(), "jeton-1");

  const reset = ctx.MGS_CAPTCHA.reset();
  assert.equal(reset.ok, true);
  same(ts.calls.reset, [7]);
  assert.equal(ctx.MGS_CAPTCHA.getToken(), "");

  ts.solve("jeton-2");
  ts.expire();
  assert.equal(ctx.MGS_CAPTCHA.getToken(), "");
  assert.equal(events.expire, 1);
  assert.equal(events.token[events.token.length - 1], "");
});

await test("apparence « always » quand l'API exige une interaction", async () => {
  const dom = makeDom();
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom, MGS_TURNSTILE_SITE_KEY: "k" });
  const ts = makeTurnstile();
  ctx.turnstile = ts;
  const r = await ctx.MGS_CAPTCHA.render({}, { appearance: "always" });
  assert.equal(r.ok, true);
  assert.equal(ts.opts.appearance, "always");
});

await test("thème sombre et langue anglaise suivis", async () => {
  const dom = makeDom();
  dom.documentElement.classList.contains = (c) => c === "dark";
  dom.documentElement.lang = "en";
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom, MGS_TURNSTILE_SITE_KEY: "k" });
  const ts = makeTurnstile();
  ctx.turnstile = ts;
  await ctx.MGS_CAPTCHA.render({}, {});
  assert.equal(ts.opts.theme, "dark");
  assert.equal(ts.opts.language, "en");
});

await test("langue : mgs_lang prioritaire sur l'attribut lang du document", async () => {
  const dom = makeDom();
  dom.documentElement.lang = "fr";
  const ctx = loadModule("mgs-logic-captcha.js", {
    document: dom,
    MGS_TURNSTILE_SITE_KEY: "k",
    localStorage: { getItem: (k) => (k === "mgs_lang" ? "en" : null) },
  });
  const ts = makeTurnstile();
  ctx.turnstile = ts;
  await ctx.MGS_CAPTCHA.render({}, {});
  assert.equal(ts.opts.language, "en");
});

await test("clé lue dans la balise meta", async () => {
  const dom = makeDom();
  dom.key = " 0xMETA ";
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom });
  assert.equal(ctx.MGS_CAPTCHA.enabled(), true);
  assert.equal(ctx.MGS_CAPTCHA.siteKey(), "0xMETA");
});

await test("échec du CDN : code load_failed, balise retirée, nouvelle tentative possible", async () => {
  const dom = makeDom();
  dom.ok = false;
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom, MGS_TURNSTILE_SITE_KEY: "k" });
  const first = await ctx.MGS_CAPTCHA.render({}, {});
  assert.equal(first.ok, false);
  assert.equal(first.code, "load_failed");
  assert.equal(dom.head.children.length, 0, "pas de balise morte");

  dom.ok = true;
  const ts = makeTurnstile();
  const second = ctx.MGS_CAPTCHA.render({}, {});
  ctx.turnstile = ts;
  const r = await second;
  assert.equal(r.ok, true);
  assert.equal(dom.appended.length, 2);
});

await test("isCaptchaError : contrat backend + ancien déploiement", () => {
  const dom = makeDom();
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom });
  const f = ctx.MGS_CAPTCHA.isCaptchaError;
  assert.equal(f({ status: 400, code: "captcha_required" }), true);
  assert.equal(f({ status: 400, response: { data: { code: "captcha_required" } } }), true);
  assert.equal(f({ status: 428 }), true);
  assert.equal(f({ status: 500, detail: "turnstile unavailable" }), true);
  assert.equal(f({ status: 400, detail: "Prix invalide" }), false);
  assert.equal(f(null), false);
});

await test("signal d'interaction : before/after-interactive-callback -> onInteractive", async () => {
  const dom = makeDom();
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom, MGS_TURNSTILE_SITE_KEY: "k" });
  const ts = makeTurnstile();
  ctx.turnstile = ts;
  const events = [];
  const r = await ctx.MGS_CAPTCHA.render({}, { onInteractive: (v) => events.push(v) });
  assert.equal(r.ok, true);
  assert.equal(typeof ts.opts["before-interactive-callback"], "function");
  assert.equal(typeof ts.opts["after-interactive-callback"], "function");
  ts.opts["before-interactive-callback"]();
  ts.opts["after-interactive-callback"]();
  same(events, [true, false]);
});

await test("codes captcha : no_container, render_failed, reset no_widget/disabled", async () => {
  const dom = makeDom();
  const ctx = loadModule("mgs-logic-captcha.js", { document: dom, MGS_TURNSTILE_SITE_KEY: "k" });
  const nc = await ctx.MGS_CAPTCHA.render(null, {});
  assert.equal(nc.ok, false);
  assert.equal(nc.code, "no_container");
  const rw = ctx.MGS_CAPTCHA.reset();
  assert.equal(rw.ok, false);
  assert.equal(rw.code, "no_widget");
  ctx.turnstile = { render() { throw new Error("boom"); }, reset() {}, remove() {} };
  const rf = await ctx.MGS_CAPTCHA.render({}, {});
  assert.equal(rf.ok, false);
  assert.equal(rf.code, "render_failed");
  const ctx2 = loadModule("mgs-logic-captcha.js", { document: makeDom() });
  const rd = ctx2.MGS_CAPTCHA.reset();
  assert.equal(rd.ok, false);
  assert.equal(rd.code, "disabled");
});

/* ===================================================================== */
/*  CRYPTO                                                               */
/* ===================================================================== */
console.log("MGS_CRYPTO");

function cryptoModule() {
  const calls = [];
  const ctx = loadModule("mgs-logic-crypto.js", {});
  ctx.MGS_CRYPTO.useTransport((method, p, body) => {
    calls.push({ method, path: p, body });
    return Promise.resolve({ status: 200, data: {} });
  });
  return { ctx, api: ctx.MGS_CRYPTO, calls };
}

const PAYMENT_RAW = {
  id: "pay-1", order_id: "o1", order_number: "MGS-001", network: "TRC20",
  binance_network: "TRX", currency: "USDT", address: "TXyz1234567890abcd", memo: null,
  rate_ar_per_usdt: 4500, amount_ar: 12500, base_usdt: "2.78", amount_usdt: "2.7812",
  status: "WAITING", tx_hash: null, created_at: "2026-11-21T07:00:00+00:00",
  expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
};

await test("loadConfig : mappe available / networks / memoRequired", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({
    status: 200,
    data: {
      available: true, currency: "USDT", expiry_minutes: 30,
      networks: [{ key: "TRC20", label: "Tron (TRC20)", memo_required: false }, { key: "TON", label: "TON", memo_required: true }],
    },
  }));
  const r = await api.loadConfig();
  assert.equal(r.ok, true);
  assert.equal(r.available, true);
  assert.equal(r.expiryMinutes, 30);
  same(r.networks, [
    { key: "TRC20", label: "Tron (TRC20)", memoRequired: false },
    { key: "TON", label: "TON", memoRequired: true },
  ]);
});

await test("loadConfig : indisponible => réseaux vides ; 500 => http_500 ; réseau => network_error", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 200, data: { available: false, currency: "USDT", expiry_minutes: 30, networks: [{ key: "TRC20" }] } }));
  let r = await api.loadConfig();
  assert.equal(r.ok, true);
  assert.equal(r.available, false);
  same(r.networks, []);

  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 500, data: { detail: "boom" } }));
  r = await api.loadConfig();
  assert.equal(r.ok, false);
  assert.equal(r.code, "http_500");

  ctx.MGS_CRYPTO.useTransport(() => Promise.reject(new Error("offline")));
  r = await api.loadConfig();
  assert.equal(r.ok, false);
  assert.equal(r.code, "network_error");
});

await test("initiate : POST /crypto/initiate avec { order_id, network } et paiement normalisé", async () => {
  const { ctx, api, calls } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport((method, p, body) => {
    calls.push({ method, path: p, body });
    return Promise.resolve({ status: 200, data: PAYMENT_RAW });
  });
  const r = await api.initiate("o1", "TRC20");
  assert.equal(r.ok, true);
  assert.equal(r.code, "ok");
  same(calls, [{ method: "POST", path: "/crypto/initiate", body: { order_id: "o1", network: "TRC20" } }]);
  assert.equal(r.payment.id, "pay-1");
  assert.equal(r.payment.orderId, "o1");
  assert.equal(r.payment.amountUsdt, "2.7812");
  assert.equal(r.payment.address, "TXyz1234567890abcd");
  assert.equal(r.payment.status, "WAITING");
  assert.ok(r.payment.expiresInMs > 0 && r.payment.expiresInMs <= 10 * 60000);
});

await test("initiate : réseau inconnu refusé sans appel réseau", async () => {
  const { api, calls } = cryptoModule();
  const r = await api.initiate("o1", "DOGE");
  assert.equal(r.ok, false);
  assert.equal(r.code, "invalid_network");
  assert.equal(calls.length, 0);
});

await test("initiate : codes d'erreur du backend", async () => {
  const cases = [
    [400, "Cette commande n'utilise pas Binance USDT.", "not_binance"],
    [400, "Réseau USDT non disponible.", "network_unavailable"],
    [400, "Paramètre invalide.", "bad_request"],
    [403, "Forbidden", "forbidden"],
    [404, "Order not found", "order_not_found"],
    [409, "Un paiement USDT est déjà en cours pour cette commande.", "already_open"],
    [409, "Cette commande n'est plus en attente de paiement.", "not_pending"],
    [409, "Paiement Binance USDT indisponible.", "unavailable"],
    [429, "Trop de requêtes", "rate_limited"],
    [503, "Trop de paiements USDT en cours. Réessayez dans quelques minutes.", "too_many"],
  ];
  for (const [status, detail, expected] of cases) {
    const ctx = loadModule("mgs-logic-crypto.js", {});
    ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status, data: { detail } }));
    const r = await ctx.MGS_CRYPTO.initiate("o1", "BEP20");
    assert.equal(r.ok, false, `statut ${status} doit échouer`);
    assert.equal(r.code, expected, `statut ${status} / « ${detail} »`);
    assert.equal(r.detail, detail);
  }
});

await test("initiate : erreur réseau => network_error", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.reject(new Error("down")));
  const r = await api.initiate("o1", "TRC20");
  assert.equal(r.ok, false);
  assert.equal(r.code, "network_error");
});

await test("statusOf : GET /crypto/{order}/status, orderStatus + payment", async () => {
  const { ctx, api, calls } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport((method, p) => {
    calls.push({ method, path: p });
    return Promise.resolve({ status: 200, data: { order_status: "pending_payment", payment: PAYMENT_RAW } });
  });
  const r = await api.statusOf("o1");
  assert.equal(r.ok, true);
  assert.equal(r.orderStatus, "pending_payment");
  assert.equal(r.payment.id, "pay-1");
  same(calls, [{ method: "GET", path: "/crypto/o1/status" }]);

  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 404, data: { detail: "Order not found" } }));
  const missing = await api.statusOf("nope");
  assert.equal(missing.code, "order_not_found");
});

await test("poll : WAITING -> DETECTED -> CONFIRMED, puis arrêt", async () => {
  const { ctx, api } = cryptoModule();
  const statuses = ["WAITING", "DETECTED", "CONFIRMED"];
  let n = 0;
  ctx.MGS_CRYPTO.useTransport(() => {
    const s = statuses[Math.min(n, statuses.length - 1)];
    n++;
    return Promise.resolve({ status: 200, data: { order_status: "pending_payment", payment: { ...PAYMENT_RAW, status: s } } });
  });
  const updates = [];
  api.poll("o1", (u) => updates.push(u), { intervalMs: 5 });
  await sleep(120);
  assert.equal(updates.length, 3);
  assert.equal(updates[0].payment.status, "WAITING");
  assert.equal(updates[2].done, true);
  assert.equal(updates[2].payment.status, "CONFIRMED");
  assert.equal(n, 3, "aucune requête après CONFIRMED");
});

await test("poll : FAILED arrête aussi ; stop() coupe net", async () => {
  const { ctx, api } = cryptoModule();
  let n = 0;
  ctx.MGS_CRYPTO.useTransport(() => {
    n++;
    return Promise.resolve({ status: 200, data: { order_status: "pending_payment", payment: { ...PAYMENT_RAW, status: "FAILED" } } });
  });
  const updates = [];
  api.poll("o1", (u) => updates.push(u), { intervalMs: 5 });
  await sleep(60);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].failed, true);

  n = 0;
  const updates2 = [];
  api.poll("o1", (u) => updates2.push(u), { intervalMs: 5 });
  await sleep(20);
  api.stop();
  const seen = updates2.length;
  await sleep(60);
  assert.equal(updates2.length, seen, "stop() empêche toute requête suivante");
});

await test("poll : erreur réseau => network_error et le sondage continue", async () => {
  const { ctx, api } = cryptoModule();
  let n = 0;
  ctx.MGS_CRYPTO.useTransport(() => {
    n++;
    if (n === 1) return Promise.reject(new Error("down"));
    return Promise.resolve({ status: 200, data: { order_status: "pending_payment", payment: { ...PAYMENT_RAW, status: "WAITING" } } });
  });
  const updates = [];
  api.poll("o1", (u) => updates.push(u), { intervalMs: 5, maxAttempts: 2 });
  await sleep(80);
  assert.equal(updates[0].code, "network_error");
  assert.equal(updates[1].payment.status, "WAITING");
  api.stop();
});

await test("poll : paiement absent et commande non en attente => arrêt", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 200, data: { order_status: "cancelled", payment: null } }));
  const updates = [];
  api.poll("o1", (u) => updates.push(u), { intervalMs: 5 });
  await sleep(60);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payment, null);
  assert.equal(updates[0].orderStatus, "cancelled");
});

await test("payment(null) => null ; expires_at absent => expiresInMs 0", () => {
  const { api } = cryptoModule();
  assert.equal(api.payment(null), null);
  const p = api.payment({ id: "x" });
  assert.equal(p.expiresInMs, 0);
  assert.equal(p.expiresAt, "");
  assert.equal(p.currency, "USDT");
});

await test("transport par défaut : /api + cookies, JSON décodé", async () => {
  const seen = [];
  const ctx = loadModule("mgs-logic-crypto.js", {
    MGS_BACKEND_URL: "https://example.test/",
    fetch: (url, opts) => {
      seen.push({ url, opts });
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ available: true, currency: "USDT", expiry_minutes: 30, networks: [] })) });
    },
  });
  const r = await ctx.MGS_CRYPTO.loadConfig();
  assert.equal(r.ok, true);
  assert.equal(seen[0].url, "https://example.test/api/crypto/config");
  assert.equal(seen[0].opts.credentials, "include");
});

await test("initiate : reprise du même réseau -> 200 ok (paiement existant)", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 200, data: { ...PAYMENT_RAW, network: "TRC20" } }));
  const r = await api.initiate("o1", "TRC20");
  assert.equal(r.ok, true);
  assert.equal(r.code, "ok");
  assert.equal(r.payment.network, "TRC20");
  assert.equal(r.payment.id, "pay-1");
});

await test("statusOf : 403 -> forbidden", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 403, data: { detail: "Forbidden" } }));
  const r = await api.statusOf("o1");
  assert.equal(r.ok, false);
  assert.equal(r.code, "forbidden");
});

await test("loadConfig : payload non-objet -> bad_payload", async () => {
  const { ctx, api } = cryptoModule();
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 200, data: null }));
  let r = await api.loadConfig();
  assert.equal(r.ok, false);
  assert.equal(r.code, "bad_payload");
  ctx.MGS_CRYPTO.useTransport(() => Promise.resolve({ status: 200, data: "texte" }));
  r = await api.loadConfig();
  assert.equal(r.code, "bad_payload");
});

await test("payment : expires_at passé -> expiresInMs 0 (jamais négatif)", () => {
  const { api } = cryptoModule();
  const p = api.payment({ id: "x", expires_at: new Date(Date.now() - 60000).toISOString() });
  assert.equal(p.expiresInMs, 0);
  assert.ok(p.expiresAt.length > 0);
});

await test("poll : échéance commande atteinte -> expired + onExpired + arrêt", async () => {
  const { ctx, api } = cryptoModule();
  let n = 0;
  ctx.MGS_CRYPTO.useTransport(() => { n++; return Promise.resolve({ status: 200, data: { order_status: "pending_payment", payment: { ...PAYMENT_RAW, status: "WAITING" } } }); });
  const updates = []; let expiredCalled = 0;
  api.poll("o1", (u) => updates.push(u), { intervalMs: 5, deadlineAt: new Date(Date.now() - 1000).toISOString(), onExpired: () => { expiredCalled++; } });
  await sleep(60);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].expired, true);
  assert.equal(expiredCalled, 1);
  assert.equal(n, 1, "aucune requête après expiration");
});

await test("statusOf expose orderDeadline ; poll échéance future ne coupe pas avant CONFIRMED", async () => {
  const { ctx, api } = cryptoModule();
  const deadline = new Date(Date.now() + 60000).toISOString();
  let n = 0;
  ctx.MGS_CRYPTO.useTransport(() => { n++; const s = n >= 2 ? "CONFIRMED" : "WAITING"; return Promise.resolve({ status: 200, data: { order_status: "pending_payment", payment_deadline_at: deadline, payment: { ...PAYMENT_RAW, status: s } } }); });
  const so = await api.statusOf("o1");
  assert.equal(so.orderDeadline, deadline);
  const updates = [];
  api.poll("o1", (u) => updates.push(u), { intervalMs: 5 });
  await sleep(80);
  assert.equal(updates[updates.length - 1].done, true);
  assert.ok(updates.every((u) => !u.expired));
});

/* ---------- bilan ---------- */
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (${results.length} tests)`);
process.exit(failed.length ? 1 : 0);
