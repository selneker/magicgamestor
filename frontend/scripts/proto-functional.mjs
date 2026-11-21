/**
 * proto-functional.mjs — vérification E2E du prototype design-system-v3 fonctionnel.
 *
 * Le prototype (build/index.html) est servi tel quel ; ce script pilote un vrai
 * Chromium via playwright-core (déjà une devDependency, AUCUNE dépendance ajoutée)
 * et MOCKE l'API backend avec page.route : on teste la logique des boutons sans
 * backend ni CORS, et SANS aucune vraie commande/paiement en production.
 *
 * PL-FE-007-V1/B8 : clics RÉELS (pas de force:true), à 390 px ET sur ordinateur,
 * pour MVola, Orange et Binance. Ce qui n'est pas vérifié de bout en bout est
 * signalé comme tel dans le rapport (pas de faux vert).
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-functional.mjs
 *
 * Non branché sur build / test / prestart (même convention que audit-contrast.mjs).
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, "..", "build", "index.html");
const VIEWPORTS = [{ label: "390px", width: 390, height: 844 }, { label: "desktop", width: 1440, height: 900 }];

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/snap/bin/chromium",
    path.join(process.env.HOME || "", ".hermes/tools/chromium-1248/chrome-linux64/chrome"),
    path.join(process.env.HOME || "", ".hermes/tools/chromium-1208/chrome-linux64/chrome"),
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  console.error("[erreur] Chromium introuvable. Définissez CHROMIUM_PATH=/chemin/vers/chromium.");
  process.exit(2);
}

function serveBuild() {
  const root = path.join(__dirname, "..", "build");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/index.html` })));
}

/* ---------- données mock ---------- */
const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", active: true, sort_order: 0, identity_fields: [{ key: "pubg_id", primary: true, label: "ID PUBG" }] },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", active: true, sort_order: 1, identity_fields: [{ key: "ff_id", primary: true, label: "ID Free Fire" }] },
];
const PRODUCTS = [
  { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 12500, uc_amount: 660, type: "uc", game_id: "pubg-mobile", image_url: "" },
  { id: "p2", slug: "1800-uc", name: "1800 UC", name_en: "1800 UC", price: 32000, uc_amount: 1800, type: "uc", game_id: "pubg-mobile", image_url: "" },
];
const USER = { user_id: "u1", name: "Test Player", email: "test@mg.store", phone: "0340000000", saved_pubg_ids: ["123456789"], created_at: "2026-01-01T00:00:00Z" };
const PAYCFG = { manual_only: true, timeout_minutes: 15, providers: { mvola: { configured: true, merchant: "0383905692", name: "Selneker Dino" }, orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" } } };
const CRYPTOCFG = { available: true, currency: "USDT", expiry_minutes: 30, networks: [{ key: "TRC20", label: "Tron (TRC20)", memo_required: false }, { key: "BEP20", label: "BNB Smart Chain (BEP20)", memo_required: false }] };
const LOYALTY = { balance: { earned: 120, promo: 0, total: 120 }, ledger: [{ type: "earn", amount: 240, reason: "Commande MGS-000" }, { type: "redeem", amount: -120, reason: "Récompense 60 UC" }], config: { enabled: true } };
const REWARDS = [{ id: "r1", name: "60 UC", cost_points: 120, active: true }];
const EVENTS = [{ title_fr: "Événement Test", title_en: "Test Event", description_fr: "Description", description_en: "Description", slug: "evt-test", starts_at: "2026-11-01T00:00:00Z", image_url: "" }];
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const CRYPTO_ADDRESS = "TXyz1234567890abcdR7k2";

function mockApi(page, state) {
  state.orders = state.orders || [];
  page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, "");
    const method = req.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const now = new Date().toISOString();
    const deadline = new Date(Date.now() + 15 * 60000).toISOString();
    const cryptoDeadline = new Date(Date.now() + 30 * 60000).toISOString();
    const cryptoPayment = (status) => ({ id: "pay1", order_id: "o1", order_number: "MGS-001", network: "TRC20", binance_network: "TRX", currency: "USDT", address: CRYPTO_ADDRESS, memo: null, amount_usdt: "2.7812", base_usdt: "2.78", amount_ar: 12500, rate_ar_per_usdt: 4500, status, tx_hash: null, created_at: now, expires_at: cryptoDeadline });

    if (p === "/auth/me" && method === "GET") return state.loggedIn ? json(USER) : json({ detail: "Non authentifié" }, 401);
    if (p === "/auth/login" && method === "POST") { state.loggedIn = true; return json({ ok: true }); }
    if (p === "/auth/register" && method === "POST") { state.loggedIn = true; return json({ ok: true }); }
    if (p === "/auth/logout" && method === "POST") { state.loggedIn = false; return json({ ok: true }); }
    if (p === "/auth/refresh" && method === "POST") return state.loggedIn ? json({ ok: true }) : json({ detail: "no refresh" }, 401);
    if (p === "/auth/me" && method === "PATCH") return json({ ...USER, ...JSON.parse(req.postData() || "{}") });
    if (p === "/games" && method === "GET") return json(GAMES);
    if (p === "/products" && method === "GET") { const g = url.searchParams.get("game"); return json(PRODUCTS.filter((x) => !g || x.game_id === g)); }
    if (p === "/payments/config" && method === "GET") return json(PAYCFG);
    if (p === "/crypto/config" && method === "GET") return json(CRYPTOCFG);
    if (p === "/crypto/initiate" && method === "POST") { const b = JSON.parse(req.postData() || "{}"); return json({ ...cryptoPayment("WAITING"), network: b.network || "TRC20" }); }
    if (/^\/crypto\/o1\/status$/.test(p) && method === "GET") return json({ order_status: "pending_payment", payment_deadline_at: deadline, payment: cryptoPayment("CONFIRMED") });
    if (p === "/fazercards/validate-id" && method === "POST") return json({ valid: true, player_name: "TestPlayer", region: "MG" });
    if (p === "/orders" && method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      const total = (body.items || []).reduce((a, it) => { const pr = PRODUCTS.find((x) => x.id === it.product_id); return a + (pr ? pr.price * it.quantity : 0); }, 0);
      const order = { id: "o1", number: "MGS-001", status: "pending_payment", total, pubg_id: body.pubg_id, pseudo: body.pseudo, game_id: body.game_id, payment_method: body.payment_method || "manual", manual_operator: body.manual_operator || null, created_at: now, payment_deadline_at: deadline, items: (body.items || []).map((it) => { const pr = PRODUCTS.find((x) => x.id === it.product_id) || {}; return { product_id: it.product_id, quantity: it.quantity, name: pr.name, uc_amount: pr.uc_amount }; }) };
      state.orders.unshift(order); state.lastOrder = order; return json(order, 201);
    }
    if (p === "/orders/me" && method === "GET") return json(state.orders);
    if (/^\/orders\/o1\/proof$/.test(p) && method === "POST") { if (state.lastOrder) state.lastOrder.status = "awaiting_verification"; return json(state.lastOrder || { id: "o1" }); }
    if (/^\/orders\/o1\/cancel$/.test(p) && method === "POST") { if (state.lastOrder) state.lastOrder.status = "cancelled"; return json(state.lastOrder || { id: "o1" }); }
    if (/^\/orders\/o1$/.test(p) && method === "GET") return json(state.lastOrder || { id: "o1", status: "awaiting_verification" });
    if (p === "/loyalty/me" && method === "GET") return json(LOYALTY);
    if (p === "/loyalty/rewards" && method === "GET") return json(REWARDS);
    if (p === "/loyalty/redeem" && method === "POST") return json({ ok: true }, 201);
    if (p === "/events" && method === "GET") return json(EVENTS);
    if (p === "/evo/season" && method === "GET") return json({ season: { id: "s1", product_id: "evo1" }, week: "2026-W47" });
    if (p === "/evo/eligibility" && method === "GET") return json({ eligible: true, pubg_id: url.searchParams.get("pubg_id"), week: "2026-W47" });
    if (p === "/chat/conversations" && method === "POST") return json({ id: "c1" }, 201);
    if (/^\/chat\/conversations\/c1\/messages$/.test(p) && method === "POST") return json({ id: "m1" }, 201);
    return json({ detail: "mock: route non gérée " + method + " " + p }, 404);
  });
}

/* ---------- helpers (clics réels, pas de force:true) ---------- */
const boot = (page) => page.waitForFunction(() => typeof window.mgsRenderRecent === "function" && document.querySelectorAll(".mgs-page").length > 0, null, { timeout: 20000 });
const pageIs = (page, name) => page.waitForFunction((n) => document.body.getAttribute("data-page") === n, name, { timeout: 15000 });
const txt = (page, sel) => page.locator(sel).first().textContent();
const cartLen = (page) => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("mgs_cart_v3")) || []).length; } catch { return 0; } });
// bouton panier VISIBLE (le header desktop .nav-cart-btn est masqué sur mobile 390px)
const clickCart = (page) => page.locator('button[aria-label*="Panier"]:visible').first().click();

async function addFirstProduct(page) {
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-pcard[data-pid="p1"]', { timeout: 15000 });
  await page.locator('.mgs-pcard[data-pid="p1"] .mgs-pill__add').click();
  await page.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem("mgs_cart_v3")) || []).some((x) => x.product_id === "p1"); } catch { return false; } }, null, { timeout: 10000 });
}
async function openCheckout(page) {
  await clickCart(page);
  await page.waitForSelector(".mgs-cart-checkout", { timeout: 8000 });
  await page.locator(".mgs-cart-checkout").click();
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 8000 });
}
async function verifyAndSubmit(page, methodValue) {
  await page.locator(".mgs-co-id-input").fill("123456789");
  await page.locator(".mgs-co-verify").click();
  await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 10000 });
  await page.locator(`.mgs-co-method input[value="${methodValue}"]`).locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click();
  await page.waitForFunction((v) => document.querySelector(`.mgs-co-method input[value="${v}"]`).closest(".mgs-co-method").classList.contains("is--active"), methodValue, { timeout: 8000 });
  await page.locator(".mgs-co-submit").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 });
  // captcha désactivé (pas de clé) => flux case à cocher existant
  await page.locator(".mgs-human-cb").check();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 });
  await page.locator(".mgs-human-confirm").click();
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("catalogue + panier + drawer (+/−/suppr/fermer)", async (page) => {
  await boot(page);
  await addFirstProduct(page);
  assert.equal((await txt(page, '.mgs-pcard[data-pid="p1"] .mgs-pcard__amount')).trim(), "660");
  assert.equal((await txt(page, '.mgs-pcard[data-pid="p1"] .mgs-pill__price')).trim(), "12 500 Ar");
  assert.equal(await cartLen(page), 1);
  await page.waitForFunction(() => document.querySelector(".nav-cart-btn .nav-action-badge").textContent === "1", null, { timeout: 8000 });
  await clickCart(page);
  await page.waitForSelector(".mgs-cart-item", { timeout: 8000 });
  assert.equal((await txt(page, ".mgs-cart-total-n")).trim(), "12 500 Ar");
  await page.locator('.mgs-cart-item__qty button[data-q="plus"]').click();
  await page.waitForFunction(() => document.querySelector(".mgs-cart-total-n").textContent.trim() === "25 000 Ar", null, { timeout: 8000 });
  await page.locator('.mgs-cart-item__qty button[data-q="minus"]').click();
  await page.waitForFunction(() => document.querySelector(".mgs-cart-total-n").textContent.trim() === "12 500 Ar", null, { timeout: 8000 });
  await page.locator(".mgs-cart-item__del").click();
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("mgs_cart_v3")) || []).length === 0, null, { timeout: 8000 });
  await page.locator(".mgs-cart-close").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-cart-drawer").classList.contains("is--open"), null, { timeout: 8000 });
});

async function moneyPathManual(page, state, methodValue, merchantNumber) {
  state.loggedIn = true;
  await boot(page);
  await addFirstProduct(page);
  await openCheckout(page);
  assert.equal((await txt(page, ".mgs-co-total")).trim(), "12 500 Ar");
  await verifyAndSubmit(page, methodValue);
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 12000 });
  assert.equal((await txt(page, ".mgs-co-total2")).trim(), "12 500 Ar");
  assert.match(await txt(page, ".mgs-co-merchant"), new RegExp(merchantNumber));
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    page.locator(".mgs-co-proof").click(),
  ]);
  await chooser.setFiles({ name: "proof.png", mimeType: "image/png", buffer: PNG_1x1 });
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 12000 });
  assert.equal((await txt(page, ".mgs-co-r-num")).trim(), "MGS-001");
  await page.locator(".mgs-co-done").click();
  await pageIs(page, "commandes");
  await page.waitForSelector('.mgs-order[data-order="MGS-001"]', { state: "attached", timeout: 12000 });
  assert.equal(await cartLen(page), 0);
  assert.equal(state.orders[0].payment_method, "manual");
}
test("money path MVola (preuve -> reçu -> commandes)", (page, state) => moneyPathManual(page, state, "MVola", "0383905692"));
test("money path Orange (preuve -> reçu -> commandes)", (page, state) => moneyPathManual(page, state, "Orange Money", "0377519833"));

test("money path Binance (initiate -> écran USDT -> poll CONFIRMED -> reçu)", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await addFirstProduct(page);
  await openCheckout(page);
  await verifyAndSubmit(page, "Binance");
  // écran 2 Binance : bloc USDT visible, preuve masquée
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden && !document.querySelector(".mgs-co-binance").hidden, null, { timeout: 12000 });
  const binText = await txt(page, ".mgs-co-binance");
  assert.match(binText, /2\.7812/);
  assert.match(binText, /USDT/);
  assert.match(binText, new RegExp(CRYPTO_ADDRESS));
  assert.match(binText, /Tron \(TRC20\)/);
  const proofHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".mgs-co-proof")).display === "none");
  assert.equal(proofHidden, true, "la preuve doit être masquée pour Binance");
  assert.equal(state.orders[0].payment_method, "binance");
  // poll CONFIRMED (1er tick ~8s) -> reçu
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 20000 });
  assert.equal((await txt(page, ".mgs-co-r-num")).trim(), "MGS-001");
  assert.match(await txt(page, ".mgs-co-r-method"), /Binance/);
  await page.locator(".mgs-co-done").click();
  await pageIs(page, "commandes");
  await page.waitForSelector('.mgs-order[data-order="MGS-001"]', { state: "attached", timeout: 12000 });
  assert.equal(await cartLen(page), 0);
});

test("auth : connexion -> compte + points", async (page, state) => {
  state.loggedIn = false;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("connexion"));
  await pageIs(page, "connexion");
  await page.locator("#em").fill("test@mg.store");
  await page.locator("#pw").fill("password123");
  await page.locator('.mgs-page[data-page="connexion"] a[data-nav="compte"]').click();
  await pageIs(page, "compte");
  await page.waitForFunction(() => document.querySelector("#acc-name") && document.querySelector("#acc-name").value === "Test Player", null, { timeout: 12000 });
  await page.evaluate(() => window.mgsShowPage("points"));
  await pageIs(page, "points");
  await page.waitForFunction(() => { const s = document.querySelectorAll('.mgs-page[data-page="points"] .mgs-stat__n'); return s.length >= 3 && s[0].textContent === "120"; }, null, { timeout: 12000 });
  await page.waitForSelector(".mgs-redeem", { timeout: 10000 });
});

test("garde invité : points/compte -> connexion", async (page, state) => {
  state.loggedIn = false;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("points"));
  await pageIs(page, "connexion");
  await page.evaluate(() => window.mgsShowPage("compte"));
  await pageIs(page, "connexion");
});

/* ---------- runner : chaque test à chaque viewport ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : lancez `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  const { server, url } = process.env.MGS_PROTO_URL ? { server: null, url: process.env.MGS_PROTO_URL } : await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) ===`);
    for (const { name, fn } of tests) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(12000);
      const page = await context.newPage();
      const state = { loggedIn: false };
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      mockApi(page, state);
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await fn(page, state);
        const realErrors = errors.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
        assert.equal(realErrors.length, 0, "erreurs JS page: " + realErrors.join(" | "));
        console.log("  ✓ " + name); pass++;
      } catch (e) {
        const msg = e && e.message ? e.message.split("\n")[0] : String(e);
        console.log("  ✗ " + name + "\n      " + msg);
        failures.push(`[${vp.label}] ${name}: ${msg}`);
        fail++;
      } finally { await context.close(); }
    }
  }
  await browser.close();
  if (server) server.close();
  console.log(`\n${pass} passed, ${fail} failed (${tests.length * VIEWPORTS.length} runs)`);
  if (failures.length) { console.log("\nÉchecs :"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
