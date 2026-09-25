# PRD — Magic Game Store

## Problem statement (original)
Boutique en ligne PUBG Mobile à Madagascar (achat UC, abonnements Prime/Prime+, événements, suivi de commande, comptes clients + guest, fidélité, chat, admin avec rôles/permissions, paiements MVola/Orange via PAPI ou USSD manuel). Projet existant — repo https://github.com/selneker/magicgamestor.git.

Tâche (juin 2026) : ajouter **Pack évolutif** (4 offres à limitations par ID PUBG Mobile) + **historique automatique des achats** sur la page Suivi pour les utilisateurs connectés, sans casser l'existant.

## Architecture
- Backend : FastAPI (`/app/backend`) — routers modulaires (auth, products, orders, payments, events, chat, push, loyalty, admin_users, **evo**), MongoDB (Motor), cookies httpOnly JWT, rôles customer/admin/super_admin + permissions déléguées (`catalog.manage`, `orders.manage`, `orders.delete` = super_admin only).
- Frontend : React (`/app/frontend`) — pages FR/EN (i18n), shadcn/ui, panier localStorage, axios withCredentials.
- Paiement : lifecycle PAPI/USSD existant, `PAYMENT_MODE=simulation` en local. NON MODIFIÉ (seule une revérification evo a été ajoutée dans `/payments/initiate`).

## User personas
- Client (compte) : achète, suit ses commandes, voit son historique.
- Guest : commande + suivi manuel (n° MGS + ID PUBG) uniquement.
- Admin délégué : gère catalogue/commandes selon permissions.
- Super admin : tout, incl. suppression de commandes.

## Implémenté (25/09/2026 pod) — FazerCards Phase 2 : catalogue PUBG + pseudo depuis FazerCards
- `services/fazercards.py` : `pubg_categories()` (GET /topups, pagination cursor, filtre PUBG Mobile — 4 catégories : pubg_mobile_auto/fast/manual/reserve), `pubg_offers(category_id)` (offer_id, name, price_usd, fields), cache TTL 10 min. Ids jamais hardcodés.
- `GET /api/fazercards/pubg/catalog` (admin, `catalog.manage`) : coûts fournisseur USD non exposés au public.
- Mapping proposé (voir `memory/fazercards_order_workflow.md`) : Premier achat→first_purchase_pack $0.88 ; Fragments matériaux→upgradable_firearm_materials_pack $2.636 ; Emblème mythique→weekly_mythic_emblem_value_pack $2.625 ; Fragments mythique→mythic_emblem_pack $4.389 (À CONFIRMER, nom non exact). Catégorie d'achat : pubg_mobile_auto. Fields requis : player_id.
- Checkout : champ « Pseudo en jeu » + helper supprimés ; pseudo = player_name FazerCards (source de vérité), vérification obligatoire avant soumission (toast sinon), récap affiche « ✓ Compte vérifié · nom » + pseudo vérifié. FR+EN.
- Tests : 27/27 pytest (validate 14 + catalog 13) + testing agent 100% (`test_reports/iteration_14.json`). Commit `3ce60d3`. Push toujours impossible depuis le pod (pas de credentials GitHub).
- Phase 3 documentée mais NON codée : POST /topups/order + Idempotency-Key, revalidation prix/dispo, mapping persistant admin, webhooks/statuts.

## Implémenté (25/09/2026 pod) — FazerCards Phase 1 : validation ID PUBG Mobile
- `services/fazercards.py` : client X-API-Key (`FAZERCARDS_API_BASE`/`FAZERCARDS_API_KEY` en env), découverte dynamique de `category_id`+`fields` via `GET /topups/validate-id` (cache mémoire 10 min), `POST /topups/validate-id`, retry unique sur 5xx upstream (fournisseur flaky), mapping erreurs : 503 clé absente/jeu indispo, 502 erreur fournisseur (jamais masquée en « ID invalide »), 504 timeout, 429 relayé.
- Route `POST /api/fazercards/pubg/validate-id` (rate limit réutilisé : 30/10min/IP) → réponse normalisée `{valid, player_name, region}` ou `{valid:false, message}` — aucun secret/payload brut exposé.
- Frontend : composant `PubgIdVerify` sous le champ ID PUBG du checkout (bouton « Vérifier l'ID », états chargement / ✓ Compte trouvé + nom du joueur + confirmation / ✕ invalide / erreur fournisseur), FR+EN. Checkout/paiement NON modifiés.
- Sécurité : `backend/.env` et `frontend/.env` retirés de l'index Git + .gitignore (ATTENTION : l'historique Git antérieur contient encore les anciens .env commis — rotation des anciens secrets recommandée).
- Tests : `backend/tests/test_fazercards_validate.py` 14/14 (9 unitaires mockés + 5 live) + testing agent 100% backend/frontend (`test_reports/iteration_13.json`). Test réel : `/me` 200 OK, ID 5123456789 → player_name « Eliah2 ». Commit `73e7385` (push impossible depuis le pod — pas de credentials GitHub).
- HORS SCOPE (phase suivante, décidé) : `GET /topups/categories`, `GET /topups/offers`, création de commande, Idempotency-Key, webhooks, paiement auto/manuel, tarification admin.

## Implémenté (23/06/2026… date env : sept 2026 pod) — Pack évolutif + historique
- 4 offres seedées (type produit `evo`, champ `evo_limit`) : Fragments matériaux 17 000 Ar (saison), Premier achat 5 800 Ar (lifetime), Emblème mythique 20 500 Ar (semaine ISO serveur), Fragments mythique 24 000 Ar (saison). Prix modifiables via Admin → Catalogue (`catalog.manage`), prix historisé dans la commande (snapshot `unit_price`).
- Saisons gérées par l'admin (collection `seasons`, une seule active, création/activation dans Admin → Catalogue). Saison seedée : « Saison A18 ».
- Éligibilité backend : `GET /api/evo/eligibility` + revérification à `POST /api/orders` et `POST /api/payments/initiate`. Verrous atomiques `evo_locks` (index unique pubg_id+offer_slug+period_key) — concurrence protégée; commandes cancelled/failed/expired libèrent le droit (via `release_subscription_locks`).
- Page publique `/pack-evolutif` (nav entre Abonnement et Événements, desktop + bottom nav mobile) : offres depuis le catalogue, dialog ID PUBG → vérif éligibilité → panier → checkout (ID prérempli).
- Page Suivi : historique automatique (`GET /api/orders/me`, ownership backend) pour connectés — 5 dernières + « Voir tout », clic → suivi direct. Guest inchangé.
- Admin Commandes : commandes evo visibles avec saison/semaine dans les items.
- Tests : `backend/tests/test_iter12_evo_pack.py` 17/17 + frontend e2e OK (rapport `/app/test_reports/iteration_12.json`). Commits `9a7e3b5` + `0f03042` poussés sur main.

## Backlog priorisé
- P1 : ID PUBG automatique (tâche séparée explicitement hors scope).
- P2 : message d'inéligibilité incluant la période même quand une commande est « en cours » (actuellement message générique — choix UX assumé).
- P2 : endpoint PATCH partiel produits (PUT exige le corps complet).
- P3 : toast d'erreur réseau sur le chargement de l'historique Suivi.

## Notes environnement local
- `backend/.env` / `frontend/.env` locaux non commités (URLs préview + mode simulation). Super admin : voir `/app/memory/test_credentials.md`.
