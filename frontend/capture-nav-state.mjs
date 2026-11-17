#!/usr/bin/env node
// PL-NAV-1-COMPACT — driver de diagnostic (état AVANT/APRÈS). AUCUN appel
// production : build servi en local, appels /api interceptés. NON COMMITÉ.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
const TAG = process.argv[3] || "avant";
if (!CHROMIUM || !existsSync(CHROMIUM)) { console.error("chemin chromium manquant"); process.exit(1); }
const OUT = `/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-NAV-1-COMPACT`;
const BUILD_DIR = join(process.cwd(), "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const ICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%23D4FF00'/><circle cx='48' cy='48' r='30' fill='%23111111'/></svg>`);
const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", icon_url: ICON, active: true, sort_order: 0, currency_label: "UC" },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", icon_url: ICON, active: true, sort_order: 1, currency_label: "D" },
  { id: "genshin", slug: "genshin", name: "Genshin Impact", icon_url: ICON, active: true, sort_order: 2, currency_label: "Genesis" },
  { id: "gta-v", slug: "gta-v", name: "GTA V", active: true, sort_order: 3, currency_label: "$" },
  { id: "coc", slug: "coc", name: "Clash of Clans", active: true, sort_order: 4, currency_label: "Gems" },
  { id: "fortnite", slug: "fortnite", name: "Fortnite", active: true, sort_order: 5, currency_label: "V" },
];
const PRODUCTS = [{ id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 2500, type: "uc", game_id: "pubg-mobile", active: true, sort_order: 0 }];
const PAYMENT_CONFIG = { providers: { mvola: { configured: true }, orange: { configured: true } }, payment_fees: {} };

const startServer = () => new Promise((res) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = join(BUILD_DIR, decodeURIComponent(url.pathname));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD_DIR, "index.html");
    try { const body = await readFile(file); res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" }); res.end(body); }
    catch { res.writeHead(404).end("not found"); }
  });
  server.listen(0, "127.0.0.1", () => res({ server, port: server.address().port }));
});

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

  for (const [w, h] of [[320, 640], [360, 640], [390, 844], [430, 844]]) {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const pg = await ctx.newPage();
      await pg.route("**/api/**", (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p.includes("/auth/me")) return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
        if (p.endsWith("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
        if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
        if (p.includes("/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
        if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });
      await pg.addInitScript(`try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');localStorage.setItem('mgs_selected_game','pubg-mobile');}catch(e){}`);
      try {
        await pg.goto(base + "/boutique?game=pubg-mobile", { waitUntil: "domcontentloaded", timeout: 30000 });
        await pg.waitForSelector('[data-testid="bottom-nav"]', { timeout: 15000 });
        await pg.waitForTimeout(1500);
        // Mesures : largeur de la barre, géométrie du bouton manette.
        const m = await pg.evaluate(() => {
          const nav = document.querySelector('[data-testid="bottom-nav"]');
          const btn = document.querySelector('[data-testid="game-button"]');
          const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
          const img = btn?.querySelector("img");
          const svg = btn?.querySelector('svg');
          return {
            nav: r(nav), btn: r(btn), innerH: window.innerHeight, innerW: window.innerWidth,
            imgRound: img ? getComputedStyle(img).borderRadius : null,
            imgRect: img ? r(img) : null, btnRadius: getComputedStyle(btn).borderRadius,
            svgRect: svg ? r(svg) : null,
          };
        });
        console.log(`${TAG} ${w}x${h} ${theme}:`, JSON.stringify(m));
        // Captures : barre seule, switcher fermé (jeu actif), switcher ouvert,
        // switcher fermé sans jeu actif.
        await pg.screenshot({ path: join(OUT, `${TAG}-ferme-actif-${w}x${h}-${theme}.png`) });
        await pg.click('[data-testid="game-button"]');
        await pg.waitForTimeout(700);
        await pg.screenshot({ path: join(OUT, `${TAG}-ouvert-${w}x${h}-${theme}.png`) });
        await pg.click('[data-testid="game-button"]');
        await pg.waitForTimeout(500);
        if (w === 390) {
          await pg.goto(base + "/boutique", { waitUntil: "domcontentloaded" });
          await pg.waitForSelector('[data-testid="bottom-nav"]', { timeout: 15000 });
          await pg.waitForTimeout(1200);
          await pg.screenshot({ path: join(OUT, `${TAG}-ferme-sans-jeu-${w}x${h}-${theme}.png`) });
        }
      } catch (e) { console.error(`KO ${w}x${h} ${theme}: ${e.message}`); }
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
};
run();
