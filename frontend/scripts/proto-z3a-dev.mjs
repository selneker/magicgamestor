/**
 * proto-z3a-dev.mjs — auto-contrôle Playwright DU DEV pour la zone Z3a (paiement manuel).
 * Fichier propre au développement (le harnais du testeur est proto-z3a.mjs, intact).
 *
 * Vérifie sur build/index.html servi tel quel, API mockée (page.route), 390 px et 1440 px,
 * thème clair uniquement (le design v3 n'a pas de variante sombre) :
 *   (1) mémoire mgs_pending_order_id + reprise silencieuse au rechargement ;
 *   (2) relance /remind : non portée (design) — vérifie l'absence de tout contrôle ajouté ;
 *   (3) POST /payments/initiate : conditions de main OrderTrack.js:114-126 reproduites ;
 *   (4) sondage GET /payments/{id}/status 5 s : conditions de main OrderTrack.js:93-104.
 *
 * Lancer : cd frontend && yarn build && CHROMIUM_PATH=<chrome> node scripts/proto-z3a-dev.mjs
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
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ico": "image/x-icon", ".json": "application/json" };
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

/* ---------- données mock ---------- */
const USER = { user_id: "u1", name: "Test Player", email: "test@mg.store", phone: "0340000000", saved_pubg_ids: ["123456789"], created_at: "2026-01-01T00:00:00Z" };
const PAYMENT_CONFIG = {
  mode: "papi", gateway: "papi", live: false, papi_auto: true, fiveone_enabled: false, auto_payment: true,
  manual_only: false, timeout_minutes: 15,
  payment_fees: { manual: { percent: 0, min: 0, max: 0 }, papi: { percent: 1.5, min: 100, max: 900 } },
  providers: {
    mvola: { configured: true, merchant: "0383905692", name: "Selneker Dino" },
    orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" },
  },
};
const deadline = (mins = 15) => new Date(Date.now() + mins * 60_000).toISOString();
const ORDER = (over = {}) => ({
  id: "ord_1", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0,
  status: "pending_payment", payment_method: "manual", manual_operator: "mvola",
  pubg_id: "52328390220", pseudo: "TestPlayer", game_id: "pubg-mobile",
  payment_deadline_at: deadline(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  created_at: new Date().toISOString(), ...over,
});

function apiHandler(page, state) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, "");
    const method = req.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    state.calls.push({ method, path: p, body: req.postData() ? JSON.parse(req.postData()) : undefined });

    if (p === "/auth/me" && method === "GET") return state.loggedIn ? json(USER) : json({ detail: "Non authentifié" }, 401);
    if (p === "/auth/login" && method === "POST") { state.loggedIn = true; return json({ user: USER, access_token: "t" }); }
    if (p === "/auth/logout" && method === "POST") { state.loggedIn = false; return json({ ok: true }); }
    if (p === "/auth/refresh" && method === "POST") return state.loggedIn ? json({ ok: true }) : json({ detail: "no refresh" }, 401);
    if (p === "/payments/config" && method === "GET") return json(state.payConfig || PAYMENT_CONFIG);
    if (p === "/crypto/config" && method === "GET") return json({ available: true, currency: "USDT", expiry_minutes: 30, networks: [{ key: "TRC20", label: "TRON (TRC20)", memo_required: false }] });
    if (/^\/crypto\/([\w-]+)\/status$/.test(p) && method === "GET") {
      const id = p.split("/")[2];
      const o = state.orders[id];
      return json({ order_status: o ? o.status : "pending_payment", payment: { id: "pay_" + id, order_id: id, network: "TRC20", address: "TMBINANCEADDR000", amount_usdt: "1.5", currency: "USDT", status: "PENDING" } });
    }
    if (p === "/fazercards/validate-id" && method === "POST") return json({ valid: true, player_name: "TestPlayer", region: "MG" });
    if (p === "/games" && method === "GET") return json([{ id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", active: true, sort_order: 0 }]);
    if (p === "/products" && method === "GET") return json([{ id: "p1", slug: "660-uc", name: "660 UC", price: 12500, uc_amount: 660, type: "uc", game_id: "pubg-mobile", image_url: "" }]);
    if (/^\/products\/([\w-]+)$/.test(p) && method === "GET") return json({ id: "p1", slug: "660-uc", name: "660 UC", price: 12500, uc_amount: 660, type: "uc", game_id: "pubg-mobile", image_url: "" });
    if (p === "/orders" && method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      const order = ORDER({ id: "ord_new_1", pubg_id: body.pubg_id || "52328390220", items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 12500, line_total: 12500 }], total: 12500, subtotal: 12500, payment_method: body.payment_method || "manual", manual_operator: body.manual_operator || null });
      state.orders[order.id] = order;
      state.lastOrder = order;
      return json(order, 201);
    }
    if (/^\/orders\/([\w-]+)$/.test(p) && method === "GET") {
      const o = state.orders[p.split("/")[2]];
      return o ? json(o) : json({ detail: "not found" }, 404);
    }
    if (/^\/orders\/([\w-]+)\/status$/.test(p) && method === "GET") { /* unused */ }
    if (/^\/payments\/([\w-]+)\/status$/.test(p) && method === "GET") {
      const id = p.split("/")[2];
      state.statusCalls.push({ id, at: Date.now() });
      const o = state.orders[id] || ORDER({ id });
      const st = Array.isArray(state.payStatuses) && state.payStatuses.length ? state.payStatuses.shift() : o.status;
      if (o && st !== o.status) o.status = st; /* le provider a fait bouger la commande */
      return json({ order_id: id, order_status: st, payment_status: "pending", payment_url: null, simulated: true });
    }
    if (p === "/payments/initiate" && method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      state.initiateCalls.push(body);
      const o = state.orders[body.order_id];
      return json({ simulated: true, payment_url: null, attempt_no: 1, order_status: o ? o.status : "pending_payment" });
    }
    if (p === "/loyalty/me" && method === "GET") return json({ balance: { total: 120 }, ledger: [] });
    if (p === "/events" && method === "GET") return json([]);
    return json({ detail: "mock: route non gérée " + method + " " + p }, 404);
  };
}

const boot = (page) => page.waitForFunction(
  () => typeof window.mgsRenderRecent === "function" && document.querySelectorAll(".mgs-page").length > 0,
  null, { timeout: 60000 }
);
const pageIs = (page, name) => page.waitForFunction((n) => document.body.getAttribute("data-page") === n, name, { timeout: 60000 });
/* Pose la cle d'une commande en attente DES le prochain chargement (init script) :
   sans cela, la reprise du chargement en cours peut la consommer avant le reload. */
const setPendingKey = (page, id, createdAt) => page.addInitScript(
  (raw) => { try { localStorage.setItem("mgs_pending_order_id", raw); } catch (e) { } },
  JSON.stringify({ id, createdAt: createdAt || new Date().toISOString() })
);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- (1) mémoire + reprise silencieuse ---------- */

test("Z3a(1) clé mgs_pending_order_id écrite à la création de commande", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "boutique", null, { timeout: 60000 });
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-pcard[data-pid="p1"]', { timeout: 60000 });
  await page.locator('.mgs-pcard[data-pid="p1"] .mgs-pill__add').click();
  await page.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem("mgs_cart")) || []).length > 0; } catch { return false; } }, null, { timeout: 8000 });
  await page.locator('button[aria-label*="Panier"]:visible').first().click();
  await page.waitForSelector(".mgs-cart-checkout", { timeout: 8000 });
  await page.locator(".mgs-cart-checkout").click();
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 8000 });
  await page.locator(".mgs-co-id-input").fill("123456789");
  await page.locator(".mgs-co-verify").click();
  await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 30000 });
  await page.locator('.mgs-co-method input[value="MVola"]').locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click();
  await page.waitForFunction((v) => document.querySelector(`.mgs-co-method input[value="${v}"]`).closest(".mgs-co-method").classList.contains("is--active"), "MVola", { timeout: 8000 });
  await page.locator(".mgs-co-submit").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 });
  await page.locator(".mgs-human-cb").check();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 });
  await page.locator(".mgs-human-confirm").click();
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 12000 });
  const key = await page.evaluate(() => JSON.parse(localStorage.getItem("mgs_pending_order_id") || "null"));
  assert.ok(key && key.id === "ord_new_1", "clé non écrite après création : " + JSON.stringify(key));
  assert.ok(key.createdAt && !isNaN(Date.parse(key.createdAt)), "createdAt absent de la clé : " + JSON.stringify(key));
});

test("Z3a(1) reprise silencieuse après rechargement (commande pending_payment)", async (page, state) => {
  state.orders["ord_pend_1"] = ORDER({ id: "ord_pend_1" });
  await boot(page);
  /* Compteur de nœuds du TUNNEL (data-co=*) : la reprise n'écrit que dans des
     conteneurs existants. Le total de la page n'est pas mesuré : l'accueil
     (rendu asynchrone loadGames/renderGames/renderEvents) remplace le contenu
     de démonstration des pages boutique/evenements, ce qui le rend déjà
     différent entre deux chargements. */
  const countCo = () => page.evaluate(() => document.querySelector('.mgs-page[data-page="commande"]').querySelectorAll("*").length);
  const nodes0 = await countCo();
  await setPendingKey(page, "ord_pend_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "commande");
  /* Écran de paiement existant (data-co=2), comme main /orders/:id pour pending_payment. */
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 30000 });
  const info = await page.evaluate(() => ({
    total: (document.querySelector(".mgs-co-total2") || {}).textContent,
    num: (document.querySelector(".mgs-co-mname") || {}).textContent,
    testids: Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")),
  }));
  const nodes1 = await countCo();
  assert.ok(/Ar/.test(info.total || ""), "récap montant non peuplé : " + info.total);
  assert.ok(!info.testids.some((t) => /banner|remind/i.test(t)), "aucun élément de bannière/relance injecté : " + info.testids.join(","));
  assert.ok(nodes1 - nodes0 < 40, "injection de nœuds dans le tunnel à la reprise (" + nodes0 + " → " + nodes1 + ")");
});

test("Z3a(1) reprise silencieuse après rechargement (preuve envoyée → écran d'attente)", async (page, state) => {
  state.orders["ord_proof_1"] = ORDER({ id: "ord_proof_1", status: "proof_submitted" });
  await setPendingKey(page, "ord_proof_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 30000 });
  const badge = await page.evaluate(() => (document.querySelector(".mgs-co-wait-badge") || {}).textContent || "");
  assert.ok(/vérification|review/i.test(badge), "badge écran d'attente non peuplé : " + badge);
});

test("Z3a(1) reprise silencieuse (binance pending_payment) : slot rouvert, jamais de 2ᵉ initiate", async (page, state) => {
  state.orders["ord_bin_1"] = ORDER({ id: "ord_bin_1", payment_method: "binance", manual_operator: null });
  await setPendingKey(page, "ord_bin_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 30000 });
  await page.waitForFunction(() => { var b = document.querySelector(".mgs-co-binance"); return b && !b.hidden && /TMBINANCEADDR000/.test(b.innerHTML || ""); }, null, { timeout: 30000 });
  const info = await page.evaluate(() => ({
    bin: document.querySelector(".mgs-co-binance"),
    binHTML: (document.querySelector(".mgs-co-binance") || {}).innerHTML || null,
    merchHidden: document.querySelector(".mgs-co-merchant").hidden,
    proofHidden: (document.querySelector(".mgs-co-proof") || {}).style.display === "none",
  }));
  assert.ok(info.bin && !info.bin.hidden, "panneau Binance non affiché à la reprise : " + info.binHTML);
  assert.ok(/TMBINANCEADDR000/.test(info.binHTML || ""), "adresse USDT absente du panneau : " + info.binHTML);
  assert.ok(info.merchHidden, "le bloc marchand MVola/Orange ne doit pas être montré pour Binance");
  assert.ok(info.proofHidden, "le bouton de preuve ne doit pas être montré pour Binance");
  const initiates = state.calls.filter((c) => c.path === "/crypto/initiate" && c.method === "POST");
  assert.equal(initiates.length, 0, "2ᵉ initiate Binance interdit à la reprise : " + JSON.stringify(initiates));
  const statuses = state.calls.filter((c) => /^\/crypto\/[\w-]+\/status$/.test(c.path) && c.method === "GET");
  assert.ok(statuses.length >= 1, "slot non rouvert par GET /crypto/{id}/status");
});

test("Z3a(1) entrée périmée (> 24 h) : clé purgée en silence, accueil", async (page, state) => {
  await setPendingKey(page, "ord_old", new Date(Date.now() - 25 * 3600 * 1000).toISOString());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "accueil");
  await page.waitForFunction(() => localStorage.getItem("mgs_pending_order_id") === null, null, { timeout: 30000 });
  const key = await page.evaluate(() => localStorage.getItem("mgs_pending_order_id"));
  assert.equal(key, null, "clé périmée non purgée");
});

test("Z3a(1) commande à statut final : clé purgée en silence, accueil", async (page, state) => {
  state.orders["ord_done_1"] = ORDER({ id: "ord_done_1", status: "paid" });
  await setPendingKey(page, "ord_done_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "accueil");
  await page.waitForFunction(() => localStorage.getItem("mgs_pending_order_id") === null, null, { timeout: 30000 });
  const key = await page.evaluate(() => localStorage.getItem("mgs_pending_order_id"));
  assert.equal(key, null, "clé d'une commande payée non purgée");
});

test("Z3a(1) commande manuelle sans opérateur : clé purgée (PL-CHK-6)", async (page, state) => {
  state.orders["ord_noop_1"] = ORDER({ id: "ord_noop_1", manual_operator: null });
  await setPendingKey(page, "ord_noop_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "accueil");
  await page.waitForFunction(() => localStorage.getItem("mgs_pending_order_id") === null, null, { timeout: 30000 });
  const key = await page.evaluate(() => localStorage.getItem("mgs_pending_order_id"));
  assert.equal(key, null, "manuelle sans opérateur : entrée non purgée");
});

/* ---------- (4) sondage GET /payments/{id}/status (main OrderTrack.js:93-104) ---------- */

test("Z3a(4) sondage /payments/{id}/status — auto pending_payment, cadence 5 s", async (page, state) => {
  state.orders["ord_auto_1"] = ORDER({ id: "ord_auto_1", payment_method: "mvola", manual_operator: null });
  await setPendingKey(page, "ord_auto_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 30000 });
  assert.ok(state.statusCalls.length >= 1, "sondage immédiat absent (main :103)");
  await page.waitForTimeout(6500);
  assert.ok(state.statusCalls.length >= 2, "cadence 5 s non respectée : " + JSON.stringify(state.statusCalls));
  const gap = state.statusCalls[1].at - state.statusCalls[0].at;
  assert.ok(gap >= 4000 && gap < 8000, "intervalle réel " + gap + " ms (attendu ~5000)");
});

test("Z3a(4) pas de sondage pour une commande manual (main :93)", async (page, state) => {
  state.orders["ord_man_1"] = ORDER({ id: "ord_man_1" });
  await setPendingKey(page, "ord_man_1");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "commande");
  await page.waitForTimeout(6500);
  assert.equal(state.statusCalls.length, 0, "une commande manual ne doit pas être sondée : " + JSON.stringify(state.statusCalls));
});

test("Z3a(4) pas de sondage pour Binance (appelant main :198-201)", async (page, state) => {
  state.orders["ord_bin_2"] = ORDER({ id: "ord_bin_2", payment_method: "binance", manual_operator: null });
  await setPendingKey(page, "ord_bin_2");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await pageIs(page, "commande");
  await page.waitForTimeout(6500);
  assert.equal(state.statusCalls.length, 0, "Binance a son propre sondage : " + JSON.stringify(state.statusCalls));
});

test("Z3a(4) le sondage s'arrête sur statut final (main :100)", async (page, state) => {
  state.orders["ord_auto_2"] = ORDER({ id: "ord_auto_2", payment_method: "orange", manual_operator: null });
  state.payStatuses = ["paid"];
  await setPendingKey(page, "ord_auto_2");
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await page.waitForFunction(() => localStorage.getItem("mgs_pending_order_id") === null, null, { timeout: 30000 });
  await page.waitForTimeout(6500);
  assert.equal(state.statusCalls.length, 1, "sondage non arrêté sur statut final : " + JSON.stringify(state.statusCalls) + " calls=" + JSON.stringify(state.calls));
  const key = await page.evaluate(() => localStorage.getItem("mgs_pending_order_id"));
  assert.equal(key, null, "clé d'une commande à statut final non purgée");
});

/* ---------- (5) masquage MVola/Orange si configured=false (main Checkout.js:83-84) ---------- */

test("Z3a(5) masquage MVola/Orange si configured=false (main Checkout.js:83-84)", async (page, state) => {
  state.payConfig = Object.assign({}, PAYMENT_CONFIG, { providers: { mvola: { configured: false, merchant: "0383905692", name: "Selneker Dino" }, orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" } } });
  await boot(page);
  await page.evaluate(() => { try { localStorage.setItem("mgs_cart", JSON.stringify([{ key: "p1", id: "p1", product_id: "p1", name: "660 UC", price: 12500, qty: 1, game_id: "pubg-mobile", game_name: "PUBG Mobile" }])); } catch (e) { } });
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await boot(page);
  await page.locator('button[aria-label*="Panier"]:visible').first().click();
  await page.waitForSelector(".mgs-cart-checkout", { timeout: 30000 });
  await page.locator(".mgs-cart-checkout").click();
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 30000 });
  const v = await page.evaluate(() => {
    const g = (val) => { const i = document.querySelector('.mgs-co-method input[value="' + val + '"]'); const l = i && i.closest(".mgs-co-method"); return l ? l.style.display : null; };
    return { mvola: g("MVola"), orange: g("Orange Money"), binance: g("Binance") };
  });
  assert.equal(v.mvola, "none", "MVola non masqué malgré configured=false : " + JSON.stringify(v));
  assert.equal(v.orange, "", "Orange doit rester visible : " + JSON.stringify(v));
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : lancez `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  const { server, url } = process.env.MGS_PROTO_URL ? { server: null, url: process.env.MGS_PROTO_URL } : await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0; const failures = [];
  for (const vp of (process.env.MGS_VP ? VIEWPORTS.filter((v) => v.label.startsWith(process.env.MGS_VP)) : VIEWPORTS)) {
    const selected = tests.filter((t) => !process.env.MGS_TEST || t.name.includes(process.env.MGS_TEST));
    console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) — thème light ===`);
    for (const { name, fn } of selected) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(60000);
      const page = await context.newPage();
      const state = { loggedIn: false, calls: [], orders: {}, initiateCalls: [], statusCalls: [], payStatuses: [], payConfig: null };
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(() => { try { localStorage.setItem("mgs_lang", "fr"); } catch (e) { } });
      await page.route("**/api/**", apiHandler(page, state));
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await fn(page, state);
        const realErrors = errors.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
        assert.equal(realErrors.length, 0, "erreurs JS page: " + realErrors.join(" | "));
        console.log("  ✓ " + name);
        pass++;
      } catch (e) {
        const msg = e && e.message ? e.message.split("\n")[0] : String(e);
        let dbg = "";
        try { dbg = await page.evaluate(() => JSON.stringify({ page: document.body.getAttribute("data-page"), key: localStorage.getItem("mgs_pending_order_id") })).catch(() => "?"); } catch { dbg = "?"; }
        console.log("  ✗ " + name + "\n      " + msg + "\n      [dbg] " + dbg + " errs=" + errors.join("|"));
        failures.push(`[${vp.label}] ${name}: ${msg}`);
        fail++;
      } finally { await context.close(); }
    }
  }
  await browser.close();
  if (server) server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) { console.log("\nÉchecs :"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
