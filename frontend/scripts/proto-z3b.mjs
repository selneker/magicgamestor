/**
 * proto-z3b.mjs — auto-contrôle Playwright des fonctions Z3b (paiement Binance) du prototype.
 *
 * Vérifie, sur build/index.html servi tel quel, avec l'API mockée :
 *   (c) commande Binance créée via POST /orders puis POST /crypto/initiate { order_id, network } ;
 *   (d) écran data-co=2 Binance (USDT + réseau + montant + adresse) peuplé ;
 *   (e) sondage GET /crypto/{id}/status toutes les 8 s, arrêt sur statut final (CONFIRMED/FAILED).
 *
 * Deux viewports (390 px, 1440 px). Thème clair uniquement.
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-z3b.mjs
 *
 * Interdits respectés : aucun autre fichier modifié, pas de base de démo, pas d'API déployée,
 * pas de secret lu, pas de git add/commit/push (le testeur commet CE fichier seul).
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, "..", "build", "index.html");
const VIEWPORTS = [
  { label: "390px", width: 390, height: 844 },
  { label: "1440px", width: 1440, height: 900 },
];

function findChromium() {
  const c = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
    path.join(process.env.HOME || "", ".hermes/tools/chromium-1248/chrome-linux64/chrome"),
  ].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch { /* */ } }
  console.error("[erreur] CHROMIUM_PATH introuvable");
  process.exit(2);
}

function serveBuild() {
  const root = path.join(__dirname, "..", "build");
  const types = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon",
    ".json": "application/json",
  };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    let fp = path.normalize(path.join(root, rel));
    if (!fp.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (rel === "/" || !path.extname(fp)) fp = path.join(root, "index.html");
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": (types[path.extname(fp)] || "application/octet-stream") + "; charset=utf-8" });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}/index.html` })));
}

const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", active: true, sort_order: 0, identity_fields: [{ key: "pubg_id", primary: true, label: "ID PUBG" }] },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", active: true, sort_order: 1, identity_fields: [{ key: "ff_id", primary: true, label: "ID Free Fire" }] },
];
const PRODUCTS = [
  { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 12500, uc_amount: 660, type: "uc", game_id: "pubg-mobile", image_url: "" },
];
const USER = {
  user_id: "u1", name: "Test Player", email: "test@mg.store", phone: "0340000000",
  saved_pubg_ids: ["123456789"], created_at: "2026-01-01T00:00:00Z",
};
const CRYPTO_CONFIG = {
  available: true, currency: "USDT", expiryMinutes: 30,
  networks: [{ key: "TRC20", label: "TRON (TRC20)", memo_required: false }, { key: "BEP20", label: "BNB Chain (BEP20)", memo_required: false }],
};
const ORDER_BASE = {
  id: "ord_1", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0,
  status: "pending_payment", payment_method: "binance", manual_operator: null,
  pubg_id: "52328390220", pseudo: "TestPlayer", game_id: "pubg-mobile",
  payment_deadline_at: new Date(Date.now() + 15 * 60_000).toISOString(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 12500, line_total: 12500 }],
  created_at: "2026-11-10T09:00:00Z",
};

const boot = (page) => page.waitForFunction(
  () => typeof window.mgsRenderRecent === "function" && document.querySelectorAll(".mgs-page").length > 0,
  null, { timeout: 20000 }
);

/* ---------- API mock : intercepte /api/ et /crypto/ quel que soit l'host (MGS_CRYPTO fait un fetch absolu) ---------- */
function apiHandler(page, state) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let p = url.pathname;
    if (p.startsWith("/api/")) p = p.slice(5);
    const method = req.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    const pd = req.postData();
    let body = undefined;
    if (pd) { try { body = JSON.parse(pd); } catch { body = pd; } }
    state.calls.push({ method, path: p, body, at: Date.now() });

    if (p === "/auth/me" && method === "GET") return state.loggedIn ? json(USER) : json({ detail: "Non authentifié" }, 401);
    if (p === "/auth/login" && method === "POST") { state.loggedIn = true; return json({ user: USER, access_token: "t" }); }
    if (p === "/auth/logout" && method === "POST") { state.loggedIn = false; return json({ ok: true }); }
    if (p === "/games" && method === "GET") return json(GAMES);
    if (p === "/products" && method === "GET") {
      const g = url.searchParams.get("game");
      return json(PRODUCTS.filter((x) => !g || x.game_id === g));
    }
    const pm = /^\/products\/([\w-]+)$/.exec(p);
    if (pm && method === "GET") {
      const pr = PRODUCTS.find((x) => x.slug === pm[1]);
      return pr ? json(pr) : json({ detail: "not found" }, 404);
    }
    if (p === "/payments/config" && method === "GET") return json({ mode: "papi", providers: {} });
    if (p === "/fazercards/validate-id" && method === "POST") return json({ valid: true, player_name: "TestPlayer", region: "MG" });

    /* Binance config */
    if (p === "/crypto/config" && method === "GET") return json(CRYPTO_CONFIG);

    if (p === "/orders" && method === "POST") {
      const order = {
        ...ORDER_BASE,
        id: "ord_" + Date.now(),
        order_number: "MGS-" + String(Date.now()).slice(-6),
        payment_method: "binance",
        manual_operator: null,
        pubg_id: body.pubg_id || ORDER_BASE.pubg_id,
        pseudo: body.pseudo || ORDER_BASE.pseudo,
        game_id: body.game_id || ORDER_BASE.game_id,
        items: (body.items || []).map((it) => {
          const pr = PRODUCTS.find((x) => x.id === it.product_id) || {};
          return { product_id: it.product_id, quantity: it.quantity, name: pr.name || it.product_id, uc_amount: pr.uc_amount };
        }),
      };
      state.orders.push(order);
      state.lastOrder = order;
      return json(order, 201);
    }
    if (p === "/orders/me" && method === "GET") return json(state.orders);
    if (/^\/orders\/([\w-]+)$/.test(p) && method === "GET") {
      const id = p.split("/")[2];
      const order = state.orders.find((o) => o.id === id) || { ...ORDER_BASE, id };
      return json(order);
    }

    /* Binance : POST /crypto/initiate { order_id, network } */
    if (p === "/crypto/initiate" && method === "POST") {
      const order = state.orders.find((o) => o.id === body.order_id) || state.lastOrder || { ...ORDER_BASE, id: body.order_id };
      state.initiateCalls.push(body);
      return json({ ok: true, code: "ok", payment: {
        id: "pay_" + Date.now(), order_id: order.id, order_number: order.order_number,
        network: body.network || "TRC20", currency: "USDT",
        address: "TXYq1testAddress", memo: "", amount_usdt: String(order.total / 1000000),
        status: "WAITING", created_at: new Date().toISOString(),
        expires_at: order.payment_deadline_at,
      } });
    }

    /* Binance : GET /crypto/{id}/status (sondage 8 s, arrêt CONFIRMED/FAILED) */
    if (/^\/crypto\/([\w-]+)\/status$/.test(p) && method === "GET") {
      const id = p.split("/")[2];
      state.statusCalls.push({ id, at: Date.now() });
      const order = state.orders.find((o) => o.id === id) || { ...ORDER_BASE, id };
      const st = order._cryptoStatus || "WAITING";
      return json({ order_status: order.status, payment: {
        id: "pay_" + id, order_id: order.id, network: "TRC20", currency: "USDT",
        address: "TXYq1testAddress", amount_usdt: String(order.total / 1000000),
        status: st,
      } });
    }

    if (p === "/loyalty/me" && method === "GET") return json({ balance: { total: 120 }, ledger: [] });
    if (p === "/events" && method === "GET") return json([]);
    return json({ detail: "mock: route non gérée " + method + " " + p }, 404);
  };
}

/* ---------- scénario : checkout Binance direct sur /commande -> data-co=2 ---------- */
async function checkoutBinance(page, state) {
  state.loggedIn = true;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commande"));
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 8000 });

  await page.locator(".mgs-co-id-input").fill("123456789");
  await page.locator(".mgs-co-verify").click();
  await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 10000 });

  await page.locator('.mgs-co-method input[value="Binance"]').locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click();
  await page.waitForFunction(() => document.querySelector('.mgs-co-method input[value="Binance"]').closest(".mgs-co-method").classList.contains("is--active"), null, { timeout: 8000 });

  await page.locator(".mgs-co-submit").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 });
  await page.locator(".mgs-human-cb").setChecked(true);
  await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 });
  await page.locator(".mgs-human-confirm").click();

  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 25000 });
  return state.lastOrder ? state.lastOrder.id : null;
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Z3b(c) POST /orders puis POST /crypto/initiate avec { order_id, network }", async (page, state) => {
  const orderId = await checkoutBinance(page, state);
  assert.ok(orderId, "commande Binance créée");
  const orderCall = state.calls.find((c) => c.method === "POST" && c.path === "/orders");
  assert.ok(orderCall, "POST /orders non appele");
  assert.equal(orderCall.body.payment_method, "binance", "payment_method=binance");
  assert.ok(orderCall.body.pubg_id, "pubg_id present");

  const initCall = state.calls.find((c) => c.method === "POST" && c.path === "/crypto/initiate");
  assert.ok(initCall, "POST /crypto/initiate non appele");
  assert.equal(initCall.body.order_id, orderId, "initiate order_id = commande cree");
  assert.ok(initCall.body.network, "initiate network renseigne");
});

test("Z3b(d) ecran data-co=2 Binance : USDT, reseau, montant, adresse", async (page, state) => {
  await checkoutBinance(page, state);
  const info = await page.evaluate(() => {
    const sel = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : ""; };
    return {
      mname: sel(".mgs-co-mname"),
      total2: sel(".mgs-co-total2"),
      binance: !!document.querySelector(".mgs-co-binance:not([hidden])"),
      hint: sel(".mgs-co-hint"),
    };
  });
  assert.ok(/binance/i.test(info.mname), "moyen Binance affiche : " + info.mname);
  assert.ok(info.binance, "panneau Binance (mgs-co-binance) visible");
  assert.ok(info.hint.length > 0, "details de paiement affiches : " + info.hint);
});

test("Z3b(e) sondage GET /crypto/{id}/status toutes les 8 s pendant le paiement en attente", async (page, state) => {
  const orderId = await checkoutBinance(page, state);
  assert.ok(orderId, "commande creee pour tester le sondage");

  await page.waitForTimeout(18000);
  const statusCalls = state.calls.filter((c) => c.method === "GET" && /^\/crypto\/[\w-]+\/status$/.test(c.path) && c.path.endsWith(orderId));
  assert.ok(statusCalls.length >= 2, "GET /crypto/" + orderId + "/status doit etre appele au moins 2 fois, recu " + statusCalls.length);
  if (statusCalls.length >= 2) {
    const gap = statusCalls[1].at - statusCalls[0].at;
    assert.ok(gap >= 6000 && gap <= 11000, "intervalle entre deux sondages ≈ 8 s (mesure : " + gap + " ms)");
  }
});

test("Z3b(e) arret du sondage GET /crypto/{id}/status sur statut final (CONFIRMED)", async (page, state) => {
  const orderId = await checkoutBinance(page, state);
  assert.ok(orderId, "commande creee pour tester l'arret du sondage");

  const order = state.orders.find((o) => o.id === orderId);
  if (order) { order._cryptoStatus = "CONFIRMED"; }

  await page.waitForTimeout(18000);
  const statusCalls = state.calls.filter((c) => c.method === "GET" && /^\/crypto\/[\w-]+\/status$/.test(c.path) && c.path.endsWith(orderId));
  if (statusCalls.length > 0) {
    const firstAt = statusCalls[0].at;
    const lastAfter15s = statusCalls.filter((c) => c.at - firstAt > 15000);
    assert.equal(lastAfter15s.length, 0, "le sondage doit s'arreter sur CONFIRMED : " + lastAfter15s.length + " appel(s) apres 15 s");
  }
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : lancez `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  const { server, url } = process.env.MGS_PROTO_URL ? { server: null, url: process.env.MGS_PROTO_URL } : await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    console.log("\n=== " + vp.label + " (" + vp.width + "×" + vp.height + ") — thème light ===");
    for (const { name, fn } of tests) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(12000);
      const page = await context.newPage();
      const state = { loggedIn: false, calls: [], orders: [], lastOrder: null, initiateCalls: [], statusCalls: [] };
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript((serverUrl) => {
        try { localStorage.setItem("mgs_lang", "fr"); } catch (e) { }
        window.MGS_BACKEND_URL = serverUrl.replace(/\/index\.html$/, "");
      }, url);
      const handler = apiHandler(page, state);
      /* MGS_CRYPto fait un fetch ABSOLU vers l'host backend. On injecte
       * window.MGS_BACKEND_URL (addInitScript, avant le runtime) ET on intercepte
       * toutes les requêtes /api/ et /crypto/ quel que soit l'host, sans toucher
       * aux assets (polices, images, CSS passent par route.continue()). */
      await page.route("**/api/**", handler);
      await page.route("**/crypto/**", handler);
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await fn(page, state);
        const realErrors = errors.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
        assert.equal(realErrors.length, 0, "erreurs JS page: " + realErrors.join(" | "));
        console.log("  ✓ " + name);
        pass++;
      } catch (e) {
        const msg = e && e.message ? e.message.split("\n")[0] : String(e);
        console.log("  ✗ " + name + "\n      " + msg);
        failures.push("[" + vp.label + "] " + name + ": " + msg);
        fail++;
      } finally { await context.close(); }
    }
  }
  await browser.close();
  if (server) server.close();
  console.log("\n" + pass + " passed, " + fail + " failed (" + tests.length * VIEWPORTS.length + " runs)");
  if (failures.length) { failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
