# DESIGN-PORT.md — PL-DS-002-V1 (Phase 0, inventaire en lecture seule)

**Branche :** `feat/design-system-pages` (créée depuis `main`, HEAD `224f961`).
**Référence de design approuvée :** `design-system-v3.html` (prototype statique Slush « Defi »,
itéré et validé par le propriétaire en PL-DS-001 : 8 correctifs + chips d'IDs récents).
**Source des tokens/composants :** `DESIGN-SYSTEM-TEMPLATE.md` + `maquettes/design-system.css` (CSS Slush verbatim).

## Hypothèses (mode sans propriétaire)

1. La « référence approuvée » du prompt (placeholder non rempli) est `design-system-v3.html`,
   le prototype que le propriétaire vient de valider. Le langage visuel est Slush Defi :
   fond encre + panneaux crème, fontes Bricolage Grotesque / Onest, boutons `button-main`,
   cartes crème/encre rayon 28 px, accents néon sur encre.
2. **La reconstruction Slush du frontend React est DÉJÀ fusionnée dans `main`** :
   PR #108 « feat/design system pages » (`224f961`) + travaux antérieurs PL-005-FE-03/04,
   PL-UX-3/4 (chips d'IDs récents), PL-CHK-1 (statut ID coche + pseudo). La branche distante
   `origin/feat/design-system-pages` (12 commits `style(...)`) est la branche pré-fusion,
   désormais stale (squash #108, non-ancêtre de `main`).
3. Le prompt est un mandat de reconstruction ; comme la présentation est déjà en place,
   le travail restant est **vérification de parité + robustesse catalogue**, pas une refonte
   spéculative. Règle d'or respectée : ne rien inventer, ne pas décider quand la référence est muette.

## État des lieux vérifié (commandes réelles)

- `yarn build` (avec `REACT_APP_BACKEND_URL` exporté depuis `.env.example`) : **VERT** (62 s, main.js 434 Ko, main.css 20 Ko).
- `yarn test:ci` : **VERT — 45 suites / 532 tests**.
- Polices marque déjà en place (`index.css:14-15`, `public/index.html`) ; palette crème/encre/néon tokenisée
  (`index.css:30-88`) ; `SlushChrome` (`SlushChrome.js:34`) pose `body[data-page]` (fond encre + panneaux crème).
- `Home.js` = refonte Slush complète (`button-main`, `page-hero/h-d`, marquee animé via `lib/slush.js`,
  `two-col-grid`, `step-card`, `trust-grid`, `reviews-grid`, `faq-list`).
- `ProductCard.js:39` = carte maquette (crème `--card-surface`, bordure encre `--card-border`, rayon 28 px,
  pilule prix blanche `--card-pill-bg`, CTA encre, badge flamme « populaire », remise, stepper, favori).
- `IdentityFieldsVerify.js:39` = **chips d'IDs récents déjà présents** (PL-UX-3/4 : une seule ligne, plus récents
  d'abord, plus anciens masqués via `ResizeObserver`, pastilles sobres 44 px, `localStorage` seul) +
  **statut ID coche + pseudo** (PL-CHK-1, plus de libellé « ID JOUEUR »).
- `formatAr` (`lib/api.js`) = `toLocaleString('fr-FR')` avec espaces → **grands prix déjà espacés** (871 000 Ar).

## Tableau par page

| Page | Référence (`design-system-v3.html`) | Fichier React (ligne) | Appels API conservés | Données design sans source API | Risque |
|---|---|---|---|---|---|
| Accueil | `data-page="accueil"` | `Home.js:369` | `GET /events`, `GET /products` | avis « exemple » neutres de la maquette (marqués exemple) ; eyebrow = jeux réels | bas |
| Page jeu + catalogue | `data-page="boutique"` | `Games.js:19`, `Catalog.js:84`, `ProductCard.js:39` | `GET /products` | prix/ID « exemple » maquette → remplacés par données réelles ; badges « populaire » = backend | moyen (bascule fournisseur) |
| Produit | `data-page="produit"` | `Product.js:16` | `GET /products/:slug` | — | bas |
| Panier | drawer (pas de page dédiée) | `CartDrawer.js:19` | état panier local (`CartContext`), pas d'API directe | — | moyen |
| Connexion / inscription | `data-page="connexion"` | `AuthPage.js:17`, `AuthExtras.js` | `POST /auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` | — | **élevé** (auth) |
| Compte | `data-page="compte"` | `Account.js:109` | `GET /loyalty/me`, `PATCH /auth/me`, `POST /auth/change-password`, `/auth/me/delete`, `/auth/resend-verification` | — | **élevé** (auth / suppression) |
| Points | `data-page="points"` | `Loyalty.js:137` | `GET /loyalty/me`, `/loyalty/rewards`, `/loyalty/transfers`, `POST /loyalty/redeem`, `/loyalty/transfers`, `/loyalty/transfers/:id/:action` | — | moyen |
| Suivi de commande | `data-page="commandes"` | `OrderTrack.js:417`, `OrderHistory.js:287` | `GET /orders/track`, `/orders/:id`, `/orders/me`, `/crypto/:id/status`, `/payments/:id/status`, `/payments/config`, `POST /payments/initiate`, `GET /products/:slug` | reçu PNG = canvas local (pas d'API) | **élevé** (paiement / statut) |
| Paiement (checkout) | `data-page="commande"` | `Checkout.js:49`, `checkout/CheckoutSheet.js`, `IdentityFieldsVerify.js:39`, `ProofPay.js`, `PaymentCountdown.js`, `BinancePay.js`, `CancelSheet.js` | `GET /crypto/config`, `/payments/config`, `POST /crypto/initiate`, `/me/game-identities`, `/orders`, `/fazercards/validate-id` | n° marchand / USSD = placeholders `···` (servis par le backend) ; chips IDs récents = `localStorage` | **élevé** (paiement) |
| Pack évolutif | `data-page="pack"` | `PackEvolutif.js:13` | `GET /evo/eligibility`, `/evo/season`, `/products` | — | moyen |
| Événements | `data-page="evenements"` | `Events.js:11` | `GET /events`, `POST /events/:id/like`, `/events/:id/share` | image événement = backend (pas de fallback) | bas |
| Support | `data-page="support"` | `Support.js`, `Chat.js:6` | chat | — | bas |
| Admin | `data-page="admin"` | `pages/admin/*` | multiples (hors scope client) | — | moyen |

## Le catalogue réel va changer — déjà supporté (vérifié)

Exigence prompt : 6 lots UC (60, 325, 660, 1 800, 3 850, 16 200), « populaire » sur 325 et 660,
prix jusqu'à 871 000 Ar, Prime/Prime+/Evo masqués, grille tenant 6 cartes, grands nombres espacés,
aucun onglet/titre/section vide.

- **Grille 6 cartes :** `Catalog.js:24` `grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4` → 6 cartes tiennent (2/3/4 colonnes).
- **Grands nombres espacés :** prix via `formatAr` (`lib/api.js`) → `871 000 Ar`. Figure UC rendue brute
  (`productFigure`, `lib/catalog.js:17`) = **fidèle à la référence** (le prototype affiche 1800/3850/660 bruts)
  et **verrouillée par `ProductCard.test.js:239`** (`montant.textContent === "310"`). Non modifiée.
- **Aucune section vide :** `ProductSection` retourne `null` si `!products?.length` (`Catalog.js:20`) → ni titre ni section Prime/Évo vide.
- **Aucun onglet vide :** onglets issus de `currentGame.product_types` (`Catalog.js:126`) → si le backend masque Prime/Prime+/Evo, les onglets disparaissent.
- **Badges « populaire » :** `p.popular` backend, plafonné à 3 (`Catalog.js:146`) → 325+660 = 2 badges.
- **Verrou ajouté :** test de régression `Catalog.test.js` « bascule fournisseur 6 lots UC » (onglets réduits à UC, sections Prime/Évo absentes, compte 6, grand prix espacé).

## Besoins backend (pour l'agent backend)

- **Catalogue (bascule fournisseur)** — page PUBG Mobile : ne publier que 6 lots UC
  (60, 325, 660, 1 800, 3 850, 16 200) ; masquer Prime / Prime+ / Evo (retirer ces types de
  `game.product_types` ET les produits correspondants de `/products`) ; marquer `popular:true`
  sur 325 et 660 ; prix jusqu'à 871 000 Ar. *Le frontend supporte déjà ce scénario (voir ci-dessus).*
- **Numéro marchand / code USSD** — écran de paiement : valeurs réelles servies par
  `GET /payments/config` (la maquette ne montre que des placeholders `···`, rien n'est inventé côté front).
- **Image d'événement** — `GET /events` : fournir `image_url` (le front l'affiche seulement si présente, pas de fallback).
- Aucun autre besoin backend identifié : les chips d'IDs récents et le reçu PNG sont 100 % locaux
  (`localStorage` / canvas), sans appel API.

## Points ouverts (cas non couverts par la référence / défauts vus non corrigés)

- **Anatomie Slush vs utilitaires Tailwind :** `Home` + chrome (Header/BottomNav/Layout) sont en Slush
  complet (`button-main`, `h-d`, panneaux). Plusieurs pages (onglets/filtres `Catalog`, `Checkout`,
  `Account`, `AuthPage`, `Events`, `PackEvolutif`) rendent encore en utilitaires Tailwind **dans le même
  langage visuel crème/encre/néon** (tokenisé par PR #108), pas en classes Slush littérales. Pousser chaque
  page vers l'anatomie Slush littérale est une décision de refonte : la référence étant muette sur ces cas,
  **non décidé** (règle d'or). À arbitrer par le propriétaire. Le rendu visuel est déjà cohérent.
- **Référence = projet séparé :** `design-system-v3.html` est un prototype statique (vanilla JS/GSAP,
  autre framework). Conformément au principe « reconstruire la présentation, garder la logique », seul le
  STYLE est emprunté ; aucune logique n'est copiée d'un projet à l'autre. La logique React (routes,
  `lib/api.js`, panier, checkout, Turnstile, push, tests) est intacte.
- **Figure UC brute :** 1800 / 16200 s'affichent sans séparateur (fidèle référence + verrouillé par les
  tests). Seuls les PRIX sont espacés (`formatAr`). Non modifié.
- **Branche distante stale :** `origin/feat/design-system-pages` n'est pas ancêtre de `main` (squash #108).
  La branche locale est créée depuis `main` ; un push normal serait non-fast-forward (rejeté), et `--force`
  est interdit → **pas de push** (voir rapport). Le propriétaire pourra réconcilier la branche distante.

## Résumé des risques

- **Élevé :** connexion/inscription, compte (auth + suppression), suivi/paiement (statut, preuve, expiration,
  annulation). Toute modification de présentation sur ces pages doit préserver validations et données envoyées.
- **Moyen :** catalogue (bascule fournisseur), panier, points, pack évolutif, admin.
- **Bas :** accueil, produit, événements, support.

## Arrêt propre

Arbre laissé propre (tout commité sur `feat/design-system-pages`). Aucun fichier backend modifié, aucune
dépendance ajoutée, aucun secret lu. Les non-suivis admis (`graphify-out/`, `design-system-v2.html`,
`design-system-v3.html`) sont conservés tels quels.