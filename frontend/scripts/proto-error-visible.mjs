#!/usr/bin/env node
/**
 * proto-error-visible.mjs — PREUVE qu'aucune erreur n'est silencieuse (PL-FE-009, phase 2).
 *
 * Requêtes RÉELLES (aucun page.route, aucun force:true), contre le vrai backend
 * local de demo-local.sh :
 *   1. 403 « Origine non autorisée » vu du backend (curl, route guardée par
 *      require_trusted_origin) → HTTP 403 + detail exact.
 *   2. la même origine refusée VUE DU NAVIGATEUR → un message visible s'affiche
 *      (CORS masque le corps : le navigateur reçoit une erreur réseau).
 *   3. réseau coupé (port sans backend) → « Serveur injoignable. Réessayez. »
 *   4. 401 invité → AUCUN toast (l'invité est un état normal, pas une erreur).
 *   5. 403 lisible (compte bloqué, origine autorisée) → message visible.
 *
 *   node frontend/scripts/proto-error-visible.mjs
 */
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEMO = path.join(os.homedir(), "mgs-demo");
const STATE = path.join(DEMO, "demo.state");
const PUBLIC = path.resolve(path.join(import.meta.dirname, "..", "public"));
const MONGOD = path.join(os.homedir(), ".local/opt/mongodb/bin/mongo");
const MONGO_ENV = { ...process.env, LD_LIBRARY_PATH: path.join(os.homedir(), ".local/opt/libssl1.1/usr/lib/x86_64-linux-gnu") };
const mongo = (args) => execFileSync(MONGOD, ["--quiet", "--port", st.mongo, "mgs_demo", "--eval", args], { stdio: "ignore", env: MONGO_ENV });

function etat() {
  if (!fs.existsSync(STATE)) return null;
  const t = fs.readFileSync(STATE, "utf8");
  const get = (k) => (t.match(new RegExp(k + "='?([0-9]+)'?")) || [])[1];
  return { web: get("WEB_PORT"), backend: get("BACKEND_PORT"), mongo: get("MONGO_PORT") };
}
const st = etat();
if (!st) { console.error("[erreur] ./scripts/demo-local.sh n'a pas tourné."); process.exit(2); }
const BACKEND = `http://127.0.0.1:${st.backend}`;
const DEMO_URL = `http://127.0.0.1:${st.web}/`;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function servir(port, backend) {
  const inject = `<script>window.MGS_BACKEND_URL=${JSON.stringify(backend)};</script>\n`;
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    let fp = path.normalize(path.join(PUBLIC, rel));
    if (!fp.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
    if (rel === "/" || rel.endsWith("/")) fp = path.join(fp, "index.html");
    const cands = path.extname(fp) ? [fp] : [fp, path.join(PUBLIC, "index.html")];
    const essai = (i) => {
      if (i >= cands.length) { res.writeHead(404); res.end("404"); return; }
      fs.readFile(cands[i], (e, d) => {
        if (e) { essai(i + 1); return; }
        if (path.extname(cands[i]) === ".html") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(d.toString("utf8").replace(/<head\b[^>]*>/i, (m) => m + "\n" + inject));
        } else {
          res.writeHead(200, { "Content-Type": TYPES[path.extname(cands[i])] || "application/octet-stream" });
          res.end(d);
        }
      });
    };
    essai(0);
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

function chrome() {
  const c = [process.env.CHROMIUM_PATH, path.join(os.homedir(), ".hermes/tools/chromium-1248/chrome-linux64/chrome")].filter(Boolean);
  return c.find((p) => fs.existsSync(p)) || null;
}
const nav = await chromium.launch({ executablePath: chrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let pass = 0, fail = 0; const echecs = [];

async function toastErreur(page) {
  return page.evaluate(() => {
    const w = document.querySelector("div[aria-live='polite']");
    if (!w || !w.lastElementChild) return null;
    const el = w.lastElementChild;
    const bg = (el.style.background || "") + (el.style.backgroundColor || "");
    return /orange|FF7900|255, 121, 0/i.test(bg) ? el.textContent.trim() : null;
  });
}
async function attendreToast(page, ms = 15000) {
  try {
    await page.waitForFunction(() => { const w = document.querySelector("div[aria-live='polite']"); return w && w.lastElementChild; }, null, { timeout: ms });
    return await toastErreur(page);
  } catch { return null; }
}
const condenser = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* ---------- 1. 403 origine vu du backend (curl) ---------- */
try {
  const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Origin: http://127.0.0.1:59999", "-H", "Content-Type: application/json", "-X", "POST", "-d", "{}", BACKEND + "/api/auth/login"], { encoding: "utf8" }).trim();
  const corps = execFileSync("curl", ["-s", "-H", "Origin: http://127.0.0.1:59999", "-H", "Content-Type: application/json", "-X", "POST", "-d", "{}", BACKEND + "/api/auth/login"], { encoding: "utf8" }).trim();
  if (code === "403" && /origine/i.test(corps)) { console.log(`✓ backend : origine refusée -> HTTP 403 ${corps}`); pass++; }
  else { console.log(`✗ backend : origine refusée -> HTTP ${code} ${corps}`); fail++; echecs.push(`backend: ${code} ${corps}`); }
} catch (e) { console.log("✗ backend : " + String(e).split("\n")[0]); fail++; echecs.push("backend: " + e); }

/* ---------- 2. origine refusée vue du navigateur -> message visible ---------- */
{
  const port = 5199; // origine NON listée dans CORS_ORIGINS
  const serveur = await servir(port, BACKEND);
  const page = await nav.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  const txt = condenser(await attendreToast(page));
  if (txt && /serveur|connexion|impossible|unreachable/i.test(txt)) { console.log(`✓ navigateur, origine refusée : message visible « ${txt} »`); pass++; }
  else { console.log(`✗ navigateur, origine refusée : toast = ${JSON.stringify(txt)}`); fail++; echecs.push("origine: " + txt); }
  await page.close(); serveur.close();
}

/* ---------- 3. réseau coupé ---------- */
{
  const port = 5198;
  const serveur = await servir(port, "http://127.0.0.1:9");
  const page = await nav.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  const txt = condenser(await attendreToast(page));
  if (txt === "Serveur injoignable. Réessayez.") { console.log("✓ réseau coupé : « Serveur injoignable. Réessayez. »"); pass++; }
  else { console.log(`✗ réseau coupé : toast = ${JSON.stringify(txt)}`); fail++; echecs.push("réseau: " + txt); }
  await page.close(); serveur.close();
}

/* ---------- 4. 401 invité : aucun toast ---------- */
{
  const page = await nav.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(DEMO_URL, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  const txt = await toastErreur(page);
  if (txt === null) { console.log("✓ 401 invité : aucun toast d'erreur (état normal)"); pass++; }
  else { console.log(`✗ 401 invité : toast inattendu ${JSON.stringify(txt)}`); fail++; echecs.push("401: " + txt); }
  await page.close();
}

/* ---------- 5. 403 lisible (compte bloqué) ---------- */
{
  const email = "bloque403@example.com";
  const pw = "Bloque403";
  // crée le compte pour de vrai (mot de passe haché par le backend), puis le bloque
  execFileSync("curl", ["-s", "-o", "/dev/null", "-X", "POST", BACKEND + "/api/auth/register",
    "-H", "Content-Type: application/json", "-H", "Origin: " + DEMO_URL,
    "-d", JSON.stringify({ email, password: pw, name: "Bloqué" })], { stdio: "ignore" });
  mongo(`db.users.updateOne({email:"${email}"},{$set:{blocked:true}})`);
  const page = await nav.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(DEMO_URL, { waitUntil: "load" }); // origine autorisée : le 403 est lisible
  await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 20000 });
  await page.evaluate(() => window.mgsShowPage("connexion"));
  await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
  await page.locator("#em").fill(email);
  await page.locator("#pw").fill(pw);
  await page.locator('a[data-nav="compte"]', { hasText: "Se connecter" }).click();
  const txt = condenser(await attendreToast(page, 12000));
  if (txt && /bloqué|bloqué/i.test(txt)) { console.log(`✓ 403 lisible (compte bloqué) : « ${txt} »`); pass++; }
  else { console.log(`✗ 403 lisible : toast = ${JSON.stringify(txt)}`); fail++; echecs.push("403 lisible: " + txt); }
  await page.close();
  mongo(`db.users.deleteOne({email:"${email}"})`);
}

await nav.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (echecs.length) { console.log("\nÉchecs :"); echecs.forEach((f) => console.log("  - " + f)); }
process.exit(fail ? 1 : 0);
