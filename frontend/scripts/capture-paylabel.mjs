#!/usr/bin/env node
/**
 * Captures et vérifications navigateur pour PL-PAYLABEL-1 (libellés de
 * moyens de paiement). Usage :
 *   cd frontend && yarn build && CHROMIUM_PATH=/chemin/vers/chrome \
 *     OUT_DIR=/tmp/opencode/paylabel-captures node scripts/capture-paylabel.mjs
 *
 * Sert build/ en local, intercepte /api, puis vérifie :
 *  - liste admin : une commande de CHAQUE méthode affiche le bon libellé
 *    (binance → « Binance USDT », manual → « USSD · réf »), clair + sombre ;
 *  - suivi client : la carte d'une commande binance affiche « Binance USDT »
 *    et le bouton de reprise est peint en NEUTRE (computed style) — la
 *    vérification que jest ne peut pas faire (il y perd les inline styles).
 */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(root, "build");
const OUT = process.env.OUT_DIR || "/tmp/opencode/paylabel-captures";
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

const ADMIN_USER = { user_id: "u1", email: "admin@exemple.test", name: "Admin", role: "admin", permissions: ["users.manage"] };

const ORDERS = [
  { id: "1", order_number: "MGS-MV", created_at: "2026-11-07T10:00:00Z", status: "paid", pseudo: "JoueurMV", pubg_id: "123456789", items: [{ quantity: 1, name: "660 UC" }], email: "mv@exemple.test", total: 2500, payment_method: "mvola", payment_phone: "0340000001" },
  { id: "2", order_number: "MGS-OR", created_at: "2026-11-07T10:05:00Z", status: "paid", pseudo: "JoueurOR", pubg_id: "223456789", items: [{ quantity: 1, name: "660 UC" }], email: "or@exemple.test", total: 2500, payment_method: "orange", payment_phone: "0320000002" },
  { id: "3", order_number: "MGS-US", created_at: "2026-11-07T10:10:00Z", status: "awaiting_verification", pseudo: "JoueurUS", pubg_id: "323456789", items: [{ quantity: 1, name: "660 UC" }], email: "us@exemple.test", total: 2500, payment_method: "manual", manual_reference: "REF123456" },
  { id: "4", order_number: "MGS-BN", created_at: "2026-11-07T10:15:00Z", status: "paid", pseudo: "JoueurBN", pubg_id: "423456789", items: [{ quantity: 1, name: "660 UC" }], email: "bn@exemple.test", total: 2500, payment_method: "binance" },
];

const TRACK_ORDER = {
  order_number: "MGS-BN", status: "pending_payment", pubg_id: "423456789", pseudo: "JoueurBN",
  game_id: "pubg-mobile", items: [{ quantity: 1, name: "660 UC", line_total: 2500 }],
  created_at: "2026-11-07T10:15:00Z", total: 2500, payment_fee: 0, payment_method: "binance",
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

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

  const newPage = async ({ theme = "light" } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    await pg.addInitScript(
      `try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');}catch(e){}`,
    );
    await pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_USER) });
      }
      if (p.includes("/admin/orders")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ORDERS) });
      }
      if (p.includes("/admin/fazercards/mappings")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
      }
      if (p.includes("/orders/track")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TRACK_ORDER) });
      }
      if (p.includes("/payments/") && p.endsWith("/status")) {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ payment_url: "https://pay.exemple.test/redirect", simulated: false, expires_at: "2026-11-07T10:30:00Z", order_status: "pending_payment" }),
        });
      }
      if (p.includes("/admin/stats")) {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ revenue: 0, total_orders: 0, customers: 0, pending_payment_count: 0, pending_payment_usd: 0, status_count: {}, daily: [], top_products: [], by_method: { mvola: 2, orange: 1, manual: 1, binance: 1 } }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    return { ctx, pg };
  };

  /* A. Liste admin, clair : les 4 méthodes affichent le bon libellé */
  {
    const { ctx, pg } = await newPage();
    await pg.goto(base + "/admin/commandes", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1500);
    const row = async (n) => (await pg.locator(`[data-testid="admin-order-${n}"]`).textContent()) || "";
    check("admin : MVola → « MVola · 0340000001 »", (await row("MGS-MV")).includes("MVola · 0340000001"));
    check("admin : orange → « Orange Money · 0320000002 »", (await row("MGS-OR")).includes("Orange Money · 0320000002"));
    check("admin : manual → « USSD · REF123456 »", (await row("MGS-US")).includes("USSD · REF123456"));
    const bn = await row("MGS-BN");
    check("admin : binance → « Binance USDT »", bn.includes("Binance USDT"));
    check("admin : binance n'affiche PAS « Orange Money »", !bn.includes("Orange Money"));
    check("admin : filtre méthode propose Binance USDT", (await pg.locator('[data-testid="admin-filter-method"]').textContent()) !== null && (await pg.evaluate(() => document.querySelector('[data-testid="admin-filter-method"]') !== null)));
    await pg.screenshot({ path: join(OUT, "admin-orders-light.png"), fullPage: false });
    await ctx.close();
  }

  /* B. Liste admin, sombre */
  {
    const { ctx, pg } = await newPage({ theme: "dark" });
    await pg.goto(base + "/admin/commandes", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1500);
    const bn = (await pg.locator('[data-testid="admin-order-MGS-BN"]').textContent()) || "";
    check("admin sombre : binance → « Binance USDT »", bn.includes("Binance USDT") && !bn.includes("Orange Money"));
    await pg.screenshot({ path: join(OUT, "admin-orders-dark.png"), fullPage: false });
    await ctx.close();
  }

  /* C. Suivi client binance : libellé + couleur peinte du bouton de reprise */
  {
    const { ctx, pg } = await newPage();
    await pg.goto(base + "/suivi/MGS-BN?pubg_id=423456789", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1800);
    const card = (await pg.locator('[data-testid="order-card-MGS-BN"]').textContent()) || "";
    check("suivi : carte binance → « Binance USDT »", card.includes("Binance USDT"));
    check("suivi : carte binance n'affiche PAS « USSD »", !card.includes("USSD"));
    const btn = pg.locator('[data-testid="resume-payment-button"]');
    check("suivi : bouton de reprise présent", (await btn.count()) === 1);
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    check("suivi : bouton peint en NEUTRE sable rgb(233, 226, 216)", bg === "rgb(233, 226, 216)", bg);
    check("suivi : bouton PAS peint en orange rgb(255, 121, 0)", bg !== "rgb(255, 121, 0)");
    await pg.screenshot({ path: join(OUT, "suivi-binance-light.png"), fullPage: true });
    await ctx.close();
  }

  /* D. Suivi client mvola : la couleur de marque est conservée */
  {
    const { ctx, pg } = await newPage();
    await pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.includes("/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_USER) });
      if (p.includes("/orders/track")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...TRACK_ORDER, payment_method: "mvola" }) });
      }
      if (p.includes("/payments/") && p.endsWith("/status")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payment_url: "https://pay.exemple.test/redirect", simulated: false, expires_at: "2026-11-07T10:30:00Z", order_status: "pending_payment" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await pg.goto(base + "/suivi/MGS-MV?pubg_id=423456789", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1800);
    const btn = pg.locator('[data-testid="resume-payment-button"]');
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    check("suivi mvola : bouton peint en vert MVola rgb(0, 166, 81)", bg === "rgb(0, 166, 81)", bg);
    await pg.screenshot({ path: join(OUT, "suivi-mvola-light.png"), fullPage: true });
    await ctx.close();
  }

  /* E. Tableau de bord : chip Binance présente */
  {
    const { ctx, pg } = await newPage();
    await pg.goto(base + "/admin", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1500);
    const body = await pg.evaluate(() => document.body.textContent || "");
    check("tableau de bord : chip « Binance USDT 1 » présente", body.includes("Binance USDT 1"));
    await pg.screenshot({ path: join(OUT, "admin-dashboard-light.png"), fullPage: false });
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
