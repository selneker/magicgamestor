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


def _backend_url(request: Request) -> str:
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
    return {
        "mode": gw.mode(),
        "providers": {
            "mvola": {"configured": gw.provider_configured("mvola"), "merchant": os.environ["MVOLA_MERCHANT_MSISDN"], "name": "Selneker Dino"},
            "orange": {"configured": gw.provider_configured("orange"), "merchant": os.environ["ORANGE_MERCHANT_NUMBER"], "name": "Selneker Dino"},
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
    if existing and existing["status"] == "pending":
        return existing
    if not gw.is_simulated() and not gw.provider_configured(order["payment_method"]):
        raise HTTPException(status_code=503, detail="Payment provider not configured")
    base = _backend_url(request)
    if order["payment_method"] == "mvola":
        result = await gw.mvola_initiate(order, order["payment_phone"], f"{base}/api/payments/mvola/callback")
    else:
        result = await gw.orange_initiate(order, f"{base}/suivi/{order['order_number']}?pubg_id={order['pubg_id']}&return=1",
                                          f"{base}/suivi/{order['order_number']}?pubg_id={order['pubg_id']}&cancel=1",
                                          f"{base}/api/payments/orange/notification")
    payment = {
        "order_id": order["id"], "order_number": order["order_number"], "provider": order["payment_method"],
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
        elif payment["provider"] == "mvola":
            raw = await gw.mvola_status(payment["provider_ref"])
        else:
            raw = await gw.orange_status(payment)
        payment = await _apply_status(payment, raw)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "status": 1, "order_number": 1})
    return {"payment_status": payment["status"], "order_status": order["status"], "order_number": order["order_number"],
            "payment_url": payment.get("payment_url"), "simulated": payment.get("simulated", False)}


@router.put("/mvola/callback")
async def mvola_callback(request: Request):
    body = await request.json()
    sid = body.get("serverCorrelationId")
    raw = body.get("transactionStatus") or body.get("status")
    if not sid or not raw:
        raise HTTPException(status_code=400, detail="Invalid callback")
    payment = await db.payments.find_one({"provider_ref": sid, "provider": "mvola"}, PUBLIC)
    if not payment:
        raise HTTPException(status_code=404, detail="Unknown transaction")
    await db.payments.update_one({"order_id": payment["order_id"]}, {"$set": {"callback": body}})
    await _apply_status(payment, raw)
    return {"received": True}


@router.post("/orange/notification")
async def orange_notification(request: Request):
    body = await request.json()
    payment = await db.payments.find_one({"notif_token": body.get("notif_token"), "provider": "orange"}, PUBLIC)
    if not payment:
        raise HTTPException(status_code=401, detail="Unknown notification token")
    await db.payments.update_one({"order_id": payment["order_id"]}, {"$set": {"callback": body, "txnid": body.get("txnid")}})
    await _apply_status(payment, body.get("status", ""))
    return {"ok": True}


@router.post("/{order_id}/simulate", dependencies=[Depends(require_admin)])
async def simulate(order_id: str, body: SimulateIn):
    payment = await db.payments.find_one({"order_id": order_id}, PUBLIC)
    if not payment or not payment.get("simulated"):
        raise HTTPException(status_code=400, detail="Only simulated payments can be forced")
    return await _apply_status(payment, body.outcome)
