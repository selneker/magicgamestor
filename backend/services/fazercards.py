"""FazerCards reseller API client — Phase 1: PUBG Mobile Player ID validation only."""
import os
import time

import httpx
from fastapi import HTTPException

TIMEOUT_S = 20
DISCOVERY_TTL_S = 600
PROVIDER_ERROR = "Service de vérification momentanément indisponible. Réessayez plus tard."

_discovery_cache = {"data": None, "at": 0.0}


def configured() -> bool:
    return bool(os.environ.get("FAZERCARDS_API_KEY"))


def _config() -> tuple[str, dict]:
    base = os.environ.get("FAZERCARDS_API_BASE", "https://api.fzr.cards/api/v2").rstrip("/")
    key = os.environ.get("FAZERCARDS_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Vérification d'ID indisponible (service non configuré).")
    return base, {"X-API-Key": key}


async def _request(method: str, path: str, **kwargs) -> dict:
    base, headers = _config()
    r = None
    for attempt in (1, 2):  # single retry: upstream game APIs are intermittently flaky
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                r = await client.request(method, f"{base}{path}", headers=headers, **kwargs)
        except httpx.TimeoutException:
            if attempt == 2:
                raise HTTPException(status_code=504, detail="La vérification a expiré. Réessayez.")
            continue
        except httpx.HTTPError:
            if attempt == 2:
                raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
            continue
        if r.status_code >= 500 and attempt == 1:
            continue
        break
    if r.status_code in (401, 403):
        raise HTTPException(status_code=502, detail="Vérification refusée par le fournisseur (configuration du service).")
    if r.status_code == 429:
        raise HTTPException(status_code=429, detail="Trop de vérifications. Réessayez dans un instant.")
    if r.is_error:
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    try:
        data = r.json()
    except ValueError:
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    return data


async def pubg_validation_target() -> tuple[str, str]:
    """Discover PUBG Mobile (category_id, player field key) via GET /topups/validate-id (never hardcoded)."""
    now = time.time()
    if _discovery_cache["data"] and now - _discovery_cache["at"] < DISCOVERY_TTL_S:
        return _discovery_cache["data"]
    data = await _request("GET", "/topups/validate-id")
    for item in data.get("items", []):
        category_id = item.get("category_id") or ""
        if "pubg" in category_id.lower():
            keys = [f.get("key") for f in (item.get("fields") or []) if f.get("key")]
            field_key = "player_id" if "player_id" in keys else (keys[0] if keys else None)
            if field_key:
                _discovery_cache["data"] = (category_id, field_key)
                _discovery_cache["at"] = now
                return category_id, field_key
    raise HTTPException(status_code=503, detail="La validation PUBG Mobile n'est pas disponible chez le fournisseur.")


async def validate_pubg_id(player_id: str) -> dict:
    category_id, field_key = await pubg_validation_target()
    data = await _request("POST", "/topups/validate-id",
                          json={"category_id": category_id, "fields": {field_key: player_id}})
    if "valid" not in data:
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    if not data["valid"]:
        return {"valid": False}
    return {"valid": True, "player_name": data.get("player_name"), "region": data.get("region")}
