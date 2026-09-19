# Magic Game Store — PRD

## Original problem statement
Audit the existing Magic Game Store (https://github.com/selneker/magicgamestore.git — vanilla HTML/JS + Express, PUBG Mobile UC/Prime top-up shop for Madagascar) and rebuild it as a fast, modern, mobile-first, production-ready marketplace: homepage, catalog with filters, product pages, cart, checkout, accounts, admin. Integrations: email/password + Google auth, MVola & Orange Money payments, AI smart search/recommendations (Emergent LLM key), light clean theme.
Phase 1 audit: see `/app/memory/AUDIT.md` (delivered & approved).

## User decisions (June 2026)
- Catalog: **PUBG Mobile only** (14 UC packs + 8 Prime/Prime+ subscriptions, prices preserved from legacy site).
- Payments: **LIVE via PAPI aggregator (papi.mg)** — one API covering MVola + Orange Money. `PAYMENT_MODE=papi`, keys `PAPI_API_KEY` / `PAPI_WEBHOOK_SECRET` in backend/.env (shop code 03037). Flow: POST /engine/api/payment-links (provider MVOLA|ORANGE_MONEY, reference=order_number, idempotent) → redirect to hosted page → webhook POST /api/payments/papi/notification verified with HMAC `X-Papi-Signature` (t.rawBody, 300 s tolerance) + notificationToken + amount → order paid/failed; fallback read-back GET /payment-links/{reference} on status poll. `PAYMENT_MODE=simulation` still available (MOCKED auto-complete) for QA. Manual USSD+reference fallback kept.
- ⚠️ En production, `FRONTEND_URL` construit les redirections success/failure ; `BACKEND_PUBLIC_URL` construit le webhook PAPI. Ces configurations restent inchangées pendant la mise à jour ciblée V2.
- Language: **French + English switch** (default FR).
- Theme: light, Outfit/Manrope fonts, blue #007aff, MVola green, Orange orange, PUBG yellow accents. Blueprint: `/app/design_guidelines.json`.

## Architecture
- Backend FastAPI (`/app/backend`): `server.py` (lifespan: indexes + seed), `core/{db,security,seed}.py`, `routers/{auth,products,orders,payments,events}.py`, `services/payments.py` (MVola/Orange adapters + simulation). MongoDB collections: users, user_sessions, login_attempts, products, orders, payments, events, reactions, settings. All ids are uuid strings; `_id` never exposed.
- Frontend React 19 + Tailwind + shadcn (`/app/frontend/src`): contexts (Language, Auth, Cart), `lib/api.js` (axios withCredentials + refresh interceptor), pages Home/Catalog/Product/Checkout/OrderTrack/Events/AuthPage/Account/admin/*, layout Header/BottomNav/Footer/CartDrawer.
- Auth: JWT access (15 min) + refresh (7 d) httpOnly cookies; Emergent Google session_token cookie; roles customer/admin; brute-force lockout per email (5 fails → 15 min).
- Env (backend/.env): JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, FRONTEND_URL, PAYMENT_MODE, MVOLA_*, ORANGE_*, EMERGENT_LLM_KEY (empty, for Phase 5).

## Key API endpoints
- Auth: POST /api/auth/{register,login,logout,refresh,google/session}, GET/PATCH /api/auth/me
- Catalog: GET /api/products (type,q,min_price,max_price,popular,sort,include_inactive), GET /api/products/{slug}
- Orders: POST /api/orders (server-side pricing), GET /api/orders/me, GET /api/orders/track?order_number&pubg_id, GET /api/orders/{id}
- Payments: GET /api/payments/config, POST /api/payments/initiate, GET /api/payments/{order_id}/status, POST /api/payments/papi/notification (signed webhook), POST /api/payments/{order_id}/simulate (admin, simulation only)
- Events: GET /api/events, POST /api/events/{id}/{like,share}; GET /api/settings/status
- Admin: /api/admin/{orders,stats,export,status,products,events}

## Implemented (2026-06)
- Phase 1 audit (AUDIT.md). Phase 2 foundation: DB catalog + seed, auth (email/pass + Google), roles.
- Phase 3 store: homepage, catalog filters/sort/search, product page + related, cart drawer, checkout (MVola/Orange API flow with polling status screen, manual USSD fallback), order tracking (order_number + pubg_id), FR/EN.
- Phase 4: customer account (profile, saved PUBG IDs, orders), admin (dashboard stats + chart, orders management with filters/status/delete/simulate, catalog CRUD, events CRUD, online toggle persisted, CSV export), events feed with like/share.
- Testing: iteration_1 — backend 39/40 (lockout bug fixed after), frontend all flows pass.
- Payment go-live (PAPI): key validated against live API, real payment links created for MVola & Orange Money, hosted page shows correct amount, webhook rejects unsigned/bad/stale/wrong-token/amount-mismatch and accepts valid → order paid; FAILED → order failed → re-initiate works; tracking page offers "Reprendre le paiement".

## Backlog
- P1: Phase 5 — AI smart search + "recommended for you" (Emergent LLM key, integration_expert playbook).
- P1: Phase 6 — SEO (JSON-LD Product/Offer, per-page meta, sitemap.xml, robots.txt), image optimisation, a11y pass, 404 page.
- P2: Order email/WhatsApp notifications, password reset flow, admin order detail drawer with history timeline, pagination for admin orders.

## Implemented (2026-09-18) — Render migration prep (repo `selneker/magicgamestor`)
- Deux services Render distincts via `render.yaml` : `magicgamestore-api-v2` (python, rootDir backend, `/health`) et `magicgamestore-web-v2` (static, rootDir frontend, rewrite `/* → /index.html`, `REACT_APP_BACKEND_URL` via `fromService`). Secrets `sync: false`, `JWT_SECRET` `generateValue`.
- `GET /health` ajouté à la racine ; webhook PAPI `notificationUrl` construit depuis `BACKEND_PUBLIC_URL` (fallback `RENDER_EXTERNAL_URL`), success/failure depuis `FRONTEND_URL`.
- `backend/.env` & `frontend/.env` retirés du suivi Git (`git rm --cached`), `.gitignore` : `.env`, `.env.*`, `!.env.example` ; `.env.example` créés (noms seulement).
- `requirements.txt` réduit aux dépendances réelles (les wheels internes Emergent cassaient `pip install` sur Render) ; vérifié dans un venv vierge + démarrage sur base vide avec seed complet.
- README : config Render, tableaux de variables backend/frontend, procédure de bascule DNS, checklist tests. Tests : backend 42/42, e2e boutique → checkout → paiement simulé → paid, admin CRUD OK.

## Backlog
- P0 : push `main` sur GitHub (aucune credential Git dans le pod) ; régénérer JWT/admin/PAPI (compromis dans l'historique Git) ; créer la base Atlas `magicgamestore_prod` ; déployer le Blueprint ; renseigner FRONTEND_URL/CORS_ORIGINS/BACKEND_PUBLIC_URL avec les URLs Render réelles.
- P1 : Phase 2 (PAPI réel, commande test 30 UC, cutover DNS magicgame.store + www).
- P2 : `DialogDescription` manquante (a11y) ; délai simulation ~10 s vs 8 s.


## Mise à jour V2 ciblée — 2026-09-19
### Demande et décisions explicites
- Budget limité (~79 crédits), uniquement : thème global Light/Dark, Web Push admin, chat client/admin authentifié et une seule commande d’abonnement par PUBG ID. Aucune refonte, aucun changement aux indicateurs/stocks illimités/toasts/paiements/PAPI, ni aux connexions MongoDB, Render ou DNS. Aucun déploiement demandé.
- Clarification métier : aucun `subscription_id` distinct ; une commande contenant `items.type` = `prime` ou `prime_plus` maximum par `pubg_id`, indépendamment du client et de la durée. Les commandes UC seules restent autorisées avant/après. Les snapshots existants des items contiennent déjà `type`.
- Génération d’une paire VAPID locale de test dans le `.env` ignoré approuvée ; paire de production à configurer ultérieurement par l’utilisateur.

### Réalisé
- `next-themes` déjà installé : ThemeProvider, toggle soleil/lune commun client/admin, clé localStorage `mgs-theme`, préférence système initiale, script avant rendu contre le flash blanc. Tokens dark et mapping des utilitaires existants, portails/shadcn/toasts compris. Design et indicateurs conservés.
- Web Push : `pywebpush==2.5.0`, `/api/admin/push/{config,status,subscriptions,test}`, dépendance `require_admin` existante ; clés et endpoint validés, allowlist HTTPS sans redirections, inscriptions Mongo persistantes et nettoyage 404/410. Envoi après insertion de commande via BackgroundTasks. SW sans cache/interception ; notifications avec montant et lien `/admin/commandes?order=<id>` ; interface activer/tester/désactiver et états. Manifeste/icônes pour installation mobile.
- Chat : `/chat`, `/admin/messages`, liens header/navigation mobile/footer. Visiteur invité à se connecter/s’inscrire sans créer de conversation. Une conversation persistante privée par compte, texte 1–2000 caractères, identité serveur, accès propriétaire/admin seulement, historique paginé, lecture des IDs affichés pour éviter de marquer un message concurrent non vu. Polling visible uniquement (5s messages,10s conversations,20s badge). Pas de WebSocket.
- Commandes : index unique partiel nommé `one_subscription_order_per_pubg` sur `pubg_id`, filtre `items.type in [prime,prime_plus]`, pré-vérification et gestion DuplicateKeyError →409 « Une commande d’abonnement existe déjà pour ce PUBG ID. » ; toast existant utilisé sans modification du checkout/paiement/stock.
- Correction strictement liée au lien Push : `ProtectedRoute` conserve pathname+search+hash lors d’une connexion requise. Aucun changement aux sessions, cookies, JWT ou routes d’authentification.
- Nouveaux documents chat/push utilisent modèles de persistance dédiés ; connexion Mongo et variables protégées inchangées.

### Validation
- Rapports `/app/test_reports/iteration_3.json`, `iteration_4.json`, `iteration_5.json`.
- Backend : 82 réussis, 2 ignorés (anciens tests de cookies Secure sur HTTP), 0 échec. Tests ciblés externes HTTPS ; suite historique conserve son comportement de test local.
- Thème :16 routes×2 modes,32 combinaisons ; modales produits/événements, select admin et panier ; préférence système/persistance ; mobile sans débordement. Contrastes des surfaces inspectées≥4.5.
- Chat : gate visiteur, propriété/A-B, admin réponse, non-lus, pagination55 messages, polling réponse sans recharge, aucune lecture automatique dans onglet masqué (visibilité MOCKED dans le test navigateur).
- Abonnements : doublons, UC répétés avant/après, panier mixte, Prime→Prime+, concurrence201+409, statut annulé. La règle inclut tous statuts via le filtre d’index sans statut.
- Push : chiffrement/signature VAPID réels avec transport HTTP MOCKED pour scénarios déterministes ; permissions/PushManager et succès du bouton Test MOCKED uniquement dans les tests navigateur, vraie API de stockage ; SW6/6 avec environnement navigateur MOCKED. **Réception système FCM/APNs sur appareil réel non vérifiée : test manuel nécessaire.** Aucun mock dans le produit livré.
- `yarn build` : Compiled successfully, aucun avertissement, JS319.15kB gzip/CSS12.98kB. Lien notification→connexion→commande vérifié après correction.
- Nouveaux tests lisent les identifiants depuis l’environnement/fichier ignoré ; valeurs VAPID privées jamais ajoutées à Git. Les anciens secrets signalés dans le README/historique préexistaient et ne sont pas purgés dans ce périmètre.

### Variables et limites
- Backend : `VAPID_PRIVATE_KEY_PEM`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `PUSH_ENDPOINT_HOSTS`. Exemples de noms seulement dans `.env.example`. Aucune nouvelle variable frontend, aucune modification `render.yaml`.
- MongoDB6+ requis pour le filtre partiel `$in` (Atlas compatible). Des doublons historiques bloqueraient la création de l’index : ne pas effacer de commandes automatiquement. Aucun doublon historique dans la base inspectée. La suppression définitive existante d’une commande enlève son entrée d’index.
- BackgroundTasks sans file durable : interruption serveur pendant l’envoi peut perdre la notification. Navigateurs/OS compatibles, HTTPS et permissions nécessaires ; iOS16.4+ via ajout écran d’accueil. Détails dans README et memory/UPDATE_REPORT.md.

### Suite autorisée / backlog (non exécuté)
- P0 utilisateur : configurer ultérieurement les quatre variables Push de production et valider réception arrière-plan/clic sur appareil réel. Aucun déploiement ici.
- Enregistrement GitHub via « Save to Github » ; message demandé `Add dark mode, admin push notifications and customer chat`. Aucun git push/commit manuel par l’agent.
- Tout ancien backlog (IA,SEO,a11y complémentaire,email/WhatsApp,réinitialisation mot de passe,tiroir historique/pagination admin,staging/cutoverDNS/rotation anciens secrets) est gelé, hors périmètre de cette demande.
- Idée optionnelle hors périmètre : réponses rapides dans le chat admin, seulement sur nouvelle demande.
- Rapport utilisateur complet et liste des fichiers : `memory/UPDATE_REPORT.md`. Contrôle final des nouveaux fichiers/modifications : aucune valeur de secret détectée ; fichiers `.env` et identifiants non suivis. Harness SW rejoué :6/6. Code et tests livrés sans déploiement ; réception Push sur appareil réel reste à confirmer.
