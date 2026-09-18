import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core.db import db
from core.security import require_admin
from services import payments as gw

router = APIRouter(prefix="/payments", tags=["payments"])
PUBLIC = {"_id": 0}


class InitiateIn(BaseModel):
    order_id: str


class SimulateIn(BaseModel):
    outcome: str = Field(pattern=r"^(completed|failed)$")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _frontend_url(request: Request) -> str:
    return os.environ.get("FRONTEND_URL") or str(request.base_url).rstrip("/")


async def _apply_status(payment: dict, status: str):
    status = gw.normalize_status(status)
    if payment.get("status") == "completed" and status != "completed":
        return payment
    await db.payments.update_one({"order_id": payment["order_id"]}, {"$set": {"status": status, "updated_at": _now()}})
    order_status = {"completed": "paid", "failed": "failed"}.get(status)
    if order_status:
        order = await db.orders.find_one({"id": payment["order_id"]}, {"status": 1})
        if order and order["status"] in ("pending_payment", "failed"):
            await db.orders.update_one({"id": payment["order_id"]}, {
                "$set": {"status": order_status, "updated_at": _now()},
                "$push": {"history": {"status": order_status, "at": _now()}}})
    payment["status"] = status
    return payment


@router.get("/config")
async def payment_config():
    live = gw.mode() == "papi" and gw.papi_configured()
    return {
        "mode": gw.mode(), "gateway": "papi", "live": live,
        "providers": {
            "mvola": {"configured": live, "merchant": os.environ["MVOLA_MERCHANT_MSISDN"], "name": "Selneker Dino"},
            "orange": {"configured": live, "merchant": os.environ["ORANGE_MERCHANT_NUMBER"], "name": "Selneker Dino"},
        },
    }


@router.post("/initiate")
async def initiate(body: InitiateIn, request: Request):
    order = await db.orders.find_one({"id": body.order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["payment_method"] not in ("mvola", "orange"):
        raise HTTPException(status_code=400, detail="Order does not use an API payment method")
    if order["status"] not in ("pending_payment", "failed"):
        raise HTTPException(status_code=400, detail="Order is not payable")
    existing = await db.payments.find_one({"order_id": order["id"]}, PUBLIC)
    if existing and existing["status"] == "pending" and (existing.get("payment_url") or existing.get("simulated")):
        return {k: v for k, v in existing.items() if k != "notif_token"}
    if not gw.is_simulated() and not gw.papi_configured():
        raise HTTPException(status_code=503, detail="Payment gateway not configured")
    front = _frontend_url(request)
    track = f"{front}/suivi/{order['order_number']}?pubg_id={order['pubg_id']}"
    result = await gw.papi_create_link(order, order["payment_method"], f"{track}&return=success", f"{track}&return=failure",
                                       f"{front}/api/payments/papi/notification")
    payment = {
        "order_id": order["id"], "order_number": order["order_number"], "provider": order["payment_method"], "gateway": "papi",
        "provider_ref": result["provider_ref"], "client_ref": result["client_ref"], "amount": order["total"],
        "customer_phone": order["payment_phone"], "status": "pending", "payment_url": result.get("payment_url"),
        "notif_token": result.get("notif_token"), "simulated": gw.is_simulated(), "created_at": _now(), "updated_at": _now(),
    }
    await db.payments.update_one({"order_id": order["id"]}, {"$set": payment}, upsert=True)
    await db.orders.update_one({"id": order["id"]}, {"$set": {"status": "pending_payment", "updated_at": _now()}})
    return {k: v for k, v in payment.items() if k != "notif_token"}


@router.get("/{order_id}/status")
async def status(order_id: str):
    payment = await db.payments.find_one({"order_id": order_id}, PUBLIC)
    if not payment:
        raise HTTPException(status_code=404, detail="No payment for this order")
    if payment["status"] == "pending":
        if payment.get("simulated"):
            raw = gw.simulated_status(payment)
        else:
            data = await gw.papi_read_link(payment["client_ref"])
            raw = gw.link_to_status(data)
            await db.payments.update_one({"order_id": order_id}, {"$set": {"last_lookup": data, "papi_reference": data.get("papiPaymentReference")}})
        payment = await _apply_status(payment, raw)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "status": 1, "order_number": 1})
    return {"payment_status": payment["status"], "order_status": order["status"], "order_number": order["order_number"],
            "payment_url": payment.get("payment_url"), "simulated": payment.get("simulated", False)}


@router.post("/papi/notification")
async def papi_notification(request: Request):
    raw = await request.body()
    if not gw.verify_papi_signature(raw, request.headers.get("X-Papi-Signature")):
        raise HTTPException(status_code=401, detail="Invalid signature")
    body = json.loads(raw)
    payment = await db.payments.find_one({"client_ref": body.get("merchantPaymentReference"), "gateway": "papi"}, PUBLIC)
    if not payment or payment.get("notif_token") != body.get("notificationToken"):
        raise HTTPException(status_code=403, detail="Unknown payment")
    if payment["status"] != "pending":
        return {"ok": True}
    if body.get("amount") is not None and int(body["amount"]) != int(payment["amount"]):
        raise HTTPException(status_code=400, detail="Amount mismatch")
    await db.payments.update_one({"order_id": payment["order_id"]}, {"$set": {"callback": body, "papi_reference": body.get("paymentReference"), "paid_with": body.get("paymentMethod")}})
    await _apply_status(payment, body.get("paymentStatus", ""))
    return {"ok": True}


@router.post("/{order_id}/simulate", dependencies=[Depends(require_admin)])
async def simulate(order_id: str, body: SimulateIn):
    payment = await db.payments.find_one({"order_id": order_id}, PUBLIC)
    if not payment or not payment.get("simulated"):
        raise HTTPException(status_code=400, detail="Only simulated payments can be forced")
    return await _apply_status(payment, body.outcome)
