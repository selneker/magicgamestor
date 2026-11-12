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
"""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db
from services import notifications, proofs, stock

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
                       ("stock_expiry", stock.expire_stale_states)):
        try:
            result.update(await func(moment))
        except Exception as exc:  # déjà protégé, ceinture et bretelles
            logger.warning("Tâche %s interrompue (%s)", name, type(exc).__name__)
    return result
