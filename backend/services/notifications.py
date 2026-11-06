"""Envoi unifié des alertes admin (PL-NOTIF-1) : journal `alert_log` + canal push.

Une ligne de journal est écrite en `pending` AVANT l'envoi, puis passée en `sent`, `failed` ou
`skipped` : une coupure du processus laisse une trace au lieu d'une alerte silencieusement perdue.
`notify_admin` ne lève jamais — l'issue d'une commande ou d'un message client ne dépend jamais de
l'alerte. Le canal Telegram (PL-NOTIF-4) s'ajoutera dans `CHANNELS` sans toucher aux appelants.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo.errors import DuplicateKeyError

from core.db import db
from models.notification import AlertLog
from services import push

logger = logging.getLogger("mgs.notifications")

# Canaux d'alerte. « push » aujourd'hui ; un 2e canal = un nom ici + un `_send_<canal>`.
CHANNELS = ("push",)
DEFAULT_LOG_TTL_DAYS = 30

# Reprise (`retry_pending`) : la charge utile n'est pas stockée (aucune donnée de client dans le
# journal), donc le contenu est reconstruit au plus court depuis l'événement.
RETRY_ALERTS = {
    "order_created": ("Nouvelle commande (rappel)", "/admin/commandes"),
    "chat_message": ("Nouveau message client (rappel)", "/admin/messages"),
    "test": ("Test des notifications (rappel)", "/admin/commandes"),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def alert_log_ttl_seconds() -> int:
    """Durée de vie du journal en secondes (`ALERT_LOG_TTL_DAYS`, 30 j par défaut, minimum 1 j)."""
    try:
        days = int(os.environ.get("ALERT_LOG_TTL_DAYS", str(DEFAULT_LOG_TTL_DAYS)))
    except ValueError:
        days = DEFAULT_LOG_TTL_DAYS
    return max(1, days) * 86400


def _result(row: dict, status: str, reason: str | None, counts: dict[str, int]) -> dict[str, Any]:
    return {"id": row.get("_id"), "event": row.get("event"), "channel": row.get("channel", CHANNELS[0]),
            "status": status, "reason": reason, **counts}


async def _close(row: dict, status: str, reason: str | None, counts: dict[str, int]) -> dict[str, Any]:
    """Fixe l'état final de la ligne. Un journal en panne ne doit jamais faire échouer l'alerte."""
    update = {"status": status, "reason": reason, "updated_at": _now(), **counts,
              "attempts": int(row.get("attempts") or 0) + 1}
    try:
        await db.alert_log.update_one({"_id": row["_id"]}, {"$set": update})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Journal des alertes injoignable (%s)", type(exc).__name__)
    return _result(row, status, reason, counts)


async def _send_push(payload: dict) -> tuple[str, str | None, dict[str, int]]:
    """Un canal = (état, raison, compteurs). Les erreurs du canal restent des états, jamais des exceptions."""
    counts = {"targeted": 0, "sent": 0, "removed": 0, "failed": 0}
    if not push.configured():
        return "skipped", "vapid_not_configured", counts
    try:
        dispatched = await push.dispatch_to_admins(payload)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Envoi Push impossible (%s)", type(exc).__name__)
        return "failed", "send_error", counts
    counts.update(targeted=dispatched["targeted"], sent=dispatched["sent"],
                  removed=dispatched["expired"], failed=dispatched["failed"])
    if not counts["targeted"]:
        return "skipped", "no_subscription", counts
    if counts["sent"]:
        return "sent", None, counts
    if counts["failed"]:
        reasons = dispatched.get("reasons") or ["send_error"]
        return "failed", reasons[0], counts
    return "failed", "subscription_gone", counts


async def _deliver(row: dict, payload: dict | None = None) -> dict[str, Any]:
    """Livre une ligne du journal (création ou reprise). Écrit l'état final, ne lève jamais."""
    if payload is None:
        known = RETRY_ALERTS.get(row.get("event") or "")
        payload = {"title": "Magic Game Store", "body": known[0], "url": known[1]} if known else None
        if payload is None:
            return await _close(row, "skipped", "unknown_event", {"targeted": 0, "sent": 0, "removed": 0, "failed": 0})
    status, reason, counts = await _send_push(payload)
    return await _close(row, status, reason, counts)


async def notify_admin(event: str, title: str, body: str, url: str, dedupe_key: str | None = None,
                       order_ref: str | None = None, tag: str | None = None) -> dict[str, Any]:
    """Alerte les administrateurs, en journalisant la tentative. Ne lève jamais.

    Args:
        event: Nom stable de l'événement (`order_created`, `chat_message`, `test`, …).
        title/body/url: Contenu affiché par l'appareil (jamais stocké dans le journal).
        dedupe_key: Clé optionnelle : un même événement+clé n'est jamais envoyé deux fois.
        order_ref: Référence courte de commande (numéro public), jamais un nom ni un identifiant joueur.
        tag: Étiquette de regroupement côté appareil (une notification par commande / conversation).

    Returns:
        État de la tentative : `status`, `reason` et compteurs (visés/livrés/supprimés/échoués).
    """
    row = AlertLog(event=event, dedupe_key=dedupe_key, order_ref=order_ref).to_mongo()
    try:
        await db.alert_log.insert_one(row)
    except DuplicateKeyError:
        return _result(row, "skipped", "duplicate", {"targeted": 0, "sent": 0, "removed": 0, "failed": 0})
    except Exception as exc:  # type: ignore[attr-defined]
        # Journal indisponible : on alerte quand même (l'observabilité ne coupe pas les alertes).
        logger.warning("Journal des alertes injoignable (%s)", type(exc).__name__)
    return await _deliver(row, {"title": title, "body": body, "url": url,
                                **({"tag": tag} if tag else {})})


async def retry_pending(older_than_s: int = 60, limit: int = 20) -> list[dict[str, Any]]:
    """Reprend les lignes `pending` plus vieilles que `older_than_s`. Non branché (PL-NOTIF-5).

    Idempotent : une ligne reprise passe à un état final, donc une 2e passe ne la renvoie pas.
    """
    cutoff = _now() - timedelta(seconds=max(0, older_than_s))
    size = max(1, limit)
    rows = await db.alert_log.find({"status": "pending", "created_at": {"$lte": cutoff}}) \
        .sort("created_at", 1).limit(size).to_list(size)
    return [await _deliver(row) for row in rows]


async def notify_new_order(order: dict) -> None:
    """Alerte « nouvelle commande » (appelée en tâche de fond par `routers/orders.py`)."""
    ref = order.get("order_number") or order.get("id") or ""
    total = order.get("total") or 0
    await notify_admin(event="order_created", title="Magic Game Store",
                       body=f"Nouvelle commande {ref}\n{total:,} Ar".replace(",", " "),
                       url=f"/admin/commandes?order={order.get('id')}",
                       dedupe_key=f"order:{ref}" if ref else None, order_ref=ref or None,
                       tag=order.get("id"))


async def notify_new_message(conversation_id: str, sender_name: str, text: str) -> None:
    """Alerte « nouveau message client » (appelée en tâche de fond par `routers/chat.py`).

    Pas de `dedupe_key` : chaque message est un événement neuf (contrairement à une commande).
    """
    preview = text if len(text) <= 80 else text[:77] + "…"
    await notify_admin(event="chat_message", title="Magic Game Store",
                       body=f"Nouveau message de {sender_name}\n{preview}",
                       url="/admin/messages", tag=f"chat-{conversation_id}")
