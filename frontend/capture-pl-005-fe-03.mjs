#!/usr/bin/env node
// PL-005-FE-03 — captures : accueil « à panneaux », nav (desktop pilule +
// mobile), footer, compatibilité barres du bas FE-02 (boutique).
// AUCUN appel production : build/ servi en local, appels /api interceptés et
// simulés (fixtures = celles de capture-pl-005-fe-04-partiel.mjs).
// Usage : node capture-pl-005-fe-03.mjs <chemin-chromium>
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
if (!CHROMIUM || !existsSync(CHROMIUM)) { console.error("[erreur] chemin chromium manquant"); process.exit(1); }
const OUT = process.env.OUT || "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-005-FE-03";
const BUILD_DIR = process.env.BUILD_DIR || join(process.cwd(), "build");
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

// Fixtures des tests (aucune invention) — mêmes que le driver FE-04.
const GAMES = [
  {
    id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
    description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC",
    identity_fields: [{ key: "player_id", primary: true, label: "ID PUBG Mobile", label_en: "PUBG Mobile ID" }],
    product_types: [
      { key: "uc", label: "UC", label_en: "UC" },
      { key: "prime", label: "Prime", label_en: "Prime" },
      { key: "prime_plus", label: "Prime+", label_en: "Prime+" },
      { key: "evo", label: "Pack évolutif", label_en: "Evolving pack" },
    ],
  },
  {
    id: "free-fire", name: "Free Fire", slug: "free-fire", active: true, sort_order: 1,
    description: "Diamants", currency_label: "Diamants",
    identity_fields: [{ key: "player_id", primary: true, label: "ID joueur", label_en: "Player ID" }],
    product_types: [{ key: "diamonds", label: "Diamants", label_en: "Diamonds" }],
  },
];
const PRODUCTS = [
  { id: "p1", slug: "60-uc", name: "60 UC", name_en: "60 UC", price: 5000, old_price: 5500, type: "uc", uc_amount: 60, popular: true, game_id: "pubg-mobile", active: true, sort_order: 0, purchasable: true },
  { id: "p2", slug: "325-uc", name: "325 UC", name_en: "325 UC", price: 21000, old_price: 22000, type: "uc", uc_amount: 325, game_id: "pubg-mobile", active: true, sort_order: 1, purchasable: true },
  { id: "p3", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 41000, old_price: 42000, type: "uc", uc_amount: 660, game_id: "pubg-mobile", active: true, sort_order: 2, purchasable: true },
  { id: "p4", slug: "prime-7", name: "Prime", name_en: "Prime", price: 2500, type: "prime", game_id: "pubg-mobile", active: true, sort_order: 3, purchasable: true },
];

const startServer = () => new Promise((resolveServer) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = join(BUILD_DIR, decodeURIComponent(url.pathname));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD_DIR, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  server.listen(0, "127.0.0.1", () => resolveServer({ server, port: server.address().port }));
});

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const mockRoutes = (pg) => {
    pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      if (p.includes("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
      if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
      if (p.includes("/settings/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ online: false }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
  };
  const VP = [{ w: 320, h: 900, mobile: true, label: "320" }, { w: 390, h: 844, mobile: true, label: "390" }, { w: 1440, h: 1000, mobile: false, label: "1440" }];
  for (const vp of VP) {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
      const pg = await ctx.newPage();
      await pg.addInitScript(`try{
        localStorage.setItem('mgs-theme','${theme}');
        localStorage.setItem('mgs_lang','fr');
        localStorage.setItem('mgs_selected_game','pubg-mobile');
        localStorage.setItem('mgs_cart','[]');
      }catch(e){}`);
      mockRoutes(pg);
      // ?capture : états finaux sans tweens (lib/slush.js) — captures
      // déterministes, aucune image en cours d'animation.
      await pg.goto(`${base}/?capture`, { waitUntil: "domcontentloaded" });
      await pg.waitForSelector('[data-testid="hero-title"]', { timeout: 15000 });
      await pg.waitForTimeout(1500);
      // Accueil : écran (hero + nav) et page complète (panneaux + footer).
      await pg.screenshot({ path: join(OUT, `home-${vp.label}-${theme}.png`), fullPage: false });
      await pg.screenshot({ path: join(OUT, `home-${vp.label}-${theme}-full.png`), fullPage: true });
      console.log(`✓ home-${vp.label}-${theme}(.full).png`);
      // Footer Slush (cartes sociales + colonne verte) : bas de page.
      if (vp.label !== "320") {
        await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await pg.waitForTimeout(600);
        await pg.screenshot({ path: join(OUT, `footer-${vp.label}-${theme}.png`), fullPage: false });
        console.log(`✓ footer-${vp.label}-${theme}.png`);
      }
      // Menu desktop ouvert (1440 clair uniquement — capture de la pilule).
      if (vp.label === "1440" && theme === "light") {
        await pg.click('[data-testid="desktop-menu-button"]');
        await pg.waitForSelector('[data-testid="desktop-menu"]');
        await pg.screenshot({ path: join(OUT, `nav-menu-1440-light.png`), fullPage: false });
        console.log("✓ nav-menu-1440-light.png");
        await pg.keyboard.press("Escape");
      }
      // Nav pilule fixe sur les pages non-accueil (1440 clair) : vérifier
      // visuellement qu'aucun contenu ne passe SOUS la nav (page-top).
      if (vp.label === "1440" && theme === "light") {
        for (const route of ["evenements", "suivi", "compte"]) {
          await pg.goto(`${base}/${route}?capture`, { waitUntil: "domcontentloaded" });
          await pg.waitForSelector("body", { timeout: 15000 });
          await pg.waitForTimeout(800);
          await pg.screenshot({ path: join(OUT, `nav-${route}-1440-light.png`), fullPage: false });
          console.log(`✓ nav-${route}-1440-light.png`);
        }
      }
      await ctx.close();
    }
  }
  // Compatibilité barres FE-02 : la boutique (390 clair) montre nav du bas +
  // bouton manette inchangés, avec la nouvelle taille 48 px.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.addInitScript(`try{
    localStorage.setItem('mgs-theme','light');
    localStorage.setItem('mgs_lang','fr');
    localStorage.setItem('mgs_selected_game','pubg-mobile');
    localStorage.setItem('mgs_cart','[]');
  }catch(e){}`);
  mockRoutes(pg);
  // ?capture : la barre du bas maquette est visible sans animation.
  await pg.goto(`${base}/boutique?game=pubg-mobile&capture`, { waitUntil: "domcontentloaded" });
  await pg.waitForSelector('[data-testid="catalog-game-name"]', { timeout: 15000 });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: join(OUT, "boutique-390-light.png"), fullPage: false });
  console.log("✓ boutique-390-light.png");
  await ctx.close();
  await browser.close();
  server.close();
  console.log("captures terminées →", OUT);
};
run().catch((e) => { console.error(e); process.exit(1); });
