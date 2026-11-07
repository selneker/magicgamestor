"""BinancePaymentWatcher: matches Binance CEX USDT deposits to open CryptoPayments, then reuses the existing paid flow."""
import asyncio
import logging
import math
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.audit import audit
from core.db import db
from services import binance, crypto, notifications
from services.fulfillment import on_order_paid

logger = logging.getLogger("mgs.binance_watcher")
POLL_INTERVAL_S = 30
MIN_GAP_S = 10
LOOKBACK = timedelta(hours=6)
LOOKBACK_MAX_ENV = "BINANCE_LOOKBACK_MAX_H"
DEFAULT_LOOKBACK_MAX_H = 48
DETECTED_GRACE = timedelta(hours=2)
CASE_INSENSITIVE = ("BEP20", "APTOS")  # hex addresses
_lock = asyncio.Lock()
_last = {"at": 0.0}


def _ms(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1000)


def _started_at(value) -> datetime | None:
    """`created_at` normalisé en UTC ; None si illisible (le repli décide alors de la fenêtre)."""
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value))
        except (TypeError, ValueError):
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def lookback_max() -> timedelta:
    """Plafond de la fenêtre : `BINANCE_LOOKBACK_MAX_H` heures (48 par défaut), jamais moins de `LOOKBACK`."""
    try:
        hours = float(os.environ.get(LOOKBACK_MAX_ENV, DEFAULT_LOOKBACK_MAX_H))
    except (TypeError, ValueError):
        hours = DEFAULT_LOOKBACK_MAX_H
    if not math.isfinite(hours) or hours <= 0:  # inf, nan, 0 ou négatif -> défaut
        hours = DEFAULT_LOOKBACK_MAX_H
    return timedelta(hours=max(hours, LOOKBACK.total_seconds() / 3600))


async def search_since(now: datetime | None = None) -> datetime:
    """Borne basse de la recherche de dépôts : `now - LOOKBACK` élargie au plus ancien paiement ouvert.

    Sans élargissement, un dépôt arrivé pendant une veille de l'hébergeur (Render Free) sort de la
    fenêtre de 6 h et n'est jamais rapproché. La borne ne dépasse jamais `lookback_max()` et toute
    lecture en échec retombe sur `now - LOOKBACK` : cette fonction ne lève jamais.
    """
    reference = now or crypto.now()
    fallback = reference - LOOKBACK
    try:
        # Index `(status, expires_at)` : filtré sur le statut, tri sur les seuls paiements ouverts (peu nombreux).
        oldest = await db.crypto_payments.find_one(
            {"status": {"$in": list(crypto.OPEN)}}, {"_id": 0, "created_at": 1}, sort=[("created_at", 1)])
    except Exception as exc:  # une lecture cassée ne doit jamais arrêter le watcher
        logger.warning("Binance search window unavailable (%s)", type(exc).__name__)
        return fallback
    started = _started_at((oldest or {}).get("created_at"))
    if started is None:
        return fallback
    return max(reference - lookback_max(), min(fallback, started))


def _amount_key(raw) -> str | None:
    try:
        d = Decimal(str(raw))
    except InvalidOperation:
        return None
    return crypto.fmt(d) if d == d.quantize(crypto.STEP) else None


def _same_address(network: str, a: str | None, b: str | None) -> bool:
    a, b = (a or "").strip(), (b or "").strip()
    return a.lower() == b.lower() if network in CASE_INSENSITIVE else a == b


async def _unmatched(dep: dict, reason: str, payment_id: str | None = None) -> str:
    try:
        await db.crypto_unmatched.insert_one({
            "id": str(uuid.uuid4()), "deposit_key": str(dep.get("id") or dep.get("txId")), "tx_hash": dep.get("txId"),
            "network": dep.get("network"), "coin": dep.get("coin"), "amount": dep.get("amount"), "address": dep.get("address"),
            "address_tag": dep.get("addressTag"), "binance_status": dep.get("status"), "insert_time": dep.get("insertTime"),
            "reason": reason, "payment_id": payment_id, "reviewed": False, "created_at": crypto.iso()})
        logger.warning("Unmatched Binance deposit %s (%s) — admin review", dep.get("txId"), reason)
    except DuplicateKeyError:
        pass
    notifications.schedule(None, notifications.notify_crypto_unmatched,
                           reason, dep.get("amount"), dep.get("coin"),
                           str(dep.get("id") or dep.get("txId") or "")[:16])
    return reason


async def _fail(payment: dict, reason: str):
    res = await db.crypto_payments.update_one(
        {"id": payment["id"], "status": payment["status"]},
        {"$set": {"status": crypto.FAILED, "failure_reason": reason, "updated_at": crypto.iso()}, "$unset": {"slot_open": ""},
         "$push": {"history": {"status": crypto.FAILED, "reason": reason, "at": crypto.iso()}}})
    if res.modified_count != 1:
        return
    from routers.orders import release_subscription_locks
    from routers.payments import _set_order_status
    if await _set_order_status(payment["order_id"], "expired", ("pending_payment",)):
        await release_subscription_locks(payment["order_id"])
    await audit("crypto.failed", "binance-watcher", payment["order_id"], {"payment_id": payment["id"], "reason": reason})
    notifications.schedule(None, notifications.notify_crypto_unmatched,
                           reason, payment.get("amount_usdt"), "USDT", str(payment["id"])[:16])


async def expire_due():
    async for p in db.crypto_payments.find({"status": crypto.WAITING, "expires_at": {"$lte": crypto.iso()}}, crypto.PUBLIC):
        await _fail(p, "expired")
    cutoff = crypto.iso(crypto.now() - DETECTED_GRACE)
    async for p in db.crypto_payments.find({"status": crypto.DETECTED, "expires_at": {"$lte": cutoff}}, crypto.PUBLIC):
        await _fail(p, "detected_not_credited")


async def _detect(payment: dict, dep: dict) -> str:
    try:
        await db.crypto_payments.update_one(
            {"id": payment["id"], "status": crypto.WAITING},
            {"$set": {"status": crypto.DETECTED, "tx_hash": dep["txId"], "deposit_id": str(dep.get("id")), "detected_at": crypto.iso(),
                      "binance_status": dep.get("status"), "updated_at": crypto.iso()},
             "$push": {"history": {"status": crypto.DETECTED, "at": crypto.iso()}}})
    except DuplicateKeyError:
        return await _unmatched(dep, "duplicate_tx", payment["id"])
    return "detected"


async def _confirm(payment: dict, dep: dict) -> str:
    tx = dep["txId"]
    try:
        won = await db.crypto_payments.find_one_and_update(
            {"id": payment["id"], "status": {"$in": list(crypto.OPEN)}, "tx_hash": {"$in": [None, tx]}},
            {"$set": {"status": crypto.CONFIRMED, "tx_hash": tx, "deposit_id": str(dep.get("id")), "confirmed_at": crypto.iso(),
                      "binance_status": dep.get("status"), "received_usdt": str(dep.get("amount")), "updated_at": crypto.iso()},
             "$unset": {"slot_open": ""}, "$push": {"history": {"status": crypto.CONFIRMED, "at": crypto.iso()}}},
            projection=crypto.PUBLIC, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        return await _unmatched(dep, "duplicate_tx", payment["id"])
    if not won:
        return "ignored"
    await audit("crypto.confirmed", "binance-watcher", won["order_id"], {"payment_id": won["id"], "tx_hash": tx, "amount_usdt": won["amount_usdt"]})
    from routers.payments import _set_order_status  # existing guarded pending→paid transition
    if await _set_order_status(won["order_id"], "paid", ("pending_payment",), {"paid_attempt_ref": won["id"], "paid_at": crypto.iso()}):
        await on_order_paid(won["order_id"], won["id"], "binance")
        notifications.schedule(None, notifications.notify_order_paid,
                               won["order_id"], won.get("order_number"), won.get("amount_ar"),
                               "binance", "binance")
    else:
        await audit("crypto.confirmed_without_order_transition", "binance-watcher", won["order_id"], {"payment_id": won["id"], "tx_hash": tx})
    return "confirmed"


async def _no_candidate(dep: dict, network: str, amount: str | None) -> str:
    if amount:
        other = await db.crypto_payments.find_one({"slot_open": True, "amount_usdt": amount}, {"id": 1})
        if other:
            return await _unmatched(dep, "wrong_network", other["id"])
        late = await db.crypto_payments.find_one({"status": crypto.FAILED, "network": network, "amount_usdt": amount}, {"id": 1})
        if late:
            return await _unmatched(dep, "payment_expired", late["id"])
    if await db.crypto_payments.find_one({"slot_open": True, "network": network}, {"id": 1}):
        return await _unmatched(dep, "amount_not_matching")
    return await _unmatched(dep, "unknown_transaction")


async def process_deposit(dep: dict, min_ms: int) -> str:
    tx = dep.get("txId")
    if (dep.get("coin") or "").upper() != "USDT" or not tx or int(dep.get("insertTime") or 0) < min_ms:
        return "ignored"
    used = await db.crypto_payments.find_one({"tx_hash": tx}, crypto.PUBLIC)
    if used and used["status"] not in crypto.OPEN:
        return "duplicate"
    if await db.crypto_unmatched.find_one({"tx_hash": tx}, {"_id": 1}):
        return "already_logged"
    status = int(dep.get("status", -1))
    if status in binance.DEPOSIT_REJECTED:
        return await _unmatched(dep, "rejected_by_binance", (used or {}).get("id"))
    network = binance.NETWORK_KEYS.get((dep.get("network") or "").upper())
    if not network:
        return await _unmatched(dep, "unsupported_network")
    amount = _amount_key(dep.get("amount"))
    candidate = used or (amount and await db.crypto_payments.find_one({"slot_open": True, "network": network, "amount_usdt": amount}, crypto.PUBLIC))
    if not candidate:
        return await _no_candidate(dep, network, amount)
    if not _same_address(network, dep.get("address"), candidate["address"]):
        return await _unmatched(dep, "wrong_address", candidate["id"])
    if candidate.get("memo") and (dep.get("addressTag") or "").strip() != candidate["memo"]:
        return await _unmatched(dep, "wrong_memo", candidate["id"])
    if not (_ms(candidate["created_at"]) - 60_000 <= int(dep["insertTime"]) <= _ms(candidate["expires_at"])):
        return await _unmatched(dep, "outside_payment_window", candidate["id"])
    if status in binance.DEPOSIT_SUCCESS:
        return await _confirm(candidate, dep)
    if status in binance.DEPOSIT_PENDING:
        return "detected" if used else await _detect(candidate, dep)
    return "ignored"


async def check_once(force: bool = False) -> dict:
    if not binance.configured():
        await expire_due()
        return {"ran": False, "reason": "not_configured"}
    async with _lock:
        if not force and time.monotonic() - _last["at"] < MIN_GAP_S:
            return {"ran": False, "reason": "throttled"}
        _last["at"] = time.monotonic()
        since = await search_since()
        busy = await db.crypto_payments.find_one({"$or": [{"slot_open": True}, {"updated_at": {"$gte": crypto.iso(since)}}]}, {"_id": 1})
        results: dict[str, int] = {}
        if busy:
            min_ms = int(since.timestamp() * 1000)
            for dep in await binance.deposit_history(min_ms):
                r = await process_deposit(dep, min_ms)
                results[r] = results.get(r, 0) + 1
        await expire_due()
        return {"ran": True, "results": results}


async def safe_check(force: bool = False) -> dict:
    try:
        return await check_once(force)
    except Exception as exc:  # never break a status poll because Binance is down
        logger.warning("binance watcher check failed: %s", getattr(exc, "detail", type(exc).__name__))
        return {"ran": False, "reason": "error"}


async def run_forever():
    while True:
        await safe_check(force=True)
        await asyncio.sleep(POLL_INTERVAL_S)
