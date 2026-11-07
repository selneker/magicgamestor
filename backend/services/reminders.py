"""PL-NOTIF-4 — relance des commandes payées que l'admin n'a pas encore traitées.

Critère « à relancer » : statut `paid` (argent encaissé, livraison pas encore faite) et délai
`REMINDER_AFTER_MIN` écoulé depuis le passage à `paid`. `delivered` est la sortie normale ;
`cancelled`, `failed` et `expired` ne sont jamais relancées. Une livraison automatique bloquée
(`delivery_blocked`) laisse justement la commande en `paid` : elle doit être relancée, c'est le
cas où l'action humaine est attendue.

Horodatage du passage à `paid` : `paid_at` (paiement passerelle/Binance), sinon la dernière entrée
`history` de statut `paid` (validation manuelle admin), sinon `updated_at`.

Progression entre passages : le champ optionnel `reminder_tier` (0..3) est écrit sur la commande
après chaque tentative. Il ne touche ni `status`, ni l'historique, ni un champ de paiement ; il sert
uniquement à sortir de la fenêtre de balayage les commandes ayant atteint `REMINDER_MAX`, sinon les
200 plus anciennes masqueraient indéfiniment les suivantes. Aucune migration : champ absent = 0.

Aucune donnée personnelle dans le push ni dans le journal : numéro de commande, libellé produit,
montant, ancienneté en minutes. Le module ne lève jamais vers la route appelante.
"""
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from core.db import db
from services import notifications, push

logger = logging.getLogger("mgs.reminders")

EVENT = "order_unprocessed"
TITLE = "Commande payée non traitée"
URL = "/admin/commandes"
# Paliers : N, 3N, 12N minutes. `REMINDER_MAX` en borne le nombre (0 = désactivé, plafond 3).
TIER_FACTORS = (1, 3, 12)
# Arrêt de la boucle avant le délai d'attente du cron (un envoi peut durer PUSH_TIMEOUT_S).
RUN_BUDGET_S = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(high, max(low, value))


def after_minutes() -> int:
    """Délai avant la première relance (`REMINDER_AFTER_MIN`, 10 min par défaut)."""
    return _env_int("REMINDER_AFTER_MIN", 10, 1, 7 * 24 * 60)


def max_tiers() -> int:
    """Nombre maximal de paliers (`REMINDER_MAX`, 3 par défaut, jamais plus de 3)."""
    return _env_int("REMINDER_MAX", 3, 0, len(TIER_FACTORS))


def batch_size() -> int:
    """Nombre maximal de commandes examinées par exécution (`REMINDER_BATCH`, 200 par défaut)."""
    return _env_int("REMINDER_BATCH", 200, 1, 1000)


def _as_datetime(value: Any) -> datetime | None:
    """Date BSON ou chaîne ISO -> datetime UTC. Une valeur illisible est ignorée, jamais supposée."""
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str):
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _last_history_at(order: dict, status: str) -> Any:
    for entry in reversed(order.get("history") or []):
        if isinstance(entry, dict) and entry.get("status") == status:
            return entry.get("at")
    return None


def paid_since(order: dict) -> datetime | None:
    """Moment du dernier passage à `paid`, avec repli documenté (voir docstring du module)."""
    for value in (order.get("paid_at"), _last_history_at(order, "paid"), order.get("updated_at")):
        moment = _as_datetime(value)
        if moment is not None:
            return moment
    return None


def tier_for(age_min: float, after: int, tiers: int) -> int:
    """Plus haut palier atteint (1..tiers), 0 si la commande est trop récente.

    On n'envoie que le palier courant : un cron qui rattrape une commande très ancienne ne déverse
    pas plusieurs notifications d'un coup, et une clé de déduplication par palier empêche tout doublon.
    """
    reached = 0
    for index, factor in enumerate(TIER_FACTORS[:tiers], start=1):
        if age_min >= after * factor:
            reached = index
    return reached


def _amount(order: dict) -> str:
    total = order.get("total")
    currency = order.get("currency") or "Ar"
    try:
        return f"{int(total):,} {currency}".replace(",", " ")
    except (TypeError, ValueError):
        return "montant inconnu"


def _product(order: dict) -> str:
    names = [str(item["name"]) for item in order.get("items") or [] if item.get("name")]
    return ", ".join(names[:2]) + ("…" if len(names) > 2 else "")


def _payload(order: dict, age_min: int) -> tuple[str, str, str, str]:
    """(ref, titre, corps, url) — aucune donnée client, même si le document en contient."""
    ref = str(order.get("order_number") or order.get("id") or "")
    body = " · ".join(part for part in (
        f"Commande {ref} payée depuis {age_min} min" if ref else f"Payée depuis {age_min} min",
        _product(order),
        _amount(order),
    ) if part)
    return ref, TITLE, body, f"{URL}?order={order.get('id')}"


async def run_once(now: datetime | None = None) -> dict[str, int]:
    """Un passage de relance. Retourne uniquement des compteurs ; ne lève jamais.

    `checked` = commandes examinées, `reminded` = alertes réellement envoyées, `skipped` = examinées
    sans envoi (trop récente, palier déjà envoyé, push en échec).
    """
    counts = {"checked": 0, "reminded": 0, "skipped": 0}
    after, tiers = after_minutes(), max_tiers()
    if tiers == 0:
        logger.info("Relances désactivées (REMINDER_MAX=0)")
        return counts
    if not push.configured():
        # Sans VAPID, ne pas consommer les clés de déduplication : la relance reste due.
        logger.info("Relances ignorées : Push non configuré")
        return counts

    moment = now or _now()
    started = time.monotonic()
    projection = {"_id": 0, "id": 1, "order_number": 1, "items.name": 1, "total": 1, "currency": 1,
                  "paid_at": 1, "updated_at": 1, "history": 1}
    # Les commandes ayant déjà reçu leur dernier palier sortent de la fenêtre : le balayage avance.
    query = {"status": "paid",
             "$or": [{"reminder_tier": {"$exists": False}}, {"reminder_tier": {"$lt": tiers}}]}
    # Index (status, created_at) : balayage borné des plus anciennes commandes payées.
    cursor = db.orders.find(query, projection).sort("created_at", 1).limit(batch_size())
    async for order in cursor:
        if time.monotonic() - started > RUN_BUDGET_S:
            logger.info("Budget de relance atteint, suite au prochain passage")
            break
        counts["checked"] += 1
        try:
            since = paid_since(order)
            age_min = int((moment - since).total_seconds() // 60) if since else -1
            tier = tier_for(age_min, after, tiers) if since else 0
            if tier == 0:
                counts["skipped"] += 1
                continue
            ref, title, body, url = _payload(order, max(0, age_min))
            result = await notifications.notify_admin(
                event=EVENT, title=title, body=body, url=url,
                dedupe_key=f"remind:{ref}:{tier}", order_ref=ref or None, tag=order.get("id"))
            if result.get("status") == "sent":
                counts["reminded"] += 1
            else:
                counts["skipped"] += 1
            # Même en échec ou en doublon, le palier est consommé (au plus une tentative par palier).
            try:
                await db.orders.update_one({"id": order.get("id"), "status": "paid"},
                                           {"$max": {"reminder_tier": tier}, "$set": {"reminded_at": moment}})
            except Exception as exc:  # le marqueur ne doit pas casser la relance
                logger.warning("Marqueur de relance non écrit (%s)", type(exc).__name__)
        except Exception as exc:  # une commande ne doit jamais interrompre le passage
            logger.warning("Relance impossible (%s)", type(exc).__name__)
            counts["skipped"] += 1
    logger.info("Relances : %s examinées, %s envoyées, %s ignorées",
                counts["checked"], counts["reminded"], counts["skipped"])
    return counts
