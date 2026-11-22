#!/usr/bin/env node
/**
 * demo-login-proof.mjs — PREUVE que le propriétaire peut ouvrir le site et se
 * connecter lui-même (PL-FE-009, phase 1).
 *
 * Aucune simulation : ni `page.route`, ni `force: true`. On ouvre la vraie page
 * servie par demo-local.sh, on clique dans le vrai formulaire, et on capture ce
 * que l'utilisateur voit.
 *
 *   node frontend/scripts/demo-login-proof.mjs
 *
 * Lit le port dans ~/mgs-demo/demo.state (ou MGS_DEMO_URL). Capture dans
 * ~/mgs-demo/preuve-compte-<label>.png.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEMO = path.join(os.homedir(), "mgs-demo");
const STATE = path.join(DEMO, "demo.state");
const EMAIL = process.env.MGS_DEMO_EMAIL || "demo@example.com";
const PASSWORD = process.env.MGS_DEMO_PASSWORD || "Demo12345";

function lireUrl() {
  if (process.env.MGS_DEMO_URL) return process.env.MGS_DEMO_URL;
  if (fs.existsSync(STATE)) {
    const txt = fs.readFileSync(STATE, "utf8");
    const m = txt.match(/WEB_PORT='?([0-9]+)'?/);
    if (m) return `http://127.0.0.1:${m[1]}/`;
  }
  return null;
}

function findChromium() {
  const c = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser",
    path.join(os.homedir(), ".hermes/tools/chromium-1248/chrome-linux64/chrome")].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch { /* */ } }
  console.error("[erreur] CHROMIUM_PATH introuvable");
  process.exit(2);
}

const URL = lireUrl();
if (!URL) {
  console.error("[erreur] demo-local.sh n'a pas tourné (pas de ~/mgs-demo/demo.state). Lancez ./scripts/demo-local.sh d'abord.");
  process.exit(2);
}

/* Lit la page compte et n'accepte que deux lectures consécutives identiques :
   la session revient de façon asynchrone après un rechargement. */
async function lireCompteStable(page) {
  let precedent = null;
  for (let i = 0; i < 50; i++) {
    const s = await page.evaluate(() => ({
      page: document.body.getAttribute("data-page"),
      nom: (document.querySelector("#acc-name") || {}).value || "",
      muted: (document.querySelector(".mgs-page[data-page=compte] .mgs-muted") || {}).textContent || "",
    }));
    if (s.page === "compte" && s.nom.trim() && s.nom !== "Mamy Gamer" && /demo@example\.com/.test(s.muted)) {
      if (precedent && precedent.nom === s.nom && precedent.muted === s.muted) return s;
      precedent = s;
    } else {
      precedent = null;
    }
    await page.evaluate(() => { if (document.body.getAttribute("data-page") !== "compte") window.mgsShowPage("compte"); });
    await page.waitForTimeout(400);
  }
  return null;
}

const VPS = [{ label: "desktop", width: 1440, height: 900 }, { label: "mobile", width: 390, height: 844 }];
const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let pass = 0, fail = 0;
const echecs = [];

for (const vp of VPS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  try {
    await page.goto(URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });

    // le site doit parler au backend local injecté, pas à la production
    const backend = await page.evaluate(() => window.MGS_BACKEND_URL || "(défaut = production)");
    if (/onrender\.com/.test(String(backend))) throw new Error(`le prototype appelle encore la production (${backend})`);

    // connexion par la vraie UI
    await page.evaluate(() => window.mgsShowPage("connexion"));
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
    await page.locator("#em").fill(EMAIL);
    await page.locator("#pw").fill(PASSWORD);
    await page.locator('a[data-nav="compte"]', { hasText: "Se connecter" }).click();

    const c1 = await lireCompteStable(page);
    if (!c1) throw new Error("connexion : la page compte ne porte pas le compte de test");
    const tir1 = path.join(DEMO, `preuve-compte-${vp.label}.png`);
    await page.screenshot({ path: tir1, fullPage: false });

    // rechargement : toujours connecté
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });
    const c2 = await lireCompteStable(page);
    if (!c2) throw new Error("rechargement : session perdue (la page compte retombe sur le placeholder)");
    const tir2 = path.join(DEMO, `preuve-compte-${vp.label}-apres-rechargement.png`);
    await page.screenshot({ path: tir2, fullPage: false });

    const reel = erreurs.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
    if (reel.length) throw new Error("erreurs JS : " + reel.join(" | "));
    console.log(`✓ ${vp.label} (${vp.width}px)  connecté : ${c1.nom} <${EMAIL}> — backend ${backend}`);
    console.log(`  captures : ${tir1}`);
    console.log(`            ${tir2}`);
    pass++;
  } catch (e) {
    const msg = e && e.message ? e.message.split("\n")[0] : String(e);
    console.log(`✗ ${vp.label} : ${msg}`);
    echecs.push(`[${vp.label}] ${msg}`);
    fail++;
  } finally {
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (echecs.length) { console.log("\nÉchecs :"); echecs.forEach((f) => console.log("  - " + f)); }
process.exit(fail ? 1 : 0);
