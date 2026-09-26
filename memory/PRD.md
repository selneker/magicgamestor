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

## Implémenté (juin 2026) — Décomposition interne des produits UC composés au fulfillment (commit `d11fa38`)
- **Objectif** : un produit UC composé (720 = 660+60, 120 = 60+60, 180 = 60×3, 985 = 660+325, 1320 = 660×2, 16200 = 8100×2) est décomposé UNIQUEMENT au fulfillment fournisseur en N commandes FazerCards indépendantes (chaque composant = une offre DIRECTE). Le panier / checkout / prix / ligne Order client restent INCHANGÉS (1×720 UC = 1 ligne à son prix).
- **`services/fzr_fulfillment.py`** : refonte en modèle par UNITÉ. `_units_for_line` → 1 unité (direct) ou N unités (composé, quantités expansées). Records : direct legacy (`fazercards` / `fazercards_lines.{idx}`, clés `{order}-1` / `{order}-L{n}-1`) ; composants → `fazercards_components.{idx}.{u}`, clés STABLES `{order}-L{idx+1}-C{u+1}`. `preflight`/`fulfill_order`/`refresh_status`/`_sync_mgs_status`/`apply_webhook_event` itèrent les unités. Claim atomique par unité (pas de doublon, concurrence sûre) ; retry ne réémet que les composants échoués (même clé) ; succès partiel cohérent ; paiement non confirmé → aucun envoi. Rétrocompat mono-ligne directe (shape de retour + clés inchangés).
- **`services/fzr_mapping.py`** : `fulfillable()` inclut désormais les mappings composés confirmés (décomposés en interne).
- **Admin → Commandes** (`FzrFulfillment.js` / `AdminOrders.js`) : arbre parent/composants (bordure + indentation), statut par composant, compteur « Envoyer au fournisseur (N) » = unités réellement prêtes (composant déjà envoyé non recompté). Couleurs cohérentes (vert=succès, bleu=info/composition, ambre=attente, rouge=erreur, gris=neutre) lisibles en clair/sombre.
- **Tests** : `test_fzr_composite_fulfillment.py` (14 cas mocks : expansion 120/180/720/985/1320/16200, direct inchangé, composé+direct, retry partiel même clé, no-dup 2e clic, concurrence, delivered quand tout completed, paiement non confirmé, no secret). Suite FazerCards **71/71 verte**, stable en xdist. Testing agent : backend 100% (71/71), affichage frontend 100%. **Aucune vraie commande fournisseur / aucun débit** (provider live désactivé, mocks uniquement).
- **Connu, hors scope** : le deeplink admin `?order=<order_number>` renvoie « Order not found » car `GET /api/orders/{id}` ne résout que par UUID `id` (bug PRÉEXISTANT, non lié à la décomposition ; contournement : recherche par n° dans la liste).


## Implémenté (juin 2026) — Audit générique des mappings UC + garde mapping direct UC
- **Cause racine corrigée** : `build_mapping` (mode direct) ne validait pas la quantité UC → un produit 120 UC pouvait être lié DIRECTEMENT à l'offre 60 UC (faux mapping). Ajout d'une garde : pour un produit UC, l'offre directe doit avoir EXACTEMENT la même quantité UC, sinon 409.
- **Règle générale (aucun cas 120 hardcodé)** dans `services/fzr_mapping.py` : `resolve_uc_mapping()` → SKU exact = DIRECT ; sinon somme EXACTE disponible = COMPOSITION (`_compose_exact`, min-unités) ; sinon MANQUANT. Aucune quantité approchée, aucun offer_id inventé (offres issues du catalogue live).
- **Audit** : `GET /admin/fazercards/uc-audit` (lecture seule) + `POST /admin/fazercards/uc-audit/apply` (guardés `require_admin` / `catalog.manage`) — corrige tous les produits UC, préserve les mappings déjà corrects, retire les faux mappings sans somme exacte.
- **Frontend** : Admin → Fournisseur affiche la composition « 1 × 60 UC + 1 × 60 UC » + panneau d'audit UC ; Admin → Commandes reflète direct/composition/à-confirmer/manquant sur chaque ligne (règles de fulfillment inchangées, l'exécution des mappings composés reste hors scope).
- **PARTIE B (batch multi-produits)** : déjà implémentée dans "Batch Sending" (N lignes = N commandes FazerCards, idempotence par ligne, pas de doublon, retry même clé) — PRÉSERVÉE, non modifiée.
- **Tests** : `test_fzr_uc_audit.py` (14+ cas : direct 60/325/660/1800/3850, compositions 120/180/720/985/1320/16200, manquants 30/90/415, garde direct, pas de faux mapping, pas d'offer_id inventé, pas de secret) ; fix race xdist (`cleanup_test_artifacts` scopé par worker). 57 tests FazerCards verts, stables. Aucune vraie commande fournisseur (mocks/stubs). Commit : 7652f4a.


## Implémenté (26/09/2026 pod) — FazerCards Phase 4 : mapping fournisseur générique + nouvelles offres Pack évolutif
- `services/fzr_mapping.py` (nouveau) : mapping **direct** (1 offre) ou **composé** (plusieurs offres, produits UC uniquement) pour TOUS les types (uc/prime/prime_plus/evo). Validation live contre GET /topups/offers (rien de hardcodé). Composition : somme des UC composants == uc_amount du produit sinon 409 ; composant non-UC refusé ; composition sur prime/prime_plus/evo refusée (direct uniquement). Champ `confirmed` (false = « ⚠ À confirmer », pas d'envoi fournisseur). `fulfillable()` = direct confirmé uniquement (multi-commandes fournisseur HORS SCOPE, modèle préparé).
- Endpoints : PATCH `/admin/fazercards/products/{id}/mapping` (body {mode, category_id, offer_id?|components[{offer_id,quantity}], confirmed}), GET `/admin/fazercards/mappings` enrichi (mapping_status missing/direct/composite/unconfirmed/invalid, fulfillable, supplier_cost_usd), GET `/admin/fazercards/coverage` (offres live + kind uc/subscription/currency/special + used_by → « Disponible chez fournisseur, non activée MGS »). Alerte prix : lookup étendu aux composants composites. Audit fzr.mapping_set/unset.
- Produits : champ `requires_mapping` (préservé au PUT si non fourni) ; activation refusée (409) sans mapping valide confirmé ; commande refusée (409) via `purchase_blocked` (orders + evo/eligibility). Vue publique `/products` : `fazercards_mapping` retiré (coût fournisseur jamais exposé) + drapeau `purchasable`.
- Fulfillment : `mapped_item` = direct confirmé uniquement ; preflight erreurs distinctes (mapping manquant / à confirmer / composé hors scope). Admin Commandes : badge « ⚠ Mapping fournisseur manquant » sur commande payée mono-article non mappée, pas de bouton Envoyer.
- Seed : 2 nouveaux produits Pack évolutif `evo-weekly-deal-1` (5 900 Ar) et `evo-weekly-deal-2` (17 500 Ar), type evo, limite semaine, créés inactifs + requires_mapping (activés après mapping live). Page /pack-evolutif : en-tête « Packs spéciaux », bouton « Bientôt disponible » si purchasable=false.
- Mappings configurés en base (via API admin, catalogue live pubg_mobile_auto) : direct 60/325/660/1800/3850 UC, Prime 1/3/6/12, Prime+ 1/3/6/12, Premier achat→first_purchase_pack, Fragments matériaux→upgradable_firearm_materials_pack, Emblème mythique→weekly_mythic_emblem_value_pack, Weekly Deal 1→weekly_deal_pack_1, Weekly Deal 2→weekly_deal_pack_2 ; composés 120=60×2, 180=60×3, 720=660+60, 985=660+325, 1320=660×2, 16200=8100×2 ; Fragments mythique→mythic_emblem_pack **confirmed=false (⚠ À confirmer)**. 30/90/415 UC volontairement sans mapping (aucune offre live exacte).
- Admin → Fournisseur refondu : groupes par type, badges statut, dialog config (radios direct/composition, catégorie live, offre live avec offer_id lecture seule + coût USD, composants qté×offre avec ✓/✕ composition exacte, case « Mapping confirmé »), couverture fournisseur. AUCUNE commande FazerCards réelle lancée.
- Tests : `/app/tests/test_phase4_live.py` 34/34 + pytest régression 51 passed (evo, catalog, validate, subscription) + 26 passed (fzr_phase3) + testing agent 100% backend/frontend (`test_reports/iteration_16.json`). Échecs env uniquement : push VAPID absent local, tests rate-limit (limites locales relevées).


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
