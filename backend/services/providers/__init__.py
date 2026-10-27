"""Couche Provider MGS — résolution du fournisseur PAR JEU.

Trois points d'entrée, trois usages distincts :

- `get_provider(game_id)` : table STATIQUE historique (`GAME_PROVIDER`), synchrone, inchangée.
  Elle ne lit pas la base : elle reste utilisée par le webhook global et la route PUBG legacy.
- `provider_for_game(game_id)` : résolution RÉELLE par jeu, asynchrone, depuis la collection
  `games` (champ `provider`), avec cache 60 s. C'est le seul chemin qui peut renvoyer ALUU.
- `get_provider_by_name(name)` : instanciation par nom, synchrone (pas de base de données).

Règles :
- champ `provider` absent (ou document absent) = FazerCards : comportement actuel préservé ;
- `fazercards` et `aluu` acceptés ; toute autre valeur = erreur, jamais un repli silencieux ;
- `aluu` avec configuration incomplète (`aluu_game_code`, `aluu_check_endpoint`,
  `aluu_identity_map`) = fail-closed (503 `unsupported_game`), sans appel réseau ;
- aucun jeu n'est présumé ALUU par défaut ;
- un jeu configuré ALUU ne bascule JAMAIS sur FazerCards, même en cas d'erreur.

L'import des adapters est différé à l'appel pour éviter les cycles d'import
(`services.fazercards` importe `services.providers.errors`).
"""
import time
from collections.abc import Awaitable, Callable, Mapping

from services.providers.base import (IdentityValidation, OrderStatus, Provider, ProviderOrder,
                                      ProviderWebhookEvent)
from services.providers.errors import (ProviderError, ProviderInsufficientBalanceError,
                                        ProviderOrderError, ProviderTimeout, ProviderUnavailableError,
                                        ProviderUnknownError, ProviderValidationError)

# Mapping Game -> Provider (table statique historique, conservée pour compatibilité).
GAME_PROVIDER: dict[str, str] = {"pubg-mobile": "fazercards", "free-fire": "fazercards"}
DEFAULT_PROVIDER = "fazercards"
SUPPORTED_PROVIDERS = ("fazercards", "aluu")

# Seuls champs nécessaires à la résolution : aucun champ d'identité joueur n'est chargé.
GAME_PROJECTION = {"_id": 0, "id": 1, "provider": 1, "aluu_game_code": 1,
                   "aluu_check_endpoint": 1, "aluu_identity_map": 1}

# Durée du cache de résolution. Elle borne aussi la divergence entre processus (voir
# `invalidate_provider_cache`).
PROVIDER_CACHE_TTL_S = 60.0

# game_id -> (échéance monotone, nom du fournisseur). Une ERREUR de configuration n'est
# jamais mise en cache : une config corrigée prend effet dès l'appel suivant.
_PROVIDER_CACHE: dict[str, tuple[float, str]] = {}

# Plafond de sécurité pour la liste des jeux ALUU injectée dans l'adapter (catalogue).
_ALUU_GAMES_LIMIT = 500

_INSTANCES: dict[str, Provider] = {}


# --------------------------------------------------------------------------- instanciation

def get_provider(game_id: str | None = None) -> Provider:
    """Fournisseur de la table statique historique. `None` = FazerCards (comportement inchangé)."""
    name = GAME_PROVIDER.get(game_id or "", DEFAULT_PROVIDER)
    return get_provider_by_name(name)


def get_provider_by_name(name: str, *, games=None) -> Provider:
    """Instance du fournisseur `name` (synchrone : aucune lecture de base ici).

    `games` est réservé aux appels qui ont déjà une collection (tests, ou appelant explicite) :
    l'instance construite alors n'est PAS mise en cache globale, car elle est liée à cette
    collection.
    """
    key = (name or "").strip().lower()
    if key == "fazercards":
        cached = _INSTANCES.get(key)
        if cached is None:
            from services.providers.fazercards_adapter import FazerCardsProvider
            cached = _INSTANCES[key] = FazerCardsProvider()
        return cached
    if key == "aluu":
        from services.providers.aluu_adapter import AluuProvider
        if games is None:
            cached = _INSTANCES.get(key)
            if cached is None:
                cached = _INSTANCES[key] = AluuProvider(_default_aluu_configs())
            return cached
        return AluuProvider(_game_configs_loader(games))
    raise ProviderUnavailableError(
        f"Fournisseur non pris en charge : {key or '(vide)'}.",
        status_code=503, code="unsupported_game")


# --------------------------------------------------------------------------- chargement config

def _game_configs_loader(games) -> Callable[[], Awaitable[list[dict]]]:
    """Loader de configuration ALUU adossé à une collection `games` (lecture seule)."""

    async def load() -> list[dict]:
        cursor = games.find({"provider": "aluu"}, GAME_PROJECTION)
        return await cursor.to_list(length=_ALUU_GAMES_LIMIT)

    return load


def _default_aluu_configs() -> Callable[[], Awaitable[list[dict]]]:
    """Loader par défaut : la collection `games` de l'application.

    L'import de `core.db` est différé : il lit `MONGO_URL` à l'import, et la couche Provider
    doit rester importable sans base (tests purs, outils).
    """

    async def load() -> list[dict]:
        from core.db import db
        return await _game_configs_loader(db.games)()

    return load


# --------------------------------------------------------------------------- résolution par jeu

def _games_collection():
    from core.db import db
    return db.games


def _provider_name_for_document(doc: Mapping | None) -> str:
    """Nom du fournisseur déclaré par un document `games` (fail-closed sur ALUU incomplet)."""
    if not isinstance(doc, Mapping):
        # Jeu inconnu : aucun jeu n'est présumé ALUU, on conserve le comportement historique.
        return DEFAULT_PROVIDER

    raw = doc.get("provider")
    name = str(raw).strip().lower() if raw is not None else ""
    if not name or name == "fazercards":
        return "fazercards"
    if name != "aluu":
        raise ProviderUnavailableError(
            f"Fournisseur configuré inconnu pour ce jeu : {name}.",
            status_code=503, code="unsupported_game")

    # Réutilisation de la validation de l'adapter (source de vérité UNIQUE des champs ALUU) :
    # dupliquer cette règle ici ferait diverger la résolution et l'appel réel.
    from services.providers.aluu_adapter import _read_config
    if _read_config(doc, require_endpoint=True) is None:
        raise ProviderUnavailableError(
            "Jeu configuré ALUU mais configuration incomplète : code jeu, endpoint Name Check "
            "ou table d'identité manquant/invalide.",
            status_code=503, code="unsupported_game")
    return "aluu"


async def provider_for_game(game_id: str | None, *, games=None) -> Provider:
    """Fournisseur effectif d'un jeu, résolu depuis la collection `games` (cache 60 s).

    `game_id` vide = `get_provider(None)` (FazerCards). Document absent = FazerCards.
    Les erreurs de configuration ne sont jamais mises en cache.
    """
    gid = (game_id or "").strip()
    if not gid:
        return get_provider(None)

    cached = _cache_get(gid)
    if cached is not None:
        return _provider_instance(cached, gid, games)

    collection = games if games is not None else _games_collection()
    doc = await collection.find_one({"id": gid}, GAME_PROJECTION)
    name = _provider_name_for_document(doc)
    _cache_put(gid, name)
    return _provider_instance(name, gid, games)


def _provider_instance(name: str, game_id: str, games) -> Provider:
    """Instance du fournisseur résolu.

    Le cas FazerCards passe par `get_provider` (chemin historique, comportement et
    monkeypatch des tests existants préservés) ; ALUU est construit avec sa config.
    """
    if name == DEFAULT_PROVIDER:
        return get_provider(game_id)
    return get_provider_by_name(name, games=games)


# --------------------------------------------------------------------------- cache

def _cache_get(game_id: str) -> str | None:
    hit = _PROVIDER_CACHE.get(game_id)
    if hit is None:
        return None
    expires_at, name = hit
    if time.monotonic() >= expires_at:
        _PROVIDER_CACHE.pop(game_id, None)
        return None
    return name


def _cache_put(game_id: str, name: str) -> None:
    _PROVIDER_CACHE[game_id] = (time.monotonic() + PROVIDER_CACHE_TTL_S, name)


def invalidate_provider_cache(game_id: str | None = None) -> None:
    """Invalide la résolution en cache, pour un jeu ou pour tous (à appeler après écriture).

    PORTÉE : processus courant uniquement. Avec plusieurs workers, les autres processus
    conservent leur entrée jusqu'à l'expiration de `PROVIDER_CACHE_TTL_S` — c'est le TTL qui
    borne la divergence, pas cette fonction (pas de pub/sub inter-processus ici).

    Une configuration ALUU incomplète reste refusée même si la résolution est en cache :
    l'adapter relit la config à chaque appel et échoue en `unsupported_game` avant tout
    appel réseau.
    """
    if game_id is None:
        _PROVIDER_CACHE.clear()
        return
    _PROVIDER_CACHE.pop((game_id or "").strip(), None)


__all__ = [
    "IdentityValidation", "OrderStatus", "Provider", "ProviderOrder", "ProviderWebhookEvent",
    "ProviderError", "ProviderInsufficientBalanceError", "ProviderOrderError", "ProviderTimeout",
    "ProviderUnavailableError", "ProviderUnknownError", "ProviderValidationError",
    "GAME_PROVIDER", "DEFAULT_PROVIDER", "SUPPORTED_PROVIDERS", "PROVIDER_CACHE_TTL_S",
    "get_provider", "get_provider_by_name", "provider_for_game", "invalidate_provider_cache",
]
