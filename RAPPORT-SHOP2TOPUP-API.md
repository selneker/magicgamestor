# RAPPORT-SHOP2TOPUP-API — T03

**Date :** mercredi 18/11/2026 · **Branche :** `feat/shop2topup-bascule` · **Plan :** `plan-shop2topup-v2.md` (§ T03)
**Question unique de T03 :** la réponse catalogue de l'API revendeur expose-t-elle un **état de stock par SKU** ?

> **Statut : partiel — verdict `jsonld` documentaire, non mesuré.** La clé `SHOP2TOPUP_API_KEY` a d'abord été
> absente, puis fournie dans la session du terminal ; les **3 appels authentifiés** tentés le 18/11/2026 ont tous
> été refusés en **`403 IP_NOT_ALLOWED`** car l'allowlist du compte est **vide** (§ 3 bis). Aucun corps de catalogue
> n'a donc été lu. Ce rapport établit la réponse sur la **documentation publique de l'API** (lue intégralement le
> 18/11/2026) et sur **deux relevés réels non concluants** : un `401` sans clé, trois `403` avec clé.

---

## 1. Hypothèses

| # | Détail | Interprétation retenue | Pourquoi |
|---|---|---|---|
| H1 | « stock » | Tout champ booléen ou numérique, publié **par produit**, qui dirait « vendable / en rupture » | C'est ce que `fetch_stock()` doit rendre pour T06 |
| H2 | Documentation = fait ? | La doc est traitée comme **preuve documentaire**, pas comme mesure live | Le plan (C2) interdit de supposer ; une doc peut retarder sur le code |
| H3 | La clé absente, puis fournie | Au premier passage elle était absente : on ne l'a cherchée nulle part, aucun `.env` créé. Au second, elle a été fournie comme variable de session ; elle n'a été ni écrite, ni committée, ni affichée | Consigne du prompt et A7 |
| H4 | Prix | Les prix relevés ici sont des **prix publics** (page boutique), pas le `unit_price` revendeur (ce que MGS paie) | Deux prix différents, la doc le dit explicitement |

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
| `/account`, `/catalog/big-categories`, `/catalog/categories` **avec clé** | **3 appels réels**, 18/11/2026 | HTTP **403 `IP_NOT_ALLOWED`** — voir § 3 bis |

Aucune autre requête n'a été envoyée. La clé n'a été **ni écrite dans un fichier, ni committée, ni affichée** : elle
n'a existé que comme variable d'environnement de la session du terminal.

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

## 3 bis. Relevé authentifié du 18/11/2026 — 3 GET, 3 × `403 IP_NOT_ALLOWED`

Clé fournie par le propriétaire dans la session du terminal (A7), jamais écrite ni affichée. Script : annexe A.
**3 appels sur les 8 autorisés**, 10 s de délai, `User-Agent: MagicGameStore-stock/1.0`, aucun retry, aucun
`POST`/`PUT`/`DELETE`.

| # | Requête | Code HTTP | `error.code` |
|---|---|---|---|
| 1 | `GET /account` | **403** | `IP_NOT_ALLOWED` |
| 2 | `GET /catalog/big-categories` | **403** | `IP_NOT_ALLOWED` |
| 3 | `GET /catalog/categories` | **403** | `IP_NOT_ALLOWED` |

Enveloppe reçue, identique aux trois appels (aucune donnée de compte, aucun solde) :

```json
{"success": false,
 "msg": "No IPs allowed. Configure your IP allowlist first.",
 "code": "IP_NOT_ALLOWED", "action": "FIX_INPUT", "retryable": false, "retry_after": null,
 "error": {"code": "IP_NOT_ALLOWED", "message": "No IPs allowed. Configure your IP allowlist first.",
           "action": "FIX_INPUT", "retryable": false, "retry_after": null}}
```

Aucun en-tête `X-RateLimit-*` sur une réponse 403.

**Ce que ces trois appels prouvent, et ce qu'ils ne prouvent pas :**

| Prouvé | Preuve |
|---|---|
| La clé est **acceptée** : on dépasse le contrôle d'authentification | un refus de clé rendrait `401 MISSING_API_KEY` / `INVALID_API_KEY` (§ 3, mesuré) ; ici la réponse est `403` et nomme un autre contrôle |
| Le format `Bearer <keyId>.<secret>` est le bon | la requête est parvenue à la couche d'autorisation, pas rejetée en amont |
| L'**allowlist est vide**, pas seulement « cette IP n'est pas la bonne » | le message est « **No** IPs allowed. **Configure your IP allowlist first.** » — aucune adresse n'est autorisée, donc **aucune** machine ne peut appeler aujourd'hui, Render compris |
| L'enveloppe d'erreur observée sans clé est la même avec clé | `code`/`msg` à la racine **et** `error{code,message,action,retryable,retry_after}` ; pas de bloc `details` |

| **Non prouvé** | Conséquence |
|---|---|
| La forme réelle des réponses catalogue (donc **l'absence de champ de stock**) | le verdict `jsonld` du § 6 reste **documentaire** : aucun corps de catalogue n'a été lu |
| La limite de débit effective | non atteinte, non observée |
| `item_id` = SKU public | **T04 reste bloquée** |

**Aucun contournement n'a été tenté** (ni changement d'en-tête, ni autre chemin d'accès, ni retry), conformément à A4.
La seule sortie possible est côté propriétaire : configurer l'allowlist, ou lancer le relevé depuis l'IP autorisée.

---

## 4. Ce que l'API expose — route par route (documentation, 18/11/2026)

Base : `https://shop2topup.com/api/endpoints/v1`. Tout est JSON, montants en **chaînes décimales** (`"0.950000"`),
horodatages UTC ISO 8601.

| Route | Méthode | Champs de la réponse | Utilité pour MGS |
|---|---|---|---|
| `/account` | GET | `success`, `account{id, email, username, client_type, wallet, enabled, verified, created_at}` | **T08** : solde du wallet, état du compte avant une série de commandes |
| `/catalog/big-categories` | GET | `id`, `name`, `description` | navigation |
| `/catalog/categories` | GET | `id`, `name`, `description`, `big_category_id`, `big_category_name` | trouver la catégorie PUBG / Free Fire |
| `/catalog/subcategories` | GET | `item_id`, `name`, `description`, `category_id`, `category_name`, **`price`**, `product_type`, `fulfillment_type`, `returns_voucher` | **le catalogue vendable** — et c'est là que le stock **manque** |
| `/catalog/subcategory/{itemId}/price` | GET | `item_id`, `item_name`, **`unit_price`**, `currency`, `original_price`, `discount_applied`, `timestamp` | **T04/T09** : prix revendeur juste avant commande (`expected_unit_price`) |
| `/catalog/category/{categoryId}/requirements` | GET | `field_name`, `data_type`, `placeholder`, `select_options` | **T07** : champs d'identité à collecter (player id, server…) |
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

**Aucun des cinq endpoints catalogue ne publie d'état de stock par produit.** Les champs documentés sont, au
complet : `id`, `item_id`, `name`, `description`, `category_id`, `category_name`, `big_category_id`,
`big_category_name`, `price`, `unit_price`, `currency`, `original_price`, `discount_applied`, `timestamp`,
`product_type`, `fulfillment_type`, `returns_voucher`, plus les champs de formulaire des `requirements`.
Aucun `stock`, `availability`, `in_stock`, `inventory`, `quantity_available`, `sold_out`.

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

## 6. Verdict

> **`jsonld`** — la source de vérité du stock reste la page publique lue par `fetch_stock()` (T02). L'API ne
> sert qu'à **commander** et à **lire le prix revendeur**.

Confiance : **élevée** sur la documentation (les 5 routes catalogue sont listées avec tous leurs champs, et la
limite de débit les compte comme « all five »), **toujours non mesurée** : la clé a été fournie le 18/11/2026 mais
les 3 appels authentifiés ont été refusés en `403 IP_NOT_ALLOWED` (§ 3 bis), avant toute lecture de catalogue. Ce que
ce verdict ne couvre pas : un champ ajouté après la rédaction de la doc — c'est ce qu'un relevé réussi trancherait.

Aucun changement à faire en T02 : `STOCK_SOURCE=jsonld` reste le défaut du plan (§ 9).

---

## 7. Limites de débit réelles — elles corrigent le plan

Le plan (§ 8, question ouverte n° 5) retenait « 3 req/60 s et HMAC-SHA256 », « non relus ». Mesuré dans la doc :

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

## 8. Prix observés le 18/11/2026 (page publique — **pas** le prix revendeur)

Relevé sur `https://shop2topup.com/en` le 18/11/2026. Prix **publics** ; le `unit_price` de l'API (ce que MGS
paie) n'est pas connu sans clé, et la doc ne dit nulle part qu'il égale le prix public.

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
| **T04** | le manifeste se construit sur le **SKU public** (`"13"`, `"14"`…) et sur `supplier_mapping["shop2topup"]`. L'API nomme le même objet `item_id` : **rien ne prouve encore que `item_id` = SKU public**. À vérifier avec la clé **avant** de figer le manifeste — sinon T09 activera des produits qui ne correspondent à rien |
| **T06** | aucun changement de source. La santé du relevé reste `pages_ok`/`pages_failed` |
| **T07** | `is_out_of_stock_error()` doit reconnaître **trois** codes : `OUT_OF_STOCK`, `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE` (§ 5). Lire `error.code` **avec repli sur `code`** (§ 3) |
| **T08** | `GET /account` donne `wallet` → l'alerte de solde bas est réalisable sans scraping. Attention : 60 req/60 s, et `GET /orders/{id}` est limité à 3 req/60 s |
| **T03 (suite)** | relevé authentifié **tenté et bloqué** : 3 × `403 IP_NOT_ALLOWED`, allowlist vide (§ 3 bis). Reprise dès que le propriétaire a autorisé une IP : § 10 |
| **P1 (clé)** | la clé **existe** et est acceptée par l'API ; il manque l'**allowlist**, qui n'est pas un secret mais un réglage du compte revendeur |

---

## 10. Comment terminer T03 (procédure pour le propriétaire)

1. Exporter la clé **dans la session du terminal**, jamais dans un fichier :

   ```bash
   export SHOP2TOPUP_API_KEY='<keyId>.<secret>'
   ```

2. Copier l'annexe A dans un fichier **hors du dépôt** (ex. `/tmp/s2t_probe.py`) et lancer :

   ```bash
   python3 /tmp/s2t_probe.py
   ```

   Le script fait **au plus 6 GET** (compteur bloquant à 15), 10 s de délai, `User-Agent`
   `MagicGameStore-stock/1.0`, aucun retry, aucune écriture, et purge le solde et les identifiants avant
   d'écrire `/tmp/opencode/s2t_api_releve.json`.

3. Reporter dans ce rapport : la date, les codes HTTP obtenus, la liste `champs_de_stock`, et confirmer ou
   infirmer le § 6.

**Si l'appel répond `403 IP_NOT_ALLOWED`** : l'allowlist est le verrou (§ 3 bis — le 18/11/2026 elle était **vide**,
donc aucune machine ne passait, Render compris). Issues acceptables : (a) ajouter l'IP autorisée dans l'allowlist du
compte revendeur, (b) lancer le relevé depuis cette IP. Ne rien contourner.

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
    # navigation sur le corps BRUT : `record["body"]` est purgé, et `id` y devient `<id>`
    raw_categories, _ = probe.get("/catalog/categories")
    items = (raw_categories or {}).get("categories") or []
    target = next(
        (c for c in items if "pubg" in str(c.get("name", "")).lower()),
        items[0] if items else None,
    )
    if target:
        raw_subs, _ = probe.get(f"/catalog/subcategories?categoryId={target['id']}")
        subs = (raw_subs or {}).get("subcategories") or []
        if subs:
            probe.get(f"/catalog/subcategory/{subs[0]['item_id']}/price")
        probe.get(f"/catalog/category/{target['id']}/requirements")

    everything = set()
    for call in probe.calls:
        walk_keys(call["body"], everything)
    stock_fields = sorted(k for k in everything if any(h in k.lower() for h in STOCK_HINTS))

    report = {
        "date": "à dater par le propriétaire",
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
