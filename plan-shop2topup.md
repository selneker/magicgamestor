# Plan d'implémentation — Bascule fournisseur principal vers SHOP2TOPUP

**Branche :** `feat/shop2topup-bascule` (depuis `main`, arbre propre)
**Échéance :** mardi 24/11/2026 · **Démarrage :** mercredi 18/11/2026
**Statut :** prêt à exécuter — 3 prérequis utilisateur en § 4
**Rapports sources :** `/tmp/opencode/repports/2026-11-17-rupture-vers-catalogue.md`,
`2026-11-17-benchmark-3-fournisseurs.md`, `2026-11-17-test-releve-rupture.md`

---

## 1. Vue d'ensemble

MGS passe de FazerCards à **Shop2Topup** comme fournisseur principal. Le but n'est pas
seulement de changer de source d'approvisionnement : c'est de disposer d'un fournisseur qui
**publie l'état de son stock par SKU**, pour que le catalogue MGS se **désactive tout seul en
temps réel** quand un produit tombe en rupture — sans attendre qu'un client passe une commande
et se fasse rembourser.

Le socle de désactivation existe déjà et fonctionne (vérifié sur le code réel). Ce plan ajoute
la **source** qui l'alimente, corrige un **défaut d'expiration** qui rendrait le signal inutile
au bout d'une heure, adapte le catalogue aux produits réellement livrables, et ajoute l'annonce
client.

---

## 2. État des lieux vérifié (ne pas re-découvrir)

| Fait | Preuve |
|---|---|
| La décision d'achat est unique | `backend/services/stock.py:121` `purchasable()` |
| L'API expose `purchasable` + `unavailable_reason` | `stock.public_fields()` |
| La carte affiche « OUT OF STOCK » | `frontend/src/components/store/ProductCard.js:49`, `pages/Product.js:35` |
| Un état `False` **expire au bout de 60 min** si l'horodatage n'est pas rafraîchi | `stock.supplier_state()`, `stock_minutes()`; cron `stock.expire_stale_states` (`order_maintenance.py:289`) |
| `mark_supplier_unavailable()` n'écrit **qu'une fois** (filtre `supplier_available != False`) | `stock.py:213` — testé : la rupture persistante revient en vente à T+61 min |
| Shop2Topup publie `InStock`/`OutOfStock` **par SKU**, sans clé | JSON-LD `offer.availability`, `sku` = `item_id` |
| FazerCards ne publie **aucun** stock sur les top-ups | OpenAPI `/api/v2/topups/offers` = 3 clés |
| Free Fire : **≈ 11 régions** en sous-pages | `/en/shop/free-fire/{mena,cis,eu,sg,latam,vietnam,taiwan,bangladesh,pakistan,brazil}` + `garena-cards` |
| Le scrape actuel **rate les sous-pages** | regex `/en/shop/([a-z0-9-]+)` ne prend que le 1er segment |
| Mapping PUBG : **6 / 14 lots UC** | 60, 325, 660, 1 800, 3 850, 16 200 |
| Pièges de mapping | « 60 WOW Coins » ≠ 60 UC ; « 300 + 25 » = 325 UC |
| Statut de commande bridé à **3 req/60 s** | audit API Shop2Topup |
| Webhook = **HMAC-SHA256** | docs revendeur |
| Interface fournisseur existante | `backend/services/providers/base.py` (`TopupProvider`, `IdentityProvider`) |
| Résolution fournisseur | `backend/services/providers/__init__.py` (`GAME_PROVIDER`, `get_provider`) |
| Cron unique | `backend/services/order_maintenance.py:279` `run_all()` |
| Pas de framework de migration : fonctions idempotentes au démarrage | `backend/server.py:24-40` |

---

## 3. Décisions d'architecture

| # | Décision | Raison |
|---|---|---|
| **AD-1** | Shop2Topup = **fournisseur principal** ; FazerCards reste configuré en **secours** | prix identiques (constat utilisateur), zéro abonnement, et surtout signal de stock réel |
| **AD-2** | Le signal de rupture vient du **stock de Shop2Topup lui-même** | seul moyen d'avoir un signal *autoritatif* : le SKU qui dit « rupture » est celui qui livre |
| **AD-3** | Le mapping `item_id → produit` est **écrit et validé**, jamais déduit au runtime | 6/14 de recouvrement, faux positifs prouvés (« WOW Coins ») |
| **AD-4** | L'horodatage d'une rupture **est rafraîchi** à chaque relevé tant qu'elle dure | sinon le produit revient en vente à T+60 min alors que le fournisseur est toujours en rupture |
| **AD-5** | Réconciliation des statuts **par lots** (≤ 3 req/60 s) | la limite est dure ; une boucle unitaire se fait bri­der pendant les pointes |
| **AD-6** | Prix MGA recalculés depuis le prix revendeur **USD** ; aucun prix inventé | règle projet n° 5 |

---

## 4. Prérequis (bloquants, côté utilisateur)

| # | Prérequis | Bloque |
|---|---|---|
| **P1** | Clé API Shop2Topup placée **par l'utilisateur** dans `backend/.env` (`SHOP2TOPUP_API_KEY`) — jamais lue ni imprimée par l'agent | T03, T07 |
| **P2** | Décision : les **8 lots UC sans équivalent** (30, 90, 120, 180, 415, 720, 985, 1 320) → masqués du catalogue, ou conservés sur FazerCards | T09 |
| **P3** | Texte de l'annonce validé (FR + EN) | T10 |
| **P4** | Autorisaton explicite de modifier `backend/` sur cette branche + exécution de `pytest` par l'utilisateur (pas de Mongo ici) | T05–T08 |

---

## 5. Tâches

> Une tâche = une session = un commit. Format : `feat(shop2topup): …`.
> Après chaque tâche : `cd frontend && yarn build && yarn test:ci`.

### Phase 0 — Préparation

#### T01 — Créer la branche de travail
**Description :** partir d'un état propre, créer la branche dédiée, y déposer ce plan.

**Critères d'acceptation :**
- [ ] `git status` propre avant création
- [ ] branche `feat/shop2topup-bascule` créée depuis `main`
- [ ] `plan-shop2topup.md` présent à la racine

**Vérification :** `git branch --show-current` → `feat/shop2topup-bascule`
**Dépendances :** aucune · **Fichiers :** `plan-shop2topup.md` · **Taille :** XS

---

#### T02 — Relevé de rupture corrigé (sous-pages)
**Description :** porter le script validé dans le dépôt et corriger la regex pour suivre les
sous-pages (`/en/shop/<slug>/<sous-page>`), afin de compter les 11 régions Free Fire et non une.

**Critères d'acceptation :**
- [ ] `frontend/scripts/scrape-stock.mjs` existe, zéro dépendance, Node ≥ 18
- [ ] `--list` énumère les sous-pages (`free-fire/mena-direct-topup`, etc.)
- [ ] `--slug`, `--all`, `--json` conservés ; état **fusionné** (run partiel sans faux delta)
- [ ] deux passages consécutifs → `0 rupture, 0 retour, 0 disparu`
- [ ] code de sortie 2 sur page illisible, jamais de crash

**Vérification :** `node frontend/scripts/scrape-stock.mjs --list | wc -l` puis double passage ;
`node … --slug free-fire/mena-direct-topup`.
**Dépendances :** T01 · **Fichiers :** `frontend/scripts/scrape-stock.mjs` · **Taille :** S

---

### Phase 1 — Vérité fournisseur

#### T03 — Relevé prix + stock via l'API revendeur
**Description :** script lisant la liste de prix/stock de l'API Shop2Topup avec
`SHOP2TOPUP_API_KEY` (variable d'environnement, jamais affichée), sortie JSON exploitable pour
comparer aux prix MGS.

**Critères d'acceptation :**
- [ ] la clé vient **uniquement** de `process.env`, n'apparaît dans aucun log ni fichier
- [ ] sortie : `item_id`, nom, prix USD, stock par SKU
- [ ] échec réseau/401 → message clair, code de sortie non nul, aucune écriture partielle
- [ ] comparaison produite avec les prix MGS actuels (tableau)

**Vérification :** exécution avec la clé fournie par l'utilisateur ; contrôle croisé de 3 SKU
PUBG avec la page publique.
**Dépendances :** T01, **P1** · **Fichiers :** `frontend/scripts/shop2topup-prices.mjs` · **Taille :** S

---

#### T04 — Manifeste de mapping validé + rattachement aux produits
**Description :** écrire le mapping `item_id → produit MGS` (6 lignes PUBG au départ), le
rattacher aux produits (`stock_link`) par une fonction idempotente au démarrage.

**Critères d'acceptation :**
- [ ] manifeste explicite, une ligne par couple, **validé par l'utilisateur** avant commit
- [ ] règle de lecture : unité obligatoire (`UC`), total = somme des nombres, jamais le 1er seul
- [ ] backfill idempotent : deux démarrages → aucun doublon
- [ ] un produit sans `stock_link` n'est **jamais** touché par la synchro

**Vérification :** test unitaire du backfill (fake collection) + relecture du manifeste.
**Dépendances :** T03 · **Fichiers :** `backend/services/shop2topup_map.py`,
`backend/core/shop2topup_mapping.py`, `backend/server.py` (lifespan), `backend/tests/…` · **Taille :** S

---

### Phase 2 — Désactivation temps réel

#### T05 — Correctif : une rupture persistante ne doit pas expirer
**Description :** ajouter le rafraîchissement de l'horodatage tant que la rupture dure, et le
retour explicite en disponibilité.

**Critères d'acceptation :**
- [ ] `mark_supplier_unavailable()` rafraîchit `supplier_checked_at` à chaque passage (transition auditée une seule fois)
- [ ] nouvelle fonction `mark_supplier_available()` (efface `supplier_available` + horodatage, auditée à la transition)
- [ ] rupture maintenue > 60 min → **reste non achetable** (test dédié)
- [ ] retour fournisseur → achetable immédiatement (test dédié)
- [ ] les tests existants de `test_stock_availability.py` restent verts

**Vérification :** `pytest backend/tests/test_stock_availability.py` **par l'utilisateur** ;
en local, rejouer `/tmp/opencode/stock-scraper/test-rupture-persistante.py` sur le module modifié.
**Dépendances :** T01 · **Fichiers :** `backend/services/stock.py`, `backend/tests/test_stock_availability.py` · **Taille :** S

---

#### T06 — Job de synchro disponibilité → catalogue
**Description :** lire le relevé Shop2Topup et appliquer l'état aux produits mappés, branché sur
le cron existant.

**Critères d'acceptation :**
- [ ] un SKU `OutOfStock` → produit non achetable immédiatement (`purchasable()` = `False`)
- [ ] un SKU `InStock` → produit de nouveau achetable
- [ ] SKU **absent du relevé** → aucune modification (jamais de désactivation sur une absence)
- [ ] panne réseau / page illisible → tous les états intacts, aucune exception propagée
- [ ] aucun nom de fournisseur dans les réponses publiques ni les alertes
- [ ] compteurs retournés : `checked`, `marked_out`, `marked_in`, `skipped`

**Vérification :** test unitaire avec fake collection + relevé réel simulé ; puis contrôle manuel
sur le 60 UC (désactivé → revenu).
**Dépendances :** T04, T05 · **Fichiers :** `backend/services/availability_sync.py`,
`backend/services/order_maintenance.py`, `backend/tests/test_availability_sync.py` · **Taille :** M

> **Checkpoint A** (après T06) — la demande d'origine est satisfaite : rupture fournisseur →
> carte désactivée, sans commande client. Validation manuelle sur téléphone avant de continuer.

---

### Phase 3 — Livraison réelle

#### T07 — Adaptateur fournisseur (identité + catalogue)
**Description :** implémenter `IdentityProvider` + la partie catalogue de `TopupProvider` pour
Shop2Topup, sans toucher au domaine.

**Critères d'acceptation :**
- [ ] `validate_identity()` → `IdentityValidation` (valid, player_name, region)
- [ ] `get_categories()` / `get_offers()` → ids fournisseur, jamais codés en dur
- [ ] `normalize_status()` couvre `pending|completed|refunded|partial`
- [ ] erreurs fournisseur traduites vers `services.providers.errors`
- [ ] aucun appel réseau dans les tests (transport bouchonné)

**Vérification :** tests unitaires + un appel réel de validation d'identité (clé utilisateur).
**Dépendances :** T03, **P1** · **Fichiers :** `backend/services/providers/shop2topup_adapter.py`,
`backend/services/providers/__init__.py`, `backend/tests/…` · **Taille :** M

---

#### T08 — Commande + webhook + réconciliation par lots
**Description :** création de commande idempotente, vérification de signature webhook, et
réconciliation respectant la limite de 3 req/60 s.

**Critères d'acceptation :**
- [ ] clé d'idempotence UUID transmise ; retry = même clé, aucun double achat
- [ ] `expected_unit_price` envoyé pour refuser un prix qui a bougé
- [ ] webhook : HMAC-SHA256 vérifié sur le **RAW BODY**, réponse rapide puis traitement
- [ ] réconciliation : lots de 50 toutes les 30 s, jamais une requête par commande
- [ ] `failed`/`refund` → chemin de remboursement existant, pas de nouveau mécanisme
- [ ] enregistrement dans `GAME_PROVIDER` + `get_provider()` résout le nouvel adaptateur

**Vérification :** tests unitaires (signature valide/invalide, idempotence, lot) ; **commande de
test réelle** encadrée par l'utilisateur.
**Dépendances :** T07 · **Fichiers :** `backend/services/providers/shop2topup_adapter.py`,
`backend/services/providers/__init__.py`, `backend/tests/…` · **Taille :** L → découper en T08a
(commande) et T08b (webhook + lots) si nécessaire.

> **Checkpoint B** (après T08) — une commande de test est livrée de bout en bout.

---

### Phase 4 — Catalogue et annonce

#### T09 — Aligner le catalogue sur ce qui est livrable
**Description :** appliquer P2 : produits avec SKU Shop2Topup mappé et prix MGA recalculé ;
produits sans équivalent masqués ou laissés sur FazerCards.

**Critères d'acceptation :**
- [ ] chaque produit **actif** a un `stock_link` valide
- [ ] prix MGA calculés depuis le prix USD relevé, arrondi documenté
- [ ] aucun produit actif sans fournisseur capable de le livrer
- [ ] décision P2 appliquée et tracée dans le rapport de tâche

**Vérification :** liste `produits actifs × fournisseur × prix` relue avec l'utilisateur.
**Dépendances :** T03, **P2** · **Fichiers :** données produits (admin) + éventuel script de
migration idempotent · **Taille :** M

---

#### T10 — Annonce client FR/EN
**Description :** bandeau d'information sur le changement de fournisseur, dans le style existant.

**Critères d'acceptation :**
- [ ] composant dédié monté dans `Layout.js` (modèle : `PendingOrderBanner.js`)
- [ ] toutes les chaînes via `t()`, clés **FR et EN** (parité maintenue à la main)
- [ ] cibles tactiles ≥ 44×44 px, couleurs via tokens existants, aucun hex nouveau
- [ ] fermable et non bloquant ; texte validé (**P3**)
- [ ] `yarn build` + `yarn test:ci` verts

**Vérification :** rendu à 390 px et 1440 px, clair et sombre ; test de non-régression du bandeau.
**Dépendances :** **P3** · **Fichiers :** `frontend/src/components/store/AnnouncementBanner.js`
(+ test), `frontend/src/components/layout/Layout.js`, `frontend/src/i18n/translations.js` · **Taille :** S

---

### Phase 5 — Bascule et garde-fous

#### T11 — Surveillance du solde et plan de retour
**Description :** alerter avant que le wallet soit vide, et garder FazerCards utilisable en secours.

**Critères d'acceptation :**
- [ ] alerte quand le solde passe sous un seuil configurable
- [ ] bascule de secours documentée (quelle variable, quel redémarrage)
- [ ] commandes FazerCards en cours terminées avant coupure

**Vérification :** simulation d'un solde bas ; procédure de rollback relue.
**Dépendances :** T08 · **Fichiers :** `backend/services/` (alerte), documentation · **Taille :** S

---

#### T12 — Validation finale
**Critères d'acceptation :**
- [ ] `cd frontend && yarn build` vert
- [ ] `cd frontend && yarn test:ci` vert
- [ ] `CHROMIUM_PATH=… yarn audit:contrast` à **0 échec**, relancé **sur `main` après fusion** (règle n° 12)
- [ ] `pytest` backend lancé par l'utilisateur, vert
- [ ] parcours réel sur téléphone 390 px : catalogue → fiche → commande → suivi
- [ ] rupture simulée : la carte passe en « OUT OF STOCK », puis revient

**Dépendances :** toutes · **Taille :** S

---

## 6. Calendrier

| Jour | Tâches | Blocage |
|---|---|---|
| **J1 — mer 18/11** | T01, T02 | — |
| **J2 — jeu 19/11** | T03, T04, T05 | **P1** (clé) |
| **J3 — ven 20/11** | T06 + **Checkpoint A** | — |
| **J4–J5 — sam/dim** | T07, T08 (+ **Checkpoint B**) | **P4** (backend) |
| **J6 — lun 23/11** | T09, T10 | **P2**, **P3** |
| **J7 — mar 24/11** | T11, T12, fusion | — |

Chemin critique : **P1**. Tout le reste est du travail local vérifiable.

---

## 7. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Bridage statut (3 req/60 s) aux heures de pointe | Élevé | réconciliation par lots conçue dès T08, testée |
| Solde wallet épuisé | Élevé | alerte sous seuil (T11) |
| Faux positif de mapping | Élevé | manifeste validé à la main, jamais déduit (AD-3) |
| Rupture « qui expire » à 60 min | Élevé | correctif T05, test de non-régression |
| Produit désactivé alors qu'il est livrable | Moyen | absence de SKU = aucune modification ; état à deux signaux conservé |
| Régression de contraste après fusion | Moyen | `yarn audit:contrast` sur `main` |
| Panne Shop2Topup | Moyen | FazerCards reste configuré en secours (T11) |

---

## 8. Questions ouvertes

1. **P2** — les 8 lots UC sans équivalent : masqués ou gardés sur FazerCards ?
2. **P3** — texte de l'annonce : rédigé par l'utilisateur ou proposé puis validé ?
3. Le mapping doit-il rester un manifeste versionné (rapide) ou passer par l'écran Admin →
   Fournisseur (durable, mais une tâche de plus) ?
4. Shop2Topup doit-il aussi porter la **vérification d'identité** (il a `POST /player/validate`)
   ou Neferbyte reste-t-il en place ?

---

## 9. Commandes utiles

```bash
# relevé de rupture
node frontend/scripts/scrape-stock.mjs --list
node frontend/scripts/scrape-stock.mjs            # jeux suivis
node frontend/scripts/scrape-stock.mjs --all      # tout le catalogue
node frontend/scripts/scrape-stock.mjs --json     # sortie machine

# prix revendeur (clé lue dans l'environnement, jamais affichée)
SHOP2TOPUP_API_KEY=… node frontend/scripts/shop2topup-prices.mjs

# vérifications projet
cd frontend && yarn build && yarn test:ci
CHROMIUM_PATH=/chemin/chromium yarn audit:contrast
cd backend && pytest tests/test_stock_availability.py tests/test_availability_sync.py
```

---

## 10. Format du rapport de fin de tâche

- Fichiers modifiés
- Ce qui a changé (2–3 lignes)
- Comment c'est vérifié (commande ou test, avec le résultat)
- Points ouverts
