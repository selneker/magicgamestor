#!/usr/bin/env node
/**
 * inject-turnstile-key.mjs — insère la SITE KEY publique Cloudflare Turnstile
 * dans build/index.html (prototype statique), depuis l'environnement de build.
 *
 * Pourquoi ce script existe : public/index.html est copié VERBATIM par CRA
 * dans build/. Ce n'est pas un template : CRA ne remplace que %PUBLIC_URL% et
 * n'inline les REACT_APP_* que dans le bundle JS (react-scripts/config/env.js).
 * La valeur du <meta name="mgs-turnstile-sitekey"> est donc celle du fichier
 * source — jamais celle posée dans l'environnement de l'hôte (Render). Une clé
 * configurée dans Render restait sans effet sur la page servie ; ce script
 * la fait atterrir dans le HTML livré.
 *
 * Lancé en `postbuild` (donc aussi par `yarn build` sur l'hôte). Ordre de
 * lecture aligné sur CRA : process.env d'abord, puis les fichiers .env de
 * production, le premier qui DÉFINIT la variable gagnant.
 *
 * Sans clé : le fichier n'est pas modifié et un avertissement explicite est
 * écrit (la page part alors avec la valeur du fichier source, qui peut être la
 * clé de TEST Cloudflare). Le build n'échoue pas : une page sans CAPTCHA reste
 * préférable à un déploiement bloqué.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(FRONTEND_DIR, "build", "index.html");

/* Noms acceptés : REACT_APP_* est celui que lit le bundle React (admin) ; le
 * prototype statique n'a pas de préfixe imposé, on tolère les deux. */
const VAR_NAMES = ["REACT_APP_TURNSTILE_SITE_KEY", "TURNSTILE_SITE_KEY"];

/* Même ordre et mêmes noms que react-scripts/config/env.js (mode production). */
const ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env"];

/* Clé de TEST publique Cloudflare (« always passes ») : sa présence en
 * production signifie qu'aucune protection réelle n'est active. */
const TEST_SITE_KEY = "1x00000000000000000000AA";

const META_RE = /(<meta\s+name="mgs-turnstile-sitekey"\s+content=")([^"]*)(")/;

/**
 * Lit une variable dans un fichier .env avec la sémantique de dotenv :
 * `export` toléré, guillemets optionnels, commentaire en fin de ligne ignoré.
 * Renvoie undefined si la variable n'est pas DÉFINIE (même si vide).
 */
function definedInFile(file, name) {
  if (!existsSync(file)) return undefined;
  const prefix = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(prefix);
    if (!match) continue;
    return match[1].trim().replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return undefined;
}

function resolveSiteKey() {
  for (const name of VAR_NAMES) {
    const fromEnv = process.env[name];
    if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  }
  for (const name of VAR_NAMES) {
    for (const file of ENV_FILES) {
      const value = definedInFile(join(FRONTEND_DIR, file), name);
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

function mask(value) {
  if (value.length <= 12) return `${value.slice(0, 4)}… (${value.length} car.)`;
  return `${value.slice(0, 8)}… (${value.length} car.)`;
}

function main() {
  if (!existsSync(TARGET)) {
    console.error(`[turnstile-key] build/index.html introuvable (${TARGET}) — lancez ce script après craco build.`);
    process.exit(1);
  }

  const html = readFileSync(TARGET, "utf8");
  const match = html.match(META_RE);
  if (!match) {
    console.error('[turnstile-key] <meta name="mgs-turnstile-sitekey"> introuvable dans build/index.html.');
    process.exit(1);
  }

  const current = match[2];
  const key = resolveSiteKey();

  if (!key) {
    console.warn(
      "[turnstile-key] REACT_APP_TURNSTILE_SITE_KEY absent de l'environnement et des .env : " +
        `la page livrée garde la clé du fichier source (${current ? mask(current) : "vide"}).` +
        (current === TEST_SITE_KEY ? " C'est la clé de TEST Cloudflare : aucune protection réelle." : ""),
    );
    return;
  }

  if (key === current) {
    console.log(`[turnstile-key] build/index.html déjà à jour (${mask(key)}).`);
    return;
  }

  writeFileSync(TARGET, html.replace(META_RE, `$1${key}$3`), "utf8");
  console.log(`[turnstile-key] site key injectée dans build/index.html : ${mask(key)}.`);
}

main();
