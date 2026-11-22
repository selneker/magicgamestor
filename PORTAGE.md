# PORTAGE — application `main` → prototype statique

Fichier de reprise. Il liste **chaque fonction** portée, sa source dans `main`
(`frontend/src/...`), la route backend qui la sert (`backend/routers/...`) et
l'endroit du prototype qui la porte (`frontend/public/index.html`, runtime
IIFE à la fin du fichier, ou `frontend/public/mgs-logic-*.js`).

Sources de l'inventaire S0 (lecture seule, branche `main`) :
`git ls-tree`/`git grep` sur `main -- frontend/src frontend/public` et
`main -- backend/routers` ; appels du prototype : `grep -n -E 'req\("…'`
`frontend/public/index.html` (runtime : lignes 3502-4505).

Règles appliquées :

- aucune modification de design (classes, styles, animations, ordre des blocs) ;
- toute chaîne visible passe par `t()` avec une clé FR **et** EN ;
- toute erreur de requête produit un message visible (aucun `.catch(function(){})` vide) ;
- aucun script de démo, aucun faux fournisseur, aucun E2E dans les validations ;
- le prototype n'est jamais plus strict que `main`.

État : `porté` = comportement de `main` reproduit ; `à porter` = dans le design,
pas encore repris de `main` ; `diverge` = repris mais écart documenté ;
`absent du design` = pas d'écran dans le prototype.

Écrans du prototype (`data-page`) : accueil, admin, boutique, commande, commandes,
compte, connexion, evenements, mdp, pack, points, produit, reset, support.

---

## Z0 — Socle (client API, erreurs, session, langue, redirections, invité, panier)

| Fonction | Source `main` | Route backend | Auth | Prototype | État |
|---|---|---|---|---|---|
| Base d'URL + `withCredentials` (cookies) | `lib/api.js:3-10` | — | non | `index.html:3511-3512`, `req()` 3649 | identique |
| Refresh silencieux 401 + liste `NO_SILENT_REFRESH` | `lib/api.js:12,40-59` | `POST /auth/refresh` (`routers/auth.py:363`) | non | `req()` + `NO_SILENT_REFRESH` | identique |
| En-têtes langue + `mgs_session` | `lib/api.js:77,82-85` | — | non | `sessionId()` | corrigé : main n'envoie aucun en-tête de langue ; clé `mgs_session` (était `mgs_session_id`) |
| Erreurs 401/403/409/422/429/5xx avec message visible | `lib/api.js:64` (`errorMessage`) + `lib/authErrors.js:25-54` | réponses HTTP | — | `authErr()`, `errMsg()`, `signale()` | identique (mêmes CODE_MAP / STATUS_MAP) |
| État de connexion (équivalent `AuthContext`) | `context/AuthContext.js:27-49,58-61` | `GET /auth/me` (`routers/auth.py:387`) | oui | `loadSession()`, `me` | identique (401 silencieux, 2 reprises 3 s/8 s, hors ligne sans message) |
| Déconnexion sans vider le panier | `context/AuthContext.js:58-61` | `POST /auth/logout` (`routers/auth.py:404`) | oui | `logout()` | identique |
| Traductions `t()` FR/EN | `i18n/translations.js` | — | — | `t()` + `LANG` + `T` | aligné sur les clés de `main` (82 clés, 6 exceptions — voir plus bas) |
| Redirections / pages protégées (`from`) | `components/ProtectedRoute.js:29-30` | — | — | `needLogin()`, `authReturnTo` | identique |
| Panier (stockage `mgs_cart`) | `context/CartContext.js:10-14` | — | non | `cart`/`saveCart()` | corrigé (clé `mgs_cart`, était `mgs_cart_v3`) |
| Favoris | `lib/favorites.js:8,45,51` | `GET /products?favorites` (`routers/products.py:75`) | non | `syncFavs()` | identique (même clé `mgs_favorites`) |
| Commande en attente (`mgs_pending_order_id`) | `lib/pendingOrder.js:17-39` | — | non | à vérifier | à porter |
| IDs joueur récents | `lib/recentPlayerIds.js:40,94` | — | non | `renderRecent()` | à vérifier (clé `mgs_recent_ids`) |

### État de départ (Z0, commit `3c238f6`)

- `yarn build` : **échec** sans `REACT_APP_BACKEND_URL` (garde-fou
  `scripts/check-backend-url.mjs --strict`), **réussite** avec
  `REACT_APP_BACKEND_URL=https://magicgamestore-api-v2.onrender.com` (exit 0).
- `yarn test:ci` : **0 échec** (8 suites / 37 tests, exit 0).

### Visibilité navigation — invité / connecté

Source `main` : `components/layout/Header.js` (desktop 300-360, mobile 362-395,
`LoyaltyChip` 27-52, `MobilePointsPill` 57-90, `AccountAction` 127-168) et
`lib/bottomChrome.js:8-16,30-38`.

| Élément | Invité (`main`) | Connecté (`main`) | Prototype après Z0 |
|---|---|---|---|
| Pilules boutique / commandes / support / compte | visibles | visibles | visibles (inchangé) |
| Pastille points bureau `.nav-points-pill` | absente | visible si `/loyalty/me` a répondu | masquée tant que `me` ou `/loyalty/me` n'est pas connu (`loyaltyOk`) |
| Pastille points mobile `.nav-mobile-actions a[data-nav=points]` | absente | visible si `/loyalty/me` a répondu | idem |
| Cercle compte mobile | bouton « Connexion » → `/connexion` | icône compte → `/compte` | lien `compte` → `/compte` ; invité : `renderAccount()` renvoie vers la connexion (`needLogin`) |
| Panier (bureau + mobile) | visible, badge 0 | visible, badge `count` | visible, badge `cartCount()` |
| Panneau du burger | boutique, événements, suivi, chat, **connexion** | + compte, points, panier | 4 entrées fixes de la maquette (boutique, commandes, support, compte) — main n'a pas d'équivalent pour les 4 dans ce panneau |
| Barre basse | visible | visible, masquée sur `/commande` | visible, masquée sur `commande` (CSS `index.html:1091`) |
| Pied de page | visible | visible, absent sur `/commande` et `/admin` | visible, absent sur `connexion` (CSS `index.html:855`) |

### `t()` — correspondance des clés (Z0)

Toutes les clés du prototype sont maintenant des clés de `main`
(`frontend/src/i18n/translations.js`), avec les textes FR **et** EN de `main`.
Correspondances non triviales :

| Prototype (avant) | `main` |
|---|---|
| `toast.added` | `product.added` |
| `toast.saved` | `account.saved` |
| `toast.pwchanged` | `account.passwordChanged` |
| `toast.deleted` | `account.deleted` |
| `toast.redeem` | `loyalty.redeemed` |
| `toast.forgot` | `auth.forgotSent` |
| `toast.google` | `auth.google` |
| `toast.logout` | `nav.logout` |
| `toast.sent` | `chat.sent` |
| `err.generic` / `err.network` / `err.origin` / `err.auth` | `common.error` |
| `err.login` | `auth.errorInvalidCredentials` |
| `checkout.empty` | `cart.empty` |
| `checkout.needId` | `checkout.verifySub` |
| `checkout.needVerify` | `checkout.verifyRequired` |
| `checkout.needMethod` | `checkout.selectMethod` |
| `checkout.invalidId` | `checkout.verifyIdInvalid` |
| `checkout.noCatalog` | `catalog.emptyGame` |
| `checkout.binanceAmount` | `checkout.binanceExactAmount` |
| `checkout.binanceConfirmed` | `checkout.success` |
| `checkout.binanceDetected` | `checkout.cryptoDetected` |
| `checkout.binanceFailed` | `checkout.cryptoFailed` |
| `checkout.binanceOff` | `checkout.papiOff` |
| `checkout.captchaAgain` | `captcha.verifyAgain` |
| `checkout.needProof` | `checkout.proofCount` |
| `checkout.proofOk` | `order.banner.proofWaiting` |
| `checkout.uploading` | `checkout.proofSubmitting` |
| `checkout.cancelCta` (data-i18n) | `checkout.cancelOrder` |
| `orders.empty` | `order.none` |
| `orders.login` | `order.loginToSee` |
| `status.done` / `status.cancel` / `status.pending` / `status.verify` | `order.status.delivered` / `.cancelled` / `.pending_payment` / `.awaiting_verification` |
| `status.progress` | `order.tabs.progress` |
| `method.mvola` / `method.orange` / `method.binance` | `checkout.methodMvola` / `.methodOrange` / `.binanceTitle` |
| `pack.checking` / `pack.eligible` / `pack.noSeason` | `evo.checking` / `evo.eligible` / `evo.noSeason` |
| `pack.needId` | `evo.pubgLabel` |
| `pack.notEligible` | `evo.invalidId` |
| `points.pidPrompt` | `checkout.playerId` |
| `points.redeem` | supprimé — main affiche `{cost_points} pts` (`pages/Loyalty.js:88`) |
| `confirm.delete` | `account.deleteWarning` |
| `auth.emailBad` / `auth.emailFirst` / `auth.pwShort` / `auth.googleFailed` / `err.auth` | `auth.errorGeneric` |
| `auth.needToken` | `auth.errorInvalidLink` |
| `auth.pwMismatch` | `auth.passwordMismatch` |
| `auth.pwPrompt` | `auth.password` |
| `catalog.sortPopular` / `sortPriceAll` / `sortPriceAsc` / `sortPriceDesc` | `catalog.popular` / `.sortDefault` / `.priceAsc` / `.priceDesc` |

**Exceptions (6 clés, sans équivalent dans `main`)** — écrans de la maquette qui
n'existent pas dans `main` (`/support` = page Chat dans `main`) ou libellés que
`main` n'a pas : `support.login`, `support.needMsg`, `support.chatOpen`,
`support.waPending`, `checkout.cancelNote`, `checkout.cancelSub`.

### Invité — ce que Z0 a aligné

- `/commandes` : `main` redirige vers `/suivi` (page publique,
  `components/common/OrdersRedirect.js:8`) ; le prototype affichait l'écran de
  connexion. Corrigé : l'invité voit l'écran `commandes` avec l'état vide
  `order.loginToSee`.
- `/compte` et `/compte/points` restent protégés (`needLogin`), comme
  `components/ProtectedRoute.js:29-30`.

---

## Z1 — Authentification (session, connexion, inscription, mot de passe, email)

| Fonction | Source `main` | Route backend | Prototype | État |
|---|---|---|---|---|
| Restauration de session au chargement (401 = déconnecté, panne = 2 reprises puis hors ligne, sans message) | `context/AuthContext.js:27-49` | `GET /auth/me` (`routers/auth.py:387`) | `loadSession()` `index.html:3587-3597` | porté |
| Refresh silencieux sur 401, sauf liste d'endroits d'auth | `lib/api.js:12,40-59` | `POST /auth/refresh` (`routers/auth.py:363`) | `NO_SILENT_REFRESH` `index.html:3548`, `req()` `:3553` | porté |
| Connexion : un seul `POST /auth/login`, `data.user` posé directement | `pages/AuthPage.js:38-49` | `POST /auth/login` (`routers/auth.py:195-211`) | `doAuth()` `index.html:4085` (appel `:4106`) | porté |
| Inscription : un seul `POST /auth/register` (pas de second login), `data.user`, message « email de vérification envoyé » | `pages/AuthPage.js:42-46` | `POST /auth/register` (`routers/auth.py:166-193`) | `doAuth()` `index.html:4085` (appel `:4106`) | porté |
| « Se souvenir » coché par défaut, envoyé en `remember` | `pages/AuthPage.js:25,111-119` | `POST /auth/login` | `boot()` `index.html:4389` ; `doAuth()` `:4097-4098` | porté |
| Validation email / mot de passe (8 car. inscription, 6 connexion, nom requis) | `pages/AuthPage.js:100-105` | — | `doAuth()` `index.html:4088-4092` | porté |
| Messages d'erreur d'auth : par `code`, sinon statut HTTP, sinon repli — jamais le détail anglais | `lib/authErrors.js:12-64` | réponses 400/401/403/409/422/429/5xx | `authErr()` `index.html:4020-4027` | porté |
| Captcha Turnstile : widget monté seulement si la clé publique existe ; inscription ou connexion déjà échouée ; apparence `always` si l'API l'exige | `pages/AuthPage.js:33,51-55,120` ; `components/common/CaptchaWidget.js:110-116` | `captcha.require` / `_check_lock` (`routers/auth.py:113-133,169,199`) | `renderAuthCaptcha()` `index.html:4059-4072` / `syncAuthCaptcha()` `:4073-4080` | porté |
| Redirection après connexion vers la page d'origine (`from`), accueil par défaut | `pages/AuthPage.js:34,36,49` ; `components/ProtectedRoute.js:29-30` | — | `authReturnTo` `index.html:4005`, `doAuth()` `:4111`, `needLogin()` `:4007`, `loaders.connexion` `:4285` | porté |
| Déjà connecté + visite de `/connexion` → redirection vers la page d'origine | `pages/AuthPage.js:36` | — | `loaders.connexion` `index.html:4285` | porté |
| Mot de passe oublié : envoi, message inline, captcha, erreurs traduites | `pages/AuthExtras.js:48-76` | `POST /auth/forgot-password` (`routers/auth.py:222-241`) | `forgotPassword()` `index.html:4140-4146` / `renderForgotCaptcha()` `:4128-4139` | porté |
| Réinitialisation par jeton (`/reinitialiser/:token`), 8 car. min., confirmation identique, lien invalide → message | `pages/AuthExtras.js:78-101` ; `App.js:76` | `POST /auth/reset-password` (`routers/auth.py:244-253`) | `resetPassword()` `index.html:4178-4189` / `resetTokenFromUrl()` `:4149-4157` | porté |
| Vérification d'email (`/verifier-email/:token`) : jeton consommé au chargement, message visible, session rafraîchie | `pages/AuthExtras.js:103-126` ; `App.js:77` | `POST /auth/verify-email` (`routers/auth.py:213-220`) | `verifyTokenFromUrl()` `index.html:4161-4164` + `boot()` `:4403-4411` | porté |
| Connexion Google : départ vers `/auth/google/start?return_to=…` | `components/AuthCallback.js:8-11` | `GET /auth/google/start` (`routers/auth.py:288-317`) | `googleLogin()` `index.html:4126` | porté |
| Retour Google en échec (`?error=google`) : message + URL nettoyée | `components/AuthCallback.js:14-28` | `GET /auth/google/callback` (`routers/auth.py:319-…`) | `handleGoogleError()` `index.html:4168-4177` | porté |
| Déconnexion : `POST /auth/logout`, session vidée, retour accueil — **le panier n'est pas vidé** | `context/AuthContext.js:58-61` ; `context/CartContext.js:10-14` | `POST /auth/logout` (`routers/auth.py:404`) | `logout()` `index.html:4040` | porté |
| Points fidélité : pastille masquée hors connexion | `components/layout/Header.js:33-35` | `GET /loyalty/me` (`routers/loyalty.py:60`) | `syncAuthChrome()` `index.html:4006` | porté |
| Pages protégées (`/compte`, `/compte/points`) : redirection vers la connexion puis retour. `/commandes` n'est PAS protégée (`main` la redirige vers `/suivi`, `components/common/OrdersRedirect.js:8`) | `components/ProtectedRoute.js:29-30` ; `App.js:68,80-81` | — | `needLogin()` `index.html:4007` | porté |

### Preuves de lignes (Z1) — les trois règles citées brut

- **Nom ≥ 2 caractères** : `main` `frontend/src/pages/AuthPage.js:100` — `required minLength={2}` sur
  l'input `#name` (inscription). Prototype `frontend/public/index.html:4092` —
  `if (authMode === "register" && (($("#reg-name") || {}).value || "").trim().length < 2)`.
- **Apparence Turnstile** : `main` `frontend/src/components/common/CaptchaWidget.js:116` —
  `appearance: visible ? "always" : "interaction-only"` (commentaire `:110-115`).
  Prototype `frontend/public/index.html:4071` —
  `cap.render(authCaptchaBox, { appearance: authCaptchaRequired ? "always" : "interaction-only", … })`.
- **Pastille de points** : `main` `frontend/src/components/layout/Header.js:35` —
  `if (!user || total === null) return null;` (appel `GET /loyalty/me` `:29-31`).
  Prototype `frontend/public/index.html:4006` —
  `function syncAuthChrome() { var on = !!me && loyaltyOk; … }`.

### Modules vérifiés (aucune modification nécessaire)

| Module | Référence `main` | Verdict |
|---|---|---|
| `mgs-logic-captcha.js` | `components/common/CaptchaWidget.js:103-122` (render, sitekey, theme, size, appearance, language, callbacks) | conforme — `mgs-logic-captcha.js:138` (`appearance`), `:147-150` (theme/size/language) |
| `mgs-logic-crypto.js` | `pages/Checkout.js:177` (`POST /crypto/initiate`) ; `components/store/checkout/BinancePay.js:32` (`GET /crypto/{id}/status`) ; `routers/crypto.py:107,112,123,130` | conforme — `mgs-logic-crypto.js:27` (`POLL_MS = 8000`) |

### Écarts connus (Z1)

- Pas d'écran dédié « vérification d'email » : le jeton est consommé et le
  résultat affiché par un toast (élément visible manquant, voir plus bas).
- La suppression de compte passe par `confirm()` + `prompt()` (consigne
  PL-FE-012-V1 : « aucun nouvel élément ») ; `main` a un formulaire dédié.
- La déconnexion retourne à l'accueil avec un toast ; `main` reste sur la page
  et laisse `ProtectedRoute` renvoyer vers `/connexion`. Navigation non touchée
  (consigne : « ni la navigation »).
- L'échec Google affiche `auth.errorGeneric` ; `main` a un texte dédié codé en
  dur (`AuthCallback.js:20`), absente du dictionnaire.

---

## Z2 — Catalogue, recherche, fiche produit, panier

| Fonction | Source `main` | Route backend | Prototype | État |
|---|---|---|---|---|
| Liste des jeux (filtre `active`, tri `sort_order`) | `context/GameContext.js:42-52` | `GET /games` (`routers/games.py:53`) | `loadGames()` `index.html:3599`, `renderGames()` `:3606` | porté |
| Catalogue : `game, type, q, sort, popular, favorites, min_price, max_price` | `pages/Catalog.js:142` | `GET /products` (`routers/products.py:75`) | `qs()` `index.html:3735`, `catalogQuery()` `:3736`, `loadCatalogFor()` `:3786` | porté |
| Fiche produit | `pages/Product.js:81` | `GET /products/{slug}` (`routers/products.py:118`) | `openProduit()` `index.html:3717`, `renderProduit()` `:3702` | porté |
| Fiche produit : `related` (4) | `pages/Product.js:145-149` | `GET /products/{slug}` (champ `related`) | aucun conteneur dans le design | non porté (design) |
| Accueil : populaires / prime / evo | `pages/Home.js:389-391` | `GET /products` | aucun conteneur produits sur l'accueil | non porté (design) |
| Accueil : événements | `pages/Home.js:407` | `GET /events` (`routers/events.py:46`) | `renderEvents()` `index.html:4289` (pré-chargé depuis `loaders.accueil`) | partiel |
| Panier : un seul jeu par panier | `context/CartContext.js:16-21` | — | `addToCart()` `index.html:3653` | porté |
| Panier : doublon Prime / Prime+ | `context/CartContext.js:23-26` ; `addFeedback` `:49-53` | — | `addToCart()` `:3653` (`product.duplicateSub`) | porté |
| Panier : quantités (1 souscription/évo, 20 max) | `context/CartContext.js:29,34` ; `components/store/ProductCard.js:53,88` ; `components/store/CartDrawer.js:129` | — | `isSingle()` `index.html:3649`, `syncPill()` `:3672`, tiroir panier `:4393` | porté |
| Favoris : bascule + persistance | `lib/favorites.js:3,41-48` | — | `toggleFav()` `index.html:3691`, `getFavs()` `:3690` | porté |
| Favoris : filtre catalogue | `pages/Catalog.js:155-157` | `GET /products?favorites` | `renderCatalog()` `index.html:3748` | porté |
| Pack évolutif intégré au catalogue (type `evo`) | `pages/Catalog.js:13,243,274` ; `pages/PackEvolutif.js:41-43` | `GET /products?type=evo`, `GET /evo/season` (`routers/evo.py:110`) | `?type=evo` accepté par le catalogue ; pack sur son écran `packVerify()` `:4265` | écarté (pas d'onglet type) |
| Règles ajoutées sans équivalent dans `main` | commits `3a3ed0c`, `af89a88`, `224ca8c`, `5871a5b`, `5895a64` | — | tri client par prix absolu retiré (`194533a`) | traité |

### Preuves de lignes (Z2)

- **Liste des jeux** : `main` `frontend/src/context/GameContext.js:42` (`api.get("/games")`),
  `:45` (`g.active !== false`), `:47` (`(a.sort_order ?? 0) - (b.sort_order ?? 0)`).
  Prototype `frontend/public/index.html:3599` (les trois opérations), rendu `:3606`.
- **Paramètres catalogue** : `main` `frontend/src/pages/Catalog.js:142` —
  `api.get("/products", { params: { game, type, q, sort, popular, favorites, min_price, max_price } })`.
  Prototype `index.html:3786-3792` (même objet) ; `qs()` `:3735` omet les valeurs vides,
  comme axios omet `undefined`.
- **Fiche produit** : `main` `frontend/src/pages/Product.js:81` — `` api.get(`/products/${slug}`) ``.
  Prototype `index.html:3717` — `req("/products/" + encodeURIComponent(slug))`.
- **Panier** : `main` `frontend/src/context/CartContext.js:21` (un seul jeu), `:23-26`
  (doublon d'abonnement), `:29` (`Math.min(20, …)`, `single ? 1`). Prototype `index.html:3653-3663`.
- **Favoris** : `main` `frontend/src/lib/favorites.js:41-48` (bascule + `mgs_favorites`),
  `frontend/src/pages/Catalog.js:155-157` (filtre client). Prototype `index.html:3691` et `:3748`.

### Limites du design v3 (aucun nouvel élément)

- **`related` (4)** : `main` `pages/Product.js:145-149` rend une grille `.mgs-grid--3` de
  `ProductCard`. L'écran `produit` du design n'a que `.mgs-grid--2` + `.mgs-buybar` — aucun
  conteneur « related ». Non porté plutôt que d'ajouter un élément visible.
- **Accueil** : `main` `pages/Home.js:430-457` (sections populaires / abonnements) n'a aucun
  conteneur equivalent dans le design (hero, deux colonnes, marquee, sécurité, logos).
  Les événements, eux, sont chargés (`index.html:4289`) et affichés sur la page Événements.
- **Pack évolutif** : `main` `pages/Catalog.js:274` rend `PackEvolutif embedded` dans l'onglet
  `evo`. Le catalogue du prototype n'a pas d'onglets de type (2 puces de tri) ; `?type=evo`
  filtre la grille, et le pack reste sur son écran dédié (`packVerify()`).
- **Thème sombre** : le design v3 n'a ni sélecteur `.dark`, ni `prefers-color-scheme`, ni lecteur
  de `mgs-theme` (`grep -c` = 0 dans `index.html`). L'auto-contrôle Z2 tourne donc en clair ;
  le « sombre » de `audit-contrast` est un no-op sur ce prototype.

---

## Z3 — Paiement (identité, méthode, commande, preuve, annulation, attente, Binance)

| Fonction | Source `main` | Route backend | Auth | Prototype | État |
|---|---|---|---|---|---|
| Identités joueur sauvegardées (CRUD) | `components/GameIdentities.js:44-62` | `GET/POST/PATCH/DELETE /me/game-identities` (`routers/games.py:103-152`) | oui | absent | à porter |
| IDs récents (localStorage, 10 max) | `lib/recentPlayerIds.js:40,94` | — | non | `renderRecent()` | à porter |
| Validation d'ID joueur | `components/store/checkout/IdentityFieldsVerify.js:102` | `POST /fazercards/validate-id` (`routers/fazercards.py:118`) | non | `req("/fazercards/validate-id")` 3876 | à porter |
| Config paiements (méthodes, mode) | `pages/Checkout.js:78` | `GET /payments/config` (`routers/payments.py:194`) | non | `loadPayCfg()` 3691 | à porter |
| Config Binance/USDT | `pages/Checkout.js:79` | `GET /crypto/config` (`routers/crypto.py:107`) | non | `MGS_CRYPTO` | à porter |
| Choix de la méthode (manuel vs binance) | `pages/Checkout.js:160-180` | — | — | à vérifier | à porter |
| Création de commande (payload exact) | `pages/Checkout.js:135-142` | `POST /orders` (`routers/orders.py:315`) | non | à vérifier | à porter |
| Preuve de paiement (1 à 3 captures) | `components/store/checkout/ProofPay.js:119` | `POST /orders/{id}/proof` (`routers/orders.py:501`) | non | à vérifier | à porter |
| Relance admin (3 min / 3 max) | `components/store/checkout/ProofPay.js:216` | `POST /orders/{id}/remind` (`routers/orders.py:615`) | non | à vérifier | à porter |
| Annulation avec motif | `components/store/checkout/CancelSheet.js:46` | `POST /orders/{id}/cancel` (`routers/orders.py:680`) | non | à vérifier | à porter |
| Initiation paiement (MVola/Orange) | `pages/OrderTrack.js:120` | `POST /payments/initiate` (`routers/payments.py:214`) | non | à vérifier | à porter |
| Statut paiement (sondage 5 s) | `pages/OrderTrack.js:97` | `GET /payments/{id}/status` (`routers/payments.py:294`) | non | à vérifier | à porter |
| Binance : initiate / statut / « payé » | `pages/Checkout.js:177` ; `components/store/checkout/BinancePay.js:32` | `POST /crypto/initiate` (`routers/crypto.py:112`), `GET /crypto/{id}/status` (`:123`), `POST /crypto/{id}/paid` (`:130`) | non | `MGS_CRYPTO` | à porter |
| Écran d'attente / reprise de commande | `pages/CheckoutConfirm.js` ; `lib/pendingOrder.js` | — | non | à vérifier | à porter |

---

## Z4 — Commandes (suivi, historique, filtres, détail, reçu)

| Fonction | Source `main` | Route backend | Auth | Prototype | État |
|---|---|---|---|---|---|
| Suivi par numéro + ID joueur | `pages/OrderTrack.js:455` | `GET /orders/track` (`routers/orders.py:450`) | non | absent du design | absent du design |
| Suivi par id de commande | `pages/OrderTrack.js:163` | `GET /orders/{id}` (`routers/orders.py:467`) | optionnel | `req("/orders/…")` 3993,4007,4030 | à porter |
| Historique du client | `pages/OrderHistory.js:159` | `GET /orders/me` (`routers/orders.py:436`) | oui | `req("/orders/me")` 4091,4127 | à porter |
| Détail + re-produit + reçu | `pages/OrderHistory.js:270,318` | `GET /orders/{id}`, `GET /products/{slug}` | oui | à vérifier | à porter |
| Filtres / pagination de l'historique | `pages/OrderHistory.js` | `GET /orders/me` | oui | à vérifier | à porter |
| Lien « commandes » → suivi | `components/common/OrdersRedirect.js:8` | — | — | écran `commandes` | à porter |

---

## Z5 — Compte, points, événements, pack évolutif, notifications

| Fonction | Source `main` | Route backend | Auth | Prototype | État |
|---|---|---|---|---|---|
| Profil (nom, téléphone, IDs sauvegardés) | `pages/Account.js:132` | `PATCH /auth/me` (`routers/auth.py:392`) | oui | `saveProfile()` 4129 | à porter |
| Mot de passe | `pages/Account.js:142` | `POST /auth/change-password` (`routers/auth.py:255`) | oui | `changePassword()` 4130 | à porter |
| Suppression (`confirmation: "SUPPRIMER"`) | `pages/Account.js:150` | `POST /auth/me/delete` (`routers/auth.py:436`) | oui | `deleteAccount()` 4131 | diverge (confirm/prompt) |
| Renvoyer l'email de vérification | `pages/Account.js:51` | `POST /auth/resend-verification` (`routers/auth.py:207`) | oui | absent | à porter |
| Carte joueur PUBG | `components/PubgPlayerCard.js:141` | `PATCH /auth/me` | oui | à vérifier | à porter |
| Points : solde, ledger, config | `pages/Loyalty.js:147` ; `components/layout/Header.js:29` | `GET /loyalty/me` (`routers/loyalty.py:60`) | oui | 4126,4172,4277,4499 | à porter |
| Récompenses + échange | `pages/Loyalty.js:150,155` | `GET /loyalty/rewards` (`:68`), `POST /loyalty/redeem` (`:73`) | non/oui | 4286,4291 | à porter |
| Transferts de points | `pages/Loyalty.js:103,106` | `POST /loyalty/transfers` (`:109`), `…/{id}/{action}` (`:153,165`) | oui | à vérifier | à porter |
| Événements (liste, like, partage) | `pages/Events.js:22,30,38` | `GET /events` (`routers/events.py:46`), `POST /events/{id}/like` (`:52`), `…/share` (`:66`) | non | 4307,4314,4322 | à porter |
| Pack évolutif (saison, éligibilité) | `pages/PackEvolutif.js:41-61` | `GET /evo/season` (`routers/evo.py:110`), `GET /evo/eligibility` (`:115`) | non | 4298,4367 | à porter |
| Chat client (conversations, messages, non-lus) | `pages/Chat.js`, `components/chat/ChatWorkspace.js:29,54`, `ChatThread.js:25,31,86` | `GET/POST /chat/*` (`routers/chat.py:48-122`) | oui | 4355-4358 | à porter |

---

## Z6 — Hors pages clients

| Fonction | Source `main` | Route backend | Auth | Prototype | État |
|---|---|---|---|---|---|
| Admin (14 écrans : commandes, catalogue, jeux, fournisseur, événements, messages, fidélité, utilisateurs, paiements, notifications) | `pages/admin/*` ; `lib/adminNav.js` | `routers/admin_users.py`, `orders.py`, `products.py`, `games.py`, `events.py`, `loyalty.py`, `payments.py`, `crypto.py`, `fzr_orders.py` | admin | écran `admin` | à porter / à laisser à l'appli React |
| Statut boutique en ligne + export + audit + stockage | `pages/admin/AdminLayout.js:25-29` ; `routers/orders.py:794,890,922` | `/settings/status`, `/admin/status`, `/admin/export`, `/admin/audit`, `/admin/storage` | admin | à vérifier | à porter / à laisser à l'appli React |
| Notifications push (abonnement, test, alerte) | `lib/pushSync.js:127-245` ; `components/admin/AdminPush.js` | `routers/push.py:48-95`, `routers/notifications.py:19-35` | admin | à vérifier | à porter / à laisser à l'appli React |
| Service worker | `public/sw.js` (push-only) ; `src/sw.test.js` | — | — | `public/sw.js` | à vérifier |
| PWA | `public/manifest.json`, icônes | — | — | `public/manifest.json` | à vérifier |
| SEO | `components/layout/SeoManager.js`, `lib/seo.js`, `public/robots.txt`, `public/sitemap.xml` | — | — | à vérifier | à porter |
| Pages légales (`/terms`, `/privacy`) | `pages/Legal.js` ; `App.js:70-71` | — | non | absent du design | absent du design |
| Frontière d'erreur, transitions, thème | `components/ErrorBoundary.jsx`, `components/animate-ui/…`, `components/layout/ThemeToggle.js` | — | — | à vérifier | à porter |

---

## Visiteur sans compte — ce que `main` autorise

| Action | `main` sans compte | Source |
|---|---|---|
| Parcourir accueil, boutique, jeux, produit, événements, pack | oui | `App.js:50-56,69` (routes non protégées) |
| Ajouter au panier | oui (localStorage) | `context/CartContext.js:10-14` |
| Commander | oui | `POST /orders` en `get_optional_user` (`routers/orders.py:315-321`) + captcha |
| Payer (MVola/Orange) | oui | `POST /payments/initiate` en `get_optional_user` (`routers/payments.py:214-215`) |
| Payer en USDT Binance | oui | `POST /crypto/initiate` en `get_optional_user` (`routers/crypto.py:112-113`) |
| Vérifier un ID joueur | oui | `POST /fazercards/validate-id` sans dépendance d'auth (`routers/fazercards.py:118-119`) |
| Suivre une commande | oui (numéro + ID joueur) | `GET /orders/track` public (`routers/orders.py:450-451`) ; `GET /orders/{id}` en `get_optional_user` (`:467-468`) |
| Historique des commandes | **non** | `GET /orders/me` → `get_current_user` (`routers/orders.py:436-437`) |
| Points de fidélité (solde, échange) | **non** | `GET /loyalty/me` → `get_current_user` (`routers/loyalty.py:60-61`) |
| Likes / partages d'événements | oui (session_id) | `routers/events.py:52,66` |
| Chat | **non** | `POST /chat/conversations` → `get_current_user` (`routers/chat.py:59-60`) |
| Admin | **non** | `ProtectedRoute admin` (`App.js:82`) ; `require_permission` |
| Compte, points, préférences d'identité | **non** | `ProtectedRoute` (`App.js:80-81`) ; `get_current_user` |

---

## Ce que `main` fournit hors pages clients

- **Admin** : 14 écrans (`pages/admin/Admin{Dashboard,Orders,Products,Games,Fazercards,Events,Chat,Loyalty,Users,Payments,Binance,Notifications}.js`, `OrderProofs.js`, `AdminLayout.js`) et ~45 routes `/admin/*` + `/crypto/admin/*` + `/loyalty/admin/*` + `/payments/admin/*`.
- **Notifications push** : `lib/pushSync.js`, `components/admin/AdminPush.js`, `routers/push.py`, `routers/notifications.py`, `public/sw.js`.
- **PWA** : `public/manifest.json`, `icon-192/512`, `apple-touch-icon.png`, `push-icon-192.png`.
- **SEO** : `components/layout/SeoManager.js`, `lib/seo.js`, `public/robots.txt`, `public/sitemap.xml`, `public/og-image.png`.
- **Pages légales** : `pages/Legal.js` → `/terms`, `/privacy`.
- **Divers** : `ErrorBoundary.jsx`, transitions de page, `ThemeToggle`, `SlushChrome`, `lib/bottomChrome.js`, `lib/catalog.js`, `lib/paymentLabels.js`, `lib/identityErrors.js`, `lib/pointsFormat.js`.

---

## Tableau des champs (extrait — à compléter zone par zone)

| Appel | Champ | Prototype | `main` | Backend |
|---|---|---|---|---|
| `POST /orders` | `game_id`, `identity_id`, `pubg_id`, `identity_fields`, `pseudo`, `items[].product_id`, `items[].quantity`, `payment_method`, `manual_operator`, `captcha_token` | à vérifier | `pages/Checkout.js:135-142` | `routers/orders.py:315` (`OrderIn`) |
| `POST /orders` | réponse `id`, `created_at` → `mgs_pending_order_id` | à vérifier | `pages/Checkout.js:144` | `routers/orders.py:315-321` |
| `POST /payments/initiate` | `order_id` → `payment_url`, `simulated` | à vérifier | `pages/OrderTrack.js:120` | `routers/payments.py:214` |
| `GET /payments/{id}/status` | `order_status` | à vérifier | `pages/OrderTrack.js:97` | `routers/payments.py:294` |
| `POST /crypto/initiate` | `order_id`, `network` | à vérifier | `pages/Checkout.js:177` | `routers/crypto.py:112` |
| `GET /products` | `game`, `type`, `q`, `sort`, `popular`, `favorites`, `min_price`, `max_price` | `req("/products?game=")` | `pages/Catalog.js:142` | `routers/products.py:75` |
| `POST /fazercards/validate-id` | `game_id`, `fields` | `req` 3876 | `IdentityFieldsVerify.js:102` | `routers/fazercards.py:118` |
| `POST /loyalty/redeem` | `reward_id`, `pubg_id` | 4291 | `pages/Loyalty.js:155` | `routers/loyalty.py:73` |
| `PATCH /auth/me` | `name`, `phone`, `saved_pubg_ids` (10 max, chiffres) | 4129 | `pages/Account.js:132` | `routers/auth.py:392-396` |
| `POST /auth/me/delete` | `password`, `confirmation` ("SUPPRIMER") | 4131 | `pages/Account.js:150` | `routers/auth.py:436-444` |
| `GET /me/game-identities` | `game_id` ; `fields`, `label`, `player_name` | absent | `GameIdentities.js:44-56` | `routers/games.py:103-152` |
| `GET /orders/track` | `order_number`, `pubg_id` | absent | `OrderTrack.js:455` | `routers/orders.py:450-451` |
| `POST /orders/{id}/cancel` | `reason` | à vérifier | `CancelSheet.js:46` | `routers/orders.py:680` |
| `POST /orders/{id}/proof` | 1 à 3 fichiers image | à vérifier | `ProofPay.js:119` | `routers/orders.py:501-508` |

---

## Éléments visibles manquants (repérés à S0)

| Écran / élément | Fonction `main` | Ce qu'il faudrait |
|---|---|---|
| Page « suivi de commande » (`data-page="suivi"` absent) | `pages/OrderTrack.js` (`/suivi`, `/suivi/:orderNumber`, `/orders/:orderId`) | un écran de suivi (numéro + ID joueur) et son bouton d'appel |
| Pages légales | `pages/Legal.js` (`/terms`, `/privacy`) | deux écrans + liens (pied de page) |
| Page « vérification d'email » | `pages/AuthExtras.js:103-126` (`/verifier-email/:token`) | un écran de résultat (aujourd'hui : toast) |
| Écran « confirmation de commande » | `pages/CheckoutConfirm.js` (`/commande/confirmation`) | un écran de redirection après création |
| Page « jeux » | `pages/Games.js` (`/jeux`) | un écran jeu |

---

## Configuration à poser au déploiement

- `backend/core/origins.py` : les origines autorisées (`CORS_ORIGINS`, avec l'apex/www
  déduit, + `FRONTEND_URL`) doivent contenir l'origine exacte du site statique.
- Adresse du backend : `window.MGS_BACKEND_URL` (défaut actuel du prototype :
  `https://magicgamestore-api-v2.onrender.com`) — à confirmer.
- Clé publique Turnstile : configuration de `window.MGS_CAPTCHA` (sans clé, aucun
  widget n'est monté, conformément à `main`).
- Push admin : clé publique VAPID (`GET /admin/push/config`).

## Besoins backend (repérés à S0)

Aucun. Aucune route appelée par `main` n'est absente du backend ; les écarts
repérés sont tous côté prototype (écrans absents, fonctions non reprises).

## NON FAIT (S0)

- Aucune ligne de code du prototype écrite (session d'inventaire).
- Z0 à Z6 non portés ; le tableau ci-dessus est un inventaire, pas une recette.
- Les champs marqués « à vérifier » n'ont pas été relus dans le prototype.
- `yarn build` / `yarn test:ci` non exécutés dans cette session.

## Reste à faire

1. Z0 — socle (client API, erreurs, session, `t()`, invité, panier).
2. Z2 — catalogue et panier (après retrait des règles sans équivalent dans `main`).
3. Z3 — paiement. 4. Z4 — commandes. 5. Z5 — compte et fidélité.
6. Z6 — hors pages clients, puis audit des liens et du tableau des champs.
