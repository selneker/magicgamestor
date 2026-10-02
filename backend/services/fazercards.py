"""FazerCards reseller API client — Phase 1: validation ID PUBG Mobile. Phase 2: découverte catalogue/offres."""
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


CATALOG_TTL_S = 600
_catalog_cache: dict = {}


def _cached(key: str):
    hit = _catalog_cache.get(key)
    return hit[1] if hit and time.time() - hit[0] < CATALOG_TTL_S else None


def _store(key: str, value):
    _catalog_cache[key] = (time.time(), value)
    return value


async def pubg_categories() -> list[dict]:
    """PUBG Mobile purchasable categories via GET /topups (cursor pagination — ids never hardcoded)."""
    cached = _cached("categories")
    if cached is not None:
        return cached
    items, cursor = [], None
    for _ in range(20):
        params = {"limit": "500"}
        if cursor:
            params["cursor"] = cursor
        data = await _request("GET", "/topups", params=params)
        page, meta = data.get("items"), data.get("meta")
        if not isinstance(page, list) or not isinstance(meta, dict):
            raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
        items += page
        cursor = meta.get("next_cursor")
        if not meta.get("has_more") or not cursor:
            break
    pubg = [{"category_id": c.get("category_id"), "name": c.get("name"), "note": c.get("note")}
            for c in items
            if "pubg_mobile" in (c.get("category_id") or "").lower() or "pubg mobile" in (c.get("name") or "").lower()]
    if not pubg:
        raise HTTPException(status_code=503, detail="Aucune catégorie PUBG Mobile disponible chez le fournisseur.")
    return _store("categories", pubg)


async def pubg_offers(category_id: str) -> dict:
    """Offers + required fields for one category via GET /topups/offers."""
    cached = _cached(f"offers:{category_id}")
    if cached is not None:
        return cached
    data = await _request("GET", "/topups/offers", params={"category_id": category_id})
    offers, fields = data.get("offers"), data.get("fields")
    if not isinstance(offers, list) or not isinstance(fields, list):
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    return _store(f"offers:{category_id}", {
        "category_id": data.get("category_id") or category_id,
        "name": data.get("name"),
        "note": data.get("note"),
        "offers": [{"offer_id": o.get("offer_id"), "name": o.get("name"), "price_usd": o.get("price_usd")} for o in offers],
        "fields": [{"key": f.get("key"), "label": f.get("label"), "type": f.get("type")} for f in fields],
    })


async def pubg_catalog() -> list[dict]:
    return [await pubg_offers(c["category_id"]) for c in await pubg_categories()]


async def pubg_offers_fresh(category_id: str) -> dict:
    """Bypass cache: live offers/prices revalidated right before a provider order."""
    _catalog_cache.pop(f"offers:{category_id}", None)
    return await pubg_offers(category_id)


class ProviderTimeout(Exception):
    """Network timeout after submitting POST /topups/order — retry MUST reuse the same Idempotency-Key."""


class ProviderOrderError(Exception):
    def __init__(self, status_code: int, error: str, code: str | None = None):
        super().__init__(error)
        self.status_code, self.error, self.code = status_code, error, code


async def create_topup_order(category_id: str, offer_id: str, fields: dict, idempotency_key: str) -> dict:
    """POST /topups/order — single attempt, no auto-retry (idempotency key is managed by the caller)."""
    base, headers = _config()
    headers = {**headers, "Idempotency-Key": idempotency_key}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await client.post(f"{base}/topups/order", headers=headers,
                                  json={"category_id": category_id, "offer_id": offer_id, "fields": fields})
    except httpx.TimeoutException:
        raise ProviderTimeout()
    except httpx.HTTPError:
        raise ProviderOrderError(502, "Fournisseur injoignable.")
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.is_error or data.get("ok") is not True:
        raise ProviderOrderError(r.status_code if r.is_error else 502,
                                 str(data.get("error") or "Erreur fournisseur inattendue.")[:300], data.get("code"))
    order = data.get("order")
    if not isinstance(order, dict) or not order.get("id"):
        raise ProviderOrderError(502, "Réponse fournisseur inattendue (commande absente).")
    return order


async def get_provider_order(provider_order_id: str) -> dict:
    data = await _request("GET", f"/orders/{provider_order_id}")
    order = data.get("order")
    if not isinstance(order, dict):
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    return order
