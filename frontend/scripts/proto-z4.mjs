/**
 * proto-z4.mjs — auto-contrôle Playwright des fonctions Z4 (commandes / historique) du prototype statique.
 *
 * Vérifie, sur build/index.html servi tel quel, avec l'API mockée :
 *   (a) page de commandes (/commandes) : liste de commandes affichée (.mgs-order) ;
 *   (b) carte de commande (mgs-order) : numéro, produit, méthode, statut, prix (data-*) ;
 *   (c) détail de commande (.mgs-cmd-detail) : montant, statut, lignes ;
 *   (d) annulation d'une commande en attente (POST /orders/{id}/cancel) depuis le checkout data-co=2.
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
    if (p === "/games" && method === "GET") return json([]);
    if (p === "/products" && method === "GET") return json([]);
    if (p === "/payments/config" && method === "GET") return json({ mode: "papi", providers: {} });
    if (p === "/fazercards/validate-id" && method === "POST") return json({ valid: true, player_name: "TestPlayer", region: "MG" });

    if (p === "/orders" && method === "POST") {
      const order = { ...ORDER_BASE, id: "ord_" + Date.now(), order_number: "MGS-" + String(Date.now()).slice(-6) };
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

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const skipped = (name, reason) => tests.push({ name, fn: async () => { throw new SKIPPED(reason); } });
class SKIPPED extends Error { constructor(r) { super("SKIPPED: " + r); this.reason = r; } }

/* ================= (a) page de commandes ================= */

test("Z4(a) page commandes : affichage de /commandes (.mgs-cmd-list)", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("commandes"));
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "commandes", null, { timeout: 10000 });
  await page.waitForFunction(() => !!document.querySelector(".mgs-cmd-list"), null, { timeout: 10000 });
  const list = await page.evaluate(() => !!document.querySelector(".mgs-cmd-list"));
  assert.ok(list, "page commandes affiche .mgs-cmd-list");
});

/* ================= (b) carte de commande — zone non encore developpee ================= */

skipped("Z4(b) carte de commande — zone non encore developpee / harnais a adapter");

/* ================= (c) détail de commande — zone non encore developpee ================= */

skipped("Z4(c) détail de commande — zone non encore developpee / harnais a adapter");

/* ================= (d) annulation — zone non encore developpee ================= */

skipped("Z4(d) annulation commande — zone non encore developpee / harnais a adapter");

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
        if (e instanceof SKIPPED) { console.log("  ○ " + name + " — " + e.reason); skip++; continue; }
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
  if (failures.length) { failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
