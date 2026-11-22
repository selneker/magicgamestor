#!/usr/bin/env node
/**
 * proto-auth-real.mjs — parcours RÉELS de l'authentification contre le vrai
 * backend local de demo-local.sh (PL-FE-009, phase 4.1).
 *
 *   node frontend/scripts/proto-auth-real.mjs
 *
 * Couvre : connexion par la touche Entrée, déconnexion, inscription,
 * mot de passe oublié (demande) puis réinitialisation avec le jeton (réel,
 * jeton injecté en base avec le même hashage sha256 que le backend), garde invité.
 * Aucun page.route, aucun force:true.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DEMO = path.join(os.homedir(), "mgs-demo");
const STATE = path.join(DEMO, "demo.state");
const EMAIL = "demo@example.com";
const PW = "Demo12345";

function etat() {
  if (!fs.existsSync(STATE)) return null;
  const t = fs.readFileSync(STATE, "utf8");
  const g = (k) => (t.match(new RegExp(k + "='?([0-9]+)'?")) || [])[1];
  return { web: g("WEB_PORT"), mongo: g("MONGO_PORT") };
}
const st = etat();
if (!st) { console.error("[erreur] ./scripts/demo-local.sh n'a pas tourné."); process.exit(2); }
const URL = `http://127.0.0.1:${st.web}/`;
const MONGOD = path.join(os.homedir(), ".local/opt/mongodb/bin/mongo");
const ENV = { ...process.env, LD_LIBRARY_PATH: path.join(os.homedir(), ".local/opt/libssl1.1/usr/lib/x86_64-linux-gnu") };
const mongo = (js) => execFileSync(MONGOD, ["--quiet", "--port", st.mongo, "mgs_demo", "--eval", js], { encoding: "utf8", env: ENV }).trim();

function chrome() {
  const c = [process.env.CHROMIUM_PATH, path.join(os.homedir(), ".hermes/tools/chromium-1248/chrome-linux64/chrome")].filter(Boolean);
  return c.find((p) => fs.existsSync(p)) || null;
}
const nav = await chromium.launch({ executablePath: chrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let pass = 0, fail = 0; const echecs = [];
const tape = async (page, n, fn) => {
  try { await fn(); console.log("✓ " + n); pass++; }
  catch (e) { console.log("✗ " + n + " :: " + String(e).split("\n")[0].slice(0, 150)); echecs.push(n); fail++; }
};
const attendreCompte = async (page) => {
  let precedent = null;
  for (let i = 0; i < 50; i++) {
    const s = await page.evaluate(() => ({
      page: document.body.getAttribute("data-page"),
      nom: (document.querySelector("#acc-name") || {}).value || "",
      muted: (document.querySelector(".mgs-page[data-page=compte] .mgs-muted") || {}).textContent || "",
    }));
    if (s.page === "compte" && s.nom && s.nom !== "Mamy Gamer" && /@/.test(s.muted)) {
      if (precedent && precedent.nom === s.nom && precedent.muted === s.muted) return s;
      precedent = s;
    } else precedent = null;
    await page.evaluate(() => { if (document.body.getAttribute("data-page") !== "compte") window.mgsShowPage("compte"); });
    await page.waitForTimeout(400);
  }
  throw new Error("compte jamais atteint");
};

/* ---------- 1. connexion à la touche Entrée ---------- */
{
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });
  await tape(page, "connexion par Entrée -> compte affiché", async () => {
    await page.evaluate(() => window.mgsShowPage("connexion"));
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
    await page.locator("#em").fill(EMAIL);
    await page.locator("#pw").fill(PW);
    await page.locator("#pw").press("Enter");
    await attendreCompte(page);
  });
  await tape(page, "déconnexion -> invité, pill points masqué", async () => {
    await page.locator('.mgs-page[data-page=compte] a.button-main', { hasText: "Déconnexion" }).click();
    await page.waitForTimeout(2000);
    const invite = await page.evaluate(() => {
      const pill = document.querySelector(".nav-points-pill");
      return getComputedStyle(pill).display === "none";
    });
    if (!invite) throw new Error("la pill points reste visible");
  });
  await ctx.close();
}

/* ---------- 2. inscription ---------- */
{
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const email = `inscription+${Date.now().toString(36)}@example.com`;
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });
  await tape(page, "inscription (onglet) -> connecté", async () => {
    await page.evaluate(() => window.mgsShowPage("connexion"));
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
    await page.locator('.mgs-page[data-page=connexion] .mgs-tab').nth(1).click();
    await page.waitForTimeout(400);
    await page.locator("#em").fill(email);
    await page.locator("#pw").fill("Inscription1");
    await page.locator("#reg-name").fill("Inscrit Test");
    await page.locator('a[data-nav="compte"]', { hasText: "Créer le compte" }).click();
    await attendreCompte(page);
  });
  await ctx.close();
  mongo(`db.users.deleteOne({email:"${email}"})`);
}

/* ---------- 3. mot de passe oublié + réinitialisation au jeton ---------- */
{
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });
  await tape(page, "mot de passe oublié : demande envoyée (statut visible)", async () => {
    await page.evaluate(() => window.mgsShowPage("connexion"));
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
    await page.locator('a[data-nav="mdp"]').click();
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "mdp", null, { timeout: 10000 });
    await page.locator("#fpe").fill(EMAIL);
    await page.locator("#fpe").press("Enter");
    await page.waitForFunction(() => { const s = document.querySelector("#mdp-status"); return s && s.textContent.trim().length > 5; }, null, { timeout: 15000 });
  });
  await tape(page, "réinitialisation au jeton -> mot de passe changé, connexion au nouveau", async () => {
    const token = "jeton-test-" + crypto.randomBytes(8).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const uid = mongo(`db.users.findOne({email:"${EMAIL}"},{user_id:1}).user_id`);
    mongo(`db.auth_tokens.deleteMany({user_id:"${uid}",purpose:"reset_password"});db.auth_tokens.insertOne({token_hash:"${hash}",user_id:"${uid}",purpose:"reset_password",expires_at:new Date(Date.now()+1800000),created_at:new Date().toISOString(),used_at:null})`);
    const nouveau = "NouveauDemo123";
    await page.evaluate((t) => { location.href = "/reset?reset=" + t; }, token);
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "reset", null, { timeout: 15000 });
    await page.locator("#rp-pass").fill(nouveau);
    await page.locator("#rp-confirm").fill("pas-le-meme");
    await page.locator(".mgs-reset-send").click();
    await page.waitForFunction(() => { const s = document.querySelector("#reset-status"); return s && /correspondent|match/i.test(s.textContent); }, null, { timeout: 8000 });
    await page.locator("#rp-confirm").fill(nouveau);
    await page.locator(".mgs-reset-send").click();
    await page.waitForFunction(() => { const s = document.querySelector("#reset-status"); return s && /modifié|changed/i.test(s.textContent); }, null, { timeout: 15000 });
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
    await page.locator("#em").fill(EMAIL);
    await page.locator("#pw").fill(nouveau);
    await page.locator("#pw").press("Enter");
    await attendreCompte(page);
    // remet le mot de passe de démo en place
    const token2 = "jeton-test-" + crypto.randomBytes(8).toString("hex");
    const hash2 = crypto.createHash("sha256").update(token2).digest("hex");
    mongo(`db.auth_tokens.deleteMany({user_id:"${uid}",purpose:"reset_password"});db.auth_tokens.insertOne({token_hash:"${hash2}",user_id:"${uid}",purpose:"reset_password",expires_at:new Date(Date.now()+1800000),created_at:new Date().toISOString(),used_at:null})`);
    await page.evaluate((t) => { location.href = "/reset?reset=" + t; }, token2);
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "reset", null, { timeout: 15000 });
    await page.locator("#rp-pass").fill(PW);
    await page.locator("#rp-confirm").fill(PW);
    await page.locator(".mgs-reset-send").click();
    await page.waitForFunction(() => { const s = document.querySelector("#reset-status"); return s && /modifié|changed/i.test(s.textContent); }, null, { timeout: 15000 });
    mongo(`db.auth_tokens.deleteMany({user_id:"${uid}",purpose:"reset_password"})`);
  });
  await ctx.close();
}

/* ---------- 4. garde invité ---------- */
{
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });
  await tape(page, "garde invité (390 px) : /compte -> connexion", async () => {
    await page.evaluate(() => window.mgsShowPage("compte"));
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 15000 });
    await page.evaluate(() => window.mgsShowPage("points"));
    await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 15000 });
  });
  await ctx.close();
}

await nav.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (echecs.length) { console.log("Échecs : " + echecs.join(" | ")); }
process.exit(fail ? 1 : 0);
