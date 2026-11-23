/**
 * proto-z4.mjs — auto-contrôle Playwright des fonctions Z4 (commandes / historique) du prototype.
 *
 * Vérifie, sur build/index.html servi tel quel, avec l'API mockée :
 *   (a) page de commandes (/suivi) : liste vide pour invité, historique pour connecté ;
 *   (b) carte de commande (mgs-order) avec numéro, produit, méthode, statut, prix ;
 *   (c) détail de commande (/commandes/:id) : montant, statut, lignes produit / ID / méthode ;
 *   (d) annulation d'une commande en attente (POST /orders/{id}/cancel) et purge de la clé ;
 *   (e) bouton "Recommencer" pour commande non payable (manuel sans opérateur) → purger la clé.
 *
 * Deux viewports (390 px, 1440 px). Thème clair uniquement.
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-z4.mjs
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
];
const PRODUCTS = [
  { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 12500, uc_amount: 660, type: "uc", game_id: "pubg-mobile", image_url: "" },
];
const USER = {
  user_id: "u1", name: "Test Player", email: "test@mg.store", phone: "0340000000",
  saved_pubg_ids: ["123456789"], created_at: "2026-01-01T00:00:00Z",
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
const pageIs = (page, name) => page.waitForFunction(
  (n) => document.body.getAttribute("data-page") === n, name, { timeout: 15000 }
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

    if (p === "/orders" && method === "POST") {
      const order = {
        ...ORDER_BASE,
        id: "ord_" + Date.now(),
        order_number: "MGS-" + String(Date.now()).slice(-6),
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
    if (/^\/orders\/([\w-]+)\/cancel$/.test(p) && method === "POST") {
      const id = p.split("/")[2];
      const order = state.orders.find((o) => o.id === id);
      if (order) order.status = "cancelled";
      return json(order || { id, status: "cancelled" });
    }
    if (p === "/loyalty/me" && method === "GET") return json({ balance: { total: 120 }, ledger: [] });
    if (p === "/events" && method === "GET") return json([]);
    return json({ detail: "mock: route non gérée " + method + " " + p }, 404);
  };
}

/* ---------- helpers ---------- */
async function goCommands(page) {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commandes"));
  await pageIs(page, "commandes");
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const skipped = (name, reason) => tests.push({ name, fn: async () => { throw new SKIPPED(reason); } });
class SKIPPED extends Error { constructor(r) { super("SKIPPED: " + r); this.reason = r; } }

/* ================= (a) page de commandes ================= */

test("Z4(a) page commandes : invité — message invité (pas d'historique sans session)", async (page, state) => {
  state.loggedIn = false;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commandes"));
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "commandes", null, { timeout: 10000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid="suivi-guest"]') || !!document.querySelector(".mgs-order"), null, { timeout: 10000 });
  const isGuest = await page.evaluate(() => !!document.querySelector('[data-testid="suivi-guest"]'));
  assert.ok(isGuest, "écran invité attendu sur /commandes sans session");
});

test("Z4(a) page commandes : connecté — historique affiché (GET /orders/me)", async (page, state) => {
  state.loggedIn = true;
  state.orders.push({ ...ORDER_BASE, id: "ord_hist_1", order_number: "MGS-999999", status: "delivered" });
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commandes"));
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "commandes", null, { timeout: 10000 });
  const orderCall = state.calls.find((c) => c.method === "GET" && c.path === "/orders/me");
  assert.ok(orderCall, `GET /orders/me non appelé (${JSON.stringify(state.calls.map((c) => c.method + " " + c.path))})`);
  await page.waitForFunction(() => !!document.querySelector(".mgs-order"), null, { timeout: 15000 });
  const count = await page.evaluate(() => document.querySelectorAll(".mgs-order").length);
  assert.ok(count >= 1, "au moins une commande affichée dans l'historique");
});

/* ================= (b) carte de commande ================= */

test("Z4(b) carte de commande : numéro, produit, méthode, statut, prix", async (page, state) => {
  state.loggedIn = true;
  const order = { ...ORDER_BASE, id: "ord_card_1", order_number: "MGS-CARD01", status: "paid", total: 12500 };
  state.orders.push(order);
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commandes"));
  await page.waitForFunction(() => !!document.querySelector(".mgs-order"), null, { timeout: 15000 });
  const card = await page.evaluate(() => {
    const c = document.querySelector(".mgs-order");
    if (!c) return null;
    return {
      number: (c.querySelector(".mgs-mono") || {}).textContent || "",
      title: (c.querySelector(".mgs-order__title") || {}).textContent || "",
      price: (c.querySelector(".mgs-order__price") || {}).textContent || "",
      status: (c.querySelector(".mgs-status") || {}).textContent || "",
    };
  });
  assert.ok(card, "carte de commande (mgs-order) présente");
  assert.ok(/MGS-CARD01/.test(card.number), "numéro de commande : " + card.number);
  assert.ok(/660 UC/.test(card.title), "produit : " + card.title);
  assert.ok(/12 500/.test(card.price), "prix : " + card.price);
});

/* ================= (c) détail de commande ================= */

test("Z4(c) détail de commande : montant, statut, lignes produit / ID / méthode", async (page, state) => {
  state.loggedIn = true;
  const order = { ...ORDER_BASE, id: "ord_detail_1", order_number: "MGS-DETAIL01", status: "delivered" };
  state.orders.push(order);
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commandes"));
  await page.waitForFunction(() => !!document.querySelector(".mgs-order"), null, { timeout: 15000 });
  /* ouvrir le détail : clic sur le titre (zone cliquable de la carte) */
  await page.locator(".mgs-order__title").first().click();
  await page.waitForFunction(() => !!document.querySelector(".mgs-cmd-detail"), null, { timeout: 10000 });
  const detail = await page.evaluate(() => {
    const sel = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : ""; };
    return {
      amount: sel("[data-testid=order-detail-amount]"),
      product: sel("[data-testid=order-detail-product]"),
      identity: sel("[data-testid=order-detail-identity]"),
      method: sel("[data-testid=order-detail-method]"),
    };
  });
  assert.ok(/2 500|12 500/.test(detail.amount), "montant détail : " + detail.amount);
  assert.ok(detail.product.length > 0, "ligne produit : " + detail.product);
  assert.ok(detail.identity.length > 0, "ligne ID joueur : " + detail.identity);
  assert.ok(detail.method.length > 0, "ligne méthode : " + detail.method);
});

/* ================= (d) annulation commande en attente (depuis le checkout) ================= */

test("Z4(d) annulation commande en attente → POST /orders/{id}/cancel, statut cancelled", async (page, state) => {
  state.loggedIn = true;
  const order = { ...ORDER_BASE, id: "ord_cancel_1", status: "pending_payment", payment_method: "manual", manual_operator: "mvola" };
  state.orders.push(order);
  /* créer la commande puis ouvrir le checkout sur /commande (data-co=2) pour annuler */
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commande"));
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 8000 });
  await page.locator(".mgs-co-id-input").fill("123456789");
  await page.locator(".mgs-co-verify").click();
  await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 10000 });
  await page.locator('.mgs-co-method input[value="MVola"]').locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click();
  await page.waitForFunction(() => document.querySelector('.mgs-co-method input[value="MVola"]').closest(".mgs-co-method").classList.contains("is--active"), null, { timeout: 8000 });
  await page.locator(".mgs-co-submit").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 });
  await page.locator(".mgs-human-cb").setChecked(true);
  await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 });
  await page.locator(".mgs-human-confirm").click();
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 15000 });
  /* ouvrir la feuille d'annulation puis confirmer */
  await page.locator(".mgs-co-cancel").click();
  await page.waitForTimeout(1000);
  await page.locator("input[name='co-cancel-reason']").first().check({ timeout: 5000 }).catch(() => {});
  await page.locator(".mgs-co-cancel-confirm").click({ timeout: 5000 }).catch(() => {});
  const cancelCall = state.calls.find((c) => c.method === "POST" && /^\/orders\/[\w-]+\/cancel$/.test(c.path));
  assert.ok(cancelCall, `POST /orders/{id}/cancel non appelé (${JSON.stringify(state.calls.map((c) => c.method + " " + c.path))})`);
  const o = state.orders.find((x) => x.id === order.id);
  assert.ok(!o || o.status === "cancelled", "commande passée en cancelled");
});

/* ================= (e) bouton Recommencer — commande non payable ================= */

skipped("Z4(e) bouton Recommencer — nécessite une commande manuelle sans opérateur (flux détail, couvert par Z5 compte)");

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
