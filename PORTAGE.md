RÉFÉRENCE = PR #100 = b34df6e 2026-11-14 « PL-005-FE-02: … (#100) »
(l'état de `main` juste après la fusion de la PR #100).

Preuve :

```
$ git log --first-parent --format='%h %ad %s' --date=short main | grep -E '#100([^0-9]|$)'
b34df6e 2026-11-14 PL-005-FE-02: … (#100)
$ git log -1 --format='%h %p' b34df6e          # fusion « squash » : un seul parent
b34df6e 05e35b4
$ git log -1 --format='%h %p' b34df6e^
05e35b4 dd22cbb                                # commit juste avant
$ git log -1 --format='%h %p' 3cdf977
3cdf977 b34df6e                                # commit juste après
```

`REF` = `b34df6e` dans tout ce fichier. Toute lecture de REF se fait par
`git show b34df6e:<fichier>` (jamais de `checkout`). Les PR suivantes et l'état
actuel de `main` ne sont PAS une source : `git diff b34df6e main -- frontend/src`
montre 85 fichiers et 4 142 insertions — aucune ligne de `main` postérieure à
REF n'a été reprise. Le présent fichier remplace l'inventaire S0 établi contre
l'état courant de `main` (ses tableaux citaient `main` sans hash et des lignes
postérieures à REF) ; il est réécrit contre REF, avec les trois seuls états
autorisés.

# PORTAGE — application `REF` → prototype statique

Chaque ligne porte exactement un état :

- **fait** — comportement de REF reproduit, avec `REF:fichier:ligne`, la route
  backend (`backend/fichier:ligne`) et l'emplacement dans le prototype.
- **masqué** — élément du design SANS équivalent dans REF : neutralisé
  (`hidden`, `style.display`, `disabled`), défaisable en une ligne, listé en
  § « Éléments masqués ».
- **NON FAIT** — avec la cause exacte (design sans conteneur, écran absent,
  fonction non déclenchable…).

Le prototype vit dans `frontend/public/index.html` : gabarit (design v3,
lignes 1-3500) puis runtime fonctionnel (IIFE, lignes 3501-fin). Deux modules
hors DOM : `frontend/public/mgs-logic-captcha.js` (`MGS_CAPTCHA`) et
`frontend/public/mgs-logic-crypto.js` (`MGS_CRYPTO`).

Règles tenues : aucun `.css` modifié (`git diff --stat -- '*.css'` vide) ;
aucune valeur de `class=`/`style=` changée (contrôle `git diff --unified=0`
ligne à ligne avant chaque commit) ; aucun nouvel élément visible (les seuls
`createElement` remplissent des conteneurs prévus par la feuille de style du
design : `.mgs-co-recent`, `.mgs-empty`, `.mgs-pcard` clonés) ; aucun texte
inventé (dictionnaire T en parité FR/EN ; `auth.googleError` est la seule clé absente de REF — libellé codé en dur dans `AuthCallback.js:21`) ; aucune
dépendance ajoutée ; `backend/` jamais modifié ; adresse du backend alignée sur
le runtime (`mgs-logic-crypto.js:24` ← `index.html:3526`).

---

## Z0 — Socle (client API, session, erreurs, i18n, panier, invité)

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Base d'URL + cookies (`withCredentials`) | `lib/api.js:3-6` | — | `index.html:3511-3512`, `req` | fait |
| Refresh 401 silencieux, une seule demande partagée, bornée à 15 s, hors liste d'auth | `lib/api.js:12-38` | `POST /auth/refresh` (`routers/auth.py:363`) | `NO_SILENT_REFRESH` `:3548`, `refreshSession`, `req` | fait |
| Un refresh 401 remonte le 401 d'origine ; toute autre panne remonte SA propre erreur (jamais de déconnexion à tort) | `lib/api.js:27-34` | — | `req` | fait |
| Message d'erreur affichable (detail chaîne / tableau de validation / objet) | `lib/api.js:40-46` | — | `errMsg` ; écart 1 ci-dessous | fait |
| Restauration de session au chargement (401 = déconnecté ; panne = 2 reprises 3 s/8 s puis hors ligne, sans message) | `context/AuthContext.js:27-53` | `GET /auth/me` (`routers/auth.py:387`) | `loadSession` | fait |
| Déconnexion (le panier N'EST PAS vidé) | `context/AuthContext.js:58-61` | `POST /auth/logout` (`routers/auth.py:404`) | `logout` | fait |
| Traductions `t()` FR/EN | `i18n/translations.js` (995/995) | — | `T`, `t` | fait — dictionnaire T en parité FR/EN ; 1 clé hors REF (`auth.googleError`) |
| Redirection des pages protégées (`/compte`, `/compte/points`, `/admin`, `/commandes/:orderId`) | `components/ProtectedRoute.js:29-30` ; `App.js:66,80-82` | — | `needLogin`, garde du loader `commandes` | fait |
| Panier : clé `mgs_cart`, un seul jeu, un Prime + un Prime+, évo = 1, plafond 20 | `context/CartContext.js:10-34` | — | `cart` `:3663`, `addToCart`, `cartCap` | fait |
| Favoris (`localStorage`, clé `mgs_favorites`) | `lib/favorites.js:3,41-48` | — | `getFavs()`/`toggleFav()`/`syncFavs` | fait |
| Commande en attente : **une** clé `mgs_pending_order_id` = `{id, createdAt}`, TTL 24 h, purge sur statut final | `lib/pendingOrder.js:13-30,37,47,63-69` | — | `PENDING_KEY` `:3844-3859` | fait |
| IDs joueur récents : `mgs_recent_player_ids` = `{[gameId]:[{id,usedAt}]}`, 10/jeu, sans pseudo | `lib/recentPlayerIds.js:15,52-99` | — | `readRecentStore`, `recentIdsOf`, `rememberPlayerId` | fait |
| Identifiant de session anonyme (`mgs_session`, forme `s_…`) | `lib/api.js:50-56` | — | `sessionId` | fait |
| Pastille de points masquée sans compte **ou** sans réponse de `/loyalty/me` | `components/layout/Header.js:29-35` | `GET /loyalty/me` (`routers/loyalty.py:60`) | `syncAuthChrome`, `updatePointsPill` | fait |
| `/commandes` n'est pas protégée : l'invité voit l'état vide `order.loginToSee` | `components/common/OrdersRedirect.js:8` ; `App.js:67` | — | `loadOrders`, `renderOrders` | fait |

Corrections Z0 de cette session (Phase V — comparaison à REF) :

1. `errMsg` : algorithme de `REF:lib/api.js:40-46` (avant : cas particuliers 401/403/réseau inventés).
2. `req()` : refresh partagé + délai de 15 s + remontée correcte de l'erreur (avant : renvoyait toujours le 401 d'origine).
3. Panier vidé à la déconnexion (`224ca8c`) : plus présent ; vérifié, rien à retirer.

---

## Z1 — Authentification

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Connexion : `POST /auth/login` `{email, password, remember, captcha_token}`, `data.user` posé tel quel | `pages/AuthPage.js:44-53` | `POST /auth/login` (`routers/auth.py:195-211`) | `doAuth` | fait |
| Inscription : `POST /auth/register`, **pas** de second login, message « email de vérification envoyé » | `pages/AuthPage.js:44-53` | `POST /auth/register` (`routers/auth.py:166-193`) | `doAuth` | fait ; `remember` non envoyé à l'inscription — écart 2 |
| « Se souvenir » coché par défaut, envoyé en `remember` (connexion) | `pages/AuthPage.js:22,25,102` | `POST /auth/login` | `boot`, `doAuth` | fait |
| Validation du formulaire : nom ≥ 2, mot de passe ≥ 8 (inscription) / ≥ 6 (connexion), email | `pages/AuthPage.js:88,93,100` | — | `doAuth` | fait (en JS : le design n'a ni `required` ni `minlength`, et la règle 1 n'autorise pas à les ajouter) |
| Messages d'auth par code, sinon statut HTTP, sinon repli — jamais le détail anglais | `lib/authErrors.js:12-64` | réponses 400/401/403/409/422/429/5xx | `authErr` | fait |
| Captcha Turnstile : monté si la clé publique existe ; inscription ou connexion déjà échouée ; `always` si l'API l'exige | `pages/AuthPage.js:26-37,108,115` ; `components/common/CaptchaWidget.js:110-116` | `captcha.require` (`routers/auth.py:113-133,169,199`) | `renderAuthCaptcha`, `syncAuthCaptcha` | fait |
| Jeton à usage unique : tout échec rend le contrôle au client | `pages/AuthPage.js:57-61` | — | `doAuth` | fait (corrigé cette session) |
| Redirection après connexion vers la page d'origine (`from`), accueil par défaut ; déjà connecté → même redirection | `pages/AuthPage.js:38,40,53` | — | `authReturnTo` `:4447`, `loaders.connexion` `:4754` | fait |
| Mot de passe oublié : envoi, message inline, captcha, erreurs traduites | `pages/AuthExtras.js:42-50` | `POST /auth/forgot-password` (`routers/auth.py:222-241`) | `forgotPassword`, `renderForgotCaptcha` | fait |
| Réinitialisation par jeton (`/reinitialiser/:token`), 8 car. min., confirmation identique, lien invalide → message | `pages/AuthExtras.js:65-78` ; `App.js:76` | `POST /auth/reset-password` (`routers/auth.py:244-253`) | `resetPassword`, `resetTokenFromUrl` | fait |
| Vérification d'email (`/verifier-email/:token`) : jeton consommé au chargement, session rafraîchie | `pages/AuthExtras.js:90-97` ; `App.js:77` | `POST /auth/verify-email` (`routers/auth.py:213-220`) | `verifyTokenFromUrl`, `boot` | fait (écran dédié absent du design → « manquants ») |
| Connexion Google : `/auth/google/start?return_to=…` | `components/AuthCallback.js:8-11` | `GET /auth/google/start` (`routers/auth.py:288-317`) | `googleLogin` | fait |
| Retour Google (échec `?error=google`) : message + URL nettoyée | `components/AuthCallback.js:14-28` | `GET /auth/google/callback` (`routers/auth.py:319-360`) | `handleGoogleError()` — clé `auth.googleError` | fait — REF code le texte en dur (« Connexion Google impossible. Réessayez. ») ; FR repris tel quel, EN = traduction littérale (« Google sign-in impossible. Try again. ») |
| Adresse du backend : `https://api.magicgame.store` (confirmée par le propriétaire) | — | `GET /api/auth/google/config` → `{"enabled":true}` | `BACKEND` `:3511` | fait — l'ancien host posait le cookie `oauth_state` sur son domaine alors que le callback Google revient sur `api.magicgame.store` (state introuvable → `?error=google`) |
| Formulaires de connexion/inscription/envoi réels (le gestionnaire de mots de passe du navigateur repropose les comptes) | `pages/AuthPage.js:83` (`<form onSubmit>`) | — | `#mgs-auth-form`, `#mgs-mdp-form`, `#mgs-reset-form` `:2533-2552,2548,2565` | fait |
| Module captcha vérifié conforme | `components/common/CaptchaWidget.js:103-122` ↔ `mgs-logic-captcha.js:138-150` | — | — | fait |

---

## Z2 — Catalogue, recherche, fiche produit, panier, favoris

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Liste des jeux (filtre `active`, tri `sort_order`, liste vide → gabarit conservé, icône cassée → icône du design) | `context/GameContext.js:42-52` ; `components/game/GameCard.js:63-65` | `GET /games` (`routers/games.py:53`) | `loadGames`, `renderGames` | fait |
| Catalogue : `game, type, q, sort, popular, favorites, min_price, max_price` (rien d'autre) | `pages/Catalog.js:118,142,244` | `GET /products` (`routers/products.py:75`) | `qs`, `catalogQuery`, `loadCatalogFor` | fait |
| Puces du design : 0 = populaire (`popular=1`), 1 = prix croissant/décroissant (`sort`) | `pages/Catalog.js:244,118` | `GET /products` | clic `:4791` (`applyCatalogQuery`) | fait |
| Options de tri de REF sans conteneur (`sortDefault`, `unit_price` non accepté par l'API) | `pages/Catalog.js:118` | `routers/products.py:78` | — | NON FAIT (design : 2 puces, aucune liste à 4 options) |
| Recherche `q` | `pages/Catalog.js:142` | `GET /products` | `catalogQuery` | fait |
| Fiche produit + état d'erreur (slug inconnu) | `pages/Product.js:81-93` | `GET /products/{slug}` (`routers/products.py:118`) | `openProduit`, `renderProduit`, `renderProduitError` | fait |
| Fiche produit : `related` (4) | `pages/Product.js:145-149` | `GET /products/{slug}` | — | NON FAIT (design : pas de conteneur « related ») |
| Panier : règles complètes | `context/CartContext.js:16-34,49-53` | — | `addToCart`, `syncPill`, `cartCap`, `syncPillsFromCart` | fait |
| Favoris : bascule + filtre catalogue côté client | `lib/favorites.js:41-48` ; `pages/Catalog.js:155-157` | `GET /products?favorites` | `toggleFav`, `renderCatalog` | fait |
| Accueil : rubans populaires / abonnements | `pages/Home.js:430-457` | `GET /products` | — | NON FAIT (design : hero, deux colonnes, marquee — aucun conteneur produits) |
| Accueil : événements | `pages/Home.js:407` | `GET /events` (`routers/events.py:46`) | `renderEvents` (pré-chargé par `loaders.accueil`) | fait |
| Pack évolutif embarqué dans l'onglet `evo` du catalogue | `pages/Catalog.js:13,243,274` ; `pages/PackEvolutif.js:41-43` | `GET /products?type=evo`, `GET /evo/season` | `?type=evo` filtré par le catalogue ; pack sur son écran `packVerify` | NON FAIT (design : pas d'onglets de type) |
| Règles ajoutées par d'autres agents après REF (`3a3ed0c`, `af89a88`, `224ca8c`, `5871a5b`, `5895a64`) | — | — | voir ci-dessous | traité |

Leçon des 5 commits post-REF, vérifiés un par un cette session :

- `3a3ed0c` (panier : un seul jeu, plafonds) — **règle équivalente dans REF**
  (`CartContext.js:16-34`) : conservée.
- `af89a88` (tri client par prix absolu sur les puces) — déjà retiré par
  `194533a` ; plus aucune trace (`sortCatalog`, `catalogSort`, `catalogOriginal`
  absents) : rien à faire.
- `224ca8c` — `co.busy` (anti double-clic) : équivalent REF (`Checkout.js:71`
  `inFlight`) → conservé ; `cart = []` à la déconnexion : plus présent ;
  compteur « Jeux liés » : masqué (voir « Éléments masqués ») ; clés
  `points.redeem` / `points.pidPrompt` / `catalog.sort*` : déjà retirées du
  dictionnaire.
- `5871a5b` — favoris (équivalent REF `lib/favorites.js`) : conservés ; IDs
  récents : remplacés par la forme de REF (`mgs_recent_player_ids`).
- `5895a64` — pastille points invité : équivalent REF (`Header.js:33-35`) →
  conservé ; redirection invité `/commandes` → connexion : **aucun équivalent
  REF** (`OrderTrack.js:539-549` affiche `order.loginToSee`) → déjà retirée par
  `b347483`, vérifié ; `mgsSetNav` forçant « boutique » sur l'accueil : **aucun
  équivalent REF** (`Header.js:225`, `NavLink to="/boutique" end`) → **retirée
  cette session**.

---

## Z3 — Paiement (identité, méthode, commande, preuve, annulation, attente, Binance)

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Commander sans compte (aucune redirection vers la connexion) | `pages/Checkout.js:250-264` ; `routers/orders.py:315-321` (`get_optional_user`) | `POST /orders` | `createOrder` (aucun `needLogin`) | fait |
| Point de départ de l'ID : `?pubg_id`, sinon `mgs_last_player_id`, sinon `saved_pubg_ids[0]` ; modification mémorisée | `pages/Checkout.js:56-59,80-83` | — | `coOpen`, écouteur `input` `:4386` | fait |
| Validation locale du champ (requis, `min_length`, `max_length` 60, motif en correspondance totale) avant tout appel | `components/store/checkout/IdentityFieldsVerify.js:20-35,78-87` | — | `fieldLocalError`, `fieldMessage`, `verifyId` | fait |
| Vérification d'ID : `POST /fazercards/validate-id {game_id, fields}`, champs tirés de `identity_fields` du jeu | `IdentityFieldsVerify.js:96-115` | `POST /fazercards/validate-id` (`routers/fazercards.py:118`) | `identitySpecOf`, `primaryKeyOf`, `verifyId` | fait |
| Table des verdicts (refus / saisie / indisponible), jamais un détail brut | `lib/identityErrors.js:16-38` | codes `invalid_id`, `missing_field`, 422/429/502/503/504 | `identityErrorKey` | fait |
| Suggestions d'IDs déjà utilisés : visibles tant que l'ID n'est pas vérifié, un clic **remplit sans vérifier** | `IdentityFieldsVerify.js:150-152,185-188,257-273` | — | `renderRecent`, clic `:4791` | fait |
| Identité mémorisée : `POST /me/game-identities` après vérification réussie, si connecté ; échec sans conséquence | `pages/Checkout.js:132-141` | `POST /me/game-identities` (`routers/games.py:110-127`, idempotent `:122-126`) | `saveIdentity` | fait |
| Liste/édition des identités sauvegardées (CRUD du compte) | `components/GameIdentities.js:44-63` | `GET/PATCH/DELETE /me/game-identities` (`routers/games.py:103-152`) | — | NON FAIT (design : l'écran compte n'a aucune section « identités ») |
| Méthode de paiement : `mvola` / `orange` (manuel) / `binance`, selon `providers.*.configured !== false` et `crypto.available` | `pages/Checkout.js:100-106,330-341` | `GET /payments/config` (`routers/payments.py:194`), `GET /crypto/config` (`routers/crypto.py:107`) | `loadPayCfg`, `coOpen` | fait |
| Opérateur transmis (`manual_operator`) | `pages/Checkout.js:181` | `POST /orders` | `createOrder` | fait |
| Sélecteur de réseau USDT (NetworkPicker) | `pages/Checkout.js:335-339` ; `components/store/PaymentFlow.js:32-50` | `GET /crypto/config` | `renderNetworks` — affiché dès Binance + au moins un réseau, aucune présélection, commande refusée sans choix | fait |
| Création de commande : payload exact + `identity_id` quand l'identité vérifiée est celle du compte | `pages/Checkout.js:165-188` | `POST /orders` (`routers/orders.py:315`, `OrderIn` `:64-82`) | `createOrder` | fait |
| 422 Pydantic traduite (`payment_phone` → `checkout.phoneError`, sinon `checkout.orderValidationError`) | `pages/Checkout.js:39-47` | `POST /orders` | `validationDetails`, `validationField` | fait |
| Panier vidé DÈS la création réussie | `pages/Checkout.js:186` | — | `createOrder` | fait |
| Commande transmise à l'admin dès la création | `pages/Checkout.js:185-188` | `notify_new_order` en tâche de fond (`routers/orders.py:421`) | rien à appeler côté front : le backend notifie (idem preuve envoyée `:608`, relance `:660`) | fait (backend) |
| Message d'attente = statut réel (`order.next.<statut>`) + libellé (`order.status.<statut>`) | `pages/OrderTrack.js:264-270` | `GET /orders/{id}` (sondage 5 s) | `coWaitText`, appelé par `coReceipt`, `coReceiptBinance`, `pollOrder` | fait |
| Turnstile à la soumission (jeton à usage unique) | `pages/Checkout.js:228-246,365-380` | `captcha.require` (ordre) | `openHuman`, `createOrder` | fait |
| Anti double-clic (une seule requête en vol) | `pages/Checkout.js:70-71,190-204` | — | `co.busy` `:4109` | fait |
| Écran de paiement manuel : nom du marchand et numéro **issus de l'API**, compte à rebours sur `payment_deadline_at` | `pages/OrderTrack.js:272,299-324` | `GET /payments/config`, `GET /orders/{id}` | `coPay` | fait |
| Sondage du paiement autorisé (statut `pending_payment`, méthode ni `manual` ni `binance`, toutes les 5 s, arrêt à la sortie) | `pages/OrderTrack.js:86-104,194-201` | `GET /payments/{id}/status` (`routers/payments.py:294`) | `startPaymentPoll`, `stopPaymentPoll` | fait |
| Preuve : 1 à 3 captures **au total** (envoyées comprises), JPEG/PNG (type ou extension), 8 Mo, champ `files` | `components/store/checkout/ProofPay.js:28-30,76-101,111-128` | `POST /orders/{id}/proof` (`routers/orders.py:501-560`) | `uploadProof` | fait |
| Preuve : état réel relu après l'envoi ; codes `proof_*` traduits ; 429/502/503/403/404 dédiés | `ProofPay.js:33-58,119-126` | idem | `proofErrorMessage`, `uploadProof` | fait |
| Contrôle « J'ai payé le montant exact » avant l'envoi | `ProofPay.js:183-187` | — | — | NON FAIT (design : aucune case à cocher dans la feuille de preuve) |
| Relance admin (3 min / 3 max) | `ProofPay.js:212-229` | `POST /orders/{id}/remind` (`routers/orders.py:615`, cooldown `:627`, max `:628`) | — | NON FAIT (design : l'écran d'attente n'a que « Voir ma commande ») |
| Reprise de commande en attente (silencieuse) : `GET /orders/{id}`, écran par statut | `pages/OrderTrack.js:156-188,266-359` | `GET /orders/{id}` (`routers/orders.py:467`) | `resumePendingOrder`, `hydrateCoFromOrder` | fait |
| Annulation par motif : 5 raisons de REF, aucune présélectionnée, `POST /orders/{id}/cancel { reason }` seul | `components/store/checkout/CancelSheet.js:20-26,39-40,46-51,81` | `POST /orders/{id}/cancel` (`routers/orders.py:680`, `CancelIn` `:124-127`) | `openCancel`, `confirmCancel` | fait |
| Annulation : 409 distingué (`cancel_conflict` / `cancel_not_allowed`), état réel rechargé ; succès → accueil | `CancelSheet.js:52-62` ; `OrderTrack.js:399-407` | idem | `confirmCancel` | fait |
| Motif `wrong_info` (1re raison de REF) | `CancelSheet.js:21` | `CancelIn` l'accepte (`routers/orders.py:126`) | radios du sélecteur `:3491-3495` (5 raisons, `wrong_info` en tête) | fait |
| Champ « Précision (facultatif) » | — | `CancelIn.note` (`routers/orders.py:127`, max 200) | — | NON FAIT (retiré : REF envoie seulement `{ reason }`) |
| Binance : `POST /crypto/initiate {order_id, network}` après création, jamais de 2ᵉ initiation | `pages/Checkout.js:214-223` ; `pages/OrderTrack.js:163-169` | `POST /crypto/initiate` (`routers/crypto.py:112`) | `initiateBinance`, `resumePendingOrder` | fait |
| Binance : sondage `GET /crypto/{id}/status` toutes les 8 s, `CONFIRMED` → relecture, `FAILED` → arrêt, aucun `POST /crypto/{id}/paid` | `components/store/checkout/BinancePay.js:9,30-45` | `GET /crypto/{id}/status` (`routers/crypto.py:123`) | `coPayBinance` via `MGS_CRYPTO` (`mgs-logic-crypto.js:27,237-255`) | fait |
| Réessai de paiement automatique (`POST /payments/initiate`) | `pages/OrderTrack.js:110-122,198-201,384-388` | `POST /payments/initiate` (`routers/payments.py:214`) | — | NON FAIT (design : aucun bouton « Réessayer » ; fonction non déclenchable) |

---

## Z4 — Commandes

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Historique du client (liste complète, 200 dernières) | `pages/OrderHistory.js:297-304` | `GET /orders/me` (`routers/orders.py:436`) | `loadOrders`, `renderOrders` | fait |
| Onglets « Toutes / En cours / Terminées » en filtre **local** (aucun paramètre d'API) | `OrderHistory.js:100-106,172-194,318` | — | gabarit `cmdFilter` (`data-filter="all\|progress\|done"`) + `data-filter` posé par `renderOrders` | fait |
| Recherche locale (numéro, ID joueur, produit), insensible à la casse | `OrderHistory.js:306-318` | — | gabarit `cmdFilter` | fait |
| Pagination | — (REF n'en a aucune) | — | bloc `.mgs-cmd-pages` `:2447-2451`, `orderPaginate`, 10 par page | fait (pagination du design, sur la liste locale) |
| Détail : relecture `GET /orders/{id}` à l'ouverture | `OrderHistory.js:421-429` | `GET /orders/{id}` | `refreshOrderDetail` | fait |
| Détail : nombre de preuves réelles, ligne masquée à zéro | `OrderHistory.js:618-622` | `GET /orders/{id}` | `refreshOrderDetail` | fait |
| Détail : reçu réservé à une commande payée au moins une fois (`paid_at`) | `OrderHistory.js:469,691-698` | — | `refreshOrderDetail` | fait |
| Reçu (contenu : numéro, date, statut, jeu, produit, ID, méthode, montant) | `OrderHistory.js:342-374,513-525` (`window.print`) | — | bouton `.mgs-receipt-btn` : le gabarit du design produit un PNG (canvas) — mécanisme du design conservé, mêmes données | fait |
| Détail : raison d'annulation et note traduites | `OrderHistory.js:376-384,624-635` | `GET /orders/{id}` | — | NON FAIT (design : aucune ligne « raison »/« note » dans le détail) |
| Suivi public par numéro + ID joueur | `pages/OrderTrack.js:434-479,520-552` | `GET /orders/track` (`routers/orders.py:450`) | `openOrderLink` (`/suivi/:numero`, `/orders/:id` ; ID joueur = `mgs_last_player_id`) | fait |
| Détail `/commandes/:orderId` : session requise | `App.js:66` (ProtectedRoute) | `GET /orders/{id}` | garde du loader `commandes` | fait — sans compte → connexion ; le parcours invité (paiement, suivi) passe par `/commandes` et `/suivi`, pas par cette route |
| Invité : texte `order.loginToSee` | `OrderTrack.js:543-550` | — | `renderOrders` | fait |
| Invité : bouton « Se connecter » de l'état vide | `OrderTrack.js:546-548` | — | — | NON FAIT (design : l'état vide n'a qu'une icône et un texte) |
| `/commandes` → `/suivi` | `components/common/OrdersRedirect.js:8` ; `App.js:67` | — | l'écran `commandes` EST la page (site mono-page) | fait (destination identique) |
| « Commander à nouveau » (produit relu, ID repris, `/commande?pubg_id=`) | `OrderHistory.js:486-509` | `GET /products/{slug}` | — | NON FAIT (design : aucune action de re-commande dans le détail) |

---

## Z5 — Compte, fidélité, événements, pack évolutif, chat

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Profil : `PATCH /auth/me {name, phone, saved_pubg_ids}` (ID séparés par virgules **ou** espaces) | `pages/Account.js:127-133` | `PATCH /auth/me` (`routers/auth.py:392`) | `saveProfile` | fait (séparateur corrigé cette session) |
| Mot de passe : `POST /auth/change-password` | `pages/Account.js:135-143` | `POST /auth/change-password` (`routers/auth.py:255`) | `changePassword` | fait |
| Mot de passe : contrôle « confirmation identique » | `pages/Account.js:137,239` | — | — | NON FAIT (design : pas de champ « confirmation ») |
| Suppression : confirmation tapée + mot de passe si le compte en a un | `pages/Account.js:145-151` | `POST /auth/me/delete` (`routers/auth.py:436-444`) | `deleteAccount` | fait (mot de passe ajouté cette session ; le design n'a pas de champ dédié) |
| Bannière « email non vérifié » + renvoi | `pages/Account.js:35-52` | `POST /auth/resend-verification` (`routers/auth.py:207`) | — | NON FAIT (design : aucune bannière dans l'écran compte) |
| Carte joueur PUBG | `components/PubgPlayerCard.js:141` | `PATCH /auth/me` | — | NON FAIT (design : aucune carte joueur) |
| Points : solde, gagnés, historique, config | `pages/Loyalty.js:141-163` | `GET /loyalty/me` (`routers/loyalty.py:60`) | `renderPoints` | fait (3ᵉ compteur du design = « Utilisés », somme du journal ; REF affiche `promo` — libellé du design, données réelles) |
| Récompenses : `GET /loyalty/rewards`, `cost_points` en libellé | `pages/Loyalty.js:80-90,143` | `GET /loyalty/rewards` (`routers/loyalty.py:68`) | `renderPoints` | fait |
| Échange : `POST /loyalty/redeem {reward_id, pubg_id}` | `pages/Loyalty.js:147-149` | `POST /loyalty/redeem` (`routers/loyalty.py:73`) | `redeem` | fait **avec écart** : REF n'ouvre l'échange qu'après `valid:true` (`Loyalty.js:61-92`) ; le design n'a aucun champ de vérification sur l'écran points, l'ID du compte (ou une saisie) est utilisé |
| Transferts de points | `pages/Loyalty.js:95-134` | `GET/POST /loyalty/transfers`, `…/{id}/{action}` (`routers/loyalty.py:109,153,165`) | — | NON FAIT (design : aucun formulaire de transfert) |
| Événements : liste | `pages/Events.js:16,31-47` | `GET /events` (`routers/events.py:46`) | `renderEvents` | fait |
| État vide `events.empty` | `pages/Events.js:36` | — | `renderEvents` | fait |
| « J'aime » / « Partager » (compteurs, `mgs_liked`, URL `/evenements#slug`) | `pages/Events.js:14,18-29,49-52` | `POST /events/{id}/like` (`routers/events.py:52`), `…/share` (`:66`) | `renderEvents`, `eventLike`, `eventShare` | fait (boutons-jetons `.mgs-chip` dans le pied de carte du design) |
| Pack évolutif : saison + éligibilité | `pages/PackEvolutif.js:41-61` | `GET /evo/season` (`routers/evo.py:110`), `GET /evo/eligibility` (`:115`) | `packVerify` | fait |
| Chat : composer (création de conversation puis envoi du message) | `pages/Chat.js:1-18` ; `components/chat/ChatWorkspace.js:51` ; `ChatThread.js:86` | `POST /chat/conversations`, `…/{id}/messages` (`routers/chat.py:48,80`) | `supportSend`, `openChat` | fait |
| Chat : invité → connexion, jamais de conversation sans compte | `pages/Chat.js:16-20` | `POST /chat/conversations` (`get_current_user`) | `supportSend`, `openChat` | fait |
| Chat : liste des conversations, fil, non-lus, `read` | `ChatWorkspace.js:57-96` ; `ChatThread.js:25-58` | `GET /chat/conversations`, `…/{id}/messages`, `…/{id}/read` (`routers/chat.py:48-122`) | — | NON FAIT (design : l'écran support n'a qu'un formulaire d'envoi, aucun fil) |
| `/support` = page Chat | `pages/Support.js` (réexport de `Chat.js`) | — | écran `support` + masquage des cartes sans équivalent | fait |

---

## Z6 — Hors pages clients

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Tableau de bord admin (stats + commandes récentes) | `pages/admin/AdminDashboard.js` | `GET /admin/stats`, `GET /admin/orders` (`routers/orders.py:856,737`) | `renderAdmin` + garde `loaders.admin` (non-admin → connexion) : peuple `.mgs-stat__n` (commandes 14 j, revenu, à livrer, livrées) et la table `.mgs-table` depuis les vraies données | fait |
| Les 13 autres écrans admin (catalogue, jeux, fournisseur, paiements, chat, fidélité, utilisateurs, notifications…) | `pages/admin/*` ; `lib/adminNav.js` | `routers/admin_users.py`, `orders.py`, `products.py`, `games.py`, `events.py`, `loyalty.py`, `payments.py`, `crypto.py` | — | NON FAIT (le design n'a pas ces écrans ; leurs boutons sont masqués, voir « Éléments masqués ») |
| Statut boutique, export, audit, stockage | `pages/admin/AdminLayout.js:25-29` | `/settings/status`, `/admin/status`, `/admin/export`, `/admin/audit`, `/admin/storage` (`routers/orders.py:794,890,922`) | — | NON FAIT (laissé à l'application React) |
| Notifications push (abonnement, test, alerte) | `lib/pushSync.js:127-245` ; `components/admin/AdminPush.js` | `routers/push.py:48-95`, `routers/notifications.py:19-35` | — | NON FAIT (laissé à l'application React) |
| Service worker | `public/sw.js` (push-only) ; `src/sw.test.js` | — | `frontend/public/sw.js` (copié tel quel) | fait (aucune modification nécessaire) |
| PWA (`manifest.json`, icônes) | `public/manifest.json` | — | `frontend/public/manifest.json` (copié tel quel) | NON FAIT (le manifeste du prototype garde `start_url:"/admin"` ; hors périmètre front) |
| SEO (titre, description, robots, sitemap) | `components/layout/SeoManager.js`, `lib/seo.js` | — | — | NON FAIT (site mono-page : aucun routeur à métadonnées) |
| Pages légales `/terms`, `/privacy` | `pages/Legal.js` (TERMS/PRIVACY, `App.js:70-71`) | — | écrans `terms`/`privacy` `:2575-2590`, `renderLegal`, texte brut copié de REF dans `frontend/public/mgs-legal.js` (18 + 13 sections, FR/EN) | fait |
| Liens de pied de page vers les pages légales | `components/layout/Footer.js:40-41` | — | `href="#terms"` / `href="#privacy"` `:2727-2728` (+ `MGS_HREF` `:3294`, `HM` `:5016`) | fait |
| Frontière d'erreur | `components/ErrorBoundary.jsx` | — | — | NON FAIT (aucun équivalent dans un IIFE ; le garde non-JSON de `req` couvre le cas qui faisait tomber la page) |
| Thème clair/sombre | `components/layout/ThemeToggle.js` | — | — | NON FAIT (le design v3 n'a ni `.dark` ni `prefers-color-scheme`) |
| Audit des liens internes (`href`, `data-nav`, `data-page`, URL) | — | — | `MGS_PATHS` `:4762`, `mgsPageFromUrl`, `MGS_URLS`/`mgsSyncUrl`, `openDeepLink` | fait : chaque route du site (`/boutique`, `/produit/:slug`, `/commande`, `/commandes/:id`, `/suivi/:numero`, `/pack-evolutif`, `/compte`, `/compte/points`, `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser/:token`, `/verifier-email/:token`, `/evenements`, `/chat`, `/support`, `/admin`) ouvre son écran, y compris par lien direct ou retour arrière |

---

## Routes servies (URL réelles du site)

`mgsPageFromUrl` et `MGS_PATHS` `:4762-4780` reconnaissent, au
chargement, au partage de lien et au retour arrière (popstate `:4855`), les
routes de REF (`pages/App.js:49-96`) :

| URL | Écran du design | Note |
|---|---|---|
| `/` | accueil | |
| `/jeux`, `/boutique` | boutique | `/jeux` ouvre le choix du jeu (`boutiqueGames()`), comme REF |
| `/produit/:slug` | produit | la fiche est chargée par `GET /products/{slug}` (`openDeepLink`) |
| `/commande`, `/commande/confirmation` | commande | |
| `/commandes`, `/commandes/:id`, `/suivi`, `/suivi/:numero`, `/orders/:id` | commandes | `:id`/`:numero` ouvre le détail ; le suivi invité passe par `GET /orders/track` + dernier ID utilisé (`openOrderLink`) |
| `/pack-evolutif` | pack | |
| `/evenements` | evenements | |
| `/connexion`, `/inscription` | connexion | |
| `/mot-de-passe-oublie` | mdp | |
| `/reinitialiser/:token` | reset | jeton lu dans le chemin |
| `/verifier-email/:token` | connexion | jeton consommé au chargement |
| `/chat`, `/support` | support | |
| `/compte` | compte | |
| `/compte/points` | points | |
| `/terms`, `/privacy` | terms, privacy | texte de REF (`pages/Legal.js`) via `frontend/public/mgs-legal.js` |
| `/admin/**` | admin | réservé aux administrateurs (`App.js:82`) |

La barre d'adresse reçoit la route réelle (`mgsSyncUrl`), y compris
`/produit/<slug>`. **À déployer** : le serveur doit renvoyer `index.html` pour
tout chemin inconnu (repli SPA), sinon les liens profonds donnent un 404 ; les
anciens liens `#page` continuent de fonctionner.

## Éléments masqués (défaisable en une ligne)

| Élément | Emplacement | Pourquoi | Comment le rétablir |
|---|---|---|---|
| Formulaire d'abonnement du pied de page | `.footer .form-block` | aucune route backend ne l'accepte (seule l'inscription push **admin** existe, `routers/push.py:60`) | retirer la ligne `.footer .form-block` de `maskUnsupported` |
| Pastille de date des cartes événement | `.mgs-card .mgs-chip` (page Événements) | la réponse ne porte aucune date (`starts_at` n'existe pas) et REF n'en affiche pas (`Events.js:39-52`) | remplacer `chip.style.display = "none"` par le remplissage voulu dans `renderEvents` |
| Boutons du tableau de bord admin (« Gérer les produits », « Voir les paiements », « Notifications ») | `.mgs-page[data-page=admin] .mgs-row .button-main` | mènent aux écrans admin non portés (Z6) : aucune route n'existe dans le prototype | retirer la ligne `$$('.mgs-row .button-main', page).forEach(...)` de `renderAdmin` |

## Éléments visibles manquants (besoin d'un ajout de design, remonté au propriétaire)

| Écran / élément | Fonction REF | Ce qu'il faut |
|---|---|---|
| Bouton « Relancer » | `ProofPay.js:212-229` → `POST /orders/{id}/remind` | un contrôle libre sur l'écran d'attente |
| Bouton « Réessayer » | `OrderTrack.js:384-388` → `POST /payments/initiate` | un contrôle libre (REF ne l'affiche que pour `failed`/`expired` hors manuel/Binance — jamais le cas ici) |
| Case « J'ai payé le montant exact » | `ProofPay.js:183-187` | une case dans la feuille de preuve |
| Page de suivi dédiée (numéro + ID joueur) | `OrderTrack.js:434-479` | un champ ID joueur pour l'invité (aujourd'hui : dernier ID de la machine) |
| Écran « vérification d'email » | `AuthExtras.js:90-107` | un écran de résultat (aujourd'hui : message) |
| Écran « confirmation de commande » | `CheckoutConfirm.js` | un écran après création |
| Page « jeux » dédiée | `Games.js` | un écran jeu (aujourd'hui `/jeux` = choix du jeu dans la boutique) |
| Bannière « email non vérifié » + renvoi | `Account.js:35-52` | une bannière sur l'écran compte |
| Carte joueur PUBG | `PubgPlayerCard.js` | une carte sur l'écran compte |
| Identités de jeu sauvegardées | `GameIdentities.js` | une section sur l'écran compte |
| Champ « confirmation » du mot de passe | `Account.js:239` | un champ de plus dans le panneau Sécurité |
| Champ de vérification d'ID avant échange de points | `Loyalty.js:61-79` | un champ sur l'écran points |
| Transferts de points | `Loyalty.js:95-134` | un formulaire sur l'écran points |
| Fil de discussion du chat | `ChatThread.js` | une liste de messages sur l'écran support |
| Sélecteur de thème | `ThemeToggle.js` | le design v3 n'a pas de thème sombre |
| Les 13 écrans admin (hors tableau de bord) | `pages/admin/*` | le design n'a pas ces écrans ; le tableau de bord, lui, est réel (`renderAdmin`) |

## Écarts de contrat (backend actuel vs REF)

| Appel | REF | Backend actuel | Conséquence dans le prototype |
|---|---|---|---|
| Erreurs métier (annulation, preuve) | `errorMessage` lit `detail.msg` (`lib/api.js:45`) | `detail = {"code", "message"}` (`routers/orders.py:474-480`) | `errMsg` lit aussi `message` (sinon « [object Object] ») |
| `POST /auth/register` | REF envoie `remember` (`AuthPage.js:48`) | `RegisterIn` ne le déclare pas (`routers/auth.py:36-40`) | non envoyé : sans effet, Pydantic ignore le champ |
| `POST /orders/{id}/cancel` | REF envoie `{reason}` seul | `CancelIn.note` existe (`routers/orders.py:127`) | `note` jamais envoyé (champ « Précision » retiré de la feuille) |
| `POST /auth/me/delete` | REF envoie `password` seulement si compte local (`Account.js:148`) | mot de passe **exigé** si `password_hash` (`routers/auth.py:442-444`) | identique ; le design n'ayant pas de champ, la valeur vient de « Mot de passe actuel » ou d'une boîte de dialogue |
| `GET /crypto/{id}/status` | REF lit `payment` (`BinancePay.js:32-39`) | projection sans `payment_deadline_at` (`routers/crypto.py:50`) | l'échéance vient de la commande (`mgs-logic-crypto.js:232-235`, `opts.deadlineAt`) |
| `POST /crypto/initiate` | réseau choisi dans `GET /crypto/config` | 400 « Réseau USDT non disponible. » (`backend/services/crypto.py:78`, levé depuis `routers/crypto.py:120`) ou 422 sur le motif (`routers/crypto.py:16`) | le prototype envoie le réseau choisi dans le sélecteur (`initiateBinance`) |
| `POST /fazercards/validate-id` | codes `invalid_id`, `missing_field` (`lib/identityErrors.js:20-25`) | `routers/fazercards.py:118` | table de verdicts identique (`identityErrorKey`) |

## Écarts PL-FE-019 (traités d'après l'audit du contrat déployé, PL-FE-018)

Référence = PR #100 (`b34df6e`) ; contrat déployé = `~/openapi-live.json`
(sha256 identique à `https://api.magicgame.store/openapi.json`). Un commit par
point, sur `feat/proto-fonctionnel`.

| # | Écart constaté | Décision | Source REF |
|---|---|---|---|
| 1 | `GET /evo/season` ne publie pas `season.product_id` : le prototype lisait un champ inexistant et n'appelait donc jamais `/evo/eligibility` | l'offre vient de `GET /products?type=evo`, et l'éligibilité porte sur SON `id` ; sans offre → état vide `evo.empty` | `pages/PackEvolutif.js:29` (liste), `:40` (éligibilité de l'offre choisie) ; la saison ne sert qu'au nom, `:30,64` |
| 2 | la pastille de carte événement lisait `ev.starts_at`, absent de la réponse déployée | pastille **masquée** (`display:none`) : REF ne date pas ses cartes, aucun champ à reprendre | `pages/Events.js:39-52` (badge, image, titre, description, prix, CTA, j'aime/partage) |
| 3 | `favorites` envoyé à `GET /products` alors qu'il n'est pas au contrat, et un échec (422 d'un `?sort` hors énumération) transformé en liste vide | paramètre retiré (le filtre favoris reste local) ; l'échec affiche le message du catalogue | `pages/Catalog.js:118` (REF l'envoie pour rien), `:155-157` (filtre local), `:263` (`catalog.empty`) |
| 4 | `POST /crypto/initiate` : un réseau refusé arrive en 422 (motif `^(TRC20\|BEP20\|APTOS\|TON)$`), le code ne traitait que le 400 | le 422 suit le même code `network_unavailable` que le 400 → même message côté appelant | `Checkout.js:220` (appel) ; libellé 400 = `backend/services/crypto.py:78` (levé depuis `routers/crypto.py:120`) ; motif 422 = `backend/routers/crypto.py:16` |
| 5 | `missing_field` est aussi renvoyé pour un format invalide | **aucun changement** : le prototype porte déjà la table de REF, et REF n'affiche **jamais** le message du backend | `lib/identityErrors.js:16-38` (table), `IdentityFieldsVerify.js:117-124,138` (jamais `message`/`detail`) ; preuve `pages/Loyalty.test.js:192,200` (message simulé « api message », texte attendu = clé de la table) |
| 6 | le chat envoyait `sujet + "\n\n" + texte` | texte seul, borné à 2 000 caractères | `components/chat/ChatThread.js:86` (`{ text: draft.trim() }`), `:117` (`maxLength={2000}`) |
| 7 | 404 de commande affichés en anglais (« Order not found ») | clé i18n `order.notFound` | `pages/OrderTrack.js:452` (`status === 404 ? t("order.notFound") : errorMessage(e)`) |

Hors périmètre, faute d'affichage côté REF : « No payment for this order » — le
sondage `GET /payments/{id}/status` avale l'erreur chez REF
(`pages/OrderTrack.js:97`) comme dans le prototype.

### Besoin backend (point 1)

**Aucun.** `routers/evo.py` n'utilise la saison que pour `season['id']` et
`season['name']` (`evo.py:35-56,64-80`) ; l'offre éligible est publiée par
`GET /products?type=evo` (`routers/products.py:75`). En revanche, l'instance
interrogée pendant l'audit renvoyait `[]` à `GET /games` **et** à `GET /products`
(même avec `include_inactive=true`) : tant qu'aucun jeu ni produit n'est publié,
la page pack affiche `evo.empty` et la boutique n'a aucun article — **données,
pas code** (à confirmer par le propriétaire : `api.magicgame.store` porte-t-il
bien le catalogue de production ?).

## Connexion Google — retour et boucle (2026-11-23, après PL-FE-019)

Demande du propriétaire : après une connexion Google, l'utilisateur doit arriver
sur la **liste des jeux disponibles**, pas sur l'écran de connexion.

| Défaut constaté | Correction | Source |
|---|---|---|
| Sans page d'origine, `return_to` valait `/` (accueil) ; REF, lui, revenait sur `/compte` | `return_to` = `/boutique` — l'écran des jeux, `.mgs-boutique-catalog` étant `hidden` au chargement — et l'écran de connexion sort vers cette même page quand aucun `needLogin` n'a mémorisé de destination | `components/AuthCallback.js:8` (défaut REF), `pages/AuthPage.js:38,40` (`from`) |
| Un utilisateur **connecté** restait bloqué sur `/connexion` : `boot()` affiche la page de l'URL avant de connaître la session, le `MutationObserver` sur `body[data-page]` fait tourner son loader avec `me` = null, et `route()` ignore un rappel identique au précédent (garde `lastPage`) — le loader « connexion » ne repassait donc jamais | la page courante est ré-évaluée **une fois** quand `me` est renseigné et que l'écran courant est `/connexion` (même idiome que le changement de langue) | `frontend/public/index.html` (`boot()`, `route()`) |

### État du flux Google côté déploiement (vérifié en lecture seule)

- `GET /api/auth/google/config` → `{"enabled":true}` : Google EST configuré côté API.
- `GET /api/auth/google/start?return_to=%2Fboutique` → répond bien par une
  redirection (opaque en `fetch` `redirect:manual`) : la première jambe fonctionne.
- Le RETOUR concentre **six échecs distincts** sur la même redirection
  `{FRONTEND_URL}/connexion?error=google` (`backend/routers/auth.py:321-344`) :
  cookie `oauth_state` absent ou non concordant (`:325`), `oauth_states` introuvable
  (`:327-329`), échange de jeton refusé (`:334-336`, seul cas journalisé
  « Google token exchange failed »), `id_token` invalide — nonce/aud/email non
  vérifié (`:308-316`, `:337-340`) —, compte bloqué ou supprimé (`:343-344`).
  Aucun n'est distinguable depuis le navigateur : la redirection d'échec est la même.

**À vérifier côté déploiement** (hors dépôt, non exécuté ici) : dans l'onglet réseau
du navigateur, la redirection finale — vers `{FRONTEND_URL}/boutique` (succès) ou
vers `/connexion?error=google` (échec) — et la présence du cookie `oauth_state` sur
la requête `/api/auth/google/callback` ; puis les journaux de l'API. Trois variables
d'environnement décident du cookie d'état et de l'`redirect_uri` enregistré chez
Google : `COOKIE_DOMAIN` / `COOKIE_SAMESITE` (`backend/core/security.py:81-94` —
sans `COOKIE_DOMAIN`, l'état part en `SameSite=None`, donc exposé au blocage des
cookies tiers selon le navigateur) et `BACKEND_PUBLIC_URL`
(`backend/routers/auth.py:95-96` ; à défaut, `redirect_uri` est construit depuis
l'en-tête de la requête, et un proxy qui ne transmet pas l'hôte d'origine fait
refuser l'échange de jeton par Google).

## Besoins backend

Aucun bloquant : aucune route appelée par REF n'est absente du backend. Deux
conforts facultatifs : exposer `payment_deadline_at` dans
`GET /crypto/{id}/status`, et déclarer `remember` dans `RegisterIn` (les deux
sont aujourd'hui contournés sans perte de comportement).

## Tableau des champs (appel → champs envoyés)

| Appel | Champs envoyés par le prototype | Source REF | Route backend |
|---|---|---|---|
| `POST /orders` | `game_id`, `pubg_id`, `pseudo`, `items[{product_id, quantity}]`, `payment_method`, `manual_operator` (manuel), `identity_fields` (jeu dynamique), `identity_id` (identité du compte), `captcha_token` | `pages/Checkout.js:175-183` | `routers/orders.py:315` (`OrderIn` `:64-82`) |
| `POST /orders` (réponse) | `id`, `created_at` → `mgs_pending_order_id` | `pages/Checkout.js:185` | `routers/orders.py:315-321` |
| `GET /orders/me` | — | `OrderHistory.js:300` | `routers/orders.py:436` |
| `GET /orders/{id}` | — | `OrderTrack.js:159`, `OrderHistory.js:425` | `routers/orders.py:467` |
| `POST /orders/{id}/cancel` | `reason` | `CancelSheet.js:46` | `routers/orders.py:680` |
| `POST /orders/{id}/proof` | `files` (1-3, multipart, sans en-tête manuel) | `ProofPay.js:117-119` | `routers/orders.py:501` |
| `GET /payments/{id}/status` | — | `OrderTrack.js:93` | `routers/payments.py:294` |
| `POST /crypto/initiate` | `order_id`, `network` | `Checkout.js:220` | `routers/crypto.py:112` |
| `GET /crypto/{id}/status` | — | `BinancePay.js:32` | `routers/crypto.py:123` |
| `POST /fazercards/validate-id` | `game_id`, `fields` | `IdentityFieldsVerify.js:102` | `routers/fazercards.py:118` |
| `POST /me/game-identities` | `game_id`, `label`, `fields`, `player_name` | `Checkout.js:138` | `routers/games.py:110` |
| `PATCH /auth/me` | `name`, `phone`, `saved_pubg_ids` | `Account.js:130` | `routers/auth.py:392` |
| `POST /auth/me/delete` | `confirmation`, `password` (si saisi) | `Account.js:148` | `routers/auth.py:436` |
| `POST /loyalty/redeem` | `reward_id`, `pubg_id` | `Loyalty.js:148` | `routers/loyalty.py:73` |
| `POST /chat/conversations` / `…/{id}/messages` | `{}` / `{text}` | `ChatWorkspace.js:51`, `ChatThread.js:86` | `routers/chat.py:48,80` |
| `GET /products` | `game`, `type`, `q`, `sort`, `popular`, `min_price`, `max_price` (`favorites` retiré en PL-FE-019 : hors contrat, filtre local) | `Catalog.js:118` | `routers/products.py:75` |
| `GET /products?type=evo` | `type` (sélecteur d'offre du pack évolutif, PL-FE-019) | `PackEvolutif.js:29` | `routers/products.py:75` |

## Configuration à poser au déploiement (inchangé)

- `backend/core/origins.py` : les origines autorisées doivent contenir l'origine
  exacte du site statique.
- Adresse du backend : `window.MGS_BACKEND_URL` (défaut du prototype et de
  `mgs-logic-crypto.js` : `https://api.magicgame.store`, confirmée par le
  propriétaire — l'ancien littéral `onrender` est retiré).
- Clé publique Turnstile : `window.MGS_CAPTCHA` (sans clé, aucun widget n'est monté).
- Push admin : clé publique VAPID (`GET /admin/push/config`).

## Contrôle au rendu (bundle servi, Chromium, 390 px et 1440 px)

Serveur jetable hors dépôt (repli SPA) + Chromium, lecture seule. Ce que j'ai
observé, sans backend exploitable (les listes reviennent vides) :

| URL demandée | Écran | Titre affiché | Débordement horizontal |
|---|---|---|---|
| `/` | accueil | « Rechargez vos jeux. Sans détour. » | non |
| `/boutique`, `/jeux` | boutique | « Choisissez votre jeu » | non |
| `/produit/uc-60` | produit | « 660 UC » | non |
| `/commande` | commande | — | non |
| `/commandes`, `/suivi` | commandes | « Vos commandes » | non |
| `/compte`, `/compte/points` | → connexion (invité, `ProtectedRoute`) | « Connexion » | non |
| `/connexion`, `/inscription` | connexion | « Connexion » | non |
| `/mot-de-passe-oublie` | mdp | « Mot de passe oublié » | non |
| `/evenements` | evenements | « Événements » (état vide) | non |
| `/pack-evolutif` | pack | « Payez par paliers » | non |
| `/support`, `/chat` | support | « Support » | non |
| `/admin` | → connexion (non administrateur) | « Connexion » | non |

Interactions observées : clic sur une carte de jeu → sous-vue catalogue « PUBG
Mobile » ; retour arrière → écran précédent (popstate) ; `/support` affiche les
cartes WhatsApp (`https://wa.me/261377519833`) et e-mail
(`mailto:support@magicgame.store`), les champs `#sj`/`#ms`, la FAQ, et **aucun**
formulaire d'abonnement (masqué) ; `/commande` avec panier vide → « Votre panier
est vide. » + boutique ; avec panier rempli → écran 1 peuplé (« 3 × 660 UC »,
« 15 000 Ar », jeu, pastilles méthode). Non observable sans backend : liste
d'événements (donc boutons « j'aime »/« partager », créés par carte), catalogue
réel, commandes. Aucun débordement horizontal, aucune page blanche.

Deux défauts trouvés par ce contrôle et corrigés :

1. **Les URL n'étaient appliquées qu'après `GET /auth/me`** : avec un réseau
   lent, toutes les routes affichaient l'accueil pendant ~11 s. L'écran demandé
   s'affiche désormais immédiatement (`boot`).
2. **`/commande` avec panier vide** montrait le tunnel à 0 Ar et un bouton
   actif. Désormais : message de REF + retour boutique, sauf commande en cours
   ou reprise mémorisée (`loaders.commande` `:4806`).

## Validation de cette session (sorties brutes)

### PL-FE-019 (état final, points 1 à 7)

```
$ python3 check_region.py frontend/public/index.html       # après chaque commit
frontend/public/index.html -> …/check-index.html.js (148168 car.)  node --check exit=0

$ node i18n-check.mjs                                      # script jetable, hors dépôt
clés FR=129 EN=129
FR sans EN : aucune
EN sans FR : aucune
clés citées en dur : 78 | absentes d'une langue : 0
familles de clés concaténées : 2
  ok order.next. FR=9 EN=9  (index.html(runtime))
  ok order.status. FR=9 EN=9  (index.html(runtime))
clés du dictionnaire jamais citées : aucune
EXIT=0

$ cd frontend && REACT_APP_BACKEND_URL=… yarn build
[ok] REACT_APP_BACKEND_URL est definie (source : l'environnement de build).
Compiled successfully.   Done in 3.88s.                        EXIT=0

$ cd frontend && yarn test:ci
Test Suites: 45 passed, 45 total
Tests:       534 passed, 534 total
Time:        37.736 s                                          EXIT=0

$ cd frontend && node scripts/proto-logic.test.mjs          # logique crypto + captcha
29 passed, 0 failed (29 tests)                                 EXIT=0
```

Non exécuté pour PL-FE-019 : parcours navigateur (le brief l'excluait),
`yarn audit:contrast` (aucun `.css` ni style modifié).

### PL-FE-017 (session précédente)

```
$ node --check <runtime extrait de index.html>          # après chaque commit
node --check OK

$ node i18n-check.mjs                                    # script jetable, hors dépôt
clés t()/data-i18n utilisées : 88
dictionnaire prototype : fr 104 / en 104
REF (b34df6e) : fr 995 / en 995
OK — 0 échec

$ yarn --cwd frontend test:ci
Test Suites: 45 passed, 45 total
Tests:       534 passed, 534 total

$ cd frontend && REACT_APP_BACKEND_URL=… yarn build
The build folder is ready to be deployed.   Done in 4.81s.

$ git diff --stat -- '*.css'                             # règle 1
(vide)

$ git diff --unified=0 | grep -E '^[+-].*(class=|style=)'  # règle 1
(seules des lignes supprimées ; aucune valeur de classe modifiée)
```

Harnais de logique : `node scripts/proto-logic.test.mjs` → **29 passed, 0 failed**.
L'ancien test « réseau inconnu refusé sans appel réseau » attendait un refus LOCAL
(`invalid_network`) ; REF ne valide pas le réseau côté client (`Checkout.js` ne
propose que `crypto.networks`) et `mgs-logic-crypto.js` documente « aucune
validation locale du réseau : c'est le backend qui statue ». Le test est aligné
sur REF (PL-FE-017) : le réseau saisi part vers `POST /crypto/initiate`, le 400
« Réseau USDT non disponible. » est attesté côté backend.

## Commits de cette session (branche `feat/proto-fonctionnel`, poussés)

### PL-FE-019 (un commit par point, dans l'ordre des points 1 → 7)

```
edf936f fix(proto): pack évolutif — l'offre vient de GET /products?type=evo (REF PackEvolutif.js:29,40), plus du product_id de saison inexistant au contrat déployé
fc4fb24 fix(proto): pastille de carte événement masquée — starts_at absent du contrat déployé et REF ne date pas ses cartes (Events.js:39-52)
e20b5d7 fix(proto): catalogue — 'favorites' retiré de GET /products (hors contrat, filtre local conservé) et échec de la requête affiché au lieu d'une liste vide
f37b1de fix(proto): /crypto/initiate — un 422 (réseau hors de l'énumération du contrat) suit le 400 « réseau refusé », test logique aligné
c4c4f66 fix(proto): chat — texte seul comme REF (ChatThread.js:86), borné à 2 000 caractères (MessageIn / ChatThread.js:117)
81443af fix(proto): 404 de commande — clé order.notFound de REF (OrderTrack.js:452) au lieu du « Order not found » anglais du backend
<ce commit> docs(proto): PORTAGE.md — écarts PL-FE-019 (point 5 : aucun changement, besoin backend : aucun)
```

Point 5 n'a produit **aucun commit** : le mapping du prototype est déjà celui de
REF et REF n'affiche jamais le message du backend (démonstration ci-dessus).

### Session précédente (PL-FE-017)

```
b1f1c70 feat(proto): vrais liens de pages + fonctions du design rebranchées
6586da7 feat(proto): la barre d'adresse affiche /produit/<slug> quand la fiche est ouverte
0219c78 fix(z6): clés i18n ajoutées (11 clés de REF) — 0 clé hors REF
e300442 fix(auth): backend = api.magicgame.store, formulaires de connexion réels (Google + gestionnaire de mots de passe)
2559ed5 fix(proto): test logique aligné sur REF — pas de validation locale du réseau
```

## Destination après connexion + éclair d'écran sur /compte (2026-11-23)

Deux observations du propriétaire, sur la même session :
- après une connexion, le client doit arriver **directement sur la Boutique**
  (`/boutique`, la liste des jeux), pas sur `/compte` ni sur l'accueil ;
- en ouvrant `/compte` connecté, la page de **connexion s'affichait un instant**
  puis le compte réapparaissait.

Cause (mesurée, pas supposée) : l'écran demandé par l'URL est affiché dès le début
de `boot()` alors que la session n'est connue qu'après (`loadSession`). Les loaders
qui consultent `me` ont donc tourné avec `me = null` et `needLogin()` a renvoyé
immédiatement sur `/connexion` ; la résolution de la session a renvoyé ensuite sur
la page d'origine. Trace Chromium (`body[data-page]`, horodatée) sur `/compte` avec
session valide, témoin `git HEAD` : `accueil → compte → connexion → compte`, avec
l'écran de connexion affiché **374 ms** (`/auth/me` immédiat) à **893 ms**
(`/auth/me` retardé de 800 ms).

Correctif (`frontend/public/index.html`) :
- `needLogin()` ne redirige plus tant que `sessionResolved` est faux ; `boot()`
  ré-évalue une fois les loaders qui dépendent de la session (`SESSION_LOADERS`),
  sans quoi un invité resterait bloqué sur la page vide.
- destination après connexion = `boutique` dans les trois cas (formulaire,
  `/connexion` déjà connecté, retour Google). `authReturnTo` (mémorisation de
  l'écran d'origine) supprimé : REF le fait (`AuthPage.js:38` lit `from`), mais
  la consigne est de tomber sur la Boutique dans tous les cas.

Harnais `frontend/scripts/proto-z2.mjs` :
- `/auth/refresh` mocké (401 invité). Sans ce mock il tombait en 404 : la session
  était réessayée 3 s puis 8 s et sa résolution tardive **écrasait le `me` du
  login** → pastille points masquée. C'est la cause du test rouge constaté avant
  ce correctif (24/28) ; mon scénario de reproduction le passait parce qu'il
  mockait `/auth/refresh`.
- assertion d'arrivée après login : `accueil` → `boutique`.

Mesure (témoin `git HEAD` vs build, API mockée, 390 px) :

| scénario | avant | après |
|---|---|---|
| formulaire depuis `/connexion` | `/` (accueil) | `/boutique` |
| Google depuis `/points` (invité) | `return_to=/compte/points` | `return_to=/boutique` |
| `/connexion` + session | `/boutique` | `/boutique` |
| `/compte` + session | `compte → connexion (0,4–0,9 s) → compte` | `compte` seul |
| `/compte` invité | `/connexion` | `/connexion` |

Validation : `yarn build` OK ; `yarn test:ci` 534/534 ; `proto-z2` 28/28 (4 tailles) ;
trace `body[data-page]` ci-dessus.

## Reste ouvert (remonté au propriétaire)

1. **Éléments qui exigent un ajout de design** (un conteneur chacun) : bouton
   « Relancer » (`/orders/{id}/remind`), bouton « Réessayer »
   (`/payments/initiate`), case « montant exact »,
   champ ID joueur du suivi invité, écran de vérification d'email, écran de
   confirmation, bannière email, carte joueur, identités de jeu,
   confirmation du mot de passe, vérification d'ID avant échange de points,
   transferts de points, fil du chat, sélecteur de thème. Le prototype les
   déclenche dès qu'un conteneur existe.
2. **Abonnement du pied de page** : aucun endpoint backend (masqué).
3. **Déploiement** : le serveur doit renvoyer `index.html` sur un chemin inconnu
   (repli SPA) pour que `/boutique`, `/produit/:slug`… survivent à un
   rechargement. Les liens `#page` restent valables.
4. **`yarn audit:contrast`** n'a pas été lancé (aucun `.css` modifié).
5. Deux fichiers non suivis n'ont pas été touchés :
   `frontend/scripts/proto-z3b-dev.mjs`, `orchestration(portage).md`.
6. **Champ « Sujet » du formulaire de support** : le design l'affiche, REF n'a
   pas ce champ et PL-FE-019 n'envoie que le message (`{text}`). La saisie du
   sujet n'est donc pas transmise — à trancher : masquer le champ, ou
   concaténer sujet et message (comportement d'avant PL-FE-019).
7. **`ev.badge` non affiché** (« RP », « Prize Path ») : REF le rend en pastille
   sur l'image (`pages/Events.js:42`) et le design porte pour cela une classe
   `.mgs-card__badge` (règle CSS présente, aucun usage dans le markup).
   L'afficher créerait un élément visible → hors périmètre de PL-FE-019.
8. **Pastille de date des événements masquée** (voir « Éléments masqués ») :
   aucune date dans la réponse, aucune chez REF.
9. **Catalogue vide sur l'instance interrogée** (`GET /games` et `GET /products`
   → `[]`) : aucune commande réelle possible tant qu'aucun jeu ni produit n'est
   publié. Données, pas code.
10. **Vérifications non exécutées** : `yarn build` et `yarn test:ci` ont été
   lancés une fois sur l'état final (sorties brutes en « Validation de cette
   session ») ; aucun parcours navigateur n'a été rejoué pour PL-FE-019 (le
   brief l'excluait).
11. **Connexion Google** : l'éclair d'écran de connexion sur `/compte` est corrigé et
    mesuré, et le retour Google vise toujours `/boutique` (voir « Destination après
    connexion + éclair d'écran sur /compte »). **Le retour Google réel n'est toujours
    pas observé** — il faut un identifiant Google ; ce qui reste à vérifier côté
    déploiement est listé dans « Connexion Google — retour et boucle » ci-dessus.
