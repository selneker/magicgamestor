/**
 * proto-z2.mjs — auto-contrôle Playwright des fonctions Z2 du prototype.
 *
 * Vérifie, sur build/index.html servi tel quel, avec l'API mockée
 * (page.route, aucune dépendance ajoutée) :
 *   - liste des jeux (GET /games, tri `sort_order`, filtre `active`) ;
 *   - catalogue (GET /products, paramètres exacts game/type/q/sort/popular/
 *     favorites/min_price/max_price) ;
 *   - fiche produit (GET /products/{slug}) ;
 *   - panier (un seul jeu par panier, quantités) ;
 *   - favoris (bascule + filtre catalogue) ;
 *   - état invité / connecté (pastille points).
 *
 * Deux viewports (390 px, 1440 px). Le thème : le design v3 n'a PAS de variante
 * sombre (aucune règle `.dark`, aucun lecteur de `mgs-theme`) — on le mesure et
 * on le signale, on ne l'invente pas.
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-z2.mjs
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, "..", "build", "index.html");
const VIEWPORTS = [{ label: "390px", width: 390, height: 844 }, { label: "1440px", width: 1440, height: 900 }];

function findChromium() {
  const c = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser",
    path.join(process.env.HOME || "", ".hermes/tools/chromium-1248/chrome-linux64/chrome")].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch { /* */ } }
  console.error("[erreur] CHROMIUM_PATH introuvable");
  process.exit(2);
}

function serveBuild() {
  const root = path.join(__dirname, "..", "build");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".jpg": "image/jpeg" };
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
const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", active: true, sort_order: 1, description: "UC, Prime & Royal Pass", icon_url: "", product_types: [{ key: "uc", label: "UC" }, { key: "prime", label: "Prime" }] },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", active: true, sort_order: 0, description: "Diamants & abonnements", icon_url: "", product_types: [{ key: "diamond", label: "Diamants" }] },
];
const PRODUCTS = [
  { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 12500, uc_amount: 660, type: "uc", game_id: "pubg-mobile", image_url: "", popular: true },
  { id: "p2", slug: "1800-uc", name: "1800 UC", name_en: "1800 UC", price: 32000, uc_amount: 1800, type: "uc", game_id: "pubg-mobile", image_url: "" },
  { id: "evo1", slug: "pack-evolutif", name: "Pack évolutif", name_en: "Evolving pack", price: 60000, uc_amount: null, type: "evo", game_id: "pubg-mobile", image_url: "" },
  { id: "prime1", slug: "prime-1-mois", name: "Prime 1 mois", name_en: "Prime 1 month", price: 4500, uc_amount: null, type: "prime", game_id: "pubg-mobile", image_url: "" },
  { id: "f1", slug: "50-diam", name: "50 Diamants", name_en: "50 Diamonds", price: 2000, uc_amount: 50, type: "diamond", game_id: "free-fire", image_url: "" },
];
const USER = { user_id: "u1", name: "Test Player", email: "test@mg.store", phone: "0340000000", saved_pubg_ids: ["123456789"] };
const LOYALTY = { balance: { earned: 120, promo: 0, total: 120 } };

function apiHandler(page, state) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, "");
    const sp = url.searchParams;
    state.urls.push(req.method() + " " + p + (url.search || ""));
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (p === "/auth/me" && req.method() === "GET") return state.loggedIn ? json(USER) : json({ detail: "Non authentifié" }, 401);
    if ((p === "/auth/login" || p === "/auth/register") && req.method() === "POST") { state.loggedIn = true; return json({ user: USER, access_token: "t" }); }
    if (p === "/auth/logout" && req.method() === "POST") { state.loggedIn = false; return json({ ok: true }); }
    if (p === "/games" && req.method() === "GET") return json(GAMES);
    if (p === "/products" && req.method() === "GET") {
      let list = PRODUCTS.slice();
      if (sp.get("game")) list = list.filter((x) => x.game_id === sp.get("game"));
      if (sp.get("type")) { const t = sp.get("type").split(","); list = list.filter((x) => t.includes(x.type)); }
      if (sp.get("q")) { const q = sp.get("q").toLowerCase(); list = list.filter((x) => (x.name || "").toLowerCase().includes(q)); }
      if (sp.get("popular")) list = list.filter((x) => x.popular);
      if (sp.get("min_price")) list = list.filter((x) => x.price >= Number(sp.get("min_price")));
      if (sp.get("max_price")) list = list.filter((x) => x.price <= Number(sp.get("max_price")));
      if (sp.get("favorites")) { const favs = state.favorites || []; list = list.filter((x) => favs.includes(x.id)); }
      if (sp.get("sort") === "price_asc") list.sort((a, b) => a.price - b.price);
      if (sp.get("sort") === "price_desc") list.sort((a, b) => b.price - a.price);
      return json(list);
    }
    const m = /^\/products\/([\w-]+)$/.exec(p);
    if (m && req.method() === "GET") { const pr = PRODUCTS.find((x) => x.slug === m[1]); return pr ? json(pr) : json({ detail: "not found" }, 404); }
    if (p === "/loyalty/me" && req.method() === "GET") return json(LOYALTY);
    return json({ detail: "mock: route non gérée " + req.method() + " " + p }, 404);
  };
}

/* ---------- helpers ---------- */
const boot = (page) => page.waitForFunction(() => typeof window.mgsRenderRecent === "function" && document.querySelectorAll(".mgs-page").length > 0, null, { timeout: 20000 });
const pageIs = (page, name) => page.waitForFunction((n) => document.body.getAttribute("data-page") === n, name, { timeout: 15000 });
const txt = (page, sel) => page.locator(sel).first().textContent();
const gamesBoxes = (page) => page.locator('.mgs-boutique-games .mgs-game');
const catalogCards = (page) => page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid]');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Z2 liste des jeux : GET /games, tri sort_order, rendu des cartes", async (page, state) => {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.waitForSelector('.mgs-boutique-games .mgs-game', { timeout: 15000 });
  const names = await page.$$eval('.mgs-boutique-games .mgs-game .mgs-game__name', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(names, ["Free Fire", "PUBG Mobile"], "tri sort_order (0 puis 1) : " + JSON.stringify(names));
  const games = await page.$$eval('.mgs-boutique-games .mgs-game', (els) => els.map((e) => e.dataset.game));
  assert.deepEqual(games, ["free-fire", "pubg-mobile"]);
  assert.ok(state.urls.some((u) => u.startsWith("GET /games")), "GET /games appelé : " + JSON.stringify(state.urls));
});

test("Z2 catalogue : paramètres exacts game/type/sort + cartes", async (page, state) => {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid]', { timeout: 15000 });
  const ids = await page.$$eval('.mgs-boutique-catalog .mgs-pcard', (els) => els.map((e) => e.dataset.pid).sort());
  assert.deepEqual(ids, ["evo1", "p1", "p2", "prime1"], "catalogue PUBG : " + JSON.stringify(ids));
  const req = state.urls.filter((u) => u.startsWith("GET /products?")).pop();
  assert.ok(/[?&]game=pubg-mobile(&|$)/.test(req), "param game : " + req);
  // tri par prix (paramètre sort=price_asc)
  await page.locator('.mgs-boutique-catalog .mgs-chip').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.mgs-boutique-catalog .mgs-pcard[data-pid]') && document.querySelector('.mgs-boutique-catalog .mgs-pcard').dataset.pid === "prime1", null, { timeout: 10000 });
  const req2 = state.urls.filter((u) => u.startsWith("GET /products?")).pop();
  assert.ok(/sort=price_asc/.test(req2), "param sort : " + req2);
  const prices = await page.$$eval('.mgs-boutique-catalog .mgs-pcard .mgs-pill__price', (els) => els.map((e) => e.textContent.replace(/\s/g, "")));
  assert.deepEqual(prices, ["4500Ar", "12500Ar", "32000Ar", "60000Ar"], "tri prix croissant : " + JSON.stringify(prices));
  // type=evo
  await page.goto(new URL("/index.html?game=pubg-mobile&type=evo", page.url()).href, { waitUntil: "load" });
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.mgs-boutique-catalog .mgs-pcard[data-pid]').length === 1, null, { timeout: 10000 });
  const req3 = state.urls.filter((u) => u.startsWith("GET /products?")).pop();
  assert.ok(/type=evo/.test(req3), "param type : " + req3);
});

test("Z2 fiche produit : GET /products/{slug}", async (page, state) => {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid="p2"]', { timeout: 15000 });
  await page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid="p2"] .mgs-pcard__figure').click();
  await pageIs(page, "produit");
  await page.waitForFunction(() => document.querySelector('.mgs-page[data-page="produit"] h1') && document.querySelector('.mgs-page[data-page="produit"] h1').textContent === "1800 UC", null, { timeout: 10000 });
  assert.ok(state.urls.some((u) => u === "GET /products/1800-uc"), "appel GET /products/{slug} : " + JSON.stringify(state.urls.filter((u) => u.includes("/products/"))));
  assert.equal((await txt(page, '.mgs-page[data-page="produit"] .mgs-price')).replace(/\s+/g, " ").trim(), "32 000 Ar");
  assert.equal((await txt(page, '.mgs-page[data-page="produit"] h1')).trim(), "1800 UC");
});

test("Z2 panier : un seul jeu par panier", async (page, state) => {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid="p1"]', { timeout: 15000 });
  await page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid="p1"] .mgs-pill__add').click();
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("mgs_cart")) || []).length === 1, null, { timeout: 8000 });
  const item = await page.evaluate(() => JSON.parse(localStorage.getItem("mgs_cart"))[0]);
  assert.equal(item.id, "p1", "forme d'objet de main (i.id) : " + JSON.stringify(item));
  assert.equal(item.product_id, "p1");
  // un deuxième jeu est refusé
  await page.locator('.mgs-game[data-gamename="Free Fire"]').first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid="f1"]', { timeout: 15000 });
  await page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid="f1"] .mgs-pill__add').click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("mgs_cart")));
  assert.equal(after.length, 1, "un seul jeu par panier : " + JSON.stringify(after));
  assert.equal(after[0].id, "p1");
});

test("Z2 favoris : bascule + filtre catalogue", async (page, state) => {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid="p1"]', { timeout: 15000 });
  const fav = page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid="p1"] .mgs-pcard__fav');
  await fav.click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("mgs_favorites") || "[]").indexOf("p1") >= 0, null, { timeout: 8000 });
  assert.equal(await fav.getAttribute("aria-pressed"), "true");
  state.favorites = ["p1"];
  await page.goto(new URL("/index.html?game=pubg-mobile&favorites=1", page.url()).href, { waitUntil: "load" });
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("boutique"));
  await pageIs(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.mgs-boutique-catalog .mgs-pcard[data-pid]').length === 1, null, { timeout: 10000 });
  const ids = await page.$$eval('.mgs-boutique-catalog .mgs-pcard', (els) => els.map((e) => e.dataset.pid));
  assert.deepEqual(ids, ["p1"], "filtre favoris : " + JSON.stringify(ids));
  const req = state.urls.filter((u) => u.startsWith("GET /products?")).pop();
  assert.ok(/favorites=1/.test(req), "param favorites : " + req);
});

test("Z2 invité / connecté : pastille points", async (page, state) => {
  await boot(page);
  await page.waitForFunction(() => { const p = document.querySelector(".nav-points-pill"); return !!p && p.style.display === "none"; }, null, { timeout: 10000 });
  await page.evaluate(() => window.mgsShowPage("connexion"));
  await pageIs(page, "connexion");
  await page.locator("#em").fill("test@mg.store");
  await page.locator("#pw").fill("password123");
  await page.locator('.mgs-page[data-page="connexion"] a[data-nav="compte"]').click();
  await pageIs(page, "accueil");
  await page.waitForFunction(() => { const p = document.querySelector(".nav-points-pill"); return !!p && p.style.display !== "none"; }, null, { timeout: 10000 });
  const n = await page.$$eval(".nav-points-pill .pts-n", (els) => els.map((e) => e.textContent));
  assert.ok(n.indexOf("120") >= 0, "solde loyalty affiché : " + JSON.stringify(n));
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  const { server, url } = process.env.MGS_PROTO_URL ? { server: null, url: process.env.MGS_PROTO_URL } : await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    for (const theme of ["light", "dark"]) {
      console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) — thème ${theme} ===`);
      for (const { name, fn } of tests) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        context.setDefaultTimeout(12000);
        const page = await context.newPage();
        const state = { loggedIn: false, urls: [], favorites: [] };
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.addInitScript((t) => { try { localStorage.setItem("mgs-theme", t); localStorage.setItem("mgs_lang", "fr"); } catch (e) { } }, theme);
        const handler = apiHandler(page, state);
        await page.route("**/api/**", handler);
        try {
          await page.goto(url, { waitUntil: "load", timeout: 30000 });
          await fn(page, state);
          const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          const realErrors = errors.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
          assert.equal(realErrors.length, 0, "erreurs JS page: " + realErrors.join(" | "));
          console.log(`  ✓ ${name}  [fond ${bg}]`);
          pass++;
        } catch (e) {
          const msg = e && e.message ? e.message.split("\n")[0] : String(e);
          console.log("  ✗ " + name + "\n      " + msg);
          failures.push(`[${vp.label}/${theme}] ${name}: ${msg}`);
          fail++;
        } finally { await context.close(); }
      }
    }
  }
  await browser.close();
  if (server) server.close();
  console.log(`\n${pass} passed, ${fail} failed (${tests.length * VIEWPORTS.length * 2} runs)`);
  if (failures.length) { console.log("\nÉchecs :"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
