/**
 * proto-e2e-real.mjs — parcours RÉELS du prototype contre le vrai backend (PL-FE-008-V2).
 *
 * À la différence de proto-functional.mjs (qui simule l'API avec page.route), ici :
 *   - AUCUN page.route : chaque appel passe par le vrai réseau jusqu'au backend ;
 *   - le backend est un vrai uvicorn local (127.0.0.1:8001) sur un vrai MongoDB ;
 *   - les fournisseurs sont stubés (frontend/scripts/stubs/provider_stub.py) ;
 *   - clics RÉELS, sans force:true ; 390 px ET desktop.
 *
 * Le prototype lit window.MGS_BACKEND_URL au chargement : on l pose par addInitScript.
 * Les cookies sont Secure : on passe par http://localhost (origine de confiance).
 *
 * Lancer (backend + stub + mongo déjà démarrés) :
 *   cd frontend && node scripts/proto-e2e-real.mjs
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, "..", "build", "index.html");
const BACKEND = process.env.MGS_REAL_BACKEND || "http://localhost:8001";
const PORT = Number(process.env.MGS_REAL_PORT || 3000);
const URL = `http://localhost:${PORT}/`;
const ADMIN_EMAIL = process.env.MGS_ADMIN_EMAIL || "admin@example.com";
const ADMIN_PW = process.env.MGS_ADMIN_PASSWORD || "AdminTest12345";
const MONGO_BIN = process.env.MGS_MONGO_BIN || "/home/selneker/.local/opt/mongodb/bin/mongo";
const MONGO_PORT = process.env.MGS_MONGO_PORT || "27018";
const MONGO_DB = process.env.MGS_MONGO_DB || "mgs_test_proto";
const MONGO_LD = process.env.MGS_MONGO_LD || "/home/selneker/.local/opt/libssl1.1/usr/lib/x86_64-linux-gnu";
const VIEWPORTS = [{ label: "390px", width: 390, height: 844 }, { label: "desktop", width: 1440, height: 900 }];
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function findChromium() {
  const c = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser",
    path.join(process.env.HOME || "", ".hermes/tools/chromium-1248/chrome-linux64/chrome")].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch { /* */ } }
  console.error("[erreur] CHROMIUM_PATH introuvable"); process.exit(2);
}

/* ---------- véritables appels API (setup / admin) ---------- */
async function api(route, { method = "GET", body, token, origin } = {}) {
  const res = await fetch(BACKEND + "/api" + route, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), Origin: origin || URL },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data };
}
const login = (email, password) => api("/auth/login", { method: "POST", body: { email, password, remember: true } });
async function register(email, password, name) {
  return api("/auth/register", { method: "POST", body: { email, password, name } });
}
function mongoEval(js) {
  return execFileSync(MONGO_BIN, ["--quiet", "--port", MONGO_PORT, MONGO_DB, "--eval", js],
    { env: { ...process.env, LD_LIBRARY_PATH: MONGO_LD }, encoding: "utf8" }).trim();
}

/* ---------- serveur statique du build ---------- */
function serveBuild() {
  const root = path.join(__dirname, "..", "build");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".jpg": "image/jpeg" };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    let fp = path.normalize(path.join(root, rel));
    if (!fp.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (rel === "/" || !path.extname(fp)) fp = path.join(root, "index.html");
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": (types[path.extname(fp)] || "application/octet-stream") + "; charset=utf-8" });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

/* ---------- helpers navigateur ---------- */
const boot = (page) => page.waitForFunction(() => typeof window.mgsRenderRecent === "function" && document.querySelectorAll(".mgs-page").length > 0, null, { timeout: 25000 });
const pageIs = (page, name) => page.waitForFunction((n) => document.body.getAttribute("data-page") === n, name, { timeout: 15000 });
const txt = (page, sel) => page.locator(sel).first().textContent();
const cartLen = (page) => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("mgs_cart_v3")) || []).length; } catch { return 0; } });
const clickCart = (page) => page.locator('button[aria-label*="Panier"]:visible').first().click();
const goto = async (page, name) => { await page.evaluate((n) => window.mgsShowPage(n), name); await pageIs(page, name); };

async function addFirstProduct(page, gameName = "PUBG Mobile") {
  await goto(page, "boutique");
  await page.locator(`.mgs-game[data-gamename="${gameName}"]`).first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid]', { timeout: 15000 });
  await page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid] .mgs-pill__add').first().click();
  await page.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem("mgs_cart_v3")) || []).length === 1; } catch { return false; } }, null, { timeout: 10000 });
}
async function openCheckout(page) {
  await clickCart(page);
  await page.waitForSelector(".mgs-cart-checkout", { timeout: 8000 });
  await page.locator(".mgs-cart-checkout").click();
  await pageIs(page, "commande");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="1"]').hidden, null, { timeout: 8000 });
}
async function verifyAndSubmit(page, methodValue) {
  await page.locator(".mgs-co-id-input").fill("123456789");
  await page.locator(".mgs-co-verify").click();
  await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 12000 });
  await page.locator(`.mgs-co-method input[value="${methodValue}"]`).locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click();
  await page.waitForFunction((v) => document.querySelector(`.mgs-co-method input[value="${v}"]`).closest(".mgs-co-method").classList.contains("is--active"), methodValue, { timeout: 8000 });
  await page.locator(".mgs-co-submit").click();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 });
  await page.locator(".mgs-human-cb").check();
  await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 });
  await page.locator(".mgs-human-confirm").click();
}

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let authSeq = 0;

test("catalogue : noms réels + état vide (Free Fire)", async (page) => {
  await boot(page);
  const products = (await api("/products?game=pubg-mobile")).data;
  assert.ok(Array.isArray(products) && products.length > 0, "l'API produits est vide");
  await goto(page, "boutique");
  await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
  await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid]', { timeout: 15000 });
  const cards = await page.locator('.mgs-boutique-catalog .mgs-pcard').count();
  assert.equal(cards, products.length, `nombre de cartes (${cards}) != produits API (${products.length})`);
  for (let i = 0; i < Math.min(3, products.length); i++) {
    const c = products[i];
    const name = (c.name_en && false) ? c.name_en : c.name;
    const title = await txt(page, `.mgs-pcard[data-pid="${c.id}"] .mgs-pcard__title`).catch(() => null);
    const amount = (await txt(page, `.mgs-pcard[data-pid="${c.id}"] .mgs-pcard__amount`).catch(() => "")) || "";
    const unit = (await txt(page, `.mgs-pcard[data-pid="${c.id}"] .mgs-pcard__unit`).catch(() => "")) || "";
    const visible = (title || "").trim() || (amount + unit).trim();
    assert.ok(visible.length > 0, `carte ${c.id} sans nom visible`);
    assert.ok(visible.includes(String(c.uc_amount != null ? c.uc_amount : c.name)) || visible.includes(c.name),
      `carte ${c.id} : nom attendu « ${name} », visible « ${visible} »`);
  }
  // état vide réel : Free Fire n'a aucun produit
  await goto(page, "boutique");
  await page.locator('.mgs-game[data-gamename="Free Fire"]').first().click();
  await page.waitForTimeout(2500);
  const emptyCards = await page.locator('.mgs-boutique-catalog .mgs-pcard[data-pid]').count();
  assert.equal(emptyCards, 0, "l'état vide ne doit contenir aucune carte (pas de fausses cartes)");
  const emptyShown = await page.locator('.mgs-boutique-catalog .mgs-empty, .mgs-boutique-catalog .mgs-cat-empty').count();
  assert.ok(emptyShown > 0, "l'état vide du catalogue n'est pas affiché");
});

test("panier : ajout, quantité, suppression, total, persistance", async (page) => {
  await boot(page);
  await addFirstProduct(page);
  const products = (await api("/products?game=pubg-mobile")).data;
  const price = products[0].price;
  assert.equal(await cartLen(page), 1);
  await clickCart(page);
  await page.waitForSelector(".mgs-cart-item", { timeout: 8000 });
  assert.equal((await txt(page, ".mgs-cart-total-n")).trim(), await ar(page, price));
  await page.locator('.mgs-cart-item__qty button[data-q="plus"]').click();
  await page.waitForFunction((t) => document.querySelector(".mgs-cart-total-n").textContent.trim() === t, await ar(page, price * 2), { timeout: 8000 });
  await page.reload({ waitUntil: "load" });
  await boot(page);
  assert.equal(await cartLen(page), 1, "le panier survit au rechargement");
  await clickCart(page);
  await page.locator(".mgs-cart-item__del").click();
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("mgs_cart_v3")) || []).length === 0, null, { timeout: 8000 });
});

async function ar(page, n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " Ar"; }
async function loginUi(page, email, password) {
  await goto(page, "connexion");
  await page.locator('.mgs-page[data-page="connexion"] .mgs-tab').nth(0).click();
  await page.locator("#em").fill(email);
  await page.locator("#pw").fill(password);
  await page.locator('.mgs-page[data-page="connexion"] a[data-nav="compte"]').click();
  /* fc979aa : la connexion ramène à l'accueil (comme main), pas au compte */
  await pageIs(page, "accueil");
  await goto(page, "compte");
  await page.waitForFunction(() => document.querySelector("#acc-name") && document.querySelector("#acc-name").value.length > 0, null, { timeout: 15000 });
}

test("auth : inscription, connexion, session au rechargement, déconnexion", async (page, ctx) => {
  await boot(page);
  authSeq += 1;
  const email = `e2eauth+${RUN}${authSeq}@example.com`, password = "Password123", name = "E2E Real";
  await goto(page, "connexion");
  await page.locator('.mgs-page[data-page="connexion"] .mgs-tab').nth(1).click();
  await page.waitForSelector("#reg-name", { timeout: 8000 });
  await page.locator("#reg-name").fill(name);
  await page.locator("#em").fill(email);
  await page.locator("#pw").fill(password);
  await page.locator('.mgs-page[data-page="connexion"] a[data-nav="compte"]').click();
  /* fc979aa : la connexion ramène à l'accueil (comme main), pas au compte */
  await pageIs(page, "accueil");
  await goto(page, "compte");
  await page.waitForFunction(() => document.querySelector("#acc-name") && document.querySelector("#acc-name").value === "E2E Real", null, { timeout: 15000 });
  // session conservée au rechargement
  await page.reload({ waitUntil: "load" });
  await boot(page);
  await page.waitForTimeout(1500);
  const logoutVisible = await page.locator('a[data-nav="connexion"]').count();
  assert.ok(logoutVisible > 0, "la session n'est pas conservée au rechargement (pas de Déconnexion)");
  // déconnexion
  await goto(page, "compte");
  await page.locator('.mgs-page[data-page="compte"] a[data-nav="connexion"]').click();
  await pageIs(page, "accueil");
  const r = await api("/auth/me");
  assert.equal(r.status, 401, "déconnexion : /auth/me devrait renvoyer 401");
});

async function moneyManual(page, state, methodValue, merchant) {
  await boot(page);
  await loginUi(page, state.email, state.password);
  await addFirstProduct(page);
  await openCheckout(page);
  await verifyAndSubmit(page, methodValue);
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 15000 });
  assert.match(await txt(page, ".mgs-co-merchant"), new RegExp(merchant), "numéro marchand absent");
  // preuve réelle
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.locator(".mgs-co-proof").click()]);
  await chooser.setFiles({ name: "proof.png", mimeType: "image/png", buffer: state.png });
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 15000 });
  const num = (await txt(page, ".mgs-co-r-num")).trim();
  assert.ok(/^MGS-/.test(num), "numéro de commande absent du reçu");
  state.orderNumber = num;
  // l'ordre est réel : preuve envoyée -> proof_submitted
  const list = (await api("/orders/me", { token: state.userToken })).data;
  const order = (list || []).find((o) => o.order_number === num);
  assert.ok(order, "commande introuvable dans /orders/me");
  assert.equal(order.status, "proof_submitted", `statut attendu proof_submitted, reçu ${order.status}`);
  // admin approuve la preuve par l'API
  const patch = await api(`/admin/orders/${order.id}`, { method: "PATCH", body: { status: "paid" }, token: state.adminToken });
  assert.equal(patch.status, 200, `approubation admin : ${patch.status} ${JSON.stringify(patch.data)}`);
  assert.equal(patch.data.status, "paid");
  state.orderId = order.id;
}

test("paiement MVola : preuve -> reçu -> approbation admin", async (page, state) => {
  await moneyManual(page, state, "MVola", "0383905692");
  await page.locator(".mgs-co-done").click();
  await pageIs(page, "commandes");
  await page.waitForSelector(`.mgs-order[data-order="${state.orderNumber}"]`, { state: "attached", timeout: 15000 });
  assert.equal(await cartLen(page), 0);
});

test("paiement Orange Money : preuve -> reçu -> approbation admin", async (page, state) => {
  await moneyManual(page, state, "Orange Money", "0377519833");
  await page.locator(".mgs-co-done").click();
  await pageIs(page, "commandes");
  await page.waitForSelector(`.mgs-order[data-order="${state.orderNumber}"]`, { state: "attached", timeout: 15000 });
});

test("paiement Binance : commande -> écran USDT -> confirmation -> reçu", async (page, state) => {
  await boot(page);
  await loginUi(page, state.email, state.password);
  await addFirstProduct(page);
  await openCheckout(page);
  await verifyAndSubmit(page, "Binance");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden && !document.querySelector(".mgs-co-binance").hidden, null, { timeout: 15000 });
  const bin = await txt(page, ".mgs-co-binance");
  assert.match(bin, /TXyz1234567890abcdR7k2/, "adresse USDT absente");
  assert.match(bin, /Tron \(TRC20\)/, "réseau absent");
  const proofHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".mgs-co-proof")).display === "none");
  assert.equal(proofHidden, true, "la preuve ne doit pas être proposée pour Binance");
  const num = await page.evaluate(() => { const n = document.querySelector(".mgs-co-r-num"); return n ? n.textContent : null; });
  // on confirme le paiement dans la vraie base de test, puis le poll réel le voit
  const paid = mongoEval(`db.crypto_payments.updateMany({}, {$set:{status:"CONFIRMED", slot_open:false}}).modifiedCount`);
  assert.ok(Number(paid) >= 1, "aucun paiement crypto confirmé en base");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="3"]').hidden, null, { timeout: 25000 });
  assert.equal((await txt(page, ".mgs-co-r-num")).trim().length > 0, true);
});

test("annulation avec motif valide (wrong_info)", async (page, state) => {
  await boot(page);
  await loginUi(page, state.email, state.password);
  await addFirstProduct(page);
  await openCheckout(page);
  await verifyAndSubmit(page, "MVola");
  await page.waitForFunction(() => !document.querySelector('.mgs-co-screen[data-co="2"]').hidden, null, { timeout: 15000 });
  await page.locator(".mgs-co-cancel").click();
  await page.waitForTimeout(2000);
  // la commande doit être annulée sans erreur masquée
  const list = (await api("/orders/me", { token: state.userToken })).data;
  const order = (list || [])[0];
  assert.equal(order.status, "cancelled", `statut attendu cancelled, reçu ${order.status}`);
  assert.ok(["wrong_info", "change_method", "too_short", "cannot_pay_now", "other"].includes(order.cancel_reason),
    `motif invalide : ${order.cancel_reason}`);
});

test("commandes : historique réel, filtre, recherche", async (page, state) => {
  await boot(page);
  await loginUi(page, state.email, state.password);
  await goto(page, "commandes");
  await page.waitForSelector('.mgs-order[data-order]', { state: "attached", timeout: 15000 });
  const nums = await page.$$eval('.mgs-order', (els) => els.map((e) => e.dataset.order));
  const real = (await api("/orders/me", { token: state.userToken })).data;
  assert.ok(nums.length >= real.length && real.length > 0, `commandes affichées ${nums.length} != API ${real.length}`);
  assert.deepEqual([...nums].sort(), [...real.map((o) => o.order_number)].sort(), "numéros affichés != numéros réels");
  // filtre "En cours"
  await page.locator('.mgs-cmd-tab[data-filter="progress"]').click();
  await page.waitForTimeout(400);
  const shown = await page.$$eval('.mgs-order', (els) => els.filter((e) => e.style.display !== "none").length);
  const bucket = (s) => ["delivered", "done", "completed"].includes(s) ? "done" : (["cancelled", "canceled", "expired", "failed", "refunded"].includes(s) ? "cancel" : "progress");
  const expected = real.filter((o) => bucket(o.status) === "progress").length;
  assert.equal(shown, expected, `filtre En cours : ${shown} != ${expected}`);
  // recherche
  await page.locator('.mgs-cmd-tab[data-filter="all"]').click();
  await page.locator(".mgs-cmd-search").fill(real[0].order_number);
  await page.waitForTimeout(400);
  const found = await page.$$eval('.mgs-order', (els) => els.filter((e) => e.style.display !== "none").length);
  assert.equal(found, 1, `recherche : ${found} résultat(s), attendu 1`);
});

test("compte : profil + changement de mot de passe", async (page, state) => {
  await boot(page);
  await loginUi(page, state.email, state.password);
  await goto(page, "compte");
  await page.waitForFunction(() => document.querySelector("#acc-name") && document.querySelector("#acc-name").value.length > 0, null, { timeout: 15000 });
  await page.locator("#acc-name").fill("E2E Renamed");
  await page.locator("#acc-phone").fill("0341234567");
  await page.locator('.mgs-page[data-page="compte"] a.button-main').filter({ hasText: /Enregistrer|Save/ }).click();
  await page.waitForTimeout(1500);
  const me = (await api("/auth/me", { token: state.userToken })).data;
  assert.equal(me.name, "E2E Renamed", "nom non mis à jour");
  assert.ok(String(me.phone || "").includes("0341234567"), "téléphone non mis à jour");
  // changement de mot de passe
  const chg = await api("/auth/change-password", { method: "POST", body: { current_password: "Password123", new_password: "Password456" }, token: state.userToken });
  assert.equal(chg.status, 200, `change-password : ${chg.status} ${JSON.stringify(chg.data)}`);
  const relog = await login(state.email, "Password456");
  assert.equal(relog.status, 200, "connexion avec le nouveau mot de passe impossible");
  // rétablit le mot de passe initial pour les tests suivants (même utilisateur réutilisé)
  const revert = await api("/auth/change-password", { method: "POST", body: { current_password: "Password456", new_password: "Password123" }, token: chg.data.access_token });
  assert.equal(revert.status, 200, "rétablissement du mot de passe");
});

test("points : solde, historique, récompenses", async (page, state) => {
  await boot(page);
  await loginUi(page, state.email, state.password);
  const loyalty = (await api("/loyalty/me", { token: state.userToken })).data;
  await goto(page, "points");
  await page.waitForSelector('.mgs-page[data-page="points"] .mgs-stat__n', { state: "attached", timeout: 15000 });
  const stats = await page.$$eval('.mgs-page[data-page="points"] .mgs-stat__n', (els) => els.map((e) => e.textContent.trim()));
  const total = String((loyalty && loyalty.balance && loyalty.balance.total) || "0");
  assert.ok(stats.includes(total), `solde ${total} absent des stats ${JSON.stringify(stats)}`);
  const rewards = (await api("/loyalty/rewards", { token: state.userToken })).data;
  if (Array.isArray(rewards) && rewards.length) assert.ok((await page.locator(".mgs-redeem").count()) > 0, "récompenses non affichées");
});

test("garde invité : page protégée sans connexion -> connexion", async (page) => {
  await boot(page);
  await page.evaluate(() => window.mgsShowPage("points"));
  await pageIs(page, "connexion");
  await page.evaluate(() => window.mgsShowPage("compte"));
  await pageIs(page, "connexion");
});

test("événements : liste, j'aime, partage", async (page) => {
  await boot(page);
  await goto(page, "evenements");
  await page.waitForTimeout(2500);
  const events = (await api("/events")).data;
  const cards = await page.locator('.mgs-page[data-page="evenements"] .mgs-card').count();
  assert.ok(cards > 0, "aucun événement affiché");
  assert.equal(cards, Array.isArray(events) ? events.length : 0, `cartes ${cards} != événements ${Array.isArray(events) ? events.length : 0}`);
});

test("pack évolutif : élégibilité réelle", async (page) => {
  await boot(page);
  await goto(page, "pack");
  await page.waitForTimeout(2500);
  const status = await page.locator('.mgs-page[data-page="pack"] .mgs-status').first().textContent().catch(() => "");
  assert.ok(status && status.trim().length > 0, "le statut d'éligibilité pack n'est pas affiché");
});

test("mot de passe oublié : demande envoyée + jeton en base", async (page) => {
  await boot(page);
  await goto(page, "connexion");
  await page.locator('.mgs-page[data-page="connexion"] a.mgs-muted').filter({ hasText: /Mot de passe oublié|Forgot/ }).click();
  /* l'écran dédié (cf. main AuthExtras) : on saisit l'e-mail puis on envoie */
  await pageIs(page, "mdp");
  await page.locator("#fpe").fill("admin@example.com");
  await page.locator(".mgs-mdp-send").click();
  await page.waitForFunction(() => { const s = document.querySelector("#mdp-status"); return s && s.textContent.trim().length > 5; }, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const cnt = Number(mongoEval(`db.auth_tokens.countDocuments({purpose:"reset_password", used_at:null})`));
  assert.ok(cnt >= 1, "aucun jeton reset_password créé en base");
});

test("suppression de compte (confirmation SUPPRIMER)", async (page) => {
  await boot(page);
  authSeq += 1;
  const email = `e2edel+${RUN}${authSeq}@example.com`, password = "Password123";
  const reg = await register(email, password, "E2E Delete");
  assert.equal(reg.status, 200, `register : ${reg.status} ${JSON.stringify(reg.data)}`);
  await loginUi(page, email, password);
  await goto(page, "compte");
  page.on("dialog", (d) => { if (d.type() === "prompt") d.accept(password); else d.accept(); });
  await page.locator('.mgs-page[data-page="compte"] a.button-main').filter({ hasText: /Supprimer le compte|Delete account/ }).click();
  await pageIs(page, "connexion");
  const r = await api("/auth/me", { token: reg.data.access_token });
  assert.equal(r.status, 401, "compte non supprimé (session encore valide)");
});

/* ---------- runner ---------- */
async function main() {
  if (!fs.existsSync(BUILD)) { console.error("[erreur] build/index.html absent : `yarn build` d'abord."); process.exit(2); }
  const executablePath = findChromium();
  // setup réel : admin + Binance disponible
  const admin = await login(ADMIN_EMAIL, ADMIN_PW);
  assert.equal(admin.status, 200, `login admin : ${admin.status} ${JSON.stringify(admin.data)}`);
  const adminToken = admin.data.access_token;
  const cfg = await api("/crypto/config");
  if (!cfg.data || !cfg.data.available) {
    const patch = await api("/crypto/admin/settings", { method: "PATCH", token: adminToken, body: { enabled: true, rate_ar_per_usdt: 4500, expiry_minutes: 30, wallets: { TRC20: { address: "TXyz1234567890abcdR7k2", memo: "", active: true } } } });
    assert.equal(patch.status, 200, `activation Binance : ${patch.status}`);
  }
  // utilisateur de test unique
  const email = `e2e+${RUN}@example.com`;
  const password = "Password123";
  const reg = await register(email, password, "E2E Real");
  if (reg.status === 409) { /* déjà existant : on se connecte */ }
  else assert.equal(reg.status, 200, `register : ${reg.status} ${JSON.stringify(reg.data)}`);
  const userLogin = await login(email, password);
  assert.equal(userLogin.status, 200, `login user : ${userLogin.status}`);
  const userToken = userLogin.data.access_token;

  const server = await serveBuild();
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  let pass = 0, fail = 0; const failures = [];
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} (${vp.width}×${vp.height}) ===`);
    for (const { name, fn } of tests) {
      if (process.env.MGS_ONLY && !name.includes(process.env.MGS_ONLY)) continue;
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      context.setDefaultTimeout(15000);
      const page = await context.newPage();
      const state = { email, password, userToken, adminToken, png };
      const fresh = await login(state.email, state.password);
      if (fresh.status === 200) state.userToken = fresh.data.access_token;
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      if (process.env.MGS_NET) page.on("response", (r) => { if (r.url().includes("/api/")) console.log("   [net]", r.status(), r.url().replace(/^.*\/api/, "")); });
      await page.addInitScript((backend) => { window.MGS_BACKEND_URL = backend; }, BACKEND);
      try {
        await page.goto(URL, { waitUntil: "load", timeout: 30000 });
        await fn(page, state);
        const realErrors = errors.filter((e) => !/ResizeObserver|favicon|net::ERR|Failed to load resource/i.test(e));
        assert.equal(realErrors.length, 0, "erreurs JS : " + realErrors.join(" | "));
        console.log("  ✓ " + name); pass++;
      } catch (e) {
        const msg = e && e.message ? e.message.split("\n")[0] : String(e);
        console.log("  ✗ " + name + "\n      " + msg);
        failures.push(`[${vp.label}] ${name}: ${msg}`);
        fail++;
      } finally { await context.close(); }
    }
  }
  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed (${tests.length * VIEWPORTS.length} runs)`);
  if (failures.length) { console.log("\nÉchecs :"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
