# FE-FONCTIONS — inventaire des fonctions, `main` vs frontend redesigné

**Lot :** PL-FE-002-V1 (remplace PL-FE-001-V1) · **Date :** 20/11/2026 · **Étalon :** `main` @ `e3fa33f`
**Branche de travail :** `feat/front-fonctionnel` · **Commit de restauration :** `bb0fcf2`

## Hypothèses de reprise (mode sans propriétaire)

1. **Reprise de session.** À l'ouverture, le dépôt était déjà sur `feat/front-fonctionnel`, avec un
   `git revert bb9d08e` **en cours, stagé, non commité** (conflits résolus) et ce fichier déjà écrit
   (Phase 0 du lot précédent PL-FE-001). J'ai vérifié la fidélité du revert (`git diff c247270 -- <6 fichiers>`
   vide, `index.react.html` absent) puis je l'ai commité (`bb0fcf2`). Aucun `stash`/`reset`/`checkout --`.
2. **Base réelle = `feat/design-v3`, pas `feat/design-system-pages`.** Le prompt cite `feat/design-system-pages`
   comme branche de départ, mais c'est une branche design **antérieure** (`05e244a`, PL-DS-002/003, derrière
   `main`). Le design actuel (prototype Slush « Defi », classes `mgs-*`) vit sur `feat/design-v3` (`bb9d08e`).
   Vérifié : **`main` (`e3fa33f`) est ancêtre de `feat/design-v3`** (`git merge-base --is-ancestor main
   feat/design-v3` → 0 ; 0 commit en retard, 14 commits design en avance). Donc `feat/front-fonctionnel`
   contient **toute la logique de `main`** + le nouveau design. `feat/design-system-pages` n'a pas été utilisée.
3. **`DESIGN.md` et `DESIGN-AUDIT.md` n'existent pas** dans le dépôt. Références design lues :
   `DESIGN-PORT.md` + `DESIGN-SYSTEM-TEMPLATE.md`.
4. **« Problèmes vus » non rempli** par le propriétaire → traité comme « RIEN DE PLUS ».

## Le constat qui commande tout le reste

Les **pages React n'ont pas perdu leur logique**. Parité vérifiée fragment par fragment (chemins d'API,
`data-testid`, expressions de détection paiement) entre `git show main:<fichier>` et le fichier actuel :
**0 appel API de `main` manquant** sur les 15 fichiers du chemin argent + pages demandées. Les 4 `data-testid`
d'abord signalés absents sont des faux positifs (rendus via helper `<BtnMain testid=…>` ou ternaire) ; aucun
test ne les référence.

Ce qui avait réellement changé de comportement, c'est **la page servie** :

| Fait | Preuve |
|---|---|
| `frontend/public/index.html` **était** le prototype `design-system-v3.html` (copie octet pour octet) | commit `bb9d08e` |
| Ce prototype contenait **14 commandes fictives** (`MGS-2026-0142`, …) et des boutons sans gestionnaire | `bb9d08e:frontend/public/index.html` |
| L'entrée React était **neutralisée** : `src/index.js` ne montait plus `<App/>` | `bb9d08e:frontend/src/index.js` |
| CRA ne minifiait plus le HTML (JS inline du prototype) | `bb9d08e:frontend/craco.config.js` |

**Correction = revert de `bb9d08e`** (`bb0fcf2`) : restaure l'entrée React de `main` (`index.js` et
`craco.config.js` identiques à `main` ; `index.html` = celui de `main` **+ le lien `mgs-v3.css` conservé**).
Le design `mgs-*` est intact. Aucune logique de page n'a été réécrite.

## Tableau par page

Légende « état actuel » : **marche** = logique présente, couverte par un test, et **servie** (React rétabli).

| # | Page / zone | Fonctions | État dans `main` | État actuel | Fichiers (`fichier:ligne`) |
|---|---|---|---|---|---|
| 1 | **Accueil** | 4 chargements parallèles (populaires, Prime/Prime+, packs `evo`, événements), sélection du jeu, bannière, avis, FAQ, retour en haut | marche | **marche** (`api.get` ×4) | `pages/Home.js:389-407` |
| 1 | **Page jeu / Boutique** | recherche locale, onglets de type, tri, filtres prix, « populaires », sélecteur de jeu, compteur, état vide + réinitialisation | marche | **marche** (`api.get /products`) | `pages/Catalog.js:142` |
| 1 | **Fiche produit** | chargement par slug, prix barré, badge, quantité, **ajout panier** + retour d'erreur, produits liés, redirection si absent | marche | **marche** (`api.get /products/{slug}` ; `tryAdd`/`buyNow`) | `pages/Product.js:81,100,101` |
| 2 | **Panier** | ajout/retrait/quantité, total, frais, tiroir, persistance `localStorage`, garde `purchasable` | marche | **marche** | `context/CartContext.js`, `components/store/CartDrawer.js` |
| 3 | **Connexion / inscription** | `POST /auth/{login,register}`, erreurs traduites, mot de passe affiché/masqué, « se souvenir », lien oublié, Google | marche | **marche** | `pages/AuthPage.js:42` |
| 3 | **Mot de passe oublié / reset / vérification e-mail** | `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, renvoi | marche | **marche** | `pages/AuthExtras.js`, `pages/Account.js` |
| 3 | **Déconnexion** | `POST /auth/logout` + purge contexte | marche | **marche** | `context/AuthContext.js` |
| 3 | **Turnstile** | widget, jeton usage unique, réouverture feuille sur erreur captcha | marche | **marche** | `pages/Checkout.js`, `components/common/CaptchaWidget.js` |
| 4 | **Paiement — étape 1** | `GET /payments/config` + `/crypto/config`, montant, frais, « vous recevez », vérification identité, choix méthode, réseaux crypto | marche | **marche** | `pages/Checkout.js:78,79,82-85` |
| 4 | **Paiement — envoi** | `POST /orders`, `POST /me/game-identities`, `POST /crypto/initiate`, redirection suivi | marche | **marche** | `pages/Checkout.js:140,141` |
| 4 | **Suivi / preuve / annulation / expiration** | `GET /orders/{id}` (polling), `GET /payments/{id}/status`, `POST /payments/initiate`, `GET /crypto/{id}/status`, preuve, annulation motif, compte à rebours, reprise | marche | **marche** | `pages/OrderTrack.js:97,120,157,167` |
| 5 | **Suivi invité** | `GET /orders/track` par numéro + ID joueur | marche | **marche** | `pages/OrderTrack.js` |
| 5 | **Historique d'achat** | `GET /orders/me`, onglets Toutes/En cours/Terminées, recherche, carte cliquable, copie numéro, badge statut, aide | marche | **marche** (**vraies commandes**, aucune fictive) | `pages/OrderHistory.js:159` |
| 5 | **Détail commande** | `GET /orders/{id}`, `GET /orders/me` (reprise), reçu imprimable, recommander, annulation, preuves | marche | **marche** | `pages/OrderHistory.js:279` |
| 6 | **Compte** | profil `PATCH /auth/me`, mot de passe `POST /auth/change-password`, suppression `POST /auth/me/delete`, points `GET /loyalty/me`, identités, bannière vérification | marche | **marche** | `pages/Account.js` |
| 7 | **Événements** | `GET /events`, j'aime `POST /events/{id}/like`, partage `POST /events/{id}/share`, session anonyme | marche | **marche** | `pages/Events.js` |
| 7 | **Pack évolutif** | `GET /products?type=evo`, `/evo/season`, `/evo/eligibility`, saisie ID, offres éligibles | marche | **marche** | `pages/PackEvolutif.js` |
| 7 | **Notifications** | aucune notification côté client dans `main` (`sw.js` push-only, enregistré depuis l'admin) | — | **identique** | `public/sw.js` |

## Comment `main` choisit / détecte MVola, Orange Money et Binance

**Il n'y a pas de détection automatique de l'opérateur depuis le numéro du joueur.** `main` affiche les
méthodes que la **configuration backend** marque actives, et **l'utilisateur choisit** (radio). Retrouvé par
`grep -nE 'mvola|orange|binance|configured|method'` :

- Source : `GET /payments/config` + `GET /crypto/config` — `main:Checkout.js:96,99` → **actuel `Checkout.js:78,79`**.
- Détection — `main:Checkout.js:103-105` → **actuel `Checkout.js:83-85`** (identique) :
  - `mvolaActive = !config || config.providers?.mvola?.configured !== false`
  - `orangeActive = !config || config.providers?.orange?.configured !== false`
  - `binanceActive = !!crypto?.available`
  - MVola / Orange = manuels, suivent `providers.*.configured` (env backend) ; Binance suit `crypto.available`.
- Choix utilisateur — `main:Checkout.js:333-337` → **actuel `Checkout.js:277-281`** : `MethodLine … onSelect={() => setMethod("mvola"|"orange"|"binance")}`, état `method` (`main:61` → actuel `:47`).
- Payload commande — `main:Checkout.js:179-180` → **actuel `Checkout.js:140-141`** :
  `payment_method: method === "binance" ? "binance" : "manual"` + `manual_operator: method` (`"mvola"|"orange"`).
- Binance : création puis `POST /crypto/initiate` (slot USDT), l'écran 2 relit `GET /crypto/{id}/status`.

**Rétabli à l'identique** par le revert (aucune de ces lignes n'a été modifiée ; parité API 0 écart).

## Données fictives

- **Aucune dans le source React servi** : `grep -rnE 'MGS-2026-0|fictif|dummy|fakeOrder|mockOrder' frontend/src`
  (hors tests) → **0**. L'historique lit `GET /orders/me` (vraies commandes de l'utilisateur connecté).
- Les **14 commandes fictives** étaient uniquement dans le prototype statique `index.html` ; **retirées** par le
  revert. Vérifié dans le bundle compilé : `grep -c 'MGS-2026-0' build/index.html` → **0**.

## Vérifications effectuées (réelles)

| Vérification | Commande | Résultat |
|---|---|---|
| Parité API vs `main` (15 fichiers) | extraction `api.<verb>("…")` main vs actuel | **0 manquant** |
| Parité `data-testid` | extraction main vs actuel | tous présents (4 faux positifs helper/ternaire) |
| Build | `REACT_APP_BACKEND_URL=http://127.0.0.1:8000 yarn build` | **VERT** (64 s, main.js 434 kB) |
| Tests (étalon) | `CI=true yarn test:ci` | **45 suites / 534 tests VERTS** |
| Smoke runtime (bundle servi) | Chromium local + `build/` servi sur 127.0.0.1:8099 | React monte : `#root` 4 enfants / 75 kB, **72 testids**, accueil rendu, **0 commande fictive**, **0 pageerror** ; seuls `ERR_CONNECTION_REFUSED` (API absente) |
| Bout en bout (vraie commande/paiement) | backend local PL-006-TEST2-V1 | **NON VÉRIFIÉ** : `mongod`/`docker` absents → MongoDB temporaire impossible |

Le build a utilisé une URL locale factice (`http://127.0.0.1:8000`), **aucun `.env` lu**, aucun secret.

## Besoins backend (pour l'agent backend)

- Aucun manque API identifié côté frontend : tous les appels de `main` sont présents et inchangés.
- Pour un essai de bout en bout : fournir un environnement MongoDB local temporaire (procédure PL-006-TEST2-V1)
  que l'agent frontend ne peut pas lancer ici (`mongod`/`docker` absents).
- Rappel `DESIGN-PORT.md` : valeurs réelles marchand/USSD servies par `GET /payments/config` (le front n'invente
  rien) ; `image_url` d'événement fournie par `GET /events`.

## Points ouverts

- **Bout en bout non vérifié** (backend non lançable ici). La restauration est vérifiée par parité de source,
  build, 534 tests et smoke runtime du bundle servi ; le flux réel commande/paiement reste à valider par le
  propriétaire sur un backend vivant.
- **Branche de départ** : le prompt citait `feat/design-system-pages` ; la branche design réelle est
  `feat/design-v3` (ancêtre `main` vérifié). Décision réversible (commits locaux, aucun push `--force`).
- **Warnings de build préexistants** (non introduits par le revert, hors scope) : classe Tailwind ambiguë
  `duration-[420ms]` ; `react-hooks/exhaustive-deps` `Catalog.js:146` (dep `t` manquante).