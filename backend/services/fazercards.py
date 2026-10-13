"""FazerCards reseller API client — Phase 1: validation ID PUBG Mobile. Phase 2: découverte catalogue/offres."""
import os
import re
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException

from core.db import db
from core.games import validation_category_of
from services.providers.errors import (ProviderInsufficientBalanceError, ProviderOrderError,
                                        ProviderTimeout)

TIMEOUT_S = 20
DISCOVERY_TTL_S = 600
PROVIDER_ERROR = "Service de vérification momentanément indisponible. Réessayez plus tard."
# Message HISTORIQUE conservé à l'identique (compat UI/tests) : il signifie désormais explicitement
# « le fournisseur ne propose pas de validation pour ce jeu », jamais « erreur technique ».
NOT_SUPPORTED_DETAIL = "La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur."
FIELDS_MISMATCH_DETAIL = ("Les champs d'identité déclarés pour ce jeu ne correspondent pas à ceux "
                          "attendus par le fournisseur : corrigez-les dans Admin -> Jeux.")

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


_game_discovery_cache: dict = {}  # game_id -> (category_id, field_key, at)

# Résultat explicite de la résolution d'une cible de validation.
VALIDATION_TARGET_SUPPORTED = "supported"
VALIDATION_TARGET_NOT_SUPPORTED = "not_supported"


@dataclass(frozen=True)
class ValidationTarget:
    """Cible de validation d'un jeu — état EXPLICITE, jamais une exception ambiguë.

    `supported=False` = « le fournisseur ne propose pas de vérification d'identité pour ce jeu »
    (absence NORMALE de prise en charge). Une erreur technique (timeout, 401/403, 5xx, réponse
    inattendue) n'est JAMAIS traduite ici : elle remonte en HTTPException depuis `_request`.
    """

    supported: bool
    category_id: str | None
    field_key: str | None
    reason: str

    @property
    def status(self) -> str:
        return VALIDATION_TARGET_SUPPORTED if self.supported else VALIDATION_TARGET_NOT_SUPPORTED


def _validation_items(data: dict) -> list[dict]:
    items = data.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    return items


def _field_key_of(item: dict) -> str | None:
    keys = [f.get("key") for f in (item.get("fields") or []) if isinstance(f, dict) and f.get("key")]
    return "player_id" if "player_id" in keys else (keys[0] if keys else None)


async def _validate_id_categories() -> list[dict]:
    """Cibles de validation du fournisseur (`GET /topups/validate-id`), cachées.

    Liste SÉPARÉE des catégories de vente (`GET /topups`) : les identifiants PEUVENT différer
    d'une liste à l'autre. Aucun identifiant n'est hardcodé ni déduit d'un slug interne.
    """
    cached = _cached("validate_id_list")
    if cached is not None:
        return cached
    return _store("validate_id_list", _validation_items(await _request("GET", "/topups/validate-id")))


async def resolve_validation_target(game_id: str | None) -> ValidationTarget:
    """Cible de validation d'un jeu, sans JAMAIS confondre catégories de vente et validation.

    Ordre de résolution :
    1. PUBG Mobile (et appels legacy sans `game_id`) : découverte historique dans la LISTE DE
       VALIDATION — comportement strictement préservé.
    2. Correspondance EXPLICITE enregistrée par l'administrateur
       (`games.fazercards_validation_category`), vérifiée dans la liste de validation.
    3. Sinon : NON PRISE EN CHARGE (`supported=False`) — aucun repli sur une autre catégorie,
       aucun identifiant fabriqué depuis le nom/le slug interne du jeu, aucune correspondance
       déduite des catégories de VENTE.
    """
    if not game_id or game_id == "pubg-mobile":
        category_id, field_key = await pubg_validation_target()
        return ValidationTarget(True, category_id, field_key, "pubg_legacy")

    now = time.time()
    hit = _game_discovery_cache.get(game_id)
    if hit and now - hit[2] < DISCOVERY_TTL_S:
        return ValidationTarget(True, hit[0], hit[1], "cache")

    game = await db.games.find_one({"id": game_id}, {"_id": 0, "fazercards_validation_category": 1})
    configured = validation_category_of(game)
    if not configured:
        return ValidationTarget(False, None, None, "no_validation_target_configured")

    for item in await _validate_id_categories():
        if item.get("category_id") != configured:
            continue
        field_key = _field_key_of(item)
        if not field_key:
            return ValidationTarget(False, None, None, "validation_target_without_field")
        _game_discovery_cache[game_id] = (configured, field_key, now)
        return ValidationTarget(True, configured, field_key, "admin_mapping")
    return ValidationTarget(False, None, None, "validation_target_not_offered")


async def validation_target(game_id: str | None) -> tuple[str, str]:
    """Compat (dépréciée) : (category_id, field_key) ou 503 si le fournisseur ne prend pas en charge
    la validation pour ce jeu. Le code applicatif doit utiliser `resolve_validation_target`, qui
    distingue explicitement « non prise en charge » d'une erreur technique.
    """
    target = await resolve_validation_target(game_id)
    if not target.supported:
        raise HTTPException(status_code=503, detail=NOT_SUPPORTED_DETAIL)
    return target.category_id, target.field_key


async def validate_identity(fields: dict, game_id: str | None = None) -> dict:
    """Validation d'identité à partir des `fields` dynamiques du jeu (jamais une hypothèse
    `player_id` universelle ; sans `game_id`, comportement historique PUBG Mobile).

    Retourne TOUJOURS un état explicite :
      {"status": "valid"}       → le fournisseur a confirmé l'identité ;
      {"status": "invalid"}     → le fournisseur a explicitement refusé l'identifiant ;
      {"status": "unsupported"} → le fournisseur ne propose PAS de validation pour ce jeu (normal).

    Une erreur technique (timeout, 401/403, 5xx, réponse inattendue, champs incohérents) lève une
    HTTPException : elle n'est JAMAIS confondue avec une validation réussie, ni avec une absence
    normale de prise en charge. FAIL-CLOSED : jamais d'identité devinée ou substituée.
    """
    target = await resolve_validation_target(game_id)
    if not target.supported:
        return {"status": "unsupported", "valid": False, "reason": target.reason,
                "message": NOT_SUPPORTED_DETAIL}
    send = {k: v for k, v in (fields or {}).items() if v}
    if not send:
        raise HTTPException(status_code=400, detail="Aucun champ d'identité fourni.")
    if target.field_key not in send:
        raise HTTPException(status_code=503, detail=FIELDS_MISMATCH_DETAIL)
    data = await _request("POST", "/topups/validate-id",
                          json={"category_id": target.category_id, "fields": send})
    if "valid" not in data:
        raise HTTPException(status_code=502, detail=PROVIDER_ERROR)
    if not data["valid"]:
        return {"status": "invalid", "valid": False}
    return {"status": "valid", "valid": True, "player_name": data.get("player_name"),
            "region": data.get("region")}


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


def clear_caches() -> None:
    """Invalide TOUS les caches fournisseur.

    Indispensable après une modification administrateur : catalogue de vente, découverte PUBG
    historique et cibles de validation doivent être relus du fournisseur (sinon une nouvelle
    association resterait invisible jusqu'à expiration du TTL).
    """
    _catalog_cache.clear()
    _discovery_cache["data"], _discovery_cache["at"] = None, 0.0
    _game_discovery_cache.clear()


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


# --------------------------------------------------------------------------- #
# Cohérence région du compte ↔ catégorie RÉGIONALE de vente.
# Contrôle appliqué uniquement quand les DEUX informations sont disponibles : la région renvoyée
# par la validation fournisseur et un suffixe régional explicite de la catégorie
# (ex. `codm_activision_ca`, `codm_activision_in`, `codm_activision_kz`). Aucune déduction du nom
# ou du slug du jeu : uniquement le suffixe de la catégorie de vente réellement utilisée.
# Désactivable par `FZR_REGION_CHECK=0` (le contrôle reste alors purement informatif).
# --------------------------------------------------------------------------- #
REGION_SUFFIXES: dict[str, str] = {
    "ca": "CA", "in": "IN", "kz": "KZ", "pk": "PK", "bd": "BD", "id": "ID", "ph": "PH",
    "my": "MY", "sg": "SG", "th": "TH", "vn": "VN", "br": "BR", "us": "US", "gb": "GB",
    "uk": "GB", "eu": "EU", "de": "DE", "fr": "FR", "it": "IT", "es": "ES", "nl": "NL",
    "pt": "PT", "pl": "PL", "ru": "RU", "tr": "TR", "eg": "EG", "sa": "SA", "ae": "AE",
    "mx": "MX", "ar": "AR", "cl": "CL", "co": "CO", "pe": "PE", "ma": "MA", "mg": "MG",
    "za": "ZA", "ng": "NG", "ke": "KE", "kr": "KR", "jp": "JP", "tw": "TW", "hk": "HK",
}
REGION_ALIASES: dict[str, str] = {
    "UNITED STATES": "US", "USA": "US", "UNITED KINGDOM": "GB", "CANADA": "CA", "INDIA": "IN",
    "KAZAKHSTAN": "KZ", "BRAZIL": "BR", "FRANCE": "FR", "GERMANY": "DE", "ITALY": "IT",
    "SPAIN": "ES", "MOROCCO": "MA", "MADAGASCAR": "MG", "EUROPE": "EU", "GLOBAL": "GLOBAL",
    "WORLDWIDE": "GLOBAL", "WORLD": "GLOBAL",
}
REGION_GROUPS: dict[str, set[str]] = {
    "EU": {"DE", "FR", "IT", "ES", "NL", "PT", "PL", "GB", "BE", "AT", "CH", "IE", "FI", "DK",
           "NO", "SE", "RO", "CZ", "GR"},
}


def normalize_region(value: str | None) -> str | None:
    """Normalise une région fournisseur (« Canada », « ca », « GLOBAL ») en code court, sinon None."""
    region = (value or "").strip().upper()
    if not region:
        return None
    if region in REGION_ALIASES:
        return REGION_ALIASES[region]
    if (len(region) == 2 and region.isalpha()) or region == "GLOBAL":
        return region
    return None


def region_of_category(category_id: str | None, name: str | None = None) -> str | None:
    """Région EXPLICITE d'une catégorie de vente, déduite d'un suffixe (`..._ca`, `..._in`).

    None quand la catégorie n'est pas régionale — cas le plus fréquent (ex. `pubgm_uc`).
    """
    for value in (category_id or "", name or ""):
        parts = [p for p in re.split(r"[^a-z0-9]+", value.lower()) if p]
        if len(parts) >= 2 and parts[-1] in REGION_SUFFIXES:
            return REGION_SUFFIXES[parts[-1]]
    return None


def regions_compatible(account_region: str, category_region: str) -> bool:
    """Deux régions connues sont compatibles si identiques, ou si l'une est le groupe de l'autre."""
    if account_region == category_region:
        return True
    for group, members in REGION_GROUPS.items():
        if (account_region == group and category_region in members) or \
                (category_region == group and account_region in members):
            return True
    return False


def region_check_enabled() -> bool:
    return os.environ.get("FZR_REGION_CHECK", "1").strip() != "0"


def region_conflict(declared_region: str | None, category_id: str | None,
                    name: str | None = None) -> tuple[str, str] | None:
    """(région du compte, région de la catégorie) si elles sont CONNUES et CONTRADICTOIRES.

    Retourne None dès qu'une des deux informations manque : on ne bloque jamais sur une
    information absente, et aucune région n'est devinée.
    """
    if not region_check_enabled():
        return None
    account = normalize_region(declared_region)
    category = region_of_category(category_id, name)
    if not account or not category or account == "GLOBAL" or category == "GLOBAL":
        return None
    return None if regions_compatible(account, category) else (account, category)


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
