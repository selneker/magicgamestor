// Moteur SDUI pur : AUCUNE importation React, AUCUN accès au DOM.
// Aligné sur le contrat v0 du dossier /contracts/aluu-admin/ (écran = liste de blocks,
// actions NOMMÉES, permissions calculées par le serveur). Toutes les règles de sécurité
// du rendu piloté par JSON sont concentrées ici et testées dans engine.test.js —
// un écran malveillant ou cassé ne peut pas exécuter d'appel interdit ni afficher un
// chemin de clé brut.
//
// Règles (non négociables) :
//  - actions limitées aux chemins /api/admin/ et aux méthodes GET, PUT, POST ;
//  - le serveur n'envoie JAMAIS de chemin d'action : les routes vivent dans ACTION_ROUTES,
//    table frontend ; un nom d'action inconnu ne produit aucune requête (fail-closed) ;
//  - kind inconnu ignoré (retiré + avertissement) sans casser le reste de l'écran ;
//  - une label_key manquante n'affiche JAMAIS le chemin brut (repli : label puis sdui.label.missing) ;
//  - requestFor retire le préfixe /api : le baseURL axios le porte déjà (lib/api.js) ;
//  - aucune résolution de composant par chaîne, aucun className/style lu dans le JSON ;
//  - le client n'est pas la sécurité : requires[] non satisfait → bouton désactivé,
//    le serveur refuse de toute façon.

const ADMIN_PREFIX = "/api/admin/";
const ALLOWED_METHODS = ["GET", "PUT", "POST"];
// Vocabulaire du contrat v0 (§2, révision BE-004) : 5 briques, et rien d'autre.
// `toggle` et `table.row_actions[]` ont été supprimés du contrat : ils sont
// désormais des kinds inconnus → ignorés par parseScreen, jamais rendus.
const KNOWN_BLOCK_KINDS = ["heading", "text", "select", "table", "button"];
// Version de contrat que ce moteur accepte. Toute autre valeur → écran d'erreur
// « version non prise en charge » (fail-closed, Q7).
const SUPPORTED_VERSION = "v0";
// Convention du contrat (i18n-keys.json) : l'état d'une ligne de table se rend via
// admin.aluu_mapping.state.{state}.
const STATE_KEY_PREFIX = "admin.aluu_mapping.state.";

// ——— Table des actions nommées ———————————————————————————————————————————
//
// Les routes appartiennent au frontend (jamais fournies par le serveur). Chemins
// issus du README §3 du contrat, écrits avec le préfixe /api porté par axios ;
// requestFor le retire. `writes` = confirmation obligatoire avant envoi (Q3) :
// mapping_preview est un POST en lecture seule, jamais confirmé.
// À confirmer par le contrat final (BE-004) : le payload de put_game_provider
// (Q8) n'est pas codé ici — requestFor est agnostique, l'appelant fournit la charge.
export const ACTION_ROUTES = Object.freeze({
  get_provider_screen: Object.freeze({ method: "GET", path: "/api/admin/games/:gameId/provider", writes: false }),
  put_config: Object.freeze({ method: "PUT", path: "/api/admin/games/:gameId/provider/config", writes: true }),
  put_game_provider: Object.freeze({ method: "PUT", path: "/api/admin/games/:gameId/provider", writes: true }),
  get_mapping_screen: Object.freeze({ method: "GET", path: "/api/admin/games/:gameId/aluu-mapping", writes: false }),
  mapping_preview: Object.freeze({ method: "POST", path: "/api/admin/games/:gameId/aluu-mapping/preview", writes: false }),
  mapping_apply: Object.freeze({ method: "POST", path: "/api/admin/games/:gameId/aluu-mapping/apply", writes: true }),
});

/** true seulement pour un chemin sous /api/admin/ et une méthode GET, PUT ou POST.
 * Garde-fou : chaque entrée d'ACTION_ROUTES est validée contre cette liste blanche
 * (testé — une entrée hors liste serait refusée, quels que soient son nom et son écran). */
export function isAllowedAction(action) {
  if (!action || typeof action !== "object") return false;
  const { path, method } = action;
  if (typeof path !== "string" || typeof method !== "string") return false;
  return path.startsWith(ADMIN_PREFIX) && ALLOWED_METHODS.includes(method);
}

/** Route d'une action nommée, ou null si le nom est inconnu (fail-closed).
 * hasOwnProperty : "constructor"/"__proto__" ne doivent jamais retourner un prototype. */
export function getActionRoute(name) {
  if (typeof name !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ACTION_ROUTES, name) ? ACTION_ROUTES[name] : null;
}

/** Confirmation obligatoire avant toute ÉCRITURE (Q3) : put_config, put_game_provider,
 * mapping_apply. mapping_preview est un POST en lecture seule : jamais confirmé. */
export function confirmNeeded(actionName) {
  const route = getActionRoute(actionName);
  return !!route && route.writes === true;
}

/** Texte du dialogue de confirmation (Q3) : confirm_key du bloc s'il existe et se
 * résout, sinon sdui.action.confirmBody. Jamais un chemin de clé brut. */
export function confirmText(node, t) {
  const key = node && typeof node === "object" ? node.confirm_key : undefined;
  if (typeof key === "string" && key) {
    const value = t(key);
    if (typeof value === "string" && value !== key) return value;
  }
  const fallback = t("sdui.action.confirmBody");
  return typeof fallback === "string" && fallback !== "sdui.action.confirmBody" ? fallback : "";
}

function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepCopy(v);
    return out;
  }
  return value;
}

/**
 * Prépare la requête d'une action NOMMÉE. Renvoie null si le nom est inconnu ou si
 * gameId est inutilisable — jamais de requête au petit bonheur.
 * Le préfixe /api est retiré : baseURL le porte déjà (lib/api.js), le garder
 * produirait un double /api et un 404 silencieux.
 * :gameId est encodé (encodeURIComponent) : un gameId contenant « / » ou des espaces
 * ne peut pas détourner la route. Le payload est copié en profondeur : la source
 * n'est jamais mutée.
 */
export function requestFor(actionName, gameId, payload) {
  const route = getActionRoute(actionName);
  if (!route || !isAllowedAction(route)) return null;
  if (typeof gameId !== "string" || !gameId) return null;
  const url = route.path.replace(/:gameId/g, encodeURIComponent(gameId)).replace(/^\/api(?=\/)/, "");
  if (route.method === "GET") return { method: "GET", url };
  const data = deepCopy(payload);
  return data === undefined ? { method: route.method, url } : { method: route.method, url, data };
}

// ——— Permissions (requires[] → permissions.*) ————————————————————————————

/**
 * requires[] du contrat : chemins pointés vers permissions.* de l'enveloppe.
 * Le serveur a déjà calculé les permissions — le client ne fait que les refléter
 * pour l'affichage (README §2.3 : « le client n'est pas la sécurité »).
 * Fail-closed : requires[] illisible, entrée non string, chemin hors permissions.*,
 * ou valeur !== true → false (bouton désactivé, jamais envoyé).
 */
export function requirementsSatisfied(requires, permissions) {
  if (requires === undefined || requires === null) return true;
  if (!Array.isArray(requires)) return false;
  if (requires.length === 0) return true;
  if (!permissions || typeof permissions !== "object") return false;
  return requires.every((req) => {
    if (typeof req !== "string" || !req.startsWith("permissions.")) return false;
    return permissions[req.slice("permissions.".length)] === true;
  });
}

// ——— Écran ————————————————————————————————————————————————————————————————

function sanitizeList(list, warning, warnings) {
  if (!Array.isArray(list)) return [];
  const kept = list.filter((item) => {
    const ok = !!item && typeof item === "object";
    if (!ok && warning) warnings.push(warning);
    return ok;
  });
  return kept;
}

/**
 * Normalise un écran brut (JSON du backend) :
 *  - blocks d'un kind inconnu retirés (avertissement "unknown_block_kind") ;
 *  - options/columns/rows toujours des tableaux (champ absent → [], éléments non objet retirés) ;
 *  - un button dont `action` n'est pas un nom connu d'ACTION_ROUTES garde un
 *    avertissement "unknown_action_name" (le rendu le désactive ; requestFor renverrait
 *    null de toute façon — double barrière).
 * Ne lève jamais : un écran null, vide ou incomplet donne un écran sans block.
 * Le serveur ne fournit aucun chemin : tout champ de route envoyé par le JSON est ignoré.
 */
export function parseScreen(raw) {
  const warnings = [];
  const screen = raw && typeof raw === "object" ? raw : {};
  if (!raw || typeof raw !== "object") warnings.push("screen_not_an_object");

  const blocks = [];
  for (const block of Array.isArray(screen.blocks) ? screen.blocks : []) {
    if (!block || typeof block !== "object") {
      warnings.push("invalid_block");
      continue;
    }
    if (!KNOWN_BLOCK_KINDS.includes(block.kind)) {
      warnings.push("unknown_block_kind");
      continue;
    }
    const clean = { ...block };
    if (block.kind === "select") clean.options = sanitizeList(block.options, "invalid_option", warnings);
    if (block.kind === "table") {
      clean.columns = sanitizeList(block.columns, "invalid_column", warnings);
      clean.rows = sanitizeList(block.rows, "invalid_row", warnings);
    }
    if (block.kind === "button") {
      const name = block.action;
      if (typeof name !== "string" || getActionRoute(name) === null) warnings.push("unknown_action_name");
    }
    blocks.push(clean);
  }

  return { screen: { ...screen, blocks }, warnings };
}

/** Version de contrat prise en charge (Q7) : tout écran dont contract_version !== "v0"
 * (absente, "v1", non string…) doit afficher l'écran d'erreur, jamais ses blocks. */
export function versionSupported(raw) {
  return !!raw && typeof raw === "object" && raw.contract_version === SUPPORTED_VERSION;
}

// ——— Libellés ————————————————————————————————————————————————————————————

/**
 * blockLabel (nommé `label` ici) — README §2 règle 1 : `label_key` partout,
 * `label` nulle part SAUF quand `label_key` est null (donnée du catalogue ou du
 * jeu : libellé d'un code jeu, d'un champ d'identité, d'un paramètre).
 *  1. label_key non null → t(label_key) ; non résolue → repli sdui.label.missing.
 *     JAMAIS de repli vers node.label (une label_key cassée ne doit pas laisser
 *     passer un libellé arbitraire) et JAMAIS le chemin de clé brut.
 *  2. label_key null/absent → node.label si chaîne non vide (exception du contrat).
 *  3. Sinon → t("sdui.label.missing").
 */
export function label(node, t) {
  const key = node && typeof node === "object" ? node.label_key : undefined;
  if (key !== null && key !== undefined) {
    if (typeof key === "string" && key) {
      const value = t(key);
      if (typeof value === "string" && value !== key) return value;
    }
    const missing = t("sdui.label.missing");
    return typeof missing === "string" && missing !== "sdui.label.missing" ? missing : "";
  }
  const raw = node && typeof node === "object" ? node.label : undefined;
  if (typeof raw === "string" && raw) return raw;
  const missing = t("sdui.label.missing");
  return typeof missing === "string" && missing !== "sdui.label.missing" ? missing : "";
}

// ——— Visibilité conditionnelle (visible_when) —————————————————————————————

/**
 * visible_when (README §2 règle 5) : map de CLÉS NUES champ → valeur attendue
 * (ex. { "provider_declared": false }), résolue contre l'enveloppe `game`.
 * Toutes les entrées doivent correspondre (ET logique). Une clé pointée
 * (« game.provider_declared ») ou « permissions.* » ne peut pas correspondre à
 * une clé nue du contexte → non satisfaite → bloc masqué (fail-closed).
 * Condition absente ou illisible → visible (fail-visible : un champ en trop se
 * corrige, un champ manquant envoie une config incomplète au backend).
 * Le serveur ne retire pas le bloc : règle d'affichage, pas de contrôle d'accès.
 */
export function isFieldVisible(block, context) {
  const cond = block && typeof block === "object" ? block.visible_when : undefined;
  if (!cond || typeof cond !== "object" || Array.isArray(cond)) return true;
  const ctx = context && typeof context === "object" ? context : {};
  return Object.entries(cond).every(([field, expected]) => ctx[field] === expected);
}

export function visibleBlocks(blocks, context) {
  return (Array.isArray(blocks) ? blocks : []).filter((b) => isFieldVisible(b, context));
}

// ——— Sélection de l'aperçu (table `preview`, README §5) ————————————————————

/** Seules les lignes `proposed` sont sélectionnables : ambiguous et missing ne
 * partent jamais dans l'apply, quelle que soit la valeur de `selected` reçue.
 * (Le serveur recalcule l'aperçu et applique la même règle — le client n'est
 * pas la sécurité.) */
export function isRowSelectable(row) {
  return !!row && typeof row === "object" && row.state === "proposed";
}

/** Identifiant stable d'une ligne : product_id ?? key. Chaîne non vide, sinon
 * null — une ligne sans identifiant n'est jamais interactive (aucune case,
 * jamais dans l'apply). */
export function rowId(row) {
  if (!row || typeof row !== "object") return null;
  const id = row.product_id ?? row.key;
  return typeof id === "string" && id ? id : null;
}

/**
 * Charge utile de mapping_apply (README §3.4) : {"apply": [{product_id, denom}]}.
 * `selection` est la map {[rowId]: boolean} tenue par l'écran : selection[rowId]
 * est prioritaire sur row.selected (état reçu de l'aperçu) ; sans entrée, on
 * retombe sur row.selected === true.
 * Uniquement les lignes : proposed (isRowSelectable) ET cochées ET dont
 * match.denom est une chaîne. Une ligne sans identifiant ni product_id, une
 * ligne ambiguous/missing (même marquée cochée par un écran bogué) ne partent
 * jamais — le serveur recalcule l'aperçu de toute façon.
 */
export function buildApplyPayload(previewRows, selection) {
  const rows = Array.isArray(previewRows) ? previewRows : [];
  const sel = selection && typeof selection === "object" ? selection : {};
  const apply = [];
  for (const row of rows) {
    if (!isRowSelectable(row)) continue;
    const id = rowId(row);
    if (id === null) continue;
    const checked = typeof sel[id] === "boolean" ? sel[id] : row.selected === true;
    if (!checked) continue;
    if (typeof row.product_id !== "string" || !row.product_id) continue;
    const match = row.match && typeof row.match === "object" ? row.match : null;
    if (!match || typeof match.denom !== "string" || !match.denom) continue;
    apply.push({ product_id: row.product_id, denom: match.denom });
  }
  return { apply };
}

/**
 * Corps de put_config (README §3.1 « Assemblage du corps par le client ») —
 * AUCUNE autre clé n'est envoyée :
 *  - aluu_game_code / aluu_check_endpoint = valeur du select du même nom
 *    (values[key] prioritaire sur block.value) ;
 *  - aluu_identity_map = {<champ>: <paramètre>} pour chaque select dont la key
 *    commence par « aluu_identity_map. » et qui a une valeur ;
 *  - valeur vide/null, ou absente des options du select → traitée comme vide :
 *    la clé est OMISE, jamais envoyée à null ;
 *  - la table d'identité, vide après omission, est omise elle aussi (le serveur
 *    répond 400 invalid_identity_map — comportement voulu, pas un repli client).
 */
export function buildConfigPayload(blocks, values) {
  const list = Array.isArray(blocks) ? blocks : [];
  const vals = values && typeof values === "object" ? values : {};
  const payload = {};
  const identityMap = {};
  for (const block of list) {
    if (!block || typeof block !== "object" || block.kind !== "select") continue;
    const key = block.key;
    if (typeof key !== "string" || !key) continue;
    const options = Array.isArray(block.options) ? block.options : [];
    const allowed = options
      .filter((o) => o && typeof o === "object")
      .map((o) => o.value)
      .filter((v) => typeof v === "string" && v);
    const raw = Object.prototype.hasOwnProperty.call(vals, key) ? vals[key] : block.value;
    const value = typeof raw === "string" && raw && allowed.includes(raw) ? raw : null;

    if (key === "aluu_game_code" || key === "aluu_check_endpoint") {
      if (value !== null) payload[key] = value;
    } else if (key.startsWith("aluu_identity_map.")) {
      const field = key.slice("aluu_identity_map.".length);
      if (value !== null && field && !field.includes(".")) identityMap[field] = value;
    }
    // toute autre clé (provider, webhook_url…) : jamais envoyée
  }
  if (Object.keys(identityMap).length > 0) payload.aluu_identity_map = identityMap;
  return payload;
}

/**
 * payload d'un button (README §2 règle 6) : renvoyé TEL QUEL comme corps — mais
 * SEULEMENT pour put_game_provider, et seulement s'il est exactement
 * {provider: "aluu" | "fazercards"}. Toute autre action, toute forme étrangère
 * (clé en trop, valeur inconnue) → undefined : rien n'est transmis. Une copie
 * fraîche est renvoyée : la source n'est jamais mutée.
 */
export function payloadFor(block) {
  if (!block || typeof block !== "object") return undefined;
  if (block.action !== "put_game_provider") return undefined;
  const payload = block.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "provider") return undefined;
  if (payload.provider !== "aluu" && payload.provider !== "fazercards") return undefined;
  return { provider: payload.provider };
}

// ——— Cellules de tableau (format obligatoire par colonne, README §2) ———————

// Prix de l'app : EXACTEMENT formatAr (src/lib/api.js:48), recopié ici pour
// garder le moteur PUR (aucun import du module réseau). engine.test.js compare
// la sortie de ce formateur à formatAr : une divergence ferait échouer la suite.
const formatMoney = (n) => `${Number(n || 0).toLocaleString("fr-FR").replace(/\u202f/g, " ")} Ar`;

// Décision FE-003 : valeur null → value_key de la ligne traduit si présent
// (ex. « Configuré »), sinon « — ». Jamais sdui.label.missing, jamais un chemin.
function valueKeyFallback(row, t) {
  if (row && typeof row === "object" && typeof row.value_key === "string" && row.value_key) {
    const translated = t(row.value_key);
    if (typeof translated === "string" && translated !== row.value_key) return translated;
  }
  return "—";
}

/**
 * Rendu TEXTE par défaut d'une cellule, jamais un chemin de clé brut ni un objet
 * sérialisé. Réutilisé par formatCell pour le format `text` (et tout format
 * inconnu). Les états et packs passent par formatCell — le format est
 * obligatoire par colonne (README §2), plus aucune heuristique sur le nom de clé.
 */
export function cellText(row, column, t) {
  if (!row || typeof row !== "object") return "";
  if (!column || typeof column !== "object" || typeof column.key !== "string") return "";
  const value = row[column.key];

  if (value === null || value === undefined) return valueKeyFallback(row, t);
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("fr-FR") : String(value);
  if (Array.isArray(value)) return "";
  if (typeof value === "object") return typeof value.offer_name === "string" ? value.offer_name : "";
  return String(value);
}

// Liste FERMÉE des états du §5 (courant + proposition). Toute autre valeur →
// « — » : jamais la valeur brute (une donnée hostile ne devient pas un libellé).
const ROW_STATES = ["mapped", "unconfirmed", "missing", "stale", "ambiguous", "proposed"];

/**
 * Rendu d'une cellule selon le `format` OBLIGATOIRE de la colonne (README §2,
 * liste fermée). Format inconnu ou absent → traité comme `text`, jamais deviné.
 *  - text       : String(valeur) échappée (React) ; une valeur non nulle l'emporte
 *                sur value_key (ex. URL de webhook) ; null → value_key, sinon « — » ;
 *  - label_key  : t(valeur) si chaîne non vide et résolue, sinon « — » — JAMAIS
 *                le chemin de clé brut ;
 *  - money      : entier >= 0 uniquement, formatAr (prix de l'app) ; sinon « — » ;
 *  - state      : valeur de ROW_STATES → t("admin.aluu_mapping.state.<valeur>") ;
 *                toute autre valeur → « — » (jamais la valeur brute) ;
 *  - pack       : {denom, offer_name, price_usd} tous trois chaînes →
 *                "<offer_name> (<denom>) · <price_usd> USD" — price_usd n'est
 *                JAMAIS converti en nombre ("0.0000" reste "0.0000") ;
 *                null ou forme invalide → « — » ;
 *  - checkbox   : null (rendu par le composant — case à cocher, §5).
 */
export function formatCell(format, row, column, t) {
  const fmt = typeof format === "string" && format ? format : "text";
  const ok =
    row && typeof row === "object" && column && typeof column === "object" && typeof column.key === "string";
  const value = ok ? row[column.key] : undefined;

  switch (fmt) {
    case "checkbox":
      return null;
    case "text":
      return ok ? cellText(row, column, t) : "";
    case "label_key": {
      if (value === null || value === undefined) return valueKeyFallback(row, t);
      if (typeof value === "string" && value) {
        const translated = t(value);
        if (typeof translated === "string" && translated !== value) return translated;
      }
      return "—";
    }
    case "money": {
      if (value === null || value === undefined) return valueKeyFallback(row, t);
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return formatMoney(value);
      return "—";
    }
    case "state": {
      if (typeof value === "string" && ROW_STATES.includes(value)) {
        const key = STATE_KEY_PREFIX + value;
        const translated = t(key);
        if (typeof translated === "string" && translated !== key) return translated;
      }
      return "—"; // état inconnu ou clé non traduite : jamais la valeur brute
    }
    case "pack": {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.denom === "string" &&
        typeof value.offer_name === "string" &&
        typeof value.price_usd === "string"
      ) {
        return `${value.offer_name} (${value.denom}) · ${value.price_usd} USD`;
      }
      return "—";
    }
    default:
      // format inconnu ou absent → rendu texte, jamais interprété (README §2)
      return ok ? cellText(row, column, t) : "";
  }
}

/**
 * Textes des candidats d'une ligne ambiguous, dans l'ordre du JSON — offer_name
 * seul (la donnée affichable autorisée) ; jamais d'objet sérialisé.
 */
export function cellCandidates(row) {
  if (!row || typeof row !== "object" || !Array.isArray(row.candidates)) return [];
  return row.candidates
    .filter((c) => c && typeof c === "object" && typeof c.offer_name === "string")
    .map((c) => c.offer_name);
}

// ——— Erreurs (errors.json) ————————————————————————————————————————————————

/**
 * Libellé d'un code d'erreur : t("errors." + code) si le code est connu, sinon
 * errors.unknown (règle errors.json : « un code inconnu du client s'affiche avec
 * errors.unknown, jamais le detail brut »). detail n'est JAMAIS lu ici. Un échec
 * de traduction totale renvoie "" — jamais un chemin de clé.
 */
export function errorLabel(code, t) {
  if (typeof code === "string" && code) {
    const key = `errors.${code}`;
    const value = t(key);
    if (typeof value === "string" && value !== key) return value;
  }
  const fallback = t("errors.unknown");
  return typeof fallback === "string" && fallback !== "errors.unknown" ? fallback : "";
}
