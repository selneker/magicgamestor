/**
 * proto-z5.mjs — auto-contrôle Playwright des fonctions Z5 (compte/points/pack/chat) du prototype statique.
 *
 * Vérifie, sur build/index.html servi tel quel, avec l'API mockée :
 *   (a) compte : page /compte affichée, GET /auth/me (profil) ;
 *   (b) points : page /points affichée, GET /loyalty/me (solde) ;
 *   (c) pack évolutif : page /pack affichée, GET /evo/eligibility + GET /evo/season ;
 *   (d) chat : page /support affichée, POST /chat/conversations (nécessite login) ;
 *   (e) déconnexion : POST /auth/logout.
 *
 * Deux viewports (390 px, 1440 px). Thème clair uniquement.
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-z5.mjs
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
    if (p === "/loyalty/me" && method === "GET") return json({ balance: { total: 120 }, ledger: [] });
    if (p === "/evo/eligibility" && method === "GET") return json({ eligible: true, week: "2026-W47" });
    if (p === "/evo/season" && method === "GET") return json({ season: { id: "s1", product_id: "evo1" }, week: "2026-W47" });
    if (p === "/chat/conversations" && method === "POST") return json({ id: "c1", conversation: { id: "c1" } });
    return json({ detail: "mock: route non gérée " + method + " " + p }, 404);
  };
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const goTo = (page, name) => page.evaluate((n) => window.mgsShowPage(n), name);

test("Z5(a) compte : page /compte + GET /auth/me (profil)", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await goTo(page, "compte");
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "compte", null, { timeout: 10000 });
  const meCall = state.calls.find((c) => c.method === "GET" && c.path === "/auth/me");
  assert.ok(meCall, `GET /auth/me non appelé`);
  const txt = await page.evaluate(() => document.body.textContent || "");
  assert.ok(/Test Player|test@mg\.store/.test(txt), "profil affiché : " + txt.slice(0, 200));
});

test("Z5(b) points : page /points + GET /loyalty/me", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await goTo(page, "points");
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "points", null, { timeout: 10000 });
  const loyCall = state.calls.find((c) => c.method === "GET" && c.path === "/loyalty/me");
  assert.ok(loyCall, `GET /loyalty/me non appelé`);
  const txt = await page.evaluate(() => document.body.textContent || "");
  assert.ok(/120/.test(txt), "solde points affiché : " + txt.slice(0, 200));
});

test("Z5(c) pack évolutif : page /pack + GET /evo/eligibility + GET /evo/season", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await goTo(page, "pack");
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "pack", null, { timeout: 10000 });
  const evoCall = state.calls.find((c) => c.method === "GET" && c.path === "/evo/eligibility");
  const seaCall = state.calls.find((c) => c.method === "GET" && c.path === "/evo/season");
  assert.ok(evoCall, `GET /evo/eligibility non appelé`);
  assert.ok(seaCall, `GET /evo/season non appelé`);
});

test("Z5(d) chat : page /support + POST /chat/conversations (login requis)", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await goTo(page, "support");
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "support", null, { timeout: 10000 });
  await page.locator('button:has-text("Chat en direct"), [data-testid*="chat"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const chatCall = state.calls.find((c) => c.method === "POST" && c.path === "/chat/conversations");
  assert.ok(chatCall, `POST /chat/conversations non appelé`);
});

test("Z5(e) déconnexion : POST /auth/logout", async (page, state) => {
  state.loggedIn = true;
  await boot(page);
  await page.locator('button:has-text("Déconnexion"), a:has-text("Déconnexion")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const logoutCall = state.calls.find((c) => c.method === "POST" && c.path === "/auth/logout");
  assert.ok(logoutCall, `POST /auth/logout non appelé`);
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : lancez `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  const { server, url } = process.env.MGS_PROTO_URL ? { server: null, url: process.env.MGS_PROTO_URL } : await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) — thème light ===`);
    for (const { name, fn } of tests) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(12000);
      const page = await context.newPage();
      const state = { loggedIn: false, calls: [], orders: [] };
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
  if (failures.length) { failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
