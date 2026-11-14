// SEO centralisé — application CRA sans SSR : tout est appliqué côté client
// (balises <head> mises à jour à chaque route) et complété par les fichiers
// statiques `public/robots.txt`, `public/sitemap.xml` et le JSON-LD de
// `public/index.html` (lu par les moteurs qui n'exécutent pas JavaScript).
//
// Le domaine canonique est celui déclaré côté backend (`FRONTEND_URL`) :
// https://magicgame.store — les alias www sont redirigés vers lui.

export const SITE_URL = "https://magicgame.store";
export const SITE_NAME = "Magic Game Store";
export const DEFAULT_TITLE = `${SITE_NAME} — Recharges de jeux à Madagascar`;
export const PAGE_JSONLD_ID = "mgs-page-jsonld";

// Facettes utiles au référencement conservées dans l'URL canonique. Tout le
// reste (recherche, tri, fourchette de prix, filtres) crée des doublons de
// contenu et disparaît donc de l'URL canonique.
const CANONICAL_QUERY_KEYS = { "/boutique": ["game", "type"] };

// Routes privées ou transactionnelles : jamais indexées (le contenu dépend du
// client, ou n'a aucun intérêt pour un moteur de recherche).
const PRIVATE_PREFIXES = [
  "/admin",
  "/compte",
  "/commande",
  "/chat",
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/reinitialiser",
  "/verifier-email",
  "/suivi",
  "/orders",
  "/support",
];

/** Vrai si la route ne doit jamais apparaître dans les résultats de recherche. */
export function isPrivatePath(pathname = "/") {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** URL absolue canonique d'une route (domaine + chemin + facettes autorisées). */
export function canonicalFor(pathname = "/", search = "") {
  const path = pathname || "/";
  const url = new URL(path, SITE_URL);
  const allowed = CANONICAL_QUERY_KEYS[path.replace(/\/+$/, "") || "/"] || [];
  const params = new URLSearchParams(search || "");
  allowed.forEach((key) => {
    const value = params.get(key);
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

/** URL absolue d'une image (les images API peuvent être relatives). */
export function absoluteImage(src) {
  if (!src) return `${SITE_URL}/og-image.png`;
  if (/^https?:\/\//i.test(src)) return src;
  return `${SITE_URL}${src.startsWith("/") ? "" : "/"}${src}`;
}

function upsertMeta(attribute, key, content) {
  if (!content || typeof document === "undefined") return null;
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
  return element;
}

/** Met à jour `<meta name="…">`. */
export const setMeta = (name, content) => upsertMeta("name", name, content);

/** Met à jour `<meta property="…">` (Open Graph). */
export const setProperty = (property, content) => upsertMeta("property", property, content);

/** Met à jour `<link rel="canonical">`. */
export function setCanonical(href) {
  if (!href || typeof document === "undefined") return;
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

/** Écrit (ou remplace) un bloc de données structurées schema.org et le renvoie. */
export function setJsonLd(id, data) {
  if (typeof document === "undefined") return null;
  let script = document.getElementById(id);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
  return script;
}

/** Retire un bloc de données structurées. */
export function clearJsonLd(id) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.remove();
}

// Mots-clés par route et par langue. Google ignore la balise `keywords` depuis
// longtemps, mais elle reste utile aux moteurs plus anciens et sert surtout de
// source aux `keywords` du JSON-LD : elle décrit précisément ce que vend chaque
// page.
const KEYWORDS = {
  fr: {
    "/": "UC PUBG Mobile, acheter UC PUBG, UC PUBG pas cher, recharge PUBG Mobile, PUBG Mobile Madagascar, UC en ariary, acheter UC avec MVola, acheter UC Orange Money, Prime PUBG Mobile, Prime+ PUBG Mobile, abonnement PUBG Mobile, pack évolutif PUBG Mobile, Royal Pass PUBG Mobile, recharge jeux mobiles Madagascar, boutique de jeux en ligne Madagascar, paiement Mobile Money Madagascar, Binance USDT Madagascar, livreur UC Madagascar, Magic Game Store, magicgame.store, Antananarivo, Madagascar",
    "/jeux": "jeux mobiles Madagascar, boutique jeux mobiles, PUBG Mobile, catalogue jeux en ligne Madagascar, recharges jeux mobiles, choisir un jeu, Magic Game Store",
    "/boutique": "boutique UC PUBG, packs UC PUBG Mobile, prix UC en ariary, acheter UC PUBG Mobile, Prime PUBG Mobile, Prime+ PUBG Mobile, packs évolutifs PUBG, promotions PUBG Mobile Madagascar, paiement MVola, Orange Money, Binance USDT, Magic Game Store",
    "/produit": "acheter UC PUBG Mobile, pack UC PUBG, abonnement PUBG Mobile, prix en ariary, livraison sur compte joueur, ID PUBG vérifié, MVola, Orange Money, Binance USDT, Magic Game Store",
    "/evenements": "événements PUBG Mobile, promotions PUBG Mobile Madagascar, offre UC PUBG, Royal Pass, événements jeux mobiles Madagascar, Magic Game Store",
    "/pack-evolutif": "pack évolutif PUBG Mobile, packs évolutifs PUBG, Royal Pass, progression PUBG Mobile, achat pack évolutif Madagascar, Magic Game Store",
    "/terms": "conditions d'utilisation, conditions de vente, Magic Game Store, boutique jeux Madagascar",
    "/privacy": "politique de confidentialité, données personnelles, Magic Game Store, boutique jeux Madagascar",
  },
  en: {
    "/": "PUBG Mobile UC, buy PUBG UC, cheap PUBG UC, PUBG Mobile top up, PUBG Mobile Madagascar, UC in ariary, buy UC with MVola, buy UC Orange Money, PUBG Mobile Prime, PUBG Mobile Prime+, PUBG Mobile subscription, PUBG Mobile evolving pack, PUBG Mobile Royal Pass, mobile game top up Madagascar, online game store Madagascar, Mobile Money Madagascar, Binance USDT Madagascar, Magic Game Store, magicgame.store, Antananarivo, Madagascar",
    "/jeux": "mobile games Madagascar, mobile game store, PUBG Mobile, online game catalogue Madagascar, mobile game top ups, pick a game, Magic Game Store",
    "/boutique": "PUBG UC store, PUBG Mobile UC packs, UC price in ariary, buy PUBG Mobile UC, PUBG Mobile Prime, PUBG Mobile Prime+, PUBG evolving packs, PUBG Mobile Madagascar deals, MVola payment, Orange Money, Binance USDT, Magic Game Store",
    "/produit": "buy PUBG Mobile UC, PUBG UC pack, PUBG Mobile subscription, price in ariary, player account delivery, verified PUBG ID, MVola, Orange Money, Binance USDT, Magic Game Store",
    "/evenements": "PUBG Mobile events, PUBG Mobile Madagascar promotions, PUBG UC offer, Royal Pass, mobile game events Madagascar, Magic Game Store",
    "/pack-evolutif": "PUBG Mobile evolving pack, PUBG evolving packs, Royal Pass, PUBG Mobile progression, buy evolving pack Madagascar, Magic Game Store",
    "/terms": "terms of use, terms of sale, Magic Game Store, game store Madagascar",
    "/privacy": "privacy policy, personal data, Magic Game Store, game store Madagascar",
  },
};

/** Liste de mots-clés correspondant à la route (préfixe le plus long gagnant). */
export function keywordsFor(pathname = "/", lang = "fr") {
  const dictionary = KEYWORDS[lang] || KEYWORDS.fr;
  const match = Object.keys(dictionary)
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];
  return dictionary[match] || dictionary["/"];
}
