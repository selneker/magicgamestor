#!/usr/bin/env node
// PL-CHK-6 — driver de captures (AUCUN appel production : build servi en
// local, appels /api interceptés et simulés). Structure reprise de
// capture-pl-chk-5.mjs (server statique + route "**/api/**").
//
// Usage : node capture-pl-chk-6.mjs <chemin-chromium>
// Sortie : PNG + controle-scenario.json dans repports/captures/PL-CHK-6/
// (NON suivi git). Ce fichier NE DOIT PAS être commité.
//
// Scénarios (règle produit : une commande en attente s'offre, elle ne
// s'impose jamais) :
//  1. tunnel-cle-invalide   — /commande avec une clé pointant sur une commande
//     manuelle sans opérateur : le tunnel s'affiche NORMALEMENT, aucune
//     redirection (URL inchangée).
//  2. resume-unpayable      — /orders/:id d'une commande sans opérateur :
//     message + « Retour à l'accueil » discret + « Recommencer ».
//  3. recommencer-boutique  — clic « Recommencer » : la clé est purgée,
//     navigation vers l'écran 1 du jeu (/boutique?game=pubg-mobile).
//  4. banniere-valide       — invité avec une commande mémorisée VALIDE :
//     bannière « Commande en cours » sur /boutique, le tunnel reste accessible.

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
const OUT = "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-CHK-6";
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

const deadline = (mins = 20) => new Date(Date.now() + mins * 60_000).toISOString();
const ORDER = (over = {}) => ({
  id: "ord_ok", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0, status: "pending_payment",
  payment_method: "manual", manual_operator: "mvola", pubg_id: "52328390220", pseudo: "TestPlayer", game_id: "pubg-mobile",
  payment_deadline_at: deadline(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  created_at: "2026-11-10T09:00:00Z", ...over,
});
// Commande INVALIDE : manuelle sans opérateur (la boucle PL-CHK-6).
const ORDER_BAD = ORDER({ id: "ord_bad", order_number: "MGS-000001", manual_operator: null });

// Chaque scénario : clé locale (mgs_pending_order_id), commande servie par
// l'API, URL de départ, action optionnelle, vérifications ensuite.
const SCENARIOS = [
  {
    name: "01-tunnel-cle-invalide", start: "/commande", key: { id: "ord_bad" }, order: ORDER_BAD,
    checks: { url: "/commande", text: "checkout-form" },
  },
  {
    name: "02-resume-unpayable", start: "/orders/ord_bad", key: { id: "ord_bad" }, order: ORDER_BAD,
    checks: { text: "resume-unpayable", extra: ["restart-button", "resume-back-home"] },
  },
  {
    name: "03-recommencer-boutique", start: "/orders/ord_bad", key: { id: "ord_bad" }, order: ORDER_BAD,
    action: { click: '[data-testid="restart-button"]', waitUrl: /boutique\?game=pubg-mobile/ },
    checks: { url: "/boutique", keyGone: true, noBanner: true },
  },
  {
    name: "04-recommencer-expire", start: "/orders/ord_bad", key: null, order: ORDER_BAD,
    overrides: { status: "expired" },
    action: { click: '[data-testid="proof-restart"]', waitUrl: /boutique\?game=pubg-mobile/ },
    checks: { url: "/boutique", keyGone: true },
  },
  {
    name: "05-banniere-commande-valide", start: "/boutique", key: { id: "ord_ok" }, order: ORDER(),
    checks: { url: "/boutique", text: "pending-order-banner" },
  },
];
const VIEWPORTS = [[360, 640]];
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
  const results = [];
  let count = 0;

  const routesFor = (pg, sc) => Promise.all([
    pg.route("**/challenges.cloudflare.com/**", (route) => route.fulfill({
      status: 200, contentType: "text/javascript",
      body: `window.turnstile={render:(el,o)=>{window.__ts=o;el.innerHTML='<div style="min-height:56px;border:1px solid #d0d0ce;border-radius:6px"></div>';return 'w1';},remove:()=>{},reset:()=>{}};`,
    })),
    pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      const m = route.request().method();
      if (m === "POST" && p.endsWith("/orders")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.order || {}) });
      if (p.includes("/auth/me")) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({}) });
      if (p.includes("validate-id")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: true, player_name: "TestPlayer" }) });
      if (/\/orders\/(?!me)[\w-]+$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sc.servedOrder) });
      if (/\/orders\/[\w-]+\/(cancel|remind|proof)$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      if (p === "/orders/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
      if (p.includes("/payments/") && p.endsWith("/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payment_url: null, simulated: true }) });
      if (/\/crypto\/[\w-]+\/status$/.test(p)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      if (p.includes("/crypto/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, networks: [{ key: "BSC", label: "BNB Smart Chain" }] }) });
      if (p.endsWith("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
      if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
      if (p.includes("/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      if (p.includes("/settings/status")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ online: false }) });
      if (p.includes("/me/game-identities")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    }),
  ]);

  const newPage = async (w, h, theme, sc) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
    const pg = await ctx.newPage();
    await pg.addInitScript(`try{
      localStorage.setItem('mgs-theme','${theme}');
      localStorage.setItem('mgs_lang','fr');
      localStorage.setItem('mgs_selected_game','pubg-mobile');
      localStorage.setItem('mgs_cart', ${JSON.stringify(JSON.stringify([{ id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 2500, qty: 1, type: "uc", game_id: "pubg-mobile" }]))});
      ${sc.key ? `localStorage.setItem('mgs_pending_order_id', JSON.stringify({ id: '${sc.key.id}', createdAt: new Date().toISOString() }));` : ""}
    }catch(e){}`);
    return { ctx, pg };
  };

  for (const sc of SCENARIOS) {
    sc.servedOrder = sc.order && sc.overrides ? { ...sc.order, ...sc.overrides } : sc.order;
    for (const [w, h] of VIEWPORTS) {
      for (const theme of THEMES) {
        const { ctx, pg } = await newPage(w, h, theme, sc);
        await routesFor(pg, sc);
        const label = `${sc.name} ${w}x${h} ${theme}`;
        const checks = { label, ok: true, notes: [] };
        try {
          await pg.goto(base + sc.start, { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector("body", { timeout: 15000 });
          await pg.waitForTimeout(2500);
          if (sc.action) {
            const btn = await pg.$(sc.action.click);
            if (!btn) throw new Error(`bouton absent : ${sc.action.click}`);
            await btn.click();
            await pg.waitForURL(sc.action.waitUrl, { timeout: 10000 });
            await pg.waitForTimeout(2000);
          }
          const url = new URL(pg.url()).pathname + new URL(pg.url()).search;
          if (sc.checks.url && !pg.url().includes(sc.checks.url)) {
            checks.ok = false; checks.notes.push(`url=${url} attendu≈${sc.checks.url}`);
          }
          if (sc.checks.text && !(await pg.$(`[data-testid="${sc.checks.text}"]`))) {
            checks.ok = false; checks.notes.push(`testid absent : ${sc.checks.text}`);
          }
          for (const t of sc.checks.extra || []) {
            if (!(await pg.$(`[data-testid="${t}"]`))) { checks.ok = false; checks.notes.push(`testid absent : ${t}`); }
          }
          if (sc.checks.keyGone) {
            const key = await pg.evaluate(() => localStorage.getItem("mgs_pending_order_id"));
            if (key !== null) { checks.ok = false; checks.notes.push("clé NON purgée"); }
          }
          if (sc.checks.noBanner && (await pg.$('[data-testid="pending-order-banner"]'))) {
            checks.ok = false; checks.notes.push("bannière présente alors que la clé est purgée");
          }
          if (sc.checks.text === "pending-order-banner" && !(await pg.$('[data-testid="pending-order-banner"]'))) {
            checks.ok = false; checks.notes.push("bannière ABSENTE pour une commande valide");
          }
          await pg.evaluate(() => window.scrollTo(0, 0));
          await pg.waitForTimeout(400);
          await pg.screenshot({ path: join(OUT, `${sc.name}-${w}x${h}-${theme}.png`) });
          console.log(`${checks.ok ? "ok" : "ECHEC"} ${label} ${checks.notes.join(" | ")}`);
          count += 1;
        } catch (e) {
          checks.ok = false; checks.notes.push(e.message);
          console.error(`KO ${label}: ${e.message}`);
        }
        results.push(checks);
        await ctx.close();
      }
    }
  }

  await browser.close();
  server.close();
  await writeFile(join(OUT, "controle-scenario.json"), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`${count} captures ; scénarios : ${results.length} vérifications, ${fails.length} échec(s)`);
  process.exit(fails.length ? 2 : 0);
};
run();
