#!/usr/bin/env node
/**
 * PL-006-T02b — outil de contrôle MANUEL de la source de stock publique.
 *
 * À quoi il sert : répondre hors production à « qu'est-ce que le fournisseur publie en ce
 * moment ? », sans clé, sans compte, sans base. Il lit les blocs JSON-LD `schema.org/Product`
 * des pages produit publiques et affiche un état par SKU.
 *
 * Ce qu'il n'est PAS : la source de production. Il n'est branché sur **rien** (ni cron, ni
 * backend, ni CI) et n'écrit **rien** — ni fichier, ni base. La production lit la même source
 * par `backend/services/shop2topup_stock.py` (T02), qui est le seul code qui compte.
 *
 * Règles reprises de T02, à l'identique :
 *   1. On ne conclut que ce qui est publié : `InStock` → disponible, `OutOfStock` → rupture,
 *      toute autre valeur (ou une valeur absente) ne conclut RIEN — le SKU n'est pas affiché.
 *   2. Aucune exception ne sort d'une page : une page en échec est signalée et compte pour
 *      l'issue du script (code 2), sans interrompre la lecture des autres.
 *   3. La lecture est bornée : 10 s par page, 30 s pour l'ensemble.
 *
 * Le nom du fournisseur n'apparaît que dans cette sortie d'opérateur : aucune chaîne d'ici
 * n'est destinée à un client (règle T02 : les messages clients restent côté backend).
 *
 * Zéro dépendance : `fetch` et `node:util` de Node ≥ 18. Aucune variable d'environnement n'est
 * lue, aucun secret n'est accepté ni demandé.
 *
 * Usage :
 *   node frontend/scripts/scrape-stock.mjs --list
 *   node frontend/scripts/scrape-stock.mjs --slug pubg-mobile
 *   node frontend/scripts/scrape-stock.mjs --slug free-fire/eu --json
 *   node frontend/scripts/scrape-stock.mjs --json > /tmp/stock.json
 *
 * Codes de sortie : 0 = tout est lisible · 2 = au moins une page illisible · 1 = usage.
 */

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const BASE_URL = "https://shop2topup.com";
const LOCALE = "en";

// Identifiable : un relevé qui se présente ne se fait pas passer pour un navigateur.
const USER_AGENT = "MagicGameStore-stock-cli/1.0";

const REQUEST_TIMEOUT_MS = 10_000;
const TOTAL_BUDGET_MS = 30_000;

/**
 * Pages connues, vérifiées le 18/11/2026 (§ 2.3 du plan) : HTTP 200, structure JSON-LD
 * `Product → offers → offers[]`. Les sous-pages Free Fire (`free-fire/eu`, `free-fire/sg`…)
 * sont lisibles de la même façon mais leur URL exacte n'a pas été mesurée une par une :
 * elles ne sont donc **pas** déclarées ici (règle du dépôt : ne jamais inventer d'URL).
 * On les passe à la main : `--slug free-fire/eu`.
 */
const PAGES = [
  ["pubg-mobile", "PUBG Mobile"],
  ["free-fire/mena-direct-topup", "Free Fire — MENA (top-up direct)"],
];

const SCHEMA_PREFIXES = ["https://schema.org/", "http://schema.org/"];
const AVAILABILITY_IN_STOCK = "instock";
const AVAILABILITY_OUT_OF_STOCK = "outofstock";

// `<script>` est un élément « raw text » en HTML : il se termine au premier `</script`,
// quels que soient les guillemets à l'intérieur, et son contenu n'est pas décodé (entités
// comprises). Découper ainsi est donc fidèle, et évite de parser le reste du document.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TYPE_RE = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const USAGE = `Usage :
  node frontend/scripts/scrape-stock.mjs --list
  node frontend/scripts/scrape-stock.mjs --slug <id> [--slug <id>…] [--json]
  node frontend/scripts/scrape-stock.mjs --json

Options :
  --list         liste les pages connues, sans réseau
  --slug <id>    lit une page (répétable) : pubg-mobile, free-fire/mena-direct-topup…
  --json         sortie JSON (SKU + métadonnées) au lieu du tableau lisible ; sans --slug,
                 relève toutes les pages connues
  --help         affiche cette aide

Codes de sortie : 0 = tout lisible · 2 = au moins une page illisible · 1 = usage.`;

/** Traduit une valeur `schema.org` en `true` / `false` / `null` (non conclu). */
function normalizeAvailability(value) {
  if (Array.isArray(value)) {
    // Une liste contradictoire ne conclut rien : « inconnu » plutôt qu'un choix arbitraire.
    const conclusions = new Set(value.map(normalizeAvailability));
    return conclusions.size === 1 ? [...conclusions][0] : null;
  }
  if (typeof value !== "string") return null;
  let text = value.trim();
  const lowered = text.toLowerCase();
  for (const prefix of SCHEMA_PREFIXES) {
    if (lowered.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  text = text.trim().replace(/\/+$/, "").toLowerCase();
  if (text === AVAILABILITY_IN_STOCK) return true;
  if (text === AVAILABILITY_OUT_OF_STOCK) return false;
  return null;
}

/** Contenu brut de chaque `<script type="application/ld+json">`. */
function jsonLdBlocks(html) {
  const blocks = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const attribute = TYPE_RE.exec(match[1]);
    const type = (attribute?.[1] ?? attribute?.[2] ?? attribute?.[3] ?? "")
      .trim()
      .toLowerCase();
    if (type === "application/ld+json") blocks.push(match[2]);
  }
  return blocks;
}

/**
 * Parcourt les offres quel que soit leur imbrication : la page réelle publie
 * `Product.offers` (un `AggregateOffer`) puis `offers[]`, une page peut aussi publier une
 * liste plate. Seuls les nœuds feuilles portant un `sku` sont retenus — c'est ce qui
 * distingue une offre d'un conteneur. Une offre sans `availability` est comptée « inconnue ».
 */
function* iterOffers(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* iterOffers(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.offers !== undefined && node.offers !== null) {
    yield* iterOffers(node.offers);
    return;
  }
  const type = node["@type"];
  if (typeof type === "string" && type.toLowerCase().includes("product")) return;
  if ("sku" in node) yield node;
}

/**
 * Lit une page : `{ states, unknown, warnings }`.
 *
 * `states` ne contient QUE les SKU dont l'état est explicitement publié. Aucune exception
 * n'est levée : un bloc JSON invalide est ignoré (les blocs annexes peuvent être tronqués
 * sans que la partie produit le soit), une page sans JSON-LD rend un `Map` vide.
 */
function parseHtml(html) {
  const states = new Map();
  const unknown = new Map();
  const warnings = [];

  for (const block of jsonLdBlocks(html)) {
    let document;
    try {
      document = JSON.parse(block);
    } catch {
      continue; // bloc annexe invalide : ignoré, la page n'est pas condamnée pour autant
    }

    for (const offer of iterOffers(document)) {
      const sku = typeof offer.sku === "string" ? offer.sku.trim() : "";
      if (!sku) continue;

      const verdict = normalizeAvailability(offer.availability);
      if (verdict === null) {
        let label;
        if (offer.availability === undefined) label = "<absente>";
        else if (typeof offer.availability === "string") label = offer.availability;
        else label = JSON.stringify(offer.availability);
        unknown.set(label, (unknown.get(label) ?? 0) + 1);
        continue;
      }

      const previous = states.get(sku);
      if (previous && previous.available !== verdict) {
        warnings.push(
          `sku ${sku} publié deux fois avec des états contradictoires : le dernier est retenu`,
        );
      }
      states.set(sku, {
        available: verdict,
        name: typeof offer.name === "string" ? offer.name : "",
        price: offer.price ?? null,
        currency: typeof offer.priceCurrency === "string" ? offer.priceCurrency : "",
      });
    }
  }

  return { states, unknown, warnings };
}

/** URL publique d'une page produit à partir de son identifiant (`pubg-mobile`). */
function pageUrl(slug) {
  const cleaned = String(slug).trim().replace(/^\/+|\/+$/g, "");
  return `${BASE_URL}/${LOCALE}/shop/${cleaned}`;
}

async function fetchPage(slug) {
  const response = await fetch(pageUrl(slug), {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

/** Décrit une panne sans jamais laisser fuir d'URL ni de secret : le type et le message. */
function describeError(error) {
  const name = error?.name ?? "Erreur";
  const message = error?.message ?? "";
  if (!message) return name;
  // `Error` n'apporte rien : on garde « HTTP 404 », pas « Error — HTTP 404 ».
  return name === "Error" ? message : `${name} — ${message}`;
}

/**
 * Relève les pages demandées, séquentiellement et sous budget.
 *
 * Une page servie mais sans aucun SKU conclu est un **échec** : la compter en succès
 * masquerait une panne de structure, exactement comme en T02.
 *
 * `budgetMs` n'existe que pour que la garde de budget soit vérifiable hors ligne.
 */
async function readPages(slugs, budgetMs = TOTAL_BUDGET_MS) {
  const result = {
    states: new Map(),
    unknown: new Map(),
    warnings: [],
    pages: [],
    pagesOk: 0,
    pagesFailed: 0,
  };
  const deadline = Date.now() + budgetMs;

  for (const slug of slugs) {
    if (Date.now() >= deadline) {
      result.pages.push({
        slug,
        ok: false,
        error: `budget de ${budgetMs / 1000} s épuisé`,
      });
      result.pagesFailed += 1;
      continue;
    }

    let html;
    try {
      html = await fetchPage(slug);
    } catch (error) {
      // Volontairement large : réseau, DNS, TLS, anti-bot, 5xx, délai dépassé.
      result.pages.push({ slug, ok: false, error: describeError(error) });
      result.pagesFailed += 1;
      continue;
    }

    const page = parseHtml(html);
    if (page.states.size === 0) {
      result.pages.push({ slug, ok: false, error: "aucun SKU conclu (structure changée ?)" });
      result.pagesFailed += 1;
      continue;
    }

    result.pagesOk += 1;
    result.pages.push({ slug, ok: true, skus: page.states.size });
    result.warnings.push(...page.warnings);
    for (const [sku, state] of page.states) result.states.set(sku, state);
    for (const [label, count] of page.unknown) {
      result.unknown.set(label, (result.unknown.get(label) ?? 0) + count);
    }
  }

  return result;
}

function formatPrice(state) {
  if (state.price === null || state.price === undefined || state.price === "") return "";
  return state.currency ? ` (${state.price} ${state.currency})` : ` (${state.price})`;
}

/** Sortie lisible : une ligne par page, puis un SKU par ligne, ruptures d'abord. */
function formatHuman(result) {
  const lines = [];
  for (const page of result.pages) {
    lines.push(
      page.ok
        ? `[ok]   ${page.slug} — ${page.skus} SKU conclu(s)`
        : `[ÉCHEC] ${page.slug} — ${page.error}`,
    );
  }

  const entries = [...result.states.entries()].sort(
    (a, b) => Number(a[1].available) - Number(b[1].available) || a[0].localeCompare(b[0], "en", { numeric: true }),
  );
  if (entries.length > 0) {
    lines.push("");
    const skuWidth = Math.max(3, ...entries.map(([sku]) => sku.length));
    for (const [sku, state] of entries) {
      const verdict = state.available ? "disponible" : "RUPTURE   ";
      lines.push(`${sku.padEnd(skuWidth)}  ${verdict}  ${state.name}${formatPrice(state)}`.trimEnd());
    }
  }

  const available = entries.filter(([, state]) => state.available).length;
  const ruptures = entries.length - available;
  lines.push("");
  lines.push(
    `${result.pagesOk} page(s) lue(s), ${result.pagesFailed} en échec — ` +
      `${entries.length} SKU conclu(s) : ${available} disponible(s), ${ruptures} en rupture`,
  );
  if (result.unknown.size > 0) {
    const detail = [...result.unknown.entries()].map(([label, count]) => `${label} ×${count}`).join(", ");
    lines.push(`Valeurs de disponibilité non concluantes (ignorées) : ${detail}`);
  }
  return lines.join("\n");
}

/** Sortie machine : mêmes informations, sans perdre l'état par page ni les valeurs inconnues. */
function formatJson(result) {
  return JSON.stringify(
    {
      pages_ok: result.pagesOk,
      pages_failed: result.pagesFailed,
      pages: result.pages,
      unknown_availability: Object.fromEntries(result.unknown),
      states: Object.fromEntries(result.states),
      warnings: result.warnings,
    },
    null,
    2,
  );
}

async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        list: { type: "boolean", default: false },
        slug: { type: "string", multiple: true, default: [] },
        json: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`Argument invalide : ${error.message}\n`);
    console.error(USAGE);
    return 1;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  if (values.list && values.slug.length > 0) {
    console.error("--list et --slug ne se combinent pas.\n");
    console.error(USAGE);
    return 1;
  }

  if (values.list) {
    if (values.json) {
      console.log(JSON.stringify(PAGES.map(([slug, label]) => ({ slug, url: pageUrl(slug), label })), null, 2));
      return 0;
    }
    for (const [slug, label] of PAGES) {
      console.log(`${slug.padEnd(32)} ${label}`);
    }
    console.log(
      "\nPour lire une autre sous-page, passer son identifiant : --slug free-fire/eu\n" +
        "\nCodes de sortie : 0 = tout lisible · 2 = au moins une page illisible · 1 = usage.",
    );
    return 0;
  }

  // Un même slug passé deux fois ne doit pas être lu deux fois : le relevé est une photo,
  // pas une liste d'appels.
  const requested = values.slug.map((slug) => slug.trim()).filter(Boolean);
  if (requested.length === 0 && !values.json) {
    console.error(USAGE);
    return 1;
  }
  // `--json` seul (§ 9 du plan) : photo JSON de tout le catalogue connu.
  const slugs = [...new Set(requested.length > 0 ? requested : PAGES.map(([slug]) => slug))];

  const result = await readPages(slugs);
  console.log(values.json ? formatJson(result) : formatHuman(result));
  if (!values.json) {
    for (const warning of result.warnings) console.error(`[avertissement] ${warning}`);
  }
  return result.pagesFailed > 0 ? 2 : 0;
}

// Exécution seulement en ligne de commande : importé par les tests, le module est inerte.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) {
    console.error(`Node ≥ 18 requis (fetch natif) ; version courante : ${process.versions.node}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = await main(process.argv.slice(2));
  }
}

export {
  PAGES,
  normalizeAvailability,
  jsonLdBlocks,
  iterOffers,
  parseHtml,
  pageUrl,
  readPages,
  formatHuman,
  formatJson,
  main,
};
