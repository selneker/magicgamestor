#!/usr/bin/env node
/**
 * Captures et vérifications navigateur pour PL-SEC-HARDEN-1-CAPTCHA
 * (widget Turnstile sur les formulaires sensibles). Usage :
 *
 *   cd frontend && CHROMIUM_PATH=/chemin/vers/chrome \
 *     node scripts/capture-captcha.mjs            # build A (sans clé)
 *   REACT_APP_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
 *     REACT_APP_BACKEND_URL=http://localhost:8001 yarn build   # puis
 *   CHROMIUM_PATH=... node scripts/capture-captcha.mjs       # build B (clé)
 *
 * Le mode est détecté automatiquement : /inscription affiche le widget quand
 * le build porte une clé. Aucun appel réseau Cloudflare : le script du CDN est
 * intercepté et remplacé par un stub (render/remove/reset) — le vrai rendu
 * avec la vraie clé reste « Non vérifié » dans le rapport.
 */

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(root, "build");
const OUT = process.env.OUT_DIR || "/tmp/opencode/captcha-captures";
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

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Stub synchronisé du script Cloudflare : pas de réseau, boîte visible peinte
// dans le conteneur, options exposées pour piloter callback/reset dans le test.
const STUB_SCRIPT = `
window.__turnstileOpts = null;
window.turnstile = {
  render: function (el, opts) {
    window.__turnstileOpts = opts;
    var dark = document.documentElement.classList.contains("dark");
    var dark = document.documentElement.classList.contains("dark");
    el.innerHTML = '<div style="border:1px solid #999;border-radius:6px;color:'+(dark?"#EDEDED":"#444")+';'+
      'background:'+(dark?"#2A2A2A":"#FAFAFA")+';display:flex;align-items:center;justify-content:center;'+
      'font:13px sans-serif;'+
      'min-height:65px;width:100%;max-width:'+(opts.size==="compact"?150:300)+'px;margin:0 auto" '+
      'data-stub="turnstile">Turnstile (capture sans réseau'+(opts.size==="compact"?" · compact":"")+')</div>';
    return "w1";
  },
  reset: function () {},
  remove: function (id) {},
};
`;

const GAMES = [{ id: "pubg-mobile", slug: "pubg-mobile", name: "PUBG Mobile", name_en: "PUBG Mobile", identity_fields: [{ key: "player_id", label: "ID joueur", required: true, primary: true, min_length: 6, pattern: "[0-9]+" }] }];

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

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

  let withKey = null;      // détecté : build A (false) ou build B (true)
  let lastOrderBody = null; // POST /orders capturé

  // Un contexte navigateur mobile ; intercepte /api et le CDN Cloudflare.
  const newPage = async ({ theme = "light", width = 390, height = 844 } = {}) => {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true, hasTouch: true,
    });
    const pg = await ctx.newPage();
    await pg.addInitScript(
      `try{localStorage.setItem('mgs-theme','${theme}');localStorage.setItem('mgs_lang','fr');
         localStorage.setItem('mgs_cart', JSON.stringify([{id:"p1",slug:"660-uc",name:"660 UC",name_en:"660 UC",qty:1,price:2500,type:"uc",game_id:"pubg-mobile"}]));
      }catch(e){}`,
    );
    await pg.route("**/challenges.cloudflare.com/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: STUB_SCRIPT }));
    await pg.route("**/api/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      const body = (s, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(s) });
      if (p.includes("/auth/me")) return body({ detail: "Non authentifié" }, 401);
      if (p.includes("/auth/refresh")) return body({ detail: "Non authentifié" }, 401);
      if (p.endsWith("/auth/login")) return body({ detail: "Identifiants incorrects" }, 401);
      if (p.includes("/me/game-identities")) return body([]);
      if (p.includes("/fazercards/validate-id")) return body({ valid: true, player_name: "Joueur Test" });
      if (p === "/api/games") return body(GAMES);
      if (p.includes("/payments/config") || p.includes("/crypto/config")) return body({});
      if (p.endsWith("/orders")) {
        lastOrderBody = route.request().postDataJSON() || null;
        return body({ id: "o1", order_number: "MGS-CP", pubg_id: "123456789", subtotal: 2500, payment_fee: 0, items: [{ name: "660 UC", quantity: 1 }], status: "pending_payment", payment_method: lastOrderBody?.payment_method || "mvola" });
      }
      if (p.includes("/payments/")) return body({ payment_url: null, simulated: true });
      return body({});
    });
    return { ctx, pg };
  };

  const logFlow = (pg) => pg.evaluate(() => ({
    widget: !!document.querySelector('[data-testid="captcha-widget"]'),
    widgetSize: window.__turnstileOpts?.size || null,
    widgetTheme: window.__turnstileOpts?.theme || null,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));

  // Capture centrée sur le widget : les barres fixes (panier, nav) recouvrent
  // le formulaire sur une capture pleine page — on les masque JUSTE pour ce
  // cadrage (documenté dans le rapport), puis on amène le widget à l'écran.
  const shotWidget = async (pg, name) => {
    await pg.evaluate(() => {
      const s = document.createElement("style");
      s.setAttribute("data-shot-cleanup", "");
      s.textContent = `[data-testid="mobile-cart-bar"], [data-testid="bottom-nav-wrapper"], [data-testid="bottom-nav"] { display: none !important; }`;
      document.head.appendChild(s);
    });
    const w = pg.locator('[data-testid="captcha-widget"]');
    if (await w.count()) { await w.scrollIntoViewIfNeeded().catch(() => {}); await pg.waitForTimeout(300); }
    await pg.screenshot({ path: join(OUT, name), fullPage: false });
    await pg.evaluate(() => document.querySelectorAll('style[data-shot-cleanup]').forEach((s) => s.remove()));
  };

  /* ── 1. /inscription : détection du mode ─────────────────────────────── */
  {
    const { ctx, pg } = await newPage();
    await pg.goto(base + "/inscription", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1500);
    withKey = await pg.evaluate(() => !!document.querySelector('[data-testid="captcha-widget"]'));
    console.log(`\n== ${withKey ? "BUILD B — clé configurée" : "BUILD A — sans clé"} ==\n`);
    if (withKey) {
      const st = await logFlow(pg);
      check("inscription : widget affiché", st.widget);
      check("inscription : taille compacte à 390 px", st.widgetSize === "compact", st.widgetSize);
      check("inscription : bouton bloqué sans jeton", await pg.locator('[data-testid="auth-submit"]').isDisabled());
      check("inscription : aucun défilement horizontal", !st.hScroll);
      await pg.screenshot({ path: join(OUT, "inscription-390.png"), fullPage: true });
      await shotWidget(pg, "inscription-widget-390.png");
    } else {
      check("inscription : aucun widget (sans clé)", !(await pg.evaluate(() => !!document.querySelector('[data-testid="captcha-widget"]'))));
      check("inscription : bouton de inscription actif", !(await pg.locator('[data-testid="auth-submit"]').first().isDisabled().catch(() => true)));
      await pg.screenshot({ path: join(OUT, "inscription-390-sans-cle.png"), fullPage: true });
    }
    await ctx.close();
  }

  /* ── 2. /connexion : widget seulement après un 1er échec ─────────────── */
  for (const theme of withKey ? ["light", "dark"] : ["light"]) {
    const { ctx, pg } = await newPage({ theme });
    await pg.goto(base + "/connexion", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1200);
    check(`connexion (${theme}) : pas de widget au départ`, !(await pg.evaluate(() => !!document.querySelector('[data-testid="captcha-widget"]'))));
    await pg.fill('[data-testid="email-input"]', "joueur@exemple.test");
    await pg.fill('[data-testid="password-input"]', "mauvais-mdp");
    await pg.click('[data-testid="auth-submit"]');
    await pg.waitForTimeout(1200);
    const st = await logFlow(pg);
    if (withKey) {
      check(`connexion après échec (${theme}) : widget affiché`, st.widget);
      check(`connexion (${theme}) : bouton bloqué (jeton à usage unique)`, await pg.locator('[data-testid="auth-submit"]').isDisabled());
      check(`connexion (${theme}) : message d'erreur affiché`, (await pg.locator('[data-testid="auth-error"]').count()) === 1);
      const overflowSuffix = theme === "light" ? "" : `-dark`;
      // vérif de taille compacte à 320 px, thème sombre en bonus d'overflow
      if (theme === "light") {
        await pg.setViewportSize({ width: 320, height: 700 });
        await pg.waitForTimeout(400);
        const st320 = await logFlow(pg);
        check("connexion : aucun débordement horizontal à 320 px", !st320.hScroll);
        check("320 px : le widget peint est compact (150 px)", (await pg.evaluate(() => document.querySelector('[data-stub="turnstile"]')?.style.maxWidth)) === "150px");
        await pg.screenshot({ path: join(OUT, "connexion-apres-echec-320.png"), fullPage: true });
        await shotWidget(pg, "connexion-widget-320.png");
      }
      await pg.screenshot({ path: join(OUT, `connexion-apres-echec-390${theme === "dark" ? "-dark" : ""}.png`), fullPage: true });
      await shotWidget(pg, `connexion-widget-390${theme === "dark" ? "-dark" : ""}.png`);
    } else {
      check("connexion après échec : message d'erreur affiché, pas de widget", st.widget === false && (await pg.locator('[data-testid="auth-error"]').count()) === 1);
      check("connexion sans clé : bouton actif réutilisiable", !(await pg.locator('[data-testid="auth-submit"]').isDisabled()));
      await pg.screenshot({ path: join(OUT, `connexion-apres-echec-390-sans-cle${theme === "dark" ? "-dark" : ""}.png`), fullPage: true });
    }
    await ctx.close();
  }

  /* ── 3. /mot-de-passe-oublie ─────────────────────────────────────────── */
  {
    const { ctx, pg } = await newPage();
    await pg.goto(base + "/mot-de-passe-oublie", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1200);
    const st = await logFlow(pg);
    if (withKey) {
      check("forgot : widget affiché", st.widget);
      check("forgot : bouton bloqué sans jeton", await pg.locator('[data-testid="forgot-submit"]').isDisabled());
      await pg.screenshot({ path: join(OUT, "mot-de-passe-oublie-390.png"), fullPage: true });
      await shotWidget(pg, "mot-de-passe-oublie-widget-390.png");
    } else {
      check("forgot sans clé : pas de widget, envoi débloqué", st.widget === false && !(await pg.locator('[data-testid="forgot-submit"]').isDisabled()));
      // envoi réel → écran « sent »
      await pg.fill('[data-testid="forgot-email-input"]', "joueur@exemple.test");
      await pg.click('[data-testid="forgot-submit"]');
      await pg.waitForTimeout(900);
      check("forgot sans clé : écran « email envoyé » atteint", (await pg.locator('[data-testid="forgot-sent"]').count()) === 1);
      await pg.screenshot({ path: join(OUT, "mot-de-passe-oublie-envoi-sans-cle.png"), fullPage: true });
    }
    await ctx.close();
  }

  /* ── 4. Création de commande (/commande étape 3) ─────────────────────── */
  {
    const { ctx, pg } = await newPage();
    await pg.goto(base + "/commande", { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1800);
    // Étape 1 : email invité + vérification d'identité (mock valide) puis continuer
    await pg.fill('[data-testid="guest-email-input"]', "joueur@exemple.test");
    await pg.fill('[data-testid="identity-field-player_id"]', "523456789");
    await pg.click('[data-testid="identity-verify-btn"]');
    await pg.waitForSelector('[data-testid="identity-verify-valid"]', { timeout: 8000 });
    await pg.click('[data-testid="checkout-verify-continue"]');
    await pg.waitForTimeout(900);
    // Étape 2 : MVola + téléphone + accepter les frais
    await pg.click('[data-testid="method-mvola"]');
    await pg.waitForTimeout(600);
    await pg.fill('[data-testid="payment-phone"]', "0340000001");
    await pg.click('[data-testid="accept-fee-checkbox"]');
    await pg.waitForTimeout(300);
    await pg.click('[data-testid="payment-pay"]');
    await pg.waitForTimeout(1200);

    const payNow = pg.locator('[data-testid="checkout-pay-now"]');
    const st = await logFlow(pg);
    if (withKey) {
      check("checkout : widget visible à l'étape de paiement", st.widget);
      check("checkout : bouton « payer » bloqué sans jeton", (await payNow.count()) === 1 && (await payNow.isDisabled()));
      check("checkout : aucun débordement horizontal", !st.hScroll);
      await pg.screenshot({ path: join(OUT, "checkout-widget-visible-390.png"), fullPage: true });

      // Jeton du stub → le bouton débloque → POST /orders porte captcha_token
      await pg.evaluate(() => window.__turnstileOpts && window.__turnstileOpts.callback("jeton-capture-1"));
      await pg.waitForTimeout(400);
      check("checkout : bouton « payer » débloqué avec jeton", !(await payNow.isDisabled()));
      await pg.screenshot({ path: join(OUT, "checkout-pret-a-payer-390.png"), fullPage: true });
      await pg.click('[data-testid="checkout-pay-now"]');
      await pg.waitForTimeout(1800);
      check("checkout : POST /orders porte captcha_token", lastOrderBody?.captcha_token === "jeton-capture-1", JSON.stringify(lastOrderBody ? { captcha_token: lastOrderBody.captcha_token, payment_method: lastOrderBody.payment_method, items: lastOrderBody.items } : null));
      check("checkout : POST /orders porte payment_method mvola", lastOrderBody?.payment_method === "mvola");
      await pg.screenshot({ path: join(OUT, "checkout-apres-envoi-390.png"), fullPage: true });
    } else {
      check("checkout sans clé : bouton « payer » actif", (await payNow.count()) === 1 && !(await payNow.isDisabled()));
      await pg.click('[data-testid="checkout-pay-now"]');
      await pg.waitForTimeout(1800);
      check("checkout sans clé : POST /orders SANS captcha_token", !!lastOrderBody && !("captcha_token" in lastOrderBody));
      check("checkout sans clé : POST /orders porte payment_method mvola", lastOrderBody?.payment_method === "mvola");
      await pg.screenshot({ path: join(OUT, "checkout-apres-envoi-sans-cle.png"), fullPage: true });
    }
    await ctx.close();
  }

  console.log(failures ? `\n${failures} échec(s)` : "\nTout OK");
  console.log(`Captures : ${OUT}`);
  await browser.close();
  server.close();
  process.exit(failures ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
