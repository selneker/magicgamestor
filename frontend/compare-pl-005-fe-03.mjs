#!/usr/bin/env node
// PL-005-FE-03 — montages côte à côte maquette (gauche) vs site (droite).
// Simple <img> mis côte à côte dans une page HTML capturée par Chromium.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROMIUM = process.argv[2];
const DIR = "/home/selneker/Projects/GameStore/magicgamestor/repports/captures/PL-005-FE-03";
mkdirSync(DIR, { recursive: true });
const pairs = [
  ["maquette-accueil-1440.png", "home-1440-light.png", "compare-accueil-1440-clair.png", 1400],
  ["maquette-accueil-390.png", "home-390-light.png", "compare-accueil-390-clair.png", 380],
  ["home-390-light.png", "home-390-dark.png", "compare-accueil-390-clair-sombre.png", 380],
];
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const pg = await browser.newPage();
const { writeFileSync } = await import("node:fs");
for (const [left, right, out, colW] of pairs) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#222;font:12px sans-serif;color:#eee}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
    figure{margin:0}img{width:100%;display:block}figcaption{padding:4px 6px}
  </style></head><body><div class="row">
    <figure><img src="${left}"><figcaption>MAQUETTE PL-DS-003</figcaption></figure>
    <figure><img src="${right}"><figcaption>SITE (branche feat/design-system-base)</figcaption></figure>
  </div></body></html>`;
  const page = join(DIR, "_compare.html");
  writeFileSync(page, html);
  await pg.goto(`file://${page}`);
  await pg.setViewportSize({ width: colW * 2 + 24, height: 1000 });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: join(DIR, out), fullPage: false });
  console.log("✓", out);
}
await browser.close();
