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
inventé (script i18n : 104 clés FR/EN, toutes présentes dans REF) ; aucune
dépendance ajoutée ; `backend/` jamais modifié ; aucune URL de backend touchée
(`index.html:3511`).

---

## Z0 — Socle (client API, session, erreurs, i18n, panier, invité)

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Base d'URL + cookies (`withCredentials`) | `lib/api.js:3-6` | — | `index.html:3511-3512`, `req()` `:3562` | fait |
| Refresh 401 silencieux, une seule demande partagée, bornée à 15 s, hors liste d'auth | `lib/api.js:12-38` | `POST /auth/refresh` (`routers/auth.py:363`) | `NO_SILENT_REFRESH` `:3548`, `refreshSession()` `:3552`, `req()` `:3562` | fait |
| Un refresh 401 remonte le 401 d'origine ; toute autre panne remonte SA propre erreur (jamais de déconnexion à tort) | `lib/api.js:27-34` | — | `req()` `:3568-3574` | fait |
| Message d'erreur affichable (detail chaîne / tableau de validation / objet) | `lib/api.js:40-46` | — | `errMsg()` `:3595` ; écart 1 ci-dessous | fait |
| Restauration de session au chargement (401 = déconnecté ; panne = 2 reprises 3 s/8 s puis hors ligne, sans message) | `context/AuthContext.js:27-53` | `GET /auth/me` (`routers/auth.py:387`) | `loadSession()` `:3611` | fait |
| Déconnexion (le panier N'EST PAS vidé) | `context/AuthContext.js:58-61` | `POST /auth/logout` (`routers/auth.py:404`) | `logout()` `:4494` | fait |
| Traductions `t()` FR/EN | `i18n/translations.js` (995/995) | — | `T` `:3519`, `t()` `:3526` | fait — 104 clés, parité FR/EN, **0 clé hors REF** (script i18n) |
| Redirection des pages protégées (`/compte`, `/compte/points`, `/admin`) | `components/ProtectedRoute.js:29-30` ; `App.js:80-82` | — | `needLogin()` `:4448`, `loaders` `:4740-4750` | fait |
| Panier : clé `mgs_cart`, un seul jeu, un Prime + un Prime+, évo = 1, plafond 20 | `context/CartContext.js:10-34` | — | `cart` `:3663`, `addToCart()` `:3687`, `cartCap()` `:3684` | fait |
| Favoris (`localStorage`, clé `mgs_favorites`) | `lib/favorites.js:3,41-48` | — | `getFavs()`/`toggleFav()`/`syncFavs()` `:3724-3726` | fait |
| Commande en attente : **une** clé `mgs_pending_order_id` = `{id, createdAt}`, TTL 24 h, purge sur statut final | `lib/pendingOrder.js:13-30,37,47,63-69` | — | `PENDING_KEY` `:3844-3859` | fait |
| IDs joueur récents : `mgs_recent_player_ids` = `{[gameId]:[{id,usedAt}]}`, 10/jeu, sans pseudo | `lib/recentPlayerIds.js:15,52-99` | — | `readRecentStore()` `:3928`, `recentIdsOf()` `:3929`, `rememberPlayerId()` `:3942` | fait |
| Identifiant de session anonyme (`mgs_session`, forme `s_…`) | `lib/api.js:50-56` | — | `sessionId()` `:4679` | fait |
| Pastille de points masquée sans compte **ou** sans réponse de `/loyalty/me` | `components/layout/Header.js:29-35` | `GET /loyalty/me` (`routers/loyalty.py:60`) | `syncAuthChrome()` `:4447`, `updatePointsPill()` `:4444` | fait |
| `/commandes` n'est pas protégée : l'invité voit l'état vide `order.loginToSee` | `components/common/OrdersRedirect.js:8` ; `App.js:67` | — | `loadOrders()` `:4414`, `renderOrders()` `:4403` | fait |

Corrections Z0 de cette session (Phase V — comparaison à REF) :

1. `errMsg` : algorithme de `REF:lib/api.js:40-46` (avant : cas particuliers 401/403/réseau inventés).
2. `req()` : refresh partagé + délai de 15 s + remontée correcte de l'erreur (avant : renvoyait toujours le 401 d'origine).
3. Panier vidé à la déconnexion (`224ca8c`) : plus présent ; vérifié, rien à retirer.

---

## Z1 — Authentification

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Connexion : `POST /auth/login` `{email, password, remember, captcha_token}`, `data.user` posé tel quel | `pages/AuthPage.js:44-53` | `POST /auth/login` (`routers/auth.py:195-211`) | `doAuth()` `:4539` | fait |
| Inscription : `POST /auth/register`, **pas** de second login, message « email de vérification envoyé » | `pages/AuthPage.js:44-53` | `POST /auth/register` (`routers/auth.py:166-193`) | `doAuth()` `:4539` | fait ; `remember` non envoyé à l'inscription — écart 2 |
| « Se souvenir » coché par défaut, envoyé en `remember` (connexion) | `pages/AuthPage.js:22,25,102` | `POST /auth/login` | `boot()` `:4851`, `doAuth()` `:4576` | fait |
| Validation du formulaire : nom ≥ 2, mot de passe ≥ 8 (inscription) / ≥ 6 (connexion), email | `pages/AuthPage.js:88,93,100` | — | `doAuth()` `:4542-4546` | fait (en JS : le design n'a ni `required` ni `minlength`, et la règle 1 n'autorise pas à les ajouter) |
| Messages d'auth par code, sinon statut HTTP, sinon repli — jamais le détail anglais | `lib/authErrors.js:12-64` | réponses 400/401/403/409/422/429/5xx | `authErr()` `:4461` | fait |
| Captcha Turnstile : monté si la clé publique existe ; inscription ou connexion déjà échouée ; `always` si l'API l'exige | `pages/AuthPage.js:26-37,108,115` ; `components/common/CaptchaWidget.js:110-116` | `captcha.require` (`routers/auth.py:113-133,169,199`) | `renderAuthCaptcha()` `:4513`, `syncAuthCaptcha()` `:4527` | fait |
| Jeton à usage unique : tout échec rend le contrôle au client | `pages/AuthPage.js:57-61` | — | `doAuth()` `:4575-4584` | fait (corrigé cette session) |
| Redirection après connexion vers la page d'origine (`from`), accueil par défaut ; déjà connecté → même redirection | `pages/AuthPage.js:38,40,53` | — | `authReturnTo` `:4447`, `loaders.connexion` `:4754` | fait |
| Mot de passe oublié : envoi, message inline, captcha, erreurs traduites | `pages/AuthExtras.js:42-50` | `POST /auth/forgot-password` (`routers/auth.py:222-241`) | `forgotPassword()` `:4599`, `renderForgotCaptcha()` `:4587` | fait |
| Réinitialisation par jeton (`/reinitialiser/:token`), 8 car. min., confirmation identique, lien invalide → message | `pages/AuthExtras.js:65-78` ; `App.js:76` | `POST /auth/reset-password` (`routers/auth.py:244-253`) | `resetPassword()` `:4637`, `resetTokenFromUrl()` `:4608` | fait |
| Vérification d'email (`/verifier-email/:token`) : jeton consommé au chargement, session rafraîchie | `pages/AuthExtras.js:90-97` ; `App.js:77` | `POST /auth/verify-email` (`routers/auth.py:213-220`) | `verifyTokenFromUrl()` `:4620`, `boot()` `:4860-4867` | fait (écran dédié absent du design → « manquants ») |
| Connexion Google : `/auth/google/start?return_to=…` | `components/AuthCallback.js:8-11` | `GET /auth/google/start` (`routers/auth.py:288-317`) | `googleLogin()` `:4585` | fait |
| Retour Google (échec `?error=google`) : message + URL nettoyée | `components/AuthCallback.js:14-28` | `GET /auth/google/callback` (`routers/auth.py:319-360`) | `handleGoogleError()` — clé `auth.googleError` | fait — REF code le texte en dur (« Connexion Google impossible. Réessayez. ») ; FR repris tel quel, EN = traduction littérale (« Google sign-in impossible. Try again. ») |
| Adresse du backend : `https://api.magicgame.store` (confirmée par le propriétaire) | — | `GET /api/auth/google/config` → `{"enabled":true}` | `BACKEND` `:3511` | fait — l'ancien host posait le cookie `oauth_state` sur son domaine alors que le callback Google revient sur `api.magicgame.store` (state introuvable → `?error=google`) |
| Formulaires de connexion/inscription/envoi réels (le gestionnaire de mots de passe du navigateur repropose les comptes) | `pages/AuthPage.js:83` (`<form onSubmit>`) | — | `#mgs-auth-form`, `#mgs-mdp-form`, `#mgs-reset-form` `:2533-2552,2548,2565` | fait |
| Module captcha vérifié conforme | `components/common/CaptchaWidget.js:103-122` ↔ `mgs-logic-captcha.js:138-150` | — | — | fait |

---

## Z2 — Catalogue, recherche, fiche produit, panier, favoris

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Liste des jeux (filtre `active`, tri `sort_order`, liste vide → gabarit conservé, icône cassée → icône du design) | `context/GameContext.js:42-52` ; `components/game/GameCard.js:63-65` | `GET /games` (`routers/games.py:53`) | `loadGames()` `:3623`, `renderGames()` `:3635` | fait |
| Catalogue : `game, type, q, sort, popular, favorites, min_price, max_price` (rien d'autre) | `pages/Catalog.js:118,142,244` | `GET /products` (`routers/products.py:75`) | `qs()` `:3778`, `catalogQuery()` `:3779`, `loadCatalogFor()` `:3829` | fait |
| Puces du design : 0 = populaire (`popular=1`), 1 = prix croissant/décroissant (`sort`) | `pages/Catalog.js:244,118` | `GET /products` | clic `:4791` (`applyCatalogQuery`) | fait |
| Options de tri de REF sans conteneur (`sortDefault`, `unit_price` non accepté par l'API) | `pages/Catalog.js:118` | `routers/products.py:78` | — | NON FAIT (design : 2 puces, aucune liste à 4 options) |
| Recherche `q` | `pages/Catalog.js:142` | `GET /products` | `catalogQuery()` `:3779` | fait |
| Fiche produit + état d'erreur (slug inconnu) | `pages/Product.js:81-93` | `GET /products/{slug}` (`routers/products.py:118`) | `openProduit()` `:3760`, `renderProduit()` `:3736`, `renderProduitError()` `:3753` | fait |
| Fiche produit : `related` (4) | `pages/Product.js:145-149` | `GET /products/{slug}` | — | NON FAIT (design : pas de conteneur « related ») |
| Panier : règles complètes | `context/CartContext.js:16-34,49-53` | — | `addToCart()` `:3687`, `syncPill()` `:3706`, `cartCap()` `:3684`, `syncPillsFromCart()` `:3715` | fait |
| Favoris : bascule + filtre catalogue côté client | `lib/favorites.js:41-48` ; `pages/Catalog.js:155-157` | `GET /products?favorites` | `toggleFav()` `:3725`, `renderCatalog()` `:3794` | fait |
| Accueil : rubans populaires / abonnements | `pages/Home.js:430-457` | `GET /products` | — | NON FAIT (design : hero, deux colonnes, marquee — aucun conteneur produits) |
| Accueil : événements | `pages/Home.js:407` | `GET /events` (`routers/events.py:46`) | `renderEvents()` `:4680` (pré-chargé par `loaders.accueil`) | fait |
| Pack évolutif embarqué dans l'onglet `evo` du catalogue | `pages/Catalog.js:13,243,274` ; `pages/PackEvolutif.js:41-43` | `GET /products?type=evo`, `GET /evo/season` | `?type=evo` filtré par le catalogue ; pack sur son écran `packVerify()` `:4670` | NON FAIT (design : pas d'onglets de type) |
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
| Commander sans compte (aucune redirection vers la connexion) | `pages/Checkout.js:250-264` ; `routers/orders.py:315-321` (`get_optional_user`) | `POST /orders` | `createOrder()` `:4108` (aucun `needLogin`) | fait |
| Point de départ de l'ID : `?pubg_id`, sinon `mgs_last_player_id`, sinon `saved_pubg_ids[0]` ; modification mémorisée | `pages/Checkout.js:56-59,80-83` | — | `coOpen()` `:3966`, écouteur `input` `:4386` | fait |
| Validation locale du champ (requis, `min_length`, `max_length` 60, motif en correspondance totale) avant tout appel | `components/store/checkout/IdentityFieldsVerify.js:20-35,78-87` | — | `fieldLocalError()` `:4006`, `fieldMessage()` `:4014`, `verifyId()` `:4041` | fait |
| Vérification d'ID : `POST /fazercards/validate-id {game_id, fields}`, champs tirés de `identity_fields` du jeu | `IdentityFieldsVerify.js:96-115` | `POST /fazercards/validate-id` (`routers/fazercards.py:118`) | `identitySpecOf()` `:3997`, `primaryKeyOf()` `:4002`, `verifyId()` `:4041` | fait |
| Table des verdicts (refus / saisie / indisponible), jamais un détail brut | `lib/identityErrors.js:16-38` | codes `invalid_id`, `missing_field`, 422/429/502/503/504 | `identityErrorKey()` `:4022` | fait |
| Suggestions d'IDs déjà utilisés : visibles tant que l'ID n'est pas vérifié, un clic **remplit sans vérifier** | `IdentityFieldsVerify.js:150-152,185-188,257-273` | — | `renderRecent()` `:3956`, clic `:4791` | fait |
| Identité mémorisée : `POST /me/game-identities` après vérification réussie, si connecté ; échec sans conséquence | `pages/Checkout.js:132-141` | `POST /me/game-identities` (`routers/games.py:110-127`, idempotent `:122-126`) | `saveIdentity()` `:4034` | fait |
| Liste/édition des identités sauvegardées (CRUD du compte) | `components/GameIdentities.js:44-63` | `GET/PATCH/DELETE /me/game-identities` (`routers/games.py:103-152`) | — | NON FAIT (design : l'écran compte n'a aucune section « identités ») |
| Méthode de paiement : `mvola` / `orange` (manuel) / `binance`, selon `providers.*.configured !== false` et `crypto.available` | `pages/Checkout.js:100-106,330-341` | `GET /payments/config` (`routers/payments.py:194`), `GET /crypto/config` (`routers/crypto.py:107`) | `loadPayCfg()` `:3622`, `coOpen()` `:3973-3976` | fait |
| Opérateur transmis (`manual_operator`) | `pages/Checkout.js:181` | `POST /orders` | `createOrder()` `:4130` | fait |
| Sélecteur de réseau USDT (NetworkPicker) | `pages/Checkout.js:335-339` | `GET /crypto/config` | réseau par défaut = `crypto.networks[0]` (`:4219`) | NON FAIT (design : aucun sélecteur) |
| Création de commande : payload exact + `identity_id` quand l'identité vérifiée est celle du compte | `pages/Checkout.js:165-188` | `POST /orders` (`routers/orders.py:315`, `OrderIn` `:64-82`) | `createOrder()` `:4108-4145` | fait |
| 422 Pydantic traduite (`payment_phone` → `checkout.phoneError`, sinon `checkout.orderValidationError`) | `pages/Checkout.js:39-47` | `POST /orders` | `validationDetails()` `:4099`, `validationField()` `:4100` | fait |
| Panier vidé DÈS la création réussie | `pages/Checkout.js:186` | — | `createOrder()` `:4138` | fait |
| Commande transmise à l'admin dès la création | `pages/Checkout.js:185-188` | `notify_new_order` en tâche de fond (`routers/orders.py:421`) | rien à appeler côté front : le backend notifie (idem preuve envoyée `:608`, relance `:660`) | fait (backend) |
| Message d'attente = statut réel (`order.next.<statut>`) + libellé (`order.status.<statut>`) | `pages/OrderTrack.js:264-270` | `GET /orders/{id}` (sondage 5 s) | `coWaitText()` `:4326`, appelé par `coReceipt()` `:4310`, `coReceiptBinance()` `:4251`, `pollOrder()` `:4337` | fait |
| Turnstile à la soumission (jeton à usage unique) | `pages/Checkout.js:228-246,365-380` | `captcha.require` (ordre) | `openHuman()` `:4072`, `createOrder()` `:4140-4143` | fait |
| Anti double-clic (une seule requête en vol) | `pages/Checkout.js:70-71,190-204` | — | `co.busy` `:4109` | fait |
| Écran de paiement manuel : nom du marchand et numéro **issus de l'API**, compte à rebours sur `payment_deadline_at` | `pages/OrderTrack.js:272,299-324` | `GET /payments/config`, `GET /orders/{id}` | `coPay()` `:4153` | fait |
| Sondage du paiement autorisé (statut `pending_payment`, méthode ni `manual` ni `binance`, toutes les 5 s, arrêt à la sortie) | `pages/OrderTrack.js:86-104,194-201` | `GET /payments/{id}/status` (`routers/payments.py:294`) | `startPaymentPoll()` `:4173`, `stopPaymentPoll()` `:4172` | fait |
| Preuve : 1 à 3 captures **au total** (envoyées comprises), JPEG/PNG (type ou extension), 8 Mo, champ `files` | `components/store/checkout/ProofPay.js:28-30,76-101,111-128` | `POST /orders/{id}/proof` (`routers/orders.py:501-560`) | `uploadProof()` `:4274` | fait |
| Preuve : état réel relu après l'envoi ; codes `proof_*` traduits ; 429/502/503/403/404 dédiés | `ProofPay.js:33-58,119-126` | idem | `proofErrorMessage()` `:4258`, `uploadProof()` `:4274` | fait |
| Contrôle « J'ai payé le montant exact » avant l'envoi | `ProofPay.js:183-187` | — | — | NON FAIT (design : aucune case à cocher dans la feuille de preuve) |
| Relance admin (3 min / 3 max) | `ProofPay.js:212-229` | `POST /orders/{id}/remind` (`routers/orders.py:615`, cooldown `:627`, max `:628`) | — | NON FAIT (design : l'écran d'attente n'a que « Voir ma commande ») |
| Reprise de commande en attente (silencieuse) : `GET /orders/{id}`, écran par statut | `pages/OrderTrack.js:156-188,266-359` | `GET /orders/{id}` (`routers/orders.py:467`) | `resumePendingOrder()` `:3890`, `hydrateCoFromOrder()` `:3870` | fait |
| Annulation par motif : 5 raisons de REF, aucune présélectionnée, `POST /orders/{id}/cancel { reason }` seul | `components/store/checkout/CancelSheet.js:20-26,39-40,46-51,81` | `POST /orders/{id}/cancel` (`routers/orders.py:680`, `CancelIn` `:124-127`) | `openCancel()` `:4325`, `confirmCancel()` `:4344` | fait |
| Annulation : 409 distingué (`cancel_conflict` / `cancel_not_allowed`), état réel rechargé ; succès → accueil | `CancelSheet.js:52-62` ; `OrderTrack.js:399-407` | idem | `confirmCancel()` `:4350-4358` | fait |
| Motif `wrong_info` (1re raison de REF) | `CancelSheet.js:21` | `CancelIn` l'accepte (`routers/orders.py:126`) | radios du sélecteur `:3491-3495` (5 raisons, `wrong_info` en tête) | fait |
| Champ « Précision (facultatif) » | — | `CancelIn.note` (`routers/orders.py:127`, max 200) | `openCancel()` `:4329`, `confirmCancel()` `:4350` | fait (envoyé en `note` seulement s'il est rempli) |
| Binance : `POST /crypto/initiate {order_id, network}` après création, jamais de 2ᵉ initiation | `pages/Checkout.js:214-223` ; `pages/OrderTrack.js:163-169` | `POST /crypto/initiate` (`routers/crypto.py:112`) | `initiateBinance()` `:4200`, `resumePendingOrder()` `:3900` | fait |
| Binance : sondage `GET /crypto/{id}/status` toutes les 8 s, `CONFIRMED` → relecture, `FAILED` → arrêt, aucun `POST /crypto/{id}/paid` | `components/store/checkout/BinancePay.js:9,30-45` | `GET /crypto/{id}/status` (`routers/crypto.py:123`) | `coPayBinance()` `:4211` via `MGS_CRYPTO` (`mgs-logic-crypto.js:27,237-255`) | fait |
| Réessai de paiement automatique (`POST /payments/initiate`) | `pages/OrderTrack.js:110-122,198-201,384-388` | `POST /payments/initiate` (`routers/payments.py:214`) | — | NON FAIT (design : aucun bouton « Réessayer » ; fonction non déclenchable) |

---

## Z4 — Commandes

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Historique du client (liste complète, 200 dernières) | `pages/OrderHistory.js:297-304` | `GET /orders/me` (`routers/orders.py:436`) | `loadOrders()` `:4414`, `renderOrders()` `:4403` | fait |
| Onglets « Toutes / En cours / Terminées » en filtre **local** (aucun paramètre d'API) | `OrderHistory.js:100-106,172-194,318` | — | gabarit `cmdFilter()` `:3338` (`data-filter="all\|progress\|done"`) + `data-filter` posé par `renderOrders()` `:4400` | fait |
| Recherche locale (numéro, ID joueur, produit), insensible à la casse | `OrderHistory.js:306-318` | — | gabarit `cmdFilter()` `:3338` | fait |
| Pagination | — (REF n'en a aucune) | — | bloc `.mgs-cmd-pages` `:2447-2451`, `orderPaginate()` `:4396`, 10 par page | fait (pagination du design, sur la liste locale) |
| Détail : relecture `GET /orders/{id}` à l'ouverture | `OrderHistory.js:421-429` | `GET /orders/{id}` | `refreshOrderDetail()` `:4424` | fait |
| Détail : nombre de preuves réelles, ligne masquée à zéro | `OrderHistory.js:618-622` | `GET /orders/{id}` | `refreshOrderDetail()` `:4424` | fait |
| Détail : reçu réservé à une commande payée au moins une fois (`paid_at`) | `OrderHistory.js:469,691-698` | — | `refreshOrderDetail()` `:4433` | fait |
| Reçu (contenu : numéro, date, statut, jeu, produit, ID, méthode, montant) | `OrderHistory.js:342-374,513-525` (`window.print`) | — | bouton `.mgs-receipt-btn` : le gabarit du design produit un PNG (canvas) — mécanisme du design conservé, mêmes données | fait |
| Détail : raison d'annulation et note traduites | `OrderHistory.js:376-384,624-635` | `GET /orders/{id}` | — | NON FAIT (design : aucune ligne « raison »/« note » dans le détail) |
| Suivi public par numéro + ID joueur | `pages/OrderTrack.js:434-479,520-552` | `GET /orders/track` (`routers/orders.py:450`) | `openOrderLink()` `:4872` (`/suivi/:numero`, `/commandes/:id` ; ID joueur = `mgs_last_player_id`) | fait |
| Invité : texte `order.loginToSee` | `OrderTrack.js:543-550` | — | `renderOrders()` `:4405` | fait |
| Invité : bouton « Se connecter » de l'état vide | `OrderTrack.js:546-548` | — | — | NON FAIT (design : l'état vide n'a qu'une icône et un texte) |
| `/commandes` → `/suivi` | `components/common/OrdersRedirect.js:8` ; `App.js:67` | — | l'écran `commandes` EST la page (site mono-page) | fait (destination identique) |
| « Commander à nouveau » (produit relu, ID repris, `/commande?pubg_id=`) | `OrderHistory.js:486-509` | `GET /products/{slug}` | — | NON FAIT (design : aucune action de re-commande dans le détail) |

---

## Z5 — Compte, fidélité, événements, pack évolutif, chat

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Profil : `PATCH /auth/me {name, phone, saved_pubg_ids}` (ID séparés par virgules **ou** espaces) | `pages/Account.js:127-133` | `PATCH /auth/me` (`routers/auth.py:392`) | `saveProfile()` `:4478` | fait (séparateur corrigé cette session) |
| Mot de passe : `POST /auth/change-password` | `pages/Account.js:135-143` | `POST /auth/change-password` (`routers/auth.py:255`) | `changePassword()` `:4479` | fait |
| Mot de passe : contrôle « confirmation identique » | `pages/Account.js:137,239` | — | — | NON FAIT (design : pas de champ « confirmation ») |
| Suppression : confirmation tapée + mot de passe si le compte en a un | `pages/Account.js:145-151` | `POST /auth/me/delete` (`routers/auth.py:436-444`) | `deleteAccount()` `:4485` | fait (mot de passe ajouté cette session ; le design n'a pas de champ dédié) |
| Bannière « email non vérifié » + renvoi | `pages/Account.js:35-52` | `POST /auth/resend-verification` (`routers/auth.py:207`) | — | NON FAIT (design : aucune bannière dans l'écran compte) |
| Carte joueur PUBG | `components/PubgPlayerCard.js:141` | `PATCH /auth/me` | — | NON FAIT (design : aucune carte joueur) |
| Points : solde, gagnés, historique, config | `pages/Loyalty.js:141-163` | `GET /loyalty/me` (`routers/loyalty.py:60`) | `renderPoints()` `:4651` | fait (3ᵉ compteur du design = « Utilisés », somme du journal ; REF affiche `promo` — libellé du design, données réelles) |
| Récompenses : `GET /loyalty/rewards`, `cost_points` en libellé | `pages/Loyalty.js:80-90,143` | `GET /loyalty/rewards` (`routers/loyalty.py:68`) | `renderPoints()` `:4651` | fait |
| Échange : `POST /loyalty/redeem {reward_id, pubg_id}` | `pages/Loyalty.js:147-149` | `POST /loyalty/redeem` (`routers/loyalty.py:73`) | `redeem()` `:4667` | fait **avec écart** : REF n'ouvre l'échange qu'après `valid:true` (`Loyalty.js:61-92`) ; le design n'a aucun champ de vérification sur l'écran points, l'ID du compte (ou une saisie) est utilisé |
| Transferts de points | `pages/Loyalty.js:95-134` | `GET/POST /loyalty/transfers`, `…/{id}/{action}` (`routers/loyalty.py:109,153,165`) | — | NON FAIT (design : aucun formulaire de transfert) |
| Événements : liste | `pages/Events.js:16,31-47` | `GET /events` (`routers/events.py:46`) | `renderEvents()` `:4680` | fait |
| État vide `events.empty` | `pages/Events.js:36` | — | `renderEvents()` `:4683` | fait |
| « J'aime » / « Partager » (compteurs, `mgs_liked`, URL `/evenements#slug`) | `pages/Events.js:14,18-29,49-52` | `POST /events/{id}/like` (`routers/events.py:52`), `…/share` (`:66`) | `renderEvents()` `:4745`, `eventLike()` `:4716`, `eventShare()` `:4724` | fait (boutons-jetons `.mgs-chip` dans le pied de carte du design) |
| Pack évolutif : saison + éligibilité | `pages/PackEvolutif.js:41-61` | `GET /evo/season` (`routers/evo.py:110`), `GET /evo/eligibility` (`:115`) | `packVerify()` `:4670` | fait |
| Chat : composer (création de conversation puis envoi du message) | `pages/Chat.js:1-18` ; `components/chat/ChatWorkspace.js:51` ; `ChatThread.js:86` | `POST /chat/conversations`, `…/{id}/messages` (`routers/chat.py:48,80`) | `supportSend()` `:4725`, `openChat()` `:4734` | fait |
| Chat : invité → connexion, jamais de conversation sans compte | `pages/Chat.js:16-20` | `POST /chat/conversations` (`get_current_user`) | `supportSend()` `:4731`, `openChat()` `:4735` | fait |
| Chat : liste des conversations, fil, non-lus, `read` | `ChatWorkspace.js:57-96` ; `ChatThread.js:25-58` | `GET /chat/conversations`, `…/{id}/messages`, `…/{id}/read` (`routers/chat.py:48-122`) | — | NON FAIT (design : l'écran support n'a qu'un formulaire d'envoi, aucun fil) |
| `/support` = page Chat | `pages/Support.js` (réexport de `Chat.js`) | — | écran `support` + masquage des cartes sans équivalent | fait |

---

## Z6 — Hors pages clients

| Fonction | Source REF | Route backend | Prototype | État |
|---|---|---|---|---|
| Admin : 14 écrans, ~45 routes | `pages/admin/*` ; `lib/adminNav.js` | `routers/admin_users.py`, `orders.py`, `products.py`, `games.py`, `events.py`, `loyalty.py`, `payments.py`, `crypto.py` | écran `admin` masqué aux non-administrateurs (`loaders.admin` `:4740`) | NON FAIT (laissé à l'application React ; le design n'a qu'un tableau de bord statique) |
| Statut boutique, export, audit, stockage | `pages/admin/AdminLayout.js:25-29` | `/settings/status`, `/admin/status`, `/admin/export`, `/admin/audit`, `/admin/storage` (`routers/orders.py:794,890,922`) | — | NON FAIT (laissé à l'application React) |
| Notifications push (abonnement, test, alerte) | `lib/pushSync.js:127-245` ; `components/admin/AdminPush.js` | `routers/push.py:48-95`, `routers/notifications.py:19-35` | — | NON FAIT (laissé à l'application React) |
| Service worker | `public/sw.js` (push-only) ; `src/sw.test.js` | — | `frontend/public/sw.js` (copié tel quel) | fait (aucune modification nécessaire) |
| PWA (`manifest.json`, icônes) | `public/manifest.json` | — | `frontend/public/manifest.json` (copié tel quel) | NON FAIT (le manifeste du prototype garde `start_url:"/admin"` ; hors périmètre front) |
| SEO (titre, description, robots, sitemap) | `components/layout/SeoManager.js`, `lib/seo.js` | — | — | NON FAIT (site mono-page : aucun routeur à métadonnées) |
| Pages légales `/terms`, `/privacy` | `pages/Legal.js` (TERMS/PRIVACY, `App.js:70-71`) | — | écrans `terms`/`privacy` `:2575-2590`, `renderLegal()` `:4845`, texte brut copié de REF dans `frontend/public/mgs-legal.js` (18 + 13 sections, FR/EN) | fait |
| Liens de pied de page vers les pages légales | `components/layout/Footer.js:40-41` | — | `href="#terms"` / `href="#privacy"` `:2727-2728` (+ `MGS_HREF` `:3294`, `HM` `:5016`) | fait |
| Frontière d'erreur | `components/ErrorBoundary.jsx` | — | — | NON FAIT (aucun équivalent dans un IIFE ; le garde non-JSON de `req()` `:3583` couvre le cas qui faisait tomber la page) |
| Thème clair/sombre | `components/layout/ThemeToggle.js` | — | — | NON FAIT (le design v3 n'a ni `.dark` ni `prefers-color-scheme`) |
| Audit des liens internes (`href`, `data-nav`, `data-page`, URL) | — | — | `MGS_PATHS` `:4762`, `mgsPageFromUrl()` `:4781`, `MGS_URLS`/`mgsSyncUrl()` `:4827`, `openDeepLink()` `:4864` | fait : chaque route du site (`/boutique`, `/produit/:slug`, `/commande`, `/commandes/:id`, `/suivi/:numero`, `/pack-evolutif`, `/compte`, `/compte/points`, `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser/:token`, `/verifier-email/:token`, `/evenements`, `/chat`, `/support`, `/admin`) ouvre son écran, y compris par lien direct ou retour arrière |

---

## Routes servies (URL réelles du site)

`mgsPageFromUrl()` `:4781-4810` et `MGS_PATHS` `:4762-4780` reconnaissent, au
chargement, au partage de lien et au retour arrière (popstate `:4855`), les
routes de REF (`pages/App.js:49-96`) :

| URL | Écran du design | Note |
|---|---|---|
| `/` | accueil | |
| `/jeux`, `/boutique` | boutique | `/jeux` ouvre le choix du jeu (`boutiqueGames()`), comme REF |
| `/produit/:slug` | produit | la fiche est chargée par `GET /products/{slug}` (`openDeepLink()` `:4864`) |
| `/commande`, `/commande/confirmation` | commande | |
| `/commandes`, `/commandes/:id`, `/suivi`, `/suivi/:numero`, `/orders/:id` | commandes | `:id`/`:numero` ouvre le détail ; le suivi invité passe par `GET /orders/track` + dernier ID utilisé (`openOrderLink()` `:4872`) |
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

La barre d'adresse reçoit la route réelle (`mgsSyncUrl()` `:4827`), y compris
`/produit/<slug>`. **À déployer** : le serveur doit renvoyer `index.html` pour
tout chemin inconnu (repli SPA), sinon les liens profonds donnent un 404 ; les
anciens liens `#page` continuent de fonctionner.

## Éléments masqués (défaisable en une ligne)

| Élément | Emplacement | Pourquoi | Comment le rétablir |
|---|---|---|---|
| Formulaire d'abonnement du pied de page | `.footer .form-block` | aucune route backend ne l'accepte (seule l'inscription push **admin** existe, `routers/push.py:60`) | retirer la ligne `.footer .form-block` de `maskUnsupported()` `:4730` |

## Éléments visibles manquants (besoin d'un ajout de design, remonté au propriétaire)

| Écran / élément | Fonction REF | Ce qu'il faut |
|---|---|---|
| Bouton « Relancer » | `ProofPay.js:212-229` → `POST /orders/{id}/remind` | un contrôle libre sur l'écran d'attente |
| Bouton « Réessayer » | `OrderTrack.js:384-388` → `POST /payments/initiate` | un contrôle libre (REF ne l'affiche que pour `failed`/`expired` hors manuel/Binance — jamais le cas ici) |
| Sélecteur de réseau USDT | `Checkout.js:335-339` | un choix parmi `crypto.networks` (aujourd'hui : clé du 1er réseau) |
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
| Admin (14 écrans) | `pages/admin/*` | laissé à l'application React |

## Écarts de contrat (backend actuel vs REF)

| Appel | REF | Backend actuel | Conséquence dans le prototype |
|---|---|---|---|
| Erreurs métier (annulation, preuve) | `errorMessage` lit `detail.msg` (`lib/api.js:45`) | `detail = {"code", "message"}` (`routers/orders.py:474-480`) | `errMsg()` `:3595` lit aussi `message` (sinon « [object Object] ») |
| `POST /auth/register` | REF envoie `remember` (`AuthPage.js:48`) | `RegisterIn` ne le déclare pas (`routers/auth.py:36-40`) | non envoyé : sans effet, Pydantic ignore le champ |
| `POST /orders/{id}/cancel` | REF envoie `{reason}` seul | `CancelIn.note` existe (`routers/orders.py:127`) | `note` jamais envoyé (champ masqué) |
| `POST /auth/me/delete` | REF envoie `password` seulement si compte local (`Account.js:148`) | mot de passe **exigé** si `password_hash` (`routers/auth.py:442-444`) | identique ; le design n'ayant pas de champ, la valeur vient de « Mot de passe actuel » ou d'une boîte de dialogue |
| `GET /crypto/{id}/status` | REF lit `payment` (`BinancePay.js:32-39`) | projection sans `payment_deadline_at` (`routers/crypto.py:50`) | l'échéance vient de la commande (`mgs-logic-crypto.js:232-235`, `opts.deadlineAt`) |
| `POST /crypto/initiate` | réseau choisi dans `GET /crypto/config` | 400 « Réseau USDT non disponible. » (`routers/crypto.py:77-78`) | le prototype n'envoie que la clé d'un réseau actif (`:4219`) |
| `POST /fazercards/validate-id` | codes `invalid_id`, `missing_field` (`lib/identityErrors.js:20-25`) | `routers/fazercards.py:118` | table de verdicts identique (`identityErrorKey()` `:4022`) |

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
| `GET /products` | `game`, `type`, `q`, `sort`, `popular`, `favorites`, `min_price`, `max_price` | `Catalog.js:142` | `routers/products.py:75` |

## Configuration à poser au déploiement (inchangé)

- `backend/core/origins.py` : les origines autorisées doivent contenir l'origine
  exacte du site statique.
- Adresse du backend : `window.MGS_BACKEND_URL` (défaut du prototype :
  `https://magicgamestore-api-v2.onrender.com`) — à confirmer par le propriétaire.
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
   s'affiche désormais immédiatement (`boot()` `:4973`).
2. **`/commande` avec panier vide** montrait le tunnel à 0 Ar et un bouton
   actif. Désormais : message de REF + retour boutique, sauf commande en cours
   ou reprise mémorisée (`loaders.commande` `:4806`).

## Validation de cette session (sorties brutes)

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

Un harnais pré-existant reste rouge, sans rapport avec ce portage :
`node scripts/proto-logic.test.mjs` → **28 passed, 1 failed** —
« initiate : réseau inconnu refusé sans appel réseau » attend un refus LOCAL
(`invalid_network`) pour un réseau absent de la configuration. Le module
`mgs-logic-crypto.js:208-209` documente le contraire (« aucune validation locale
du réseau : c'est le backend qui statue »), et REF ne valide pas non plus côté
client (`Checkout.js` ne propose que `crypto.networks`) : le test est en
désaccord avec REF, il n'a **pas** été modifié.

## Commits de cette session (branche `feat/proto-fonctionnel`, poussés)

```
b1f1c70 feat(proto): vrais liens de pages + fonctions du design rebranchées
6586da7 feat(proto): la barre d'adresse affiche /produit/<slug> quand la fiche est ouverte
0219c78 fix(z6): clés i18n ajoutées (11 clés de REF) — 0 clé hors REF
e300442 fix(auth): backend = api.magicgame.store, formulaires de connexion réels (Google + gestionnaire de mots de passe)
<ce commit> fix(proto): message d'attente et libellés = statuts réels de la commande
```

## Reste ouvert (remonté au propriétaire)

1. **Éléments qui exigent un ajout de design** (un conteneur chacun) : bouton
   « Relancer » (`/orders/{id}/remind`), bouton « Réessayer »
   (`/payments/initiate`), sélecteur de réseau USDT, case « montant exact »,
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
