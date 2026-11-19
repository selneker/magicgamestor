PL-006-T08C-V1 — Checkpoint B préparé, non atteint
===================================================

**Date :** jeudi 19/11/2026 · **Branche :** `feat/shop2topup-bascule` · **Plan :** `plan-shop2topup-v2.md` (§ T07/T08/T16)
**Nature :** rapport d'exécution. **Aucun appel réel** Shop2Topup ou FazerCards n'a été fait, **rien n'a été
fusionné dans `main`**, **aucune clé n'a été lue, écrite ni affichée** (ni `backend/.env` ouvert).

---

## 1. Hypothèses

| # | Hypothèse | Conséquence |
|---|---|---|
| H1 | Le RAPPORT-SHOP2TOPUP-API.md confirme le HMAC-SHA256 sur le **corps brut** (§ 7) mais **ne documente ni le nom d'en-tête, ni le préfixe `sha256=`, ni la forme du corps**. | Ces trois points sont marqués **« À CONFIRMER »** dans `routers/shop2topup_webhook.py:14-31` et `services/order_maintenance.py:466-468`, et listés en points ouverts. Le code reprend l'en-tête et la forme déjà lus par l'adaptateur existant. |
| H2 | Un routeur **dédié** vaut mieux qu'un ajout à `routers/fzr_orders.py`. | `routers/fzr_orders.py` ne contient que des routes admin FazerCards ; un événement Shop2Topup y serait étranger et rouvrirait un module de 369 lignes. Le routeur `shop2topup_webhook.py` rend la frontière explicite ; `server.py` ne fait que l'inclure. |
| H3 | Le dédoublonnage peut réutiliser `fzr_webhook_events`, dont l'index unique `event_id` existe déjà (`core/db.py:89`). | Aucun fichier `core/db.py` modifié (hors autorisation). Les identifiants générés sont préfixés `shop2topup:` pour ne jamais entrer en collision avec FazerCards. |
| H4 | La réconciliation ne doit pas sonder tout l'historique. | Seules les commandes **non `delivered`** portant `fazercards_provider_ids` sont lues (max 500), puis filtrées sur les unités dont le **record** dit `provider == "shop2topup"`. Une commande livrée a toutes ses unités `completed`. |
| H5 | Catégorie 2 et SKU 13 = 60 UC sont les valeurs **mesurées** du rapport (§ 4 et § 5 bis). | Le script fige `CATEGORY_ID = "2"` et `SKU = "13"`, sans deviner d'identifiant fournisseur. |
| H6 | `design-system-v2.html` (non suivi, créé le 19/11 à 07:37, 267 Ko, hors backend) n'est pas de ce lot. | Fichier **non touché, non committé** ; signalé en point ouvert. |

---

## 2. Résumé non-technicien (6 lignes)

1. Le code sait maintenant **demander au fournisseur où en sont les commandes Shop2Topup**, automatiquement, à chaque passage de la maintenance.
2. Il ne regarde **que** les commandes réellement parties chez Shop2Topup ; une commande FazerCards ou une ancienne commande sans fournisseur n'est jamais concernée.
3. Si le fournisseur ne répond pas ou refuse, la tâche **note l'incident et continue** : elle ne bloque ni le cron, ni les autres tâches.
4. Shop2Topup peut aussi **pousser** un changement de statut : une adresse dédiée le reçoit, vérifie une signature, ignore les doublons, puis applique exactement le même traitement que la maintenance.
5. Un petit script permet de faire un **essai à blanc** (aucun réseau, aucun euro) puis, avec un mot explicite, **une seule** commande de test et quelques lectures bornées.
6. Le **Checkpoint B n'est pas atteint** : tout est prêt et testé hors réseau, mais aucune commande réelle n'a été passée — c'est au propriétaire de le faire avec sa clé.

---

## 3. Fichiers et commits

| Commit | Sujet | Fichiers |
|---|---|---|
| `c78dbb6` | réconciliation dans la maintenance | `backend/services/order_maintenance.py`, `backend/tests/test_shop2topup_maintenance.py` |
| `17d93ad` | route webhook dédiée | `backend/routers/shop2topup_webhook.py` (nouveau), `backend/server.py`, `backend/tests/test_shop2topup_webhook.py` (nouveau) |
| `e216dae` | script d'essai Checkpoint B | `backend/scripts/shop2topup_checkpoint_b.py` (nouveau), `backend/tests/test_shop2topup_checkpoint_b.py` (nouveau) |
| `4c07dd0` | correctif : ne pas sonder les commandes livrées | `backend/services/order_maintenance.py`, `backend/tests/test_shop2topup_maintenance.py` |
| *(ce rapport)* | plan + rapport | `plan-shop2topup-v2.md`, `RAPPORT-PL-006-T08C-V1.md` |

**Points d'entrée dans le code :**
- `order_maintenance.py:309` `stored_units()` — lit les 4 formes de records existantes.
- `order_maintenance.py:357` `shop2topup_units()` — filtre sur le fournisseur du **record**.
- `order_maintenance.py:374` `apply_provider_status()` — écrit le statut, réutilise `_signal_refund` et `_sync_mgs_status`.
- `order_maintenance.py:403` `reconcile_shop2topup_units()` — tâche de maintenance, erreurs jamais propagées.
- `order_maintenance.py:462` `apply_shop2topup_event()` — webhook, dédoublonné.
- `order_maintenance.py:526` — branchement dans `run_all()`.
- `routers/shop2topup_webhook.py:35` — `POST /shop2topup/webhook`.
- `server.py:20,80` — import et inclusion du routeur.

---

## 4. Tests

**Procédure PL-006-TEST2-V1 :** MongoDB 4.4.29 temporaire sur `127.0.0.1:27103` (base `mgs_test_t08c`, jamais 27017),
`ADMIN_EMAIL`/`ADMIN_PASSWORD` factices et valides, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` = `127.0.0.1:9`,
`SHOP2TOPUP_API_BASE`/`FAZERCARDS_API_BASE` = `127.0.0.1:9`. Hôte vérifié (`ss -ltn`), mongod arrêté, data dir et
journaux supprimés après coup. Le mongod du poste (27017) n'a pas été touché.

| Module | Tests | Résultat |
|---|---|---|
| `tests/test_shop2topup_adapter.py` | 40 | ✅ 40 réussis |
| `tests/test_identity_provider_resolution.py` | 52 | ✅ 52 réussis |
| `tests/test_shop2topup_maintenance.py` (nouveau) | 10 | ✅ 10 réussis |
| `tests/test_shop2topup_webhook.py` (nouveau) | 6 | ✅ 6 réussis |
| `tests/test_shop2topup_checkpoint_b.py` (nouveau) | 8 | ✅ 8 réussis |
| **Total** | **116** | **✅ 116 réussis / 0 échec** |

Aucun appel réseau : `httpx.MockTransport` pour l'adaptateur et le script, doubles en mémoire pour la base
dans les tests de maintenance/webhook. Un **contrôle d'intégration manuel** sur le MongoDB temporaire a aussi
vérifié le chemin complet : webhook `completed` ⇒ `provider_status = completed` et commande `delivered` ;
puis `reconcile_shop2topup_units()` sur la même unité ⇒ même résultat, une seule unité interrogée.

---

## 5. Variables à connaître et déploiement **sans changer le comportement**

**Résolution du fournisseur de top-up :**
- table `GAME_PROVIDER` : `backend/services/providers/__init__.py:23` — aujourd'hui `pubg-mobile → shop2topup`,
  `free-fire → fazercards` ;
- surcharge par variable : `backend/services/providers/__init__.py:34-39` (`_env_provider`) ;
- précédence : nom explicite > `TOPUP_PROVIDER_<GAME>` > table (`get_provider`, `:42-45`).

**Noms exacts des variables** (le jeu est normalisé : minuscules → majuscules, tout caractère non
alphanumérique → `_`) :

| Jeu | Variable | Valeur pour ne rien changer |
|---|---|---|
| PUBG Mobile (`pubg-mobile`) | `TOPUP_PROVIDER_PUBG_MOBILE` | `fazercards` |
| Free Fire (`free-fire`) | `TOPUP_PROVIDER_FREE_FIRE` | `fazercards` |

**Procédure de déploiement sans changement de comportement :**
1. Dans Render → **Environment**, ajouter les **deux** variables ci-dessus avec la valeur `fazercards`
   (ne pas toucher à `IDENTITY_PROVIDER`, qui vaut déjà `fazercards` : `providers/__init__.py:29`).
2. Déployer la branche. Les nouvelles commandes PUBG Mobile **et** Free Fire continuent de partir chez
   FazerCards ; les unités déjà parties restent réconciliées par le fournisseur inscrit dans leur record.
3. Vérifier dans le shell Render : `get_provider("pubg-mobile").name` et `get_provider("free-fire").name`
   rendent `fazercards`.
4. La bascule réelle se fera **plus tard**, en retirant `TOPUP_PROVIDER_PUBG_MOBILE` (ou en la passant à
   `shop2topup`) puis en redémarrant : une variable, un redémarrage.

**Sans ces deux variables, un déploiement enverrait les nouvelles commandes PUBG chez Shop2Topup**
(c'est la table T08). C'est le seul point à ne pas oublier.

---

## 6. Commande exacte du script

**Essai à blanc (défaut, aucun réseau, aucune clé nécessaire) :**

```bash
cd backend
python scripts/shop2topup_checkpoint_b.py --player-id '<identifiant joueur>'
```

**Appel réel (dépense réelle, clé jamais écrite dans un fichier) :**

```bash
cd backend
read -rs SHOP2TOPUP_API_KEY && export SHOP2TOPUP_API_KEY   # saisie silencieuse, pas d'historique
python scripts/shop2topup_checkpoint_b.py --player-id '<identifiant joueur>' --confirm-spend --probe-batch
unset SHOP2TOPUP_API_KEY
```

- `--zone-id '<zone>'` seulement si le jeu en demande une (jamais inventée).
- Bornes : **1** création (SKU 13 = 60 UC), **≤ 6** lectures de statut, **1** appel de lot avec `--probe-batch`
  (le script affiche le nom du champ d'entrée, `BATCH_REQUEST_KEY = "order_ids"`, **à confirmer**).
- Clé d'idempotence **constante** : un second passage retombe sur la même commande, jamais un second achat.
- Identifiant joueur masqué à moitié ; aucun corps de réponse ni solde affiché ; aucune écriture fichier/base.

---

## 7. Push

Branche **`feat/shop2topup-bascule` uniquement**. Aucun `--force`, aucun push vers `main`. `git status` doit
rester propre hors `graphify-out/` et le fichier non suivi `design-system-v2.html` (voir H6).

---

## 8. Points ouverts

1. **Checkpoint B non atteint** : aucune commande réelle, aucun appel `POST /orders/batch` réel. À faire par
   le propriétaire avec la clé Render, dans l'ordre : essai à blanc → `--confirm-spend` → vérifier la
   réconciliation au passage de maintenance suivant.
2. **À CONFIRMER après le premier webhook réel** : nom d'en-tête (`X-Shop2Topup-Signature`), préfixe
   `sha256=` et forme du corps (`event` / `data.order_id` / `data.status`). Correction localisée :
   `routers/shop2topup_webhook.py:31` et `verify_webhook_signature()` de l'adaptateur.
3. **`BATCH_REQUEST_KEY = "order_ids"`** (entrée de `POST /orders/batch`) n'est pas documenté dans
   `RAPPORT-SHOP2TOPUP-API.md` : une seule constante à corriger si le premier appel réel le refuse.
4. La réconciliation **ne sonde pas** les commandes `delivered` (toutes unités `completed`) pour ne pas
   affamer le budget. Si un remboursement tardif survient après livraison, seul le webhook le signalera.
5. Le dédoublonnage réutilise `fzr_webhook_events` (index existant) : aucune nouvelle collection, mais le
   nom de collection reste historique.
6. `design-system-v2.html` est non suivi, hors périmètre : ni supprimé, ni committé.
