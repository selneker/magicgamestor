"""Loyalty points: append-only ledger + materialized user balances (earned / promo buckets) guarded by atomic updates."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.audit import audit
from core.db import db

DEFAULT_SETTINGS = {
    "key": "loyalty", "enabled": True,
    "points_per_1000_ar": 10,          # 10 pts per 1 000 Ar paid → configurable margin protection
    "min_order_total": 1000,
    "transfers_enabled": True, "transfer_min": 100, "transfer_daily_limit": 2000, "transfer_monthly_limit": 10000,
    "transfer_requires_verified_email": True, "transfer_expiry_hours": 48,
}
BUCKETS = ("earned", "promo")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def settings() -> dict:
    doc = await db.settings.find_one({"key": "loyalty"}, {"_id": 0})
    return {**DEFAULT_SETTINGS, **(doc or {})}


async def balances(user_id: str) -> dict:
    user = await db.users.find_one({"user_id": user_id}, {"loyalty": 1})
    bal = (user or {}).get("loyalty") or {}
    earned, promo = int(bal.get("earned", 0)), int(bal.get("promo", 0))
    return {"earned": earned, "promo": promo, "total": earned + promo}


def _entry(user_id: str, kind: str, amount: int, bucket: str, reference: str, reason: str, **extra) -> dict:
    return {"id": str(uuid.uuid4()), "user_id": user_id, "type": kind, "amount": int(amount), "bucket": bucket,
            "reference": reference, "reason": reason, "order_id": extra.pop("order_id", None),
            "created_by": extra.pop("created_by", "system"), "created_at": now_iso(), **extra}


async def credit(user_id: str, kind: str, amount: int, bucket: str, reference: str, reason: str, **extra) -> dict:
    if amount <= 0 or bucket not in BUCKETS:
        raise HTTPException(400, "Montant de points invalide.")
    entry = _entry(user_id, kind, amount, bucket, reference, reason, **extra)
    await db.loyalty_ledger.insert_one(entry)  # unique (type, order_id) makes 'earn' idempotent per order
    await db.users.update_one({"user_id": user_id}, {"$inc": {f"loyalty.{bucket}": amount}})
    entry.pop("_id", None)
    return entry


async def debit(user_id: str, kind: str, amount: int, bucket: str, reference: str, reason: str, **extra) -> dict:
    if amount <= 0 or bucket not in BUCKETS:
        raise HTTPException(400, "Montant de points invalide.")
    # Atomic: only succeeds if the bucket still holds enough points (no double spend under concurrency).
    res = await db.users.update_one({"user_id": user_id, f"loyalty.{bucket}": {"$gte": amount}},
                                    {"$inc": {f"loyalty.{bucket}": -amount}})
    if res.matched_count == 0:
        raise HTTPException(409, "Solde de points insuffisant.")
    entry = _entry(user_id, kind, -amount, bucket, reference, reason, **extra)
    await db.loyalty_ledger.insert_one(entry)
    entry.pop("_id", None)
    return entry


async def spend(user_id: str, kind: str, amount: int, reference: str, reason: str, **extra) -> list[dict]:
    """Spend promo points first, then earned. Returns the ledger entries written."""
    bal = await balances(user_id)
    if bal["total"] < amount:
        raise HTTPException(409, "Solde de points insuffisant.")
    entries, remaining = [], amount
    for bucket in ("promo", "earned"):
        take = min(remaining, bal[bucket])
        if take > 0:
            entries.append(await debit(user_id, kind, take, bucket, reference, reason, **extra))
            remaining -= take
    if remaining > 0:  # a concurrent spend won the race on one bucket: roll back what we took
        for e in entries:
            await credit(user_id, "rollback", -e["amount"], e["bucket"], reference, "Annulation (concurrence)")
        raise HTTPException(409, "Solde de points insuffisant.")
    return entries


def points_for_total(total: int, cfg: dict) -> int:
    if total < cfg.get("min_order_total", 0):
        return 0
    return int(total // 1000 * cfg.get("points_per_1000_ar", 0))


async def award_for_order(order: dict):
    cfg = await settings()
    if not cfg.get("enabled") or not order.get("user_id") or order["status"] not in ("paid", "delivered"):
        return None
    points = points_for_total(order["total"], cfg)
    if points <= 0:
        return None
    try:
        return await credit(order["user_id"], "earn", points, "earned", order["order_number"],
                            f"Achat {order['order_number']}", order_id=order["id"])
    except DuplicateKeyError:
        return None  # already awarded for this order


async def reverse_for_order(order: dict, actor: str):
    """Refund / cancellation of a paid order: claw back what was earned (may push earned bucket negative → capped)."""
    earn = await db.loyalty_ledger.find_one({"type": "earn", "order_id": order["id"]})
    if not earn or await db.loyalty_ledger.find_one({"type": "reversal", "order_id": order["id"]}):
        return None
    bal = await balances(order["user_id"])
    amount = min(earn["amount"], bal["earned"])
    if amount > 0:
        await debit(order["user_id"], "reversal", amount, "earned", order["order_number"], f"Remboursement {order['order_number']}",
                    order_id=order["id"], created_by=actor)
    else:
        await db.loyalty_ledger.insert_one(_entry(order["user_id"], "reversal", 0, "earned", order["order_number"],
                                                  f"Remboursement {order['order_number']} (solde déjà utilisé)", order_id=order["id"], created_by=actor))
    await audit("loyalty.reversal", actor, order["user_id"], {"order_id": order["id"], "points": amount})


async def transferred_since(user_id: str, since: datetime) -> int:
    pipeline = [{"$match": {"from_user_id": user_id, "created_at": {"$gte": since.isoformat()}, "status": {"$ne": "cancelled"}}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    rows = await db.loyalty_transfers.aggregate(pipeline).to_list(1)
    return rows[0]["total"] if rows else 0


async def check_transfer_limits(user_id: str, amount: int, cfg: dict):
    now = datetime.now(timezone.utc)
    if amount < cfg["transfer_min"]:
        raise HTTPException(400, f"Transfert minimum : {cfg['transfer_min']} points.")
    if await transferred_since(user_id, now - timedelta(days=1)) + amount > cfg["transfer_daily_limit"]:
        raise HTTPException(429, "Limite quotidienne de transfert atteinte.")
    if await transferred_since(user_id, now - timedelta(days=30)) + amount > cfg["transfer_monthly_limit"]:
        raise HTTPException(429, "Limite mensuelle de transfert atteinte.")
