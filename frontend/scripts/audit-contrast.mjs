#!/usr/bin/env node
/**
 * Audit de contraste WCAG sur les pages cles du storefront.
 *
 * Usage :
 *   cd frontend && yarn build && CHROMIUM_PATH=/chemin/vers/chromium yarn audit:contrast
 *
 * Le script sert le dossier build/ sur un port libre, intercepte les appels
 * /api pour injecter des donnees simulees, puis mesure le contraste reellement
 * peint pour chaque texte visible.
 *
 * Chromium : le depot n'embarque pas de navigateur. Il faut installer
 * playwright-core (devDependency) ET fournir un Chromium du systeme via la
 * variable d'environnement CHROMIUM_PATH. Sans elle, le script s'arrete.
 *
 * Sortie : un tableau par page et par combinaison, le detail des classes en
 * cause, et un code de sortie non nul s'il reste des echecs.
 */

/* ---------------------------------------------------------------- exclusions
 *
 * Regles d'exclusion de la mesure. Chaque exclusion est VOLONTAIRE et listee
 * ici avec sa raison. Une exclusion non listee = une mesure bouche : si le
 * script ne peut pas mesurer un texte, il doit le dire.
 *
 * 1. Texte invisible (display:none, visibility:hidden, opacity:0)
 *    -> rien n'est peint a l'ecran : il n'y a pas de contraste a mesurer.
 * 2. Texte en classe `sr-only` (reserve aux lecteurs d'ecran)
 *    -> meme raison : le texte n'est pas visible.
 * 3. Texte situe hors de la fenetre (au-dessus / en dessous)
 *    -> il sera mesure quand la page defile jusqu'a lui ; la boucle de
 *       defilement couvre toute la hauteur du document.
 * 4. Rectangle de glyphe < 4 x 4 px
 *    -> ponctuation ou artefact de rendu, pas un texte lisible.
 * 5. Texte occulte par un calque flottant devant lui (barre panier, en-tete
 *    sticky, feuille de modale)
 *    -> c'est une OCCLUSION, pas un contraste : le fond reellement visible
 *       est celui du calque, pas celui du texte. Le texte est ignore, il
 *       n'est pas declare conforme.
 * 6. Element deplace entre la mesure et le hit-test (animation en cours)
 *    -> la position mesuree n'est plus valide, la mesure serait fausse.
 * 7. Composant INACTIF (`disabled` ou `aria-disabled="true"`)
 *    -> WCAG 1.4.3 exempte les composants inactifs du contraste de texte, et
 *       l'etat attenue (`disabled:opacity-50`) n'est pas mesurable ici :
 *       l'opacite d'un element n'est pas composee dans la mesure. Le bouton
 *       « Verifier l'ID » desactive est donc traite a part (T2.5), avec son
 *       propre seuil (>= 3:1) verifie par un test dedie.
 *
 * AUCUN SEUIL N'EST ASSOUPPLI. 4.5:1 (3:1 pour le texte grand) est applique
 * tel quel, et le script sort en erreur tant qu'un echec subsiste. Les
 * exclusions ci-dessus ne portent que sur des elements qui ne sont pas
 * peints, ou sur des composants que la norme exempte : elles ne peuvent pas
 * masquer un contraste reellement trop faible.
 */

/* ------------------------------------------------------------------ limites
 *
 * Ce que cet audit NE mesure PAS (a completer par une tache dediee si un
 * de ces points doit devenir bloquant) :
 *
 * - Les BORDURES, separateurs et traits. WCAG 1.4.11 leur demande 3:1 ;
 *  ce script ne les mesure pas du tout.
 * - Les ICONES et images porteuses de sens (WCAG 1.4.11, 3:1) : seules les
 *  icones qui enchappent a un texte visible sont traitees comme texte.
 * - Les ELEMENTS NON TEXTUELS : fond de carte, trait de focus, anneau de
 *  selection, etats survole/actif.
 * - Les FONDS IMAGE OU DEGRADES : le fond mesure est la couleur unie
 *  (`background-color`) sous le texte, pas l'image. Un texte pose sur une
 *  photo est donc mesure sur une couleur qui n'est pas celle peinte.
 * - Les FILTRES CSS : la couleur lue dans les styles calcules est celle
 *  d'AVANT filtre (ex. `grayscale` sur la carte « Indisponible »). Le couple
 *  mesure n'est donc pas exactement le couple peint.
 * - Le texte multi-lignes : seul le premier rectangle de glyphe est sonde.
 * - L'OPACITE d'un element (`opacity-*`, `disabled:opacity-50`) : elle n'est
 *   pas composee dans la mesure. Un texte attenue par l'opacite de son
 *   conteneur est mesure avec sa couleur pleine sur son fond non attenue.
 * - Les largeurs de fenetre autres que 390 px et 1440 px, et le theme
 *  « systeme » (seuls « light » et « dark » forces sont mesures).
 * - Les pages absentes de la liste PAGES ci-dessous.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "build");
const CHROMIUM = process.env.CHROMIUM_PATH;

if (!CHROMIUM) {
  console.error(
    [
      "",
      "[erreur] CHROMIUM_PATH n'est pas definie.",
      "",
      "Ce script a besoin d'un Chromium deja installe sur la machine ; il ne",
      "telecharge pas de navigateur. Renseignez le chemin de l'executable :",
      "",
      "  CHROMIUM_PATH=/usr/bin/chromium yarn audit:contrast",
      "",
      "Chromium se trouve souvent dans /usr/bin/chromium, /usr/bin/chromium-",
      "browser, /usr/bin/google-chrome ou /snap/bin/chromium.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!existsSync(CHROMIUM)) {
  console.error(`[erreur] CHROMIUM_PATH ne pointe sur aucun fichier : ${CHROMIUM}`);
  process.exit(1);
}

if (!existsSync(join(BUILD_DIR, "index.html"))) {
  console.error(
    [
      "",
      `[erreur] ${BUILD_DIR}/index.html est introuvable.`,
      "",
      "Le script audite le bundle compile. Lancez d'abord :",
      "",
      "  yarn build",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ donnees */

const GAMES = [
  {
    id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true, sort_order: 0,
    description: "UC, Prime, Prime+ & Pack evolutif", currency_label: "UC",
    icon_url: "https://customer-assets-0z36b82j.emergentagent.net/job_games-nav-polish/artifacts/ih6044zb_pubgm_app-icon_512x512%281%29.e9f7efc0.png",
    product_types: [
      { key: "uc", label: "UC", label_en: "UC" },
      { key: "prime", label: "Prime", label_en: "Prime" },
      { key: "prime_plus", label: "Prime+", label_en: "Prime+" },
      { key: "evo", label: "Pack evolutif", label_en: "Evo pack" },
    ],
    identity_fields: [
      { key: "player_id", label: "ID PUBG Mobile", label_en: "PUBG Mobile ID",
        pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true, primary: true },
    ],
  },
  // Jeu multi-champs : sert a mesurer les messages du parcours generique
  // (identifiant refuse, panne, compte verifie) avec de vrais libelles de
  // champs — le message ne doit citer que les champs demandes par le jeu.
  {
    id: "mobile-legends", name: "Mobile Legends", slug: "mobile-legends", active: true, sort_order: 1,
    description: "UC", currency_label: "UC",
    icon_url: "https://customer-assets-0z36b82j.emergentagent.net/job_games-nav-polish/artifacts/ih6044zb_pubgm_app-icon_512x512%281%29.e9f7efc0.png",
    product_types: [{ key: "uc", label: "UC", label_en: "UC" }],
    identity_fields: [
      { key: "player_id", label: "ID joueur", label_en: "Player ID",
        pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true, primary: true },
      { key: "zone_id", label: "Zone ID", label_en: "Zone ID",
        pattern: "^[0-9]{3,5}$", min_length: 3, max_length: 5, required: true },
    ],
  },
];

const product = (id, name, slug, price, type, uc, months, popular, old, purchasable = true, game_id = "pubg-mobile") => ({
  id, name, slug, price, game_id, type, uc_amount: uc, duration_months: months,
  popular, purchasable, old_price: old || null, description: name,
});

const PRODUCTS = [
  product("p1", "660 UC", "660-uc", 2500, "uc", 660, null, true),
  product("p2", "1800 UC", "1800-uc", 6500, "uc", 1800, null, true),
  product("p3", "Prime+ 14 jours", "prime-14", 4500, "prime_plus", null, 14, false),
  product("p4", "Pack evolutif", "pack-evolutif", 19000, "evo", null, null, false),
  product("p5", "6600 UC", "6600-uc", 22000, "uc", 6600, null, true, 26000),
  product("p6", "Prime 7 jours", "prime-7", 2500, "prime", null, 7, false),
  // Variante « Indisponible » (carte grise, barre de prix sans fond) et
  // variante « Pack UC » sans remise : toutes les colonnes de la carte
  // produit doivent etre mesurees, pas seulement les deux premieres.
  product("p7", "330 UC", "330-uc", 1200, "uc", 330, null, false, null, false),
  product("p8", "3300 UC", "3300-uc", 12000, "uc", 3300, null, false),
  product("m1", "660 UC", "660-uc-ml", 2500, "uc", 660, null, true, null, true, "mobile-legends"),
  // Variantes de la carte produit : chacune doit etre mesuree dans son etat
  // (pas de remise / avec remise / Prime / Prime+ / Evolutif / Populaire).
  product("p9", "120 UC", "120-uc", 900, "uc", 120, null, false),
  product("p10", "60 UC", "60-uc", 700, "uc", 60, null, true, 900),
];

const EVENTS = [
  { id: "e1", title: "Tournoi solo - 5000 Ar", slug: "t", description: "Inscription ouverte",
    image_url: null, likes: 24, event_date: "2026-11-20T18:00:00Z", active: true },
];

const PAYMENT_CONFIG = {
  mode: "papi", gateway: "papi", live: false, papi_auto: true, fiveone_enabled: false, auto_payment: true,
  payment_fees: { manual: { percent: 0, min: 0, max: 0 }, papi: { percent: 1.5, min: 100, max: 900 } },
  manual_only: false, timeout_minutes: 15,
  // PL-CHK-4 — écran 1 : les lignes MVola / Orange ne s'affichent que si la
  // config déclare le provider actif ; les deux sont mesurées.
  providers: {
    mvola: { configured: true, merchant: "0383905692", name: "Selneker Dino" },
    orange: { configured: true, merchant: "0377519833", name: "Selneker Dino" },
  },
};

const ORDER = {
  id: "ord_1", order_number: "MGS-123456", total: 2500, subtotal: 2500, payment_fee: 0, status: "pending_payment",
  payment_method: "mvola", payment_phone: "0341234567", pubg_id: "52328390220",
  // PL-CHK-2 — contrat preuve : le délai et la liste existent toujours.
  payment_deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(), payment_proofs: [],
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
};

// PL-CHK-4 — écran 2 (/orders/:id) : le paiement manuel N'A PAS de téléphone
// (preuve par USSD marchand) ; l'opérateur est persisté. Variantes par page :
// opérateur, écran d'attente, expiration.
const RESUME_ORDER = (over = {}) => ({
  ...ORDER, payment_method: "manual", manual_operator: "mvola", pseudo: "TestPlayer",
  payment_phone: undefined, ...over,
});

// PL-005-FE-01 — historique refait (/commandes, /commandes/:id) : commande
// typique d'une carte UC, avec date, jeu et snapshot d'identité (les champs
// que OrderHistory lit). Les variantes de détail (payée, livrée, annulée)
// passent par les overrides de PAGES, comme RESUME_ORDER.
const HISTO_ORDER = (over = {}) => ({
  ...ORDER,
  status: "paid",
  created_at: "2026-11-13T16:30:00Z",
  game_id: "pubg-mobile",
  items: [{ product_id: "p1", slug: "660-uc", name: "660 UC", quantity: 1, price: 2500, line_total: 2500 }],
  identity_snapshot: { source: "verified", fields: { player_id: "52328390220" } },
  ...over,
});

// PL-CHK-2 — petites captures PNG valides (1×1) pour l'état « vignettes » de
// l'étape 3 manuelle : le même flux que le client (champ file multiple).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PROOF_FILES = [
  { name: "capture-1.png", mimeType: "image/png", buffer: TINY_PNG },
  { name: "capture-2.png", mimeType: "image/png", buffer: TINY_PNG },
];

const USER = { user_id: "u1", email: "client@exemple.test", name: "Client", roles: [], permissions: [] };
// Variante admin pour les pages /admin/* (ProtectedRoute exige role admin ;
// « users.manage » rend l'entrée Utilisateurs visible comme en production).
const ADMIN_USER = { user_id: "u1", email: "admin@exemple.test", name: "Admin", role: "admin", permissions: ["users.manage"] };

const ADMIN_STATS = {
  revenue: 0, total_orders: 0, customers: 0, pending_payment_count: 0, pending_payment_usd: 0,
  status_count: { paid: 0, awaiting_verification: 0, delivered: 0 }, daily: [], top_products: [], by_method: {},
};

// Messages admin (MGS-FE-ADMIN-20261105-02) : la liste (badge non lus, textes
// atténués) et une conversation ouverte (libellés, dates, bulles) rendent
// réellement pendant l'audit — avant, la page ne montrait que son bloc d'erreur.
const CHAT_CONVERSATIONS = [
  { id: "c1", user_name: "Pipa Nilsen", user_email: "pipa.nilsen@example.com", last_message: "Bonjour, j'ai une question sur ma commande.", updated_at: "2026-11-05T10:00:00Z", unread_count: 2 },
  { id: "c2", user_name: "Alex Rakoto", user_email: "alex.rakoto@example.com", last_message: "Merci !", updated_at: "2026-11-04T09:00:00Z", unread_count: 0 },
];
const CHAT_THREAD = {
  conversation: { id: "c1", user_name: "Pipa Nilsen" },
  messages: [
    { id: "m1", sender_role: "customer", text: "Bonjour, j'ai une question sur ma commande.", created_at: "2026-11-05T09:59:00Z", read: false },
    { id: "m2", sender_role: "admin", text: "Bonjour ! Comment pouvons-nous vous aider ?", created_at: "2026-11-05T10:00:00Z", read: true },
  ],
  has_more: false,
};

const mockApi = (pathname, page = {}) => {
  // Pages admin : formes minimales mais typées (objets là où les pages
  // accèdent à des champs, tableaux ailleurs), pour que chaque page rende
  // réellement son interface.
  if (pathname.startsWith("/admin") || pathname.startsWith("/crypto/admin") || pathname.startsWith("/loyalty/admin") || pathname.startsWith("/payments/admin")) {
    if (pathname.includes("/admin/stats")) return ADMIN_STATS;
    if (pathname.includes("/admin/users")) return { items: [], total: 0, page: 1, page_size: 20 };
    if (pathname.includes("/admin/fazercards/price-alerts")) return { alerts: [], unacknowledged: 0 };
    if (pathname.includes("/admin/fazercards/settings")) return { fzr_auto: false };
    if (pathname.includes("/admin/fazercards/mappings")) return { products: [] };
    if (pathname.includes("/admin/fazercards/coverage")) return { offers: [] };
    if (pathname.includes("/admin/fazercards/uc-audit")) return { rows: [] };
    if (pathname.includes("/admin/push/config")) return { configured: false };
    if (pathname.includes("/payments/admin/settings")) return { payment_fees: {} };
    if (pathname.includes("/loyalty/admin/settings")) return { enabled: false, transfers_enabled: false };
    return [];
  }
  if (pathname.includes("/chat/conversations") && pathname.endsWith("/messages")) return CHAT_THREAD;
  if (pathname.includes("/chat/conversations")) return { items: CHAT_CONVERSATIONS, has_more: false };
  if (pathname.endsWith("/games")) return GAMES;
  if (pathname.includes("/payments/config")) return PAYMENT_CONFIG;
  if (pathname.includes("/payments/initiate")) return { simulated: true, payment_url: null, attempt: 1 };
  // PL-CHK-4 — sondage 5 s de l'écran 2 (paiement automatique) : réponse stable.
  if (/\/payments\/[\w-]+\/status$/.test(pathname)) return page.payStatus || { simulated: true, payment_url: null };
  if (pathname.includes("/crypto/config")) return page.cryptoConfig || { available: false, networks: [] };
  if (pathname.includes("/products")) return PRODUCTS;
  if (pathname.includes("/events")) return EVENTS;
  if (pathname.includes("/settings/status")) return { online: false };
  if (pathname.includes("/me/game-identities")) return [];
  if (pathname.includes("/loyalty/me")) return { balance: { total: 1200, earned: 1200, promo: 0 }, ledger: [], config: {} };
  if (pathname.includes("/loyalty/rewards")) return [];
  if (pathname.includes("/loyalty/transfers")) return [];
  // PL-005-FE-01 — la liste peut être variée par page (les quatre familles de
  // badge doivent être peintes sur /commandes pour être mesurées).
  if (pathname.includes("/orders/me")) return page.ordersMe || [ORDER];
  // PL-CHK-2/PL-CHK-4 — reprise/compte à rebours : GET /orders/{id} renvoie
  // l'état réel DE LA PAGE AUDITÉE (opérateur, statut).
  if (/\/orders\/(?!me)[\w-]+$/.test(pathname)) return page.trackOrder || ORDER;
  if (pathname.endsWith("/orders")) return page.createdOrder || ORDER;
  return [];
};

/* ------------------------------------------------------------------ pages */
/* Liste des pages auditees. Ajouter une page = ajouter une entree ici.
 *
 * `game` : le jeu selectionne (par defaut PUBG Mobile).
 * `validate` : la reponse simulee de /fazercards/validate-id, pour mesurer
 * l'etat affiche apres la verification (identifiant refuse, panne, compte
 * verifie, reponse non-JSON). Sans `validate`, l'API repond « valide ». */

const PAGES = [
  { name: "accueil", path: "/" },
  { name: "catalogue", path: "/boutique?game=pubg-mobile" },
  // PL-CHK-4 — le tunnel n'a qu'UN écran de création (/commande) : état
  // initial (méthodes en lignes, rien sélectionné), état vérifié (ID +
  // pseudo + coche), méthode sélectionnée (remarque courte), Binance
  // (sélecteur de réseau). Les états de vérification d'identité sont mesurés
  // sur le même écran (IdentityFieldsVerify inchangé).
  { name: "checkout-1-init", path: "/commande", step: "init" },
  { name: "checkout-1-verification", path: "/commande", step: 1 },
  { name: "checkout-1-methode-mvola", path: "/commande", step: 2 },
  { name: "checkout-1-methode-binance", path: "/commande", step: "binance",
    cryptoConfig: { available: true, networks: [{ key: "BSC", label: "BNB Smart Chain" }] } },
  // Écran 2 (/orders/:id) : manuel MVola, manuel Orange, attente (preuve
  // envoyée), expiration. Aucun pilotage : l'écran lit GET /orders/{id}.
  { name: "paiement-manuel-mvola", path: "/orders/ord_1", trackOrder: RESUME_ORDER() },
  { name: "paiement-manuel-orange", path: "/orders/ord_1", trackOrder: RESUME_ORDER({ manual_operator: "orange" }) },
  { name: "paiement-attente", path: "/orders/ord_1",
    trackOrder: RESUME_ORDER({ status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] }) },
  { name: "paiement-expire", path: "/orders/ord_1", trackOrder: RESUME_ORDER({ status: "expired" }) },
  { name: "statut-paiement", path: "/orders/ord_1", trackOrder: RESUME_ORDER({ status: "pending_payment", payment_method: "mvola", manual_operator: undefined }) },
  { name: "fiche-produit", path: "/produit/660-uc" },
  { name: "compte", path: "/compte", loggedIn: true },
  { name: "suivi", path: "/suivi", loggedIn: true },
  { name: "fidelite", path: "/compte/points", loggedIn: true },
  // PL-005-FE-01 — historique refait : liste /commandes (onglets + cartes)
  // et detail /commandes/:id (paiement en cours, livree avec coche verte,
  // annulee avec repli preuves/annulation). /orders/me renvoie les quatre
  // familles de statut (la liste filtre localement) ; le detail lit
  // GET /orders/{id} via trackOrder. `refunded` n'existe pas encore cote API
  // (famille preparee) : le mock simule l'etat futur pour mesurer l'or des
  // des que le statut apparaitra.
  // PL-005-FE-02 — la liste vit sur /suivi (CommandButton + OrderHistory
  // embarqué) ; /commandes n'est qu'une redirection replace. `suivi-visiteur`
  // mesure l'état invité (message + bouton de connexion + bouton recherche).
  { name: "suivi", path: "/suivi", loggedIn: true, ordersMe: [
    HISTO_ORDER({ id: "ord_1", status: "pending_payment" }),
    HISTO_ORDER({ id: "ord_2", order_number: "MGS-123457", status: "delivered", paid_at: "2026-11-13T17:00:00Z" }),
    HISTO_ORDER({ id: "ord_3", order_number: "MGS-123458", status: "cancelled", cancel_reason: "cannot_pay_now", cancelled_at: "2026-11-13T17:05:00Z" }),
    HISTO_ORDER({ id: "ord_4", order_number: "MGS-123459", status: "refunded" }),
  ] },
  { name: "suivi-visiteur", path: "/suivi", loggedIn: false },
  { name: "suivi-detail-paiement", path: "/commandes/ord_1", loggedIn: true, trackOrder: HISTO_ORDER({ status: "paid" }) },
  { name: "suivi-detail-livree", path: "/commandes/ord_1", loggedIn: true, trackOrder: HISTO_ORDER({ status: "delivered", paid_at: "2026-11-13T17:00:00Z" }) },
  { name: "suivi-detail-annulee", path: "/commandes/ord_1", loggedIn: true, trackOrder: HISTO_ORDER({ status: "cancelled", cancel_reason: "cannot_pay_now", cancelled_at: "2026-11-13T17:00:00Z", payment_proofs: [{ size: 10, content_type: "image/jpeg" }] }) },
  // Etats du parcours d'identite multi-jeux (messages de verification).
  { name: "verif-invalide", path: "/commande", step: "verify", game: "mobile-legends",
    validate: { valid: false, code: "invalid_id" } },
  { name: "verif-champ-manquant", path: "/commande", step: "verify", game: "mobile-legends",
    validate: { valid: false, code: "missing_field" } },
  { name: "verif-503", path: "/commande", step: "verify", game: "mobile-legends",
    validate: { status: 503, code: "unsupported_game" } },
  { name: "verif-429", path: "/commande", step: "verify", game: "mobile-legends",
    validate: { status: 429, code: "rate_limited" } },
  { name: "verif-html", path: "/commande", step: "verify", game: "mobile-legends",
    validate: { html: true } },
  { name: "verif-succes", path: "/commande", step: "verify", game: "mobile-legends",
    validate: { valid: true, player_name: "TestPlayer" } },
  // Etats de la verification PUBG Mobile (parcours historique), au checkout et
  // sur la page fidelite : meme composant, deux presentations (bouton h-12 ou
  // py-1.5 text-xs).
  { name: "pubg-invalide", path: "/commande", step: "pubg", pubgVerify: { valid: false } },
  { name: "pubg-503", path: "/commande", step: "pubg", pubgVerify: { status: 503 } },
  { name: "pubg-html", path: "/commande", step: "pubg", pubgVerify: { html: true } },
  { name: "fidelite-pubg-invalide", path: "/compte/points", step: "pubg-fidelite", loggedIn: true,
    pubgVerify: { valid: false } },
  { name: "fidelite-pubg-503", path: "/compte/points", step: "pubg-fidelite", loggedIn: true,
    pubgVerify: { status: 503 } },
  { name: "fidelite-pubg-html", path: "/compte/points", step: "pubg-fidelite", loggedIn: true,
    pubgVerify: { html: true } },
  // Pages admin : la navigation (sidebar desktop / barre mobile) et chaque
  // route /admin/* sont auditees en clair et en sombre (MGS-FE-ADMIN-20261105-01).
  { name: "admin-dashboard", path: "/admin", loggedIn: true, admin: true },
  { name: "admin-commandes", path: "/admin/commandes", loggedIn: true, admin: true },
  { name: "admin-catalogue", path: "/admin/catalogue", loggedIn: true, admin: true },
  { name: "admin-jeux", path: "/admin/jeux", loggedIn: true, admin: true },
  { name: "admin-fournisseur", path: "/admin/fournisseur", loggedIn: true, admin: true },
  { name: "admin-paiements", path: "/admin/paiements", loggedIn: true, admin: true },
  { name: "admin-evenements", path: "/admin/evenements", loggedIn: true, admin: true },
  { name: "admin-messages", path: "/admin/messages", loggedIn: true, admin: true },
  // Conversation ouverte (?c=) : la bulle client, les libellés et les dates de
  // ChatThread sont mesurés (MGS-FE-ADMIN-20261105-02).
  { name: "admin-messages-conversation", path: "/admin/messages?c=c1", loggedIn: true, admin: true },
  { name: "admin-fidelite", path: "/admin/fidelite", loggedIn: true, admin: true },
  { name: "admin-utilisateurs", path: "/admin/utilisateurs", loggedIn: true, admin: true },
];

const VIEWPORTS = [
  { label: "390px", width: 390, height: 844, mobile: true },
  { label: "1440px", width: 1440, height: 900, mobile: false },
];
const THEMES = ["light", "dark"];

/* ------------------------------------------------------------------ audit */

// Le fond reellement peint est determine par hit-test (elementsFromPoint) : le
// fond peut venir d'un element positionne en absolu qui n'est pas un ancetre du
// texte (ex. la pastille neon de la barre de navigation). Une simple remontee
// d'ancetres donnerait un faux positif.
const AUDIT = () => {
  // Le deplacement est anime (scroll-behavior: smooth dans index.css) : pendant
  // l'animation, la position mesuree et le hit-test peuvent desynchroniser.
  document.documentElement.style.scrollBehavior = "auto";
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });

  const paintedBg = (x, y, el) => {
    // Si l'element peint lui-meme un fond opaque, c'est ce fond qui est
    // derriere le texte : rien ne peut etre intercale entre les deux.
    const own = parse(getComputedStyle(el).backgroundColor);
    if (own && own.a === 1) return own;
    const chain = new Set();
    let a = el;
    while (a && a !== document.documentElement.parentNode) { chain.add(a); a = a.parentElement; }
    const hits = document.elementsFromPoint(x, y).filter((e) => {
      if (chain.has(e)) return true;
      let p = e;
      while (p && p !== document.documentElement.parentNode) { if (chain.has(p)) return true; p = p.parentElement; }
      return false;
    });
    const stack = [];
    for (const e of hits) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    if (!stack.length) {
      let node = el;
      while (node && node !== document.documentElement.parentNode) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
        node = node.parentElement;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };

  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const txt = n.textContent.trim();
    if (!txt || txt.length < 2) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const elRect = el.getBoundingClientRect();
    // Le rectangle du NOEUD DE TEXTE, pas celui de l'element : un element peut
    // contenir un badge colore avant son texte (le point sonde tomberait alors
    // sur le badge, pas sur les glyphes).
    const range = document.createRange();
    range.selectNodeContents(n);
    const boxes = [...range.getClientRects()].filter((b) => b.width > 1 && b.height > 1);
    const r = boxes[0] || elRect;
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;
    if (r.left < 0 || r.right > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    if (el.classList.contains("sr-only")) continue;
    // Composant inactif : exclu (raison en tete de fichier, exclusion 7).
    if (el.closest("[disabled],[aria-disabled='true']")) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const x = Math.min(Math.max(Math.round(r.left + 3), 0), innerWidth - 1);
    const y = Math.min(Math.max(Math.round(r.top + Math.min(r.height, 16) / 2), 0), innerHeight - 1);
    // Un calque flottant devant le texte l'occulte : c'est une occlusion, pas
    // un probleme de contraste. On ignore ces elements.
    const top = document.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue;
    // L'element a pu bouger entre la mesure et le hit-test (ecran en sortie
    // d'animation) : dans ce cas la position mesuree n'est plus valide. On
    // compare le meme rectangle avant et apres, pas le rectangle de l'element
    // avec celui des glyphes (ils sont differents par construction).
    const after = el.getBoundingClientRect();
    if (Math.round(after.top) !== Math.round(elRect.top) || Math.round(after.left) !== Math.round(elRect.left)) continue;
    const bg = paintedBg(x, y, el);
    const f = fg.a < 1 ? over(fg, bg) : fg;
    const L1 = lum(f.r, f.g, f.b), L2 = lum(bg.r, bg.g, bg.b);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      out.push({
        text: txt.slice(0, 46), ratio: +ratio.toFixed(2), need, size,
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || "")).slice(0, 95),
        color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        topHit: top ? `${top.tagName}.${String(top.className || "").slice(0, 46)}` : "null",
        at: { x, y, top: Math.round(r.top), h: Math.round(r.height) },
      });
    }
  }
  return out;
};

/* ------------------------------------------------------------------ serveur */

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".map": "application/json",
};

const startServer = () =>
  new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      let file = join(BUILD_DIR, decodeURIComponent(url.pathname));
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(BUILD_DIR, "index.html");
      try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolveServer({ server, port: server.address().port }));
  });

/* ------------------------------------------------------------------ parcours */

const click = async (pg, selector, wait = 900) => {
  const el = await pg.$(selector);
  if (!el) return false;
  await el.click();
  await pg.waitForTimeout(wait);
  return true;
};

const fill = async (pg, selector, value) => {
  const el = await pg.$(selector);
  if (!el) return false;
  await el.fill(value);
  await pg.waitForTimeout(200);
  return true;
};

// Amene le checkout a l'ecran demande.
const driveCheckout = async (pg, step) => {
  // PL-005-FE-02 — état du bouton de recherche de /suivi (écran 3, ouvert) :
  // clic sur la pilule pour l'ouvrir (la page est déjà rendue), puis mesure.
  if (step === "recherche") {
    const trigger = await pg.$('[data-testid="command-button-trigger"]');
    if (!trigger) return false;
    await trigger.click();
    await pg.waitForTimeout(600);
    return true;
  }
  // Etat INITIAL de l'ecran de verification : champ vide, donc bouton
  // « Verifier l'ID » desactive. C'est l'etat que voit le client a son
  // arrivee sur le checkout : il doit etre mesure tel quel.
  if (step === "init") return true;
  // Parcours multi-jeux : on remplit les champs d'identite du jeu puis on
  // lance la verification. L'ecran mesure est l'etat affiche APRES la
  // reponse simulee (identifiant refuse, panne, compte verifie...).
  if (step === "verify") {
    await fill(pg, '[data-testid="identity-field-player_id"]', "52328390220");
    await fill(pg, '[data-testid="identity-field-zone_id"]', "123");
    await click(pg, '[data-testid="identity-verify-btn"]', 1200);
    return true;
  }
  // Verification PUBG Mobile / parcours historique : la fiche utilise dans
  // tous les cas le composant generique (identity-field-* / identity-verify-btn,
  // POST /fazercards/validate-id) ; l'ecran mesure est celui affiche APRES la
  // reponse simulee (voir le mock `pubgVerify` ci-dessous).
  if (step === "pubg") {
    await fill(pg, '[data-testid="identity-field-player_id"]', "52328390220");
    await click(pg, '[data-testid="identity-verify-btn"]', 1200);
    return true;
  }
  // Meme verification, sur la page fidelite (presentation reduite).
  if (step === "pubg-fidelite") {
    await fill(pg, '[data-testid="identity-field-player_id"]', "52328390220");
    await click(pg, '[data-testid="identity-verify-btn"]', 1200);
    return true;
  }
  // PL-CHK-2 correctif driver : le flux de vérification est celui du composant
  // générique IdentityFieldsVerify (testids identity-field-* / identity-verify-btn,
  // endpoint POST /fazercards/validate-id). Les anciens testids `pubg-id-input`
  // / `pubg-verify-btn` n'existent plus dans les composants — ils faisaient
  // échouer le pilotage en silence (fill/click inexistants → page non pilotée,
  // état mesuré = écran d'initialisation).
  // PL-CHK-4 — écran unique /commande : les étapes 2 et 3 (et la zone de
  // preuve de l'étape 3) n'existent plus — le tunnel crée la commande au CTA
  // et ouvre /orders/:id. Étapes mesurées : init, vérifié (1), méthode
  // sélectionnée (2), Binance (réseau requis avant CTA).
  await fill(pg, '[data-testid="identity-field-player_id"]', "52328390220");
  await click(pg, '[data-testid="identity-verify-btn"]', 1200);
  // L'état vérifié (ID + pseudo + coche) se mesure ici.
  if (step === 1) return true;
  // Méthode sélectionnée : la remarque courte s'affiche sous la ligne.
  if (step === 2) {
    await click(pg, '[data-testid="method-mvola"]', 600);
    return true;
  }
  if (step === "binance") {
    await click(pg, '[data-testid="method-binance"]', 600);
    await click(pg, '[data-testid="binance-network-BSC"]', 400);
    return true;
  }
  return false;
};

/* ------------------------------------------------------------------ boucle */

const run = async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const summary = [];
  const details = [];
  const broken = [];
  let total = 0;

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const page of PAGES) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
        });
        const pg = await ctx.newPage();
        const game = page.game || "pubg-mobile";
        const cart = JSON.stringify([
          { id: game === "pubg-mobile" ? "p1" : "m1", slug: "660-uc", name: "660 UC", price: 2500, qty: 1, type: "uc", game_id: game },
        ]);
        await pg.addInitScript(
          `try{
            localStorage.setItem('mgs-theme','${theme}');
            localStorage.setItem('mgs_lang','fr');
            localStorage.setItem('mgs_selected_game','${game}');
            localStorage.setItem('mgs_cart', ${JSON.stringify(cart)});
          }catch(e){}`,
        );
        await pg.route("**/api/**", (route) => {
          const p = new URL(route.request().url()).pathname;
          if (p.includes("/auth/me")) {
            const authenticated = page.loggedIn && page.admin ? ADMIN_USER : page.loggedIn ? USER : {};
            return route.fulfill({
              status: page.loggedIn ? 200 : 401,
              contentType: "application/json",
              body: JSON.stringify(authenticated),
            });
          }
          // Verification PUBG Mobile (parcours historique) : le meme contrat
          // que la multi-jeux, sur l'endpoint /fazercards/pubg/validate-id.
          // ATTENTION : cette route contient aussi « validate-id » -> elle doit
          // passer AVANT celle du multi-jeux.
          if (p.includes("/fazercards/pubg/validate-id")) {
            const v = page.pubgVerify || { valid: true, player_name: "TestPlayer" };
            if (v.html) {
              return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>passerelle</body></html>" });
            }
            if (v.status) {
              return route.fulfill({
                status: v.status,
                contentType: "application/json",
                body: JSON.stringify({ detail: "upstream failure" }),
              });
            }
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v) });
          }
          // Reponse de verification simulee : c'est elle qui decide de l'etat
          // affiche (invalide, panne, compte verifie, reponse non-JSON).
          // Le front appelle POST /fazercards/validate-id pour tous les jeux
          // (IdentityFieldsVerify) : les pages `pubgVerify` dirigent donc ce
          // meme endpoint ici (l'ancien appel /fazercards/pubg/validate-id
          // n'existe plus dans les composants).
          if (p.includes("validate-id")) {
            const fallback = page.validate || { valid: true, player_name: "TestPlayer" };
            if (page.pubgVerify && !page.validate) {
              const v = page.pubgVerify;
              if (v.html) {
                return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>passerelle</body></html>" });
              }
              if (v.status) {
                return route.fulfill({
                  status: v.status,
                  contentType: "application/json",
                  body: JSON.stringify({ detail: "upstream failure" }),
                });
              }
              return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v) });
            }
            const v = fallback;
            if (v.html) {
              return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>passerelle</body></html>" });
            }
            if (v.status) {
              return route.fulfill({
                status: v.status,
                contentType: "application/json",
                body: JSON.stringify({ detail: "upstream", code: v.code }),
              });
            }
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v) });
          }
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockApi(p, page)) });
        });
        try {
          await pg.goto(base + page.path, { waitUntil: "domcontentloaded", timeout: 30000 });
          await pg.waitForSelector("body", { timeout: 15000 });
        } catch { /* page indisponible : signale plus bas */ }
        await pg.waitForTimeout(2000);
        if (page.step) await driveCheckout(pg, page.step);

        // Parcourir toute la page : chaque element n'est mesure que visible.
        const height = await pg.evaluate(() => (document.body ? document.body.scrollHeight : 0));
        if (!height) {
          // Page non chargee : elle n'est PAS comptee comme conforme. On la
          // signale et le script sort en erreur.
          broken.push(`${page.name} (${vp.label}, ${theme})`);
          summary.push({ page: page.name, viewport: vp.label, theme, failures: null });
          await ctx.close();
          continue;
        }
        const step = Math.floor(vp.height * 0.8);
        const found = new Map();
        for (let y = 0; y < height; y += step) {
          await pg.evaluate((v) => window.scrollTo(0, v), y);
          await pg.waitForTimeout(300);
          for (const f of await pg.evaluate(AUDIT)) {
            const key = `${f.text}|${f.cls}|${f.color}`;
            if (!found.has(key)) found.set(key, f);
          }
        }
        const res = [...found.values()];
        total += res.length;
        summary.push({ page: page.name, viewport: vp.label, theme, failures: res.length });
        for (const f of res) details.push({ ...f, page: page.name, viewport: vp.label, theme });
        await ctx.close();
      }
    }
  }

  await browser.close();
  server.close();

  const names = PAGES.map((p) => p.name);
  const head = ["page".padEnd(26), ...VIEWPORTS.flatMap((v) => [`${v.label} clair`.padEnd(14), `${v.label} sombre`.padEnd(15)])];
  console.log("\n================ CONTRASTE : ECHECS PAR PAGE ================");
  console.log(head.join(""));
  for (const name of names) {
    const cells = [];
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const s = summary.find((x) => x.page === name && x.viewport === vp.label && x.theme === theme);
        cells.push(String(s ? (s.failures === null ? "NON CHARGEE" : s.failures) : "?").padEnd(14));
      }
    }
    console.log(name.padEnd(26) + cells.join(""));
  }
  console.log(`\n  TOTAL : ${total} echecs`);
  if (broken.length) {
    console.log(`\n  PAGES NON CHARGEES : ${broken.length} (a corriger, ce n'est pas un succes)`);
    for (const b of broken) console.log(`   - ${b}`);
  }

  if (details.length) {
    console.log("\n================ PAR COMPOSANT ================");
    const byCls = new Map();
    for (const f of details) {
      const k = f.cls.slice(0, 72);
      if (!byCls.has(k)) byCls.set(k, { n: 0, sample: f, combos: new Set() });
      const e = byCls.get(k);
      e.n++;
      // La ou la classe echoue : permet de verifier « 0 sur les 4
      // combinaisons » pour une famille de classes donnee.
      e.combos.add(`${f.page} ${f.viewport} ${f.theme}`);
    }
    for (const [k, v] of [...byCls.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${String(v.n).padStart(3)}x  ${v.sample.ratio} (min ${v.sample.need}) ${String(v.sample.size).padStart(4)}px  "${v.sample.text}"  ${v.sample.color} sur ${v.sample.bg}`);
      console.log(`        .${k}`);
      if (v.sample.topHit) console.log(`        hit: ${v.sample.topHit} at ${JSON.stringify(v.sample.at)}`);
      console.log(`        ou: ${[...v.combos].join(" | ")}`);
    }
  }
  process.exit(total > 0 || broken.length ? 1 : 0);
};

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
