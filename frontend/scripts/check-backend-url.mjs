#!/usr/bin/env node
/**
 * Vérifie que REACT_APP_BACKEND_URL est DÉFINIE avant un build de production.
 *
 * Pourquoi : CRA remplace `process.env` par un objet littéral qui ne contient
 * QUE les variables REACT_APP_* présentes dans l'environnement au moment du
 * build (react-scripts/config/env.js:70-100). Si la variable est absente,
 * le bundle produit contient baseURL: "undefined/api" et l'application appelle
 * /undefined/api sur l'origin courant : ecran blanc, aucune erreur affichee.
 *
 * Une valeur VIDE est acceptée : elle produit baseURL: "/api", c'est-a-dire
 * une URL relative, ce qui est le cas legitime "front et API sur le meme
 * domaine". Seule l'ABSENCE de la variable est un defaut de build.
 *
 * Modes :
 *   --strict      echoue (code 1) : utilise par `prebuild`.
 *   --warn        avertit sans bloquer (code 0) : utilise par `prestart`.
 *   --development liste les fichiers .env de developpement (serveur de dev).
 *                 Sans ce drapeau, la liste de PRODUCTION est utilisee.
 *
 * Ordre de lecture, aligne sur CRA (react-scripts/config/env.js:26-34) :
 *   1. process.env (l'environnement de build de l'hote prime toujours)
 *   2. les fichiers .env*, dans l'ordre de CRA, le premier qui DEFINIT la
 *      variable gagnant.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VAR = "REACT_APP_BACKEND_URL";
const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

// Meme ordre et memes noms de fichiers que react-scripts/config/env.js.
const FILES = {
  production: [".env.production.local", ".env.local", ".env.production", ".env"],
  development: [".env.development.local", ".env.local", ".env.development", ".env"],
};
// Le mode est decide par l'appelant, PAS par process.env.NODE_ENV : yarn lance
// le pre-hook dans un processus separe, ou NODE_ENV est undefined, et c'est
// react-scripts qui positionne NODE_ENV dans le SIEN. Deduire le mode de
// NODE_ENV faisait utiliser la liste de developpement a un build de
// production : un .env.production etait ignore (build bloque a tort) et un
// .env.development etait pris en compte alors que CRA l'ignore (le build
// laissait passer le bundle casse). Production par defaut, --development pour
// le serveur de dev.
const mode = process.argv.includes("--development") ? "development" : "production";

/**
 * Cherche la variable dans un fichier .env, avec la semantique de dotenv :
 * `export` tolere, guillemets optionnels, commentaire en fin de ligne ignore.
 * Renvoie undefined si la variable n'est pas DEFINIE (independant de sa valeur).
 */
function definedInFile(file) {
  if (!existsSync(file)) return undefined;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] !== VAR) continue;
    let value = match[2].trim();
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) return quoted[2];
    // Valeur non guilleetee : tout ce qui suit un " #" est un commentaire.
    const comment = value.indexOf(" #");
    if (comment !== -1) value = value.slice(0, comment).trim();
    return value;
  }
  return undefined;
}

const fromProcess = Object.prototype.hasOwnProperty.call(process.env, VAR)
  ? process.env[VAR]
  : undefined;

let fromFile;
let fromFileName;
for (const name of FILES[mode]) {
  const value = definedInFile(join(FRONTEND_DIR, name));
  if (value !== undefined) {
    fromFile = value;
    fromFileName = name;
    break;
  }
}

const source = fromProcess !== undefined ? "l'environnement de build" : `${fromFileName}`;
const value = fromProcess !== undefined ? fromProcess : fromFile;

if (value === undefined) {
  const message = [
    "",
    `[erreur] ${VAR} n'est pas definie.`,
    "",
    "Sans cette variable, le bundle produit contient baseURL: \"undefined/api\" :",
    "axios appelle /undefined/api sur l'origin courant et l'application affiche un",
    "ecran blanc, sans message d'erreur.",
    "",
    "Definissez-la :",
    "  - dans l'environnement de build de l'hote (variable " + VAR + "), ou",
    `  - dans frontend/.env.local :  ${VAR}=https://<votre-hote>`,
    "",
    "Nom de la variable : voir frontend/.env.example",
    "Une valeur vide est acceptee si l'API est servie sur le meme domaine que le",
    "front (le bundle appellera alors /api en relatif).",
    "",
  ].join("\n");
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message.replace("[erreur]", "[avertissement]"));
  process.exit(0);
}

if (value === "") {
  console.log(
    `[info] ${VAR} est definie mais vide (source : ${source}). ` +
    "L'API sera appelee en relatif (/api) sur le domaine courant.",
  );
} else {
  console.log(`[ok] ${VAR} est definie (source : ${source}).`);
}
process.exit(0);
