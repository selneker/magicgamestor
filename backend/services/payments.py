import hashlib
import hmac
import os
import re
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

SIMULATION_DELAY_S = 8
SIGNATURE_TOLERANCE_S = 300
PROVIDER_CODES = {"mvola": "MVOLA", "orange": "ORANGE_MONEY"}


def mode() -> str:
    return os.environ.get("PAYMENT_MODE", "simulation")


def is_simulated() -> bool:
    return mode() == "simulation"


def papi_configured() -> bool:
    return bool(os.environ.get("PAPI_API_KEY") and os.environ.get("PAPI_WEBHOOK_SECRET"))


def _headers() -> dict:
    return {"Content-Type": "application/json", "Token": os.environ["PAPI_API_KEY"]}


def to_e164(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("261"):
        return f"+{digits}"
    return f"+261{digits.lstrip('0')}"


async def papi_create_link(order: dict, provider: str, success_url: str, failure_url: str, notif_url: str) -> dict:
    reference = order["order_number"]
    if is_simulated():
        return {"provider_ref": f"sim-{provider}-{uuid.uuid4().hex[:10]}", "client_ref": reference, "status": "pending",
                "payment_url": None, "notif_token": uuid.uuid4().hex, "raw": {"simulated": True}}
    payload = {
        "amount": order["total"], "clientName": order["pseudo"][:60], "reference": reference,
        "description": f"Magic Game Store {reference} - " + ", ".join(f"{i['quantity']}x {i['name']}" for i in order["items"]),
        "successUrl": success_url, "failureUrl": failure_url, "notificationUrl": notif_url,
        "validDuration": 1, "provider": PROVIDER_CODES[provider], "payerPhone": to_e164(order.get("payment_phone")),
    }
    payload["description"] = payload["description"][:255]
    if order.get("email"):
        payload["payerEmail"] = order["email"]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{os.environ['PAPI_API_BASE']}/payment-links", headers=_headers(), json=payload)
    if r.is_error:
        detail = (r.json().get("error") or {}).get("message", "Payment link creation failed") if r.headers.get("content-type", "").startswith("application/json") else "Payment link creation failed"
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
    if link in ("EXPIRED", "DISABLED"):
        return "failed"
    return "pending"


def verify_papi_signature(raw_body: bytes, header: str | None, tolerance: int = SIGNATURE_TOLERANCE_S) -> bool:
    secret = os.environ.get("PAPI_WEBHOOK_SECRET", "")
    if not header or not secret:
        return False
    parts = dict(item.strip().split("=", 1) for item in header.split(",") if "=" in item)
    t, v1 = parts.get("t", ""), parts.get("v1", "")
    if not re.fullmatch(r"[0-9]+", t) or not re.fullmatch(r"[0-9a-f]{64}", v1):
        return False
    if tolerance > 0 and abs(int(time.time()) - int(t)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), t.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


def simulated_status(payment: dict) -> str:
    created = datetime.fromisoformat(payment["created_at"])
    return "completed" if (datetime.now(timezone.utc) - created).total_seconds() >= SIMULATION_DELAY_S else "pending"


def normalize_status(raw: str) -> str:
    raw = (raw or "").lower()
    if raw in {"completed", "success", "successful", "paid"}:
        return "completed"
    if raw in {"failed", "expired", "cancelled", "canceled", "rejected", "disabled"}:
        return "failed"
    return "pending"
