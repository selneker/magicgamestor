"""FiveOne Pay client (MVola / Orange Money). Fully independent from the PAPI gateway."""
import hashlib
import hmac
import os

import httpx
from fastapi import HTTPException

from core.db import db

OPERATORS = {"mvola": "MVOLA", "orange": "ORANGE_MONEY"}
FIVEONE_OFF_MESSAGE = "Le paiement automatique est désactivé. Utilisez le paiement manuel (USSD + référence)."


def configured() -> bool:
    return bool(os.environ.get("FIVEONE_API_KEY") and os.environ.get("FIVEONE_API_BASE"))


def is_sandbox() -> bool:
    return os.environ.get("FIVEONE_API_KEY", "").startswith("sk_test_")


async def store_settings() -> dict:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0}) or {}
    return {
        "papi_auto": bool(doc.get("papi_auto")),
        "fiveone_enabled": bool(doc.get("fiveone_enabled")),
    }


async def enabled() -> bool:
    return (await store_settings())["fiveone_enabled"]


async def resolve_provider() -> str | None:
    """Which automatic gateway handles a new mvola/orange order (FiveOne first when both are ON)."""
    s = await store_settings()
    if s["fiveone_enabled"]:
        return "fiveone"
    if s["papi_auto"]:
        return "papi"
    return None


def _headers(idempotency_key: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {os.environ['FIVEONE_API_KEY']}", "Content-Type": "application/json"}
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h


def _error(r: httpx.Response) -> HTTPException:
    detail = "Payment creation failed"
    try:
        body = r.json()
        detail = body.get("message") or body.get("error") or (body.get("errors") and str(body["errors"])) or detail
        if isinstance(detail, dict):
            detail = detail.get("message") or str(detail)
    except ValueError:
        pass
    return HTTPException(status_code=502 if r.status_code >= 500 else 400, detail=str(detail)[:200])


async def create_payment(order: dict, reference: str, provider: str, callback_url: str, success_url: str) -> dict:
    payload = {
        "amount": int(order["total"]), "reference": reference, "operator": OPERATORS[provider],
        "payerNumber": order["payment_phone"],
        "description": (f"Magic Game Store {order['order_number']} - " + ", ".join(f"{i['quantity']}x {i['name']}" for i in order["items"]))[:255],
        "callbackUrl": callback_url, "successUrl": success_url,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{os.environ['FIVEONE_API_BASE']}/payments", headers=_headers(reference), json=payload)
    if r.is_error:
        raise _error(r)
    data = r.json()
    data = data.get("data", data) if isinstance(data, dict) else data
    return {"provider_ref": str(data.get("id") or reference), "status": str(data.get("status") or "PENDING"),
            "payment_url": data.get("payment_url") or data.get("paymentUrl"), "fiveone_reference": data.get("fiveonepay_reference"), "raw": data}


async def get_payment(payment_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{os.environ['FIVEONE_API_BASE']}/payments/{payment_id}", headers=_headers())
    if r.status_code == 404:
        return {"status": "EXPIRED"}
    if r.is_error:
        raise HTTPException(status_code=502, detail="Payment status lookup failed")
    data = r.json()
    return data.get("data", data) if isinstance(data, dict) else data


def verify_signature(raw_body: bytes, header: str | None) -> bool:
    secret = os.environ.get("FIVEONE_WEBHOOK_SECRET", "")
    if not header or not secret:
        return False
    supplied = header.strip()
    if "=" in supplied:  # tolerate "v1=<hex>" / "sha256=<hex>" formats
        supplied = supplied.split(",")[-1].split("=", 1)[1].strip()
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, supplied.lower())


def normalize_status(raw: str | None) -> str:
    raw = (raw or "").upper()
    if raw in ("SUCCESS", "SUCCEEDED", "COMPLETED", "PAID"):
        return "completed"
    if raw in ("FAILED", "EXPIRED", "CANCELLED", "CANCELED", "REJECTED"):
        return "failed"
    return "pending"
