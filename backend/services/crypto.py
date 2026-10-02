"""Binance USDT on-chain payments: admin settings, server-side unique quotes and CryptoPayment records."""
import random
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_UP, Decimal

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db
from services import binance

NETWORKS = ("TRC20", "BEP20", "APTOS", "TON")
LABELS = {"TRC20": "Tron (TRC20)", "BEP20": "BNB Smart Chain (BEP20)", "APTOS": "Aptos", "TON": "TON"}
WAITING, DETECTED, CONFIRMED, FAILED = "WAITING", "DETECTED", "CONFIRMED", "FAILED"
OPEN = (WAITING, DETECTED)
DEFAULT_EXPIRY_MIN = 30
STEP = Decimal("0.0001")
PUBLIC = {"_id": 0}
HIDDEN = ("slot_open", "history", "deposit")


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now()).isoformat()


def fmt(value: Decimal) -> str:
    return f"{value.quantize(STEP)}"


async def get_settings() -> dict:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "binance": 1}) or {}
    saved = doc.get("binance") or {}
    wallets = {}
    for n in NETWORKS:
        w = (saved.get("wallets") or {}).get(n) or {}
        wallets[n] = {"address": (w.get("address") or "").strip(), "memo": (w.get("memo") or "").strip(), "active": bool(w.get("active"))}
    return {"enabled": bool(saved.get("enabled")), "rate_ar_per_usdt": float(saved.get("rate_ar_per_usdt") or 0),
            "expiry_minutes": int(saved.get("expiry_minutes") or DEFAULT_EXPIRY_MIN), "wallets": wallets}


def active_networks(s: dict) -> list[str]:
    return [n for n in NETWORKS if s["wallets"][n]["active"] and s["wallets"][n]["address"]]


def is_available(s: dict) -> bool:
    return s["enabled"] and s["rate_ar_per_usdt"] > 0 and bool(active_networks(s)) and binance.configured()


async def available() -> bool:
    return is_available(await get_settings())


async def public_config() -> dict:
    s = await get_settings()
    ok = is_available(s)
    networks = [{"key": n, "label": LABELS[n], "memo_required": bool(s["wallets"][n]["memo"])} for n in active_networks(s)]
    return {"available": ok, "currency": "USDT", "expiry_minutes": s["expiry_minutes"], "networks": networks if ok else []}


def public(payment: dict | None) -> dict | None:
    return {k: v for k, v in payment.items() if k not in HIDDEN} if payment else None


def base_amount(amount_ar: int, rate: float) -> Decimal:
    return (Decimal(int(amount_ar)) / Decimal(str(rate))).quantize(Decimal("0.01"), rounding=ROUND_UP)


async def create_payment(order: dict, network: str) -> dict:
    s = await get_settings()
    if not is_available(s):
        raise HTTPException(status_code=409, detail="Paiement Binance USDT indisponible.")
    if network not in active_networks(s):
        raise HTTPException(status_code=400, detail="Réseau USDT non disponible.")
    existing = await db.crypto_payments.find_one({"order_id": order["id"], "slot_open": True}, PUBLIC)
    if existing:
        if existing["network"] == network:
            return existing
        raise HTTPException(status_code=409, detail="Un paiement USDT est déjà en cours pour cette commande.")
    wallet, rate, created = s["wallets"][network], s["rate_ar_per_usdt"], now()
    base = base_amount(order["total"], rate)
    doc = {
        "id": str(uuid.uuid4()), "order_id": order["id"], "order_number": order["order_number"], "user_id": order.get("user_id"),
        "network": network, "binance_network": binance.NETWORKS[network], "currency": "USDT",
        "address": wallet["address"], "memo": wallet["memo"] or None,
        "rate_ar_per_usdt": rate, "amount_ar": order["total"], "base_usdt": fmt(base),
        "status": WAITING, "slot_open": True, "tx_hash": None, "deposit_id": None,
        "created_at": iso(created), "expires_at": iso(created + timedelta(minutes=s["expiry_minutes"])), "updated_at": iso(created),
        "history": [{"status": WAITING, "at": iso(created)}],
    }
    for suffix in random.sample(range(1, 100), 99):  # unique amount per open (network, amount) slot
        doc["amount_usdt"] = fmt(base + STEP * suffix)
        doc.pop("_id", None)
        try:
            await db.crypto_payments.insert_one(doc)
            doc.pop("_id", None)
            return doc
        except DuplicateKeyError as exc:
            if "order_id" in str(exc):
                return await db.crypto_payments.find_one({"order_id": order["id"], "slot_open": True}, PUBLIC)
    raise HTTPException(status_code=503, detail="Trop de paiements USDT en cours. Réessayez dans quelques minutes.")
