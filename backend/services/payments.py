import hashlib
import hmac
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

SIMULATION_DELAY_S = 8  # simulated payments auto-complete after ~8s (local/dev only)
SIGNATURE_TOLERANCE_S = 300
PROVIDER_CODES = {"mvola": "MVOLA", "orange": "ORANGE_MONEY"}
# Papi validDuration is in WHOLE HOURS (min 1). The 15-minute business deadline is enforced internally.
PAPI_VALID_DURATION_HOURS = 1
LEGACY_ATTEMPT_TTL_MINUTES = 60
FINAL_STATUSES = ("completed", "failed", "expired", "cancelled", "late_success")


def mode() -> str:
    return os.environ.get("PAYMENT_MODE", "simulation")


def is_simulated() -> bool:
    return mode() == "simulation"


def papi_configured() -> bool:
    return bool(os.environ.get("PAPI_API_KEY") and os.environ.get("PAPI_WEBHOOK_SECRET"))


PAPI_AUTO_OFF_MESSAGE = "Le paiement automatique est désactivé. Utilisez le paiement manuel (USSD + référence)."


async def papi_auto_enabled() -> bool:
    """Admin switch (db.settings/store.papi_auto). OFF ⇒ no Papi link/API call for new orders."""
    from core.db import db
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "papi_auto": 1})
    return bool(doc and doc.get("papi_auto"))


def timeout_minutes() -> int:
    try:
        return max(1, int(os.environ.get("PAYMENT_TIMEOUT_MINUTES", 15)))
    except ValueError:
        return 15


def attempt_reference(order_number: str, attempt_no: int) -> str:
    """Attempt 1 keeps the historical reference (== order_number); retries get a distinct suffix."""
    return order_number if attempt_no <= 1 else f"{order_number}-A{attempt_no}"


def attempt_deadline(attempt: dict) -> datetime:
    if attempt.get("expires_at"):
        return datetime.fromisoformat(attempt["expires_at"])
    return datetime.fromisoformat(attempt["created_at"]) + timedelta(minutes=LEGACY_ATTEMPT_TTL_MINUTES)


def is_expired(attempt: dict, now: datetime | None = None) -> bool:
    return attempt_deadline(attempt) <= (now or datetime.now(timezone.utc))


def _headers() -> dict:
    return {"Content-Type": "application/json", "Token": os.environ["PAPI_API_KEY"]}


def to_e164(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("261"):
        return f"+{digits}"
    return f"+261{digits.lstrip('0')}"


async def papi_create_link(order: dict, reference: str, provider: str, success_url: str, failure_url: str, notif_url: str) -> dict:
    if is_simulated():
        return {"provider_ref": f"sim-{provider}-{uuid.uuid4().hex[:10]}", "client_ref": reference, "status": "pending",
                "payment_url": None, "notif_token": uuid.uuid4().hex, "raw": {"simulated": True}}
    payload = {
        "amount": order["total"], "clientName": order["pseudo"][:60], "reference": reference,
        "description": f"Magic Game Store {order['order_number']} - " + ", ".join(f"{i['quantity']}x {i['name']}" for i in order["items"]),
        "successUrl": success_url, "failureUrl": failure_url, "notificationUrl": notif_url,
        "validDuration": PAPI_VALID_DURATION_HOURS, "provider": PROVIDER_CODES[provider],
        "payerPhone": to_e164(order.get("payment_phone")),
    }
    payload["description"] = payload["description"][:255]
    if order.get("email"):
        payload["payerEmail"] = order["email"]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{os.environ['PAPI_API_BASE']}/payment-links", headers=_headers(), json=payload)
    if r.is_error:
        is_json = r.headers.get("content-type", "").startswith("application/json")
        detail = (r.json().get("error") or {}).get("message", "Payment link creation failed") if is_json else "Payment link creation failed"
        raise HTTPException(status_code=502 if r.status_code >= 500 else 400, detail=detail)
    data = r.json()["data"]
    return {"provider_ref": data.get("paymentReference") or reference, "client_ref": reference, "status": "pending",
            "payment_url": data["paymentLink"], "notif_token": data.get("notificationToken"), "raw": data}


async def papi_read_link(reference: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{os.environ['PAPI_API_BASE']}/payment-links/{reference}", headers=_headers())
    if r.status_code == 404:
        return {"paymentStatus": None, "linkStatus": "EXPIRED"}
    if r.is_error:
        raise HTTPException(status_code=502, detail="Payment status lookup failed")
    return r.json()["data"]


def link_to_status(data: dict) -> str:
    payment, link = (data.get("paymentStatus") or "").upper(), (data.get("linkStatus") or "").upper()
    if payment == "SUCCESS" or link == "PAID":
        return "completed"
    if payment in ("FAILED", "CANCELLED", "CANCELED", "REJECTED") or link in ("EXPIRED", "DISABLED"):
        return "failed"
    return "pending"


def verify_papi_signature(raw_body: bytes, header: str | None, tolerance: int = SIGNATURE_TOLERANCE_S) -> bool:
    """X-Papi-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + '.' + raw_body))> — constant-time compare."""
    secret = os.environ.get("PAPI_WEBHOOK_SECRET", "")
    if not header or not secret:
        return False
    parts = dict(item.strip().split("=", 1) for item in header.split(",") if "=" in item)
    t, v1 = parts.get("t", ""), parts.get("v1", "")
    if not re.fullmatch(r"[0-9]{1,18}", t) or not re.fullmatch(r"[0-9a-f]{64}", v1):
        return False
    if tolerance > 0 and abs(int(time.time()) - int(t)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), t.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


def sign_papi_body(raw_body: bytes, secret: str, t: int | None = None) -> str:
    t = t or int(time.time())
    v1 = hmac.new(secret.encode(), str(t).encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def simulated_status(payment: dict) -> str:
    created = datetime.fromisoformat(payment["created_at"])
    return "completed" if (datetime.now(timezone.utc) - created).total_seconds() >= SIMULATION_DELAY_S else "pending"


def normalize_status(raw: str) -> str:
    raw = (raw or "").lower()
    if raw in {"completed", "success", "successful", "paid"}:
        return "completed"
    if raw in {"failed", "expired", "cancelled", "canceled", "rejected", "disabled", "failure"}:
        return "failed"
    return "pending"
