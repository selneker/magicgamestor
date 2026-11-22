#!/usr/bin/env node
/**
 * demo-server.mjs — sert `frontend/public` pour l'essai local (PL-FE-009, phase 1).
 *
 * Pourquoi : le prototype lit `window.MGS_BACKEND_URL` au chargement
 * (`public/index.html` : `var BACKEND = (window.MGS_BACKEND_URL || "<prod>")`).
 * On injecte donc cette variable **au vol**, dans le HTML renvoyé, sans jamais
 * modifier le fichier `public/index.html` ni le build.
 *
 * Noms d'hôte : on sert sur 127.0.0.1 et le backend uvicorn aussi, donc la page et
 * l'API sont **same-site** (même hôte) : les cookies de session (`Secure`,
 * `SameSite=Lax`) sont acceptés et renvoyés. Voir `scripts/demo-local.sh`.
 *
 * Lancer :
 *   node frontend/scripts/demo-server.mjs --port 5180 --backend http://127.0.0.1:8010
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(__dirname, "..", "public"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const PORT = Number(arg("port", 5180));
const BACKEND = String(arg("backend", "http://127.0.0.1:8010")).replace(/\/+$/, "");
const INJECT = `<script>window.MGS_BACKEND_URL=${JSON.stringify(BACKEND)};</script>\n`;

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/__demo/config") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ backend: BACKEND, port: PORT, root: ROOT }));
    return;
  }
  if (url === "/__demo/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("ok");
    return;
  }

  const rel = decodeURIComponent(url);
  let fp = path.normalize(path.join(ROOT, rel));
  if (fp !== ROOT && !fp.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403");
    return;
  }
  if (rel === "/" || rel.endsWith("/")) fp = path.join(fp, "index.html");
  // SPA : toute URL sans extension (routage du prototype, ex. /compte) retombe sur index.html
  const candidates = path.extname(fp) ? [fp] : [fp, path.join(ROOT, "index.html")];

  const essai = (i) => {
    if (i >= candidates.length) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    fs.readFile(candidates[i], (err, data) => {
      if (err) { essai(i + 1); return; }
      sertHtmlOuFichier(res, candidates[i], data);
    });
  };
  essai(0);
});

function sertHtmlOuFichier(res, fp, data) {
  const ext = path.extname(fp).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const headers = { "Content-Type": type, "Cache-Control": "no-store" };
  if (ext === ".html") {
    // Injection AVANT le premier <script> du prototype (qui lit la variable au chargement).
    const html = data.toString("utf8").replace(/<head\b[^>]*>/i, (m) => m + "\n" + INJECT);
    res.writeHead(200, headers);
    res.end(html);
    return;
  }
  res.writeHead(200, headers);
  res.end(data);
}

server.on("error", (e) => {
  console.error(`[demo-server] impossible d'écouter sur le port ${PORT} : ${e.code || e.message}`);
  process.exit(2);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[demo-server] http://127.0.0.1:${PORT}/  ->  backend ${BACKEND}`);
});
