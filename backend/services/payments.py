import os
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

SIMULATION_DELAY_S = 8
_tokens: dict[str, dict] = {"mvola": {}, "orange": {}}


def mode() -> str:
    return os.environ.get("PAYMENT_MODE", "simulation")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def provider_configured(provider: str) -> bool:
    if provider == "mvola":
        return bool(os.environ.get("MVOLA_CONSUMER_KEY") and os.environ.get("MVOLA_CONSUMER_SECRET"))
    return bool(os.environ.get("ORANGE_CLIENT_ID") and os.environ.get("ORANGE_CLIENT_SECRET") and os.environ.get("ORANGE_MERCHANT_KEY"))


def is_simulated() -> bool:
    return mode() == "simulation"


# ---------- MVola Merchant Pay ----------
def _mvola_base():
    return "https://api.mvola.mg" if mode() == "production" else "https://devapi.mvola.mg"


MVOLA_TX_PATH = "/mvola/mm/transactions/type/merchantpay/1.0.0/"


async def _mvola_token() -> str:
    cache = _tokens["mvola"]
    if cache.get("value") and time.time() < cache.get("expires_at", 0) - 60:
        return cache["value"]
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{_mvola_base()}/token",
                              auth=(os.environ["MVOLA_CONSUMER_KEY"], os.environ["MVOLA_CONSUMER_SECRET"]),
                              headers={"Accept": "application/json", "Cache-Control": "no-cache"},
                              data={"grant_type": "client_credentials", "scope": "EXT_INT_MVOLA_SCOPE"})
    if r.is_error:
        raise HTTPException(status_code=502, detail="MVola authentication failed")
    data = r.json()
    cache.update(value=data["access_token"], expires_at=time.time() + int(data.get("expires_in", 3600)))
    return cache["value"]


def _mvola_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}", "Version": "1.0", "X-CorrelationID": str(uuid.uuid4()),
        "UserLanguage": "FR", "UserAccountIdentifier": f"msisdn;{os.environ['MVOLA_MERCHANT_MSISDN']}",
        "partnerName": os.environ.get("MVOLA_PARTNER_NAME", "Magic Game Store"), "Cache-Control": "no-cache",
        "Content-Type": "application/json",
    }


async def mvola_initiate(order: dict, customer_msisdn: str, callback_url: str) -> dict:
    client_ref = order["order_number"]
    if is_simulated():
        return {"provider_ref": f"sim-mvola-{uuid.uuid4().hex[:10]}", "status": "pending", "client_ref": client_ref, "raw": {"simulated": True}}
    token = await _mvola_token()
    payload = {
        "amount": str(order["total"]), "currency": "Ar", "descriptionText": f"MGS {client_ref}"[:50],
        "requestingOrganisationTransactionReference": client_ref, "originalTransactionReference": client_ref,
        "requestDate": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "debitParty": [{"key": "msisdn", "value": customer_msisdn}],
        "creditParty": [{"key": "msisdn", "value": os.environ["MVOLA_MERCHANT_MSISDN"]}],
        "metadata": [{"key": "partnerName", "value": os.environ.get("MVOLA_PARTNER_NAME", "Magic Game Store")},
                     {"key": "fc", "value": "USD"}, {"key": "amountFc", "value": "1"}],
    }
    headers = _mvola_headers(token)
    headers["X-Callback-URL"] = callback_url
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{_mvola_base()}{MVOLA_TX_PATH}", headers=headers, json=payload)
    if r.is_error:
        raise HTTPException(status_code=502, detail="MVola payment initiation failed")
    data = r.json()
    return {"provider_ref": data.get("serverCorrelationId"), "status": data.get("status", "pending"), "client_ref": client_ref, "raw": data}


async def mvola_status(provider_ref: str) -> str:
    token = await _mvola_token()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{_mvola_base()}{MVOLA_TX_PATH}status/{provider_ref}", headers=_mvola_headers(token))
    if r.is_error:
        raise HTTPException(status_code=502, detail="MVola status lookup failed")
    return (r.json().get("status") or "pending").lower()


# ---------- Orange Money WebPay ----------
async def _orange_token() -> str:
    cache = _tokens["orange"]
    if cache.get("value") and time.time() < cache.get("expires_at", 0) - 60:
        return cache["value"]
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post("https://api.orange.com/oauth/v3/token",
                              auth=(os.environ["ORANGE_CLIENT_ID"], os.environ["ORANGE_CLIENT_SECRET"]),
                              data={"grant_type": "client_credentials"}, headers={"Accept": "application/json"})
    if r.is_error:
        raise HTTPException(status_code=502, detail="Orange Money authentication failed")
    data = r.json()
    cache.update(value=data["access_token"], expires_at=time.time() + int(data.get("expires_in", 3600)))
    return cache["value"]


async def _orange_post(path: str, payload: dict) -> dict:
    token = await _orange_token()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{os.environ['ORANGE_API_BASE']}{path}", json=payload,
                              headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"})
    if r.status_code == 401:
        _tokens["orange"].clear()
    if r.is_error:
        raise HTTPException(status_code=502, detail="Orange Money API error")
    return r.json()


async def orange_initiate(order: dict, return_url: str, cancel_url: str, notif_url: str) -> dict:
    order_id = order["order_number"][:30]
    if is_simulated():
        return {"provider_ref": f"sim-orange-{uuid.uuid4().hex[:10]}", "status": "pending", "client_ref": order_id,
                "payment_url": return_url, "notif_token": uuid.uuid4().hex, "raw": {"simulated": True}}
    data = await _orange_post("/webpayment", {
        "merchant_key": os.environ["ORANGE_MERCHANT_KEY"], "currency": os.environ.get("ORANGE_CURRENCY", "OUV"),
        "order_id": order_id, "amount": order["total"], "return_url": return_url, "cancel_url": cancel_url,
        "notif_url": notif_url, "lang": "fr", "reference": "Magic Game Store",
    })
    return {"provider_ref": data.get("pay_token"), "status": "pending", "client_ref": order_id,
            "payment_url": data.get("payment_url"), "notif_token": data.get("notif_token"), "raw": data}


async def orange_status(payment: dict) -> str:
    data = await _orange_post("/webpayment/status", {"order_id": payment["client_ref"], "amount": payment["amount"], "pay_token": payment["provider_ref"]})
    return (data.get("status") or "pending").lower()


# ---------- Simulation ----------
def simulated_status(payment: dict) -> str:
    created = datetime.fromisoformat(payment["created_at"])
    elapsed = (datetime.now(timezone.utc) - created).total_seconds()
    return "completed" if elapsed >= SIMULATION_DELAY_S else "pending"


def normalize_status(raw: str) -> str:
    raw = (raw or "").lower()
    if raw in {"completed", "success", "successful"}:
        return "completed"
    if raw in {"failed", "expired", "cancelled", "canceled", "rejected"}:
        return "failed"
    return "pending"
