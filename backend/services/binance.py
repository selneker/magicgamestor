"""Binance Exchange (CEX) wallet API — read-only client for USDT deposit detection (no Binance Pay, no withdrawals)."""
import hashlib
import hmac
import os
import re
import time
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

TIMEOUT_S = 15
# MGS network key -> Binance `network` code (GET /sapi/v1/capital/config/getall → networkList[].network).
NETWORKS = {"TRC20": "TRX", "BEP20": "BSC", "APTOS": "APT", "TON": "TON"}
NETWORK_KEYS = {v: k for k, v in NETWORKS.items()}
# Deposit history status: 0 pending, 1 success, 2 rejected, 6 credited but cannot withdraw, 7 wrong deposit, 8 waiting user confirm.
DEPOSIT_PENDING = {0, 8}
DEPOSIT_SUCCESS = {1, 6}
DEPOSIT_REJECTED = {2, 7}
HMAC_CREDENTIAL = re.compile(r"^[A-Za-z0-9]{64}$")  # Binance HMAC API key / secret format
PLACEHOLDER_MARKERS = ("dummy", "placeholder", "changeme", "example", "preview", "yourapi", "yourkey", "yoursecret")


def _real_credential(value: str | None) -> bool:
    v = (value or "").strip()
    return bool(HMAC_CREDENTIAL.match(v)) and len(set(v)) >= 16 and not any(m in v.lower() for m in PLACEHOLDER_MARKERS)


def configured() -> bool:
    """True only for real-looking keys: absent, empty or placeholder values never count as configured."""
    return _real_credential(os.environ.get("BINANCE_API_KEY")) and _real_credential(os.environ.get("BINANCE_API_SECRET"))


async def _signed_get(path: str, params: dict) -> list | dict:
    if not configured():
        raise HTTPException(status_code=503, detail="Clés API Binance absentes côté serveur.")
    base = os.environ.get("BINANCE_API_BASE", "https://api.binance.com").rstrip("/")
    key, secret = os.environ["BINANCE_API_KEY"].strip(), os.environ["BINANCE_API_SECRET"].strip()
    query = urlencode({**params, "timestamp": int(time.time() * 1000), "recvWindow": 10000})
    signature = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await client.get(f"{base}{path}?{query}&signature={signature}", headers={"X-MBX-APIKEY": key})
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Binance API injoignable.")
    if r.is_error:
        try:
            body = r.json()
            msg = f"{body.get('code')}: {body.get('msg')}"
        except ValueError:
            msg = f"HTTP {r.status_code}"
        raise HTTPException(status_code=502, detail=f"Binance API error ({msg})")
    return r.json()


async def deposit_history(start_ms: int, end_ms: int | None = None) -> list[dict]:
    params = {"coin": "USDT", "startTime": start_ms, "limit": 1000}
    if end_ms:
        params["endTime"] = end_ms
    data = await _signed_get("/sapi/v1/capital/deposit/hisrec", params)
    return data if isinstance(data, list) else []


async def usdt_networks() -> list[dict]:
    """Live USDT network list (deposit enabled, memo regex, confirmations) — admin diagnostics only."""
    coins = await _signed_get("/sapi/v1/capital/config/getall", {})
    usdt = next((c for c in coins if c.get("coin") == "USDT"), None) or {}
    keep = ("network", "name", "depositEnable", "memoRegex", "sameAddress", "minConfirm", "unLockConfirm", "depositDust")
    return [{k: n.get(k) for k in keep} | {"mgs_key": NETWORK_KEYS.get(n.get("network"))} for n in usdt.get("networkList", [])]
