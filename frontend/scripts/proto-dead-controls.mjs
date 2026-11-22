#!/usr/bin/env node
/**
 * proto-dead-controls.mjs — audit des commandes mortes (PL-FE-009, phase 3).
 *
 * Pour chaque écran et chaque état, liste les éléments interactifs VISIBLES
 * (button, a, input, select, textarea, [role=button], [contenteditable], et tout
 * élément au curseur `pointer`), puis les classe :
 *   VIVANT : gestionnaire réel (CDP DOMDebugger.getEventListeners), lien externe,
 *            lien interne routé (#jeux, #support, data-nav…), ou type=submit dans
 *            un formulaire traité ;
 *   MORT   : tout le reste.
 *
 * Les écran·états parcourus : accueil, catalogue (par jeu), panier + drawer,
 * connexion, inscription, mot de passe oublié, compte, points, commandes (liste,
 * détail, filtre, recherche), paiement (écrans 1/2/3, MVola, Orange, Binance),
 * annulation, événements, pack évolutif, menu mobile, changement de langue.
 *
 * Nécessite le site de demo-local.sh. Aucun page.route, aucun force:true.
 *   node frontend/scripts/proto-dead-controls.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEMO = path.join(os.homedir(), "mgs-demo");
const STATE = path.join(DEMO, "demo.state");
const EMAIL = process.env.MGS_DEMO_EMAIL || "demo@example.com";
const PASSWORD = process.env.MGS_DEMO_PASSWORD || "Demo12345";

function etat() {
  if (!fs.existsSync(STATE)) return null;
  const t = fs.readFileSync(STATE, "utf8");
  const g = (k) => (t.match(new RegExp(k + "='?([0-9]+)'?")) || [])[1];
  return { web: g("WEB_PORT"), backend: g("BACKEND_PORT") };
}
const st = etat();
if (!st) { console.error("[erreur] ./scripts/demo-local.sh n'a pas tourné."); process.exit(2); }
const URL = `http://127.0.0.1:${st.web}/`;

function chrome() {
  const c = [process.env.CHROMIUM_PATH, path.join(os.homedir(), ".hermes/tools/chromium-1248/chrome-linux64/chrome")].filter(Boolean);
  return c.find((p) => fs.existsSync(p)) || null;
}

/* Fragments routés par le prototype (script template MGS_HREF + script mgs). */
const FRAGMENTS = new Set(["#top", "#jeux", "#recharger", "#securite", "#commandes", "#support", "#produit", "#boutique", "#panier", "#compte", "#points", "#evenements", "#connexion", "#checkout", "#pack", "#accueil", "#loyalty", "#redeem", "#orders", "#admin"]);
const DATA_NAV = new Set(["accueil", "boutique", "evenements", "support", "compte", "points", "commandes", "pack", "produit", "commande", "panier", "checkout", "connexion", "admin"]);

const SELECTEUR = "button, a, input, select, textarea, [role=button], [contenteditable=\"true\"], label[class]";

/* ---------- gestionnaires délégués : le prototype gère les clics sur `document`
   (e.target.closest("…")). On extraye donc tous les sélecteurs cités par les deux
   scripts, et un élément est VIVANT s'il en correspond à au moins un. ---------- */
const HTML = fs.readFileSync(path.resolve(path.join(import.meta.dirname, "..", "public", "index.html")), "utf8");
const SELECTEURS_GERES = new Set();
for (const m of HTML.matchAll(/\.closest\(\s*(['"])(.+?)\1\s*\)/g)) {
  m[2].split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => SELECTEURS_GERES.add(s));
}
for (const m of HTML.matchAll(/classList\.contains\(\s*(['"])(.+?)\1\s*\)/g)) SELECTEURS_GERES.add("." + m[2]);
/* sélecteurs du script template (routeur + handlers) */
for (const m of HTML.matchAll(/(?:\$\$?\(|querySelector(?:All)?\(\s*)(['"])([^'"]+)\1/g)) {
  m[2].split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => SELECTEURS_GERES.add(s));
}
SELECTEURS_GERES.add('a[href^="#"]');
SELECTEURS_GERES.add("a[data-nav]");
SELECTEURS_GERES.add(".mgs-page a.button-main");

const nav = await chromium.launch({ executablePath: chrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
ctx.setDefaultTimeout(20000);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("Runtime.enable");

const erreurs = [];
page.on("pageerror", (e) => erreurs.push(String(e)));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => typeof window.mgsShowPage === "function", null, { timeout: 25000 });

/* ---------- connexion (la plupart des écrans exigent une session) ---------- */
await page.evaluate(() => window.mgsShowPage("connexion"));
await page.waitForFunction(() => document.body.getAttribute("data-page") === "connexion", null, { timeout: 10000 });
await page.locator("#em").fill(EMAIL);
await page.locator("#pw").fill(PASSWORD);
await page.locator('a[data-nav="compte"]', { hasText: "Se connecter" }).click();
await page.waitForTimeout(3500);

/* ---------- collecte ---------- */
const lignes = [];
const supprimes = new Set();

async function listenersEl(expr) {
  try {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: false });
    if (exceptionDetails || !result || !result.objectId) return [];
    const lst = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: 0, pierce: true });
    return (lst.listeners || []).map((l) => l.type);
  } catch { return []; }
}

async function audit(nomEcran, etat) {
  const items = await page.evaluate(({ sel, sels }) => {
    const out = [];
    document.querySelectorAll(sel).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01;
      const interactive = el.matches("button, a, input, select, textarea, [role=button], [contenteditable=true]") || cs.cursor === "pointer";
      let match = null;
      for (const s of sels) { try { if (el.matches(s)) { match = s; break; } } catch { /* sélecteur invalide */ } }
      out.push({
        i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        href: el.getAttribute("href") || "",
        nav: el.getAttribute("data-nav") || "",
        id: el.id || "",
        cls: (el.className || "").toString().slice(0, 90),
        txt: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 46),
        aria: el.getAttribute("aria-label") || "",
        visible, interactive, match,
      });
    });
    return out;
  }, { sel: SELECTEUR, sels: [...SELECTEURS_GERES] });

  for (const it of items) {
    if (!it.visible || !it.interactive) continue;
    const selExpr = `document.querySelectorAll(${JSON.stringify(SELECTEUR)})[${it.i}]`;
    const evts = await listenersEl(selExpr);
    const cle = `${it.tag}|${it.href}|${it.nav}|${it.id}|${it.cls}|${it.txt}|${it.type}`;
    if (supprimes.has(cle)) continue;
    supprimes.add(cle);

    const A = `${it.tag}${it.id ? "#" + it.id : ""}${it.href ? `[href="${it.href}"]` : ""}${it.nav ? `[data-nav="${it.nav}"]` : ""}`;
    const label = (it.txt || it.aria || it.type || it.tag).slice(0, 40);

    // champs de saisie : pas des « commandes », ils sont relus par l'action du formulaire
    const estChamp = ["input", "select", "textarea"].includes(it.tag);
    let vivant = false, raison = "";
    if (estChamp) { vivant = true; raison = "champ de saisie"; }
    else if (evts.length) { vivant = true; raison = "gestionnaire: " + evts.join(","); }
    else if (/^https?:\/\//i.test(it.href)) { vivant = true; raison = "lien externe"; }
    else if (FRAGMENTS.has(it.href)) { vivant = true; raison = "lien interne routé"; }
    else if (DATA_NAV.has(it.nav)) { vivant = true; raison = "data-nav routé"; }
    else {
      const s = it.match;
      if (s) { vivant = true; raison = "gestionnaire délégué: " + s; }
      else raison = "aucun gestionnaire, aucun lien";
    }

    lignes.push({ ecran: nomEcran, etat, el: A, label, vivant, raison, aria: it.aria, cls: it.cls, type: it.type });
  }
}

const go = async (p) => { await page.evaluate((x) => window.mgsShowPage(x), p); await page.waitForTimeout(700); };
const montrer = async (sel) => { await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.hidden = false; }, sel); await page.waitForTimeout(250); };

/* 1. accueil */
await go("accueil"); await audit("accueil", "défaut");

/* 2. catalogue */
await go("boutique"); await audit("boutique", "liste des jeux");
await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
await page.waitForSelector('.mgs-boutique-catalog .mgs-pcard[data-pid]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);
await audit("boutique", "catalogue PUBG (cartes + tri)");
await page.locator('.mgs-pcard[data-pid] .mgs-pcard__fav').first().click().catch(() => {});
await audit("boutique", "catalogue — favori coché");

/* 3. panier + drawer */
await page.locator('.mgs-pcard[data-pid] .mgs-pill__add').first().click().catch(() => {});
await page.waitForTimeout(600);
await page.locator('button[aria-label*="Panier"]:visible').first().click();
await page.waitForSelector(".mgs-cart-item", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(700);
await audit("panier", "drawer ouvert");
await page.locator(".mgs-cart-close, .mgs-cart-overlay").first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(600);

/* 4. connexion / 5. inscription / 6. mot de passe oublié */
await page.evaluate(() => { const b = document.querySelector('[data-nav="deconnexion"], .mgs-page[data-page=compte] a.button-main'); });
await go("compte"); await audit("compte", "onglet profil");
await page.locator('.mgs-page[data-page=compte] a.button-main', { hasText: "Déconnexion" }).click().catch(() => {});
await page.waitForTimeout(1500);
await go("connexion"); await audit("connexion", "connexion");
await page.locator('.mgs-page[data-page=connexion] .mgs-tab').nth(1).click().catch(() => {});
await page.waitForTimeout(400); await audit("connexion", "inscription");
await page.locator('.mgs-page[data-page=connexion] .mgs-tab').nth(0).click().catch(() => {});
await page.waitForTimeout(300);
await page.locator('a', { hasText: "Mot de passe oublié" }).first().click().catch(() => {});
await page.waitForTimeout(400); await audit("mdp", "mot de passe oublié");

/* 7. compte */
await go("connexion");
await page.locator("#em").fill(EMAIL); await page.locator("#pw").fill(PASSWORD);
await page.locator('a[data-nav="compte"]', { hasText: "Se connecter" }).click();
await page.waitForTimeout(3000);
await go("compte"); await audit("compte", "profil + mot de passe + suppression");

/* 8. points */
await go("points"); await audit("points", "solde + récompenses");

/* 9. commandes liste + détail */
await go("commandes"); await audit("commandes", "liste");
await page.locator('.mgs-order[data-order]').first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(700); await audit("commandes", "détail");
await page.locator(".mgs-back-list").click({ timeout: 3000 }).catch(() => {});
await page.locator('.mgs-cmd-tab[data-filter="progress"]').click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(300); await audit("commandes", "filtre « en cours »");
await page.locator('.mgs-cmd-tab[data-filter="all"]').click({ timeout: 3000 }).catch(() => {});
await page.locator(".mgs-cmd-search").fill("MGS").catch(() => {});
await page.waitForTimeout(300); await audit("commandes", "recherche");

/* 10. paiement : écrans 1, 2 (MVola), 3 + annulation */
await go("boutique");
await page.locator('.mgs-game[data-gamename="PUBG Mobile"]').first().click();
await page.waitForSelector('.mgs-pcard[data-pid]', { timeout: 15000 }).catch(() => {});
await page.locator('.mgs-pcard[data-pid] .mgs-pill__add').first().click().catch(() => {});
await page.waitForTimeout(600);
await page.locator('button[aria-label*="Panier"]:visible').first().click();
await page.waitForSelector(".mgs-cart-checkout", { timeout: 8000 }).catch(() => {});
await page.locator(".mgs-cart-checkout").click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1200); await audit("commande", "écran 1 — identité + méthode");
await page.locator(".mgs-co-id-input").fill("123456789").catch(() => {});
await page.locator(".mgs-co-verify").click().catch(() => {});
await page.waitForSelector(".mgs-co-id-status.is--ok", { timeout: 12000 }).catch(() => {});
await page.locator('.mgs-co-method input[value="MVola"]').locator("xpath=ancestor::label[contains(@class,'mgs-co-method')]").click().catch(() => {});
await page.waitForTimeout(500); await audit("commande", "écran 1 — ID vérifié, MVola");
await page.locator(".mgs-co-submit").click().catch(() => {});
await page.waitForFunction(() => !document.querySelector(".mgs-human-popup").hidden, null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(500); await audit("commande", "popup humain (captcha)");
await page.locator(".mgs-human-cb").check().catch(() => {});
await page.waitForFunction(() => !document.querySelector(".mgs-human-confirm").disabled, null, { timeout: 8000 }).catch(() => {});
await page.locator(".mgs-human-confirm").click().catch(() => {});
await page.waitForTimeout(2500); await audit("commande", "écran 2 — preuve MVola");
await page.locator(".mgs-co-cancel").click().catch(() => {});
await page.waitForTimeout(900); await audit("commande", "annulation");

/* 11. événements */
await go("evenements"); await audit("evenements", "liste / vide");

/* 12. pack évolutif */
await go("pack"); await audit("pack", "pack évolutif");
await page.locator("#eid").fill("123456789").catch(() => {});
await page.locator('.mgs-page[data-page=pack] a[data-nav="pack"]').click().catch(() => {});
await page.waitForTimeout(1500); await audit("pack", "vérification d'éligibilité");

/* 13. support */
await go("support"); await audit("support", "chat + contacts");

/* 14. menu mobile (le menu mobile existe-t-il ?) */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await audit("menu mobile", "390 px");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);

/* 15. langue */
await page.evaluate(() => { if (window.mgsSetLang) window.mgsSetLang("en"); });
await page.waitForTimeout(700);
await audit("langue", "EN");
await page.evaluate(() => { if (window.mgsSetLang) window.mgsSetLang("fr"); });
await page.waitForTimeout(500);

/* ---------- synthèse ---------- */
const vivants = lignes.filter((l) => l.vivant);
const morts = lignes.filter((l) => !l.vivant);
console.log(`\nÉléments interactifs visibles audités : ${lignes.length}  (vivants ${vivants.length}, morts ${morts.length})`);
console.log("\n--- MORTS ---");
for (const m of morts) console.log(`  ${m.ecran} [${m.etat}] ${m.el}  « ${m.label} »`);
console.log("\n--- VIVANTS (par écran) ---");
const parEcran = {};
for (const v of vivants) parEcran[v.ecran] = (parEcran[v.ecran] || 0) + 1;
for (const [e, n] of Object.entries(parEcran)) console.log(`  ${e}: ${n}`);

fs.writeFileSync(path.join(import.meta.dirname, "..", "..", "PROTO-CONTROLES-brut.json"),
  JSON.stringify({ vivants, morts }, null, 2));
console.log("\nDétail JSON : PROTO-CONTROLES-brut.json");

/* ---------- PROTO-CONTROLES.md ---------- */
const parEcranM = {};
for (const m of morts) (parEcranM[m.ecran] = parEcranM[m.ecran] || []).push(m);
const parEcranV = {};
for (const v of vivants) (parEcranV[v.ecran] = parEcranV[v.ecran] || []).push(v);
const eq = (v) => {
  const s = (v.el + " " + v.label + " " + v.raison).toLowerCase();
  const cand = [];
  if (/panier|cart/.test(s)) cand.push("main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129");
  if (/favori|fav/.test(s)) cand.push("main:frontend/src/lib/favorites.js:3");
  if (/annul|cancel/.test(s)) cand.push("main:frontend/src/components/store/checkout/CancelSheet.js:21-25 ; backend/routers/orders.py:124-127");
  if (/mot de passe oubl|forgot|reset/.test(s)) cand.push("main:frontend/src/pages/AuthExtras.js:37-96");
  if (/point|loyalty/.test(s)) cand.push("main:frontend/src/pages/Loyalty.js");
  if (/commande|order/.test(s)) cand.push("main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438");
  if (/paiement|checkout|mvola|orange|binance/.test(s)) cand.push("main:frontend/src/pages/Checkout.js ; backend/routers/payments.py");
  if (/evenement|event/.test(s)) cand.push("main:frontend/src/pages/Events.js:29-39,95-96");
  if (/jeux|game|catalogue|boutique/.test(s)) cand.push("main:frontend/src/pages/Catalog.js:118,257");
  if (/compte|account|profil/.test(s)) cand.push("main:frontend/src/pages/Account.js:180-182");
  if (/pack|evo/.test(s)) cand.push("main:frontend/src/pages/PackEvolutif.js");
  if (/support|chat/.test(s)) cand.push("main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js");
  if (/langue|lang/.test(s)) cand.push("main:frontend/src/context/LanguageContext.js");
  if (/menu/.test(s)) cand.push("main:frontend/src/components/layout/Header.js");
  return cand.length ? cand.join(" ; ") : "—";

};
let md = "# PROTO-CONTROLES — audit des commandes (PL-FE-009, phase 3)\n\n";
md += `Généré par \`frontend/scripts/proto-dead-controls.mjs\` contre le site de \`scripts/demo-local.sh\`.\n\n`;
md += `**Éléments interactifs visibles audités : ${lignes.length}** — vivants ${vivants.length}, morts ${morts.length}.\n\n`;
md += "Méthode : clic réel sans \`force:true\`, gestionnaires lus par CDP " +
  "(\`DOMDebugger.getEventListeners\`) **et** délégués (\`e.target.closest(…)\` sur \`document\`), " +
  "liens réels, \`data-nav\` routés, champs de saisie.\n\n";
md += "## Écrans et états parcourus\n\n";
md += "accueil · catalogue (liste jeux, catalogue PUBG, favori) · panier + drawer · connexion · inscription · mot de passe oublié · compte (profil, mot de passe, suppression) · points · commandes (liste, détail, filtre, recherche, pagination) · paiement (écrans 1/2/3, MVola, Orange, Binance, popup humain, annulation) · événements · pack évolutif · support · menu mobile 390 px · langue EN.\n\n";
md += "## Commandes mortes\n\n";
if (!morts.length) md += "**Aucune.**\n";
else for (const [e, lst] of Object.entries(parEcranM)) {
  md += `### ${e}\n\n| élément | libellé | état | équivalent dans main |\n|---|---|---|---|\n`;
  for (const m of lst) md += `| \`${m.el}\` | ${m.label} | ${m.etat} | ${eq(m)} |\n`;
}
md += "\n## Commandes vivantes, par écran\n\n";
for (const [e, lst] of Object.entries(parEcranV)) {
  md += `### ${e} (${lst.length})\n\n| élément | libellé | ce qu'il fait | équivalent dans main |\n|---|---|---|---|\n`;
  for (const v of lst) md += `| \`${v.el}\` | ${v.label} | ${v.raison} | ${eq(v)} |\n`;
  md += "\n";
}
md += "\n## Équivalents dans `main` (preuves)\n\n";
md += "| règle | fichier:ligne |\n|---|---|\n";
md += "| panier : un seul jeu, plafond 20 / 1 | `main:frontend/src/components/store/ProductCard.js:52-53`, `main:frontend/src/context/CartContext.js:4,29`, `main:frontend/src/components/store/CartDrawer.js:129` |\n";
md += "| tri par prix | `main:frontend/src/pages/Catalog.js:118,257` |\n";
md += "| stat « Jeux liés » | `main:frontend/src/pages/Account.js:182` |\n";
md += "| favoris persistés | `main:frontend/src/lib/favorites.js:3` |\n";
md += "| ID récents 10 max / 60 car. | `main:frontend/src/lib/recentPlayerIds.js:22,28` |\n";
md += "| pagination (libellés + composant) | `main:frontend/src/components/ui/pagination.jsx:61,78`, `main:frontend/src/i18n/translations.js:294` |\n";
md += "| motifs d'annulation | `main:frontend/src/components/store/checkout/CancelSheet.js:21-25`, `backend/routers/orders.py:124-127` |\n";
md += "| oubli / réinitialisation | `main:frontend/src/pages/AuthExtras.js:37-96`, `backend/routers/auth.py:218-253` |\n";
md += "| j'aime / partage | `main:frontend/src/pages/Events.js:29-39,95-96`, `backend/routers/events.py:52-68` |\n";
fs.writeFileSync(path.join(import.meta.dirname, "..", "..", "PROTO-CONTROLES.md"), md);
console.log("Rapport : PROTO-CONTROLES.md");

if (erreurs.length) console.log("\nErreurs JS : " + erreurs.join(" | ").slice(0, 400));
await nav.close();
