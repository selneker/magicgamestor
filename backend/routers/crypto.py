from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from core import ratelimit
from core.audit import audit
from core.db import db
from core.security import ADMIN_ROLES, get_optional_user, require_admin, require_permission, require_super_admin
from services import binance, binance_watcher, crypto

router = APIRouter(prefix="/crypto", tags=["crypto"])
PUBLIC = {"_id": 0}


class InitiateIn(BaseModel):
    order_id: str
    network: str = Field(pattern=r"^(TRC20|BEP20|APTOS|TON)$")


class WalletIn(BaseModel):
    address: str = Field(default="", max_length=128)
    memo: str = Field(default="", max_length=64)
    active: bool = False


class SettingsIn(BaseModel):
    enabled: bool | None = None
    rate_ar_per_usdt: float | None = Field(default=None, gt=0, le=1_000_000)
    expiry_minutes: int | None = Field(default=None, ge=10, le=180)
    wallets: dict[str, WalletIn] | None = None

    @field_validator("wallets")
    @classmethod
    def _known(cls, value):
        if value and any(k not in crypto.NETWORKS for k in value):
            raise ValueError("Unknown network")
        return value


async def _order_for(order_id: str, user) -> dict:
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") and (not user or (user["user_id"] != order["user_id"] and user.get("role") not in ADMIN_ROLES)):
        raise HTTPException(status_code=403, detail="Forbidden")
    return order


async def _status_payload(order_id: str) -> dict:
    payment = await db.crypto_payments.find_one({"order_id": order_id}, PUBLIC, sort=[("created_at", -1)])
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "status": 1})
    return {"order_status": order["status"], "payment": crypto.public(payment)}


# ---------- Admin ----------
@router.get("/admin/settings", dependencies=[Depends(require_admin)])
async def admin_settings():
    return {**await crypto.get_settings(), "api_configured": binance.configured(), "labels": crypto.LABELS, "binance_codes": binance.NETWORKS}


@router.patch("/admin/settings")
async def admin_update_settings(body: SettingsIn, admin=Depends(require_super_admin)):
    current = await crypto.get_settings()
    merged = {**current, **{k: v for k, v in body.model_dump(exclude={"wallets"}).items() if v is not None}}
    if body.wallets:
        merged["wallets"] = {**current["wallets"], **{k: {"address": w.address.strip(), "memo": w.memo.strip(), "active": w.active} for k, w in body.wallets.items()}}
    if merged["enabled"]:
        if not binance.configured():
            raise HTTPException(status_code=400, detail="Clés API Binance absentes côté serveur (BINANCE_API_KEY / BINANCE_API_SECRET).")
        if merged["rate_ar_per_usdt"] <= 0 or not crypto.active_networks(merged):
            raise HTTPException(status_code=400, detail="Définissez un taux Ar → USDT et au moins un wallet actif avant d'activer Binance.")
    await db.settings.update_one({"key": "store"}, {"$set": {"binance": merged, "updated_at": crypto.iso()}}, upsert=True)
    await audit("crypto.settings_update", admin["user_id"], "binance", {"enabled": merged["enabled"], "rate": merged["rate_ar_per_usdt"],
                                                                         "active": crypto.active_networks(merged)})
    return await admin_settings()


@router.get("/admin/payments", dependencies=[Depends(require_permission("orders.manage"))])
async def admin_payments(status: str | None = None, limit: int = 100):
    query = {"status": status} if status else {}
    return await db.crypto_payments.find(query, {"_id": 0, "history": 0}).sort("created_at", -1).to_list(min(limit, 500))


@router.get("/admin/unmatched", dependencies=[Depends(require_permission("orders.manage"))])
async def admin_unmatched(reviewed: bool = False):
    return await db.crypto_unmatched.find({"reviewed": reviewed}, PUBLIC).sort("created_at", -1).to_list(200)


@router.patch("/admin/unmatched/{item_id}")
async def admin_review_unmatched(item_id: str, admin=Depends(require_permission("orders.manage"))):
    res = await db.crypto_unmatched.update_one({"id": item_id}, {"$set": {"reviewed": True, "reviewed_by": admin["user_id"], "reviewed_at": crypto.iso()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.post("/admin/check", dependencies=[Depends(require_admin)])
async def admin_check():
    return await binance_watcher.check_once(force=True)


@router.get("/admin/networks", dependencies=[Depends(require_admin)])
async def admin_networks():
    return {"networks": await binance.usdt_networks()}


# ---------- Customer ----------
@router.get("/config")
async def config():
    return await crypto.public_config()


@router.post("/initiate")
async def initiate(body: InitiateIn, request: Request, user=Depends(get_optional_user)):
    ratelimit.check(f"crypto_init:ip:{ratelimit.client_ip(request)}", ratelimit.setting("PAYMENT_INITIATE_PER_10MIN_PER_IP", 15), 600)
    order = await _order_for(body.order_id, user)
    if order["payment_method"] != "binance":
        raise HTTPException(status_code=400, detail="Cette commande n'utilise pas Binance USDT.")
    if order["status"] != "pending_payment":
        raise HTTPException(status_code=409, detail="Cette commande n'est plus en attente de paiement.")
    return crypto.public(await crypto.create_payment(order, body.network))


@router.get("/{order_id}/status")
async def status(order_id: str, user=Depends(get_optional_user)):
    await _order_for(order_id, user)
    await binance_watcher.safe_check()
    return await _status_payload(order_id)


@router.post("/{order_id}/paid")
async def declared_paid(order_id: str, user=Depends(get_optional_user)):
    await _order_for(order_id, user)
    await db.crypto_payments.update_one({"order_id": order_id, "slot_open": True, "customer_declared_paid_at": {"$exists": False}},
                                        {"$set": {"customer_declared_paid_at": crypto.iso()}})
    await binance_watcher.safe_check()
    return await _status_payload(order_id)
