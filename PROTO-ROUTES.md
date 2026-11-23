# PROTO-ROUTES — routes backend utiles au prototype (Z3 → Z6)

Aide à l'implémentation pour l'agent qui possède `frontend/public/index.html`.
**Lecture seule** : ce document ne change ni le backend, ni le design, ni le prototype.
Il ne remplace pas `PORTAGE.md` (suivi des zones) : il donne les **URL exactes, les corps
de requête, les réponses et les codes d'erreur** des routes marquées « à vérifier » dans
son tableau des champs.

Sources : `backend/routers/*.py` et `backend/services/*.py` sur `feat/proto-fonctionnel`
(identique à `main` pour ces routes), plus `main:frontend/src/pages/Checkout.js`,
`main:frontend/src/pages/OrderTrack.js`, `main:frontend/src/pages/Account.js`.

---

## 0. Conventions

- Base : `window.MGS_BACKEND_URL` (défaut `https://magicgamestore-api-v2.onrender.com`),
  préfixe `/api` — déjà géré par `req()` (`index.html:3511-3512`).
- Cookies HttpOnly : `credentials: "include"` (déjà dans `req()`).
- Colonne **Auth** : `public` = sans compte, `optionnel` = `get_optional_user` (le porteur
  de l'UUID de commande suffit), `oui` = `get_current_user` (401 sinon), `admin` = hors
  périmètre du prototype.
- Erreurs FastAPI : `422` = corps invalide (Pydantic) ; `400/403/404/409/429/503` =
  règles métier ; `detail` est soit une **chaîne**, soit un **objet** `{code, message}`
  (preuve et annulation, voir §1.8/§1.9/§1.10). **SAUF** `product_unavailable` (§1.2) :
  le code est au TOP LEVEL du corps avec `product_ids`, pas dans `detail`.
- `POST` renvoie `201` quand la route est déclarée `status_code=201` (commande,
  échange de points, transfert, message de chat).

---

## 1. Z3 — Paiement

### 1.1 `GET /payments/config` — public

`backend/routers/payments.py:194`

```json
{
  "mode": "papi|fiveone", "gateway": "papi|fiveone", "live": true,
  "papi_auto": true, "fiveone_enabled": false, "auto_payment": true,
  "payment_fees": {}, "manual_only": false, "timeout_minutes": 30,
  "providers": {
    "mvola":  { "configured": true, "merchant": "…", "name": "…" },
    "orange": { "configured": true, "merchant": "…", "name": "…" }
  }
}
```

`manual_only` = vrai quand aucun paiement automatique n'est configuré. `providers.*.merchant`
et `.name` sont les valeurs à afficher pour le paiement manuel.

### 1.2 `POST /orders` — optionnel (+ captcha si configuré) → `201`

`backend/routers/orders.py:315`, corps `OrderIn` (`:64-122`).

| Champ | Type / contrainte | Remarque |
|---|---|---|
| `pubg_id` | string, non vide | **toujours** envoyé, même jeu dynamique |
| `identity_fields` | objet 1..10 clés string | `{"player_id":"…"}` ou `{"zone_id":"…","player_id":"…"}` |
| `pseudo` | 2..40 | |
| `items` | 1..20 × `{product_id, quantity 1..20}` | |
| `payment_method` | `mvola\|orange\|manual\|binance` | `main` envoie **`manual`** + `manual_operator` (`Checkout.js:140-141`) |
| `manual_operator` | `mvola\|orange` | ignoré si `payment_method != "manual"` |
| `payment_phone` | ≥ 10 chiffres | **requis** si `payment_method` ∈ `mvola\|orange` |
| `manual_reference` | ≤ 60 | facultatif |
| `email` | string | facultatif |
| `game_id` | défaut `pubg-mobile` | |
| `identity_id` | ≤ 60 | identité sauvegardée du compte |
| `captcha_token` | ≤ 4096 | **omis** si `MGS_CAPTCHA.enabled()` est faux |

Réponse `201` : `public_order(order)` (`:155-168`) — champs stables garantis :
`payment_deadline_at` (null si absent), `payment_proofs` (`[]`), `manual_operator` (null).

Erreurs : `400` jeu inconnu / produits indisponibles / téléphone manquant ;
`409` jeu non vendable, PAPI coupé, Binance indisponible, achat bloqué fournisseur ;
`409 {code:"product_unavailable", product_ids:[…]}` quand le stock a changé
(`:355-361`) ; `422` validation.

### 1.3 `GET /crypto/config` — public

`backend/routers/crypto.py:107` → `{available, currency:"USDT", expiry_minutes, networks:[{key,label,memo_required}]}`
(`backend/services/crypto.py:58-62`). `networks` est vide si `available` est faux.

### 1.4 `POST /crypto/initiate` — optionnel

`backend/routers/crypto.py:112`, corps `{order_id, network}` avec
`network ∈ TRC20|BEP20|APTOS|TON` (`:15`). Réponse = paiement (`services/crypto.py:82-96`) :
`id, order_id, order_number, network, binance_network, currency, address, memo,
rate_ar_per_usdt, amount_ar, base_usdt, amount_usdt, status, tx_hash, created_at, expires_at`.
`amount_usdt` est le **montant exact** à envoyer (pas `base_usdt`).

Erreurs : `400` commande non-Binance / réseau indisponible ; `409` commande plus en attente /
paiement déjà ouvert sur un autre réseau / Binance indisponible ; `503` saturation.

### 1.5 `GET /crypto/{order_id}/status` — optionnel

`:123` → `{order_status, payment}` (`_status_payload` `:48-51`). `payment` = même objet que
§1.4, `null` s'il n'y a pas encore de paiement. `POST /crypto/{order_id}/paid` (`:130`)
renvoie la même forme et pose `customer_declared_paid_at`.

### 1.6 `POST /payments/initiate` — optionnel (MVola/Orange automatique)

`backend/routers/payments.py:214`, corps `{order_id}`. Réservé aux commandes
`payment_method ∈ mvola|orange` ; le prototype ne crée que `manual`/`binance` → non
déclenchable (déjà noté dans `PORTAGE.md`). `400` méthode non API ; `409` PAPI coupé.

### 1.7 `GET /payments/{order_id}/status` — optionnel

`:294` → `{payment_status, order_status, order_number, payment_url, simulated,
expires_at, attempt_no, client_ref}`. `payment_url` vaut `null` hors `pending`.
`404` aucun paiement ; `403` commande d'un autre compte.

### 1.8 `POST /orders/{order_id}/proof` — optionnel, `multipart/form-data`

`backend/routers/orders.py:501`. Champ fichier : **`files`** (1 à 3 images JPEG/PNG réelles,
`services/proofs.py:41` (`MAX_FILES = 3`)). Réponse `200` :

```json
{ "ok": true, "status": "proof_submitted", "payment_deadline_at": null, "proofs": [ … ] }
```

**Ne pas tester `r.id`** : cette réponse n'a pas d'`id` de commande. Rafraîchir l'écran
depuis ces champs (`status`, `proofs`) ou relire `GET /orders/{id}`.

Erreurs `409` avec `detail = {code, message}` (`_proof_error` `:476-484`) :
`proof_not_allowed` (commande non manuelle), `proof_not_pending`, `proof_already_validated`,
`proof_deadline_passed`, `proof_count`, `proof_limit`, `proof_conflict`, `proof_too_large`,
`proof_format`.
`503` stockage/quota indisponible. `429` limite d'envois.

### 1.9 `POST /orders/{order_id}/remind` — optionnel

`:615`. Réponse `{ok, reminders_left, remaining_seconds, next_at}`.
`409 {code}` : `remind_not_pending`, `remind_already_processed`, `remind_conflict` ;
`429 {code}` : `remind_limit`, `remind_cooldown` (+ `remaining_seconds`, `reminders_left`).
Cooldown 180 s, maximum 3 (`:627-628`).

### 1.10 `POST /orders/{order_id}/cancel` — optionnel

`:680`, corps `CancelIn` (`:124-128`) : `reason` **obligatoire** parmi
`wrong_info|change_method|too_short|cannot_pay_now|other`, `note` ≤ 200 facultatif.
Réponse `200` `{ok:true, status:"cancelled"}` (idempotent si déjà annulée par le client).
`409 detail = {code:"cancel_not_allowed", message}` sinon ; codes supplémentaires
`cancel_proof_sent`, `cancel_paid`, `cancel_conflict` ; `429` rate limit.

### 1.11 `POST /fazercards/validate-id` — public

`backend/routers/fazercards.py:118`, corps `{game_id, fields}` (`fields` 1..10 clés string,
au moins une valeur non vide). Réponse `{valid: bool, message?: string, …}` ;
`valid:false` = format refusé **avant** le fournisseur ; `404` jeu inconnu ; `503` jeu sans
cible de validation ; `429` limite.

### 1.12 Identités joueur sauvegardées — oui

`backend/routers/games.py:103-152` (`PUBLIC` = sans `_id`).

| Méthode | Chemin | Corps | Réponse |
|---|---|---|---|
| `GET` | `/me/game-identities?game_id=` | — | liste |
| `POST` | `/me/game-identities` → `201` | `{game_id, label 1..40, fields}` | identité créée |
| `PATCH` | `/me/game-identities/{id}` | `{label?, fields?}` | identité à jour |
| `DELETE` | `/me/game-identities/{id}` | — | `{ok:true}` |

Objet : `{id, user_id, game_id, label, fields, validated, validated_at, created_at, updated_at}`.
`POST` idempotent sur une identité identique ; `409` au-delà de 50 ; `400` champs non
conformes ; `401` sans compte.

---

## 2. Z4 — Commandes

| Méthode | Chemin | Auth | Réponse | Référence |
|---|---|---|---|---|
| `GET` | `/orders/{order_id}` | optionnel | `public_order` | `routers/orders.py:467` |
| `GET` | `/orders/me` | oui | liste (200 max, `created_at` desc) | `:436` |
| `GET` | `/orders/track?order_number=&pubg_id=` | public | `public_order` sans `email`/`payment_phone` | `:450` |
| `GET` | `/orders/subscriptions?pubg_id=` | public | `{pubg_id, active}` | `:441` |

`order_number` ≥ 6 caractères, `pubg_id` ≥ 9 (`:450-451`). `404` commande introuvable.
Statuts possibles (`:38-39`) : `pending_payment, awaiting_verification, proof_submitted,
late_payment, paid, delivered, cancelled, failed, expired`.

---

## 3. Z5 — Compte, points, événements, pack, chat

### 3.1 `PATCH /auth/me` — oui

`backend/routers/auth.py:392`, corps `ProfileIn` (`:57-61`) :
`{name 2..60, phone ≤ 20, saved_pubg_ids: string[], pubg_card: {pubg_id, kd, clan, collection_level}}`.
`saved_pubg_ids` est filtré (chiffres, dédoublonné, 10 max). Réponse : utilisateur public.

### 3.2 `POST /auth/change-password` — oui

`:255`, corps `{current_password?, new_password 8..128}`. Réponse `{user, access_token}`
(les cookies sont reposés). `401` si `current_password` faux.

### 3.3 `POST /auth/me/delete` — oui

`:436`, corps `{password?, confirmation}`. `confirmation` doit valoir **`SUPPRIMER`**
(insensible à la casse, `:440`) → `400` sinon ; `401` mot de passe faux ;
`409` commande encore en cours ; `403` compte admin.

### 3.4 `POST /auth/resend-verification` — oui

`:207` → `{ok:true}` ou `{ok:true, already_verified:true}` ; `429` (3/heure par compte).

### 3.5 Fidélité

| Méthode | Chemin | Auth | Corps / réponse | Référence |
|---|---|---|---|---|
| `GET` | `/loyalty/me` | oui | `{balance:{earned,promo,total}, ledger[], config{enabled, points_per_1000_ar, transfers_enabled, transfer_min, transfer_daily_limit, transfer_monthly_limit, transfer_requires_verified_email}}` | `routers/loyalty.py:60` |
| `GET` | `/loyalty/rewards` | public | liste active triée par `cost_points` | `:68` |
| `POST` | `/loyalty/redeem` → `201` | oui | `{reward_id, pubg_id? 9..13}` → échange `{id, status:"pending", …}` | `:73` |
| `GET` | `/loyalty/redemptions` | oui | liste (50 max) | `:103` |
| `POST` | `/loyalty/transfers` → `201` | oui | `{recipient_email, amount 1..1000000, note? ≤140}` | `:109` |
| `GET` | `/loyalty/transfers` | oui | liste reçue/envoyée (100 max) | `:134` |
| `POST` | `/loyalty/transfers/{id}/accept` | oui | transfert accepté | `:153` |
| `POST` | `/loyalty/transfers/{id}/cancel` | oui | transfert annulé | `:165` |

Erreurs d'échange : `503` programme désactivé, `404` récompense, `400` `pubg_id` requis pour
des UC, `409` stock épuisé, `409` points insuffisants (`services/loyalty.py:60,71,81`).
Erreurs de transfert : `503` désactivé, `403` email non vérifié, `404` destinataire,
`422` email invalide.

### 3.6 Événements et pack évolutif

| Méthode | Chemin | Corps | Réponse | Référence |
|---|---|---|---|---|
| `GET` | `/events` | — | liste avec `likes`, `shares` | `routers/events.py:46` |
| `POST` | `/events/{id}/like` | `{session_id 6..80}` | `{liked, likes}` | `:52` |
| `POST` | `/events/{id}/share` | `{session_id}` | `{shares}` | `:66` |
| `GET` | `/evo/season` | — | `{season, week:"YYYY-Www"}` | `routers/evo.py:110` |
| `GET` | `/evo/eligibility?product_id=&pubg_id=` | — | `{eligible, reason?, season, pubg_id?, week?}` | `:115` |

`like` bascule (retire le like existant) ; **`404` événement inconnu côté `like` seulement** (pas dans `share`). `eligibility` : `400`
ID non numérique / hors 9..13, `404` offre inconnue, `eligible:false` + `reason` pour les
refus métier (jamais une exception).

### 3.7 Chat (préfixe `/chat`) — oui

| Méthode | Chemin | Corps | Réponse | Référence |
|---|---|---|---|---|
| `GET` | `/chat/unread` | — | `{count}` | `routers/chat.py:48` |
| `POST` | `/chat/conversations` → `201` | — | conversation (idempotent, une par client) | `:59` |
| `GET` | `/chat/conversations?before=` | — | `{items[], has_more}` | `:72` |
| `GET` | `/chat/conversations/{cid}/messages?before=` | — | `{conversation, messages[], has_more}` | `:90` |
| `POST` | `/chat/conversations/{cid}/messages` → `201` | `{text 1..2000}` | message | `:103` |
| `POST` | `/chat/conversations/{cid}/read` | `{message_ids 1..100}` | `{marked}` | `:116` |

`404` conversation/message hors du compte. Le texte est `strip()`é ; vide → `422`.

---

## 4. Z6 — Hors pages clients

Les routes `/admin/*` (commandes, produits, jeux, événements, fidélité, paiements,
crypto, utilisateurs, export/audit/stockage) existent (`routers/orders.py:737-922`,
`products.py:129-212`, `games.py:198-233`, `events.py:85-108`, `loyalty.py:178-236`,
`payments.py:383-405`, `crypto.py:55-101`, `admin_users.py`). **Aucune n'est à porter dans
le prototype** : `PORTAGE.md` les laisse à l'application React. Rien à câbler ici.

---

## 5. Pièges à ne pas répéter

1. `payment_method` : le prototype envoie `manual` + `manual_operator` ; `mvola`/`orange`
   comme `payment_method` sont réservés au paiement automatique (§1.6).
2. Preuve : champ `files`, réponse sans `id` — ne pas faire `if (r.id)`.
3. Annulation : `reason` fermé (5 valeurs) ; `customer_cancel` n'existe pas → `422`.
4. Suppression de compte : `SUPPRIMER`, pas `DELETE`.
5. `GET /crypto/{id}/status` est indexé par **order_id**, pas par l'id du paiement.
6. `amount_usdt` = montant exact ; `base_usdt` ne sert qu'à l'affichage de conversion.
7. Les erreurs de preuve/annulation sont `{detail:{code,message}}`, SAUF `product_unavailable`
   (§1.2) qui porte `code` + `product_ids` au TOP LEVEL du corps ; les autres sont une
   chaîne. Un lecteur qui ne teste que `data.code` ratera `product_unavailable`.
