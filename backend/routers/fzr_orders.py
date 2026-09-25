"""FazerCards Phase 3 — endpoints admin fulfillment, réglage auto, alertes prix, mapping produit, webhook."""
import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.audit import audit
from core.db import db
from core.security import require_admin, require_permission, require_super_admin
from services import fazercards, fzr_fulfillment

router = APIRouter(tags=["fazercards-fulfillment"])
logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FzrAutoIn(BaseModel):
    fzr_auto: bool


class MappingIn(BaseModel):
    category_id: str
    offer_id: str


# ---------- Réglage global manuel / automatique (kill switch) ----------
@router.get("/admin/fazercards/settings", dependencies=[Depends(require_admin)])
async def fzr_settings():
    return {"fzr_auto": await fzr_fulfillment.auto_enabled(),
            "webhook_configured": bool(os.environ.get("FAZERCARDS_WEBHOOK_SECRET"))}


@router.patch("/admin/fazercards/settings")
async def fzr_update_settings(body: FzrAutoIn, admin=Depends(require_super_admin)):
    await db.settings.update_one({"key": "store"}, {"$set": {"fzr_auto": body.fzr_auto, "updated_at": _now()}}, upsert=True)
    await audit("fzr.auto_changed", admin["user_id"], None, {"fzr_auto": body.fzr_auto})
    return {"fzr_auto": body.fzr_auto}


# ---------- Mapping produit MGS ↔ offre FazerCards ----------
@router.get("/admin/fazercards/mappings", dependencies=[Depends(require_admin)])
async def fzr_mappings():
    products = await db.products.find({}, {"_id": 0, "id": 1, "slug": 1, "name": 1, "type": 1, "price": 1,
                                           "active": 1, "fazercards_mapping": 1}).sort("sort_order", 1).to_list(500)
    return {"products": products}


@router.patch("/admin/fazercards/products/{product_id}/mapping", dependencies=[Depends(require_permission("catalog.manage"))])
async def fzr_set_mapping(product_id: str, body: MappingIn):
    product = await db.products.find_one({"id": product_id}, PUBLIC)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    offers = await fazercards.pubg_offers_fresh(body.category_id)
    offer = next((o for o in offers["offers"] if o["offer_id"] == body.offer_id), None)
    if not offer:
        raise HTTPException(status_code=409, detail="Cette offre n'existe pas dans le catalogue FazerCards live.")
    mapping = {"category_id": body.category_id, "offer_id": body.offer_id, "offer_name": offer["name"],
               "price_usd_at_link": offer["price_usd"], "linked_at": _now()}
    await db.products.update_one({"id": product_id}, {"$set": {"fazercards_mapping": mapping}})
    return {"product_id": product_id, "fazercards_mapping": mapping}


@router.delete("/admin/fazercards/products/{product_id}/mapping", dependencies=[Depends(require_permission("catalog.manage"))])
async def fzr_unset_mapping(product_id: str):
    res = await db.products.update_one({"id": product_id}, {"$unset": {"fazercards_mapping": ""}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return {"ok": True}


# ---------- Fulfillment fournisseur ----------
@router.get("/admin/orders/{order_id}/fazercards/preflight", dependencies=[Depends(require_permission("orders.manage"))])
async def fzr_preflight(order_id: str):
    return await fzr_fulfillment.preflight(order_id)


@router.post("/admin/orders/{order_id}/fazercards/fulfill")
async def fzr_fulfill(order_id: str, admin=Depends(require_permission("orders.manage"))):
    return await fzr_fulfillment.fulfill_order(order_id, f"admin:{admin['user_id']}")


@router.post("/admin/orders/{order_id}/fazercards/refresh-status")
async def fzr_refresh_status(order_id: str, admin=Depends(require_permission("orders.manage"))):
    return await fzr_fulfillment.refresh_status(order_id, f"admin:{admin['user_id']}")


# ---------- Alerte prix fournisseur ----------
@router.post("/admin/fazercards/catalog/refresh")
async def fzr_catalog_refresh(admin=Depends(require_permission("catalog.manage"))):
    fazercards._catalog_cache.clear()
    categories = await fazercards.pubg_catalog()
    checked, changes = 0, []
    for cat in categories:
        for offer in cat["offers"]:
            checked += 1
            key = {"category_id": cat["category_id"], "offer_id": offer["offer_id"]}
            prev = await db.fzr_offer_prices.find_one(key, PUBLIC)
            if prev and prev.get("price_usd") != offer["price_usd"]:
                product = await db.products.find_one(
                    {"fazercards_mapping.category_id": key["category_id"], "fazercards_mapping.offer_id": key["offer_id"]},
                    {"_id": 0, "name": 1, "price": 1, "slug": 1})
                try:
                    up = float(offer["price_usd"]) > float(prev["price_usd"])
                except (TypeError, ValueError):
                    up = None
                alert = {"id": str(uuid.uuid4()), **key, "offer_name": offer["name"],
                         "old_price_usd": prev["price_usd"], "new_price_usd": offer["price_usd"],
                         "direction": "up" if up else "down" if up is not None else None,
                         "mgs_product": product, "detected_at": _now(), "acknowledged": False}
                await db.fzr_price_alerts.insert_one(dict(alert))
                changes.append(alert)
                await audit("fzr.price_change", admin["user_id"], offer["offer_id"],
                            {"old": prev["price_usd"], "new": offer["price_usd"], "category_id": key["category_id"]})
            await db.fzr_offer_prices.update_one(key, {"$set": {**key, "name": offer["name"],
                                                                "price_usd": offer["price_usd"], "updated_at": _now()}}, upsert=True)
    return {"checked": checked, "changes": changes}


@router.get("/admin/fazercards/price-alerts", dependencies=[Depends(require_admin)])
async def fzr_price_alerts(limit: int = 100):
    alerts = await db.fzr_price_alerts.find({}, PUBLIC).sort("detected_at", -1).to_list(min(limit, 500))
    unack = await db.fzr_price_alerts.count_documents({"acknowledged": False})
    return {"alerts": alerts, "unacknowledged": unack}


@router.patch("/admin/fazercards/price-alerts/{alert_id}/ack")
async def fzr_ack_alert(alert_id: str, admin=Depends(require_admin)):
    res = await db.fzr_price_alerts.update_one({"id": alert_id}, {"$set": {"acknowledged": True, "ack_by": admin["user_id"], "ack_at": _now()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alerte introuvable")
    return {"ok": True}


# ---------- Webhook FazerCards (signature HMAC-SHA256, header X-Webhook-Signature) ----------
def verify_fzr_signature(raw: bytes, signature: str | None) -> bool:
    secret = os.environ.get("FAZERCARDS_WEBHOOK_SECRET", "")
    if not secret or not signature:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


@router.post("/fazercards/webhook")
async def fzr_webhook(request: Request):
    raw = await request.body()
    if not verify_fzr_signature(raw, request.headers.get("X-Webhook-Signature")):
        logger.warning("FazerCards webhook rejected: invalid signature")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    return await fzr_fulfillment.apply_webhook_event(event)
