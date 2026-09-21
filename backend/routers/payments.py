import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import ratelimit
from core.audit import audit
from core.db import db
from core.security import get_optional_user, require_admin
from services import payments as gw
from services.fulfillment import on_order_paid, on_payment_failed

router = APIRouter(prefix="/payments", tags=["payments"])
logger = logging.getLogger("mgs.payments")
PUBLIC = {"_id": 0}
HIDDEN = ("notif_token", "callback", "last_lookup")
PAYABLE_ORDER_STATUSES = ("pending_payment", "failed", "expired")


class InitiateIn(BaseModel):
    order_id: str


class SimulateIn(BaseModel):
    outcome: str = Field(pattern=r"^(completed|failed)$")


class PapiAutoIn(BaseModel):
    papi_auto: bool


def _now():
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None):
    return (dt or _now()).isoformat()


def _public(attempt: dict) -> dict:
    return {k: v for k, v in attempt.items() if k not in HIDDEN and k != "_id"}


def _frontend_url(request: Request) -> str:
    return os.environ.get("FRONTEND_URL") or str(request.base_url).rstrip("/")


def _backend_url(request: Request) -> str:
    return (os.environ.get("BACKEND_PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL")
            or str(request.base_url).rstrip("/"))


async def latest_attempt(order_id: str) -> dict | None:
    return await db.payments.find_one({"order_id": order_id}, PUBLIC, sort=[("created_at", -1)])


async def _set_order_status(order_id: str, new_status: str, allowed_from: tuple, extra: dict | None = None) -> bool:
    res = await db.orders.update_one(
        {"id": order_id, "status": {"$in": list(allowed_from)}},
        {"$set": {"status": new_status, "updated_at": _iso(), **(extra or {})}, "$push": {"history": {"status": new_status, "at": _iso()}}})
    return res.modified_count == 1


async def expire_attempt(attempt: dict, background: BackgroundTasks | None = None) -> dict:
    """pending → expired once the internal 15-minute deadline has passed (atomic on status)."""
    res = await db.payments.find_one_and_update(
        {"client_ref": attempt["client_ref"], "status": "pending"},
        {"$set": {"status": "expired", "expired_at": _iso(), "updated_at": _iso()}}, projection=PUBLIC, return_document=True)
    if not res:
        return await db.payments.find_one({"client_ref": attempt["client_ref"]}, PUBLIC) or attempt
    current = await latest_attempt(attempt["order_id"])
    if current and current["client_ref"] == attempt["client_ref"]:
        if await _set_order_status(attempt["order_id"], "expired", ("pending_payment",)):
            from routers.orders import release_subscription_locks
            await release_subscription_locks(attempt["order_id"])
            await audit("payment.expired", "system", attempt["order_id"], {"client_ref": attempt["client_ref"]})
            if background is not None:
                background.add_task(on_payment_failed, attempt["order_id"], "expired")
    return res


async def expire_stale_attempts(limit: int = 200):
    cursor = db.payments.find({"status": "pending", "expires_at": {"$lte": _iso()}}, PUBLIC).limit(limit)
    async for attempt in cursor:
        await expire_attempt(attempt)


async def apply_status(attempt: dict, raw_status: str, source: str, background: BackgroundTasks | None = None, extra: dict | None = None) -> dict:
    """Idempotent + race-safe state machine. Only the atomic pending→X winner triggers order side effects."""
    status = gw.normalize_status(raw_status)
    ref, order_id = attempt["client_ref"], attempt["order_id"]
    if status == "pending":
        return attempt
    if attempt["status"] != "pending":
        return attempt
    if gw.is_expired(attempt):
        expired = await expire_attempt(attempt, background)
        if status == "completed":
            return await record_late_success(expired, source, extra)
        return expired
    updates = {"status": status, "updated_at": _iso(), f"{status}_at": _iso(), "status_source": source, **(extra or {})}
    won = await db.payments.find_one_and_update({"client_ref": ref, "status": "pending"}, {"$set": updates}, projection=PUBLIC, return_document=True)
    if not won:
        return await db.payments.find_one({"client_ref": ref}, PUBLIC) or attempt
    if status == "completed":
        delivered = await _set_order_status(order_id, "paid", PAYABLE_ORDER_STATUSES, {"paid_attempt_ref": ref, "paid_at": _iso()})
        if delivered:
            if background is not None:
                background.add_task(on_order_paid, order_id, ref, source)
            else:
                await on_order_paid(order_id, ref, source)
        else:
            await audit("payment.completed_without_order_transition", source, order_id, {"client_ref": ref})
    else:
        current = await latest_attempt(order_id)
        if current and current["client_ref"] == ref and await _set_order_status(order_id, "failed", ("pending_payment",)):
            from routers.orders import release_subscription_locks
            await release_subscription_locks(order_id)
            await audit("payment.failed", source, order_id, {"client_ref": ref})
            if background is not None:
                background.add_task(on_payment_failed, order_id, "failed")
    return won


async def record_late_success(attempt: dict, source: str, extra: dict | None = None) -> dict:
    """SUCCESS received after the internal deadline: never auto-deliver; flag for manual, traceable resolution."""
    won = await db.payments.find_one_and_update(
        {"client_ref": attempt["client_ref"], "status": "expired"},
        {"$set": {"status": "late_success", "late_success_at": _iso(), "updated_at": _iso(), "status_source": source, **(extra or {})}},
        projection=PUBLIC, return_document=True)
    if not won:
        return await db.payments.find_one({"client_ref": attempt["client_ref"]}, PUBLIC) or attempt
    await db.orders.update_one({"id": attempt["order_id"]}, {"$set": {
        "late_payment": {"client_ref": attempt["client_ref"], "amount": attempt["amount"], "at": _iso(), "papi_reference": (extra or {}).get("papi_reference")},
        "updated_at": _iso()}})
    logger.warning("LATE SUCCESS for %s (order %s): funds received after deadline, manual review required", attempt["client_ref"], attempt["order_number"])
    await audit("payment.late_success", source, attempt["order_id"], {"client_ref": attempt["client_ref"], "amount": attempt["amount"]})
    return won


@router.get("/config")
async def payment_config():
    papi_auto = await gw.papi_auto_enabled()
    live = gw.mode() == "papi" and gw.papi_configured()
    return {
        "mode": gw.mode(), "gateway": "papi", "live": live, "papi_auto": papi_auto,
        "manual_only": not papi_auto, "timeout_minutes": gw.timeout_minutes(),
        "providers": {
            "mvola": {"configured": live, "merchant": os.environ.get("MVOLA_MERCHANT_MSISDN") or "0383905692", "name": "Selneker Dino"},
            "orange": {"configured": live, "merchant": os.environ.get("ORANGE_MERCHANT_NUMBER") or "0377519833", "name": "Selneker Dino"},
        },
    }


@router.post("/initiate")
async def initiate(body: InitiateIn, request: Request, background: BackgroundTasks, user=Depends(get_optional_user)):
    ip = ratelimit.client_ip(request)
    ratelimit.check(f"pay:ip:{ip}", ratelimit.setting("PAYMENT_INITIATE_PER_10MIN_PER_IP", 15), 600)
    if user:
        ratelimit.check(f"pay:user:{user['user_id']}", ratelimit.setting("PAYMENT_INITIATE_PER_10MIN_PER_USER", 10), 600)
    order = await db.orders.find_one({"id": body.order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") and (not user or (user["user_id"] != order["user_id"] and user.get("role") != "admin")):
        raise HTTPException(status_code=403, detail="Forbidden")
    if order["payment_method"] not in ("mvola", "orange"):
        raise HTTPException(status_code=400, detail="Order does not use an API payment method")
    if not await gw.papi_auto_enabled():
        raise HTTPException(status_code=409, detail=gw.PAPI_AUTO_OFF_MESSAGE)
    latest = await latest_attempt(order["id"])
    if latest and latest["status"] == "pending":
        if gw.is_expired(latest):
            latest = await expire_attempt(latest, background)
            order = await db.orders.find_one({"id": body.order_id}, PUBLIC)
        elif latest.get("payment_url") or latest.get("simulated"):
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
    if not gw.is_simulated() and not gw.papi_configured():
        raise HTTPException(status_code=503, detail="Payment gateway not configured")
    attempt_no = (latest.get("attempt_no", 1) + 1) if latest else 1
    client_ref = gw.attempt_reference(order["order_number"], attempt_no)
    front = _frontend_url(request)
    track = f"{front}/suivi/{order['order_number']}?pubg_id={order['pubg_id']}"
    result = await gw.papi_create_link(order, client_ref, order["payment_method"], f"{track}&return=success", f"{track}&return=failure",
                                       f"{_backend_url(request)}/api/payments/papi/notification")
    created = _now()
    attempt = {
        "order_id": order["id"], "order_number": order["order_number"], "attempt_no": attempt_no, "client_ref": client_ref,
        "provider": order["payment_method"], "gateway": "papi", "provider_ref": result["provider_ref"], "amount": order["total"],
        "customer_phone": order["payment_phone"], "status": "pending", "payment_url": result.get("payment_url"),
        "notif_token": result.get("notif_token"), "simulated": gw.is_simulated(), "initiated_by": (user or {}).get("user_id"),
        "initiated_ip": ip, "created_at": _iso(created), "updated_at": _iso(created),
        "expires_at": _iso(created + timedelta(minutes=gw.timeout_minutes())),
    }
    await db.payments.insert_one(attempt)
    if order["status"] != "pending_payment":
        await _set_order_status(order["id"], "pending_payment", ("failed", "expired"))
        from routers.orders import reserve_subscription, SUBSCRIPTION_TYPES
        for item in order["items"]:
            if item["type"] in SUBSCRIPTION_TYPES:
                try:
                    await reserve_subscription(order["pubg_id"], item["type"], order, item.get("duration_months") or 1)
                except HTTPException as exc:
                    await db.payments.update_one({"client_ref": client_ref}, {"$set": {"status": "cancelled", "updated_at": _iso(), "cancel_reason": "subscription_conflict"}})
                    await _set_order_status(order["id"], "cancelled", ("pending_payment",))
                    raise exc
    await audit("payment.attempt", (user or {}).get("user_id") or f"ip:{ip}", order["id"], {"client_ref": client_ref, "attempt_no": attempt_no, "amount": order["total"]})
    return _public(attempt)


@router.get("/{order_id}/status")
async def status(order_id: str, background: BackgroundTasks):
    attempt = await latest_attempt(order_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="No payment for this order")
    if attempt["status"] == "pending":
        if gw.is_expired(attempt):
            attempt = await expire_attempt(attempt, background)
        elif attempt.get("simulated"):
            attempt = await apply_status(attempt, gw.simulated_status(attempt), "simulation", background)
        else:
            data = await gw.papi_read_link(attempt["client_ref"])
            await db.payments.update_one({"client_ref": attempt["client_ref"]}, {"$set": {"last_lookup": data, "papi_reference": data.get("papiPaymentReference")}})
            if gw.link_to_status(data) == "completed" and data.get("amount") is not None and int(float(data["amount"])) != int(attempt["amount"]):
                await audit("payment.amount_mismatch", "lookup", order_id, {"client_ref": attempt["client_ref"], "expected": attempt["amount"], "got": data["amount"]})
            else:
                attempt = await apply_status(attempt, gw.link_to_status(data), "lookup", background)
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "status": 1, "order_number": 1})
    return {"payment_status": attempt["status"], "order_status": order["status"], "order_number": order["order_number"],
            "payment_url": attempt.get("payment_url") if attempt["status"] == "pending" else None, "simulated": attempt.get("simulated", False),
            "expires_at": attempt.get("expires_at"), "attempt_no": attempt.get("attempt_no", 1), "client_ref": attempt["client_ref"]}


@router.post("/papi/notification")
async def papi_notification(request: Request, background: BackgroundTasks):
    raw = await request.body()
    signature = request.headers.get("X-Papi-Signature")
    if not gw.verify_papi_signature(raw, signature):
        logger.warning("Papi notification rejected: invalid signature")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    ref = body.get("merchantPaymentReference")
    attempt = await db.payments.find_one({"client_ref": ref, "gateway": "papi"}, PUBLIC) if isinstance(ref, str) else None
    if not attempt:
        await audit("payment.callback_unknown_reference", "papi", None, {"reference": str(ref)[:80]})
        raise HTTPException(status_code=403, detail="Unknown payment")
    expected_token = attempt.get("notif_token")
    if expected_token and not hmac.compare_digest(str(expected_token), str(body.get("notificationToken") or "")):
        await audit("payment.callback_bad_token", "papi", attempt["order_id"], {"client_ref": ref})
        raise HTTPException(status_code=403, detail="Invalid notification token")
    # Replay protection: identical signed payload seen before → acknowledge without reprocessing.
    dedupe_key = hashlib.sha256((signature or "").encode() + b"|" + raw).hexdigest()
    try:
        await db.payment_events.insert_one({"dedupe_key": dedupe_key, "client_ref": ref, "order_id": attempt["order_id"],
                                            "payment_status": body.get("paymentStatus"), "papi_reference": body.get("paymentReference"),
                                            "amount": body.get("amount"), "created_at": _iso()})
    except Exception:
        return {"ok": True, "duplicate": True}
    if attempt["status"] == "expired" and gw.normalize_status(body.get("paymentStatus", "")) == "completed":
        if body.get("amount") is None or int(round(float(body["amount"]))) == int(attempt["amount"]):
            await record_late_success(attempt, "papi", {"papi_reference": body.get("paymentReference"), "paid_with": body.get("paymentMethod"), "callback": body})
            return {"ok": True, "late": True}
    if attempt["status"] in gw.FINAL_STATUSES:
        return {"ok": True, "duplicate": True}
    if body.get("amount") is not None:
        try:
            received = int(round(float(body["amount"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid amount")
        if received != int(attempt["amount"]):
            await db.payments.update_one({"client_ref": ref}, {"$set": {"amount_mismatch": {"expected": attempt["amount"], "received": received, "at": _iso()}}})
            await audit("payment.amount_mismatch", "papi", attempt["order_id"], {"client_ref": ref, "expected": attempt["amount"], "received": received})
            raise HTTPException(status_code=400, detail="Amount mismatch")
    extra = {"callback": body, "papi_reference": body.get("paymentReference"), "paid_with": body.get("paymentMethod")}
    await db.payments.update_one({"client_ref": ref}, {"$set": {"callback": body, "papi_reference": body.get("paymentReference"), "paid_with": body.get("paymentMethod")}})
    await apply_status(attempt, body.get("paymentStatus", ""), "papi", background, {k: v for k, v in extra.items() if k != "callback"})
    return {"ok": True}


@router.get("/{order_id}/attempts", dependencies=[Depends(require_admin)])
async def attempts(order_id: str):
    docs = await db.payments.find({"order_id": order_id}, PUBLIC).sort("created_at", -1).to_list(50)
    return [{k: v for k, v in d.items() if k != "notif_token"} for d in docs]


@router.get("/admin/settings", dependencies=[Depends(require_admin)])
async def admin_payment_settings():
    return {"papi_auto": await gw.papi_auto_enabled(), "payment_mode": gw.mode()}


@router.patch("/admin/settings")
async def admin_update_payment_settings(body: PapiAutoIn, admin=Depends(require_admin)):
    await db.settings.update_one({"key": "store"}, {"$set": {"papi_auto": body.papi_auto, "updated_at": _iso()}}, upsert=True)
    await audit("payment.papi_auto_changed", admin["user_id"], None, {"papi_auto": body.papi_auto})
    return {"papi_auto": body.papi_auto, "payment_mode": gw.mode()}


@router.post("/{order_id}/simulate")
async def simulate(order_id: str, body: SimulateIn, background: BackgroundTasks, admin=Depends(require_admin)):
    attempt = await latest_attempt(order_id)
    if not attempt or not attempt.get("simulated"):
        raise HTTPException(status_code=400, detail="Only simulated payments can be forced")
    await audit("payment.simulate", admin["user_id"], order_id, {"outcome": body.outcome, "client_ref": attempt["client_ref"]})
    return _public(await apply_status(attempt, body.outcome, f"admin:{admin['user_id']}", background))
