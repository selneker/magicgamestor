/**
 * Captures de reference de la phase 2 (etat final) : carte produit, panneaux
 * d'encre, barre panier, selecteur de jeu, page points.
 * Sortie : <repo>/audit-shots/
 * Usage : node shots-phase2.mjs [dossier]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright-core";

const EXE = "/home/selneker/.hermes/tools/chromium-1208/chrome-linux64/chrome";
const BUILD = "/home/selneker/magicgamestor/frontend/build";
const OUT = process.argv[2] || "/home/selneker/magicgamestor/audit-shots";
mkdirSync(OUT, { recursive: true });

const GAMES = [{ id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
  description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC", icon_url: "https://x/i.png",
  product_types: [{ key: "uc", label: "UC", label_en: "UC" }, { key: "prime", label: "Prime", label_en: "Prime" }, { key: "prime_plus", label: "Prime+", label_en: "Prime+" }, { key: "evo", label: "Pack evolutif", label_en: "Evo pack" }] }];
const PRODUCTS = [
  { id: "p1", name: "660 UC", slug: "660-uc", price: 2500, game_id: "pubg-mobile", type: "uc", uc_amount: 660, popular: true, purchasable: true },
  { id: "p2", name: "1800 UC", slug: "1800-uc", price: 6500, game_id: "pubg-mobile", type: "uc", uc_amount: 1800, popular: true, old_price: 8000, purchasable: true },
  { id: "p3", name: "Prime+ 14 jours", slug: "prime-14", price: 4500, game_id: "pubg-mobile", type: "prime_plus", duration_months: 14, popular: false, purchasable: true },
  { id: "p4", name: "Pack evolutif", slug: "pack-evolutif", price: 19000, game_id: "pubg-mobile", type: "evo", popular: false, purchasable: true },
  { id: "p5", name: "6600 UC", slug: "6600-uc", price: 22000, game_id: "pubg-mobile", type: "uc", uc_amount: 6600, popular: true, old_price: 26000, purchasable: true },
  { id: "p6", name: "Prime 7 jours", slug: "prime-7", price: 2500, game_id: "pubg-mobile", type: "prime", duration_months: 7, popular: false, purchasable: true },
  { id: "p7", name: "330 UC", slug: "330-uc", price: 1200, game_id: "pubg-mobile", type: "uc", uc_amount: 330, popular: false, purchasable: false },
];
const USER = { user_id: "u1", email: "client@exemple.test", name: "Client", roles: [], permissions: [] };

const mockApi = (pathname) => {
  if (pathname.endsWith("/games")) return GAMES;
  if (pathname.includes("/products")) return PRODUCTS;
  if (pathname.includes("/settings/status")) return { online: false };
  if (pathname.includes("/crypto/config")) return { available: false, networks: [] };
  if (pathname.includes("/loyalty/me")) return { balance: { total: 1200, earned: 1200, promo: 0 }, ledger: [], config: {} };
  if (pathname.includes("/me/game-identities")) return [];
  if (pathname.includes("/orders/me")) return [];
  return [];
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".map": "application/json" };

const server = await new Promise((res) => {
  const s = createServer(async (req, rq) => {
    const url = new URL(req.url, "http://localhost");
    let file = join(BUILD, decodeURIComponent(url.pathname));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD, "index.html");
    try { const body = await readFile(file); rq.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" }); rq.end(body); }
    catch { rq.writeHead(404).end("not found"); }
  });
  s.listen(0, "127.0.0.1", () => res({ s, port: s.address().port }));
});
const base = `http://127.0.0.1:${server.port}`;

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });

for (const [w, h, label] of [[390, 844, "390px"], [1440, 900, "1440px"]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w === 390, hasTouch: w === 390 });
    const pg = await ctx.newPage();
    const cart = JSON.stringify([{ id: "p1", slug: "660-uc", name: "660 UC", price: 2500, qty: 1, type: "uc", game_id: "pubg-mobile" }]);
    await pg.addInitScript(`try{
      localStorage.setItem('mgs-theme','${theme}');
      localStorage.setItem('mgs_lang','fr');
      localStorage.setItem('mgs_selected_game','pubg-mobile');
      localStorage.setItem('mgs_cart', ${JSON.stringify(cart)});
    }catch(e){}`);
    await pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockApi(p)) });
    });

    // Catalogue : les variantes de carte produit
    await pg.goto(base + "/boutique?game=pubg-mobile", { waitUntil: "domcontentloaded", timeout: 30000 });
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `${OUT}/ph2-carte-produit-${label}-${theme}.png`, fullPage: true });

    // Accueil : les panneaux d'encre
    await pg.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `${OUT}/ph2-panneaux-accueil-${label}-${theme}.png` });

    // Selecteur de jeu (le panneau artisanal)
    if (w === 390) {
      const gb = await pg.$('[data-testid="game-button"]');
      if (gb && (await gb.isVisible())) {
        await gb.click();
        await pg.waitForTimeout(900);
        const panel = await pg.$('[data-testid="game-selector-panel"]');
        if (panel) await panel.screenshot({ path: `${OUT}/ph2-selecteur-jeu-${label}-${theme}.png` });
      }
    }
    await ctx.close();
  }
}

// Page points (.panel-points + .eyebrow-invert)
for (const [w, h, label] of [[390, 844, "390px"], [1440, 900, "1440px"]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w === 390, hasTouch: w === 390 });
    const pg = await ctx.newPage();
    await pg.addInitScript(`try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');}catch(e){}`);
    await pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockApi(p)) });
    });
    await pg.goto(base + "/compte/points", { waitUntil: "domcontentloaded", timeout: 30000 });
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `${OUT}/ph2-points-fidelite-${label}-${theme}.png` });
    await ctx.close();
  }
}

await browser.close();
server.s.close();
console.log("ok ->", OUT);
