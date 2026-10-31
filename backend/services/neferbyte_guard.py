"""Protection du quota Neferbyte (PL-003-BE-5).

Trois protections autour de `services.neferbyte.verify_identity` :

1. **Cache des succès** — un résultat `ok` est mémorisé `NEFERBYTE_CACHE_TTL_S` secondes
   (600 s par défaut) dans un cache **en mémoire du processus**, borné. `invalid_id`,
   `provider_unavailable`, `timeout` et `config_error` ne sont **jamais** mis en cache : un ID
   refusé ou une panne ne doit pas rester collé au joueur pour le reste du TTL. La clé est un
   HMAC-SHA256(slug + valeurs d'identité) : aucun ID en clair dans le cache, les logs ou la base.

2. **Compteur de quota** — un document par jour UTC (`_id = "AAAA-MM-JJ"`) dans la collection
   `neferbyte_quota`, incrémenté **atomiquement** avant chaque requête HTTP réellement envoyée,
   **nouvel essai compris**. Aucune donnée d'identité dans ce document : uniquement `attempts`,
   `exhausted`. Aucun index créé (seul `_id`).

3. **Plafond** — `NEFERBYTE_DAILY_LIMIT` (non défini = pas de plafond : compteur seul, avec
   avertissement). Plafond atteint **ou** réponse « daily limit » du fournisseur : plus aucun
   appel jusqu'à 00:00 UTC et résultat `provider_unavailable` — jamais `ok`, jamais `valid: true`.

Fail-closed : une erreur du **compteur** (base indisponible) bloque l'appel ; une erreur du
**cache**, au contraire, laisse passer l'appel direct (qui reste compté). Un cache ne valide
jamais : il ne restitue que des `ok` réellement obtenus.

Le comptage s'accroche à `services.neferbyte` via `set_attempt_hook` (contextvar) : le hook est
appelé juste avant chaque tentative HTTP, donc une requête ne peut pas partir sans être comptée.
"""
from __future__ import annotations

import copy
import hashlib
import hmac
import logging
import math
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db
from services import neferbyte

logger = logging.getLogger(__name__)

# Collection dédiée : un document par jour UTC. Aucun index autre que `_id`.
QUOTA_COLLECTION = "neferbyte_quota"

# Cache : 10 minutes. Assez long pour absorber les re-tentatives d'un même checkout (l'utilisateur
# corrige un champ, revient, reclique) et assez court pour qu'un changement de pseudo ou un
# bannissement côté jeu ne reste pas figé une demi-journée. Configurable, jamais figé en dur.
DEFAULT_CACHE_TTL_S = 600.0
# Borne mémoire : 2 000 entrées ≈ quelques centaines de Ko (clé de 64 caractères + un pseudo).
CACHE_MAX_ENTRIES = 2_000

CACHE_TTL_ENV = "NEFERBYTE_CACHE_TTL_S"
DAILY_LIMIT_ENV = "NEFERBYTE_DAILY_LIMIT"
CACHE_SECRET_ENV = "NEFERBYTE_CACHE_SECRET"

# Sel de repli DOCUMENTÉ, utilisé seulement si ni `NEFERBYTE_CACHE_SECRET` ni `NEFERBYTE_API_KEY`
# ne sont définis. La clé reste un HMAC (aucun ID en clair), mais elle n'est alors plus secrète :
# un avertissement est journalisé une fois. Définir `NEFERBYTE_CACHE_SECRET` en production.
FALLBACK_CACHE_SALT = b"mgs-neferbyte-cache-v1"


# --------------------------------------------------------------------------- #
# Configuration (relue à chaque appel : un changement d'environnement s'applique sans redémarrage
# dans les tests, comme `NEFERBYTE_TIMEOUT_S`)
# --------------------------------------------------------------------------- #
def cache_ttl_s() -> float:
    """Durée de vie du cache en secondes ; `0` (valeur ≤ 0) désactive le cache."""
    raw = os.environ.get(CACHE_TTL_ENV)
    if not raw:
        return DEFAULT_CACHE_TTL_S
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_CACHE_TTL_S
    return value if value > 0 else 0.0


def daily_limit() -> int | None:
    """Plafond journalier d'appels réels ; `None` = pas de plafond (compteur seul).

    Une valeur illisible ou ≤ 0 ne plafonne pas : une variable mal réglée ne doit pas couper
    silencieusement la vérification. Un avertissement est journalisé.
    """
    raw = str(os.environ.get(DAILY_LIMIT_ENV, "")).strip()
    if not raw:
        return None
    try:
        limit = int(raw)
    except ValueError:
        logger.warning("neferbyte: %s=%r illisible — aucun plafond appliqué", DAILY_LIMIT_ENV, raw[:20])
        return None
    if limit <= 0:
        logger.warning("neferbyte: %s=%s ≤ 0 — aucun plafond appliqué", DAILY_LIMIT_ENV, raw[:20])
        return None
    return limit


def _cache_secret() -> bytes:
    secret = os.environ.get(CACHE_SECRET_ENV) or os.environ.get("NEFERBYTE_API_KEY")
    if secret:
        return secret.encode("utf-8")
    _warn_missing_secret()
    return FALLBACK_CACHE_SALT


def cache_key(slug: str | None, player_id: str | None, server: str | None) -> str:
    """Empreinte HMAC-SHA256 de l'identité : ni ID, ni pseudo, ni valeur lisible."""
    payload = "\x1f".join((slug or "", player_id or "", server or "")).encode("utf-8")
    return hmac.new(_cache_secret(), payload, hashlib.sha256).hexdigest()


def _clock() -> float:
    """Horloge monotone — point de remplacement unique dans les tests."""
    return time.monotonic()


# --------------------------------------------------------------------------- #
# Cache mémoire des seuls succès
# --------------------------------------------------------------------------- #
class SuccessCache:
    """Cache FIFO borné, une entrée = (instant de stockage, `IdentityCheck` `ok`)."""

    def __init__(self, max_entries: int = CACHE_MAX_ENTRIES) -> None:
        self.max_entries = max_entries
        self._entries: OrderedDict[str, tuple[float, neferbyte.IdentityCheck]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> neferbyte.IdentityCheck | None:
        ttl = cache_ttl_s()
        if ttl <= 0 or not key:
            return None
        now = _clock()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            stored_at, check = entry
            if now - stored_at > ttl:
                self._entries.pop(key, None)
                return None
            # Copie à la lecture : un appelant qui modifierait le résultat (pseudo, `raw`…)
            # ne changerait pas la réponse suivante servie depuis le cache.
            return copy.deepcopy(check)

    def put(self, key: str, check: neferbyte.IdentityCheck) -> None:
        if cache_ttl_s() <= 0 or not key:
            return
        # Copie à l'écriture : le cache ne partage aucun objet modifiable avec l'appelant.
        stored = copy.deepcopy(check)
        with self._lock:
            self._entries[key] = (_clock(), stored)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


_cache = SuccessCache()
# État du jour en mémoire : évite une lecture Mongo à chaque appel et permet de refuser AVANT
# le cache dès que le plafond est connu atteint (le document du jour reste la source de vérité
# partagée entre processus).
_blocked_day: str | None = None
_warned_no_limit = False
_warned_missing_secret = False


def _warn_missing_secret() -> None:
    global _warned_missing_secret
    if _warned_missing_secret:
        return
    _warned_missing_secret = True
    logger.warning("neferbyte: %s non défini — clé de cache dérivée d'un sel public", CACHE_SECRET_ENV)


def reset_state() -> None:
    """Remet le garde à zéro (tests, ou après un changement de jour forcé)."""
    global _blocked_day, _warned_no_limit, _warned_missing_secret
    _blocked_day = None
    _warned_no_limit = False
    _warned_missing_secret = False
    try:
        _cache.clear()
    except Exception:  # pragma: no cover - un cache cassé ne doit pas empêcher la remise à zéro
        logger.warning("neferbyte: cache non vidable")


def _cached(key: str) -> neferbyte.IdentityCheck | None:
    try:
        return _cache.get(key)
    except Exception:  # pragma: no cover - un cache ne doit jamais faire échouer une validation
        logger.warning("neferbyte: cache illisible — appel direct")
        return None


def _remember(key: str, check: neferbyte.IdentityCheck) -> None:
    try:
        _cache.put(key, check)
    except Exception:  # pragma: no cover - idem : le résultat reste valable, juste non mémorisé
        logger.warning("neferbyte: cache non inscriptible — résultat non mémorisé")


# --------------------------------------------------------------------------- #
# Compteur de quota journalier
# --------------------------------------------------------------------------- #
def _today() -> str:
    """Jour UTC (`AAAA-MM-JJ`) : le quota Neferbyte est remis à zéro à 00:00 UTC."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _quota():
    return db[QUOTA_COLLECTION]


def _blocked() -> bool:
    return _blocked_day is not None and _blocked_day == _today()


def _block_today() -> None:
    global _blocked_day
    _blocked_day = _today()


def _warn_usage(attempts: int, limit: int | None) -> None:
    global _warned_no_limit
    if limit is None:
        if not _warned_no_limit:
            _warned_no_limit = True
            logger.warning("neferbyte: %s non défini — compteur seul, aucun plafond", DAILY_LIMIT_ENV)
        return
    threshold = max(1, math.ceil(limit * 0.8))
    if attempts == threshold:
        logger.warning("neferbyte: %s/%s appels Neferbyte aujourd'hui (80 %% du plafond)",
                       attempts, limit)


async def _increment(query: dict, upsert: bool) -> dict | None:
    """Un seul `$inc` conditionnel : atomique, aucun identifiant dans le document."""
    return await _quota().find_one_and_update(
        query, {"$inc": {"attempts": 1}}, upsert=upsert, return_document=ReturnDocument.AFTER)


async def _reserve_attempt() -> bool:
    """Compte UNE tentative HTTP auprès de Neferbyte.

    Returns:
        `True` si la requête peut partir (elle est comptée), `False` si elle doit être bloquée
        (plafond atteint, jour épuisé, ou compteur indisponible — fail-closed).
    """
    if _blocked():
        return False
    limit = daily_limit()
    query: dict = {"_id": _today(), "exhausted": {"$ne": True}}
    if limit is not None:
        # `$lt` rend le plafond atomique : deux processus simultanés ne peuvent pas le dépasser.
        query["attempts"] = {"$lt": limit}

    try:
        doc = await _increment(query, upsert=True)
    except DuplicateKeyError:
        # Course sur l'insertion du document du jour : il existe désormais, on retente sans upsert
        # pour obtenir une réponse définitive (comptée ou refusée) au lieu de bloquer la journée.
        doc = None
    except Exception:
        logger.warning("neferbyte: compteur de quota indisponible — appel bloqué (fail-closed)")
        return False
    if doc is None:
        try:
            doc = await _increment(query, upsert=False)
        except Exception:
            logger.warning("neferbyte: compteur de quota indisponible — appel bloqué (fail-closed)")
            return False
    if doc is None:
        # Document du jour présent mais filtre non satisfait : plafond atteint ou jour épuisé.
        _block_today()
        logger.warning("neferbyte: plafond journalier atteint (%s) — aucun appel de plus aujourd'hui",
                       limit)
        return False

    attempts = int((doc or {}).get("attempts") or 0)
    _warn_usage(attempts, limit)
    if limit is not None and attempts >= limit:
        # Dernier appel autorisé : les suivants sont refusés AVANT le cache, donc jamais un `ok`.
        _block_today()
    return True


async def _mark_exhausted() -> None:
    """Le fournisseur a annoncé « daily limit » : le jour est clos jusqu'à 00:00 UTC."""
    limit = daily_limit()
    update: dict = {"$set": {"exhausted": True}}
    if limit is not None:
        update["$max"] = {"attempts": limit}
    try:
        await _quota().update_one({"_id": _today()}, update, upsert=True)
    except Exception:
        logger.warning("neferbyte: impossible de marquer le quota du jour épuisé en base")
    _block_today()
    logger.warning("neferbyte: quota journalier épuisé chez le fournisseur — aucun appel avant 00:00 UTC")


async def quota_snapshot() -> dict:
    """État du jour (diagnostic/tests) : aucune identité, uniquement des compteurs."""
    date = _today()
    doc = None
    try:
        doc = await _quota().find_one({"_id": date}, {"attempts": 1, "exhausted": 1})
    except Exception:
        logger.warning("neferbyte: compteur de quota illisible")
    doc = doc or {}
    return {"date": date, "attempts": int(doc.get("attempts") or 0),
            "exhausted": bool(doc.get("exhausted")), "limit": daily_limit(),
            "blocked": _blocked()}


# --------------------------------------------------------------------------- #
# Point d'entrée utilisé par `NeferbyteProvider`
# --------------------------------------------------------------------------- #
async def verify_identity(slug: str, player_id: str | None, server: str | None = None
                          ) -> neferbyte.IdentityCheck:
    """`services.neferbyte.verify_identity` protégé par le cache, le compteur et le plafond."""
    # Sans clé API, `verify_identity` répond `not_configured` sans appel : aucune raison de créer
    # un document de quota ni de consulter le cache.
    if not neferbyte.configured():
        return await neferbyte.verify_identity(slug, player_id, server)

    if _blocked():
        # Plafond atteint aujourd'hui : refus AVANT le cache (jamais un `ok` à quota épuisé).
        return neferbyte.IdentityCheck(status=neferbyte.PROVIDER_UNAVAILABLE, reason="quota_guard")

    key = cache_key(slug, player_id, server)
    cached = _cached(key)
    if cached is not None:
        return cached

    token = neferbyte.set_attempt_hook(_reserve_attempt)
    try:
        check = await neferbyte.verify_identity(slug, player_id, server)
    finally:
        neferbyte.reset_attempt_hook(token)

    if check.status == neferbyte.OK:
        _remember(key, check)
    elif check.status == neferbyte.PROVIDER_UNAVAILABLE and check.reason == "quota":
        # Quota JOURNALIER annoncé par le fournisseur (« daily limit ») : le jour est clos. Un 429
        # de débit momentané arrive ici avec `reason="rate_limited"` et ne ferme rien.
        await _mark_exhausted()
    return check


__all__ = [
    "CACHE_MAX_ENTRIES", "CACHE_SECRET_ENV", "CACHE_TTL_ENV", "DAILY_LIMIT_ENV",
    "DEFAULT_CACHE_TTL_S", "QUOTA_COLLECTION", "SuccessCache", "cache_key", "cache_ttl_s",
    "daily_limit", "quota_snapshot", "reset_state", "verify_identity",
]
