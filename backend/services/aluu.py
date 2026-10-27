"""Client HTTP bas niveau du fournisseur ALUU.in (migration FazerCards → ALUU).

Ce module ne contient AUCUNE logique métier MGS : il parle à l'API ALUU, normalise le
transport et les erreurs, et masque les données sensibles dans les logs. L'adaptateur
`services.providers.aluu_adapter` (Lot 2) est le seul à traduire vers le contrat `Provider`.

Références documentaires (doc ALUU, `docs/pdfspark-output.pdf`) :
- Base URL et préfixe `/api/v.1/` : « Getting started » (Base URL, exemple `GET /api/v.1/games`).
- Signature de requête : « No static IP » → « Signing a request ».
- En-têtes webhook et fenêtre 5 min : « Webhooks & signatures » → « Top-up webhooks ».
- Erreurs HTTP : « Errors & limits » → « HTTP status codes ».
- Limites : « Errors & limits » → « Rate limits (per account) ».

Règles non négociables :
- clé API et secret uniquement via l'environnement, jamais journalisés ni renvoyés ;
- aucun message brut d'ALUU ne remonte au domaine (seul un `code` stable est conservé) ;
- aucun ID joueur complet dans les logs ;
- une création de commande (`POST /api/v.1/create`) n'est JAMAIS rejouée automatiquement.
"""
import hashlib
import hmac
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

import httpx

from services.providers.errors import (ProviderError, ProviderInsufficientBalanceError,
                                       ProviderOrderError, ProviderTimeout,
                                       ProviderUnavailableError)

logger = logging.getLogger("mgs.aluu")

DEFAULT_API_BASE = "https://aluu.in"      # doc « Getting started » → Base URL
API_PREFIX = "/api/v.1"                   # doc « Getting started » → exemple GET /api/v.1/games
CHECK_PREFIX = "/api/check"               # doc « Name Check » → Base URL /api/check
DEFAULT_TIMEOUT_S = 20.0                  # GET/écriture standard ; BGMI instant = 90 s (jeu non activé)
GET_ATTEMPTS = 2                          # GET uniquement : 1 tentative + 1 reprise
BATCH_MAX_IDS = 50                        # doc « Endpoints » → Status of up to 50 orders

# Codes 403 documentés : IP non whitelistée vs quota / plan.
_IP_BLOCKED_CODES = frozenset({"IP_NOT_ALLOWED", "IP_WHITELIST_REQUIRED"})
_QUOTA_CODES = frozenset({"DAILY_LIMIT_REACHED", "FREE_DAILY_LIMIT_REACHED",
                          "NAME_CHECK_NOT_INCLUDED", "DAILY_TOPUP_LIMIT_REACHED"})

# Endpoints Name Check documentés (« Name Check » → Overview).
CHECK_ENDPOINTS = ("game-check", "mlbb-check", "bgmi")

_MESSAGE_UNAVAILABLE = "Fournisseur de top-up momentanément indisponible. Réessayez plus tard."
_MESSAGE_NOT_CONFIGURED = "Fournisseur ALUU non configuré (clé API absente)."

_URL_RE = re.compile(r"https?://[^\s\"']+")


# --------------------------------------------------------------------------- logs sans identifiants

def _aluu_host() -> str:
    """Hôte d'ALUU tel que configuré (lu à chaque record : les tests changent l'env)."""
    base = (os.environ.get("ALUU_API_BASE") or DEFAULT_API_BASE).strip()
    host = urlsplit(base if "://" in base else f"https://{base}").hostname
    return (host or "").lower()


def _mask_url(text: str) -> str:
    """Retire la query string des URL ALUU présentes dans un message de log.

    httpx journalise l'URL complète en INFO, or les Name Check passent l'identifiant joueur
    en query string. On masque donc uniquement l'hôte ALUU — les autres URL (FazerCards,
    paiements…) restent intactes.
    """
    host = _aluu_host()
    if not host:
        return text

    def _replace(match: re.Match[str]) -> str:
        url = match.group(0)
        parts = urlsplit(url)
        if (parts.hostname or "").lower() != host or not parts.query:
            return url
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))

    return _URL_RE.sub(_replace, text)


class _AluuQueryMaskFilter(logging.Filter):
    """Filtre du logger `httpx` : aucune query string ALUU (donc aucun ID joueur) dans les logs.

    Le niveau des loggers n'est PAS modifié : seules les URL concernées sont réécrites.
    L'API se protège aussi contre un changement de format de log de httpx (traite `msg` + args).
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 (API logging)
        try:
            if isinstance(record.args, tuple) and record.args:
                args = list(record.args)
                changed = False
                for index, value in enumerate(args):
                    text = str(value)
                    masked = _mask_url(text)
                    if masked != text:
                        args[index] = masked
                        changed = True
                if changed:
                    record.args = tuple(args)
                return True
            text = str(record.msg)
            masked = _mask_url(text)
            if masked != text:
                record.msg = masked
        except Exception:  # un filtre de log ne doit jamais casser une requête
            return True
        return True


logging.getLogger("httpx").addFilter(_AluuQueryMaskFilter())


# --------------------------------------------------------------------------- erreurs normalisées

class AluuNotConfiguredError(ProviderUnavailableError):
    """ALUU_API_KEY (ou secret webhook) absent : aucun appel ne peut aboutir."""


class AluuRateLimitedError(ProviderError):
    """429 : limite de débit atteinte. Aucun retry (le retry aggraverait la limite)."""

    def __init__(self, code: str | None = None):
        super().__init__("Trop de requêtes vers le fournisseur. Réessayez dans un instant.",
                         status_code=429, code=code or "rate_limited")


class AluuOrderRejectedError(ProviderOrderError):
    """Commande refusée pour une raison métier : aucun retry, aucun fallback automatique."""

    def __init__(self, message: str, *, code: str):
        super().__init__(409, message, code)


class AluuInvalidOrderError(AluuOrderRejectedError):
    """400 : champ invalide, identifiant joueur invalide ou pack inconnu."""

    def __init__(self, code: str | None = None):
        super().__init__("Commande refusée : identifiant ou pack invalide.",
                         code=code or "invalid_order")


class AluuPackUnavailableError(AluuOrderRejectedError):
    """503 : pack en rupture de stock (à confirmer pour Products & Orders, cf. `create_order`)."""

    def __init__(self, code: str | None = None):
        super().__init__("Pack indisponible chez le fournisseur.",
                         code=code or "pack_unavailable")


class AluuOrderFailedError(AluuOrderRejectedError):
    """200 + `success:false` : ALUU a refusé la commande (échec immédiat)."""

    def __init__(self, code: str | None = None):
        super().__init__("Commande refusée par le fournisseur.",
                         code=code or "order_rejected")


class AluuDuplicateOrderError(ProviderOrderError):
    """409 : `partner_orderid` déjà utilisé, la commande existante est renvoyée.

    Ce n'est PAS un succès à ce niveau : l'adaptateur (Lot 2) doit vérifier que la commande
    existante correspond bien au même jeu, au même pack et au même joueur avant de la
    considérer comme la sienne.
    """

    def __init__(self, existing_order: dict, code: str | None = None):
        super().__init__(409, "Commande fournisseur déjà existante pour cette clé.",
                         code or "duplicate_order")
        self.existing_order = existing_order


class AluuOrderNotFoundError(ProviderOrderError):
    """404 : commande inconnue du fournisseur (peut être transitoire, cf. 410)."""

    def __init__(self, code: str | None = None):
        super().__init__(404, "Commande fournisseur introuvable.",
                         code or "order_not_found")


class AluuPollingStoppedError(ProviderError):
    """410 : ALUU demande d'arrêter d'interroger cet identifiant ; statut final conservé."""

    def __init__(self) -> None:
        super().__init__("Le fournisseur demande d'arrêter le suivi de cette commande.",
                         status_code=410, code="polling_stopped")


# --------------------------------------------------------------------------- configuration

def configured() -> bool:
    """Vrai si la clé API ALUU est présente dans l'environnement."""
    return bool(os.environ.get("ALUU_API_KEY"))


def _config() -> tuple[str, dict[str, str], str | None]:
    """(base, en-têtes d'authentification, secret de signature optionnel).

    `ALUU_SECRET_KEY` n'est nécessaire qu'en mode « IP-free » (signature de chaque requête) ;
    avec une IP whitelistée, `x-api-key` suffit (doc « No static IP »).
    """
    base = (os.environ.get("ALUU_API_BASE") or DEFAULT_API_BASE).rstrip("/")
    key = os.environ.get("ALUU_API_KEY")
    if not key:
        raise AluuNotConfiguredError(_MESSAGE_NOT_CONFIGURED, status_code=503,
                                     code="provider_unavailable")
    secret = os.environ.get("ALUU_SECRET_KEY") or None
    return base, {"x-api-key": key}, secret


def _timeout_s() -> float:
    raw = os.environ.get("ALUU_TIMEOUT_S")
    try:
        value = float(raw) if raw else DEFAULT_TIMEOUT_S
    except ValueError:
        value = DEFAULT_TIMEOUT_S
    return value if value > 0 else DEFAULT_TIMEOUT_S


# --------------------------------------------------------------------------- helpers internes

def _mask(value: str | None) -> str:
    """Masque un identifiant : jamais de valeur complète dans les logs."""
    text = str(value or "")
    if not text:
        return "-"
    if len(text) <= 4:
        return "***"
    return f"{text[:2]}***{text[-2:]}"


@dataclass(frozen=True)
class _Reply:
    """Réponse HTTP décodée : statut + corps JSON (objet) ; `{}` si le corps n'est pas un objet."""

    status: int
    payload: dict


def _decode(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _unexpected(what: str) -> ProviderUnavailableError:
    return ProviderUnavailableError(f"Réponse fournisseur inattendue ({what}).",
                                    status_code=502, code="provider_unavailable")


def _path_with_query(path: str, params: dict | None) -> str:
    """Chemin signé ET envoyé, query string comprise (doc « Signing a request »)."""
    clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    return f"{path}?{urlencode(clean)}" if clean else path


def _encode_body(body: dict | None) -> str:
    """Corps sérialisé UNE seule fois : les mêmes octets sont signés puis envoyés."""
    if body is None:
        return ""
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _headers(method: str, path_with_query: str, raw_body: str,
             auth: dict[str, str], secret: str | None,
             timestamp: int | None = None) -> dict[str, str]:
    """En-têtes de la requête ; signature HMAC seulement si un secret est configuré.

    Recette documentée : hex(HMAC_SHA256(secret, timestamp + "." + METHOD + "." +
    path_with_query + "." + raw_body)) avec `X-Timestamp` / `X-Signature`.
    """
    headers = dict(auth)
    if raw_body:
        headers["Content-Type"] = "application/json"
    if not secret:
        return headers
    ts = str(int(timestamp if timestamp is not None else time.time()))
    to_sign = f"{ts}.{method.upper()}.{path_with_query}.{raw_body}"
    signature = hmac.new(secret.encode(), to_sign.encode(), hashlib.sha256).hexdigest()
    headers["X-Timestamp"] = ts
    headers["X-Signature"] = signature
    return headers


async def _send(method: str, path: str, *, params: dict | None = None,
                body: dict | None = None, write: bool = False) -> _Reply:
    """Un échange HTTP. Reprise UNIQUEMENT pour GET (timeout / 5xx), jamais pour une écriture."""
    base, auth, secret = _config()
    method = method.upper()
    target = _path_with_query(path, params)
    raw_body = _encode_body(body)
    headers = _headers(method, target, raw_body, auth, secret)
    attempts = GET_ATTEMPTS if method == "GET" else 1

    reply: _Reply | None = None
    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=_timeout_s()) as client:
                response = await client.request(
                    method, f"{base}{target}", headers=headers,
                    content=raw_body.encode() if raw_body else None,
                )
        except httpx.TimeoutException:
            logger.warning("aluu timeout method=%s path=%s attempt=%s/%s",
                           method, path, attempt, attempts)
            if attempt < attempts:
                continue
            if write:
                raise ProviderTimeout()
            raise ProviderUnavailableError("Le fournisseur a expiré.", status_code=504,
                                           code="provider_timeout") from None
        except httpx.HTTPError:
            logger.warning("aluu network_error method=%s path=%s attempt=%s/%s",
                           method, path, attempt, attempts)
            if attempt < attempts:
                continue
            message = "Fournisseur injoignable."
            if write:
                raise ProviderOrderError(502, message, "provider_unavailable") from None
            raise ProviderUnavailableError(message, status_code=502,
                                           code="provider_unavailable") from None

        reply = _Reply(response.status_code, _decode(response))
        logger.debug("aluu response method=%s path=%s status=%s attempt=%s/%s",
                     method, path, reply.status, attempt, attempts)
        if reply.status >= 500 and attempt < attempts:
            continue
        break

    if reply is None:  # défensif : la boucle lève toujours avant
        raise ProviderUnavailableError(_MESSAGE_UNAVAILABLE, status_code=502,
                                       code="provider_unavailable")
    return reply


def _raise_infra(reply: _Reply) -> None:
    """Traduit les erreurs d'infrastructure (auth, quota, débit, 5xx) en erreurs normalisées."""
    status = reply.status
    code = reply.payload.get("code")
    if status in (401, 403):
        quota = status == 403 and code in _QUOTA_CODES
        if status == 403 and code in _IP_BLOCKED_CODES:
            logger.warning("aluu ip_not_allowed code=%s", code)
        elif quota:
            logger.warning("aluu quota_reached code=%s", code)
        else:
            logger.warning("aluu access_refused status=%s code=%s", status, code or "-")
        raise ProviderUnavailableError(_MESSAGE_UNAVAILABLE, status_code=503 if quota else 502,
                                       code="provider_unavailable")
    if status == 429:
        raise AluuRateLimitedError(code)
    if status >= 500:
        if status == 504:
            raise ProviderUnavailableError("Le fournisseur a expiré.", status_code=504,
                                           code="provider_timeout")
        raise ProviderUnavailableError(_MESSAGE_UNAVAILABLE, status_code=502,
                                       code="provider_unavailable")


# --------------------------------------------------------------------------- catalogue

async def games() -> list[dict]:
    """GET /api/v.1/games — catalogue des jeux ALUU normalisé."""
    reply = await _send("GET", f"{API_PREFIX}/games")
    _raise_infra(reply)
    data = reply.payload.get("data")
    if not isinstance(data, list):
        raise _unexpected("liste de jeux")
    return [
        {"game_code": game.get("gamecode"),
         "name": game.get("Name") or game.get("name"),
         "image": game.get("image"),
         "raw": game}
        for game in data
        if isinstance(game, dict) and game.get("gamecode")
    ]


async def products(game_code: str) -> list[dict]:
    """GET /api/v.1/products/:gameCode — packs d'un jeu (`Pack` = `denom` à commander)."""
    code = (game_code or "").strip()
    if not code:
        raise ValueError("game_code requis")
    reply = await _send("GET", f"{API_PREFIX}/products/{quote(code, safe='')}")
    _raise_infra(reply)
    data = reply.payload.get("data")
    if not isinstance(data, list):
        raise _unexpected("liste de packs")
    items = []
    for pack in data:
        if not isinstance(pack, dict) or pack.get("Pack") in (None, ""):
            continue
        items.append({
            "game_code": pack.get("gamecode") or code,
            "denom": str(pack.get("Pack")),
            "name": pack.get("name"),
            "price_usd": pack.get("price"),
            "requires_user_id": bool(pack.get("requiresUserId")),
            "requires_server_id": bool(pack.get("requiresServerId")),
            "requires_char_name": bool(pack.get("requiresCharName")),
            "stock_status": pack.get("stockStatus"),
            "raw": pack,
        })
    return items


async def server_options(game_code: str) -> dict:
    """POST /api/v.1/server-options — liste de serveurs (POST dans la doc ALUU)."""
    code = (game_code or "").strip()
    if not code:
        raise ValueError("game_code requis")
    reply = await _send("POST", f"{API_PREFIX}/server-options", body={"gamecode": code})
    _raise_infra(reply)
    payload = reply.payload
    return {
        "requires_server_id": bool(payload.get("requiresServerId")),
        "server_mode": payload.get("serverMode"),
        "server_list": payload.get("server_list") or [],
        "servers": payload.get("servers") or {},
        "message": payload.get("message"),
        "raw": payload,
    }


# --------------------------------------------------------------------------- commandes

async def create_order(*, game_code: str, denom: str, user_id: str, partner_orderid: str,
                       server_id: str | None = None, char_name: str | None = None,
                       webhook_url: str | None = None) -> dict:
    """POST /api/v.1/create — UNE seule tentative, jamais rejouée automatiquement.

    `partner_orderid` est la clé d'idempotence MGS : la réutiliser à l'identique est sûr
    (409 = commande existante), la changer pour « réessayer » ne l'est pas.
    """
    body: dict[str, str] = {
        "game": game_code,
        "denom": denom,
        "userid": user_id,
        "partner_orderid": partner_orderid,
    }
    if server_id:
        body["serverid"] = server_id
    if char_name:
        body["charname"] = char_name
    if webhook_url:
        body["partner_webhook_url"] = webhook_url

    reply = await _send("POST", f"{API_PREFIX}/create", body=body, write=True)
    payload = reply.payload
    # À CONFIRMER (doc « Errors & limits ») : 402 n'est documenté que pour BGMI UC Direct,
    # et 503 « pack out of stock » y est rattaché à BGMI. Ces deux traductions sont donc
    # isolées ici, seules à changer si ALUU précise le comportement de Products & Orders.
    if reply.status == 409:
        existing = payload.get("data")
        raise AluuDuplicateOrderError(existing if isinstance(existing, dict) else payload,
                                      payload.get("code"))
    if reply.status == 402:
        raise ProviderInsufficientBalanceError(
            402, "Solde fournisseur insuffisant.", payload.get("code") or "insufficient_balance")
    if reply.status == 400:
        raise AluuInvalidOrderError(payload.get("code"))
    if reply.status == 503:
        raise AluuPackUnavailableError(payload.get("code"))
    _raise_infra(reply)
    if payload.get("success") is not True:
        raise AluuOrderFailedError(payload.get("code"))
    data = payload.get("data")
    if not isinstance(data, dict) or not (data.get("orderid") or data.get("status")):
        raise _unexpected("commande")
    logger.info("aluu order_accepted partner_orderid=%s status=%s",
                _mask(partner_orderid), data.get("status"))
    return data


async def get_order(partner_orderid: str) -> dict:
    """GET /api/v.1/:partner_orderid — état courant d'une commande."""
    order_id = (partner_orderid or "").strip()
    if not order_id:
        raise ValueError("partner_orderid requis")
    reply = await _send("GET", f"{API_PREFIX}/{quote(order_id, safe='')}")
    if reply.status == 404:
        raise AluuOrderNotFoundError(reply.payload.get("code"))
    if reply.status == 410:
        raise AluuPollingStoppedError()
    _raise_infra(reply)
    data = reply.payload.get("data")
    if not isinstance(data, dict):
        raise _unexpected("statut de commande")
    return data


async def track_order(partner_orderid: str) -> dict:
    """POST /api/v.1/:partner_orderid/track — demande un rafraîchissement du statut.

    Limité avec `get_order` à 20 requêtes/minute par compte (doc « Checking status »).
    Corps : la doc n'en documente aucun, on envoie donc un POST sans corps.
    """
    order_id = (partner_orderid or "").strip()
    if not order_id:
        raise ValueError("partner_orderid requis")
    reply = await _send("POST", f"{API_PREFIX}/{quote(order_id, safe='')}/track")
    if reply.status == 404:
        raise AluuOrderNotFoundError(reply.payload.get("code"))
    if reply.status == 410:
        raise AluuPollingStoppedError()
    _raise_infra(reply)
    data = reply.payload.get("data")
    if not isinstance(data, dict):
        raise _unexpected("statut de commande")
    return data


async def batch_status(partner_orderids: list[str]) -> dict:
    """POST /api/v.1/status/batch — statut de plusieurs commandes (50 maximum)."""
    ids = [str(order_id) for order_id in partner_orderids if order_id]
    if not ids:
        return {"results": {}, "cached_not_found": 0}
    if len(ids) > BATCH_MAX_IDS:
        raise ValueError(f"batch_status accepte au plus {BATCH_MAX_IDS} identifiants")
    reply = await _send("POST", f"{API_PREFIX}/status/batch", body={"ids": ids})
    _raise_infra(reply)
    results = reply.payload.get("results")
    if not isinstance(results, dict):
        raise _unexpected("statut groupé")
    return {"results": results,
            "cached_not_found": reply.payload.get("cached_not_found") or 0}


# --------------------------------------------------------------------------- Name Check

def _invalid_player(code: str = "invalid_id") -> dict:
    return {"valid": False, "player_name": None, "code": code}


def _player_name(payload: dict) -> str | None:
    """Nom affiché : premier champ texte utile (`username`, `name`, `nickname`)."""
    for key in ("username", "name", "nickname"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip() and value.strip().lower() != "na":
            return value
    return None


async def name_check(endpoint: str, params: dict) -> dict:
    """Name Check ALUU (`game-check` | `mlbb-check` | `bgmi`).

    Résultat normalisé `{valid, player_name, code}` ; les erreurs d'infrastructure lèvent.
    La sémantique diffère par endpoint (doc « Name Check ») :
    - `game-check` répond 200 même pour un joueur inconnu (`valid: "invalid"`) ;
    - `mlbb-check` répond 400 et `bgmi` 404 pour un joueur inconnu ;
    - certains jeux `game-check` répondent `success:true` + `username` sans `valid`.
    """
    if endpoint not in CHECK_ENDPOINTS:
        raise ValueError(f"endpoint Name Check inconnu : {endpoint}")
    clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    identity = next((clean[k] for k in ("characterId", "user_id", "id") if k in clean), None)
    logger.debug("aluu name_check endpoint=%s player=%s", endpoint, _mask(identity))

    reply = await _send("GET", f"{CHECK_PREFIX}/{endpoint}", params=clean)
    if reply.status == 400:
        if endpoint == "mlbb-check":
            # Doc « Mobile Legends » : 400 = « Player not found ».
            return _invalid_player("invalid_id")
        # À CONFIRMER : pour `game-check`, la doc ne dit pas si le 400 vient d'un champ
        # manquant ou d'un joueur inconnu (les joueurs inconnus y répondent 200). On ne
        # accuse donc PAS le joueur : échec de vérification neutre, distinct de invalid_id.
        return _invalid_player("verification_failed")
    if reply.status == 404:
        # Doc « BGMI » : 404 = joueur inconnu.
        return _invalid_player()
    _raise_infra(reply)

    payload = reply.payload
    valid_field = payload.get("valid")
    if isinstance(valid_field, str):
        valid = valid_field.strip().lower() == "valid"
    elif payload.get("success") is True:
        # Doc : « or success is true for the two games below » (ex. mcgg_ph, genshin).
        valid = _player_name(payload) is not None
    else:
        valid = False
    if not valid:
        return _invalid_player()
    return {"valid": True, "player_name": _player_name(payload), "code": None}


# --------------------------------------------------------------------------- webhook

def webhook_signature(timestamp: str, raw_body: bytes, secret: str | None = None) -> str:
    """Signature d'un webhook top-up ALUU : hex(HMAC_SHA256(secret, timestamp + "." + raw)).

    Calculée sur les octets BRUTS reçus (doc « Top-up webhooks »), jamais sur un JSON
    re-sérialisé. Le contrôle de fraîcheur (5 min) appartient à la route (Lot 5).
    """
    key = secret if secret is not None else os.environ.get("ALUU_WEBHOOK_SECRET")
    if not key:
        raise AluuNotConfiguredError("Webhook ALUU non configuré (secret absent).",
                                     status_code=503, code="provider_unavailable")
    raw = raw_body if isinstance(raw_body, bytes) else str(raw_body).encode()
    return hmac.new(key.encode(), str(timestamp).encode() + b"." + raw,
                    hashlib.sha256).hexdigest()
