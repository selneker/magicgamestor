# RAPPORT-SHOP2TOPUP-API — T03

**Date :** mercredi 18/11/2026 · **Branche :** `feat/shop2topup-bascule` · **Plan :** `plan-shop2topup-v2.md` (§ T03)
**Question unique de T03 :** la réponse catalogue de l'API revendeur expose-t-elle un **état de stock par SKU** ?

> **Statut : complet et mesuré.** Le 18/11/2026, **11 appels GET authentifiés** ont été envoyés : 3 refusés en
> `403 IP_NOT_ALLOWED` (allowlist alors vide), puis **8 réussis** après ouverture de l'allowlist. Le catalogue réel
> ne contient **aucun champ de stock** sur les **55 offres** lues, et `item_id` = `sku` public (§ 5 bis). Verdict
> `jsonld` **confirmé par la mesure**, plus seulement par la documentation.

---

## 1. Hypothèses

| # | Détail | Interprétation retenue | Pourquoi |
|---|---|---|---|
| H1 | « stock » | Tout champ booléen ou numérique, publié **par produit**, qui dirait « vendable / en rupture » | C'est ce que `fetch_stock()` doit rendre pour T06 |
| H2 | Documentation = fait ? | La doc est traitée comme **preuve documentaire**, pas comme mesure live | Le plan (C2) interdit de supposer ; une doc peut retarder sur le code |
| H3 | La clé absente, puis fournie | Au premier passage elle était absente : on ne l'a cherchée nulle part, aucun `.env` créé. Au second, elle a été fournie comme variable de session ; elle n'a été ni écrite, ni committée, ni affichée | Consigne du prompt et A7 |
| H4 | Prix | Deux prix distincts, tous deux mesurés : `price`/`unit_price` de l'API = ce que **MGS paie** ; le prix de la page publique (JSON-LD) = ce que **le client paie** | La doc le dit et le relevé du 18/11/2026 le confirme (12 : `0.319173` vs `0.35`) |

---

## 2. Comment ce rapport a été obtenu

| Source | Nature | Ce qui en est tiré |
|---|---|---|
| `https://shop2topup.com/en/reseller-api/docs` | doc publique, lue le 18/11/2026 | base URL, authentification, conventions, limites |
| `https://shop2topup.com/en/reseller-api/docs/catalog` | doc publique | les **5** routes catalogue et **tous** leurs champs |
| `https://shop2topup.com/en/reseller-api/docs/account` | doc publique | `GET /account`, allowlist IP, gel de compte |
| `https://shop2topup.com/en/reseller-api/docs/orders` | doc publique | statuts, idempotence, forme des réponses commande |
| `https://shop2topup.com/en/reseller-api/docs/errors` | doc publique | les 43 codes d'erreur, dont ceux de rupture |
| `GET https://shop2topup.com/api/endpoints/v1/account` **sans en-tête** | **appel réel**, 18/11/2026 | HTTP **401** — voir § 3 |
| `/account`, `/catalog/big-categories`, `/catalog/categories` **avec clé, allowlist vide** | **3 appels réels**, 18/11/2026 | HTTP **403 `IP_NOT_ALLOWED`** — voir § 3 bis |
| `/catalog/big-categories`, `/catalog/categories`, `/catalog/subcategories?categoryId=2`, `/catalog/subcategory/12/price`, `/catalog/category/2/requirements`, `/catalog/categories` (relue), `/catalog/subcategories?categoryId=4` **avec clé, allowlist ouverte** | **8 appels réels**, 18/11/2026 | HTTP **200** — voir § 3 bis et § 5 bis |

Aucune autre requête n'a été envoyée : **11 GET au total** (3 + 8), jamais plus de 8 par session, aucun
`POST`/`PUT`/`DELETE`. La clé n'a été **ni écrite dans un fichier, ni committée, ni affichée** : elle n'a existé que
comme variable d'environnement de la session du terminal.

---

## 3. Authentification (documentée **et** observée)

```text
Authorization: Bearer <keyId>.<secret>
```

- Le `keyId` sélectionne le compte, le `secret` est comparé par **HMAC** ; échec ⇒ `401` `MISSING_API_KEY` /
  `INVALID_API_KEY`, **avant** l'exécution de la route.
- **Allowlist IP** : si la clé est restreinte, toute autre adresse est refusée `403 IP_NOT_ALLOWED`, **avant**
  la limite de débit et avant même la lecture du wallet. *Conséquence directe pour ce chantier : une clé épinglée
  sur l'IP de Render répondra `IP_NOT_ALLOWED` depuis n'importe quelle autre machine, y compris la mienne.*
- Compte gelé ⇒ `403 ACCOUNT_FROZEN` sur **tous** les endpoints ; ne se débloque pas seul.
- Aucune rotation automatique : le secret n'est affiché qu'une fois à la création.
- En-têtes inspectés : **uniquement** `Authorization` — ni cookie, ni CSRF, ni `Origin`.

**Appel réel, sans clé (le seul de cette session) :**

```text
GET https://shop2topup.com/api/endpoints/v1/account
→ HTTP 401
{"success":false,"msg":"Missing Authorization header","code":"MISSING_API_KEY",
 "action":"FIX_INPUT","retryable":false,"retry_after":null,
 "error":{"code":"MISSING_API_KEY","message":"Missing Authorization header",
          "action":"FIX_INPUT","retryable":false,"retry_after":null}}
```

Deux enseignements : l'API **répond** à cette machine (pas d'anti-bot — le risque A4 concerne la page publique,
pas l'API), et l'enveloppe réelle porte le code **deux fois** (à la racine en `code`/`msg`, et dans `error.code`)
sans le bloc `details` montré par la doc. **T07 doit lire `error.code` avec repli sur `code`.**

---

## 3 bis. Relevé authentifié du 18/11/2026 — 11 GET, deux sessions (3 refusés, 8 réussis)

Clé lue **uniquement** depuis `os.environ` (A7), jamais écrite ni affichée. `GET` seulement, 10 s par appel,
`User-Agent: MagicGameStore-stock/1.0`, aucun retry. **11 appels réels au total, jamais plus de 8 par session**,
aucune écriture.

| Passage | Appels | Résultat | Cause |
|---|---|---|---|
| T03b | 3 | `403` ×3 `IP_NOT_ALLOWED` | allowlist du compte **vide** : « No IPs allowed. Configure your IP allowlist first. » |
| T03c, 1er essai | 3 | **`200` ×3** | arrêt volontaire du script : il lisait `body["categories"]` au lieu de `data` (§ ci-dessous) |
| T03c, 2e essai | 5 | **`200` ×5** | 4 appels du script corrigé + 1 `?categoryId=4` — mesures ci-dessous |

Enveloppe du passage T03b, identique aux trois appels (aucune donnée de compte, aucun solde) :

```json
{"success": false,
 "msg": "No IPs allowed. Configure your IP allowlist first.",
 "code": "IP_NOT_ALLOWED", "action": "FIX_INPUT", "retryable": false, "retry_after": null,
 "error": {"code": "IP_NOT_ALLOWED", "message": "No IPs allowed. Configure your IP allowlist first.",
           "action": "FIX_INPUT", "retryable": false, "retry_after": null}}
```

Aucun en-tête `X-RateLimit-*` sur une réponse 403. L'enveloppe d'erreur est celle du § 3 : `code`/`msg` à la
racine **et** `error{code, message, action, retryable, retry_after}`, sans bloc `details`.

### Forme réelle des réponses — un écart qui compte

Chaque réponse porte `{"success": true, "data": …}` (ou `account`) : la charge est sous **`data`**, jamais sous
`categories` / `subcategories`. Un consommateur qui lit `body["categories"]` reçoit `[]` et conclut à tort que le
catalogue est vide — c'est exactement ce qui a arrêté le premier essai de T03c après trois appels. **T07 et T08
doivent lire `data`.**

| Route (T03c) | Forme mesurée — champs réels | `X-RateLimit-Limit` |
|---|---|---|
| `GET /account` | `{success, account:{email, wallet}}` — **2** champs, pas les 8 documentés | **60** |
| `GET /catalog/big-categories` | `{success, data:[{id, name, description}]}` | 5000 |
| `GET /catalog/categories` | `{success, data:[{id, name, description, big_category_id, big_category_name, region_ids[], country_ids[], requirements{}}]}` — **290** entrées | 5000 |
| `GET /catalog/subcategories?categoryId=2` | `{success, data:[{id, item_id, name, description, category_id, category_name, fulfillment_type, returns_voucher, product_type, conditions, price}]}` — **34** entrées | 5000 |
| `GET /catalog/subcategories?categoryId=4` | même forme, **21** entrées | 5000 |
| `GET /catalog/subcategory/12/price` | `{success, data:{item_id, item_name, unit_price, currency, original_price, discount_applied, pricing_level_id, timestamp}}` | 5000 |
| `GET /catalog/category/2/requirements` | `{success, data:[{field_name, data_type, placeholder}]}` — **`player_id` seul** | 5000 |

Deux champs que la doc ne met pas en avant : `conditions` (objet, **vide sur les 55 offres lues**) et, côté
catégorie, `region_ids` / `country_ids` / `requirements`.

**Prix revendeur observés le 18/11/2026 14:25 UTC** — `unit_price` = ce que MGS paie, distinct du prix public :

| `item_id` | Nom | `unit_price` | Prix public (JSON-LD) |
|---|---|---|---|
| 12 | 10 UC | `0.319173` | `0.35` |
| 28 | 100 + 10 Diamonds | `0.93558` | `0.97` |
| 29 | 210 + 21 Diamonds | `1.9158` | — |
| 30 | 530 + 53 Diamonds | `4.6872` | — |
| 31 | 1 080 + 108 Diamonds | `9.3744` | — |

### Ce que ces appels prouvent

| Prouvé | Preuve |
|---|---|
| La clé est acceptée, l'allowlist ouverte | `200` sur les **8 appels réussis** de T03c (7 routes distinctes) |
| L'**absence de champ de stock** est mesurée, pas déduite | 11 champs par offre, `champs_de_stock = AUCUN` sur **55** offres (34 PUBG + 21 Free Fire), deux catégories |
| Un « stock » n'est pas caché sous `conditions` | `conditions = {}` sur 55/55 |
| Le catalogue est complet et cohérent avec la page publique | 34 offres PUBG côté API ↔ 34 JSON-LD ; 21 ↔ 21 pour Free Fire MENA |
| Les limites de débit du § 7 | `X-RateLimit-Limit` relevé sur chaque réponse |
| `item_id` = SKU public | § 5 bis |

| **Resté non prouvé** | Conséquence |
|---|---|
| La rupture **à l'avance**, quelle qu'elle soit | inconnaissable avant la commande (§ 5) |
| Le comportement de `POST /orders/create` | hors T03, jamais appelé |

**Aucun contournement n'a été tenté**, ni pendant le passage refusé en `403` ni après : pas de changement d'en-tête,
pas d'autre chemin d'accès, pas de retry.

---

## 4. Ce que l'API expose — route par route (documentation, **confrontée au relevé** du 18/11/2026)

Base : `https://shop2topup.com/api/endpoints/v1`. Tout est JSON, montants en **chaînes décimales** (`"0.950000"`),
horodatages UTC ISO 8601. Chaque réponse enveloppe sa charge dans **`data`** (§ 3 bis) — la colonne « champs » ci-dessous
liste ce que contient `data`, pas la racine.

| Route | Méthode | Champs de la réponse | Utilité pour MGS |
|---|---|---|---|
| `/account` | GET | **mesuré** : `success`, `account{email, wallet}` — la doc annonce 8 champs, 2 seulement sont rendus | **T08** : solde du wallet, état du compte avant une série de commandes |
| `/catalog/big-categories` | GET | `id`, `name`, `description` | navigation |
| `/catalog/categories` | GET | `id`, `name`, `description`, `big_category_id`, `big_category_name`, **`region_ids[]`**, **`country_ids[{id, code, name}]`**, **`requirements{}`** — **290** catégories | trouver la catégorie PUBG / Free Fire |
| `/catalog/subcategories` | GET | **mesuré, 34 offres (PUBG) / 21 (Free Fire)** : `id`, `item_id`, `name`, `description`, `category_id`, `category_name`, **`price`**, `product_type`, `fulfillment_type`, `returns_voucher`, `conditions` | **le catalogue vendable** — et c'est là que le stock **manque** |
| `/catalog/subcategory/{itemId}/price` | GET | `item_id`, `item_name`, **`unit_price`**, `currency`, `original_price`, `discount_applied`, `timestamp` | **T04/T09** : prix revendeur juste avant commande (`expected_unit_price`) |
| `/catalog/category/{categoryId}/requirements` | GET | `field_name`, `data_type`, `placeholder`, `select_options` — **mesuré sur PUBG Mobile Direct Topup : `player_id` seul** (`text`, « Enter player ID »), aucun champ serveur | **T07** : champs d'identité à collecter |
| `/player/validate` | POST | — | **hors T03**, jamais appelé (écrit / consomme un quota) |
| `/orders/create` | POST | `order{order_id, status, player_id, player_name, subcategory_name, quantity, charged_amount, currency, created_at}` | **hors T03**, jamais appelé |
| `/orders/{orderId}` | GET | idem + `completed_at`, `vouchers[]`, `sub_transactions[]` | **T08** : statut par commande (3 req/60 s) |
| `/orders/batch` | POST | `orders[]`, `not_found[]` | statut en lot (jusqu'à 50) |
| `/orders` | GET | `orders[]` + `pagination{page, limit, total, total_pages}` | réconciliation |

Notes de la doc, utiles plus tard :

- `product_type` = `topup` (livraison sur compte joueur) ou `voucher` (code). `fulfillment_type` et
  `returns_voucher` sont **dépréciés** et ne font que répéter `product_type`.
- `price` (liste) et `unit_price` (prix) sont les montants **facturés au revendeur**.
- Une liste sans prix (`prices_locked: true`) signale un compte jamais rechargé au-delà de ses 7 premiers jours,
  et `GET /catalog/subcategory/{id}/price` répond alors `403 RELOAD_REQUIRED`.
- Statuts de commande : `pending`, `completed`, `refunded`, `partial`.

---

## 5. Ce que l'API **n'expose pas** — la réponse à T03

**Aucun des cinq endpoints catalogue ne publie d'état de stock par produit — c'est mesuré, plus seulement
documenté.** Relevé du 18/11/2026 (§ 3 bis) : `champs_de_stock = AUCUN` sur **55 offres** réelles (34 PUBG Mobile
Direct Topup + 21 Free Fire MENA Direct Topup), 11 champs par offre. Les champs observés sont, au complet :
`id`, `item_id`, `name`, `description`, `category_id`, `category_name`, `fulfillment_type`, `returns_voucher`,
`product_type`, `conditions`, `price` (plus `unit_price`/`currency`/`original_price`/`discount_applied`/`timestamp`
sur la route prix). Aucun `stock`, `availability`, `in_stock`, `inventory`, `quantity_available`, `sold_out`, et
`conditions` — le seul objet libre — est **vide sur 55/55**.

La rupture n'est connaissable qu'**au moment de commander**, par un code d'erreur — jamais à l'avance :

| Code | HTTP | Sens | `retryable` |
|---|---|---|---|
| `OUT_OF_STOCK` | 400 | produit en rupture **maintenant** | oui |
| `INSUFFICIENT_STOCK` | 400 | moins d'unités que demandé ; `error.max_quantity` donne le disponible | non (baisser la quantité) |
| `PRODUCT_UNAVAILABLE` | 409 | produit existant mais non vendable à cet instant | oui |
| `PRICING_UPDATING` | 409 | prix en cours de rafraîchissement | oui (30 s) |
| `PRICE_INCREASED` | 400 | `current_unit_price` > `expected_unit_price` | non |

**Conséquence : « l'API donne le prix ET le stock par SKU » (prémisse C2 du v1) est faux pour le stock.** Le prix,
oui ; le stock, non. Un test de disponibilité par l'API coûterait une **commande** par SKU — inacceptable.

---

## 5 bis. `item_id` (API) = `sku` public — **prouvé le 18/11/2026** *(débloque T04)*

T04 ne pouvait pas figer le manifeste sans savoir si l'`item_id` de l'API désigne le même objet que le `sku` du
JSON-LD public. **C'est le même identifiant**, même numérotation, même cardinalité, sur deux catégories
indépendantes :

| Catégorie API | Côté API (`/catalog/subcategories`) | Côté public (JSON-LD de la page) | Concordance |
|---|---|---|---|
| `categoryId=2` « Direct Topup / PUBG Mobile » | **34** offres ; `item_id` 12 = « 10 UC » | **34** offres ; `sku` 12 = « 10 UC » et c'est la **seule `OutOfStock`** (`backend/tests/fixtures/shop2topup/README.md:8`) | identique |
| `categoryId=4` « Mena Direct Topup / Free Fire » | **21** offres ; `item_id` 28 = « 100 + 10 Diamonds » | **21** offres ; `sku` 28 = « 100 + 10 Diamonds » (`free-fire-mena-direct-topup.html:21`) | identique |

Points de contrôle supplémentaires, tous concordants :

- sur chaque ligne, **`id` = `item_id`** — l'identifiant d'offre et l'identifiant vendable ne divergent pas ;
- la suite PUBG se suit des deux côtés : 12 → « 10 UC », 13 → « 60 UC », 14 → « 300 + 25 UC », 15 → « 600 + 60 UC »
  (les six couples de § 2.4 du plan tombent donc sur les mêmes numéros) ;
- le `sku` de **page** (`Product.sku` du JSON-LD, ex. `"4"` pour Free Fire MENA) est égal au **`categoryId`** de
  l'API — utile pour retrouver une catégorie depuis une URL, sans table de correspondance.

**Ce que T04 peut donc écrire** : `supplier_mapping["shop2topup"]["sku"]` = `item_id` de l'API = `sku` du JSON-LD.
L'identité est la même des deux côtés de la frontière `fetch_stock()`, et le relevé public de T02 reste valable tel
quel pour les commandes.

**Ce que cela ne prouve pas** : que le prix soit stable entre la lecture et la commande — c'est le rôle de
`expected_unit_price` (T09).

---

## 6. Verdict

> **`jsonld`** — la source de vérité du stock reste la page publique lue par `fetch_stock()` (T02). L'API ne
> sert qu'à **commander** et à **lire le prix revendeur**.

Confiance : **élevée, et cette fois mesurée.** La documentation annonçait l'absence de stock ; le relevé du
18/11/2026 la confirme sur 55 offres réelles, deux catégories, sans champ caché (`conditions` vide partout). Ce que
ce verdict ne couvre pas : un ajout de champ postérieur au relevé, et le comportement de `POST /orders/create`, qui
n'a pas été appelé (hors T03).

Aucun changement à faire en T02 : `STOCK_SOURCE=jsonld` reste le défaut du plan (§ 9).

---

## 7. Limites de débit réelles — elles corrigent le plan

Le plan (§ 8, question ouverte n° 5) retenait « 3 req/60 s et HMAC-SHA256 », « non relus ». Lu dans la doc **et
confirmé sur le fil le 18/11/2026** : chaque réponse porte `X-RateLimit-Limit`, relevé à **5000** sur les routes
catalogue et **60** sur `/account` (§ 3 bis).

| Route | Limite | Fenêtre | Comptée par |
|---|---|---|---|
| `GET /catalog/*` (les 5) | **5000** | 60 s | compte |
| `POST /orders/create` | 5000 | 60 s | compte |
| `GET /orders/{orderId}` | **3** | 60 s | compte **+ `order_id`** |
| `POST /orders/batch` | 2 | 60 s | compte |
| `GET /orders` | 2 | 60 s | compte |
| `GET /account` | 60 | 60 s | compte |
| `POST /player/validate` | quota **journalier** de vérifications joueur | 24 h | compte (aucun en-tête `X-RateLimit`) |

- Les 3 req/60 s du plan concernent **une seule commande**, pas le catalogue : un polling de statut par commande
  est donc très contraint, alors que le catalogue est large.
- En-têtes renvoyés : `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` ; `429` avec `Retry-After`.
- **HMAC-SHA256 confirmé**, mais pour les **webhooks** : signature du corps brut d'un événement de commande
  poussé vers une URL HTTPS déclarée. Ce n'est pas l'authentification des appels sortants (celle-ci est un simple
  Bearer).

---

## 8. Prix **publics** observés le 18/11/2026 — distincts du prix revendeur

Relevé sur `https://shop2topup.com/en` le 18/11/2026. Prix **publics** (ce que le client paie), à ne pas confondre
avec le `unit_price` de l'API (ce que MGS paie), lui aussi mesuré le même jour sur 5 offres (§ 3 bis). Les deux
séries ne se déduisent pas l'une de l'autre : l'écart mesuré va de **3,7 %** (`item_id` 28 : `0.93558` payé,
`0.97` public) à **9,7 %** (`item_id` 12 : `0.319173` payé, `0.35` public).

| Produit annoncé | Prix public |
|---|---|
| Direct Topup 60 UC | $0.99 |
| Direct Topup 300 + 25 UC | $4.96 |
| Direct Topup 600 + 60 UC | $9.92 |
| Direct Topup 1 500 + 300 UC | $24.80 |
| Direct Topup 325 WOW Coins | $4.95 |
| Direct Topup 660 WOW Coins | $9.90 |
| Direct Topup First Purchase Pack | $0.92 |

Ces valeurs sont **cohérentes avec les mesures du plan § 2.3** (écarts de 1 à 2 cents sur 4,95/9,90, dus à un
relevé à un autre moment) : le plan n'a pas à être « corrigé », il a été mesuré le même jour à quelques minutes
d'écart. À noter pour T04/T09 : aucun prix n'est reporté dans le plan comme engagement — ils restent des
observations datées.

---

## 9. Impact sur les tâches suivantes

| Tâche | Impact |
|---|---|
| **T02** | aucun. `fetch_stock()` reste la source ; `STOCK_SOURCE=jsonld` |
| **T04** | **débloquée** : `item_id` (API) = `sku` (JSON-LD public), prouvé sur deux catégories (§ 5 bis). Le manifeste peut porter `sku` = `item_id` sans risque de désigner un autre objet. Reste à valider **la liste** des six couples, pas l'identité |
| **T06** | aucun changement de source. La santé du relevé reste `pages_ok`/`pages_failed` |
| **T07** | `is_out_of_stock_error()` doit reconnaître **trois** codes : `OUT_OF_STOCK`, `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE` (§ 5). Lire `error.code` **avec repli sur `code`** (§ 3), et **`data`** pour la charge utile (§ 3 bis). Identité joueur : `player_id` seul pour PUBG Mobile Direct Topup — pas de champ serveur |
| **T08** | `GET /account` donne `wallet` → l'alerte de solde bas est réalisable sans scraping, **mais l'objet `account` ne rend que `email` et `wallet`** (2 champs mesurés, pas 8). `GET /orders/{id}` reste limité à 3 req/60 s ; les routes catalogue sont à 5000/60 s toutes réponses confondues |
| **T03** | **terminée et mesurée** le 18/11/2026 : 11 GET (3 refusés, 8 réussis), verdict `jsonld` confirmé, `item_id` = `sku` (§ 5 bis) |
| **P1 (clé)** | la clé est acceptée et l'allowlist est ouverte. Reste à savoir **quelle IP** y est autorisée : si c'est celle de Render, la production passera et une machine locale non — le champ `IP_NOT_ALLOWED` ne dit pas laquelle |

---

## 10. Refaire un relevé (procédure — **déjà exécutée le 18/11/2026**)

1. Exporter la clé **dans la session du terminal**, jamais dans un fichier :

   ```bash
   export SHOP2TOPUP_API_KEY='<keyId>.<secret>'
   ```

2. Copier l'annexe A dans un fichier **hors du dépôt** (ex. `/tmp/opencode/s2t_probe.py`) et lancer :

   ```bash
   python3 /tmp/opencode/s2t_probe.py
   ```

   Le script fait **au plus 6 GET** (compteur bloquant à 15), 10 s de délai, `User-Agent`
   `MagicGameStore-stock/1.0`, aucun retry, aucune écriture, et purge le solde et les identifiants avant
   d'écrire `/tmp/opencode/s2t_api_releve.json`.

3. Reporter dans ce rapport : la date, les codes HTTP obtenus, la liste `champs_de_stock`, et confirmer ou
   infirmer le § 6.

**Si l'appel répond `403 IP_NOT_ALLOWED`** : c'est l'allowlist qui bloque (§ 3 bis — elle était **vide** au premier
passage, donc aucune machine ne passait, Render compris). Issues acceptables : (a) ajouter l'IP autorisée dans
l'allowlist du compte revendeur, (b) lancer le relevé depuis cette IP. Ne rien contourner.

**Piège rencontré** : la charge utile est sous **`data`**, pas sous `categories`/`subcategories` (§ 3 bis). Un script
qui lit `body["categories"]` s'arrête après trois appels en croyant le catalogue vide. L'annexe A est corrigée.

---

## Annexe A — script de relevé (à copier hors du dépôt, **non committé**)

```python
"""T03 — relevé LECTURE SEULE de l'API revendeur Shop2Topup. stdlib seulement."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://shop2topup.com/api/endpoints/v1"
USER_AGENT = "MagicGameStore-stock/1.0"
TIMEOUT_S = 10.0
MAX_CALLS = 15
OUT = "/tmp/opencode/s2t_api_releve.json"

MASK = {"wallet": "<balance>", "email": "<email>", "username": "<username>", "id": "<id>"}
STOCK_HINTS = ("stock", "availab", "inventory", "quantity", "dispo")


def redact(value, key=None):
    if key in MASK:
        return MASK[key]
    if isinstance(value, dict):
        return {k: redact(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def walk_keys(value, acc):
    if isinstance(value, dict):
        for k, v in value.items():
            acc.add(k)
            walk_keys(v, acc)
    elif isinstance(value, list):
        for v in value:
            walk_keys(v, acc)


class Probe:
    def __init__(self, key: str) -> None:
        self.key = key
        self.calls: list[dict] = []

    def get(self, path: str):
        if len(self.calls) >= MAX_CALLS:
            raise SystemExit(f"budget de {MAX_CALLS} appels épuisé, arrêt")
        request = urllib.request.Request(
            f"{BASE}{path}",
            headers={"Authorization": f"Bearer {self.key}", "User-Agent": USER_AGENT},
            method="GET",
        )
        record = {"path": path, "status": None, "body": None, "rate_limit": {}}
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                raw = response.read().decode("utf-8", "replace")
                record["status"] = response.status
                for header in ("X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"):
                    if response.headers.get(header):
                        record["rate_limit"][header] = response.headers[header]
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            record["status"] = exc.code
        except Exception as exc:
            record["status"] = f"ÉCHEC {type(exc).__name__}"
            self.calls.append(record)
            return None, record
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"_non_json": raw[:400]}
        record["body"] = redact(body)
        self.calls.append(record)
        return body, record


def main() -> int:
    key = os.environ.get("SHOP2TOPUP_API_KEY", "").strip()
    if not key:
        print("SHOP2TOPUP_API_KEY absente de la session : rien n'est appelé.", file=sys.stderr)
        return 2

    probe = Probe(key)
    probe.get("/account")
    probe.get("/catalog/big-categories")
    # navigation sur le corps BRUT : `record["body"]` est purgé, et `id` y devient `<id>`.
    # La charge utile est sous `data`, jamais sous `categories` / `subcategories`.
    raw_categories, _ = probe.get("/catalog/categories")
    items = (raw_categories or {}).get("data") or []
    target = next(
        (c for c in items if "pubg" in str(c.get("name", "")).lower()),
        items[0] if items else None,
    )
    if target:
        raw_subs, _ = probe.get(f"/catalog/subcategories?categoryId={target['id']}")
        subs = (raw_subs or {}).get("data") or []
        if subs:
            probe.get(f"/catalog/subcategory/{subs[0]['item_id']}/price")
        probe.get(f"/catalog/category/{target['id']}/requirements")

    everything = set()
    for call in probe.calls:
        walk_keys(call["body"], everything)
    stock_fields = sorted(k for k in everything if any(h in k.lower() for h in STOCK_HINTS))

    report = {
        "date": "2026-11-18",
        "base": BASE,
        "appels": probe.calls,
        "champs_vus": sorted(everything),
        "champs_de_stock": stock_fields,
        "verdict_candidat": "api" if stock_fields else "jsonld",
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)

    print(f"{len(probe.calls)} appel(s) GET, sortie purgée dans {OUT}")
    print(f"champs de stock vus : {stock_fields or 'AUCUN'}")
    for call in probe.calls:
        print(f"  {call['status']}  GET {call['path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```
