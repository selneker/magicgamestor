#!/usr/bin/env node
/**
 * Captures et vérifications Playwright pour PL-BRAND-1 (logo + loader + en-tête mobile).
 *
 * Usage : cd frontend && yarn build && CHROMIUM_PATH=/chemin/vers/chrome \
 *           OUT_DIR=/tmp/opencode/brand-captures node scripts/capture-brand.mjs
 *
 * Sert build/ en local, intercepte /api (données simulées, comme audit-contrast.mjs),
 * puis vérifie : loader (timing, une fois par session, peint avant le bundle),
 * en-tête mobile 3 zones (centrage logo, pastille compacte, repli au défilement),
 * et produit les captures demandées.
 */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(root, "build");
const OUT = process.env.OUT_DIR || "/tmp/opencode/brand-captures";
mkdirSync(OUT, { recursive: true });

const CHROMIUM = process.env.CHROMIUM_PATH;
if (!CHROMIUM || !existsSync(CHROMIUM)) {
  console.error("CHROMIUM_PATH requis (le script ne télécharge rien).");
  process.exit(1);
}
if (!existsSync(join(BUILD_DIR, "index.html"))) {
  console.error("Bundle introuvable — lancez `yarn build` d'abord.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".map": "application/json",
};

/* ------------------------------------------------- données simulées (audit) */

const GAMES = [
  {
    id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
    description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC", icon_url: "",
    product_types: [
      { key: "uc", label: "UC", label_en: "UC" },
      { key: "prime", label: "Prime", label_en: "Prime" },
      { key: "prime_plus", label: "Prime+", label_en: "Prime+" },
      { key: "evo", label: "Pack evolutif", label_en: "Evo pack" },
    ],
    identity_fields: [
      { key: "player_id", label: "ID PUBG Mobile", label_en: "PUBG Mobile ID",
        pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true, primary: true },
    ],
  },
];

const PRODUCTS = [
  { id: "p1", name: "660 UC", slug: "660-uc", price: 2500, game_id: "pubg-mobile", type: "uc",
    uc_amount: 660, duration_months: null, popular: true, purchasable: true, old_price: null, description: "660 UC" },
];

const EVENTS = [];
const USER = { user_id: "u1", email: "client@exemple.test", name: "Client", roles: [], permissions: [] };

// Solde de fidélité simulé : mutable pour tester les 5 valeurs de la pastille.
let loyaltyTotal = 12500;

const mockApi = (pathname) => {
  if (pathname.endsWith("/games")) return GAMES;
  if (pathname.includes("/products")) return PRODUCTS;
  if (pathname.includes("/events")) return EVENTS;
  if (pathname.includes("/settings/status")) return { online: true };
  if (pathname.includes("/loyalty/me")) return { balance: { total: loyaltyTotal, earned: loyaltyTotal, promo: 0 }, ledger: [], config: {} };
  if (pathname.includes("/loyalty/rewards")) return [];
  if (pathname.includes("/orders/me")) return [];
  return [];
};

const startServer = () =>
  new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      let file = join(BUILD_DIR, decodeURIComponent(url.pathname));
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD_DIR, "index.html");
      try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolveServer({ server, port: server.address().port }));
  });

/* ------------------------------------------------------------------ checks */

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/* -------------------------------------------------------------------- run */

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

  const newPage = async ({ width = 390, height = 844, theme = "light", lang = "fr", loggedIn = false, reducedMotion = null, blockJs = false } = {}) => {
    const ctx = await browser.newContext({
      viewport: { width, height },
      reducedMotion: reducedMotion || "no-preference",
    });
    if (blockJs) await ctx.route("**/static/**/*.js", (r) => r.abort());
    const pg = await ctx.newPage();
    await pg.addInitScript(
      `try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','${lang}');}catch(e){}`,
    );
    await pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) {
        return route.fulfill({
          status: loggedIn ? 200 : 401,
          contentType: "application/json",
          body: JSON.stringify(loggedIn ? USER : {}),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockApi(p)) });
    });
    return { ctx, pg };
  };

  /* A. Loader : timing, accessibilité, une fois par session */
  {
    const { ctx, pg } = await newPage();
    const t0 = Date.now();
    // « commit » : la réponse HTML commence d'arriver. Le loader est dans le
    // HTML brut : s'il est là maintenant, il est peint avant tout JS.
    await pg.goto(base + "/", { waitUntil: "commit" });
    await pg.locator("#mgs-loader").waitFor({ state: "attached", timeout: 5000 });
    check("loader présent dans le HTML initial (peint avant le bundle)", true);
    check(
      "loader role=status + aria-live=polite",
      (await pg.locator('#mgs-loader[role="status"][aria-live="polite"]').count()) === 1,
      `html=${(await pg.evaluate(() => document.getElementById("mgs-loader")?.outerHTML || "ABSENT")).slice(0, 120)}`,
    );
    // ~0,3 s et ~1 s : sur une machine locale le bundle rend trop vite pour
    // figer le loader plein écran — les captures à ces instants sont prises
    // en section B (bundle bloqué, loader réellement affiché).
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    const elapsed = Date.now() - t0;
    check("loader retiré du DOM après fondu, affichage ≥ 1,3 s (min 900 ms + fondu)", elapsed >= 1300, `${elapsed} ms`);
    await pg.screenshot({ path: join(OUT, "loader-apres-fondu.png") });
    await pg.reload({ waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(400);
    check("une fois par session : pas de loader au rechargement", (await pg.locator("#mgs-loader").count()) === 0);
    await ctx.close();
  }

  /* B. Preuve : le loader est peint avant le bundle (JS bloqué → loader reste).
     C'est aussi là que sont prises les captures à 0,3 s et 1 s : le loader
     y est réellement affiché, sans fondu déjà déclenché. */
  {
    const { ctx, pg } = await newPage({ blockJs: true });
    const t0 = Date.now();
    await pg.goto(base + "/", { waitUntil: "commit" });
    await pg.locator("#mgs-loader").waitFor({ state: "attached", timeout: 5000 });
    await pg.waitForTimeout(Math.max(0, t0 + 300 - Date.now()));
    check("loader visible à ~0,3 s (bundle bloqué)", await pg.locator("#mgs-loader").isVisible());
    await pg.screenshot({ path: join(OUT, "loader-03s.png") });
    await pg.waitForTimeout(Math.max(0, t0 + 1000 - Date.now()));
    check("loader encore visible à ~1 s (min 900 ms respecté)", await pg.locator("#mgs-loader").isVisible());
    await pg.screenshot({ path: join(OUT, "loader-1s.png") });
    await pg.waitForTimeout(1000);
    check("loader visible 2 s même avec le bundle JS bloqué (peint avant React)", await pg.locator("#mgs-loader").isVisible());
    await pg.screenshot({ path: join(OUT, "loader-js-bloque.png") });
    await ctx.close();
  }

  /* C. En-tête mobile connecté : centrage, pastille, captures */
  {
    const { ctx, pg } = await newPage({ loggedIn: true });
    await pg.goto(base + "/", { waitUntil: "domcontentloaded" });
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(800);

    check("barre mobile 3 zones présente", (await pg.locator('[data-testid="header-mobile-bar"]').count()) === 1);

    const logoBox = await pg.locator('[data-testid="header-mobile-bar"] [data-testid="header-logo"]').boundingBox();
    const offset = Math.abs(logoBox.x + logoBox.width / 2 - 390 / 2);
    check("logo exactement centré (±2 px)", offset <= 2, `écart ${offset.toFixed(1)} px`);

    const pillInner = await pg.locator('[data-testid="header-loyalty-pill"] > span').boundingBox();
    check("pastille : hauteur visuelle 28 px", Math.round(pillInner.height) === 28, `${Math.round(pillInner.height)} px`);
    check("pastille : largeur ≤ 80 px (12,5 k)", pillInner.width <= 80, `${Math.round(pillInner.width)} px`);
    const pillText = await pg.locator('[data-testid="header-loyalty-pill-value"]').textContent();
    check("12 500 → « 12,5 k »", pillText.includes("12,5"), JSON.stringify(pillText));
    const aria = await pg.locator('[data-testid="header-loyalty-pill"]').getAttribute("aria-label");
    check("aria-label « 12500 points »", aria === "12500 points", JSON.stringify(aria));
    const pillAll = await pg.locator('[data-testid="header-loyalty-pill"]').textContent();
    check("pas de libellé « pts » visible sur mobile", !pillAll.toLowerCase().includes("pts"));
    const pillLink = await pg.locator('[data-testid="header-loyalty-pill"]').boundingBox();
    check("cible tactile pastille ≥ 44 px de haut", pillLink.height >= 44, `${Math.round(pillLink.height)} px`);

    await pg.screenshot({ path: join(OUT, "mobile-390-connecte-haut.png") });

    /* Les 5 valeurs de solde (+ 9999, pire cas de largeur) */
    for (const [n, marker] of [[0, "0"], [500, "500"], [1250, "1"], [9999, "9"], [12500, "12,5"], [1250000, "1,2"]]) {
      loyaltyTotal = n;
      const v = await newPage({ loggedIn: true });
      await v.pg.goto(base + "/", { waitUntil: "domcontentloaded" });
      await v.pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
      await v.pg.waitForTimeout(600);
      const txt = await v.pg.locator('[data-testid="header-loyalty-pill-value"]').textContent();
      const w = (await v.pg.locator('[data-testid="header-loyalty-pill"] > span').boundingBox()).width;
      const h = (await v.pg.locator('[data-testid="header-loyalty-pill"] > span').boundingBox()).height;
      check(`solde ${n} → contient « ${marker} », largeur ≤ 80 px, une ligne`, txt.includes(marker) && w <= 80 && Math.round(h) === 28, `« ${txt} » ${Math.round(w)}×${Math.round(h)} px`);
      await v.ctx.close();
    }
    loyaltyTotal = 12500;

    /* Écran étroit 320 px */
    {
      const n = await newPage({ width: 320, height: 690, loggedIn: true });
      await n.pg.goto(base + "/", { waitUntil: "domcontentloaded" });
      await n.pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
      await n.pg.waitForTimeout(600);
      const w = (await n.pg.locator('[data-testid="header-loyalty-pill"] > span').boundingBox()).width;
      const overflow = await n.pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      check("320 px : pastille ≤ 80 px, pas de défilement horizontal", w <= 80 && !overflow, `${Math.round(w)} px`);
      await n.pg.screenshot({ path: join(OUT, "mobile-320-connecte-haut.png") });
      await n.ctx.close();
    }
    await ctx.close();
  }

  /* D. En-tête mobile déconnecté */
  {
    const { ctx, pg } = await newPage({ loggedIn: false });
    await pg.goto(base + "/", { waitUntil: "domcontentloaded" });
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(600);
    check("déconnecté : bouton Connexion visible, pastille absente",
      (await pg.locator('[data-testid="login-button"]:visible').count()) === 1 &&
      (await pg.locator('[data-testid="header-loyalty-pill"]').count()) === 0);
    await pg.screenshot({ path: join(OUT, "mobile-390-deconnecte-haut.png") });
    await ctx.close();
  }

  /* E. Repli au défilement (mobile) */
  {
    const { ctx, pg } = await newPage({ loggedIn: true });
    await pg.goto(base + "/", { waitUntil: "domcontentloaded" });
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(400);
    await pg.evaluate(() => window.scrollTo(0, 800));
    await pg.waitForTimeout(400);
    check("descente : en-tête replié", (await pg.locator('header[data-collapsed="true"]').count()) === 1);
    await pg.screenshot({ path: join(OUT, "mobile-390-scroll-bas.png") });
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.waitForTimeout(400);
    check("remontée : en-tête réapparu", (await pg.locator('header[data-collapsed="false"]').count()) === 1);
    await pg.screenshot({ path: join(OUT, "mobile-390-scroll-haut.png") });
    await ctx.close();
  }

  /* F. Thème sombre */
  {
    const { ctx, pg } = await newPage({ theme: "dark", loggedIn: true });
    await pg.goto(base + "/", { waitUntil: "domcontentloaded" });
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(600);
    check("sombre : barre mobile présente", (await pg.locator('[data-testid="header-mobile-bar"]').count()) === 1);
    await pg.screenshot({ path: join(OUT, "mobile-390-connecte-sombre.png") });
    await ctx.close();
  }

  /* G. prefers-reduced-motion : repli désactivé */
  {
    const { ctx, pg } = await newPage({ loggedIn: true, reducedMotion: "reduce" });
    await pg.goto(base + "/", { waitUntil: "domcontentloaded" });
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(400);
    await pg.evaluate(() => window.scrollTo(0, 800));
    await pg.waitForTimeout(400);
    check("reduced-motion : en-tête non replié à la descente", (await pg.locator('header[data-collapsed="false"]').count()) === 1);
    await pg.screenshot({ path: join(OUT, "mobile-390-reduced-motion.png") });
    await ctx.close();
  }

  /* H. Bureau 1280×800 : inchangé (pas de barre mobile) */
  {
    const { ctx, pg } = await newPage({ width: 1280, height: 800, loggedIn: true });
    await pg.goto(base + "/", { waitUntil: "domcontentloaded" });
    await pg.locator("#mgs-loader").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(600);
    check("bureau : barre mobile masquée, logo bureau visible",
      (await pg.locator('[data-testid="header-mobile-bar"]').isHidden()) &&
      (await pg.locator('header [data-testid="header-logo"]:visible').count()) === 1);
    await pg.screenshot({ path: join(OUT, "desktop-1280-connecte.png") });
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} échec(s)` : "\nTout OK");
  process.exit(failures ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
