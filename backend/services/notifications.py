"""Envoi unifié des alertes admin (PL-NOTIF-1) : journal `alert_log` + canal push.

Une ligne de journal est écrite en `pending` AVANT l'envoi, puis passée en `sent`, `failed` ou
`skipped` : une coupure du processus laisse une trace au lieu d'une alerte silencieusement perdue.
`notify_admin` ne lève jamais — l'issue d'une commande ou d'un message client ne dépend jamais de
l'alerte. Le canal Telegram (PL-NOTIF-5) est un second canal indépendant : sa propre ligne de
journal, sa propre clé de déduplication, et l'échec de l'un ne change jamais le statut de l'autre.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo.errors import DuplicateKeyError

from core.db import db
from models.notification import AlertLog
from services import push, telegram

logger = logging.getLogger("mgs.notifications")

# Canaux d'alerte. Un canal = un nom ici + un `_send_<canal>` ; le journal garde une ligne par canal.
CHANNELS = ("push", "telegram")
ZERO_COUNTS = {"targeted": 0, "sent": 0, "removed": 0, "failed": 0}
DEFAULT_LOG_TTL_DAYS = 30

# Reprise (`retry_pending`) : la charge utile n'est pas stockée (aucune donnée de client dans le
# journal), donc le contenu est reconstruit au plus court depuis l'événement.
RETRY_ALERTS = {
    "order_created": ("Nouvelle commande (rappel)", "/admin/commandes"),
    "chat_message": ("Nouveau message client (rappel)", "/admin/messages"),
    "test": ("Test des notifications (rappel)", "/admin/commandes"),
    "order_paid": ("Commande payée (rappel)", "/admin/commandes"),
    "order_unprocessed": ("Commande payée non traitée (rappel)", "/admin/commandes"),
    "payment_failed": ("Paiement échoué (rappel)", "/admin/commandes"),
    "payment_expired": ("Paiement expiré (rappel)", "/admin/commandes"),
    "delivery_blocked": ("Livraison bloquée (rappel)", "/admin/commandes"),
    "crypto_unmatched": ("Dépôt crypto non rapproché (rappel)", "/admin/paiements"),
    "amount_mismatch": ("Écart de montant (rappel)", "/admin/commandes"),
    "late_success": ("Succès tardif — revue manuelle (rappel)", "/admin/commandes"),
    "proof_submitted": ("Preuve de paiement reçue (rappel)", "/admin/commandes"),
    "proof_remind": ("Relance client sur preuve (rappel)", "/admin/commandes"),
    "proof_storage_full": ("Stockage des preuves saturé (rappel)", "/admin/commandes"),
    "proof_db_full": ("Base MongoDB saturée (rappel)", "/admin/commandes"),
    "storage_warning": ("Stockage bientôt saturé (rappel)", "/admin/commandes"),
    "stock_unavailable": ("Produit devenu indisponible (rappel)", "/admin/catalogue"),
    "stock_restored": ("Produit de nouveau disponible (rappel)", "/admin/catalogue"),
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
        # Des abonnements existent mais aucun n'appartient à un admin : ce n'est pas « aucun abonnement ».
        return "skipped", ("no_admin_subscription" if dispatched.get("ignored") else "no_subscription"), counts
    if counts["sent"]:
        return "sent", None, counts
    if counts["failed"]:
        reasons = dispatched.get("reasons") or ["send_error"]
        return "failed", reasons[0], counts
    return "failed", "subscription_gone", counts


async def _send_telegram(payload: dict) -> tuple[str, str | None, dict[str, int]]:
    """Canal de secours : texte brut, un seul destinataire, aucune exception ne remonte."""
    counts = dict(ZERO_COUNTS)
    text = telegram.format_message(payload.get("title"), payload.get("body"))
    status, reason = await telegram.send_message(text)
    if status == "sent":
        counts.update(targeted=1, sent=1)
    elif status == "failed":
        counts.update(targeted=1, failed=1)
    return status, reason, counts


def _send_for(channel: str, payload: dict) -> Any:
    """Un canal = une fonction d'envoi. Un nom inconnu est une erreur de programmation, pas un secret."""
    return _send_telegram(payload) if channel == "telegram" else _send_push(payload)


async def _deliver(row: dict, payload: dict | None = None) -> dict[str, Any]:
    """Livre une ligne du journal (création ou reprise) sur SON canal. Écrit l'état final, ne lève jamais."""
    if payload is None:
        known = RETRY_ALERTS.get(row.get("event") or "")
        payload = {"title": "Magic Game Store", "body": known[0], "url": known[1]} if known else None
        if payload is None:
            return await _close(row, "skipped", "unknown_event", dict(ZERO_COUNTS))
    status, reason, counts = await _send_for(row.get("channel") or "push", payload)
    return await _close(row, status, reason, counts)


async def _open_channel(row: dict, payload: dict) -> dict[str, Any]:
    """Écrit la ligne `pending` puis livre. Un doublon est propre au canal (clé distincte)."""
    try:
        await db.alert_log.insert_one(row)
    except DuplicateKeyError:
        return _result(row, "skipped", "duplicate", dict(ZERO_COUNTS))
    except Exception as exc:  # type: ignore[attr-defined]
        # Journal indisponible : on alerte quand même (l'observabilité ne coupe pas les alertes).
        logger.warning("Journal des alertes injoignable (%s)", type(exc).__name__)
    return await _deliver(row, payload)


async def notify_admin(event: str, title: str, body: str, url: str, dedupe_key: str | None = None,
                       order_ref: str | None = None, tag: str | None = None,
                       include_channels: bool = False) -> dict[str, Any]:
    """Alerte les administrateurs, en journalisant la tentative par canal. Ne lève jamais.

    Args:
        event: Nom stable de l'événement (`order_created`, `chat_message`, `test`, …).
        title/body/url: Contenu affiché par l'appareil (jamais stocké dans le journal).
        dedupe_key: Clé optionnelle : un même événement+clé n'est jamais envoyé deux fois par canal.
        order_ref: Référence courte de commande (numéro public), jamais un nom ni un identifiant joueur.
        tag: Étiquette de regroupement côté appareil (une notification par commande / conversation).
        include_channels: Ajoute le résultat du canal Telegram à la réponse (`/admin/notifications/test`).

    Returns:
        État de la tentative Push : `status`, `reason` et compteurs (visés/livrés/supprimés/échoués).
        Avec `include_channels`, la même forme sous `telegram` pour le canal de secours.
    """
    payload = {"title": title, "body": body, "url": url, **({"tag": tag} if tag else {})}
    push_row = AlertLog(event=event, dedupe_key=dedupe_key, order_ref=order_ref).to_mongo()
    # Les deux canaux sont indépendants : une clé préfixée par canal évite de modifier l'index
    # unique existant `(event, dedupe_key)` et n'altère aucune ligne push déjà écrite.
    tasks = [_open_channel(push_row, payload)]
    if telegram.enabled_for(event):
        telegram_row = AlertLog(event=event, channel="telegram", order_ref=order_ref,
                                dedupe_key=f"tg:{dedupe_key}" if dedupe_key else None).to_mongo()
        tasks.append(_open_channel(telegram_row, payload))
    results = await asyncio.gather(*tasks)
    result = results[0]
    if not include_channels:
        return result
    if len(results) > 1:
        telegram_result = {"status": results[1]["status"], "reason": results[1]["reason"]}
    else:
        reason = "telegram_not_configured" if not telegram.configured() else "event_disabled"
        telegram_result = {"status": "skipped", "reason": reason}
    return {**result, "telegram": telegram_result}


async def retry_pending(older_than_s: int = 60, limit: int = 20) -> list[dict[str, Any]]:
    """Reprend les lignes `pending` plus vieilles que `older_than_s`. Non branché en production.

    Chaque ligne est livrée sur son propre canal (`channel` du journal) : une ligne Telegram
    interrompue est donc reprise sans toucher au Push, et inversement.
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


# --------------------------------------------------------------------------- #
# PL-NOTIF-3 — alertes des événements critiques (paiement, livraison, crypto).
#
# Chaque appel est planifié APRÈS l'écriture de l'état (voir `schedule`), ne lève jamais et ne
# contient aucune donnée personnelle : au plus un numéro de commande court, un libellé produit,
# un montant, une passerelle et un motif court.
# --------------------------------------------------------------------------- #
# Sources internes : une simulation de test ou une validation faite par l'admin ne sont pas des
# événements à pousser — l'admin est déjà devant son écran.
INTERNAL_PAYMENT_SOURCES = ("simulation", "manual")
ADMIN_ORDERS_URL = "/admin/commandes"
ADMIN_PAYMENTS_URL = "/admin/paiements"
ADMIN_CATALOG_URL = "/admin/catalogue"

# Motifs Binance -> libellé admin court (les slugs internes ne sont jamais affichés).
CRYPTO_REASONS = {
    "duplicate_tx": "transaction en double",
    "wrong_network": "mauvais réseau",
    "wrong_address": "adresse incorrecte",
    "wrong_memo": "mémo incorrect",
    "payment_expired": "paiement expiré",
    "amount_not_matching": "montant non concordant",
    "outside_payment_window": "hors fenêtre de paiement",
    "rejected_by_binance": "dépôt rejeté par Binance",
    "unsupported_network": "réseau non pris en charge",
    "unknown_transaction": "transaction inconnue",
    "expired": "paiement expiré, aucun dépôt reçu",
    "detected_not_credited": "dépôt détecté mais non crédité",
}


def _is_internal(source: str | None) -> bool:
    source = source or ""
    return source in INTERNAL_PAYMENT_SOURCES or source.startswith("admin:")


def _amount(total: Any) -> str:
    try:
        return f"{int(total):,} Ar".replace(",", " ")
    except (TypeError, ValueError):
        return "montant inconnu"


def _line(*parts: str | None) -> str:
    return " · ".join(str(part) for part in parts if part)


async def _product_label(order_id: str) -> str:
    """Libellé catalogue (jamais un pseudo ni un identifiant de joueur), vide si illisible."""
    try:
        order = await db.orders.find_one({"id": order_id}, {"_id": 0, "items.name": 1})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Libellé produit illisible (%s)", type(exc).__name__)
        return ""
    names = [str(item["name"]) for item in (order or {}).get("items") or [] if item.get("name")]
    return ", ".join(names[:2]) + ("…" if len(names) > 2 else "")


async def _critical(event: str, title: str, body: str, url: str, dedupe_key: str | None,
                    order_ref: str | None = None, tag: str | None = None) -> None:
    """Alerte critique : journal + push, et aucune exception ne remonte à l'appelant."""
    try:
        await notify_admin(event=event, title=title, body=body, url=url, dedupe_key=dedupe_key,
                           order_ref=order_ref, tag=tag)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Alerte %s non envoyée (%s)", event, type(exc).__name__)


async def notify_order_paid(order_id: str, ref: str, total: Any, gateway: str | None, source: str) -> None:
    """Commande réellement passée à « payée » (jamais une simulation ni une validation admin)."""
    if _is_internal(source):
        return
    ref = ref or order_id
    await _critical("order_paid", "Commande payée",
                    _line(f"Commande {ref} payée", _amount(total), await _product_label(order_id), gateway),
                    ADMIN_ORDERS_URL, f"paid:{ref}", order_ref=ref, tag=order_id)


async def notify_payment_failed(order_id: str, ref: str, gateway: str | None, source: str) -> None:
    """Paiement échoué ou refusé par la passerelle."""
    if _is_internal(source):
        return
    ref = ref or order_id
    await _critical("payment_failed", "Paiement échoué",
                    _line(f"Commande {ref} : paiement refusé", gateway),
                    ADMIN_ORDERS_URL, f"payfail:{ref}", order_ref=ref, tag=order_id)


def _payment_expired_enabled() -> bool:
    """`ALERT_PAYMENT_EXPIRED` lu à l'appel : une tentative abandonnée est du bruit, pas une alerte."""
    return os.environ.get("ALERT_PAYMENT_EXPIRED", "").strip().lower() in ("1", "true", "yes", "on")


async def notify_payment_expired(order_id: str, ref: str, gateway: str | None, source: str) -> None:
    """Paiement expiré avant règlement (silencieux sauf si `ALERT_PAYMENT_EXPIRED` est vrai)."""
    if _is_internal(source) or not _payment_expired_enabled():
        return
    ref = ref or order_id
    await _critical("payment_expired", "Paiement expiré",
                    _line(f"Commande {ref} : paiement expiré", gateway),
                    ADMIN_ORDERS_URL, f"payexp:{ref}", order_ref=ref, tag=order_id)


async def notify_late_success(order_id: str, ref: str, gateway: str | None) -> None:
    """Succès reçu après l'échéance interne : revue manuelle obligatoire."""
    ref = ref or order_id
    await _critical("late_success", "Succès tardif",
                    _line(f"Commande {ref} : succès tardif, revue manuelle", gateway),
                    ADMIN_ORDERS_URL, f"mismatch:{ref}", order_ref=ref, tag=order_id)


async def notify_amount_mismatch(order_id: str, ref: str, gateway: str | None) -> None:
    """Montant reçu différent du montant attendu."""
    ref = ref or order_id
    await _critical("amount_mismatch", "Écart de montant",
                    _line(f"Commande {ref} : montant reçu différent", gateway),
                    ADMIN_ORDERS_URL, f"mismatch:{ref}", order_ref=ref, tag=order_id)


async def notify_delivery_blocked(order_id: str | None, ref: str | None, code: str, motif: str) -> None:
    """Livraison automatique refusée ou échouée (`code` court et stable, sans identité)."""
    ref = str(ref or order_id or "")
    await _critical("delivery_blocked", "Livraison bloquée",
                    _line(f"Commande {ref}" if ref else "Commande", motif),
                    ADMIN_ORDERS_URL, f"delblock:{ref}:{code}", order_ref=ref or None, tag=order_id)


# --------------------------------------------------------------------------- #
# PL-STOCK-1 — disponibilité fournisseur : une alerte par TRANSITION, jamais par cycle.
# Aucun nom de fournisseur, aucun identifiant technique : le libellé produit suffit à l'admin.
# --------------------------------------------------------------------------- #
async def notify_stock_unavailable(product_name: str, product_id: str) -> None:
    """Produit devenu non achetable (rupture constatée à la livraison)."""
    await _critical("stock_unavailable", "Produit indisponible",
                    _line(product_name, "Rupture de stock fournisseur", "Retiré de la vente"),
                    ADMIN_CATALOG_URL, None, tag=product_id or None)


async def notify_stock_restored(product_name: str, product_id: str) -> None:
    """Produit redevenu achetable automatiquement (état fournisseur périmé remis à « inconnu »)."""
    await _critical("stock_restored", "Produit de nouveau disponible",
                    _line(product_name, "De nouveau proposé à la vente"),
                    ADMIN_CATALOG_URL, None, tag=product_id or None)


async def notify_crypto_unmatched(reason: str, amount: Any = None, coin: str | None = None,
                                  short_ref: str = "") -> None:
    """Dépôt Binance non rapproché, non crédité ou expiré (aucune adresse, aucun tx complet)."""
    money = f"{amount} {coin}" if amount is not None and coin else "montant inconnu"
    await _critical("crypto_unmatched", "Dépôt crypto non rapproché",
                    _line(CRYPTO_REASONS.get(reason, "dépôt non rapproché"), money),
                    ADMIN_PAYMENTS_URL, f"crypto:{short_ref}" if short_ref else None)


# --------------------------------------------------------------------------- #
# PL-ORDER-PROOF-1 — preuves de paiement manuel.
# --------------------------------------------------------------------------- #
async def notify_proof_submitted(order_id: str, ref: str | None, total: Any, count: int) -> None:
    """1 à 3 captures reçues pour une commande manuelle : l'admin doit les vérifier."""
    ref = str(ref or order_id or "")
    await _critical("proof_submitted", "Preuve de paiement reçue",
                    _line(f"Commande {ref} : {int(count)} preuve(s) à vérifier", _amount(total),
                          await _product_label(order_id)),
                    ADMIN_ORDERS_URL, f"proof:{ref}", order_ref=ref or None, tag=order_id)


async def notify_proof_remind(order_id: str, ref: str | None, count: int, left: int) -> None:
    """Le client relance l'admin sur une preuve déjà envoyée (3 min d'attente, 3 relances)."""
    ref = str(ref or order_id or "")
    await _critical("proof_remind", "Relance client — preuve en attente",
                    _line(f"Commande {ref} : relance {int(count)}/3", f"{int(left)} restante(s)"),
                    ADMIN_ORDERS_URL, f"proofremind:{ref}:{int(count)}", order_ref=ref or None,
                    tag=order_id)


async def notify_proof_storage_full(used_bytes: int, limit_bytes: int) -> None:
    """Quota des preuves dépassé : les envois sont refusés jusqu'à la purge des images anciennes."""
    used_mb = max(0, int(used_bytes)) / (1024 * 1024)
    limit_mb = max(0, int(limit_bytes)) / (1024 * 1024)
    await _critical("proof_storage_full", "Stockage des preuves saturé",
                    _line(f"Preuves : {used_mb:.0f} Mo / {limit_mb:.0f} Mo",
                          "Nouveaux envois refusés", "Libérez de la place ou augmentez PROOF_MAX_TOTAL_MB"),
                    ADMIN_ORDERS_URL, "proofstorage:full")


# --------------------------------------------------------------------------- #
# PL-PROOF-QUOTA-1 — la base ENTIÈRE (Atlas gratuit = 512 Mo tout compris).
# --------------------------------------------------------------------------- #
async def notify_proof_db_full(db_bytes: int, limit_bytes: int) -> None:
    """Base au-delà de `PROOF_DB_MAX_MB` : les envois de preuve sont refusés, pas les commandes."""
    used_mb = max(0, int(db_bytes)) / (1024 * 1024)
    limit_mb = max(0, int(limit_bytes)) / (1024 * 1024)
    await _critical("proof_db_full", "Base MongoDB saturée",
                    _line(f"Base : {used_mb:.0f} Mo / {limit_mb:.0f} Mo",
                          "Nouveaux envois de preuve refusés",
                          "Purgez les preuves ou augmentez PROOF_DB_MAX_MB"),
                    ADMIN_ORDERS_URL, "proofdb:full")


async def notify_storage_warning(db_bytes: int | None, db_limit_bytes: int, proofs_bytes: int,
                                 proofs_limit_bytes: int, day: str) -> None:
    """Alerte précoce quotidienne : base proche du plafond ou preuves à 80 % de leur quota."""
    db_used = max(0, int(db_bytes or 0)) / (1024 * 1024)
    db_limit = max(0, int(db_limit_bytes)) / (1024 * 1024)
    proofs_used = max(0, int(proofs_bytes)) / (1024 * 1024)
    proofs_limit = max(0, int(proofs_limit_bytes)) / (1024 * 1024)
    percent = round(100 * int(proofs_bytes) / int(proofs_limit_bytes)) if proofs_limit_bytes else 0
    await _critical("storage_warning", "Stockage bientôt saturé",
                    _line(f"Base : {db_used:.0f} Mo / {db_limit:.0f} Mo",
                          f"Preuves : {proofs_used:.0f} Mo / {proofs_limit:.0f} Mo ({percent} %)",
                          "Baissez PROOF_RETENTION_DAYS ou purgez les preuves"),
                    ADMIN_ORDERS_URL, f"storage:warn:{day}")


# --------------------------------------------------------------------------- #
# PL-ORDER-CLIENT-1 — notifications au CLIENT (avertissement et expiration).
#
# Aucun journal `alert_log` ici : c'est le journal des alertes ADMIN, et il ne doit pas se
# remplir de lignes clients. Le seul canal existant pour un client est le Push déjà en place
# (`push_subscriptions` par `user_id`), donc une commande invitée (`user_id` absent) ne reçoit
# rien : il n'existe aujourd'hui aucun abonnement client sans compte. Une panne d'envoi est
# journalisée (type d'exception seulement) et ne remonte jamais.
# --------------------------------------------------------------------------- #
FR = "fr"
EN = "en"
CUSTOMER_ORDERS_URL = "/orders/{order_id}"


async def _customer_language(user_id: str | None) -> str:
    """Langue du client si elle est réellement stockée (`language`/`locale`/`lang`), sinon FR."""
    if not user_id:
        return FR
    try:
        user = await db.users.find_one({"user_id": user_id},
                                       {"_id": 0, "language": 1, "locale": 1, "lang": 1})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Langue du client illisible (%s)", type(exc).__name__)
        return FR
    for field in ("language", "locale", "lang"):
        value = str((user or {}).get(field) or "").strip().lower().replace("_", "-")
        if value.startswith("en"):
            return EN
        if value.startswith("fr"):
            return FR
    return FR


async def _notify_customer(user_id: str | None, payload: dict) -> dict[str, Any]:
    """Push à un seul client ; ne journalise pas dans `alert_log` et ne lève jamais.

    Sans `user_id` (commande invitée) ou sans abonnement, rien n'est envoyé : les compteurs
    renvoyés le disent (`targeted: 0`), sans exception ni alerte admin parasite.
    """
    counts = {"targeted": 0, "sent": 0, "expired": 0, "failed": 0, "ignored": 0, "reasons": []}
    if not user_id:
        return counts
    if not push.configured():
        return counts
    try:
        return await push.dispatch_to_users([user_id], payload)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Notification client non envoyée (%s)", type(exc).__name__)
        return counts


def _customer_body(language: str, items_label: str, total: Any, ref: str, expiring: bool,
                   minutes: int) -> tuple[str, str]:
    product = items_label or ("votre commande" if language != EN else "your order")
    money = _amount(total)
    if language == EN:
        if expiring:
            return (f"You have {int(minutes)} minutes left to pay",
                    f"{product} — {money}. Order {ref}: complete the payment before it expires.")
        return ("Your order has expired",
                f"{product} — {money}. Order {ref} expired without payment.")
    if expiring:
        return (f"Il vous reste {int(minutes)} minutes pour payer",
                f"{product} — {money}. Commande {ref} : finalisez le paiement avant l'expiration.")
    return ("Votre commande a expiré",
            f"{product} — {money}. Commande {ref} expirée, aucun paiement reçu.")


async def _notify_customer_deadline(event: str, order_id: str, ref: str | None, total: Any,
                                    items_label: str, game_id: str | None, user_id: str | None,
                                    expiring: bool, minutes: int = 0) -> dict[str, Any]:
    """Construit et envoie la notification client ; le corps ne porte aucune identité de joueur."""
    language = await _customer_language(user_id)
    title, body = _customer_body(language, items_label, total, str(ref or order_id or ""),
                                 expiring, minutes)
    payload = {"title": title, "body": body,
               "url": CUSTOMER_ORDERS_URL.format(order_id=order_id), "tag": str(order_id or event)}
    if game_id:
        payload["game"] = game_id
    return await _notify_customer(user_id, payload)


async def notify_customer_payment_expiring(order_id: str, ref: str | None, total: Any,
                                           items_label: str = "", game_id: str | None = None,
                                           user_id: str | None = None, minutes: int = 5) -> None:
    """`payment_expiring` : une seule fois par commande, ≤ `ORDER_EXPIRY_WARN_MIN` minutes restantes."""
    await _notify_customer_deadline("payment_expiring", order_id, ref, total, items_label,
                                    game_id, user_id, expiring=True, minutes=minutes)


async def notify_customer_payment_expired(order_id: str, ref: str | None, total: Any,
                                          items_label: str = "", game_id: str | None = None,
                                          user_id: str | None = None) -> None:
    """`payment_expired` : une seule fois, à l'expiration (réglage admin `ALERT_PAYMENT_EXPIRED` ignoré)."""
    await _notify_customer_deadline("payment_expired", order_id, ref, total, items_label,
                                    game_id, user_id, expiring=False)


_DETACHED: set["asyncio.Task"] = set()


def _detached_done(task: "asyncio.Task") -> None:
    _DETACHED.discard(task)
    if not task.cancelled() and task.exception() is not None:
        logger.warning("Alerte détachée en échec (%s)", type(task.exception()).__name__)


def schedule(background: Any | None, func, *args) -> None:
    """Planifie une alerte sans l'attendre : `BackgroundTasks` si présent, sinon tâche détachée.

    Une alerte ne doit jamais retarder ni modifier une réponse HTTP ; une panne de planification
    est journalisée et rien ne remonte à l'appelant.
    """
    try:
        if background is not None:
            background.add_task(func, *args)
            return
        task = asyncio.get_running_loop().create_task(func(*args))
        _DETACHED.add(task)
        task.add_done_callback(_detached_done)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Alerte non planifiée (%s)", type(exc).__name__)


async def flush_detached() -> None:
    """Attend les alertes détachées en cours (arrêt propre, tests)."""
    while _DETACHED:
        await asyncio.gather(*list(_DETACHED), return_exceptions=True)
