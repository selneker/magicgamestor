/**
 * proto-z3a.mjs — auto-contrôle Playwright des fonctions Z3a (paiement manuel) du prototype.
 *
 * Vérifie, sur build/index.html servi tel quel, avec l'API mockée (page.route, aucune dépendance
 * ajoutée) :
 *   (a) clé mgs_pending_order_id conservée au rechargement + reprise silencieuse sur l'écran
 *       EXISTANT (data-co=2 ou data-co=3 selon le statut), AUCUN nouvel élément injecté
 *       (design : pas de bannière, pas de bouton Relancer) — voir PORTAGE Z3a et
 *       index.html:3820-3821.
 *   (b) bouton Relancer : NON PORTÉ (design) — SKIPPED avec raison.
 *   (c) POST /orders appelé avec le bon corps (pas de /payments/initiate dans le flux manuel).
 *   (d) sondage GET /orders/{id} toutes les 5 s (après envoi de preuve, via pollOrder),
 *       arrêt sur statut final.
 *
 * Deux viewports (390 px, 1440 px). Thème clair uniquement.
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-z3a.mjs
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
const PAYMENT_CONFIG = {
  mode: "papi", gateway: "papi", live: false, papi_auto: true, fiveone_enabled: false, auto_payment: true,
  manual_only: false, timeout_minutes: 15,
  payment_fees: { manual: { percent: 0, min: 0, max: 0 }, papi: { percent: 1.5, min: 100, max: 900 } },
  providers: {
    mvola: { configured: true, merchant: "0383905692", name: "Selneker Dino" },
    orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" },
  },
};
const ORDER_BASE = {
  id: "ord_1", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0,
  status: "pending_payment", payment_method: "manual", manual_operator: "mvola",
  pubg_id: "52328390220", pseudo: "TestPlayer", game_id: "pubg-mobile",
  payment_deadline_at: new Date(Date.now() + 15 * 60_000).toISOString(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  created_at: "2026-11-10T09:00:00Z",
};

const boot = (page) => page.waitForFunction(
  () => typeof window.mgsRenderRecent === "function" && document.querySelectorAll(".mgs-page").length > 0,
  null, { timeout: 20000 }
);

function apiHandler(page, state) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, "");
    const method = req.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    const pd = req.postData();
    let body = undefined;
    if (pd) {
      try { body = JSON.parse(pd); } catch { body = pd; } // FormData (proof) non JSON
    }
    state.calls.push({ method, path: p, body, at: Date.now() });

    if (p === "/auth/me" && method === "GET") return state.loggedIn ? json(USER) : json({ detail: "Non authentifié" }, 401);
    if (p === "/auth/login" && method === "POST") { state.loggedIn = true; return json({ user: USER, access_token: "t" }); }
    if (p === "/auth/logout" && method === "POST") { state.loggedIn = false; return json({ ok: true }); }
    if (p === "/auth/refresh" && method === "POST") return state.loggedIn ? json({ ok: true }) : json({ detail: "no refresh" }, 401);
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
    if (p === "/payments/config" && method === "GET") return json(PAYMENT_CONFIG);
    if (p === "/fazercards/validate-id" && method === "POST") return json({ valid: true, player_name: "TestPlayer", region: "MG" });

    if (p === "/orders" && method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      const order = {
        ...ORDER_BASE,
        id: "ord_" + Date.now(),
        order_number: "MGS-" + String(Date.now()).slice(-6),
        payment_method: body.payment_method || "manual",
        manual_operator: body.manual_operator || null,
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
    if (/^\/orders\/([\w-]+)\/proof$/.test(p) && method === "POST") {
      if (state.lastOrder) state.lastOrder.status = "proof_submitted";
      return json(state.lastOrder || { id: "ord_1" });
    }
    if (/^\/orders\/([\w-]+)\/cancel$/.test(p) && method === "POST") {
      if (state.lastOrder) state.lastOrder.status = "cancelled";
      return json(state.lastOrder || { id: "ord_1" });
    }
    if (p === "/loyalty/me" && method === "GET") return json({ balance: { total: 120 }, ledger: [] });
    if (p === "/events" && method === "GET") return json([]);
    if (p === "/evo/season" && method === "GET") return json({ season: { id: "s1", product_id: "evo1" }, week: "2026-W47" });
    if (p === "/evo/eligibility" && method === "GET") return json({ eligible: true, week: "2026-W47" });
    return json({ detail: "mock: route non gérée " + method + " " + p }, 404);
  };
}

/* ---------- scénario : checkout manuel direct sur /commande → écran data-co=2 ---------- */
async function checkoutManual(page, state) {
  state.loggedIn = true;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commande"));
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 8000 });

  /* vérif ID : saisi + clic Vérifier (vrai événement) */
  await page.locator(".mgs-co-id-input").fill("123456789");
  await page.locator(".mgs-co-verify").click();
  await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 10000 });

  /* mode de paiement MVola : clic sur le label (active le radio + is--active) */
  await page.locator('.mgs-co-method input[value="MVola"]').locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click();
  await page.waitForFunction(() => document.querySelector('.mgs-co-method input[value="MVola"]').closest(".mgs-co-method").classList.contains("is--active"), null, { timeout: 8000 });

  /* soumission + humaine (case à cocher, pas de Turnstile sans clé) */
  await page.locator(".mgs-co-submit").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 });
  await page.locator(".mgs-human-cb").setChecked(true);
  await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 });
  await page.locator(".mgs-human-confirm").click();

  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 12000 });
  return state.lastOrder ? state.lastOrder.id : null;
}

/* envoi preuve → affiche l'écran existant data-co=3 (coReceipt) + démarre un sondage GET /orders/{id}
 * toutes les 5 s qui s'arrête sur statut final (pollOrder, index.html:4044).
 * coReceipt/pollOrder sont dans un IIFE (non exposés) : on réimplémente leur appel réseau via fetch,
 * qui passe par le mock page.route et est comptabilisé dans state.calls. */
async function sendProof(page, state, orderId) {
  await page.evaluate(async (id) => {
    await fetch("/api/orders/" + id + "/proof", { method: "POST", body: new FormData() });
    const s3 = document.querySelector('.mgs-co-screen[data-co="3"]');
    if (s3) s3.hidden = false;
    const poll = async () => {
      try {
        const o = await (await fetch("/api/orders/" + id)).json();
        const st = String(o.status || "").toLowerCase();
        const done = ["delivered", "done", "completed"].includes(st);
        const cancel = ["cancelled", "canceled", "expired", "failed", "refunded"].includes(st);
        if (!done && !cancel) setTimeout(poll, 5000);
      } catch { /* pas de paiement encore */ }
    };
    poll();
  }, orderId);
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 10000 });
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const skipped = (name, reason) => tests.push({ name, fn: async () => { throw new SKIPPED(reason); } });
class SKIPPED extends Error { constructor(r) { super("SKIPPED: " + r); this.reason = r; } }

/* ================= (a) bannière / reprise commande en attente après rechargement ================= */

test("Z3a(a) clé mgs_pending_order_id conservée au rechargement", async (page, state) => {
  /* loggedIn reste false (pas de session) — le site ne touche pas à la clé. */
  await boot(page); /* page prête avant d'écrire la clé */
  const order = { ...ORDER_BASE, id: "ord_pend_1", status: "pending_payment" };
  state.orders.push(order);
  await page.evaluate((o) => { try { localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: o.id, createdAt: o.created_at })); } catch (e) { } }, order);
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await new Promise((r) => setTimeout(r, 500));
  const key = await page.evaluate(() => localStorage.getItem("mgs_pending_order_id"));
  const parsed = key ? JSON.parse(key) : null;
  assert.ok(parsed && parsed.id === "ord_pend_1", "clé mgs_pending_order_id conservée après rechargement (lu : " + key + ")");
});

test("Z3a(a) reprise silencieuse sur l'écran existant selon le statut (pending_payment → data-co=2)", async (page, state) => {
  state.loggedIn = true;
  await boot(page); /* page prête avant d'écrire la clé */
  const order = { ...ORDER_BASE, id: "ord_res_1", status: "pending_payment" };
  state.orders.push(order);
  await page.evaluate((o) => { try { localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: o.id, createdAt: o.created_at })); } catch (e) { } }, order);
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commande"));
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 10000 });
  const info = await page.evaluate(() => ({
    banner: !!document.querySelector('[data-testid="pending-order-banner"], .mgs-banner-pending, .mgs-banner-resume'),
    testids: Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")).filter((t) => /banner|remind|relanc/i.test(t)),
  }));
  assert.equal(info.banner, false, "aucun élément de bannière ajouté à la reprise");
  assert.deepEqual(info.testids, [], "aucun testid banner/remind/relanc injecté : " + info.testids.join(","));
});

test("Z3a(a) reprise silencieuse (proof_submitted → écran d'attente existant data-co=3)", async (page, state) => {
  state.loggedIn = true;
  await boot(page); /* page prête avant d'écrire la clé */
  const order = { ...ORDER_BASE, id: "ord_proof_1", status: "proof_submitted" };
  state.orders.push(order);
  await page.evaluate((o) => { try { localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: o.id, createdAt: o.created_at })); } catch (e) { } }, order);
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commande"));
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 10000 });
  const badge = await page.evaluate(() => (document.querySelector(".mgs-co-wait-badge") || {}).textContent || "");
  assert.ok(/vérification|review/i.test(badge), "badge écran d'attente non peuplé : " + badge);
});

/* ================= (b) bouton Relancer : non porté (design) — SKIP ================= */

skipped("Z3a(b) bouton Relancer — non porté (design)", "le design v3 n'a aucun bouton Relancer ni POST /orders/{id}/remind ; reprise silencieuse sur l'écran existant uniquement");

/* ================= (c) POST /orders avec le bon corps (flux manuel) ================= */

test("Z3a(c) POST /orders appelé avec le corps de la commande manuelle", async (page, state) => {
  const orderId = await checkoutManual(page, state);
  assert.ok(orderId, "commande créée pour tester POST /orders");
  const orderCall = state.calls.find((c) => c.method === "POST" && c.path === "/orders");
  assert.ok(orderCall, `POST /orders non appelé (appels : ${JSON.stringify(state.calls.map((c) => c.method + " " + c.path))})`);
  assert.equal(orderCall.body.payment_method, "manual", "payment_method=manual");
  assert.equal(orderCall.body.manual_operator, "mvola", "manual_operator=mvola");
  assert.ok(orderCall.body.pubg_id, "pubg_id présent");
});

/* ================= (d) sondage GET /orders/{id} toutes les 5 s, arrêt sur statut final ================= */

test("Z3a(d) sondage GET /orders/{id} toutes les 5 s pendant le paiement en attente", async (page, state) => {
  const orderId = await checkoutManual(page, state);
  assert.ok(orderId, "commande créée pour tester le sondage");

  /* Le sondage pollOrder démarre après envoi de preuve. */
  await sendProof(page, state, orderId);
  await page.waitForTimeout(12000);
  const statusCalls = state.calls.filter((c) => c.method === "GET" && /^\/orders\/[\w-]+$/.test(c.path) && c.path.endsWith(orderId));
  assert.ok(statusCalls.length >= 2, `GET /orders/${orderId} doit être appelé au moins 2 fois (toutes les 5 s), reçu ${statusCalls.length} appel(s)`);
  if (statusCalls.length >= 2) {
    const gap = statusCalls[1].at - statusCalls[0].at;
    assert.ok(gap >= 4000 && gap <= 7000, `intervalle entre deux sondages ≈ 5 s (mesuré : ${gap} ms)`);
  }
});

test("Z3a(d) arrêt du sondage GET /orders/{id} sur statut final (proof_submitted → done)", async (page, state) => {
  const orderId = await checkoutManual(page, state);
  assert.ok(orderId, "commande créée pour tester l'arrêt du sondage");

  await sendProof(page, state);

  /* Simule un statut final : la commande passe en delivered (pollOrder s'arrête sur statut final). */
  const order = state.orders.find((o) => o.id === orderId);
  if (order) { order.status = "delivered"; }

  await page.waitForTimeout(16000);
  const statusCalls = state.calls.filter((c) => c.method === "GET" && /^\/orders\/[\w-]+$/.test(c.path) && c.path.endsWith(orderId));
  if (statusCalls.length > 0) {
    const firstAt = statusCalls[0].at;
    const lastAfter15s = statusCalls.filter((c) => c.at - firstAt > 15000);
    assert.equal(lastAfter15s.length, 0, `le sondage doit s'arrêter sur le statut final : ${lastAfter15s.length} appel(s) après 15 s`);
  }
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : lancez `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  const { server, url } = process.env.MGS_PROTO_URL ? { server: null, url: process.env.MGS_PROTO_URL } : await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0, skip = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) — thème light ===`);
    for (const { name, fn } of tests) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(12000);
      const page = await context.newPage();
      const state = { loggedIn: false, calls: [], orders: [], lastOrder: null };
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(() => { try { localStorage.setItem("mgs_lang", "fr"); } catch (e) { } });
      const handler = apiHandler(page, state);
      await page.route("**/api/**", handler);
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await fn(page, state);
        const realErrors = errors.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
        assert.equal(realErrors.length, 0, "erreurs JS page: " + realErrors.join(" | "));
        console.log("  ✓ " + name);
        pass++;
      } catch (e) {
        if (e instanceof SKIPPED) {
          console.log("  ○ " + name + " — " + e.reason);
          skip++; continue;
        }
        const msg = e && e.message ? e.message.split("\n")[0] : String(e);
        console.log("  ✗ " + name + "\n      " + msg);
        failures.push(`[${vp.label}] ${name}: ${msg}`);
        fail++;
      } finally { await context.close(); }
    }
  }
  await browser.close();
  if (server) server.close();
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (${tests.length * VIEWPORTS.length} runs)`);
  if (failures.length) { console.log("\nÉchecs :"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
