# PL-ORDER-CLIENT-1 — opérateur manuel, annulation client, notifications d'échéance

Branche `feat/order-client-1` (depuis `origin/main` = `e462c8e`), un seul commit, aucun push.
Périmètre : `backend/` uniquement. Aucun frontend, aucun index, aucune logique Binance.

---

## 1. Ce qui manque pour notifier un client (à lire en premier)

**Il n'existe aujourd'hui aucun canal qui permette de joindre un client.** Le seul canal
d'alerte en production est le Push Web, et il est **réservé aux administrateurs** :

| Fait | Preuve |
|---|---|
| L'abonnement Push est rattaché à un `user_id` | `backend/models/messaging.py:45-49` (`PushSubscription.user_id`) |
| Les routes d'abonnement exigent `require_admin` | `backend/routers/push.py:14` (préfixe `/admin/push`), `:49-88` (`Depends(require_admin)`) |
| L'envoi ne cible que les comptes admin | `backend/services/push.py:144` (`dispatch_to_admins`), filtre `core/security.py` (`ADMIN_ROLES`) |
| Le frontend n'abonne que l'espace admin | `frontend/src/lib/pushSync.js` importé seulement par `frontend/src/components/admin/AdminPush.js` (aucun `pushManager` côté boutique) |
| Une commande invitée n'a pas de `user_id` | `backend/routers/orders.py` (création : `user["user_id"] if user else None`) |
| Aucune langue n'est stockée sur le compte | `backend/routers/auth.py:172-181` : le document `users` ne contient ni `language`, ni `locale`, ni `lang` |

Conséquences, toutes implémentées sans inventer de système :

- **Un client connecté** reçoit `payment_expiring` / `payment_expired` **si et seulement si** un
  abonnement Push existe pour son `user_id`. Aucun client n'en a aujourd'hui : la notification
  est prête, mais **aucun appareil client n'est abonné**.
- **Un invité** (commande sans `user_id`) **ne reçoit rien** : il n'y a aucun identifiant stable
  auquel rattacher un abonnement. Le marqueur anti-doublon est quand même posé, l'envoi n'est
  pas tenté.
- Le corps est en **français** (repli), ou en anglais si l'un des champs `language` / `locale` /
  `lang` du compte vaut `en…`. Ce champ n'existe pas encore : le propriétaire devra décider
  (a) d'un abonnement Push côté client (page « activer les notifications » + consentement) et
  (b) d'une langue stockée sur le compte. Rien de tout cela n'a été ajouté ici.
- Aucune notification client n'est écrite dans `alert_log` : ce journal est celui des alertes
  **admin** (`services/notifications.py:1-8`). Les échecs sont journalisés (type d'exception
  uniquement) et ne bloquent jamais la tâche cron.

---

## 2. Inventaire de l'étape 0 (état d'`origin/main`, avant le lot)

| Élément demandé | Emplacement (lignes du fichier après le lot) | Constat |
|---|---|---|
| Modèle de création | `backend/routers/orders.py:63` (`OrderIn`), `:72` (`payment_method`), `:94-107` (`payment_phone` + `valid_phone`) | `payment_method` ∈ `mvola\|orange\|manual\|binance` ; aucun opérateur manuel n'était retenu. |
| Lecture publique | `backend/routers/orders.py:154` (`public_order`) | Renvoyait la commande complète ; aucun `manual_operator`. |
| Transitions | `backend/routers/orders.py:45` (`TRANSITIONS`) | `pending_payment → cancelled/expired/…` existait déjà. |
| Expiration + libération | `backend/services/order_maintenance.py:99` (`expire_due_orders`), `:78` (`release_order_holds`) | `update_many` atomique, puis libération des créneaux Binance (`crypto_payments.slot_open`) et des verrous (`release_subscription_locks`). |
| Accès propriétaire / invité UUID | `backend/routers/orders.py:170` (`_accessible_order`) | Propriétaire connecté, ou porteur de l'UUID quand `user_id` est absent ; 403 sinon, 404 si inconnue. |
| Erreurs structurées `/proof` | `backend/routers/orders.py:465` (`_proof_error`) | `{"code", "message"}` en 409/429. |
| Débit de `/proof` | `backend/routers/orders.py:490` (`upload_order_proof`) | `ratelimit.check` par IP et par commande (`PROOF_UPLOAD_PER_HOUR_PER_IP`, `…_PER_ORDER`), compteurs en mémoire. |
| Notifications existantes | `backend/services/notifications.py` (`notify_admin`), `backend/services/push.py:144`, `backend/routers/reminders.py` | Journal `alert_log` + Push, **admin uniquement** ; deux canaux (`push`, `telegram`) et reprise `retry_pending`. |
| Ce que le frontend envoie pour l'opérateur | `frontend/src/pages/Checkout.js:205` ; `frontend/src/components/store/checkout/ProofPay.js:89` | `payment_method` seulement. L'opérateur choisi (`reference.provider \|\| "mvola"`) reste **local à l'écran** et n'est **jamais transmis** : c'est précisément le trou que ce lot comble côté API. |

L'inventaire a aussi confirmé que `db.orders` n'a pas d'index sur `cancel_reason`/`cancelled_at`
(aucun index ajouté : agrégation admin peu fréquente, cf. §3.4).

---

## 3. Comportement et contrat final (fichier:ligne)

### 3.1 Création de commande — `manual_operator`

- `backend/routers/orders.py:76` : `manual_operator: str | None = Field(default=None, max_length=10)`.
- `backend/routers/orders.py:109-121` : `model_validator(mode="after")`. Si
  `payment_method == "manual"` et que la valeur n'est ni `mvola` ni `orange` → `ValueError`
  (422 générique Pydantic, message « Paramètre de paiement invalide. »).
- Autres méthodes : le champ est **ignoré sans erreur** et stocké à `null`
  (`routers/orders.py:388`). Choix : ne jamais faire échouer une commande Mvola/Orange/Binance
  à cause d'un champ qui ne la concerne pas, et garder un schéma stable (toujours présent).
- Absent → `null` (anciens clients inchangés).
- Validateur `payment_phone` **non modifié** (`:94-107`).

Contrat exact :

```
POST /api/orders
{ …, "payment_method": "manual", "manual_operator": "mvola" | "orange" | null | absent }
→ 201, l'objet public contient "manual_operator" (valeur retenue ou null)
→ 422 si payment_method == "manual" et valeur hors {mvola, orange}
```

### 3.2 Lecture de commande

- `backend/routers/orders.py:154` / `:161` : `public_order` fait `setdefault("manual_operator", None)`.
- Aucune migration : les commandes antérieures renvoient `null`.
- `GET /api/orders/{id}` conserve l'accès existant (propriétaire ou UUID invité).

### 3.3 Annulation client

- `backend/routers/orders.py:669` : `POST /api/orders/{order_id}/cancel`.
- Corps (`backend/routers/orders.py:123` `CancelIn`) :
  `{"reason": "wrong_info"|"change_method"|"too_short"|"cannot_pay_now"|"other", "note": "≤ 200 caractères, optionnel"}`.
- Accès : `_accessible_order` (inchangé) → 404 si inconnue, 403 si propriétaire différent.
- Refus (`:682-694`) : statut ≠ `pending_payment`, preuve présente, `paid_at`/`paid_attempt_ref`
  présent → **409 `{"code":"cancel_not_allowed","message":…}`**.
- Idempotence : déjà `cancelled` **par le client** (`cancelled_by == "customer"`) →
  **200 `{"ok":true,"status":"cancelled"}`**. Une annulation admin reste 409.
- Écriture atomique (`:699-715`) : **un seul `update_one`** filtré sur
  `id + status=pending_payment + paid_at/paid_attempt_ref absents + payment_proofs vide`,
  posant `status="cancelled"`, `cancel_reason`, `cancel_note`, `cancelled_at`,
  `cancelled_by="customer"`, `updated_at`, un `history` et retirant `payment_deadline_at`.
  `modified_count != 1` → relecture : 200 si annulation client, sinon
  **409 `{"code":"cancel_conflict","message":…}`** (un paiement est arrivé entre-temps).
- Note : espaces/contrôles réduits, tronquée à 200 (`:663`, `_clean_cancel_note`).
- Après succès seulement : `release_order_holds([order_id], now_iso, reason="order_cancelled")`
  (`services/order_maintenance.py:78`). Même fonction que l'expiration, même index intact
  (`slot_open` retiré, index unique partiel `(network, amount_usdt)` jamais touché). Une panne
  de libération est journalisée et n'annule pas l'annulation écrite.
- Débit : `ORDER_CANCEL_PER_HOUR_PER_IP` (défaut 20) avant l'accès ; puis
  `ORDER_CANCEL_PER_HOUR_PER_ORDER` (défaut 5) après la reprise idempotente. 429 = message
  standard `ratelimit`. La limite par commande ne consomme donc pas les reprises idempotentes.
- Audit : `audit("order.cancelled", actor, order_id, {"reason": …})` — aucune identité joueur.

Contrat exact :

```
200 {"ok": true, "status": "cancelled"}
409 {"detail": {"code": "cancel_not_allowed" | "cancel_conflict", "message": "…"}}
422 raison invalide / note > 200
403 propriétaire différent · 404 commande inconnue · 429 trop de tentatives
```

### 3.4 Administration

- `cancel_reason` / `cancel_note` apparaissent dans les réponses admin de commande : les routes
  admin renvoient le document complet (`PUBLIC = {"_id": 0}`, `routers/orders.py:726`).
- `backend/routers/orders.py:743` : `GET /api/admin/orders/cancel-reasons?days=30`
  (permission `orders.manage`), `days` borné 1..365.
  Réponse : `{"days": 30, "total": 3, "reasons": {"wrong_info":0,"change_method":0,"too_short":2,"cannot_pay_now":0,"other":1}}`
  (les cinq clés toujours présentes ; aucune donnée de client).
- Aucun index ajouté : agrégation `$match` sur `cancel_reason` + `cancelled_at` (ISO UTC, donc
  comparaison lexicographique correcte) sur une route admin peu fréquente.

### 3.5 Notifications client

- Canal : **Push existant uniquement**, via la nouvelle
  `backend/services/push.py:122` `dispatch_to_users(user_ids, payload)`, qui réutilise
  `push_subscriptions` + `send_push` (suppression 404/410 déjà gérée). Aucun nouveau système
  d'abonnement, aucun second canal, pas de ligne `alert_log`.
- `backend/services/notifications.py:493` `notify_customer_payment_expiring` et
  `:501` `notify_customer_payment_expired`, construites par `_notify_customer_deadline`
  (lien profond `payload.url = "/orders/{id}"`, `tag = order_id`, libellé produit + montant,
  jamais de pseudo ni d'identifiant joueur).
- Langue : `_customer_language` (`:425`) lit `language`/`locale`/`lang` sur `users` ; repli FR.
- Panne d'envoi : `_notify_customer` (`:444`) attrape tout, journalise le type d'exception et
  renvoie des compteurs — jamais d'exception vers l'appelant.
- Avertissement : `backend/services/order_maintenance.py:157` `warn_expiring_orders` —
  `pending_payment`, échéance `> now` et `≤ now + ORDER_EXPIRY_WARN_MIN`, sans preuve, sans
  paiement. **Marqueur `expiry_warned_at` posé par un `update_one` filtré avant l'envoi** :
  deux passages simultanés ⇒ un seul envoi.
- Expiration : `expire_due_orders` (`:99`) pose **`expired_notified_at`** par `update_one`
  filtré avant l'envoi ; le réglage admin `ALERT_PAYMENT_EXPIRED` n'est ni lu ni modifié pour le
  client (l'alerte admin garde exactement son comportement).
- Exécution : `run_all` (`:278`) ajoute `expiry_warning` **avant** `expiration`, dans la tâche
  existante `POST /api/internal/orders/run`. Aucun nouveau cron. La route
  (`backend/routers/maintenance.py:25`) ajoute `expiry_warned` à son repli.

Titres/texte exacts (défaut `ORDER_EXPIRY_WARN_MIN=5`) :

```
FR  payment_expiring : « Il vous reste 5 minutes pour payer »
    « 60 UC — 1 000 Ar. Commande MGS-XXXX : finalisez le paiement avant l'expiration. »
FR  payment_expired  : « Votre commande a expiré »
    « 60 UC — 1 000 Ar. Commande MGS-XXXX expirée, aucun paiement reçu. »
EN  payment_expiring : « You have 5 minutes left to pay »
EN  payment_expired  : « Your order has expired »
```

---

## 4. Variables Render

| Nom | Défaut | Rôle |
|---|---|---|
| `ORDER_EXPIRY_WARN_MIN` | `5` (borné 1..1440) | Seuil de `payment_expiring` (minutes restantes). |
| `ORDER_CANCEL_PER_HOUR_PER_IP` | `20` | Annulations max par IP et par heure (compteur mémoire, une instance). |
| `ORDER_CANCEL_PER_HOUR_PER_ORDER` | `5` | Tentatives max par commande et par heure (hors reprises idempotentes). |

Aucune autre variable nouvelle. Les notifications réutilisent `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY(_PEM)`, `VAPID_SUBJECT`, `PUSH_TTL_S`, `PUSH_URGENCY`, `PUSH_TIMEOUT_S`,
`PUSH_ENDPOINT_HOSTS` déjà en place. `ALERT_PAYMENT_EXPIRED` reste **inchangé** (il ne concerne
que l'admin). Les trois variables sont ajoutées à `backend/.env.example:74-79`.

**cron-job.org : aucun changement.** Même URL `POST /api/internal/orders/run`, même en-tête
`X-Cron-Token`, même fréquence. La réponse gagne seulement `expiry_warned`.

---

## 5. Tests

Fichier : `backend/tests/test_order_proof.py` (fixtures existantes réutilisées). 18 tests
ajoutés, tous verts ; le module complet passe (68 passed).

| Contrat couvert | Test |
|---|---|
| `manual_operator` valide / absent / inconnu / méthode non manuelle | `TestManualOperator::test_operator_stored_only_for_manual`, `::test_operator_is_ignored_for_a_non_manual_method` (`:920-965`) |
| lecture par un autre utilisateur refusée + existant = `null` | `::test_existing_order_reads_null_and_read_is_owner_only` |
| annulation propriétaire + invité UUID, intrus refusés, 404, 422 | `TestOrderCancel::test_owner_cancels_releases_slot_and_keeps_index`, `::test_guest_uuid_cancels_and_intruders_are_refused`, `::test_invalid_reason_is_refused` (`:967-1068`) |
| refus après preuve / paiement / statut final | `::test_cancel_refused_after_proof_payment_or_final_status` |
| idempotence client ≠ annulation admin | `::test_cancel_is_idempotent_for_the_customer_only` |
| atomicité (paiement arrivé entre lecture et écriture) | `::test_payment_arriving_mid_flight_is_not_overwritten` |
| créneau Binance libéré, index inchangé | assertion `index_information()` avant/après dans `test_owner_cancels_…` |
| débit par IP et par commande | `::test_ip_rate_limit`, `::test_per_order_rate_limit` |
| agrégation protégée + comptes + champs admin | `TestCancelReasonsAggregation::test_route_is_protected_and_aggregates` (`:1070-1103`) |
| avertissement unique, anti-doublon, exclusions (preuve/payée/annulée/loin), sans destinataire, panne non bloquante, langue | `TestCustomerNotifications` (`:1105-1194`) |
| `payment_expired` unique, marqueur, réglage admin intact | `::test_expiry_notification_ignores_the_admin_setting` |

### Avant / après, par identifiants (suite complète, `-n 2 --dist loadscope`)

- **Avant** (arbre stashé sur `e462c8e`) : 833 passed, 170 failed, 195 errors, 15 skipped.
- **Après** : 832 passed, 189 failed, 195 errors, 15 skipped. Les 18 nouveaux tests passent.
- Comparaison JUnit par identifiant : **0 test supprimé**, 18 ajoutés, **32 pass→échec** et
  **12 échec→succès**. Les 32 échecs sont tous `RuntimeError: Event loop is closed`
  (`test_fzr_*`, `test_identity_fulfillment_guard`, `test_payment_lifecycle`) : relancés
  **en série** (`-n 0`), **32/32 passent**. Aucune régression réelle ; le bruit vient de
  l'environnement (tests d'intégration qui attendent le serveur local et la boucle motor).
- Les échecs/erreurs préexistants (170 failed + 195 errors avant) sont ceux des suites
  d'intégration qui exigent un backend en écoute sur `localhost:8001` (absent ici) et des tests
  réseau — hors périmètre de ce lot. Les 19 échecs supplémentaires du run « après » sont
  exactement les 32 pass→échec ci-dessus moins les 12 échec→succès (même bruit de boucle), et
  non des régressions : toutes les identifiants concernés repassent en série.

### `pip-audit`

`uvx pip-audit -r requirements.txt` : **15 avis connus, tous préexistants** — `starlette 0.52.1`
(9 entrées `PYSEC-2026-…`) et `pymongo 4.6.3` (5 entrées `PYSEC-2026-4294/4295/4296/4297` +
`CVE-2026-106435`). `requirements.txt` n'est **pas modifié** par ce lot : aucun nouvel avis.
La mise à jour de pymongo/motor est explicitement hors périmètre.

### Non vérifié

- Envoi Push réel sur un appareil (clés VAPID absentes de l'environnement local, aucun
  abonnement client existant) : seule la logique d'envoi/anti-doublon est testée, le transport
  réel passe par `pywebpush` comme les alertes admin déjà en production.
- Appel réel de cron-job.org sur `POST /api/internal/orders/run` (jeton absent en local).
- Comportement Atlas (index/agrégation) : MongoDB local uniquement.
- Intégration frontend : ce lot n'en contient aucun ; `manual_operator` et `/cancel` sont prêts
  pour le lot « style Binance ».
- Annulation et notification d'une commande **invitée** de bout en bout jusqu'à l'appareil :
  impossible sans abonnement client (cf. §1).
