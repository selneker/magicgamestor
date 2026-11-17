#!/usr/bin/env node
// PL-CHK-5 — driver de captures (AUCUN appel production : build servi en
// local, appels /api interceptés et simulés). Structure reprise de
// capture-pl-chk-4.mjs (server statique + route "**/api/**").
//
// Usage : node capture-pl-chk-5.mjs <chemin-chromium>
// Sortie : PNG + controle-visibilite.json dans repports/captures/PL-CHK-5/
// (NON suivi git). Ce fichier NE DOIT PAS être commité.
//
// Prérequis : build AVEC REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA
// (clé de TEST publique Cloudflare). Le stub turnstile ne donne JAMAIS de
// jeton : au clic CTA, la feuille 9 s'ouvre et reste ouverte — état
// « Cloudflare demande une action » de la maquette.
//
// Lot PL-CHK-5 :
//  - les 3 feuilles (preuve / annulation / captcha) aux 5 tailles imposées
//    (360×560, 360×640, 390×844, 1366×620, 1280×720), clair ET sombre, avec
//    CONTRÔLE de visibilité : pied + boutons dans la fenêtre
//    (getBoundingClientRect().bottom <= window.innerHeight).
//  - captures d'appui : écran 2 (paiement manuel) et écran 6 (Binance) en
//    mobile clair + sombre, et bureau ; connexion compactée (T6).

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
if (!CHROMIUM || !existsSync(CHROMIUM)) {
  console.error("[erreur] chemin chromium manquant ou inexistant");
  process.exit(1);
}
const OUT = "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-CHK-5";
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

// ---- Feuilles : 3 × 5 tailles × 2 thèmes, avec contrôle de visibilité ----
const SHEET_VIEWPORTS = [
  { w: 360, h: 560 }, { w: 360, h: 640 }, { w: 390, h: 844 }, { w: 1366, h: 620 }, { w: 1280, h: 720 },
];
const SHEET_SCENARIOS = [
  {
    name: "feuille-preuve", path: "/orders/ord_1", order: ORDER(), drive: "proof",
    footer: '[data-testid="proof-sheet-footer"]', buttons: ["proof-submit", "proof-sheet-desktop-close"],
  },
  {
    name: "feuille-annulation", path: "/orders/ord_1", order: ORDER(), drive: "cancel",
    footer: '[data-testid="cancel-sheet-footer"]', buttons: ["cancel-keep", "cancel-confirm", "cancel-sheet-desktop-close"],
  },
  {
    name: "feuille-captcha", path: "/commande", order: null, drive: "captcha",
    footer: '[data-testid="captcha-sheet-footer"]', buttons: ["captcha-sheet-submit", "captcha-sheet-desktop-close"],
  },
];

// ---- Captures d'appui (pas de contrôle de visibilité imposé) ----
const EXTRA_SCENARIOS = [
  { name: "02-paiement-mvola", path: "/orders/ord_1", order: ORDER(), viewports: [[360, 640], [1366, 620]] },
  { name: "06-binance", path: "/orders/ord_1", order: ORDER({ payment_method: "binance", manual_operator: null }), cryptoStatus: CRYPTO_SLOT("WAITING"), viewports: [[360, 640], [1366, 620]] },
  { name: "10-connexion", path: "/connexion", viewports: [[360, 640]] },
];
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

// Contrôle de visibilité : pied + chaque bouton entièrement dans la fenêtre.
const checkVisibility = async (pg, scenario, label) => {
  const res = await pg.evaluate(({ footerSel, buttons }) => {
    const ih = window.innerHeight;
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) };
    };
    const out = { innerHeight: ih, footer: rectOf(footerSel), buttons: {} };
    for (const b of buttons) out.buttons[b] = rectOf(`[data-testid="${b}"]`);
    return out;
  }, { footerSel: scenario.footer, buttons: scenario.buttons });
  const ok = res.footer.found && res.footer.bottom <= res.innerHeight + 0.5
    && Object.values(res.buttons).every((b) => b.found && b.bottom <= res.innerHeight + 0.5);
  const btnTxt = Object.entries(res.buttons).map(([k, v]) => `${k}=${v.found ? v.bottom : "ABSENT"}`).join(" ");
  console.log(`VIS ${label} footer=${res.footer.found ? res.footer.bottom : "ABSENT"} ${btnTxt} ih=${res.innerHeight} ${ok ? "OK" : "ECHEC"}`);
  return { label, ok, ...res };
};

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const visResults = [];
  let count = 0;

  const routesFor = (pg, sc) => Promise.all([
    pg.route("**/challenges.cloudflare.com/**", (route) => route.fulfill({
      status: 200, contentType: "text/javascript",
      body: `window.turnstile={render:(el,o)=>{window.__ts=o;el.innerHTML='<div style="min-height:56px;border:1px solid #d0d0ce;border-radius:6px"></div>';return 'w1';},remove:()=>{},reset:()=>{}};`,
    })),
    pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      const m = route.request().method();
      // Feuille captcha figée ouverte : POST /orders reste PENDING.
      if (m === "POST" && p.endsWith("/orders")) return;
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
    }),
  ]);

  const newPage = async (w, h, theme) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
    const pg = await ctx.newPage();
    await pg.addInitScript(`try{
      localStorage.setItem('mgs-theme','${theme}');
      localStorage.setItem('mgs_lang','fr');
      localStorage.setItem('mgs_selected_game','pubg-mobile');
      localStorage.setItem('mgs_cart', ${JSON.stringify(JSON.stringify([{ id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 2500, qty: 1, type: "uc", game_id: "pubg-mobile" }]))});
    }catch(e){}`);
    return { ctx, pg };
  };

  // 1) Les 3 feuilles × 5 tailles × 2 thèmes + contrôle de visibilité.
  for (const vp of SHEET_VIEWPORTS) {
    for (const theme of THEMES) {
      for (const sc of SHEET_SCENARIOS) {
        const { ctx, pg } = await newPage(vp.w, vp.h, theme);
        await routesFor(pg, sc);
        try {
          await pg.goto(base + sc.path, { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector("body", { timeout: 15000 });
          await pg.waitForTimeout(2500);
          await drive(pg, sc.drive);
          await pg.waitForTimeout(600);
          const label = `${sc.name} ${vp.w}x${vp.h} ${theme}`;
          visResults.push(await checkVisibility(pg, sc, label));
          await pg.screenshot({ path: join(OUT, `${sc.name}-${vp.w}x${vp.h}-${theme}.png`) });
          console.log(`ok ${sc.name} ${vp.w}x${vp.h} ${theme}`);
          count += 1;
        } catch (e) {
          console.error(`KO ${sc.name} ${vp.w}x${vp.h} ${theme}: ${e.message}`);
        }
        await ctx.close();
      }
    }
  }

  // 2) Captures d'appui.
  for (const sc of EXTRA_SCENARIOS) {
    for (const [w, h] of sc.viewports) {
      for (const theme of THEMES) {
        const { ctx, pg } = await newPage(w, h, theme);
        await routesFor(pg, sc);
        try {
          await pg.goto(base + sc.path, { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector("body", { timeout: 15000 });
          await pg.waitForTimeout(2500);
          await pg.evaluate(() => window.scrollTo(0, 0));
          await pg.waitForTimeout(400);
          await pg.screenshot({ path: join(OUT, `${sc.name}-${w}x${h}-${theme}.png`) });
          console.log(`ok ${sc.name} ${w}x${h} ${theme}`);
          count += 1;
        } catch (e) {
          console.error(`KO ${sc.name} ${w}x${h} ${theme}: ${e.message}`);
        }
        await ctx.close();
      }
    }
  }

  await browser.close();
  server.close();
  await writeFile(join(OUT, "controle-visibilite.json"), JSON.stringify(visResults, null, 2));
  const fails = visResults.filter((r) => !r.ok);
  console.log(`${count} captures ; contrôle visibilité : ${visResults.length} vérifications, ${fails.length} échec(s)`);
  process.exit(fails.length ? 2 : 0);
};
run();
