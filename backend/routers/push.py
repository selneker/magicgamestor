import base64

from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from core.db import db
from core.security import require_admin
from models.messaging import PushSubscription
from services.push import configured, send_push, validate_endpoint
import os

router = APIRouter(prefix="/admin/push", tags=["admin-push"])


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)


class KeysIn(BaseModel):
    p256dh: str = Field(min_length=1, max_length=128)
    auth: str = Field(min_length=1, max_length=32)

    @field_validator("p256dh", "auth")
    @classmethod
    def valid_key(cls, value, info):
        try:
            raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
            if info.field_name == "p256dh":
                ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
            elif len(raw) != 16:
                raise ValueError()
        except Exception:
            raise ValueError("Clé Push invalide.")
        return value


class SubscriptionIn(EndpointIn):
    keys: KeysIn


def require_configuration():
    if not configured():
        raise HTTPException(503, "Les notifications Push ne sont pas encore configurées sur le serveur.")


@router.get("/config")
async def config(user=Depends(require_admin)):
    return {"configured": configured(), "public_key": os.environ.get("VAPID_PUBLIC_KEY") if configured() else None}


@router.post("/status")
async def status(body: EndpointIn, user=Depends(require_admin)):
    found = await db.push_subscriptions.find_one({"endpoint": body.endpoint, "user_id": user["user_id"]}, {"_id": 1})
    return {"registered": bool(found)}


@router.post("/subscriptions")
async def subscribe(body: SubscriptionIn, user=Depends(require_admin)):
    require_configuration()
    try:
        validate_endpoint(body.endpoint)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    subscription = PushSubscription(user_id=user["user_id"], endpoint=body.endpoint, keys=body.keys.model_dump())
    doc = subscription.to_mongo()
    doc.pop("_id")
    try:
        await db.push_subscriptions.update_one({"endpoint": body.endpoint}, {"$set": doc, "$setOnInsert": {"_id": subscription.id}}, upsert=True)
    except DuplicateKeyError:
        await db.push_subscriptions.update_one({"endpoint": body.endpoint}, {"$set": doc})
    return {"registered": True}


@router.delete("/subscriptions")
async def unsubscribe(body: EndpointIn, user=Depends(require_admin)):
    await db.push_subscriptions.delete_one({"endpoint": body.endpoint, "user_id": user["user_id"]})
    return {"registered": False}


@router.post("/test")
async def test_push(body: EndpointIn, user=Depends(require_admin)):
    require_configuration()
    doc = await db.push_subscriptions.find_one({"endpoint": body.endpoint, "user_id": user["user_id"]})
    if not doc:
        raise HTTPException(404, "Activez les notifications sur cet appareil.")
    result = await send_push(PushSubscription.from_mongo(doc), {"title": "Magic Game Store", "body": "Les notifications de commandes sont activées.", "url": "/admin/commandes", "orderId": "test"})
    if result == "expired":
        raise HTTPException(410, "Inscription expirée. Réactivez les notifications.")
    if result != "sent":
        raise HTTPException(502, "Le service Push est indisponible. Réessayez.")
    return {"sent": True}
