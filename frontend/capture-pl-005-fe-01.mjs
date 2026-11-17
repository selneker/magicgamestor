#!/usr/bin/env node
// PL-005-FE-01 — driver de captures (AUCUN appel production : build/ servi en
// local, appels /api interceptés et simulés). Structure reprise de
// capture-pl-chk-4.mjs (server statique + route "**/api/**").
//
// Usage : node capture-pl-005-fe-01.mjs <chemin-chromium>
// Sortie : PNG dans repports/captures/PL-005-FE-01/ (NON suivi git).
//
// Prérequis : yarn build avec REACT_APP_BACKEND_URL positionné.
// Captures : maquette (référence) vs pages /commandes + /commandes/:id,
// liste + détail en cours + détail livrée (+ aperçu du reçu imprimable),
// 390 px et 320 px, clair et sombre.

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
if (!CHROMIUM || !existsSync(CHROMIUM)) {
  console.error("[erreur] chemin chromium manquant ou inexistant");
  process.exit(1);
}
const OUT = "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-005-FE-01";
const MAQUETTE = "/home/selneker/Projects/GameStore/magicgamestor/repports/maquettes/apercu-historique-commandes.html";
const BUILD_DIR = join(process.cwd(), "build");
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

// Liste : les quatre familles de statut (la pastille d'aide ne doit apparaître
// que sur les non livrées/annulées — cf. maquette).
const ME = [
  histoOrder({ id: "ord_1", order_number: "MGS-66458C", status: "pending_payment" }),
  histoOrder({ id: "ord_2", order_number: "MGS-66490B", status: "paid" }),
  histoOrder({ id: "ord_3", order_number: "MGS-65510A", status: "delivered", paid_at: "2026-11-13T17:00:00Z" }),
  histoOrder({ id: "ord_4", order_number: "MGS-65102D", status: "cancelled", cancel_reason: "cannot_pay_now", cancelled_at: "2026-11-13T17:05:00Z" }),
];

const SCENARIOS = [
  { name: "01-liste", path: "/commandes", me: ME },
  { name: "02-detail-en-cours", path: "/commandes/ord_1", order: histoOrder({ status: "paid" }), me: ME },
  { name: "03-detail-livree", path: "/commandes/ord_1", order: histoOrder({ status: "delivered", paid_at: "2026-11-13T17:00:00Z" }), me: ME },
];
const VIEWPORTS = [{ w: 390, h: 844 }, { w: 320, h: 640 }];
const THEMES = ["light", "dark"];

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
  let count = 0;

  // Maquette de référence (fichier local, hors dépôt git).
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    try {
      await pg.goto(`file://${MAQUETTE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.waitForTimeout(800);
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: join(OUT, `00-maquette-${vp.w}.png`), fullPage: true });
      console.log(`ok maquette ${vp.w}`);
      count += 1;
    } catch (e) {
      console.error(`KO maquette ${vp.w}: ${e.message}`);
    }
    await ctx.close();
  }

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const sc of SCENARIOS) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
        const pg = await ctx.newPage();
        await pg.addInitScript(`try{
          localStorage.setItem('mgs-theme','${theme}');
          localStorage.setItem('mgs_lang','fr');
          localStorage.setItem('mgs_selected_game','pubg-mobile');
          localStorage.setItem('mgs_cart', ${JSON.stringify(JSON.stringify([]))});
        }catch(e){}`);
        await pg.route("**/api/**", (route) => {
          const p = new URL(route.request().url()).pathname;
          if (p.includes("/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
          if (p.includes("/orders/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.me || []) });
          if (/\/orders\/(?!me)[\w-]+$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.order || {}) });
          if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
          if (p.endsWith("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
          if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
          if (p.includes("/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
          if (p.includes("/settings/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ online: false }) });
          if (p.includes("/me/game-identities")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
          if (p.includes("/loyalty/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: { total: 1200, earned: 1200, promo: 0 }, ledger: [], config: {} }) });
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
        });
        try {
          await pg.goto(base + sc.path, { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector("body", { timeout: 15000 });
          await pg.waitForTimeout(2500);
          await pg.evaluate(() => window.scrollTo(0, 0));
          await pg.waitForTimeout(400);
          await pg.screenshot({ path: join(OUT, `${sc.name}-${vp.w}-${theme}.png`), fullPage: true });
          console.log(`ok ${sc.name} ${vp.w} ${theme}`);
          count += 1;

          // Aperçu du reçu imprimable (détail livrée uniquement) : la classe
          // body.receipt-print + media print rendent le reçu seule vue peinte.
          if (sc.name === "03-detail-livree") {
            await pg.emulateMedia({ media: "print" });
            await pg.evaluate(() => document.body.classList.add("receipt-print"));
            await pg.waitForTimeout(400);
            await pg.screenshot({ path: join(OUT, `04-recu-print-${vp.w}-${theme}.png`), fullPage: true });
            console.log(`ok recu ${vp.w} ${theme}`);
            count += 1;
          }
        } catch (e) {
          console.error(`KO ${sc.name} ${vp.w} ${theme}: ${e.message}`);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  server.close();
  console.log(`${count} captures`);
  process.exit(0);
};
run();
