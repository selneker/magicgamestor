#!/usr/bin/env node
// PL-UX-3 — driver de captures (état AVANT/APRÈS). AUCUN appel production :
// build servi en local, appels /api interceptés. NON COMMITÉ.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const CHROMIUM = process.argv[2];
const TAG = process.argv[3] || "apres";
if (!CHROMIUM || !existsSync(CHROMIUM)) { console.error("chemin chromium manquant"); process.exit(1); }
const OUT = `/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-UX-3`;
const BUILD_DIR = join(process.cwd(), "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const ICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%23D4FF00'/><circle cx='48' cy='48' r='30' fill='%23111111'/></svg>`);
const IDENTITY = [{ key: "player_id", label: "ID joueur", label_en: "Player ID", pattern: "^[0-9]{8,12}$", min_length: 8, max_length: 12, required: true, primary: true }];
const GAMES = [
  { id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", icon_url: ICON, active: true, sort_order: 0, currency_label: "UC", identity_fields: IDENTITY },
  { id: "free-fire", slug: "free-fire", name: "Free Fire", icon_url: ICON, active: true, sort_order: 1, currency_label: "D", identity_fields: IDENTITY },
];
const PRODUCTS = [{ id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", price: 25000, type: "uc", game_id: "pubg-mobile", active: true, sort_order: 0 }];
const PAYMENT_CONFIG = { providers: { mvola: { configured: true }, orange: { configured: true } }, payment_fees: {} };
const ADMIN_USER = { user_id: "u-admin", email: "admin@exemple.test", role: "super_admin", permissions: ["orders.manage"] };
const future = (mins) => new Date(Date.now() + mins * 60 * 1000).toISOString();

const PENDING_ORDER = {
  id: "ord-pend-1", order_number: "MGS-PEND-1", status: "pending_payment", payment_method: "manual",
  manual_operator: "mvola", pubg_id: "123456789", pseudo: "Joueur", game_id: "pubg-mobile",
  items: [{ quantity: 1, name: "660 UC", line_total: 1250000 }], created_at: new Date().toISOString(),
  total: 1250000, payment_fee: 0, payment_deadline_at: future(29),
};
const ADMIN_ORDERS = [
  { id: "o1", order_number: "MGS-1001", created_at: new Date().toISOString(), status: "pending_payment", pseudo: "Awa", pubg_id: "111111111", items: [{ quantity: 1, name: "660 UC" }], total: 25000, payment_method: "manual", manual_operator: "mvola" },
  { id: "o2", order_number: "MGS-1002", created_at: new Date().toISOString(), status: "paid", pseudo: "Awa", pubg_id: "222222222", items: [{ quantity: 1, name: "660 UC" }], total: 25000, payment_method: "manual", manual_operator: "orange" },
  { id: "o3", order_number: "MGS-1003", created_at: new Date().toISOString(), status: "paid", pseudo: "Awa", pubg_id: "333333333", items: [{ quantity: 1, name: "660 UC" }], total: 25000, payment_method: "binance" },
  { id: "o4", order_number: "MGS-1004", created_at: new Date().toISOString(), status: "pending_payment", pseudo: "Awa", pubg_id: "444444444", items: [{ quantity: 1, name: "660 UC" }], total: 25000, payment_method: "manual", manual_operator: null },
];

const RECENT_IDS = {
  "pubg-mobile": [
    { id: "512398471", usedAt: Date.now() - 1000 },
    { id: "500112233", usedAt: Date.now() - 2000 },
    { id: "498877665", usedAt: Date.now() - 3000 },
    { id: "487766554", usedAt: Date.now() - 4000 },
    { id: "476655443", usedAt: Date.now() - 5000 },
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

const stub = (pg, { admin = false, pending = false } = {}) => {
  pg.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.includes("/auth/me")) {
      return route.fulfill(admin
        ? { status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_USER) }
        : { status: 401, contentType: "application/json", body: "{}" });
    }
    if (p.includes("/validate-id")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: true, player_name: "JoueurTest" }) });
    if (p.endsWith("/games")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAMES) });
    if (p.includes("/products")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
    if (p.includes("/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    if (p.includes("/payments/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PAYMENT_CONFIG) });
    if (p.includes("/crypto/config")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false, networks: [] }) });
    if (p === "/api/orders/me") {
      const body = pending ? JSON.stringify([PENDING_ORDER]) : JSON.stringify([]);
      return route.fulfill({ status: 200, contentType: "application/json", body });
    }
    if (p.startsWith("/api/orders/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PENDING_ORDER) });
    }
    if (p === "/api/admin/orders") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_ORDERS) });
    if (p.includes("/admin/fazercards/mappings")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
};

const seed = (pg, { theme, cart = false, recent = false } = {}) => {
  const parts = [
    `try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');localStorage.setItem('mgs_selected_game','pubg-mobile');}catch(e){}`,
  ];
  if (cart) parts.push(`try{localStorage.setItem('mgs_cart', ${JSON.stringify(JSON.stringify([{ id: "p1", slug: "660-uc", name: "660 UC", type: "uc", price: 25000, game_id: "pubg-mobile", qty: 1 }]))});}catch(e){}`);
  if (recent) parts.push(`try{localStorage.setItem('mgs_recent_player_ids', ${JSON.stringify(JSON.stringify(RECENT_IDS))});}catch(e){}`);
  parts.push(`try{localStorage.setItem('mgs_pending_order_id', ${JSON.stringify(JSON.stringify({ id: "ord-pend-1", createdAt: new Date().toISOString() }))});}catch(e){}`);
  pg.addInitScript(parts.join(""));
};

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

  for (const [w, h] of [[320, 640], [360, 640], [390, 844], [430, 844]]) {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const pg = await ctx.newPage();
      await stub(pg, { pending: true });
      await seed(pg, { theme, cart: true, recent: true });

      // 1. Écran de commande : champ ID + suggestions.
      try {
        await pg.goto(base + "/commande", { waitUntil: "domcontentloaded", timeout: 30000 });
        await pg.waitForSelector('[data-testid="identity-verify-btn"]', { timeout: 15000 });
        await pg.waitForTimeout(900);
        await pg.screenshot({ path: join(OUT, `${TAG}-1-id-suggestions-${w}x${h}-${theme}.png`) });
        const m = await pg.evaluate(() => {
          const row = document.querySelector('[data-testid="identity-verify-row"]');
          const list = document.querySelector('[data-testid="identity-recent-ids"]');
          const pills = Array.from(document.querySelectorAll('[data-testid^="identity-recent-id-"]'));
          const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) } : null; };
          return {
            row: r(row), list: r(list), pills: pills.map((p) => ({ id: p.textContent, w: Math.round(p.getBoundingClientRect().width), h: Math.round(p.getBoundingClientRect().height) })),
            scrollW: list?.scrollWidth, clientW: list?.clientWidth, docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          };
        });
        console.log(`${TAG} suggestions ${w}x${h} ${theme}:`, JSON.stringify(m));

        // 2. Vérification réussie → plus de suggestions.
        await pg.fill('[data-testid="identity-field-player_id"]', "512398471");
        await pg.waitForTimeout(300);
        await pg.click('[data-testid="identity-verify-btn"]');
        await pg.waitForTimeout(900);
        await pg.screenshot({ path: join(OUT, `${TAG}-2-id-verifie-${w}x${h}-${theme}.png`) });
        const verified = await pg.evaluate(() => ({
          suggestions: !!document.querySelector('[data-testid="identity-recent-ids"]'),
          pseudo: document.querySelector('[data-testid="checkout-player-pseudo"]')?.textContent || null,
        }));
        console.log(`${TAG} verifie ${w}x${h} ${theme}:`, JSON.stringify(verified));

        // 3. « Changer » → les suggestions reviennent.
        const change = await pg.$('[data-testid="checkout-change-id"]');
        if (change) {
          await change.click();
          await pg.waitForTimeout(700);
          await pg.screenshot({ path: join(OUT, `${TAG}-3-apres-changer-${w}x${h}-${theme}.png`) });
          const after = await pg.evaluate(() => ({
            suggestions: !!document.querySelector('[data-testid="identity-recent-ids"]'),
            pills: Array.from(document.querySelectorAll('[data-testid^="identity-recent-id-"]')).map((p) => p.textContent),
          }));
          console.log(`${TAG} changer ${w}x${h} ${theme}:`, JSON.stringify(after));
        }
      } catch (e) { console.error(`KO checkout ${w}x${h} ${theme}: ${e.message}`); }

      // 4. Bannière « commande en attente » sur l'accueil.
      try {
        await pg.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
        await pg.waitForSelector('[data-testid="pending-order-banner"]', { timeout: 15000 });
        await pg.waitForTimeout(800);
        await pg.screenshot({ path: join(OUT, `${TAG}-4-banniere-${w}x${h}-${theme}.png`) });
        const bm = await pg.evaluate(() => {
          const card = document.querySelector('[data-testid="pending-order-banner"] section');
          const amount = document.querySelector('[data-testid="pending-banner-amount"]');
          const title = document.querySelector('[data-testid="pending-banner-title"]');
          const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
          return {
            card: r(card), amount: r(amount), title: r(title),
            amountText: amount?.textContent, titleText: title?.textContent,
            titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : null,
            titleScrollW: title?.scrollWidth, titleClientW: title?.clientWidth,
            amountTruncated: amount ? amount.scrollWidth > amount.clientWidth + 1 : null,
            amountLines: amount ? Math.round(amount.getBoundingClientRect().height / parseFloat(getComputedStyle(amount).lineHeight || "20")) : null,
            docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          };
        });
        console.log(`${TAG} banniere ${w}x${h} ${theme}:`, JSON.stringify(bm));
      } catch (e) { console.error(`KO banniere ${w}x${h} ${theme}: ${e.message}`); }
      await ctx.close();
    }
  }

  // 5. Admin : filtre de méthode ouvert (4 largeurs, clair + sombre).
  for (const [w, h] of [[320, 640], [360, 640], [390, 844], [430, 844]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await stub(pg, { admin: true });
    await seed(pg, { theme });
    try {
      await pg.goto(base + "/admin/commandes", { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.waitForSelector('[data-testid="admin-filter-method"]', { timeout: 15000 });
      await pg.waitForTimeout(1200);
      await pg.screenshot({ path: join(OUT, `${TAG}-5-admin-filtre-ferme-${w}x${h}-${theme}.png`) });
      await pg.click('[data-testid="admin-filter-method"]');
      await pg.waitForTimeout(700);
      await pg.screenshot({ path: join(OUT, `${TAG}-5-admin-filtre-ouvert-${w}x${h}-${theme}.png`) });
      const options = await pg.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent.trim()));
      console.log(`${TAG} admin options ${theme}:`, JSON.stringify(options));
      // Filtre MVola → la note de limite doit apparaître.
      await pg.click('[role="option"]:has-text("MVola")');
      await pg.waitForTimeout(1200);
      await pg.screenshot({ path: join(OUT, `${TAG}-6-admin-filtre-mvola-${w}x${h}-${theme}.png`) });
      const filtered = await pg.evaluate(() => ({
        note: document.querySelector('[data-testid="admin-method-operator-note"]')?.textContent || null,
        rows: Array.from(document.querySelectorAll('[data-testid^="admin-order-"]')).map((r) => r.getAttribute("data-testid")),
      }));
      console.log(`${TAG} admin mvola ${theme}:`, JSON.stringify(filtered));
    } catch (e) { console.error(`KO admin ${w}x${h} ${theme}: ${e.message}`); }
    await ctx.close();
  }
  }

  await browser.close();
  server.close();
};
run();
