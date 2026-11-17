#!/usr/bin/env node
// PL-UX-5 — driver de captures (maquette vs application). AUCUN appel
// production : build servi en local, appels /api interceptés. NON COMMITÉ.
// Usage: node capture-pl-ux-5.mjs <chemin-chrome>
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const CHROME = process.argv[2];
if (!CHROME || !existsSync(CHROME)) { console.error("chemin chrome manquant"); process.exit(1); }
const OUT = `/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-UX-5`;
const MAQUETTE = `file:///home/selneker/Projects/GameStore/magicgamestor/repports/maquettes/apercu-admin-commandes.html`;
const BUILD_DIR = join(process.cwd(), "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

const PROOF = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1400'><rect width='900' height='1400' fill='#F4F3EE'/><rect x='40' y='40' width='820' height='1320' fill='#111111'/><text x='450' y='700' fill='#D4FF00' font-size='64' text-anchor='middle' font-family='monospace'>PREUVE ${"${n}"}</text></svg>`, "utf8");
const ADMIN_USER = { user_id: "u-admin", email: "admin@exemple.test", role: "super_admin", permissions: ["orders.manage"] };
const now = "2026-11-11T16:44:47Z";
const PROOF1 = [{ size: 1048576, uploaded_at: "2026-11-10T10:00:00Z" }];
// Données calquées sur la maquette : paid (Orange Money), delivered (MVola),
// pending (Binance USDT), preuves sur les deux premières.
const ADMIN_ORDERS = [
  { id: "o1", order_number: "MGS-F49AA2", created_at: now, status: "paid", pseudo: "Rhaylala", pubg_id: "743159131", items: [{ quantity: 1, name: "Weekly Pass" }], total: 8800, payment_method: "orange", payment_phone: "", email: "asaidharilala@gmail.com", payment_proofs: PROOF1 },
  { id: "o2", order_number: "MGS-66458C", created_at: "2026-11-11T16:30:34Z", status: "delivered", pseudo: "TraqueurMDGR", pubg_id: "52050065597", items: [{ quantity: 1, name: "60 UC" }], total: 4600, payment_method: "mvola", payment_phone: "", email: "client@exemple.com", payment_proofs: PROOF1 },
  { id: "o3", order_number: "MGS-A1B2C3", created_at: "2026-11-11T15:02:10Z", status: "pending_payment", pseudo: "NomTresLongDeJoueurPUBG", pubg_id: "51831895103", items: [{ quantity: 1, name: "325 UC" }], total: 24000, payment_method: "binance", email: "autre@exemple.com" },
];

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

const stub = (pg) => {
  pg.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.includes("/auth/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_USER) });
    if (p.startsWith("/api/admin/orders/") && p.includes("/proofs/")) {
      const idx = Number(p.split("/proofs/")[1]);
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: PROOF.toString("utf8").replace("${n}", String(idx + 1)) });
    }
    if (p === "/api/admin/orders") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ADMIN_ORDERS) });
    if (p.includes("/admin/fazercards/mappings")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
};

const seed = (pg, { theme } = {}) => {
  pg.addInitScript(`try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');}catch(e){}`);
};

const measure = () => {
  const card = document.querySelector('[data-testid="admin-order-MGS-F49AA2"]');
  const badge = document.querySelector('[data-testid="admin-order-MGS-F49AA2"] [data-testid="status-paid"]');
  const toggle = document.querySelector('[data-testid="admin-order-toggle-MGS-F49AA2"]');
  const body = document.querySelector('[data-testid="admin-order-body-MGS-F49AA2"]');
  const deliver = document.querySelector('[data-testid^="admin-deliver-"]');
  const bs = badge ? getComputedStyle(badge) : null;
  const cs = card ? getComputedStyle(card) : null;
  // PL-UX-5 (aligné) : hauts de ligne réels des lignes homologues (bureau).
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
  const col1 = card ? card.querySelector("div.hidden.sm\\:block") : null;
  const dateEl = col1 ? col1.querySelector('span[class*="text-[11px]"]') : null;
  const badgeD = col1 ? col1.querySelector('[data-testid^="status-"]') : null;
  const stack = card ? card.querySelector("div.sm\\:row-span-2:not(.hidden)") : null;
  const stackPs = stack ? Array.from(stack.querySelectorAll(":scope > p")) : [];
  return {
    gridCols: cs ? cs.gridTemplateColumns : null,
    badgeFontSize: bs ? bs.fontSize : null, badgePadding: bs ? `${bs.paddingTop} ${bs.paddingRight}` : null,
    badgeBorderRadius: bs ? bs.borderRadius : null, badgeTextTransform: bs ? bs.textTransform : null, badgeFontWeight: bs ? bs.fontWeight : null,
    deliverPresent: !!deliver,
    toggleAria: toggle ? toggle.getAttribute("aria-expanded") : null,
    toggleVisible: toggle ? getComputedStyle(toggle).display !== "none" : false,
    bodyHiddenClass: body ? body.className.includes("hidden") : null,
    // alignement (bureau uniquement ; null sur mobile, éléments masqués)
    yDate: top(dateEl), yProduct: top(stackPs[1]), yBadge: top(badgeD), yMeta: top(stackPs[2]),
    docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
  };
};

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

  // --- Maquette (référence) : bureau + mobile fermé/ouvert ---
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await pg.goto(MAQUETTE, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(600);
    await pg.locator(".desk").screenshot({ path: join(OUT, "maquette-bureau.png") });
    // fermé : replier c2 (ouverte par défaut dans la maquette)
    await pg.evaluate(() => { window.t && t("c2"); });
    await pg.locator(".phone").first().screenshot({ path: join(OUT, "maquette-mobile-ferme.png") });
    // ouvert : ouvrir c1
    await pg.evaluate(() => t("c1"));
    await pg.locator(".phone").first().screenshot({ path: join(OUT, "maquette-mobile-ouvert.png") });
    await ctx.close();
  }

  // --- Application ---
  for (const [w, h] of [[1440, 900], [390, 844], [320, 700]]) {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1024, hasTouch: w < 1024, deviceScaleFactor: 2 });
      const pg = await ctx.newPage();
      await stub(pg);
      await seed(pg, { theme });
      try {
        await pg.goto(base + "/admin/commandes", { waitUntil: "domcontentloaded", timeout: 30000 });
        await pg.waitForSelector('[data-testid="admin-order-MGS-F49AA2"]', { timeout: 15000 });
        await pg.waitForTimeout(1200);
        const tag = `${w}x${h}-${theme}`;
        // fermé (par défaut sur mobile) ; sur bureau tout est affiché
        await pg.screenshot({ path: join(OUT, `app-${w < 1024 ? "mobile" : "bureau"}-ferme-${tag}.png`), fullPage: true });
        console.log(`app ferme ${tag}:`, JSON.stringify(await pg.evaluate(measure)));
        // ouvert : ouvrir la première carte (mobile seulement)
        if (w < 1024) {
          await pg.click('[data-testid="admin-order-toggle-MGS-F49AA2"]');
          await pg.waitForTimeout(500);
          await pg.screenshot({ path: join(OUT, `app-mobile-ouvert-${tag}.png`), fullPage: true });
          console.log(`app ouvert ${tag}:`, JSON.stringify(await pg.evaluate(measure)));
        }
      } catch (e) { console.error(`KO app ${w}x${h} ${theme}: ${e.message}`); }
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log("CAPTURES PL-UX-5 TERMINÉES");
};

run().catch((e) => { console.error(e); process.exit(1); });
