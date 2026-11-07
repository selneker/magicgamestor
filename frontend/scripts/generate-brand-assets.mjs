#!/usr/bin/env node
/**
 * Génération des icônes de marque depuis logo-master.svg (PL-BRAND-1).
 *
 * Aucune dépendance ajoutée : rasterisation via playwright-core (devDependency)
 * + le Chromium du système (CHROMIUM_PATH), comme scripts/audit-contrast.mjs.
 * Le favicon.ico est assemblé par PIL (python3, présent sur la machine).
 *
 * Usage : cd frontend && CHROMIUM_PATH=/chemin/vers/chrome node scripts/generate-brand-assets.mjs
 *
 * Palette de marque : noir #000000, lime #CBFE01, sable #E9E2D8, blanc #FFFFFF.
 */

import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

const LIME = "#CBFE01";
const SAND = "#E9E2D8";
const BLACK = "#000000";

const master = readFileSync(join(root, "src", "assets", "logo-master.svg"), "utf8");
// Le disque plein (sans le trou étoile) pour les variantes à étoile colorée :
// on remplace le chemin evenodd par le cercle, puis on dessine l'étoile lime dessus.
const discOnly = `<circle cx="415" cy="415" r="415" fill="${BLACK}"/>`;
const starPath = "M415 0A415 415 0 0 0 830 415A415 415 0 0 0 415 830A415 415 0 0 0 0 415A415 415 0 0 0 415 0Z";
const star = `<path d="${starPath}" fill="${LIME}"/>`;

// Variantes :
//  - "master"  : disque noir + étoile transparente (le logo lui-même).
//  - "branded" : fond sable + disque noir + étoile lime (icônes carrées).
function svg(inner, { bg = null, scale = 1, cx = 415, cy = 415 } = {}) {
  // Mise à l'échelle AUTOUR du centre du viewBox (sinon le disque part vers
  // le coin haut-gauche) : translate(c) scale(s) translate(-c).
  const t = `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 830 830">
    ${bg ? `<rect width="830" height="830" fill="${bg}"/>` : ""}
    <g transform="${t}">${inner}</g>
  </svg>`;
}

const assets = [
  // Icônes PWA générales : fond sable, disque noir à 86 %, étoile lime.
  // `bg` = fond du conteneur de capture (le rect SVG ne couvre que le viewBox ;
  // pour l'og-image paysage, le sable doit remplir tout le 1200×630).
  { name: "icon-192.png", size: 192, bg: SAND, svg: svg(discOnly + star, { bg: SAND, scale: 0.86 }) },
  { name: "icon-512.png", size: 512, bg: SAND, svg: svg(discOnly + star, { bg: SAND, scale: 0.86 }) },
  // Maskable : toute la zone est fond sable, le disque tient dans la zone sûre
  // de 80 % (cible r=0.4*512 → disque d ≈ 0.78*512).
  { name: "icon-512-maskable.png", size: 512, bg: SAND, svg: svg(discOnly + star, { bg: SAND, scale: 0.76 }) },
  // Apple touch : marge de sécurité plus large (coins arrondis par l'OS).
  { name: "apple-touch-icon.png", size: 180, bg: SAND, svg: svg(discOnly + star, { bg: SAND, scale: 0.72 }) },
  // Og-image 1200×630 : logo centré sur fond sable.
  { name: "og-image.png", size: 0, canvas: [1200, 630], bg: SAND, svg: svg(discOnly + star, { bg: SAND, scale: 0.42 }) },
  // Icône de notification push : monochrome (disque noir, étoile transparente),
  // lisible à 96×96 ; Android n'utilise que l'alpha → silhouette correcte.
  { name: "push-icon-192.png", size: 192, svg: master, transparent: true },
  { name: "badge-72.png", size: 72, svg: master, transparent: true },
  // Source du favicon.ico (32 px, fond transparent).
  { name: "_favicon-32.png", size: 32, svg: master, transparent: true },
];

const chromiunPath = process.env.CHROMIUM_PATH;
if (!chromiunPath) {
  console.error("CHROMIUM_PATH requis (le script ne télécharge rien).");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: chromiunPath });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 1 });

for (const asset of assets) {
  const [w, h] = asset.canvas || [asset.size, asset.size];
  await page.setContent(
    `<!doctype html><style>html,body{margin:0}</style><div id="t" style="width:${w}px;height:${h}px;overflow:hidden;background:${asset.bg || "transparent"}">${asset.svg.replace('viewBox="0 0 830 830"', `viewBox="0 0 830 830" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"`)}</div>`
  );
  const el = page.locator("#t");
  await el.screenshot({
    path: join(publicDir, asset.name),
    omitBackground: Boolean(asset.transparent),
  });
  console.log("✓", asset.name, `${w}×${h}`);
}

await browser.close();

// favicon.ico : 16+32+48 embarqués, depuis le PNG 32 transparent.
execFileSync("python3", [
  "-c",
  `from PIL import Image
im = Image.open(${JSON.stringify(join(publicDir, "_favicon-32.png"))})
im.save(${JSON.stringify(join(publicDir, "favicon.ico"))}, sizes=[(16, 16), (32, 32), (48, 48)])
print("✓ favicon.ico")`,
]);
execFileSync("rm", ["-f", join(publicDir, "_favicon-32.png")]);
console.log("Terminé.");
