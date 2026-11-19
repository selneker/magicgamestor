# Plan d'implémentation v2 — SHOP2TOPUP seul fournisseur, G2BULK en secours

**ID :** PL-006-PLAN-S2T-V2 · **Version :** 2 (remplace `plan-shop2topup.md`, conservé pour historique)
**Branche :** `feat/shop2topup-bascule` (depuis `main`, arbre propre)
**Échéance :** mardi 24/11/2026 · **Rédigé :** mercredi 18/11/2026
**Statut :** plan uniquement — aucun fichier de `backend/` ni de `frontend/` modifié dans cette session
**Nature :** plan d'exécution, pas un rapport d'audit. Chaque affirmation sur le code porte `fichier:ligne`.

---

## 0. Ce qui change par rapport au v1, et pourquoi

Le v1 avait trois trous et une décision inversée. Ils sont corrigés ici, nommément.

| # | Défaut du v1 | Correction v2 |
|---|---|---|
| **C1** | T02 produisait un script Node dans `frontend/scripts` et T06 était un job Python sur le serveur : le job ne peut pas lancer un script Node du dépôt. Le trou n'était couvert par rien. | **T02 devient un lecteur Python** (`backend/services/shop2topup_stock.py`). Le script Node devient un **outil de contrôle manuel** (T02b), pas la source de production. |
| **C2** | « L'API revendeur donne le prix **et le stock** par SKU » était présenté comme un fait. Ce n'est **pas** prouvé. | **T03 = tâche de vérification** dès que la clé existe, avec **deux branches** derrière une même frontière `fetch_stock()`. Par défaut : JSON-LD public (prouvé le 18/11). |
| **C3** | « Retirer FazerCards » était traité comme un changement de dictionnaire. | **§ 3 et T16** : le fournisseur est résolu **par jeu, à chaque appel**, et le nom stocké dans la commande n'est **jamais relu**. Retirer FazerCards casse la réconciliation de ses commandes en cours **et** son webhook. Changement minimal décrit et chiffré. |
| **Décision** | « FazerCards reste configuré en secours » (AD-1 v1). | **Inversé** : FazerCards est **retiré** (perte de confiance client). G2Bulk = secours **manuel**. |
| **Défaut découvert** | Le v1 proposait une « voie A : script → `PATCH /admin/products/{id}/availability` ». | **Impossible** : cette route n'écrit que `manual_unavailable` (`routers/products.py:171-187`), **jamais** `supplier_available`. Aucune route HTTP n'écrit l'état fournisseur — seul `stock.mark_supplier_unavailable()` le fait. Le job backend n'est donc pas un choix, c'est la seule voie. |
| **Artefacts** | Le v1 renvoyait à `/tmp/opencode/repports/…` et à `/tmp/opencode/stock-scraper/…`. | **Ces fichiers n'existent plus** (répertoire temporaire nettoyé, vérifié). Les tâches qui en dépendaient sont réécrites pour repartir du code, pas d'un artefact. |

### 0.1 Avenants du 18/11/2026 (décisions du propriétaire, fermes)

| # | Avenant | Effet dans ce plan |
|---|---|---|
| **A1** | `supplier_mapping` est **indexé par fournisseur** : `{"shop2topup": {...}}`, structure déjà prête pour une clé `g2bulk`. T04 n'écrit **que** la clé `shop2topup`. | AD-7, T04, T09 |
| **A2** | **T09 passe après le Checkpoint B**, au moment de la bascule réelle. Tant que des commandes peuvent encore partir chez FazerCards, **aucun produit n'est désactivé**. | ordre d'exécution (§ 5), calendrier (§ 6) |
| **A3** | **P7 tranché : aucun ajout de produit.** Les lots Shop2Topup que MGS ne vend pas sont **listés**, pas créés. Le drapeau `popular` des 30 UC et 1 320 UC est **déplacé** sur 325 UC et 660 UC. | § 4, T09, § 7, § 8 |
| **A4** | Nouveau risque : la page publique peut **refuser l'IP de Render** (anti-bot). | § 7 |
| **A5** | **P1 est posée aujourd'hui** : T03 est faisable dès J1/J2. | § 6 |
| **A6** | **G2Bulk sort du chantier Shop2Topup** et devient une **phase finale**, démarrée seulement après T12 validé : T13, T14, la bascule de T11, la clé `g2bulk` du mapping. | § 5, § 5bis, T11, T15, § 6, § 7 |
| **A7** | **Les clés vivent dans les variables d'environnement de Render**, jamais dans un fichier. En local, le propriétaire fournit la clé comme variable de la session du terminal (non enregistrée) ; l'agent la lit uniquement par `os.environ`. Même règle pour les autres fournisseurs. | § 4 (P1), T03, T07, T15, § 8, § 9 |

---

## 1. Vue d'ensemble

MGS passe à **Shop2Topup comme unique fournisseur de top-up**. FazerCards est retiré du service — il ne sert
plus qu'à **terminer les commandes déjà parties**. G2Bulk devient le **secours**, actionné à la main.

L'objectif fonctionnel reste celui de la demande d'origine : **le catalogue se désactive tout seul quand le
fournisseur publie une rupture**, sans attendre qu'un client paie pour un produit indisponible. La différence
avec le v1 est que ce signal est **mesurable aujourd'hui, sans clé API** : la page produit publique de
Shop2Topup publie un `availability` par SKU (vérifié le 18/11/2026, voir § 2).

Le socle de décision d'achat existe déjà et fonctionne. Ce plan ajoute la **source** qui l'alimente, corrige
un **défaut d'expiration** qui rendrait le signal inutile au bout d'une heure, aligne le catalogue sur ce que
Shop2Topup livre réellement, construit la **sortie de FazerCards** sans perdre l'historique, et ajoute
l'annonce client.

---

## 2. État des lieux vérifié (ne pas re-découvrir)

### 2.1 Chaîne de décision d'achat — existe et fonctionne

| Fait | Preuve |
|---|---|
| Une seule fonction décide de l'achat | `backend/services/stock.py:121` `purchasable()` |
| Elle combine : forçage admin → rupture fournisseur fraîche → mapping obligatoire | `stock.py:127-134` |
| L'API publique expose `purchasable` + `unavailable_reason` | `stock.py:137-140` `public_fields()` |
| La carte produit affiche « OUT OF STOCK » | `frontend/src/components/store/ProductCard.js:49`, `pages/Product.js:35,87` |
| Un produit `active: false` **disparaît** de la liste publique | `backend/routers/products.py:82` (`query = {"active": True}`) |
| Un produit `purchasable: false` **reste listé**, marqué indisponible | `ProductCard.js:49` — deux leviers distincts, à ne pas confondre |
| Seul écrivain de `supplier_available` : `mark_supplier_unavailable()` | `stock.py:212-214` ; aucune route ne l'écrit (`routers/products.py:180` ne touche que le forçage manuel) |

### 2.2 Défaut mesuré — la rupture expire à 60 min

| Fait | Preuve |
|---|---|
| Un `False` plus vieux que `STOCK_STALE_MINUTES` (60) redevient « inconnu » → **achetable** | `stock.py:80-86`, `stock.py:100-105` |
| `mark_supplier_unavailable()` n'écrit **qu'une fois** : filtre `supplier_available != False` | `stock.py:213` |
| Donc une rupture qui dure **n'est jamais rafraîchie** → retour en vente à T+61 min alors que le fournisseur est toujours en rupture | conséquence directe des deux lignes ci-dessus |
| Le retour à « inconnu » est fait par le cron | `order_maintenance.py:289` → `stock.expire_stale_states` (`stock.py:249-263`) |
| Le module déclare explicitement que le fournisseur n'expose aucun stock | `stock.py:3-4` — **prémisse devenue fausse** avec Shop2Topup, à corriger dans T05 |

### 2.3 Signal publié par Shop2Topup — mesuré le 18/11/2026

Mesure directe des pages publiques (`https://shop2topup.com/en/shop/...`), sans clé, sans compte :

| Page | Résultat |
|---|---|
| `/en/shop/pubg-mobile` | **34 offres**, `sku` = identifiant produit, **1 en `OutOfStock`** (`sku 12` = 10 UC) |
| Structure | `Product → offers (AggregateOffer) → offers[] { sku, name, price, priceCurrency, availability }` |
| `/en/shop/free-fire/mena-direct-topup` | **21 offres**, page accessible, même structure |
| Sous-pages Free Fire | `mena`, `cis`, `eu`, `sg`, `latam`, `vietnam`, `taiwan`, `bangladesh`, `pakistan`, `brazil` + `garena-cards` |

Extrait réel PUBG (prix publics, 18/11/2026) :

| `sku` | Offre | Prix USD | État |
|---|---|---|---|
| 12 | 10 UC | 0,35 | **OutOfStock** |
| 13 | 60 UC | 0,99 | InStock |
| 14 | 300 + 25 UC (= 325) | 4,95 | InStock |
| 15 | 600 + 60 UC (= 660) | 9,90 | InStock |
| 16 | 1 500 + 300 UC (= 1 800) | 24,75 | InStock |
| 17 | 3 000 + 850 UC (= 3 850) | 49,50 | InStock |
| 18 | 6 000 + 2 100 UC (= 8 100) | 99,00 | InStock |
| 19 | 12 000 + 4 200 UC (= 16 200) | 198,00 | InStock |
| 20-22 | 24 300 / 32 400 / 40 500 UC | 297 / 396 / 495 | InStock |
| 32637-32642 | **« WOW Coins »** 60 → 8 100 | 0,96 → 98,91 | InStock |

La page PUBG contient aussi : Elite Pass LV1-50 et LV1-100, Elite Pass Plus, First Purchase Pack,
Mythic Emblem Pack, Upgradable Firearm Materials Pack, Weekly Deal Pack 1/2, Weekly Mythic Emblem Value Pack,
**Prime 1/3/6/12 mois** et **Prime Plus 1/3/6/12 mois**.

> **Pièges de mapping, prouvés par la mesure** : « 60 **WOW Coins** » (sku 32637) n'est pas « 60 UC » ;
> « 300 + 25 » vaut **325** UC, pas 300 ; « 600 + 60 » vaut **660**.

### 2.4 Recouvrement réel avec le catalogue MGS

Catalogue MGS (`backend/core/seed.py:8-13`) : 14 lots UC **tous actifs** —
30, 60, 90, 120, 180, 325, 415, 660, 720, 985, 1 320, 1 800, 3 850, 16 200.
`seed.py:14-18` : 8 abonnements Prime/Prime+ actifs. `seed.py:19-28` : 4 packs évolutifs actifs.

| Lot MGS | SKU Shop2Topup | Verdict |
|---|---|---|
| 60 UC | 13 | **exact** |
| 325 UC | 14 (300+25) | **exact** |
| 660 UC | 15 (600+60) | **exact** |
| 1 800 UC | 16 (1 500+300) | **exact** |
| 3 850 UC | 17 (3 000+850) | **exact** |
| 16 200 UC | 19 (12 000+4 200) | **exact** |
| 30, 90, 120, 180, 415, 720, 985, 1 320 UC | — | **aucun équivalent** |

**Conséquence non signalée dans le v1** : parmi les lots sans équivalent, **30 UC et 1 320 UC sont marqués
`popular: True`** (`seed.py:9,11`) — ils alimentent les blocs mis en avant du catalogue
(`frontend/src/pages/Catalog.js:146,192`). Les désactiver **vide deux emplacements de la vitrine**.
Ce n'est pas bloquant, mais c'est une décision visuelle, pas seulement technique.

**Portée réelle du catalogue** : seul **PUBG Mobile est actif**. Free Fire existe comme jeu configuré mais
`active: False` (`backend/core/games.py:23`). L'alignement catalogue (T09) porte donc sur PUBG ; Free Fire
reste à couvrir pour le jour où il sera réactivé.

### 2.5 Livraison — ce qui est vrai du moteur actuel

| Fait | Preuve |
|---|---|
| La commande fournisseur est créée par `provider.create_order(category_id, offer_id, fields, idempotency_key)` | `providers/base.py` (`TopupProvider`), appel `fzr_fulfillment.py:370-373` |
| **L'interface ne transporte aucun prix attendu** | signature ci-dessus — l'idée d'un `expected_unit_price` du v1 n'existe pas côté MGS : elle devrait être ajoutée à l'interface |
| Le prix fournisseur est **revalidé juste avant l'envoi** (cache contourné) | `fzr_mapping.py:149` → `fazercards.pubg_offers_fresh`, puis contrôle de présence de l'offre `fzr_fulfillment.py:268-276` |
| L'idempotence est une clé texte construite sur le numéro de commande | `fzr_fulfillment.py:123-134`, stockée dans l'unité |
| Le mapping est lu **par produit**, champ `fazercards_mapping` | `fzr_fulfillment.py:172-198`, validé par `fzr_mapping.mapping_ok` (`fzr_mapping.py:94-106`) |
| L'absence de mapping **bloque l'envoi** et, si `requires_mapping`, l'achat | `fzr_mapping.py:128-133`, `stock.py:132` |
| Le nom du fournisseur est écrit dans l'unité de commande | `fzr_fulfillment.py:350` (`"provider": "fazercards"`) |
| **… et n'est jamais relu** | aucun `rec["provider"]` dans `fzr_fulfillment.py` (grep) |
| Le statut se rafraîchit **unitaire**, une requête par unité | `fzr_fulfillment.py:444-446` |

### 2.6 C3 — la résolution fournisseur, en détail

| Fait | Preuve |
|---|---|
| Table **par jeu** | `providers/__init__.py:17` : `{"pubg-mobile": "fazercards", "free-fire": "fazercards"}` |
| Défaut global | `providers/__init__.py:18` `DEFAULT_PROVIDER = "fazercards"` |
| **Repli silencieux** : tout nom inconnu instancie FazerCards | `providers/__init__.py:30-32` |
| Résolution par `order["game_id"]` à **chaque** appel | `fzr_fulfillment.py:370` (envoi), `:444` (statut), `:470` (synthèse), `:524` (webhook) |
| Le webhook FazerCards vérifie la signature via `get_provider(None)` → `DEFAULT_PROVIDER` | `routers/fzr_orders.py:352` + `fazercards_adapter.py:69-74` |
| `GAME_PROVIDER` est un **dict Python** : aucune variable d'environnement ne le pilote | `providers/__init__.py` (aucun `os.environ`) |

**Trois conséquences, à traiter dans T16 — c'est le cœur de C3 :**

1. **Retirer FazerCards n'est pas changer le dictionnaire.** Une commande FazerCards partie mais non terminée
   serait sondée chez Shop2Topup avec un `provider_order_id` FazerCards (`fzr_fulfillment.py:444-446`) :
   statut inconnu, commande bloquée « processing » indéfiniment, client jamais livré ni remboursé.
2. **Le webhook se casse tout seul.** Si `DEFAULT_PROVIDER` passe à `shop2topup`, la route
   `/fazercards/webhook` vérifie la signature avec le mauvais secret → **401 sur tous les événements**.
3. **La « bascule en une variable » décidée par le propriétaire n'existe pas aujourd'hui.**
   Il faut une **surcharge par variable d'environnement** lue par `get_provider()`, sinon la bascule G2Bulk
   impose un commit + un déploiement, ce qui n'est pas une procédure de secours.

**Changement minimal retenu (AD-7 / AD-8)** — trois points, aucun ne touche au domaine :

- `get_provider()` accepte une résolution **explicite** `get_provider(game_id, provider_name=None)` ;
  l'appelant qui possède un record de commande transmet `record["provider"]` en priorité.
- Le mapping Shop2Topup vit dans un **champ neuf** `supplier_mapping` ; `fazercards_mapping` **n'est jamais
  écrasé** (les commandes en cours et l'historique continuent de le lire).
- Le repli silencieux vers FazerCards est remplacé par une **erreur explicite** ; la route webhook FazerCards
  reçoit une instance FazerCards **explicite** et reste en place jusqu'à la coupure (T15).

### 2.7 Hors périmètre, mais à savoir

- `stock_signals.py:3-4` déclare « le fournisseur n'expose aucun stock » : toute la mécanique indirecte
  (remboursements, liste d'offres) est bâtie sur cette prémisse. `sync_offers` appelle
  `fazercards.pubg_offers_fresh` **en dur** (`stock_signals.py:325`) : après le retrait de FazerCards, cette
  tâche échoue à chaque passage. Elle doit être neutralisée à la coupure (T15), pas laissée « au cas où ».
- La vérification d'identité **ne change pas** (Neferbyte / existant). `POST /player/validate` de Shop2Topup
  est noté comme piste future, **hors périmètre**.
- Aucune trace de G2Bulk dans le backend (grep) : l'adaptateur part de zéro.

---

## 3. Décisions d'architecture

| # | Décision | Raison |
|---|---|---|
| **AD-1** *(réécrit)* | **Shop2Topup est le seul fournisseur de top-up en service.** FazerCards est **retiré** du service dès que ses commandes en cours sont terminées ; **G2Bulk** est le **secours, actionné manuellement**. | décision du propriétaire (confiance client perdue sur FazerCards) |
| **AD-2** | Le signal de rupture vient du **stock publié par le fournisseur qui livre**. Aucun signal lisible ⇒ **aucune désactivation**. | un état bloquant doit être autoritatif, sinon on bloque une vente livrable |
| **AD-3** | Le mapping `sku → produit` est **écrit et validé par le propriétaire**, jamais déduit au runtime. | « WOW Coins », « 300 + 25 » : les faux positifs sont prouvés (§ 2.3) |
| **AD-4** | L'horodatage d'une rupture **est rafraîchi** à chaque relevé tant qu'elle dure. | sans ça, retour en vente à T+61 min alors que la rupture est toujours réelle (§ 2.2) |
| **AD-5** | La réconciliation des statuts respecte un **budget de requêtes** ; le traitement « par lot » n'est retenu **que si** la doc prouve un endpoint par lot. | la limite annoncée (doc) est basse ; une boucle unitaire se fait brider pendant les pointes |
| **AD-6** *(réécrit)* | **Les prix MGS existants ne changent pas.** Aucun prix n'est recalculé ni inventé ; l'ajout d'un lot que MGS ne vend pas encore exige une **règle de prix fournie par le propriétaire** (taux + marge). | règle projet n° 5 ; le dépôt ne contient ni taux de change ni politique de marge (grep) |
| **AD-7** *(nouveau, A1)* | Le mapping fournisseur vit dans un **champ neuf** `supplier_mapping`, **indexé par fournisseur** : `supplier_mapping = {"shop2topup": {...}}` aujourd'hui, une clé `g2bulk` pourra s'ajouter sans rien casser. `fazercards_mapping` **n'est jamais écrasé**. | préserve la réconciliation des commandes en cours et l'historique (C3) ; une même fiche produit peut être livrable par deux fournisseurs sans conflit |
| **AD-8** *(nouveau)* | Le fournisseur est résolu **par le record de la commande d'abord**, par la table de jeu ensuite ; **plus aucun repli silencieux**. | sinon une commande en cours est sondée chez le mauvais fournisseur (C3) |
| **AD-9** *(nouveau)* | La lecture de stock est derrière une frontière unique `fetch_stock(skus) -> {sku: bool}`. Deux implémentations : `jsonld` (**défaut, prouvé**) et `api` (si T03 le démontre). | C2 : on ne suppose pas, on branche |

---

## 4. Prérequis (bloquants, côté propriétaire)

| # | Prérequis | Bloque |
|---|---|---|
| **P4** | **Autorisation d'écrire dans `backend/` sur cette branche** + lancement de `pytest` par le propriétaire (pas de Mongo, ni `motor`, ni `pytest` dans cet environnement) | T02, T05, T06, T07, T08, T14, T15, T16 — **le plus bloquant désormais** |
| **P1** | Clé `SHOP2TOPUP_API_KEY` ajoutée **par le propriétaire** dans les variables d'environnement de **Render** (Dashboard → Environment). **Aucun fichier `.env` n'est créé, lu ni committé** pour cette clé. Elle est **posée aujourd'hui** (A5). | T03 (branche API), T07, T08 |
| **P5** | Fréquence réelle du cron `cron-job.org` sur `POST /internal/orders/run` (`routers/maintenance.py:16-21`) et titulaire du compte | T06 (validation), T11 |
| **P6** | Compte + clé G2Bulk, posée de la même façon (variables Render, A7) | T13, T14 — **phase finale uniquement** (A6) |
| **P3** | Texte de l'annonce FR + EN validé | T10 |
| **P7** | **Tranché (A3) : aucun ajout de produit.** Les lots Shop2Topup que MGS ne vend pas (10 UC, 8 100, 24 300, 32 400, 40 500…) sont **listés dans le rapport de T09**, jamais créés. Plus rien à fournir. | — |

> **P2 du v1 est tranché** : les lots sans équivalent Shop2Topup sont **désactivés**, pas conservés ailleurs.

**Point de calendrier important :** la boucle de rupture (T01 → T02 → T05 → T06, **Checkpoint A**) ne dépend
**ni de P1 ni de P6** — le JSON-LD public est lisible sans clé. Elle ne dépend que de **P4**.

---

## 5. Tâches

> Une tâche = une session = un commit. Format : `feat(shop2topup): …`.
> Chaque tâche est validée puis committée avant la suivante. `cd frontend && yarn build && yarn test:ci`
> après toute tâche qui touche `frontend/` (aucune commande n'existe pour le backend ici : `pytest` est lancé
> par le propriétaire).

**Ordre d'exécution réel** (les numéros restent stables pour la traçabilité) :

```
Chantier Shop2Topup (échéance 24/11) :
T01 → T02 → T05 → T02b → T03 → T04 → T06 ═ Checkpoint A ═
    → T07 → T08 ═ Checkpoint B ═ → T09 → T16 → T10 → T15 → T11 → T12

Phase finale, hors échéance, après T12 validé (A6) :
G2Bulk : T13 → T14 → T11b
```

> **A2** : T09 vient **après** le Checkpoint B, quand plus aucune commande ne peut partir chez FazerCards.
> **A6** : rien de G2Bulk n'est lancé avant T12 ; dans le chantier Shop2Topup, G2Bulk n'apparaît nulle part.

### Phase 0 — Préparation (aucune clé requise)

#### T01 — Créer la branche de travail *(fait le 18/11/2026)*
**Description :** partir d'un état propre, créer la branche dédiée, y déposer ce plan.

**Critères d'acceptation :**
- [x] état de départ vérifié : `git status` ne portait que les **deux documents de plan** (artefacts des
      sessions précédentes) — aucune modification de code en attente, rien d'étranger au chantier
- [x] branche `feat/shop2topup-bascule` créée depuis `main`
- [x] `plan-shop2topup-v2.md` (ce document) et `plan-shop2topup.md` (v1, conservé pour historique) à la racine

**Vérification :** `git branch --show-current`
**Dépendances :** aucune · **Fichiers :** `plan-shop2topup-v2.md` · **Taille :** XS

---

#### T02 — Lecteur de stock **Python** côté backend *(modifié — C1)*
**Description :** remplacer l'idée d'un script Node par un module Python qui lit la source publique et
retourne un état par SKU. C'est **la** brique qui alimentera le job de T06 ; elle doit vivre là où le job
tourne (le backend, sur Render), pas dans `frontend/scripts`.

**Critères d'acceptation :**
- [x] `backend/services/shop2topup_stock.py` expose `fetch_stock(slugs) -> StockReading` avec
      `{sku: bool}` + `pages_ok` / `pages_failed` — **aucune I/O réseau au chargement du module**
- [x] lecture du JSON-LD `Product → offers → offers[]` (`sku`, `availability`), pas de regex sur du HTML
- [x] suit les **sous-pages** (`/free-fire/mena-direct-topup` & co), dédupliquées
- [x] **fusion d'état** : un relevé partiel met à jour ce qu'il a lu et **ne conclut rien** sur le reste
- [x] une page illisible ⇒ `pages_failed`, **aucun** SKU inventé, **aucune** exception propagée
- [x] délai par requête borné, budget total borné, `User-Agent` identifiable
- [x] aucun nom de fournisseur dans les messages destinés au client
- [x] tests unitaires sur **fixtures HTML** (aucun appel réseau) : page normale, SKU absent, page illisible,
      relevé partiel

**Vérification :** `pytest backend/tests/test_shop2topup_stock.py` (propriétaire) ; relecture du diff.
**Dépendances :** T01, **P4** · **Fichiers :** `backend/services/shop2topup_stock.py`,
`backend/tests/test_shop2topup_stock.py`, fixtures · **Taille :** M

---

#### T02b — Outil Node de contrôle manuel *(nouveau)*
**Description :** garder un script en ligne de commande pour **inspecter** la source hors production
(« qu'est-ce que le fournisseur publie en ce moment ? »). Ce n'est **pas** la source de production : il ne
sera branché sur rien.

**Critères d'acceptation :**
- [x] `frontend/scripts/scrape-stock.mjs`, zéro dépendance, Node ≥ 18
- [x] options `--list`, `--slug <id>`, `--json` ; sortie lisible sans `--json`
- [x] mêmes règles que T02 : sous-pages suivies, page illisible ⇒ code de sortie 2
- [x] aucune écriture dans le dépôt, aucun secret

**Vérification :** `node frontend/scripts/scrape-stock.mjs --list` puis `--slug pubg-mobile`.
**Dépendances :** T02 (mêmes règles) · **Fichiers :** `frontend/scripts/scrape-stock.mjs` · **Taille :** S
*(peut être repoussée après le Checkpoint A sans rien bloquer.)*

---

### Phase 1 — Vérité fournisseur

#### T03 — Vérifier ce que l'API revendeur expose réellement *(modifié — C2)* *(fait le 18/11/2026, mesuré)*
**Description :** **ne rien supposer**. Un relevé unique et daté de la réponse catalogue de l'API revendeur,
pour répondre à une seule question : **y a-t-il un champ de stock par SKU ?**

**Critères d'acceptation :**
- [x] clé lue **uniquement** depuis `os.environ` ; **jamais** écrite dans un fichier, un log ou un rapport
- [x] rapport `RAPPORT-SHOP2TOPUP-API.md` : forme exacte de la réponse (noms de champs), présence/absence de
      stock, forme de l'authentification, endpoints observés
- [x] verdict explicite : **`api`** (stock présent) ou **`jsonld`** (absent) — pas « peut-être »
- [x] si `api` : la branche API est choisie et T02 est étendue pour l'utiliser ; si `jsonld` : rien ne change,
      T02 reste la source et l'API ne sert qu'à commander
- [x] aucun prix reporté dans le plan sans source (le relevé peut citer les prix **observés**, datés)

**Vérification :** exécution par le propriétaire, clé exportée dans la session du terminal (A7), rapport relu.
**Dépendances :** T01, **P1** · **Fichiers :** `RAPPORT-SHOP2TOPUP-API.md`, éventuel script de relevé
jetable **non committé** · **Taille :** S

---

#### T04 — Manifeste de mapping validé + rattachement *(modifié)*
**Description :** écrire le mapping `sku → produit MGS` dans un manifeste versionné, et le rattacher aux
produits dans un **champ neuf indexé par fournisseur** — `supplier_mapping["shop2topup"]` (AD-7, **A1**).
La forme est `{"shop2topup": {"sku": "13", "uc_total": 60, "mode": "direct"}}` ; la clé `g2bulk` n'est
**pas** écrite ici (phase finale).

**Critères d'acceptation :**
- [ ] manifeste explicite, une ligne par couple (`sku`, `product_slug`, `uc_total`, `name_seen`),
      **relu et validé par le propriétaire avant commit**
- [x] règle de lecture inscrite en tête du fichier : unité obligatoire (`UC`), total = **somme** des nombres,
      « WOW Coins » exclu
- [x] rattachement idempotent : deux démarrages → aucun doublon, aucune écriture inutile
- [x] T04 n'écrit **que** `supplier_mapping["shop2topup"]` (A1) ; aucune autre clé fournisseur n'est créée
- [x] `fazercards_mapping` **jamais** modifié (test dédié)
- [ ] un produit sans `supplier_mapping["shop2topup"]` n'est **jamais** touché par la synchro
- [x] les 6 couples UC de § 2.4 constituent le jeu de départ **proposé** ; prime/évolutif restent hors
      manifeste tant que le propriétaire ne les a pas validés (A3 : aucun ajout de produit dans ce chantier)

**Vérification :** test du backfill sur collection factice + relecture ligne à ligne du manifeste.
**Dépendances :** T03 · **Fichiers :** `backend/core/shop2topup_mapping.py` (manifeste),
`backend/services/shop2topup_map.py` (rattachement), `backend/server.py` (lifespan :24-40),
`backend/tests/…` · **Taille :** S

---

### Phase 2 — Désactivation temps réel

#### T05 — Correctif : une rupture persistante ne doit pas expirer *(modifié)*
**Description :** c'est le défaut qui rendrait tout le reste inutile. Tant que le fournisseur dit « rupture »,
l'horodatage doit être rafraîchi ; quand il dit « disponible », l'état doit être **effacé explicitement**,
pas laissé à l'expiration.

**Critères d'acceptation :**
- [x] `mark_supplier_unavailable()` rafraîchit `supplier_checked_at` à **chaque** passage ; l'audit et
      l'alerte ne sont émis **qu'à la transition** (une seule fois par épisode)
- [x] nouvelle `mark_supplier_available()` : efface `supplier_available` + `supplier_checked_at`, auditée à
      la transition seulement, ne touche **jamais** `manual_unavailable`
- [x] rupture maintenue **> 60 min** ⇒ toujours non achetable (test dédié, horloge injectée)
- [x] retour fournisseur ⇒ achetable **au premier passage suivant** (test dédié)
- [x] la docstring de module (`stock.py:3-4`) est corrigée : la prémisse « aucun stock publié » n'est plus vraie
- [x] `STOCK_SYNC_ENABLED=false` neutralise toujours tout marquage automatique
- [ ] les tests existants de `test_stock_availability.py` restent verts

**Vérification :** `pytest backend/tests/test_stock_availability.py` (propriétaire). En local : relecture du
diff + rejeu du raisonnement temporel à la main **sans** Mongo (les deux fonctions sont pures côté filtre).
**Dépendances :** T01, **P4** · **Fichiers :** `backend/services/stock.py`,
`backend/tests/test_stock_availability.py` · **Taille :** S

---

#### T06 — Job de synchro disponibilité → catalogue *(modifié)*
**Description :** lire la source (T02, ou API si T03 a tranché `api`) et appliquer l'état aux produits
mappés, branché sur le **cron existant** — aucune nouvelle route.

**Critères d'acceptation :**
- [x] SKU `OutOfStock` ⇒ `purchasable()` = `False` immédiatement, **sans commande client**
- [x] SKU `InStock` ⇒ de nouveau achetable (via `mark_supplier_available`, T05)
- [x] SKU **absent du relevé** ou page illisible ⇒ **aucune modification**
- [x] relevé **vide ou suspect** (moins de la moitié des SKU attendus) ⇒ relevé ignoré, aucun état touché
      (même prudence que `stock_signals.py:42` (`SUSPECT_DROP_RATIO`))
- [x] **santé du relevé** : compteur `pages_ok`, et alerte admin si **aucune** lecture réussie depuis N passages
      — sinon le signal meurt en silence, ce qui est le pire des cas
- [x] aucun nom de fournisseur dans les réponses publiques ni les alertes
- [x] compteurs retournés : `checked`, `marked_out`, `marked_in`, `skipped`, `pages_ok`, `pages_failed`,
      plus, depuis la revue, `mode` (`observe` par défaut / `apply`), `would_mark_out`, `would_mark_in`
      et `coverage_suspect`
- [x] branché dans `order_maintenance.run_all()` (`order_maintenance.py:279-296`), **une ligne**, sans
      modifier la signature des autres tâches
- [x] durée bornée : le relevé ne peut pas faire expirer la route cron (budget total explicite)

Fait le 18/11/2026 : 21 tests dans `test_availability_sync.py` (dont 5 sur le mode `observe`, la santé et
les alertes), 3 dans `test_shop2topup_stock.py`, 1 de plus dans `test_stock_availability.py` (vue publique
sans `supplier_mapping` ; levée admin ignorée par `STOCK_SYNC_ENABLED`).

**Vérification :** tests unitaires (fake collection + relevé simulé) ; puis contrôle manuel sur le **60 UC**
(le passer en rupture simulée → carte « OUT OF STOCK » ; le remettre → revenu).
**Dépendances :** T02, T04, T05 · **Fichiers :** `backend/services/availability_sync.py`,
`backend/services/order_maintenance.py`, `backend/tests/test_availability_sync.py` · **Taille :** M

> **Checkpoint A** — la demande d'origine est satisfaite : rupture fournisseur ⇒ carte désactivée, sans
> commande client, et **une rupture qui dure reste bloquée**. Validation manuelle sur téléphone 390 px
> avant d'aller plus loin. **C'est le livrable garanti de la semaine.**

---

### Phase 3 — Livraison réelle

#### T07 — Adaptateur Shop2Topup : identité + catalogue *(modifié)*
**Description :** implémenter `TopupProvider` (catalogue) et, si utile, `IdentityProvider` pour Shop2Topup.
Ne toucher ni au domaine, ni aux signatures existantes.

**Critères d'acceptation :**
- [x] `name = "shop2topup"` ; `normalize_status()` couvre `pending|completed|refunded|partial` (+ statuts
      inconnus ⇒ `processing`, comme l'adaptateur actuel `fazercards_adapter.py:40-42`)
- [x] `get_categories()` / `get_offers()` : ids fournisseur, **jamais** codés en dur
- [x] erreurs fournisseur traduites vers `services.providers.errors` (`OUT_OF_STOCK`,
      `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE`, `PRICING_UPDATING` ⇒ classes existantes)
- [x] `is_out_of_stock_error()` reconnaît les codes Shop2Topup **sans** casser FazerCards
      (`stock.py:180-193`, `STOCK_ERROR_CODES`)
- [x] enregistrement dans `get_provider()` **explicite** (branche nommée, pas le repli silencieux actuel
      `providers/__init__.py:30-32`)
- [x] aucun appel réseau dans les tests (transport bouchonné)

Fait le 19/11/2026 : `shop2topup_adapter.py` (clé lue dans `os.environ` à chaque appel, enveloppe `data`
**et** clé documentée, catalogue sans id codé en dur), 26 tests dans `test_shop2topup_adapter.py`,
`py_compile` OK. Reste à faire **par le propriétaire** : l'appel réel de validation d'identité (A7).
Sans `offer_id` le préflight ne peut pas l'appeler — voir Points ouverts du rapport (T16).

**Vérification :** tests unitaires + un appel réel de validation d'identité (clé lue depuis les variables
Render, A7 — jamais depuis un fichier).
**Dépendances :** T03, **P1** · **Fichiers :** `backend/services/providers/shop2topup_adapter.py`,
`backend/services/providers/__init__.py`, `backend/tests/…` · **Taille :** M

---

#### T08 — Commande, webhook et statut, dans le budget de requêtes *(modifié)*
**Description :** créer la commande de façon idempotente, vérifier la signature du webhook, et réconcilier
les statuts **sans se faire brider**.

**Critères d'acceptation :**
- [x] même `idempotency_key` réutilisée en cas de retry ⇒ **aucun double achat** (comportement déjà en place,
      `fzr_fulfillment.py:123-134` — la préserver, pas la réinventer)
- [x] webhook : signature HMAC-SHA256 vérifiée sur le **RAW BODY**, réponse rapide, traitement ensuite
      (le motif de `routers/fzr_orders.py:352-360` est repris tel quel) — **signature, normalisation et
      route faites** : routeur dédié `backend/routers/shop2topup_webhook.py` (`POST
      /shop2topup/webhook`, `503` sans secret, `401` sur signature fausse, dédoublonnage par
      `event_id`), inclus dans `server.py`. **À CONFIRMER** après le premier événement réel : nom
      d'en-tête (`X-Shop2Topup-Signature`), préfixe `sha256=` et forme du corps (`event` / `data`) —
      aucun des trois n'est écrit dans `RAPPORT-SHOP2TOPUP-API.md`.
- [x] **limite de requêtes** : la valeur (annoncée 3 req/60 s **dans la doc — à reconfirmer**) est traitée
      comme une **hypothèse à vérifier**, pas comme un fait ; le code applique un **budget** (compteur +
      fenêtre), pas un sleep codé en dur
- [x] « lots de 50 toutes les 30 s » **seulement si** un endpoint de statut **par lot** est documenté ;
      sinon : file d'attente + budget, priorité aux unités les plus anciennes, journalisation des unités
      affamées
- [x] ordre de grandeur assumé (~300 commandes/mois, soit ~10/jour) : le budget doit tenir sans jamais
      dépasser la limite, y compris avec un arriéré
- [x] `failed` / `refunded` ⇒ chemin de remboursement **existant**, aucun nouveau mécanisme
- [x] `GAME_PROVIDER` pointe PUBG Mobile vers `shop2topup`

Fait le 19/11/2026 : budget dur (catalogue/création 5000, statut 3/60 s **par commande**, lot 2/60 s),
une alerte par épisode, `get_orders()` par lots de 50, `reconcile()` plus anciennes d'abord avec journal des
affamées, `DUPLICATE_ORDER` ⇒ relecture. `POST /orders/batch` est **documenté** (RAPPORT § 4) : le lot est
utilisé, pas la file d'attente. **T08C (19/11/2026)** : `reconcile()` est branché dans la maintenance
(`order_maintenance.py`, unités `provider == "shop2topup"` uniquement, erreur journalisée) et la route
webhook existe (routeur dédié). Reste à faire **par le propriétaire** : la commande de test réelle, le
premier appel réel de `POST /orders/batch` (le nom du champ d'entrée n'est pas documenté — une seule
constante `BATCH_REQUEST_KEY` à corriger si besoin), et le premier événement webhook réel (en-tête, format
de signature et corps « à confirmer »).

**Conséquence de la bascule — RÉSOLUE par T16 (19/11/2026).** La table `GAME_PROVIDER` ne sert pas qu'au
top-up : la validation d'identité passait par le même résolveur (`neferbyte_adapter.py:220-232`, appelé par
`routers/fazercards.py:139,167` et `fzr_fulfillment.py:246`). Pour PUBG Mobile, elle arrivait donc sur
Shop2Topup, dont `validate_identity` exige une offre (`sub_category_id`) absente du préflight : toute
validation ou tout envoi PUBG répondait **409 `missing_offer`**. T16 a séparé les deux résolutions
(`IDENTITY_PROVIDER = "fazercards"`, `providers/__init__.py:29`) : l'identité ne suit plus la table de top-up.
Le Checkpoint B reste non atteint pour une autre raison — aucune commande réelle n'a été passée.

**Vérification :** tests unitaires (signature valide/invalide, idempotence, budget respecté) ; **commande de
test réelle** encadrée par le propriétaire.
**Dépendances :** T07 · **Fichiers :** `backend/services/providers/shop2topup_adapter.py`,
`backend/services/providers/__init__.py`, `backend/tests/…` · **Taille :** L → découper en T08a (commande) /
T08b (webhook + budget) si la session déborde.

> **Checkpoint B** — une commande de test est livrée de bout en bout, et le statut est réconcilié sans
> dépasser le budget.
>
> **Non atteint le 19/11/2026** : le code est en place et couvert par des tests à transport simulé
> (T08C a ajouté le branchement de `reconcile()` dans la maintenance, la route webhook et le script
> `backend/scripts/shop2topup_checkpoint_b.py`), mais **aucune commande réelle n'a été passée** (aucun
> appel fournisseur autorisé dans cette session). Checkpoint B reste à valider par le propriétaire avec
> une clé Render : essai à blanc du script, puis `--confirm-spend`, puis vérification du statut réconcilié.

---

### Phase 4 — Résolution fournisseur : sortie de FazerCards

#### T16 — Résolution fournisseur par commande + surcharge par variable *(nouveau — C3)*
**Description :** rendre possible le retrait de FazerCards **sans perdre** les commandes déjà parties, et
rendre vraie la « bascule en une variable ».

**Critères d'acceptation :**
- [x] `get_provider(game_id, provider_name=None)` : un nom explicite prime ; un nom **inconnu lève** une
      erreur claire (fin du repli silencieux `providers/__init__.py:30-32`)
- [x] les 4 appels de `fzr_fulfillment.py` (`:370`, `:444`, `:470`, `:524`) résolvent d'abord
      `record.get("provider")`, puis la table par jeu (repli documenté pour les records legacy sans champ)
- [x] test : une commande dont l'unité porte `provider: "fazercards"` reste réconciliée chez FazerCards même
      si `GAME_PROVIDER` pointe ailleurs
- [x] test : une commande **sans** champ `provider` (legacy) reste réconciliée chez FazerCards
- [x] surcharge manuelle : `TOPUP_PROVIDER_<GAME>` (ex. `TOPUP_PROVIDER_PUBG_MOBILE=g2bulk`), lue par
      `get_provider()`, **une variable + un redémarrage** — c'est la procédure de bascule du propriétaire
- [x] la route `/fazercards/webhook` utilise une instance FazerCards **explicite** (`routers/fzr_orders.py:352`)
- [x] `GAME_PROVIDER` par défaut : `pubg-mobile → shop2topup` ; `DEFAULT_PROVIDER` ne désigne plus FazerCards

**Fait le 19/11/2026 :** commit `24e1da2` (`feat(shop2topup): résolution fournisseur par commande, identité
hors bascule (T16)`), 12 fichiers backend, **148 tests réussis / 0 échec** sur les 5 modules demandés.
`IDENTITY_PROVIDER = "fazercards"` (`providers/__init__.py:29`) : l'identité ne suit pas la table de top-up.
Reste ouvert : la surcharge `TOPUP_PROVIDER_<GAME>` n'a pas été exercée en production (elle l'est en test).
**Vérification :** tests unitaires (résolution explicite, record prioritaire, legacy, surcharge env) ;
`pytest` lancé par le propriétaire.
**Dépendances :** T08 · **Fichiers :** `backend/services/providers/__init__.py`,
`backend/services/fzr_fulfillment.py`, `backend/routers/fzr_orders.py`, `backend/tests/…` · **Taille :** M

---

### Phase 5 — Bascule catalogue, annonce, coupure de FazerCards

#### T09 — Aligner le catalogue sur ce que Shop2Topup livre *(modifié — A2, A3)*
**Description :** un produit n'est **actif** que s'il a un `supplier_mapping["shop2topup"]` valide. Les autres
sont désactivés (`active: false`), donc **retirés** du catalogue public — pas affichés « rupture ».
**Cette tâche a lieu après le Checkpoint B** (A2) : tant que des commandes peuvent encore partir chez
FazerCards, aucun produit n'est désactivé.

**Critères d'acceptation :**
- [x] **préalable T09A (19/11/2026)** : `backend/scripts/shop2topup_margin.py` relève, **par GET seulement**,
      le prix facturé au revendeur des six SKU du manifeste et le confronte aux prix MGS de
      `core/seed.py:9-12` (coût = revendeur × taux × (1 + frais/100), marge en Ar et en %, statut
      `OK`/`PERTE`). Essai à blanc sans réseau par défaut ; `--live` = au plus 3 GET.
      **Aucun relevé réel n'a été fait** : c'est le propriétaire qui lance `--live` avec son taux et ses
      frais, avant toute décision de prix.
- [x] **préalable T09B (19/11/2026)** : `backend/services/p2p_rate.py` lit le taux USDT/MGA sur
      P2P.Army (section `BUY`, médiane des 5 meilleures annonces, filtre MVola / Orange Money /
      Airtel Money), le stocke dans `settings.p2p_rate` (clé neuve, réglage Binance
      `rate_ar_per_usdt` non touché), le rafraîchit au plus toutes les 30 min dans
      `order_maintenance.run_all()`, alerte `p2p_rate_stale` / `p2p_rate_recovered` (60 min) et
      `margin_below_threshold` (`MARGIN_ALERT_MIN_PCT`) **une fois par lot et par épisode**.
      Aucun prix modifié, aucun produit désactivé. **Aucun appel réel n'a été fait** : transport
      simulé d'après la documentation ; les trois événements sont dans `telegram.py`.
- [x] **T09B script (19/11/2026)** : `--rate auto` lit le taux stocké, ou l'interroge sur P2P.Army
      avec `--live` ; le reste du script ne change pas.
- [x] **préalable T09C (19/11/2026)** : le relevé passe de `get_p2p_prices` à `get_p2p_order_book`
      (une ligne par annonce ; seul endpoint documentant `min_fiat`/`max_fiat`, `user_id`,
      `user_orders`, `user_rate`). Filtres : une annonce par vendeur (la moins chère),
      `P2P_PAYMENT_METHODS` (défaut `mvola,orange`, **plus de repli** sur toutes les méthodes),
      `P2P_REF_AMOUNT_AR` (200 000) contenu dans les limites, `P2P_MIN_COMPLETION_PCT` /
      `P2P_MIN_ORDERS` (90 / 50). Moins de 3 annonces retenues ⇒ relevé refusé. `settings.p2p_rate`
      porte en plus `n_ads` et `n_rejected` par raison. **Aucun filtre de restriction** : la
      documentation ne publie aucun drapeau. Diagnostic en lecture seule :
      `backend/scripts/p2p_rate_dump.py`. Aucun appel réel n'a été fait.
- [ ] T09 exécutée **après** le Checkpoint B, jamais avant (A2)
- [ ] les 8 lots UC sans équivalent passent `active: false` (décision P2 tranchée)
- [ ] **A3 / P7 tranché** : **aucun produit créé**. Les lots Shop2Topup que MGS ne vend pas (10 UC, 8 100,
      24 300, 32 400, 40 500) sont **listés** dans le rapport de fin de tâche, avec leur prix public et leur
      état, et rien d'autre
- [ ] **A3 / vitrine** : le drapeau `popular` est **déplacé** de 30 UC et 1 320 UC (`seed.py:9,11`) vers
      **325 UC et 660 UC** (mêmes clés, mêmes slugs) ; le nombre de produits mis en avant reste identique
- [ ] **garde-fou** : `game_has_sellable_catalog()` (`core/games.py:73-85`) doit rester vrai pour
      `pubg-mobile` — les 6 lots mappés suffisent, le test le prouve
- [ ] les produits **non** mappés mais `requires_mapping` ne bloquent pas l'achat des autres
- [ ] aucun prix existant modifié (AD-6) ; `old_price` conservé
- [ ] migration idempotente (fonction au démarrage ou script admin), aucun produit supprimé

**Vérification :** liste `produit × sku × prix × active` relue avec le propriétaire ; contrôle sur la boutique
publique que les 6 lots restent achetables, que les 8 autres ont disparu, et que la vitrine affiche bien
325 UC et 660 UC en mis en avant.
**Dépendances :** T04, Checkpoint B · **Fichiers :** migration idempotente
(`backend/core/…` ou script admin), données produits · **Taille :** M

---

#### T10 — Annonce client FR/EN *(inchangé)*
**Description :** bandeau d'information sur le changement de fournisseur, dans le style existant.

**Critères d'acceptation :**
- [ ] composant dédié monté dans `Layout.js` (modèle : `PendingOrderBanner.js`)
- [ ] toutes les chaînes via `t()`, clés **FR et EN** (parité maintenue à la main, 690/690 aujourd'hui)
- [ ] cibles tactiles ≥ 44×44 px, couleurs via tokens existants, aucun hex nouveau
- [ ] fermable et non bloquant ; texte validé (**P3**)
- [ ] `yarn build` + `yarn test:ci` verts

**Vérification :** rendu à 390 px et 1440 px, clair et sombre ; test de non-régression du bandeau.
**Dépendances :** **P3** · **Fichiers :** `frontend/src/components/store/AnnouncementBanner.js` (+ test),
`frontend/src/components/layout/Layout.js`, `frontend/src/i18n/translations.js` · **Taille :** S

---

#### T15 — Plan de coupure FazerCards *(nouveau)*
**Description :** sortir FazerCards du service **sans perdre une commande**, et éteindre ce qui ne sert plus.

**Critères d'acceptation :**
- [ ] inventaire des unités `provider_order_id` non terminées (`completed`), avec leur statut
- [ ] date de coupure fixée par le propriétaire, **après** que cet inventaire est vide (ou remboursé)
- [ ] la clé FazerCards est retirée **par le propriétaire** des variables d'environnement **Render** (A7) ;
      l'abonnement 9,99 $/mois est résilié (dépense pure après bascule)
- [ ] `stock_signals.sync_offers` est neutralisé (`STOCK_OFFERS_SYNC_MODE=off` ou retrait de la ligne du cron
      `order_maintenance.py:291`) : il appelle FazerCards en dur (`stock_signals.py:325`) et échouerait à
      chaque passage
- [ ] la route webhook FazerCards est **conservée** jusqu'à la coupure effective (elle porte les événements
      des dernières commandes), puis retirée ou renvoyée 410 — décision tracée
- [ ] l'historique reste lisible : aucune suppression de `fazercards`, `fazercards_lines`,
      `fazercards_components`, `fazercards_provider_ids`, ni de `fazercards_mapping`
- [ ] procédure de retour arrière documentée (quel commit, quel redémarrage)

**Vérification :** inventaire relu par le propriétaire ; `curl` sur le cron après passage en `off` (aucune
erreur) ; lecture de la procédure.
**Dépendances :** T16 **seulement** (A6 : G2Bulk n'est pas un prérequis de la coupure) ·
**Fichiers :** documentation de coupure, `order_maintenance.py` (une ligne) · **Taille :** S

---

#### T11 — Alerte de solde du wallet *(modifié — A6)*
**Description :** alerter avant que le wallet Shop2Topup soit vide. Un solde épuisé arrête les livraisons en
silence : c'est le seul incident qui ne se voit pas venir. **La procédure de bascule vers G2Bulk n'est plus
ici** — elle passe en phase finale (T11b, A6).

**Critères d'acceptation :**
- [ ] alerte quand le solde passe sous un seuil **configurable** (valeur fournie par le propriétaire, jamais
      inventée) ; le message public ne nomme jamais le fournisseur
- [ ] si T03 a documenté un endpoint de solde : lecture automatique à chaque passage du cron ; sinon :
      **contrôle manuel** documenté
- [ ] l'alerte ne bloque **aucun** produit : un wallet vide ne doit pas vider le catalogue
- [ ] seuil, fréquence et destinataire écrits dans la procédure d'exploitation

**Vérification :** simulation d'un solde bas (valeur de test) ; lecture de la procédure.
**Dépendances :** T07, **P5** · **Fichiers :** service d'alerte, documentation d'exploitation · **Taille :** S

---

#### T12 — Validation finale *(inchangé)*
**Critères d'acceptation :**
- [ ] `cd frontend && yarn build` vert
- [ ] `cd frontend && yarn test:ci` vert
- [ ] `CHROMIUM_PATH=… yarn audit:contrast` à **0 échec**, **relancé sur `main` après fusion** (règle n° 12)
- [ ] `pytest` backend vert, lancé par le propriétaire
- [ ] parcours réel sur téléphone 390 px : catalogue → fiche → commande → suivi
- [ ] rupture simulée : la carte passe en « OUT OF STOCK », **reste bloquée > 60 min**, puis revient
- [ ] aucune commande FazerCards en cours à la coupure

**Dépendances :** toutes · **Taille :** S

---

## 5bis. Phase finale — G2Bulk *(hors chantier Shop2Topup, sans date — A6)*

> **A6.** Cette phase ne démarre **qu'après T12 validé**. Rien de G2Bulk n'est lancé avant : ni code, ni clé,
> ni mapping. Conséquence assumée par le propriétaire : **tant que cette phase n'est pas faite, il n'existe
> aucun secours** en cas de panne Shop2Topup (§ 7). L'échéance du 24/11 concerne **Shop2Topup seul**.

#### T13 — Audit de la doc G2Bulk *(nouveau)*
**Description :** **aucune supposition**. Une tâche de lecture qui produit un rapport sur ce que G2Bulk
documente réellement. G2Bulk n'existe nulle part dans le code (grep) : tout est à établir.

**Critères d'acceptation :** le rapport `RAPPORT-G2BULK-API.md` répond, **avec citation de la doc** ou
« non documenté », à :
- [ ] authentification (clé en en-tête ? en query ?)
- [ ] stock par produit : publié ou non (**déjà mesuré le 17/11** : stock exposé sur `/v1/products` pour les
      vouchers, **pas** sur `/v1/games/{code}/catalogue` — à reconfirmer)
- [ ] limite de requêtes (valeur, fenêtre, en-têtes de retour)
- [ ] endpoint de suivi de commande : **unitaire uniquement ?** existe-t-il un endpoint **par lot** ?
- [ ] webhook : existe ? quel algorithme de signature, quel en-tête, quel format ?
- [ ] idempotence : un identifiant côté client est-il accepté ?
- [ ] statuts possibles et sémantique de `partial` / `refunded`
- [ ] solde du wallet : endpoint de consultation ? unité ?
- [ ] AUCUNE clé, aucun secret, aucun identifiant de compte dans le rapport

**Vérification :** rapport relu ; chaque affirmation est soit citée de la doc, soit marquée « non documenté ».
**Dépendances :** aucune (lecture) · **Fichiers :** `RAPPORT-G2BULK-API.md` · **Taille :** S

---

#### T14 — Adaptateur G2Bulk *(nouveau)*
**Description :** un `TopupProvider` conforme, écrit **après** T13 et **selon** T13. Si T13 ne permet pas de
livrer (pas de webhook, pas de statut), l'adaptateur le dit explicitement et le secours reste **manuel** avec
contrôle humain — c'est acceptable pour un secours.

**Critères d'acceptation :**
- [ ] `name = "g2bulk"`, `normalize_status()` couvre les statuts **documentés** par T13
- [ ] `create_order()` respecte le contrat de `providers/base.py` (aucun paramètre ajouté)
- [ ] aucune capacité inventée : ce que la doc ne documente pas n'est **pas** implémenté, et le rapport de fin
      de tâche le liste
- [ ] erreurs mappées vers `services.providers.errors`, y compris solde insuffisant
- [ ] aucun appel réseau dans les tests
- [ ] `get_provider()` connaît explicitement `g2bulk`

**Vérification :** tests unitaires ; **une** commande de test réelle, petite, encadrée par le propriétaire.
**Dépendances :** T13, T16, **P6** · **Fichiers :** `backend/services/providers/g2bulk_adapter.py`,
`backend/services/providers/__init__.py`, `backend/tests/…` · **Taille :** M

---

#### T11b — Bascule manuelle vers G2Bulk *(nouveau — phase finale, A6)*
**Description :** rendre la bascule réelle — pas théorique. La résolution par variable d'environnement existe
depuis T16 ; cette tâche la **prouve** avec G2Bulk en face. Elle arrive **après** T12 : avant, il n'y a rien
à basculer.

**Critères d'acceptation :**
- [ ] `TOPUP_PROVIDER_PUBG_MOBILE=g2bulk` + redémarrage ⇒ `get_provider()` renvoie l'adaptateur G2Bulk
      (prouvé par test, pas par lecture)
- [ ] retour arrière : retirer la variable + redémarrer ⇒ Shop2Topup
- [ ] la bascule **ne réécrit aucun mapping** : `supplier_mapping["shop2topup"]` reste en place ; la clé
      `supplier_mapping["g2bulk"]` (A1) n'est remplie que si le propriétaire valide des correspondances
      G2Bulk **produit par produit**
- [ ] limite écrite noir sur blanc : sans clé `g2bulk` validée, les produits MGS ne sont **pas** livrables par
      G2Bulk — la bascule sert à **arrêter les frais**, pas à vendre normalement
- [ ] procédure d'exploitation : quelle variable, quel redémarrage, quel contrôle après bascule

**Vérification :** bascule aller-retour sur un environnement de test ; lecture de la procédure.
**Dépendances :** T13, T14, T16 · **Fichiers :** documentation d'exploitation, données `supplier_mapping` ·
**Taille :** S

---

## 6. Calendrier

Aujourd'hui **mer 18/11** ; cible **mar 24/11** (7 jours) — **pour Shop2Topup seul** (A6). Chemin critique :
**P4** (autorisation backend). **P1 est posée aujourd'hui** (A5) : T03 est faisable dès J1/J2 et ne bloque
plus la semaine.

| Jour | Tâches | Bloque par |
|---|---|---|
| **J1 — mer 18** | T01, T02 | **P4** |
| **J2 — jeu 19** *(sortie GTA 6 — prévoir la charge)* | T05, T02b, T03 | **P4** |
| **J3 — ven 20** | T04, T07 | **P1** (T07) |
| **J4 — sam 21** | T06 ═ **Checkpoint A** ═ | — |
| **J5 — dim 22** | T08 ═ **Checkpoint B** ═ | **P1** |
| **J6 — lun 23** | T09, T16 | — |
| **J7 — mar 24** | T10, T15, T11, T12 | **P3** (T10) |

**Phase finale G2Bulk :** après T12 validé, **sans date** (A6) — T13, T14, T11b.

**Ce qui tient même si la semaine déborde :** T01 → T06, soit **le signal de rupture en production** —
la demande d'origine, testable sans commande réelle et sans clé API. C'est le seul engagement de date que
ce plan prend.

**Ce qui ne tient pas sans P1 :** T07, T08 — donc **aucune livraison réelle**. Le plan reste alors utile :
le catalogue se désactive correctement, mais les commandes continuent de partir chez FazerCards.

**Ce qui ne tient pas sans P4 :** presque tout. C'est le prérequis n° 1, pas la clé.

**Ce qui n'a pas de date :** la phase G2Bulk. Elle suit Shop2Topup, elle ne le précède jamais (A6).

---

## 7. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| **Panne Shop2Topup** : **aucun secours** tant que la phase G2Bulk n'est pas faite | Élevé | assumé explicitement par le propriétaire (A6) : l'échéance du 24/11 est Shop2Topup seul ; la phase finale rend le secours réel, T13 **avant** T14 |
| **Coupure FazerCards trop tôt** : commandes non réconciliables | Élevé | T16 (résolution par record) **avant** T15 ; inventaire vide obligatoire avant coupure |
| **Bridage du statut** aux heures de pointe | Élevé | budget de requêtes explicite (T08), pas de sleep codé en dur ; priorité aux plus anciennes |
| **Mapping faux positif** (« WOW Coins », « 300 + 25 ») | Élevé | manifeste validé à la main (AD-3), règles écrites en tête de fichier |
| **Rupture « qui expire » à 60 min** | Élevé | T05 + test de non-régression dédié |
| **Signal muet** : la page change de forme, le relevé lit 0 SKU, et personne ne le voit | Élevé | règle « relevé vide/suspect ⇒ aucune modification » **et** alerte de santé du relevé (T06) |
| **Anti-bot** : la page publique **refuse l'IP de Render** (A4) | Élevé | la lecture échoue proprement (`pages_failed`), **aucun état n'est touché** ; l'alerte de santé de T06 prévient le propriétaire au lieu de le laisser croire que tout va bien ; **premier contrôle réel dès le premier déploiement de T06** — c'est le seul moyen de savoir. Si le refus est confirmé : basculer sur la branche `api` de T03 (clé) |
| **Catalogue vidé** : plus aucun produit livrable ⇒ jeu retiré (`game_has_sellable_catalog`) | Moyen | 6 lots UC mappés dès T04 ; test explicite dans T09 |
| **Vitrine appauvrie** : 30 et 1 320 UC sont `popular` et disparaissent | Moyen | **tranché (A3)** : le drapeau `popular` est déplacé sur **325 UC et 660 UC** ; le nombre de produits mis en avant ne change pas |
| **Solde wallet épuisé** | Élevé | alerte sous seuil (T11) |
| **Relevé trop lent pour la route cron** | Moyen | budget total borné (T02/T06) ; 1 page ≈ 1 s mesurée le 17/11 |
| **Régression de contraste après fusion** | Moyen | `yarn audit:contrast` relancé **sur `main`** (règle n° 12) |

---

## 8. Questions ouvertes

1. **P4 — autorisation backend + `pytest` par le propriétaire.** Sans ça, aucune tâche au-delà de T01.
2. **P5 — fréquence du cron** : quelle est-elle aujourd'hui ? En dessous de `STOCK_STALE_MINUTES` (60 min),
   le signal est stable ; au-dessus, il clignote.
3. **P6 — compte G2Bulk** : nécessaire seulement à la phase finale (A6) ; il ne bloque rien avant T12.
4. **Prime / évolutif** : Shop2Topup publie Prime 1/3/6/12, Prime Plus 1/3/6/12, First Purchase, Mythic Emblem,
   matériaux. Les mapper élargit le catalogue livrable — mais chaque correspondance est une **validation
   produit par produit**, pas une déduction. À décider après T04, **hors des 6 lots UC** du jeu de départ.
5. **Faits « doc » à reconfirmer** : limite de 3 req/60 s et HMAC-SHA256 (annoncés dans les docs revendeur
   Shop2Topup, non relus dans cette session). T03 les vérifie ou les corrige.
6. **Clés (A7)** : aucune clé n'est jamais remise à l'agent **dans un fichier**. Elle vit dans Render
   (Dashboard → Environment) ; pour un test local, le propriétaire l'exporte dans la session du terminal et
   l'agent la lit par `os.environ` uniquement. Aucun `.env` créé, lu ni committé.

---

## 9. Commandes utiles

```bash
# contrôle manuel de la source publique (outil, pas production)
node frontend/scripts/scrape-stock.mjs --list
node frontend/scripts/scrape-stock.mjs --slug pubg-mobile
node frontend/scripts/scrape-stock.mjs --json > /tmp/stock.json

# vérifications frontend
cd frontend && yarn build && yarn test:ci
CHROMIUM_PATH=/chemin/chromium yarn audit:contrast

# backend (lancé par le propriétaire — pas de Mongo ici)
cd backend && pytest tests/test_shop2topup_stock.py tests/test_stock_availability.py \
                      tests/test_availability_sync.py

# pilotage du relevé (variables d'environnement Render ; en local : session du terminal, A7)
STOCK_SYNC_ENABLED=true
STOCK_STALE_MINUTES=60            # fenêtre de fraîcheur de l'état
SHOP2TOPUP_STOCK_SOURCE=jsonld    # ou api (après T03)
TOPUP_PROVIDER_PUBG_MOBILE=shop2topup   # surcharge T16 ; g2bulk = phase finale (T11b)
```

---

## 10. Format du rapport de fin de tâche

- **Fichiers modifiés**
- **Ce qui a changé** (2–3 lignes)
- **Comment c'est vérifié** (commande ou test, avec le résultat — ou « vérification par lecture » pour le
  backend non exécutable ici)
- **Points ouverts**
