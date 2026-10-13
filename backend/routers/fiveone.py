import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from core import ratelimit
from core.audit import audit
from core.db import db
from core.security import ADMIN_ROLES, get_optional_user
from services import fiveone
from services import payments as gw
from routers.payments import (PAYABLE_ORDER_STATUSES, PUBLIC, _backend_url, _frontend_url, _public, _set_order_status,
                              apply_status, expire_attempt, latest_attempt, record_late_success)

router = APIRouter(prefix="/payments/fiveone", tags=["fiveone"])
logger = logging.getLogger("mgs.fiveone")


class InitiateIn(BaseModel):
    order_id: str


def _now():
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None):
    return (dt or _now()).isoformat()


@router.post("/initiate")
async def initiate(body: InitiateIn, request: Request, background: BackgroundTasks, user=Depends(get_optional_user)):
    ip = ratelimit.client_ip(request)
    ratelimit.check(f"pay:ip:{ip}", ratelimit.setting("PAYMENT_INITIATE_PER_10MIN_PER_IP", 15), 600)
    order = await db.orders.find_one({"id": body.order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") and (not user or (user["user_id"] != order["user_id"] and user.get("role") not in ADMIN_ROLES)):
        raise HTTPException(status_code=403, detail="Forbidden")
    if order["payment_method"] not in fiveone.OPERATORS:
        raise HTTPException(status_code=400, detail="Order does not use a mobile money payment method")
    if order.get("payment_provider") and order["payment_provider"] != "fiveone":
        raise HTTPException(status_code=400, detail="Order uses another payment gateway")
    if not await fiveone.enabled():
        raise HTTPException(status_code=409, detail=fiveone.FIVEONE_OFF_MESSAGE)
    if not fiveone.configured():
        raise HTTPException(status_code=503, detail="Payment gateway not configured")
    latest = await latest_attempt(order["id"])
    if latest and latest["status"] == "pending":
        if gw.is_expired(latest):
            latest = await expire_attempt(latest, background)
            order = await db.orders.find_one({"id": body.order_id}, PUBLIC)
        elif latest.get("payment_url"):
            return _public(latest)
    if order["status"] not in PAYABLE_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Order is not payable")
    if latest:
        if latest["status"] in ("completed", "late_success"):
            raise HTTPException(status_code=409, detail="Un paiement a déjà été reçu pour cette commande.")
        min_delay = ratelimit.setting("PAYMENT_RETRY_MIN_SECONDS", 20)
        if datetime.fromisoformat(latest["created_at"]) + timedelta(seconds=min_delay) > _now():
            raise HTTPException(status_code=429, detail=f"Patientez {min_delay} secondes avant une nouvelle tentative.")
        if latest.get("attempt_no", 1) >= ratelimit.setting("PAYMENT_MAX_ATTEMPTS", 8):
            raise HTTPException(status_code=429, detail="Nombre maximal de tentatives atteint. Contactez le support.")
    attempt_no = (latest.get("attempt_no", 1) + 1) if latest else 1
    client_ref = gw.attempt_reference(order["order_number"], attempt_no)
    track = f"{_frontend_url(request)}/suivi/{order['order_number']}?pubg_id={order['pubg_id']}&return=success"
    result = await fiveone.create_payment(order, client_ref, order["payment_method"], f"{_backend_url(request)}/api/payments/fiveone/webhook", track)
    created = _now()
    attempt = {
        "order_id": order["id"], "order_number": order["order_number"], "attempt_no": attempt_no, "client_ref": client_ref,
        "provider": order["payment_method"], "gateway": "fiveone", "provider_ref": result["provider_ref"], "amount": order["total"],
        "customer_phone": order["payment_phone"], "status": "pending", "payment_url": result.get("payment_url"),
        "fiveone_reference": result.get("fiveone_reference"), "sandbox": fiveone.is_sandbox(), "simulated": False,
        "initiated_by": (user or {}).get("user_id"), "initiated_ip": ip, "created_at": _iso(created), "updated_at": _iso(created),
        "expires_at": _iso(created + timedelta(minutes=gw.timeout_minutes())),
    }
    await db.payments.insert_one(attempt)
    if order["status"] != "pending_payment":
        await _set_order_status(order["id"], "pending_payment", ("failed", "expired"))
    await audit("payment.attempt", (user or {}).get("user_id") or f"ip:{ip}", order["id"],
                {"client_ref": client_ref, "attempt_no": attempt_no, "amount": order["total"], "gateway": "fiveone"})
    return _public(attempt)


async def refresh_from_provider(attempt: dict, background: BackgroundTasks) -> dict:
    """Server-side polling fallback (webhook is authoritative when reachable)."""
    data = await fiveone.get_payment(attempt["provider_ref"])
    await db.payments.update_one({"client_ref": attempt["client_ref"]}, {"$set": {"last_lookup": data}})
    status = fiveone.normalize_status(data.get("status"))
    if status == "pending":
        return attempt
    amount = data.get("amount")
    if status == "completed" and amount is not None and int(float(amount)) != int(attempt["amount"]):
        await audit("payment.amount_mismatch", "fiveone-lookup", attempt["order_id"], {"client_ref": attempt["client_ref"], "expected": attempt["amount"], "got": amount})
        return attempt
    return await apply_status(attempt, status, "fiveone-lookup", background, {"fiveone_reference": data.get("fiveonepay_reference")})


@router.post("/webhook")
async def webhook(request: Request, background: BackgroundTasks):
    raw = await request.body()
    signature = request.headers.get("X-FiveOne-Signature") or request.headers.get("X-Fiveone-Signature")
    if not fiveone.verify_signature(raw, signature):
        logger.warning("FiveOne webhook rejected: invalid signature")
        raise HTTPException(status_code=400, detail="Invalid signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    data = event.get("data") or {}
    payment_id, reference = data.get("id"), data.get("reference")
    attempt = None
    if isinstance(payment_id, str):
        attempt = await db.payments.find_one({"provider_ref": payment_id, "gateway": "fiveone"}, PUBLIC)
    if not attempt and isinstance(reference, str):
        attempt = await db.payments.find_one({"client_ref": reference, "gateway": "fiveone"}, PUBLIC)
    if not attempt:
        await audit("payment.callback_unknown_reference", "fiveone", None, {"reference": str(payment_id or reference)[:80]})
        raise HTTPException(status_code=404, detail="Unknown payment")
    dedupe_key = hashlib.sha256(b"fiveone|" + (str(event.get("id") or "") or signature).encode() + b"|" + raw).hexdigest()
    try:
        await db.payment_events.insert_one({"dedupe_key": dedupe_key, "client_ref": attempt["client_ref"], "order_id": attempt["order_id"],
                                            "gateway": "fiveone", "event_type": event.get("type"), "payment_status": data.get("status"),
                                            "amount": data.get("amount"), "created_at": _iso()})
    except Exception:
        return {"received": True, "duplicate": True}
    status = fiveone.normalize_status(data.get("status"))
    if status == "pending":
        return {"received": True}
    if data.get("amount") is not None and status == "completed":
        try:
            received = int(round(float(data["amount"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid amount")
        if received != int(attempt["amount"]):
            await audit("payment.amount_mismatch", "fiveone", attempt["order_id"], {"client_ref": attempt["client_ref"], "expected": attempt["amount"], "received": received})
            raise HTTPException(status_code=400, detail="Amount mismatch")
    extra = {"fiveone_reference": data.get("fiveonepay_reference"), "paid_with": data.get("operator")}
    await db.payments.update_one({"client_ref": attempt["client_ref"]}, {"$set": {"callback": event, **extra}})
    if attempt["status"] == "expired" and status == "completed":
        await record_late_success(attempt, "fiveone", extra)
        return {"received": True, "late": True}
    if attempt["status"] in gw.FINAL_STATUSES:
        return {"received": True, "duplicate": True}
    await apply_status(attempt, status, "fiveone", background, extra)
    return {"received": True}
