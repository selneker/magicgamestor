#!/usr/bin/env node
// PL-CHK-3 — driver de captures (AUCUN appel production : build/ servi en
// local, appels /api interceptés et simulés). Structure reprise de
// scripts/audit-contrast.mjs (server statique + route "**/api/**").
//
// Usage : node capture.mjs <chemin-chromium>
// Sortie : PNG dans le dossier du script (repports/captures/PL-CHK-3/).

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CHROMIUM = process.argv[2];
if (!CHROMIUM || !existsSync(CHROMIUM)) {
  console.error("[erreur] chemin chromium manquant ou inexistant");
  process.exit(1);
}
const OUT = "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-CHK-3";
const BUILD_DIR = join(process.cwd(), "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const GAMES = [
  {
    id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
    description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC",
    product_types: [{ key: "uc", label: "UC", label_en: "UC" }],
  },
];
const PRODUCTS = [
  { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 2500, type: "uc", game_id: "pubg-mobile", active: true, sort_order: 0 },
];
const PAYMENT_CONFIG = {
  mode: "papi", gateway: "papi", live: false, papi_auto: true, fiveone_enabled: false, auto_payment: true,
  payment_fees: { manual: { percent: 0, min: 0, max: 0 }, papi: { percent: 1.5, min: 100, max: 900 } },
  manual_only: false, timeout_minutes: 15,
  providers: {
    mvola: { configured: false, merchant: "0383905692", name: "Selneker Dino" },
    orange: { configured: false, merchant: "0377519833", name: "Selneker Dino" },
  },
};
const USER = { user_id: "u1", email: "client@exemple.test", name: "Client", roles: [], permissions: [] };

const deadline = (mins = 20) => new Date(Date.now() + mins * 60_000).toISOString();
const ORDER = (over = {}) => ({
  id: "ord_1", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0, status: "pending_payment",
  payment_method: "manual", pubg_id: "52328390220", pseudo: "TestPlayer", game_id: "pubg-mobile",
  payment_deadline_at: deadline(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  created_at: "2026-11-10T09:00:00Z", ...over,
});

// Scénarios : nom, chemin, invité/connecté, contenu du stockage, ordre renvoyé par GET /orders/{id}, liste /orders/me.
const SCENARIOS = [
  { name: "banner-pending", path: "/", guest: true, order: ORDER() },
  { name: "banner-proof", path: "/", guest: true, order: ORDER({ status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] }) },
  { name: "resume-manual", path: "/orders/ord_1", guest: true, order: ORDER() },
  { name: "resume-proof", path: "/orders/ord_1", guest: true, order: ORDER({ status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] }) },
  { name: "resume-expired", path: "/orders/ord_1", guest: true, order: ORDER({ status: "expired" }) },
  {
    name: "list-resume", path: "/suivi", guest: false,
    me: [ORDER(), ORDER({ id: "ord_2", order_number: "MGS-123457", payment_method: "mvola" }), ORDER({ id: "ord_3", order_number: "MGS-123458", status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] })],
  },
];
const VIEWPORTS = [{ w: 360, h: 640 }, { w: 390, h: 844 }];
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
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const sc of SCENARIOS) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
        const pg = await ctx.newPage();
        await pg.addInitScript(`try{
          localStorage.setItem('mgs-theme','${theme}');
          localStorage.setItem('mgs_lang','fr');
          localStorage.setItem('mgs_selected_game','pubg-mobile');
          ${sc.guest ? `localStorage.setItem('mgs_pending_order_id', JSON.stringify({ id: 'ord_1', createdAt: '${new Date().toISOString()}' }));` : ""}
        }catch(e){}`);
        await pg.route("**/api/**", (route) => {
          const p = new URL(route.request().url()).pathname;
          if (p.includes("/auth/me")) {
            return route.fulfill({ status: sc.guest ? 401 : 200, contentType: "application/json", body: JSON.stringify(sc.guest ? {} : USER) });
          }
          if (p.endsWith("/orders/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.me || []) });
          if (/\/orders\/(?!me)[\w-]+$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.order) });
          if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
          if (p.includes("/payments/") && p.endsWith("/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payment_url: null, simulated: true }) });
          if (p.includes("/crypto/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false, networks: [] }) });
          if (p.endsWith("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
          if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
          if (p.includes("/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
          if (p.includes("/settings/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ online: false }) });
          if (p.includes("/me/game-identities")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
        });
        try {
          await pg.goto(base + sc.path, { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector("body", { timeout: 15000 });
          await pg.waitForTimeout(2500);
          await pg.evaluate(() => window.scrollTo(0, 0));
          await pg.waitForTimeout(400);
          const file = join(OUT, `${sc.name}-${vp.w}-${theme}.png`);
          await pg.screenshot({ path: file, fullPage: true });
          console.log(`ok ${sc.name} ${vp.w} ${theme}`);
          count += 1;
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
