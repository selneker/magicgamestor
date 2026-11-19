"""PL-ORDER-PROOF-1 — délai de paiement, expiration atomique et purges.

Trois tâches idempotentes, appelées par la route interne protégée (cron-job.org) :
1. `expire_due_orders` : `pending_payment` dont l'échéance est passée, sans paiement ni preuve.
   La bascule est UN SEUL `update_many` avec le filtre complet : jamais de lecture suivie d'une
   écriture, donc un webhook qui vient de payer la commande ne peut pas être écrasé.
2. `purge_expired_orders` : suppression définitive des `expired` depuis `EXPIRED_PURGE_DAYS` qui
   n'ont jamais reçu de paiement ni de preuve.
3. `purge_order_proofs` : suppression des fichiers GridFS des commandes à statut final depuis
   `PROOF_RETENTION_DAYS` ; les métadonnées (sha256, taille, dates) restent en base. Idempotent,
   et une panne de stockage n'interrompt jamais le reste de la tâche.

PL-006-T08C-V1 ajoute une quatrième tâche, `reconcile_shop2topup_units` : elle ne concerne QUE
les unités dont le record porte `provider == "shop2topup"`, réutilise `reconcile()` de l'adaptateur
(donc son budget de requêtes) et ne propage jamais une erreur. Le webhook Shop2Topup réutilise le
même chemin d'écriture (`apply_provider_status`), pour qu'une mise à jour poussée et une mise à
jour réconciliée ne divergent pas.
"""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db
from services import availability_sync, notifications, p2p_rate, proofs, stock, stock_signals
from services.providers.base import OrderStatus

logger = logging.getLogger("mgs.order_maintenance")

DEFAULT_PAYMENT_WINDOW_MIN = 30
DEFAULT_EXPIRED_PURGE_DAYS = 7
DEFAULT_PROOF_RETENTION_DAYS = 7
# PL-ORDER-CLIENT-1 : avertissement au client quand il reste au plus N minutes (5 par défaut).
DEFAULT_EXPIRY_WARN_MIN = 5
# « validée, annulée, échouée ou expirée » : `paid`/`delivered` couvrent la validation.
FINAL_STATUSES = ("paid", "delivered", "cancelled", "failed", "expired")
PAID_PAYMENT_STATUSES = ("completed", "late_success")


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(high, max(low, value))


def payment_window_min() -> int:
    """Fenêtre d'une commande en attente de paiement (`ORDER_PAYMENT_WINDOW_MIN`, 30 min)."""
    return _env_int("ORDER_PAYMENT_WINDOW_MIN", DEFAULT_PAYMENT_WINDOW_MIN, 1, 24 * 60)


def expired_purge_days() -> int:
    return _env_int("EXPIRED_PURGE_DAYS", DEFAULT_EXPIRED_PURGE_DAYS, 1, 3650)


def proof_retention_days() -> int:
    return _env_int("PROOF_RETENTION_DAYS", DEFAULT_PROOF_RETENTION_DAYS, 1, 3650)


def expiry_warn_min() -> int:
    """Avertissement « il reste N minutes » (`ORDER_EXPIRY_WARN_MIN`, 5 min par défaut)."""
    return _env_int("ORDER_EXPIRY_WARN_MIN", DEFAULT_EXPIRY_WARN_MIN, 1, 24 * 60)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def payment_deadline_iso(now: datetime | None = None) -> str:
    """Échéance ISO (UTC) d'une commande qui attend un paiement."""
    return ((now or _now()) + timedelta(minutes=payment_window_min())).isoformat()


def _no_proof_filter() -> dict:
    return {"$or": [{"payment_proofs": {"$exists": False}}, {"payment_proofs": {"$size": 0}}]}


def _item_label(order: dict) -> str:
    """Libellé court des produits de la commande (jamais un pseudo ni un identifiant joueur)."""
    names = [str(item.get("name")) for item in order.get("items") or [] if item.get("name")]
    return ", ".join(names[:2]) + ("…" if len(names) > 2 else "")


async def release_order_holds(order_ids: list[str], now_iso: str, reason: str = "order_expired") -> int:
    """Libère les créneaux Binance et les verrous d'abonnement/pack d'une commande close.

    L'index unique partiel `(network, amount_usdt)` n'est JAMAIS modifié : on retire seulement
    `slot_open` du document, ce qui libère naturellement le créneau. `reason` distingue une
    expiration d'une annulation client (`order_cancelled`), sans changer ce comportement.
    """
    if not order_ids:
        return 0
    res = await db.crypto_payments.update_many(
        {"order_id": {"$in": order_ids}, "slot_open": True},
        {"$set": {"status": "FAILED", "failure_reason": reason, "updated_at": now_iso},
         "$unset": {"slot_open": ""},
         "$push": {"history": {"status": "FAILED", "reason": reason, "at": now_iso}}},
    )
    from routers.orders import release_subscription_locks  # import local : évite un cycle au démarrage
    for order_id in order_ids:
        await release_subscription_locks(order_id)
    return res.modified_count


async def expire_due_orders(now: datetime | None = None) -> dict:
    """Expire atomiquement les commandes échues. Ne lève jamais vers l'appelant."""
    moment = now or _now()
    now_iso = moment.isoformat()
    batch = uuid.uuid4().hex
    try:
        res = await db.orders.update_many(
            {"status": "pending_payment",
             "payment_deadline_at": {"$lte": now_iso},
             "paid_at": {"$exists": False},
             "paid_attempt_ref": {"$exists": False},
             **_no_proof_filter()},
            {"$set": {"status": "expired", "expired_at": now_iso, "updated_at": now_iso,
                      "expiration_batch": batch},
             "$push": {"history": {"status": "expired", "at": now_iso}}},
        )
    except Exception as exc:  # le cron doit rester stable même si Mongo est indisponible
        logger.warning("Expiration des commandes impossible (%s)", type(exc).__name__)
        return {"expired": 0, "released_crypto": 0}

    if not res.modified_count:
        return {"expired": 0, "released_crypto": 0}

    docs = await db.orders.find(
        {"expiration_batch": batch},
        {"_id": 0, "id": 1, "order_number": 1, "payment_method": 1, "payment_provider": 1,
         "total": 1, "currency": 1, "user_id": 1, "game_id": 1, "items.name": 1},
    ).to_list(1000)
    order_ids = [doc["id"] for doc in docs if doc.get("id")]
    try:
        released = await release_order_holds(order_ids, now_iso)
    except Exception as exc:
        logger.warning("Libération des créneaux impossible (%s)", type(exc).__name__)
        released = 0
    for doc in docs:
        # Alerte admin : réglage existant `ALERT_PAYMENT_EXPIRED` inchangé.
        notifications.schedule(
            None, notifications.notify_payment_expired,
            doc.get("id"), doc.get("order_number"), doc.get("payment_method"), "system",
        )
        # PL-ORDER-CLIENT-1 : notification CLIENT unique, indépendante du réglage admin.
        try:
            marked = await db.orders.update_one(
                {"id": doc.get("id"), "expired_notified_at": {"$exists": False}},
                {"$set": {"expired_notified_at": now_iso}},
            )
        except Exception as exc:  # une panne de marqueur ne bloque jamais le reste de la tâche
            logger.warning("Marqueur d'expiration non posé (%s)", type(exc).__name__)
            continue
        if marked.modified_count == 1:
            notifications.schedule(
                None, notifications.notify_customer_payment_expired,
                doc.get("id"), doc.get("order_number"), doc.get("total"),
                _item_label(doc), doc.get("game_id"), doc.get("user_id"),
            )
    return {"expired": res.modified_count, "released_crypto": released}


async def warn_expiring_orders(now: datetime | None = None) -> dict:
    """Avertit UNE fois chaque commande encore payable proche de son échéance (client).

    Le marqueur `expiry_warned_at` est posé par un `update_one` filtré AVANT l'envoi : deux
    passages simultanés de la tâche ne peuvent pas produire deux notifications. Aucune preuve,
    aucun paiement : seules les commandes réellement en attente sont concernées.
    """
    moment = now or _now()
    now_iso = moment.isoformat()
    threshold = (moment + timedelta(minutes=expiry_warn_min())).isoformat()
    warned = 0
    try:
        cursor = db.orders.find(
            {"status": "pending_payment",
             "payment_deadline_at": {"$gt": now_iso, "$lte": threshold},
             "expiry_warned_at": {"$exists": False},
             "paid_at": {"$exists": False}, "paid_attempt_ref": {"$exists": False},
             **_no_proof_filter()},
            {"_id": 0, "id": 1, "order_number": 1, "total": 1, "user_id": 1, "game_id": 1,
             "items.name": 1},
        ).limit(200)
        async for order in cursor:
            try:
                marked = await db.orders.update_one(
                    {"id": order.get("id"), "status": "pending_payment",
                     "payment_deadline_at": {"$gt": now_iso, "$lte": threshold},
                     "expiry_warned_at": {"$exists": False},
                     "paid_at": {"$exists": False}, "paid_attempt_ref": {"$exists": False},
                     **_no_proof_filter()},
                    {"$set": {"expiry_warned_at": now_iso}},
                )
            except Exception as exc:  # marqueur impossible : on n'envoie rien, on continue
                logger.warning("Marqueur d'avertissement non posé (%s)", type(exc).__name__)
                continue
            if marked.modified_count != 1:
                continue
            warned += 1
            notifications.schedule(
                None, notifications.notify_customer_payment_expiring,
                order.get("id"), order.get("order_number"), order.get("total"),
                _item_label(order), order.get("game_id"), order.get("user_id"),
                expiry_warn_min(),
            )
    except Exception as exc:  # le cron doit rester stable même si Mongo est indisponible
        logger.warning("Avertissement d'expiration impossible (%s)", type(exc).__name__)
    return {"expiry_warned": warned}


async def purge_expired_orders(now: datetime | None = None) -> dict:
    """Supprime définitivement les `expired` anciennes, jamais payées ni accompagnées de preuve."""
    cutoff = ((now or _now()) - timedelta(days=expired_purge_days())).isoformat()
    try:
        candidates = await db.orders.find(
            {"status": "expired", "expired_at": {"$lte": cutoff}, **_no_proof_filter()},
            {"_id": 0, "id": 1},
        ).to_list(1000)
        order_ids = [doc["id"] for doc in candidates if doc.get("id")]
        if not order_ids:
            return {"purged_orders": 0}
        paid = await db.payments.find(
            {"order_id": {"$in": order_ids}, "status": {"$in": list(PAID_PAYMENT_STATUSES)}},
            {"_id": 0, "order_id": 1},
        ).to_list(1000)
        paid_ids = {doc.get("order_id") for doc in paid}
        deletable = [oid for oid in order_ids if oid not in paid_ids]
        if not deletable:
            return {"purged_orders": 0}
        res = await db.orders.delete_many(
            {"id": {"$in": deletable}, "status": "expired", "expired_at": {"$lte": cutoff},
             **_no_proof_filter()},
        )
        return {"purged_orders": res.deleted_count}
    except Exception as exc:
        logger.warning("Purge des commandes expirées impossible (%s)", type(exc).__name__)
        return {"purged_orders": 0}


async def purge_order_proofs(now: datetime | None = None) -> dict:
    """Supprime les fichiers des preuves retenues au-delà du délai, une commande à la fois.

    Idempotent : une preuve déjà `purged_at` n'est jamais relue ni resupprimée. Une erreur de
    stockage sur un fichier journalise et passe au suivant sans bloquer les autres commandes.
    """
    cutoff = ((now or _now()) - timedelta(days=proof_retention_days())).isoformat()
    purged = 0
    try:
        cursor = db.orders.find(
            {"status": {"$in": list(FINAL_STATUSES)},
             "payment_proofs": {"$exists": True, "$ne": []},
             "proofs_purged_at": {"$exists": False},
             "updated_at": {"$lte": cutoff}},
            {"_id": 0, "id": 1, "payment_proofs": 1},
        ).limit(200)
        async for order in cursor:
            entries = order.get("payment_proofs") or []
            changed = False
            for entry in entries:
                if entry.get("purged_at") or not entry.get("blob_name"):
                    continue
                try:
                    await proofs.delete(entry["blob_name"])
                except Exception as exc:
                    logger.warning("Preuve non supprimée pour %s (%s)", order.get("id"), type(exc).__name__)
                    continue
                entry["purged_at"] = _now().isoformat()
                purged += 1
                changed = True
            if not changed:
                continue
            all_purged = all(entry.get("purged_at") or not entry.get("blob_name") for entry in entries)
            update = {"payment_proofs": entries}
            if all_purged:
                # Tant qu'un blob résiste, `updated_at` reste ancien : le prochain passage réessaie.
                update["updated_at"] = _now().isoformat()
                update["proofs_purged_at"] = _now().isoformat()
            await db.orders.update_one({"id": order.get("id")}, {"$set": update})
    except Exception as exc:
        logger.warning("Purge des preuves interrompue (%s)", type(exc).__name__)
    return {"purged_blobs": purged}


# --------------------------------------------------------------------------- #
# PL-006-T08C-V1 — réconciliation Shop2Topup (maintenance + webhook)
# --------------------------------------------------------------------------- #
SHOP2TOPUP_PROVIDER = "shop2topup"
# Les records fournisseur vivent sous les champs `fazercards*` (forme historique, inchangée) :
# ce n'est que le champ `provider` du record qui désigne le fournisseur réel de l'unité.
SHOP2TOPUP_ORDER_PROJECTION = {
    "_id": 0, "id": 1, "game_id": 1, "user_id": 1, "email": 1, "items": 1,
    "fazercards": 1, "fazercards_lines": 1, "fazercards_components": 1, "fazercards_reps": 1,
    "fazercards_provider_ids": 1,
}
# Borne de lecture d'un passage : ~10 commandes/jour en régime nominal, 500 laisse une large marge
# sans transformer le cron en balayage complet de la collection.
SHOP2TOPUP_MAX_ORDERS = 500


def _as_index(value) -> int | None:
    try:
        index = int(value)
    except (TypeError, ValueError):
        return None
    return index if index >= 0 else None


def stored_units(order: dict) -> list[dict]:
    """Toutes les unités de fulfillment STOCKÉES dans une commande, sans relire les produits.

    Les quatre formes existantes sont couvertes : ligne 0 (`fazercards`), autres lignes
    (`fazercards_lines`), composants (`fazercards_components`) et répétitions de quantité
    (`fazercards_reps`). Aucune unité n'est inventée : un enregistrement absent n'apparaît pas.
    """
    units: list[dict] = []

    def push(path: str, line_index: int, component_index: int | None,
             quantity_index: int, record) -> None:
        if isinstance(record, dict):
            units.append({"path": path, "line_index": line_index,
                          "component_index": component_index,
                          "quantity_index": quantity_index, "record": record})

    push("fazercards", 0, None, 0, order.get("fazercards"))
    for raw_idx, record in (order.get("fazercards_lines") or {}).items():
        idx = _as_index(raw_idx)
        if idx is not None:
            push(f"fazercards_lines.{raw_idx}", idx, None, 0, record)
    for raw_idx, components in (order.get("fazercards_components") or {}).items():
        idx = _as_index(raw_idx)
        if idx is None or not isinstance(components, dict):
            continue
        for raw_cidx, record in components.items():
            cidx = _as_index(raw_cidx)
            if cidx is not None:
                push(f"fazercards_components.{raw_idx}.{raw_cidx}", idx, cidx, 0, record)
    for raw_idx, reps in (order.get("fazercards_reps") or {}).items():
        idx = _as_index(raw_idx)
        if idx is None or not isinstance(reps, dict):
            continue
        for raw_q, node in reps.items():
            q = _as_index(raw_q)
            if q is None or not isinstance(node, dict):
                continue
            # Une répétition est soit un record, soit un dictionnaire de composants.
            if "status" in node or "provider_order_id" in node:
                push(f"fazercards_reps.{raw_idx}.{raw_q}", idx, None, q, node)
                continue
            for raw_cidx, record in node.items():
                cidx = _as_index(raw_cidx)
                if cidx is not None:
                    push(f"fazercards_reps.{raw_idx}.{raw_q}.{raw_cidx}", idx, cidx, q, record)
    return units


def shop2topup_units(order: dict) -> list[dict]:
    """Unités réellement parties chez Shop2Topup : fournisseur du RECORD, jamais la table du moment.

    Une unité legacy sans `provider` reste FazerCards (règle T16) : elle n'est donc jamais
    réconciliée ici, même si `GAME_PROVIDER` pointe aujourd'hui vers Shop2Topup.
    """
    selected = []
    for unit in stored_units(order):
        record = unit["record"]
        if (record.get("provider") or "fazercards") != SHOP2TOPUP_PROVIDER:
            continue
        if not str(record.get("provider_order_id") or "").strip():
            continue
        selected.append(unit)
    return selected


async def apply_provider_status(order: dict, unit: dict, provider_status: str | None, *,
                                raw: dict | None = None, source: str,
                                actor: str = "maintenance:shop2topup") -> None:
    """Écrit le statut fournisseur d'UNE unité par le chemin déjà utilisé par `refresh_status`.

    Réutilise le signal de remboursement et la bascule `paid → delivered` existants : le webhook
    et la réconciliation ne peuvent pas produire deux comportements différents. Le fournisseur est
    nommé explicitement (`shop2topup`), donc la table par jeu n'entre pas en jeu ici.
    """
    from services import fzr_fulfillment  # import local : évite un cycle au démarrage
    from services.providers import get_provider

    provider = get_provider(order.get("game_id"), SHOP2TOPUP_PROVIDER)
    status = str(provider_status or "").strip()
    now_iso = _now().isoformat()
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {f"{unit['path']}.provider_status": status,
                  f"{unit['path']}.updated_at": now_iso, "updated_at": now_iso}})
    normalized = provider.normalize_status(status)
    if normalized in (OrderStatus.FAILED, OrderStatus.REFUND):
        logger.warning("unité Shop2Topup %s.%s de la commande %s au statut %s",
                       unit["path"], unit.get("component_index"), order.get("id"), status or "vide")
    if normalized == OrderStatus.REFUND:
        await fzr_fulfillment._signal_refund(
            order, unit["line_index"], unit["record"], raw, source, actor)
    await fzr_fulfillment._sync_mgs_status(order["id"], actor)


async def reconcile_shop2topup_units(now: datetime | None = None, provider=None) -> dict:
    """Réconcilie UNIQUEMENT les unités Shop2Topup, dans le budget de l'adaptateur.

    - aucune unité Shop2Topup ⇒ aucun appel fournisseur, aucun effet ;
    - `reconcile()` gère le tri (plus anciennes d'abord), le lot de 50 et le budget de statut ;
    - toute erreur est journalisée et rendue en compteurs : la tâche cron ne lève jamais.
    """
    result = {"shop2topup_units": 0, "batches": 0, "updated": 0, "not_found": 0, "starved": 0}
    try:
        # `delivered` est exclu : toutes ses unités sont déjà `completed`, les re-sonder ferait
        # consommer le budget par l'historique et affamerait les unités en cours. Les commandes
        # annulées/échouées restent suivies si une unité est partie (remboursement à constater).
        cursor = db.orders.find(
            {"status": {"$ne": "delivered"},
             "fazercards_provider_ids": {"$exists": True, "$ne": []}},
            SHOP2TOPUP_ORDER_PROJECTION,
        ).limit(SHOP2TOPUP_MAX_ORDERS)
        orders = await cursor.to_list(SHOP2TOPUP_MAX_ORDERS)
        by_id = {order["id"]: order for order in orders if order.get("id")}
        units = []
        for order in by_id.values():
            for unit in shop2topup_units(order):
                record = unit["record"]
                units.append({**unit, "order_id": order["id"],
                              "provider_order_id": record.get("provider_order_id"),
                              "created_at": record.get("created_at"),
                              "updated_at": record.get("updated_at")})
        result["shop2topup_units"] = len(units)
        if not units:
            return result
        if provider is None:
            from services.providers import get_provider
            provider = get_provider(None, SHOP2TOPUP_PROVIDER)
        report = await provider.reconcile(units)
        result["batches"] = report.get("batches", 0)
        result["not_found"] = len(report.get("not_found") or [])
        result["starved"] = len(report.get("starved") or [])
        checked = report.get("checked") or {}
        for unit in units:
            provider_order = checked.get(str(unit["provider_order_id"]))
            if provider_order is None:
                continue
            order = by_id.get(unit["order_id"])
            if order is None:
                continue
            try:
                await apply_provider_status(
                    order, unit, provider_order.status, raw=provider_order.raw,
                    source="reconcile", actor="maintenance:shop2topup")
                result["updated"] += 1
            except Exception as exc:  # une unité en échec ne bloque pas les suivantes
                logger.warning("statut Shop2Topup non appliqué pour la commande %s (%s)",
                               unit["order_id"], type(exc).__name__)
        return result
    except Exception as exc:  # le cron doit rester stable même si le fournisseur est indisponible
        logger.warning("Réconciliation Shop2Topup interrompue (%s)", type(exc).__name__)
        return result


async def apply_shop2topup_event(payload: dict) -> dict:
    """Applique un événement webhook Shop2Topup déjà authentifié. Ne lève jamais.

    Dédoublonnage : même collection et même index unique que FazerCards (`event_id`). L'identifiant
    est préfixé `shop2topup:` quand le fournisseur n'en fournit pas, pour ne jamais entrer en
    collision avec un événement FazerCards. Si le corps ne contient pas de statut, seule la trace
    est écrite : aucune unité n'est modifiée au hasard.

    **À CONFIRMER** : le RAPPORT-SHOP2TOPUP-API.md confirme HMAC-SHA256 sur le corps brut, mais ne
    documente NI le nom d'en-tête NI la forme exacte du corps (`event` / `data.order_id` /
    `data.status`). Cette forme est celle déjà lue par `parse_webhook_event()` de l'adaptateur.
    """
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    provider_order_id = str(data.get("order_id") or "").strip()
    if not provider_order_id:
        return {"ok": True, "ignored": True}
    status = str(data.get("status") or "").strip()
    event_key = str(payload.get("event_id") or "").strip() or (
        f"shop2topup:{provider_order_id}:{payload.get('event') or '-'}:{status or '-'}")
    try:
        await db.fzr_webhook_events.insert_one({
            "event_id": event_key, "provider": SHOP2TOPUP_PROVIDER,
            "event": payload.get("event"), "provider_order_id": provider_order_id,
            "status": status or None, "created_at": _now().isoformat()})
    except Exception:
        return {"ok": True, "duplicate": True}
    try:
        order = await db.orders.find_one(
            {"$or": [{"fazercards.provider_order_id": provider_order_id},
                     {"fazercards_provider_ids": provider_order_id}]},
            SHOP2TOPUP_ORDER_PROJECTION)
        if not order:
            return {"ok": True, "ignored": True}
        target = next((unit for unit in shop2topup_units(order)
                       if str(unit["record"].get("provider_order_id")) == provider_order_id), None)
        if target is None:
            return {"ok": True, "ignored": True}
        if status:
            await apply_provider_status(
                order, target, status, raw=payload, source="webhook",
                actor="webhook:shop2topup")
        return {"ok": True}
    except Exception as exc:
        logger.warning("événement webhook Shop2Topup non appliqué (%s)", type(exc).__name__)
        return {"ok": True, "ignored": True}


async def run_all(now: datetime | None = None) -> dict:
    """Un passage complet pour cron-job.org. Chaque tâche est isolée : une panne n'annule pas les autres."""
    moment = now or _now()
    result = {}
    for name, func in (("expiry_warning", warn_expiring_orders),
                       ("expiration", expire_due_orders),
                       ("expired_purge", purge_expired_orders),
                       ("proof_purge", purge_order_proofs),
                       # PL-PROOF-QUOTA-1 : alerte précoce quotidienne, dans la tâche cron existante.
                       ("storage_warning", proofs.check_storage_warnings),
                       # PL-STOCK-1 (B/H) : un état fournisseur périmé redevient « inconnu ».
                       ("stock_expiry", stock.expire_stale_states),
                       # PL-STOCK-2 : relevé de la liste des offres (observe par défaut).
                       ("stock_offers", stock_signals.sync_offers),
                       # PL-006-T06 : relevé de disponibilité publiée, appliqué aux lots rattachés.
                       ("stock_availability", availability_sync.run_once),
                       # PL-006-T08C-V1 : statuts des SEULES unités Shop2Topup, dans le budget.
                       ("shop2topup_reconcile", reconcile_shop2topup_units),
                       # PL-006-T09B-V1 : taux USDT/ariary P2P.Army, au plus toutes les 30 min.
                       ("p2p_rate", p2p_rate.sync_rate)):
        try:
            result.update(await func(moment))
        except Exception as exc:  # déjà protégé, ceinture et bretelles
            logger.warning("Tâche %s interrompue (%s)", name, type(exc).__name__)
    return result
