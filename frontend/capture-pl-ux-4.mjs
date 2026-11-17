#!/usr/bin/env node
// PL-UX-4 — driver de captures. AUCUN appel production : build servi en
// local, appels /api interceptés. NON COMMITÉ.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
const TAG = process.argv[3] || "apres";
if (!CHROMIUM || !existsSync(CHROMIUM)) { console.error("chemin chromium manquant"); process.exit(1); }
const OUT = `/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-UX-4`;
const BUILD_DIR = join(process.cwd(), "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const ICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%23D4FF00'/><circle cx='48' cy='48' r='30' fill='%23111111'/></svg>`);
const PROOF = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1400'><rect width='900' height='1400' fill='#F4F3EE'/><rect x='40' y='40' width='820' height='1320' fill='#111111'/><text x='450' y='700' fill='#D4FF00' font-size='64' text-anchor='middle' font-family='monospace'>PREUVE ${"${n}"}</text></svg>`, "utf8");
const IDENTITY = [{ key: "player_id", label: "ID joueur", label_en: "Player ID", pattern: "^[0-9]{8,12}$", min_length: 8, max_length: 12, required: true, primary: true }];
const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", icon_url: ICON, active: true, sort_order: 0, currency_label: "UC", identity_fields: IDENTITY },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", icon_url: ICON, active: true, sort_order: 1, currency_label: "D", identity_fields: IDENTITY },
];
const PRODUCTS = [{ id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 25000, type: "uc", game_id: "pubg-mobile", active: true, sort_order: 0 }];
const PAYMENT_CONFIG = { providers: { mvola: { configured: true }, orange: { configured: true } }, payment_fees: {} };
const ADMIN_USER = { user_id: "u-admin", email: "admin@exemple.test", role: "super_admin", permissions: ["orders.manage"] };
const now = new Date().toISOString();

const PROOFS = [
  { size: 1048576, uploaded_at: "2026-11-10T10:00:00Z" },
  { size: 524288, uploaded_at: "2026-11-10T10:05:00Z" },
];
const ADMIN_ORDERS = [
  { id: "o1", order_number: "MGS-1001", created_at: now, status: "pending_payment", pseudo: "AwaNety", pubg_id: "512398471", items: [{ quantity: 1, name: "Weekly Pass PUBG Mobile", season_name: "S12" }], total: 25000, payment_method: "manual", manual_operator: "mvola", email: "awa.nety+commandes@exemple.test", payment_proofs: PROOFS },
  { id: "o2", order_number: "MGS-1002", created_at: now, status: "paid", pseudo: "Tiana", pubg_id: "500112233", items: [{ quantity: 1, name: "660 UC" }], total: 1250000, payment_method: "manual", manual_operator: "orange", email: "tiana@exemple.test", payment_proofs: [PROOFS[0]] },
  { id: "o3", order_number: "MGS-1003", created_at: now, status: "paid", pseudo: "Fetra", pubg_id: "498877665", items: [{ quantity: 2, name: "660 UC" }], total: 50000, payment_method: "binance", email: "fetra@exemple.test" },
];
const RECENT_IDS = {
  "pubg-mobile": [
    { id: "512398471", usedAt: Date.now() - 1000 },
    { id: "500112233", usedAt: Date.now() - 2000 },
    { id: "498877665", usedAt: Date.now() - 3000 },
  ],
};

const startServer = () => new Promise((res) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = join(BUILD_DIR, decodeURIComponent(url.pathname));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD_DIR, "index.html");
    try { const body = await readFile(file); res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" }); res.end(body); }
    catch { res.writeHead(404).end("not found"); }
  });
  server.listen(0, "127.0.0.1", () => res({ server, port: server.address().port }));
});

const stub = (pg, { admin = false, loginError = false } = {}) => {
  pg.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.includes("/auth/me")) {
      return route.fulfill(admin
        ? { status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_USER) }
        : { status: 401, contentType: "application/json", body: "{}" });
    }
    if (p === "/api/auth/login") {
      if (loginError) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Invalid email or password" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { user_id: "u1" }, access_token: "a" }) });
    }
    if (p.startsWith("/api/admin/orders/") && p.includes("/proofs/")) {
      const idx = Number(p.split("/proofs/")[1]);
      const svg = PROOF.toString("utf8").replace("${n}", String(idx + 1));
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg });
    }
    if (p === "/api/admin/orders") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_ORDERS) });
    if (p.includes("/admin/fazercards/mappings")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
    if (p.includes("/validate-id")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: true, player_name: "JoueurTest" }) });
    if (p.endsWith("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
    if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
    if (p.includes("/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
    if (p.includes("/crypto/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false, networks: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
};

const seed = (pg, { theme, cart = false, recent = false } = {}) => {
  const parts = [`try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');localStorage.setItem('mgs_selected_game','pubg-mobile');}catch(e){}`];
  if (cart) parts.push(`try{localStorage.setItem('mgs_cart', ${JSON.stringify(JSON.stringify([{ id: "p1", slug: "660-uc", name: "660 UC", type: "uc", price: 25000, game_id: "pubg-mobile", qty: 1 }]))});}catch(e){}`);
  if (recent) parts.push(`try{localStorage.setItem('mgs_recent_player_ids', ${JSON.stringify(JSON.stringify(RECENT_IDS))});}catch(e){}`);
  pg.addInitScript(parts.join(""));
};

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

  for (const [w, h] of [[320, 640], [390, 844], [430, 844], [1440, 900]]) {
    for (const theme of ["light", "dark"]) {
      // 1. Connexion : message d'erreur FRANÇAIS.
      {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1024, hasTouch: w < 1024, deviceScaleFactor: 2 });
        const pg = await ctx.newPage();
        await stub(pg, { loginError: true });
        await seed(pg, { theme });
        try {
          await pg.goto(base + "/connexion", { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector('[data-testid="email-input"]', { timeout: 15000 });
          await pg.fill('[data-testid="email-input"]', "awa@exemple.test");
          await pg.fill('[data-testid="password-input"]', "mauvais-mot-de-passe");
          await pg.click('[data-testid="auth-submit"]');
          await pg.waitForSelector('[data-testid="auth-error"]', { timeout: 10000 });
          await pg.waitForTimeout(400);
          await pg.screenshot({ path: join(OUT, `${TAG}-1-connexion-erreur-${w}x${h}-${theme}.png`) });
          const msg = await pg.textContent('[data-testid="auth-error"]');
          console.log(`${TAG} erreur login ${w}x${h} ${theme}:`, JSON.stringify(msg));
        } catch (e) { console.error(`KO login ${w}x${h} ${theme}: ${e.message}`); }
        await ctx.close();
      }

      // 2. Suggestions d'ID (style sobre).
      {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1024, hasTouch: w < 1024, deviceScaleFactor: 2 });
        const pg = await ctx.newPage();
        await stub(pg, {});
        await seed(pg, { theme, cart: true, recent: true });
        try {
          await pg.goto(base + "/commande", { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector('[data-testid="identity-verify-btn"]', { timeout: 15000 });
          await pg.waitForTimeout(900);
          await pg.screenshot({ path: join(OUT, `${TAG}-2-suggestions-id-${w}x${h}-${theme}.png`) });
          const m = await pg.evaluate(() => {
            const pill = document.querySelector('[data-testid^="identity-recent-id-"]');
            const badge = pill?.querySelector("span");
            const b = pill?.getBoundingClientRect();
            return {
              pillText: pill?.textContent, pillH: b ? Math.round(b.height) : null, pillW: b ? Math.round(b.width) : null,
              badgeBg: badge ? getComputedStyle(badge).backgroundColor : null,
              badgeBorder: badge ? getComputedStyle(badge).borderTopWidth : null,
              pills: document.querySelectorAll('[data-testid^="identity-recent-id-"]').length,
              docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
            };
          });
          console.log(`${TAG} suggestions ${w}x${h} ${theme}:`, JSON.stringify(m));
        } catch (e) { console.error(`KO suggestions ${w}x${h} ${theme}: ${e.message}`); }
        await ctx.close();
      }

      // 3. Admin : carte de commande (mobile et desktop).
      {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1024, hasTouch: w < 1024, deviceScaleFactor: 2 });
        const pg = await ctx.newPage();
        await stub(pg, { admin: true });
        await seed(pg, { theme });
        try {
          await pg.goto(base + "/admin/commandes", { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector('[data-testid="admin-orders"]', { timeout: 15000 });
          await pg.waitForTimeout(1400);
          await pg.screenshot({ path: join(OUT, `${TAG}-3-admin-commandes-${w}x${h}-${theme}.png`), fullPage: true });
          const m = await pg.evaluate(() => {
            const footer = document.querySelector("footer");
            const card = document.querySelector('[data-testid="admin-order-MGS-1001"]');
            const total = document.querySelector('[data-testid="admin-order-total-MGS-1001"]');
            const email = document.querySelector('[data-testid="admin-order-email-MGS-1001"]');
            const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
            return {
              footerPresent: !!footer,
              card: r(card), total: r(total), email: r(email),
              emailTruncated: email ? email.scrollWidth > email.clientWidth + 1 : null,
              docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
              fzrText: (document.querySelector('[data-testid^="fzr-block-"]')?.textContent || "").slice(0, 40),
            };
          });
          console.log(`${TAG} admin ${w}x${h} ${theme}:`, JSON.stringify(m));

          // 4. Visionneuse : fermée (bouton), ouverte, zoomée.
          const proofsBtn = await pg.$('[data-testid="admin-proofs-button-MGS-1001"]');
          if (proofsBtn) {
            await proofsBtn.click();
            await pg.waitForSelector('[data-testid="proof-viewer"]', { timeout: 10000 });
            await pg.waitForTimeout(900);
            await pg.screenshot({ path: join(OUT, `${TAG}-4-visionneuse-ouverte-${w}x${h}-${theme}.png`) });
            await pg.click('[data-testid="proof-zoom-in"]');
            await pg.click('[data-testid="proof-zoom-in"]');
            await pg.waitForTimeout(500);
            await pg.screenshot({ path: join(OUT, `${TAG}-5-visionneuse-zoom-${w}x${h}-${theme}.png`) });
            const vm = await pg.evaluate(() => {
              const img = document.querySelector('[data-testid="proof-viewer-image"]');
              return {
                transform: img?.getAttribute("style") || null,
                counter: document.querySelector('[data-testid="proof-viewer-counter"]')?.textContent,
                dots: document.querySelectorAll('[data-testid^="proof-viewer-dot-"]').length,
                role: document.querySelector('[data-testid="proof-viewer"]')?.getAttribute("role"),
                modal: document.querySelector('[data-testid="proof-viewer"]')?.getAttribute("aria-modal"),
              };
            });
            console.log(`${TAG} visionneuse ${w}x${h} ${theme}:`, JSON.stringify(vm));
            await pg.click('[data-testid="proof-viewer-close"]');
            await pg.waitForTimeout(400);
            await pg.screenshot({ path: join(OUT, `${TAG}-6-visionneuse-fermee-${w}x${h}-${theme}.png`) });
          }
        } catch (e) { console.error(`KO admin ${w}x${h} ${theme}: ${e.message}`); }
        await ctx.close();
      }
    }
  }

  await browser.close();
  server.close();
};
run();
