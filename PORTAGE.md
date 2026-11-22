# PORTAGE — application `main` → prototype statique

Fichier de reprise. Il liste **chaque fonction** portée, sa source dans `main`
(`frontend/src/...`), la route backend qui la sert (`backend/routers/...`) et
l'endroit du prototype qui la porte (`frontend/public/index.html`, runtime
IIFE à la fin du fichier, ou `frontend/public/mgs-logic-*.js`).

Règles appliquées :

- aucune modification de design (classes, styles, animations, ordre des blocs) ;
- toute chaîne visible passe par `t()` avec une clé FR **et** EN ;
- toute erreur de requête produit un message visible (aucun `.catch(function(){})` vide) ;
- aucun script de démo, aucun faux fournisseur, aucun E2E dans les validations ;
- le prototype n'est jamais plus strict que `main`.

État : `porté` = comportement de `main` reproduit ; `partiel` = fonction présente,
écart documenté ; `absent` = pas encore traité.

---

## Z1 — Authentification (session, connexion, inscription, mot de passe, email)

| Fonction | Source `main` | Route backend | Prototype | État |
|---|---|---|---|---|
| Restauration de session au chargement (401 = déconnecté, panne = 2 reprises puis hors ligne, sans message) | `context/AuthContext.js:27-49` | `GET /auth/me` | `loadSession()` | porté |
| Refresh silencieux sur 401, sauf liste d'endroits d'auth | `lib/api.js:12,40-59` | `POST /auth/refresh` | `req()` + `NO_SILENT_REFRESH` | porté |
| Connexion : un seul `POST /auth/login`, `data.user` posé directement | `pages/AuthPage.js:38-49` | `POST /auth/login` (`routers/auth.py:195-211`) | `doAuth()` | porté |
| Inscription : un seul `POST /auth/register` (pas de second login), `data.user`, message « email de vérification envoyé » | `pages/AuthPage.js:42-46` | `POST /auth/register` (`routers/auth.py:166-193`) | `doAuth()` | porté |
| « Se souvenir » coché par défaut, envoyé en `remember` | `pages/AuthPage.js:25,111-119` | `POST /auth/login` | `boot()` + `doAuth()` | porté |
| Validation email / mot de passe (8 car. inscription, 6 connexion, nom requis) | `pages/AuthPage.js:100-110` | — | `doAuth()` | porté |
| Messages d'erreur d'auth : par `code`, sinon statut HTTP, sinon repli — jamais le détail anglais | `lib/authErrors.js:12-64` | réponses 400/401/403/409/422/429/5xx | `authErr()` | porté |
| Captcha Turnstile : widget monté seulement si la clé publique existe ; inscription ou connexion déjà échouée ; apparence `always` si l'API l'exige | `pages/AuthPage.js:33,51-55,120` ; `components/common/CaptchaWidget.js` | `captcha.require` / `_check_lock` (`routers/auth.py:113-133,169,199`) | `renderAuthCaptcha()` / `syncAuthCaptcha()` | porté |
| Redirection après connexion vers la page d'origine (`from`), accueil par défaut | `pages/AuthPage.js:34,36,49` ; `components/ProtectedRoute.js` | — | `authReturnTo`, `needLogin()`, `loaders.connexion` | porté |
| Déjà connecté + visite de `/connexion` → redirection vers la page d'origine | `pages/AuthPage.js:36` | — | `loaders.connexion` | porté |
| Mot de passe oublié : envoi, message inline, captcha, erreurs traduites | `pages/AuthExtras.js:48-76` | `POST /auth/forgot-password` (`routers/auth.py:222-241`) | `forgotPassword()` / `renderForgotCaptcha()` | porté |
| Réinitialisation par jeton (`/reinitialiser/:token`), 8 car. min., confirmation identique, lien invalide → message | `pages/AuthExtras.js:78-101` ; `App.js:76` | `POST /auth/reset-password` (`routers/auth.py:244-253`) | `resetPassword()` / `resetTokenFromUrl()` | porté |
| Vérification d'email (`/verifier-email/:token`) : jeton consommé au chargement, message visible, session rafraîchie | `pages/AuthExtras.js:103-126` ; `App.js:77` | `POST /auth/verify-email` (`routers/auth.py:213-220`) | `verifyTokenFromUrl()` + `boot()` | porté |
| Connexion Google : départ vers `/auth/google/start?return_to=…` | `components/AuthCallback.js:8-11` | `GET /auth/google/start` (`routers/auth.py:288-317`) | `googleLogin()` | porté |
| Retour Google en échec (`?error=google`) : message + URL nettoyée | `components/AuthCallback.js:14-28` | `GET /auth/google/callback` (`routers/auth.py:319-…`) | `handleGoogleError()` | porté |
| Déconnexion : `POST /auth/logout`, session vidée, retour accueil — **le panier n'est pas vidé** | `context/AuthContext.js:58-61` ; `context/CartContext.js` (aucun reset sur logout) | `POST /auth/logout` | `logout()` | porté |
| Points fidélité : pastille masquée hors connexion | `components/layout/Header.js:33` | `GET /loyalty/me` | `syncAuthChrome()` | porté |
| Pages protégées (`/compte`, `/compte/points`, `/commandes`) : redirection vers la connexion puis retour | `components/ProtectedRoute.js` ; `App.js:68,80-81` | — | `needLogin()` | porté |

### Modules vérifiés (aucune modification nécessaire)

| Module | Référence `main` | Verdict |
|---|---|---|
| `mgs-logic-captcha.js` | `components/common/CaptchaWidget.js` | conforme (URL du script, `size: flexible`, `appearance`, thème, langue, `isCaptchaError`, `reset`) |
| `mgs-logic-crypto.js` | `pages/Checkout.js`, `components/store/checkout/BinancePay.js`, `routers/crypto.py` | conforme (config, initiate, statut, sondage 8 s, codes d'erreur) |

### Écarts connus (Z1)

- Pas d'écran dédié « vérification d'email » : le prototype n'a pas cette page
  dans son design ; le jeton est consommé et le résultat affiché par un toast.
- Le captcha des formulaires d'auth n'existe visuellement que si une clé
  publique Turnstile est configurée (sinon aucun élément n'est ajouté).
- La suppression de compte utilise encore `confirm()` + `prompt()` (à traiter en Z5).

---

## Z2 — Catalogue, recherche, fiche produit, panier

_(à remplir)_

## Z3 — Commande complète

_(à remplir)_

## Z4 — Commandes (suivi, historique, filtres, reçu)

_(à remplir)_

## Z5 — Compte, points, événements, pack évolutif, notifications

_(à remplir)_

## Z6 — Admin, push/PWA, SEO, pages légales, routes publiques

_(à remplir)_
