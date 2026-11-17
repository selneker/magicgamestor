#!/usr/bin/env node
// PL-005-FE-02 — driver de captures + reproduction du bug de navigation
// (AUCUN appel production : build/ servi en local, appels /api interceptés et
// simulés). Structure reprise de capture-pl-005-fe-01.mjs.
//
// Usage : node capture-pl-005-fe-02.mjs <chemin-chromium> [mode]
//   mode = "full" (défaut) : captures + repro du bug
//   mode = "repro"         : repro seule (build ANCIEN, preuve « avant »)
// Env : OUT=<dossier> (défaut repports/captures/PL-005-FE-02),
//       BUILD_DIR=<dossier> (défaut ./build).
//
// Repro du bug (tâche 0) : /orders/:id en PREMIÈRE entrée d'historique
// (accès direct, history.idx = 0) → clic sur la flèche de retour :
//   AVANT : fallback navigate("/") en PUSH → « Retour » du navigateur
//           ramène à /orders/:id → oscillation infinie.
//   APRÈS : navigate("/suivi", { replace: true }) → le retour du navigateur
//           NE ramène PAS à l'écran de paiement.

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
const MODE = process.argv[3] || "full";
if (!CHROMIUM || !existsSync(CHROMIUM)) {
  console.error("[erreur] chemin chromium manquant ou inexistant");
  process.exit(1);
}
const OUT = process.env.OUT || "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-005-FE-02";
const BUILD_DIR = process.env.BUILD_DIR || join(process.cwd(), "build");
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const GAMES = [
  {
    id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
    description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC",
    identity_fields: [{ key: "player_id", primary: true, label: "ID PUBG Mobile", label_en: "PUBG Mobile ID" }],
    product_types: [{ key: "uc", label: "UC", label_en: "UC" }],
  },
];
const PRODUCTS = [
  { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 2500, type: "uc", game_id: "pubg-mobile", active: true, sort_order: 0, purchasable: true },
];
const PAYMENT_CONFIG = {
  mode: "papi", gateway: "papi", live: false, papi_auto: true, fiveone_enabled: false, auto_payment: true,
  payment_fees: { manual: { percent: 0, min: 0, max: 0 }, papi: { percent: 1.5, min: 100, max: 900 } },
  manual_only: false, timeout_minutes: 15,
  providers: {
    mvola: { configured: true, merchant: "0383905692", name: "Selneker Dino" },
    orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" },
  },
};
const USER = { user_id: "u1", email: "client@exemple.test", name: "Client", roles: [], permissions: [] };

const histoOrder = (over = {}) => ({
  id: "ord_1", order_number: "MGS-66458C", total: 2500, subtotal: 2500, payment_fee: 0,
  status: "pending_payment", payment_method: "mvola", manual_operator: null,
  pubg_id: "52328390220", game_id: "pubg-mobile", payment_phone: "0341234567",
  payment_deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(), payment_proofs: [],
  items: [{ product_id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  created_at: "2026-11-13T16:30:00Z", identity_snapshot: { source: "verified", fields: { player_id: "52328390220" } },
  ...over,
});

const ME = [
  histoOrder({ id: "ord_1", order_number: "MGS-66458C", status: "pending_payment" }),
  histoOrder({ id: "ord_2", order_number: "MGS-66490B", status: "paid" }),
  histoOrder({ id: "ord_3", order_number: "MGS-65510A", status: "delivered", paid_at: "2026-11-13T17:00:00Z" }),
  histoOrder({ id: "ord_4", order_number: "MGS-65102D", status: "cancelled", cancel_reason: "cannot_pay_now", cancelled_at: "2026-11-13T17:05:00Z" }),
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

  const mockRoutes = (pg, { loggedIn = true } = {}) => {
    pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) {
        return route.fulfill({ status: loggedIn ? 200 : 401, contentType: "application/json", body: JSON.stringify(loggedIn ? USER : {}) });
      }
      if (p.includes("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
      if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
      if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
      if (p.includes("/settings/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ online: false }) });
      if (p.includes("/orders/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME) });
      if (/\/orders\/(?!me|track)[\w-]+$/.test(p)) {
        // Détail : la commande annulée sert aussi de preuve (raison + preuve).
        const cancelled = p.endsWith("ord_4");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(
          cancelled
            ? histoOrder({ id: "ord_4", order_number: "MGS-65102D", status: "cancelled", cancel_reason: "cannot_pay_now", cancelled_at: "2026-11-13T17:05:00Z", cancel_note: "Je paierai plus tard", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] })
            : histoOrder({}),
        ) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
  };

  const newPage = async (vp, theme, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
    const pg = await ctx.newPage();
    await pg.addInitScript(`try{
      localStorage.setItem('mgs-theme','${theme}');
      localStorage.setItem('mgs_lang','fr');
      localStorage.setItem('mgs_selected_game','pubg-mobile');
      localStorage.setItem('mgs_cart','[]');
    }catch(e){}`);
    mockRoutes(pg, opts);
    return { ctx, pg };
  };

  // ------------------------------------------------------------- REPRO BUG
  // Écran de paiement ouvert EN ACCÈS DIRECT (idx = 0) : c'est le seul cas
  // où l'ancien fallback navigate("/") bouclait.
  {
    const { ctx, pg } = await newPage({ w: 390, h: 844, mobile: true }, "light");
    await pg.goto(`${base}/orders/ord_1`, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(2500);
    const url0 = new URL(pg.url()).pathname;
    await pg.click('[data-testid="order-back"]');
    await pg.waitForTimeout(800);
    const url1 = new URL(pg.url()).pathname;
    await pg.goBack();
    await pg.waitForTimeout(800);
    const url2 = new URL(pg.url()).pathname;
    console.log(`[repro] URL initiale (entrée directe, idx=0) : ${url0}`);
    console.log(`[repro] après clic sur la flèche        : ${url1}`);
    console.log(`[repro] après « Retour » du navigateur : ${url2}`);
    const loops = url2 === url0;
    console.log(`[repro] ${loops ? "BOUCLE (comportement AVANT fix)" : "PAS DE BOUCLE (comportement APRÈS fix)"}`);
    await pg.screenshot({ path: join(OUT, "repro-retour.png") });
    await ctx.close();
  }

  if (MODE !== "full") { await browser.close(); server.close(); return; }

  // ------------------------------------------------------------- CAPTURES
  // 1-2. Liste mobile 390 + 320 (clair + sombre) : CommandButton fermé +
  //      historique embarqué.
  for (const vp of [{ w: 390, h: 844, mobile: true }, { w: 320, h: 640, mobile: true }]) {
    for (const theme of ["light", "dark"]) {
      const { ctx, pg } = await newPage(vp, theme);
      await pg.goto(`${base}/suivi`, { waitUntil: "domcontentloaded" });
      await pg.waitForTimeout(2200);
      await pg.screenshot({ path: join(OUT, `liste-${vp.w}-${theme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  // 3. Invité non connecté (mobile 390) : message + bouton de connexion.
  {
    const { ctx, pg } = await newPage({ w: 390, h: 844, mobile: true }, "light", { loggedIn: false });
    await pg.goto(`${base}/suivi`, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(2200);
    await pg.screenshot({ path: join(OUT, "liste-390-invite.png"), fullPage: true });
    await ctx.close();
  }
  // 4-5. Desktop 1440 : liste avec bouton FERMÉ puis OUVERT (clair + sombre).
  for (const theme of ["light", "dark"]) {
    const { ctx, pg } = await newPage({ w: 1440, h: 900, mobile: false }, theme);
    await pg.goto(`${base}/suivi`, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(2200);
    await pg.screenshot({ path: join(OUT, `desktop-ferme-1440-${theme}.png`), fullPage: true });
    await pg.click('[data-testid="command-button-trigger"]');
    await pg.waitForTimeout(900);
    await pg.screenshot({ path: join(OUT, `desktop-ouvert-1440-${theme}.png`), fullPage: true });
    await ctx.close();
  }
  // 6-8. Détail (mobile 390, clair) : annulée (badge ✕, barre du bas),
  //      replié, déplié ; 9. livrée.
  {
    const vp = { w: 390, h: 844, mobile: true };
    const { ctx, pg } = await newPage(vp, "light");
    await pg.goto(`${base}/commandes/ord_4`, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(2200);
    await pg.screenshot({ path: join(OUT, "detail-annulee.png"), fullPage: true });
    // Barre du bas seule (fin de page).
    await pg.screenshot({ path: join(OUT, "detail-annulee-barre.png") });
    // Replié → déplié (chevron nu).
    await pg.click('[data-testid="order-details-toggle"]');
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: join(OUT, "detail-annulee-deplie.png"), fullPage: true });
    await ctx.close();
    const { ctx: c2, pg: p2 } = await newPage(vp, "light");
    await p2.goto(`${base}/commandes/ord_1`, { waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(2200);
    await p2.screenshot({ path: join(OUT, "detail-paiement-replie.png"), fullPage: true });
    // Déplié.
    await p2.click('[data-testid="order-details-toggle"]');
    await p2.waitForTimeout(500);
    await p2.screenshot({ path: join(OUT, "detail-paiement-deplie.png"), fullPage: true });
    await c2.close();
    const { ctx: c3, pg: p3 } = await newPage(vp, "dark");
    await p3.goto(`${base}/commandes/ord_3`, { waitUntil: "domcontentloaded" });
    await p3.waitForTimeout(2200);
    await p3.screenshot({ path: join(OUT, "detail-livree-sombre.png"), fullPage: true });
    await c3.close();
  }

  await browser.close();
  server.close();
  console.log("[ok] captures dans", OUT);
};

run().catch((e) => { console.error(e); process.exit(1); });
