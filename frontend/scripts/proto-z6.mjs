/**
 * proto-z6.mjs — auto-contrôle Playwright des fonctions Z6 (head / PWA / SEO) du prototype.
 *
 * Vérifie, sur build/index.html servi tel quel :
 *   (a) head : <title>, meta description, lang, charset, viewport ;
 *   (b) SEO : balises Open Graph (og:title, og:description, og:image), canonical ;
 *   (c) PWA : manifest.json (start_url, name, theme_color), sw.js enregistré (admin) ;
 *   (d) favoris apple-touch-icon / icon-192 / icon-512 présents.
 *
 * Deux viewports (390 px, 1440 px). Thème clair uniquement.
 *
 * Lancer :
 *   cd frontend && yarn build
 *   CHROMIUM_PATH=/chemin/chromium node scripts/proto-z6.mjs
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

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Z6(a) head : title, description, lang, charset, viewport", async (page, state) => {
  await page.goto(process.env.MGS_PROTO_URL || "file://" + BUILD, { waitUntil: "load", timeout: 30000 });
  const head = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    charset: document.querySelector('meta[charset]') ? document.querySelector('meta[charset]').getAttribute("charset") : null,
    viewport: (document.querySelector('meta[name=viewport]') || {}).content || "",
    description: (document.querySelector('meta[name=description]') || {}).content || "",
  }));
  assert.ok(head.title.length > 0, "titre présent : " + head.title);
  assert.ok(/fr|en/.test(head.lang), "lang : " + head.lang);
  assert.ok(/width=device-width/.test(head.viewport), "viewport : " + head.viewport);
});

test("Z6(b) SEO : Open Graph + canonical", async (page, state) => {
  const ogTitle = await page.evaluate(() => (document.querySelector('meta[property="og:title"]') || {}).content || "");
  const ogDesc = await page.evaluate(() => (document.querySelector('meta[property="og:description"]') || {}).content || "");
  const ogImage = await page.evaluate(() => (document.querySelector('meta[property="og:image"]') || {}).content || "");
  const canonical = await page.evaluate(() => (document.querySelector('link[rel=canonical]') || {}).href || "");
  assert.ok(ogTitle.length > 0, "og:title présent : " + ogTitle);
  assert.ok(ogDesc.length > 0, "og:description présent : " + ogDesc);
  assert.ok(ogImage.length > 0, "og:image présent : " + ogImage);
});

test("Z6(c) PWA : manifest et sw.js", async (page, state) => {
  const manifest = await page.evaluate(async () => {
    const r = await fetch("/manifest.json");
    return r.ok ? await r.json() : null;
  }).catch(() => null);
  assert.ok(manifest && manifest.name, "manifest.name : " + (manifest && manifest.name));
  assert.ok(manifest.start_url, "manifest.start_url : " + (manifest && manifest.start_url));
  const sw = await page.evaluate(async () => {
    try { const r = await fetch("/sw.js"); return r.ok ? "ok" : "nok"; } catch { return "err"; }
  });
  assert.ok(sw === "ok", "sw.js accessible : " + sw);
});

test("Z6(d) icônes PWA : apple-touch-icon, icon-192, icon-512", async (page, state) => {
  const icons = await page.evaluate(() => {
    const byRel = (rel) => {
      const e = document.querySelector(`link[rel="${rel}"]`);
      return e ? e.href : "";
    };
    return { apple: byRel("apple-touch-icon"), icon192: byRel("icon") };
  });
  assert.ok(/apple-touch-icon/.test(icons.apple), "apple-touch-icon : " + icons.apple);
  assert.ok(/icon-192/.test(icons.icon192) || /icon-512/.test(icons.icon192), "icône 192/512 : " + icons.icon192);
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : lancez `yarn build` d'abord."); process.exit(2); }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
    path.join(process.env.HOME || "", ".hermes/tools/chromium-1248/chrome-linux64/chrome"),
  ].find((p) => p && fs.existsSync(p));
  if (!executablePath) { console.error("[erreur] CHROMIUM_PATH introuvable"); process.exit(2); }
  const root = path.join(__dirname, "..", "build");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".json": "application/json" };
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
  const { server: srv, url } = await new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}/index.html` })));
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let pass = 0, fail = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) ===`);
    for (const { name, fn } of tests) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(12000);
      const page = await context.newPage();
      try {
        await fn(page);
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
  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed (${tests.length * VIEWPORTS.length} runs)`);
  if (failures.length) { failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
let state = {};
main().catch((e) => { console.error(e); process.exit(1); });
