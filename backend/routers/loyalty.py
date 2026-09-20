import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core.audit import audit
from core.db import db
from core.security import get_current_user, require_admin
from services import loyalty

router = APIRouter(prefix="/loyalty", tags=["loyalty"])
PUBLIC = {"_id": 0}
REWARD_TYPES = ("uc", "discount", "bonus", "event")


class RedeemIn(BaseModel):
    reward_id: str
    pubg_id: str | None = Field(default=None, min_length=9, max_length=13)


class TransferIn(BaseModel):
    recipient_email: EmailStr
    amount: int = Field(ge=1, le=1_000_000)
    note: str | None = Field(default=None, max_length=140)


class RewardIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    type: str = Field(pattern="^(" + "|".join(REWARD_TYPES) + ")$")
    cost_points: int = Field(ge=1)
    value: int = Field(ge=0)
    description: str | None = Field(default=None, max_length=300)
    active: bool = True
    stock: int | None = Field(default=None, ge=0)


class SettingsIn(BaseModel):
    enabled: bool | None = None
    points_per_1000_ar: int | None = Field(default=None, ge=0, le=1000)
    min_order_total: int | None = Field(default=None, ge=0)
    transfers_enabled: bool | None = None
    transfer_min: int | None = Field(default=None, ge=1)
    transfer_daily_limit: int | None = Field(default=None, ge=0)
    transfer_monthly_limit: int | None = Field(default=None, ge=0)
    transfer_requires_verified_email: bool | None = None


class AdjustIn(BaseModel):
    user_email: EmailStr
    amount: int = Field(ne=0)
    bucket: str = Field(pattern="^(earned|promo)$", default="promo")
    reason: str = Field(min_length=3, max_length=200)


def _now():
    return datetime.now(timezone.utc)


@router.get("/me")
async def my_points(user=Depends(get_current_user)):
    cfg = await loyalty.settings()
    entries = await db.loyalty_ledger.find({"user_id": user["user_id"]}, PUBLIC).sort("created_at", -1).to_list(100)
    return {"balance": await loyalty.balances(user["user_id"]), "ledger": entries,
            "config": {k: cfg[k] for k in ("enabled", "points_per_1000_ar", "transfers_enabled", "transfer_min", "transfer_daily_limit", "transfer_monthly_limit", "transfer_requires_verified_email")}}


@router.get("/rewards")
async def rewards():
    return await db.loyalty_rewards.find({"active": True}, PUBLIC).sort("cost_points", 1).to_list(100)


@router.post("/redeem", status_code=201)
async def redeem(body: RedeemIn, user=Depends(get_current_user)):
    cfg = await loyalty.settings()
    if not cfg.get("enabled"):
        raise HTTPException(503, "Programme fidélité désactivé.")
    reward = await db.loyalty_rewards.find_one({"id": body.reward_id, "active": True}, PUBLIC)
    if not reward:
        raise HTTPException(404, "Récompense indisponible.")
    if reward["type"] == "uc" and not (body.pubg_id or "").isdigit():
        raise HTTPException(400, "PUBG ID requis pour recevoir des UC.")
    if reward.get("stock") is not None:
        res = await db.loyalty_rewards.update_one({"id": reward["id"], "stock": {"$gte": 1}}, {"$inc": {"stock": -1}})
        if res.matched_count == 0:
            raise HTTPException(409, "Stock épuisé.")
    redemption_id = str(uuid.uuid4())
    try:
        entries = await loyalty.spend(user["user_id"], "redeem", reward["cost_points"], redemption_id, f"Échange : {reward['name']}")
    except HTTPException:
        if reward.get("stock") is not None:
            await db.loyalty_rewards.update_one({"id": reward["id"]}, {"$inc": {"stock": 1}})
        raise
    redemption = {"id": redemption_id, "user_id": user["user_id"], "reward_id": reward["id"], "reward_name": reward["name"],
                  "reward_type": reward["type"], "value": reward["value"], "cost_points": reward["cost_points"], "pubg_id": body.pubg_id,
                  "status": "pending", "ledger_ids": [e["id"] for e in entries], "created_at": _now().isoformat()}
    await db.loyalty_redemptions.insert_one(redemption)
    await audit("loyalty.redeem", user["user_id"], redemption_id, {"reward": reward["name"], "points": reward["cost_points"]})
    redemption.pop("_id", None)
    return redemption


@router.get("/redemptions")
async def my_redemptions(user=Depends(get_current_user)):
    return await db.loyalty_redemptions.find({"user_id": user["user_id"]}, PUBLIC).sort("created_at", -1).to_list(50)


# ---------- Transfers (held until recipient accepts) ----------
@router.post("/transfers", status_code=201)
async def create_transfer(body: TransferIn, user=Depends(get_current_user)):
    cfg = await loyalty.settings()
    if not cfg.get("enabled") or not cfg.get("transfers_enabled"):
        raise HTTPException(503, "Transferts désactivés.")
    if cfg.get("transfer_requires_verified_email") and not user.get("email_verified"):
        raise HTTPException(403, "Vérifiez votre email avant de transférer des points.")
    recipient = await db.users.find_one({"email": body.recipient_email.lower(), "deleted_at": {"$exists": False}}, PUBLIC)
    if not recipient or recipient["user_id"] == user["user_id"]:
        raise HTTPException(404, "Destinataire introuvable.")
    if cfg.get("transfer_requires_verified_email") and not recipient.get("email_verified"):
        raise HTTPException(403, "Le destinataire doit avoir un email vérifié.")
    await loyalty.check_transfer_limits(user["user_id"], body.amount, cfg)
    transfer_id = str(uuid.uuid4())
    # Only EARNED points are transferable; promotional points stay with the account.
    await loyalty.debit(user["user_id"], "transfer_out", body.amount, "earned", transfer_id, f"Transfert vers {recipient['email']}")
    transfer = {"id": transfer_id, "from_user_id": user["user_id"], "from_email": user["email"], "to_user_id": recipient["user_id"],
                "to_email": recipient["email"], "amount": body.amount, "note": body.note, "status": "pending",
                "expires_at": (_now() + timedelta(hours=cfg["transfer_expiry_hours"])).isoformat(), "created_at": _now().isoformat()}
    await db.loyalty_transfers.insert_one(transfer)
    await audit("loyalty.transfer_created", user["user_id"], transfer_id, {"to": recipient["user_id"], "amount": body.amount})
    transfer.pop("_id", None)
    return transfer


@router.get("/transfers")
async def my_transfers(user=Depends(get_current_user)):
    await _expire_transfers(user["user_id"])
    docs = await db.loyalty_transfers.find({"$or": [{"from_user_id": user["user_id"]}, {"to_user_id": user["user_id"]}]}, PUBLIC).sort("created_at", -1).to_list(100)
    return docs


async def _refund(transfer: dict, reason: str):
    await loyalty.credit(transfer["from_user_id"], "transfer_refund", transfer["amount"], "earned", transfer["id"], reason)


async def _expire_transfers(user_id: str):
    cursor = db.loyalty_transfers.find({"to_user_id": user_id, "status": "pending", "expires_at": {"$lte": _now().isoformat()}}, PUBLIC)
    async for t in cursor:
        res = await db.loyalty_transfers.update_one({"id": t["id"], "status": "pending"}, {"$set": {"status": "expired", "resolved_at": _now().isoformat()}})
        if res.modified_count:
            await _refund(t, "Transfert expiré")


@router.post("/transfers/{transfer_id}/accept")
async def accept_transfer(transfer_id: str, user=Depends(get_current_user)):
    t = await db.loyalty_transfers.find_one_and_update(
        {"id": transfer_id, "to_user_id": user["user_id"], "status": "pending", "expires_at": {"$gt": _now().isoformat()}},
        {"$set": {"status": "accepted", "resolved_at": _now().isoformat()}}, projection=PUBLIC)
    if not t:
        raise HTTPException(404, "Transfert introuvable ou déjà traité.")
    await loyalty.credit(user["user_id"], "transfer_in", t["amount"], "earned", transfer_id, f"Transfert reçu de {t['from_email']}")
    await audit("loyalty.transfer_accepted", user["user_id"], transfer_id, {"amount": t["amount"]})
    return {**t, "status": "accepted"}


@router.post("/transfers/{transfer_id}/cancel")
async def cancel_transfer(transfer_id: str, user=Depends(get_current_user)):
    t = await db.loyalty_transfers.find_one_and_update(
        {"id": transfer_id, "status": "pending", "$or": [{"from_user_id": user["user_id"]}, {"to_user_id": user["user_id"]}]},
        {"$set": {"status": "cancelled", "resolved_at": _now().isoformat()}}, projection=PUBLIC)
    if not t:
        raise HTTPException(404, "Transfert introuvable ou déjà traité.")
    await _refund(t, "Transfert annulé")
    await audit("loyalty.transfer_cancelled", user["user_id"], transfer_id, {"amount": t["amount"]})
    return {**t, "status": "cancelled"}


# ---------- Admin ----------
@router.get("/admin/settings", dependencies=[Depends(require_admin)])
async def admin_settings():
    return await loyalty.settings()


@router.patch("/admin/settings")
async def admin_update_settings(body: SettingsIn, admin=Depends(require_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.settings.update_one({"key": "loyalty"}, {"$set": {**updates, "updated_at": _now().isoformat()}}, upsert=True)
        await audit("loyalty.settings_changed", admin["user_id"], "loyalty", updates)
    return await loyalty.settings()


@router.get("/admin/rewards", dependencies=[Depends(require_admin)])
async def admin_rewards():
    return await db.loyalty_rewards.find({}, PUBLIC).sort("cost_points", 1).to_list(200)


@router.post("/admin/rewards", status_code=201)
async def admin_create_reward(body: RewardIn, admin=Depends(require_admin)):
    reward = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": _now().isoformat()}
    await db.loyalty_rewards.insert_one(reward)
    await audit("loyalty.reward_created", admin["user_id"], reward["id"], {"name": body.name})
    reward.pop("_id", None)
    return reward


@router.patch("/admin/rewards/{reward_id}")
async def admin_update_reward(reward_id: str, body: RewardIn, admin=Depends(require_admin)):
    res = await db.loyalty_rewards.update_one({"id": reward_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Récompense introuvable.")
    await audit("loyalty.reward_updated", admin["user_id"], reward_id, body.model_dump())
    return await db.loyalty_rewards.find_one({"id": reward_id}, PUBLIC)


@router.get("/admin/redemptions", dependencies=[Depends(require_admin)])
async def admin_redemptions(status: str | None = None):
    query = {"status": status} if status and status != "all" else {}
    return await db.loyalty_redemptions.find(query, PUBLIC).sort("created_at", -1).to_list(300)


@router.post("/admin/redemptions/{redemption_id}/{action}")
async def admin_resolve_redemption(redemption_id: str, action: str, admin=Depends(require_admin)):
    if action not in ("fulfill", "cancel"):
        raise HTTPException(400, "Action invalide.")
    new_status = "fulfilled" if action == "fulfill" else "cancelled"
    r = await db.loyalty_redemptions.find_one_and_update({"id": redemption_id, "status": "pending"},
                                                          {"$set": {"status": new_status, "resolved_at": _now().isoformat(), "resolved_by": admin["user_id"]}}, projection=PUBLIC)
    if not r:
        raise HTTPException(404, "Échange introuvable ou déjà traité.")
    if new_status == "cancelled":
        await loyalty.credit(r["user_id"], "redeem_refund", r["cost_points"], "earned", redemption_id, f"Échange annulé : {r['reward_name']}")
    await audit(f"loyalty.redemption_{new_status}", admin["user_id"], redemption_id, {"user": r["user_id"]})
    return {**r, "status": new_status}


@router.post("/admin/adjust")
async def admin_adjust(body: AdjustIn, admin=Depends(require_admin)):
    target = await db.users.find_one({"email": body.user_email.lower()}, PUBLIC)
    if not target:
        raise HTTPException(404, "Utilisateur introuvable.")
    ref = f"adjust-{uuid.uuid4().hex[:8]}"
    if body.amount > 0:
        entry = await loyalty.credit(target["user_id"], "bonus", body.amount, body.bucket, ref, body.reason, created_by=admin["user_id"])
    else:
        entry = await loyalty.debit(target["user_id"], "adjust", -body.amount, body.bucket, ref, body.reason, created_by=admin["user_id"])
    await audit("loyalty.manual_adjust", admin["user_id"], target["user_id"], {"amount": body.amount, "bucket": body.bucket, "reason": body.reason})
    return {"entry": entry, "balance": await loyalty.balances(target["user_id"])}
