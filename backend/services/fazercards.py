"""FazerCards reseller API client — Phase 1: validation ID PUBG Mobile. Phase 2: découverte catalogue/offres."""
import logging
import os
import time

import httpx
from fastapi import HTTPException

from core.db import db
from services.providers.errors import (ProviderInsufficientBalanceError, ProviderOrderError,
                                        ProviderTimeout)

logger = logging.getLogger(__name__)

TIMEOUT_S = 20
DISCOVERY_TTL_S = 600
PROVIDER_ERROR = "Service de vérification momentanément indisponible. Réessayez plus tard."


class IdentityValidationHTTPException(HTTPException):
    """HTTPException portant un code machine stable pour le contrat de validation d'identité."""

    def __init__(self, status_code: int, detail: str, code: str):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code


_discovery_cache = {"data": None, "at": 0.0}


def configured() -> bool:
    return bool(os.environ.get("FAZERCARDS_API_KEY"))


def _config() -> tuple[str, dict]:
    base = os.environ.get("FAZERCARDS_API_BASE", "https://api.fzr.cards/api/v2").rstrip("/")
    key = os.environ.get("FAZERCARDS_API_KEY")
    if not key:
        raise IdentityValidationHTTPException(
            status_code=503,
            detail="Vérification d'ID indisponible (service non configuré).",
            code="provider_unavailable",
        )
    return base, {"X-API-Key": key}


async def _request(method: str, path: str, *, invalid_id_on_422: bool = False, **kwargs) -> dict:
    """Appel HTTP au fournisseur, traduit en contrat MGS.

    Args:
        method: verbe HTTP.
        path: chemin relatif à `FAZERCARDS_API_BASE`.
        invalid_id_on_422: réservé à la validation d'identité. FazerCards répond `422` sur
            `POST /topups/validate-id` quand l'identifiant soumis n'existe pas : ce n'est pas une
            panne, c'est un refus d'identité (voir `validate_identity`). Les autres appels
            (catalogue, offres, commandes) conservent le mapping historique 4xx -> 502.
        **kwargs: transmis tels quels à `httpx`.

    Returns:
        Corps JSON du fournisseur, ou `{"valid": False}` pour un 422 d'identité refusée.
    """
    base, headers = _config()
    r = None
    for attempt in (1, 2):  # single retry: upstream game APIs are intermittently flaky
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                r = await client.request(method, f"{base}{path}", headers=headers, **kwargs)
        except httpx.TimeoutException:
            if attempt == 2:
                raise IdentityValidationHTTPException(
                    status_code=504,
                    detail="La vérification a expiré. Réessayez.",
                    code="provider_unavailable",
                )
            continue
        except httpx.HTTPError:
            if attempt == 2:
                raise IdentityValidationHTTPException(
                    status_code=502, detail=PROVIDER_ERROR, code="provider_unavailable")
            continue
        if r.status_code >= 500 and attempt == 1:
            continue
        break
    if r.status_code in (401, 403):
        raise IdentityValidationHTTPException(
            status_code=502,
            detail="Vérification refusée par le fournisseur (configuration du service).",
            code="provider_unavailable",
        )
    if r.status_code == 429:
        raise IdentityValidationHTTPException(
            status_code=429,
            detail="Trop de vérifications. Réessayez dans un instant.",
            code="rate_limited",
        )
    if r.status_code == 422 and invalid_id_on_422:
        # PL-003-BE-9 : FazerCards signale « identifiant inexistant » par un 422 sur
        # `POST /topups/validate-id` (constaté en production sur un ID Free Fire). C'est un
        # verdict d'identité, pas une indisponibilité : on le traduit en `valid: false`, que
        # `validate_identity` renvoie tel quel et que la route rend en 200 `invalid_id`, comme
        # pour PUBG Mobile. FAIL-CLOSED : un ID refusé n'est jamais accepté.
        # Les 5xx (dont le 502 passager de FazerCards), timeouts, 401/403, 429 et réponses
        # illisibles gardent leur traitement d'origine.
        logger.warning(
            "fazercards validate-id : HTTP 422 du fournisseur traduit en identifiant invalide "
            "(aucune donnée joueur journalisée)")
        return {"valid": False}
    if r.is_error:
        raise IdentityValidationHTTPException(
            status_code=502, detail=PROVIDER_ERROR, code="provider_unavailable")
    try:
        data = r.json()
    except ValueError:
        raise IdentityValidationHTTPException(
            status_code=502, detail=PROVIDER_ERROR, code="provider_unavailable")
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise IdentityValidationHTTPException(
            status_code=502, detail=PROVIDER_ERROR, code="provider_unavailable")
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
    raise IdentityValidationHTTPException(
        status_code=503,
        detail="La validation PUBG Mobile n'est pas disponible chez le fournisseur.",
        code="provider_unavailable",
    )


_game_discovery_cache: dict = {}  # game_id -> (category_id, field_key, at)


async def validation_target(game_id: str | None) -> tuple[str, str]:
    """(category_id, field_key) de validation pour un jeu.

    PUBG Mobile (et les commandes legacy sans game_id) conserve EXACTEMENT le comportement
    historique (découverte via GET /topups/validate-id).

    Pour tout autre jeu, la catégorie de validation est celle déclarée explicitement dans le
    document jeu (`fazercards_validation_category`), séparée des catégories commerciales
    (`fazercards_categories` de GET /topups). Les deux espaces d'IDs sont distincts chez
    FazerCards : une catégorie commerciale ne peut pas servir à valider un ID.

    Fail-closed (503) si aucune catégorie de validation n'est configurée pour le jeu :
    jamais de repli silencieux sur PUBG, aucune catégorie fournisseur inventée.
    """
    if not game_id or game_id == "pubg-mobile":
        return await pubg_validation_target()
    now = time.time()
    hit = _game_discovery_cache.get(game_id)
    if hit and now - hit[2] < DISCOVERY_TTL_S:
        return hit[0], hit[1]
    game = await db.games.find_one({"id": game_id}, {"_id": 0,
                                                     "fazercards_validation_category": 1})
    category_id = (game or {}).get("fazercards_validation_category")
    if not category_id:
        raise IdentityValidationHTTPException(
            status_code=503,
            detail="La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur.",
            code="unsupported_game",
        )
    data = await _request("GET", "/topups/validate-id")
    keys: list[str] = []
    for item in data.get("items", []):
        if item.get("category_id") == category_id:
            keys = [f.get("key") for f in (item.get("fields") or []) if f.get("key")]
            break
    field_key = "player_id" if "player_id" in keys else (keys[0] if keys else None)
    if not field_key:
        raise IdentityValidationHTTPException(
            status_code=503,
            detail="La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur.",
            code="unsupported_game",
        )
    _game_discovery_cache[game_id] = (category_id, field_key, now)
    return category_id, field_key


async def validate_identity(fields: dict, game_id: str | None = None) -> dict:
    """Validation générique à partir de `fields` dynamiques (ex: {player_id}, {player_id, zone_id}).
    La clé provider est découverte dynamiquement POUR LE JEU demandé ; le domaine ne suppose jamais
    player_id universel. Sans `game_id`, comportement historique (PUBG Mobile).

    FAIL-CLOSED : si le champ attendu par le fournisseur n'est pas fourni, on échoue explicitement
    au lieu de substituer une valeur d'un autre champ (jamais d'identité devinée).

    Un `422` du fournisseur sur cette route signifie « identifiant inexistant » : il devient
    `valid: false` (traduit en `invalid_id` par la route), jamais une erreur d'indisponibilité.
    """
    category_id, field_key = await validation_target(game_id)
    send = {k: v for k, v in (fields or {}).items() if v}
    if not send:
        raise IdentityValidationHTTPException(
            status_code=400,
            detail="Aucun champ d'identité fourni.",
            code="missing_field",
        )
    if field_key not in send:
        raise IdentityValidationHTTPException(
            status_code=503,
            detail=("Les champs d'identité déclarés pour ce jeu ne correspondent pas à ceux attendus "
                    "par le fournisseur : corrigez-les dans Admin -> Jeux."),
            code="unsupported_game",
        )
    data = await _request("POST", "/topups/validate-id", invalid_id_on_422=True,
                          json={"category_id": category_id, "fields": send})
    if "valid" not in data:
        raise IdentityValidationHTTPException(
            status_code=502, detail=PROVIDER_ERROR, code="provider_unavailable")
    if not data["valid"]:
        return {"valid": False}
    return {"valid": True, "player_name": data.get("player_name"), "region": data.get("region")}


async def validate_pubg_id(player_id: str) -> dict:
    """Compat legacy : délègue à la validation générique (PUBG Mobile)."""
    return await validate_identity({"player_id": player_id}, "pubg-mobile")


CATALOG_TTL_S = 600
_catalog_cache: dict = {}


def _cached(key: str):
    hit = _catalog_cache.get(key)
    return hit[1] if hit and time.time() - hit[0] < CATALOG_TTL_S else None


def _store(key: str, value):
    _catalog_cache[key] = (time.time(), value)
    return value


# Jeu → mots-clés de reconnaissance des catégories fournisseur (ids jamais hardcodés).
# PUBG Mobile inclut le mot-clé historique « pubgm » : les catégories legacy (ex. `pubgm_uc`)
# restent reconnues comme PUBG Mobile, sans élargir la reconnaissance des autres jeux.
GAME_MATCHERS: dict[str, tuple[str, ...]] = {
    "pubg-mobile": ("pubg_mobile", "pubg mobile", "pubgm"),
    "free-fire": ("free_fire", "free fire", "freefire"),
}

# Chemin de compatibilité EXPLICITE et intentionnel : PUBG Mobile et les appels historiques
# sans `game_id` (produits/commandes Phase 1) conservent le comportement d'origine. Aucun autre
# jeu n'emprunte ce chemin — un jeu inconnu échoue explicitement (fail-closed).
LEGACY_GAME_IDS: tuple[str | None, ...] = (None, "pubg-mobile")


def is_legacy_pubg(game_id: str | None) -> bool:
    """Vrai pour PUBG Mobile et les appels historiques sans `game_id` (compat Phase 1)."""
    return game_id in LEGACY_GAME_IDS


async def _topup_categories() -> list[dict]:
    """Toutes les catégories top-up du fournisseur (pagination par curseur — ids jamais hardcodés)."""
    cached = _cached("all_categories")
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
    return _store("all_categories", items)


async def game_categories(game_id: str | None) -> list[dict]:
    """Catégories fournisseur explicitement affectées par l'admin, avec compatibilité historique.

    Une configuration admin explicite (y compris une liste vide) est prioritaire pour TOUT jeu.
    Pour les jeux historiques non encore configurés, les mots-clés connus restent un fallback
    rétrocompatible. Un jeu sans configuration ni matcher échoue fermé : aucun catalogue arbitraire.
    """
    game = None
    if game_id:
        game = await db.games.find_one(
            {"id": game_id},
            {"_id": 0, "fazercards_categories_configured": 1, "fazercards_categories": 1},
        )
    all_categories = await _topup_categories()
    if game and game.get("fazercards_categories_configured") is True:
        selected = set(game.get("fazercards_categories") or [])
        return [
            {"category_id": c.get("category_id"), "name": c.get("name"), "note": c.get("note")}
            for c in all_categories if c.get("category_id") in selected
        ]

    # Compatibilité Phase 1/Phase 3: PUBG et Free Fire conservent la découverte automatique
    # tant qu'un admin n'a pas enregistré leur sélection explicite dans l'interface.
    if is_legacy_pubg(game_id):
        matchers = GAME_MATCHERS["pubg-mobile"]
    else:
        matchers = GAME_MATCHERS.get(game_id or "")
        if not matchers:
            raise HTTPException(
                status_code=409,
                detail=f"Jeu « {game_id} » non configuré : affectez ses catégories FazerCards dans Admin → Fournisseur.",
            )
    return [
        {"category_id": c.get("category_id"), "name": c.get("name"), "note": c.get("note")}
        for c in all_categories
        if any(m in (c.get("category_id") or "").lower() or m in (c.get("name") or "").lower() for m in matchers)
    ]


async def pubg_categories() -> list[dict]:
    """Compat : catégories PUBG Mobile via GET /topups (ids jamais hardcodés)."""
    cached = _cached("categories")
    if cached is not None:
        return cached
    pubg = await game_categories("pubg-mobile")
    if not pubg:
        raise HTTPException(status_code=503, detail="Aucune catégorie PUBG Mobile disponible chez le fournisseur.")
    return _store("categories", pubg)


async def catalog_for_game(game_id: str | None) -> list[dict]:
    """Catalogue live (catégories + offres) d'un jeu. Vide si le jeu n'a aucune catégorie configurée."""
    return [await pubg_offers(c["category_id"]) for c in await game_categories(game_id)]


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


# Erreurs fournisseur normalisées : voir services.providers.errors (importées en tête de fichier).
# services.fazercards.ProviderTimeout / ProviderOrderError restent valides pour compat.


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
        status = r.status_code if r.is_error else 502
        error = str(data.get("error") or "Erreur fournisseur inattendue.")[:300]
        code = data.get("code")
        if code == "insufficient_balance":
            raise ProviderInsufficientBalanceError(status, error, code)
        raise ProviderOrderError(status, error, code)
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
