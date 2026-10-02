"""Frais de paiement facturés au client, configurables par provider dans l'Admin."""
from core.db import db

DEFAULTS = {
    "fiveone": {"percent": 2.75, "min": 100, "max": 16500},
    "papi": {"percent": 0.0, "min": 100, "max": 16500},
}
PROVIDERS = tuple(DEFAULTS)  # grilles configurables dans l'Admin
MANUAL = {"percent": 0.0, "min": 0, "max": 0}  # USSD manuel : toujours gratuit, non configurable


def _clean(saved: dict | None, default: dict) -> dict:
    out = dict(default)
    for key, cast in (("percent", float), ("min", int), ("max", int)):
        value = saved.get(key) if isinstance(saved, dict) else None
        if isinstance(value, (int, float)) and value >= 0:
            out[key] = cast(value)
    if out["max"] < out["min"]:
        out["max"] = out["min"]
    return out


def compute(rule: dict, amount: int) -> int:
    fee = round(int(amount) * float(rule["percent"]) / 100)
    return int(min(max(fee, rule["min"]), rule["max"]))


def provider_key(provider: str | None) -> str:
    """Aucun provider automatique => USSD manuel (gratuit)."""
    return provider if provider in PROVIDERS else "manual"


async def fee_config() -> dict:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0}) or {}
    saved = doc.get("payment_fees") or {}
    defaults = {p: dict(r) for p, r in DEFAULTS.items()}
    legacy = doc.get("verification_fee")
    if isinstance(legacy, (int, float)) and legacy >= 0 and not saved.get("papi"):
        defaults["papi"]["min"] = int(legacy)  # tarif historique MGS (frais fixe)
    return {"manual": dict(MANUAL), **{p: _clean(saved.get(p), defaults[p]) for p in PROVIDERS}}


async def calculate_payment_fee(provider: str | None, amount: int) -> int:
    return compute((await fee_config())[provider_key(provider)], amount)
