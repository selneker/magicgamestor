#!/usr/bin/env node
// PL-CHK-4 — driver de captures (AUCUN appel production : build/ servi en
// local, appels /api interceptés et simulés). Structure reprise de
// capture-pl-chk-3.mjs (server statique + route "**/api/**").
//
// Usage : node capture-pl-chk-4.mjs <chemin-chromium>
// Sortie : PNG dans repports/captures/PL-CHK-4/ (NON suivi git).
//
// Prérequis : build AVEC REACT_APP_TURNSTILE_SITE_KEY (feuille CAPTCHA,
// écran 9). Cloudflare : clé de test publique 1x00000000000000000000AA.
// POST /orders est laissé PENDING (jamais répondu) pour figer la feuille 9.

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
const OUT = "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-CHK-4";
const BUILD_DIR = join(process.cwd(), "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const GAMES = [
  {
    id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
    description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC",
    identity_fields: [{ key: "player_id", primary: true, label: "ID joueur" }],
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
    mvola: { configured: true, merchant: "0383905692", name: "Selneker Dino" },
    orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" },
  },
};
const USER = { user_id: "u1", email: "client@exemple.test", name: "Client", roles: [], permissions: [] };

const deadline = (mins = 20) => new Date(Date.now() + mins * 60_000).toISOString();
const ORDER = (over = {}) => ({
  id: "ord_1", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0, status: "pending_payment",
  payment_method: "manual", manual_operator: "mvola", pubg_id: "52328390220", pseudo: "TestPlayer", game_id: "pubg-mobile",
  payment_deadline_at: deadline(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  created_at: "2026-11-10T09:00:00Z", ...over,
});
const CRYPTO_SLOT = (status) => ({ payment: { status, amount_usdt: "1.5", address: "TXk9Rapbnxzepi6ntreKqRmCkBFeuu8AfD", memo: "102345678", network: "BSC", expires_at: deadline() } });

// Les 9 écrans de la maquette + connexion focalisée. `drive` pilote l'écran
// courant ; les feuilles (3/7/9) se capturent en viewport (overlay fixe).
const SCENARIOS = [
  { name: "01-commande", path: "/commande" }, // écran 1 : création (état initial)
  { name: "02-paiement-mvola", path: "/orders/ord_1", order: ORDER() }, // écran 2
  { name: "03-preuve", path: "/orders/ord_1", order: ORDER(), drive: "proof" }, // écran 3 : feuille
  { name: "04-attente", path: "/orders/ord_1", order: ORDER({ status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] }) },
  { name: "05-binance", path: "/orders/ord_1", order: ORDER({ payment_method: "binance", manual_operator: null }), cryptoStatus: CRYPTO_SLOT("WAITING") },
  { name: "06-binance-detecte", path: "/orders/ord_1", order: ORDER({ payment_method: "binance", manual_operator: null }), cryptoStatus: CRYPTO_SLOT("DETECTED") },
  { name: "07-annulation", path: "/orders/ord_1", order: ORDER(), drive: "cancel" }, // écran 7 : feuille
  { name: "08-expiree", path: "/orders/ord_1", order: ORDER({ status: "expired" }) }, // écran 8
  { name: "09-captcha", path: "/commande", drive: "captcha" }, // écran 9 : feuille
  { name: "10-connexion", path: "/connexion" }, // mode focalisé : sans header/footer
];
const VIEWPORTS = [{ w: 360, h: 640 }, { w: 390, h: 844 }, { w: 1280, h: 800 }];
const THEMES = ["light", "dark"];
// 1280 px : écrans 1–2 seulement (grandes feuilles non pertinentes).
const ONLY_WIDE = new Set(["01-commande", "02-paiement-mvola"]);

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

const click = async (pg, selector, wait = 900) => {
  const el = await pg.$(selector);
  if (!el) return false;
  await el.click();
  await pg.waitForTimeout(wait);
  return true;
};

const drive = async (pg, kind) => {
  if (kind === "proof") return click(pg, '[data-testid="send-proof-button"]', 1200);
  if (kind === "cancel") return click(pg, '[data-testid="order-cancel-open"]', 1200);
  if (kind === "captcha") {
    await click(pg, '[data-testid="identity-field-player_id"]', 200);
    await pg.fill('[data-testid="identity-field-player_id"]', "52328390220");
    await click(pg, '[data-testid="identity-verify-btn"]', 1200);
    await click(pg, '[data-testid="method-mvola"]', 600);
    await click(pg, '[data-testid="checkout-submit"]', 1500);
    return true;
  }
  return true;
};

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  let count = 0;
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const sc of SCENARIOS) {
        if (vp.w === 1280 && !ONLY_WIDE.has(sc.name)) continue;
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 800, hasTouch: vp.w < 800 });
        const pg = await ctx.newPage();
        await pg.addInitScript(`try{
          localStorage.setItem('mgs-theme','${theme}');
          localStorage.setItem('mgs_lang','fr');
          localStorage.setItem('mgs_selected_game','pubg-mobile');
          localStorage.setItem('mgs_cart', ${JSON.stringify(JSON.stringify([{ id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 2500, qty: 1, type: "uc", game_id: "pubg-mobile" }]))});
        }catch(e){}`);
        // Turnstile simulé : la clé 1x…AA passe en invisible avant le clic (la
        // feuille 9 ne s'ouvrirait jamais). Le stub ne donne JAMAIS de jeton :
        // au clic CTA, la feuille 9 s'ouvre et reste ouverte, CTA désactivé —
        // exactement l'état « Cloudflare demande une action » de la maquette.
        await pg.route("**/challenges.cloudflare.com/**", (route) => route.fulfill({
          status: 200, contentType: "text/javascript",
          body: `window.turnstile={render:(el,o)=>{window.__ts=o;el.innerHTML='<div style="min-height:56px;border:1px solid #d0d0ce;border-radius:6px"></div>';return 'w1';},remove:()=>{},reset:()=>{}};`,
        }));
        await pg.route("**/api/**", (route) => {
          const p = new URL(route.request().url()).pathname;
          const m = route.request().method();
          // Feuille 9 figée ouverte : POST /orders reste PENDING (jamais répondu).
          if (m === "POST" && p.endsWith("/orders")) return; // pas de fulfill : requête en attente
          if (p.includes("/auth/me")) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({}) });
          if (p.includes("validate-id")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: true, player_name: "TestPlayer" }) });
          if (/\/orders\/(?!me)[\w-]+$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.order || {}) });
          if (/\/orders\/[\w-]+\/(cancel|remind|proof)$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
          if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
          if (p.includes("/payments/") && p.endsWith("/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payment_url: null, simulated: true }) });
          if (/\/crypto\/[\w-]+\/status$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.cryptoStatus || {}) });
          if (p.includes("/crypto/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, networks: [{ key: "BSC", label: "BNB Smart Chain" }] }) });
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
          if (sc.drive) await drive(pg, sc.drive);
          await pg.evaluate(() => window.scrollTo(0, 0));
          await pg.waitForTimeout(400);
          const file = join(OUT, `${sc.name}-${vp.w}-${theme}.png`);
          // Feuilles (écrans 3/7/9) : viewport (overlay fixe), le reste : page entière.
          const sheet = ["03-preuve", "07-annulation", "09-captcha"].includes(sc.name);
          await pg.screenshot({ path: file, fullPage: !sheet });
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
