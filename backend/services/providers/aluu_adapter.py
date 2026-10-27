"""Adapter ALUU derrière l'interface `Provider` (lot 2 de la migration FazerCards → ALUU).

Tout le HTTP reste dans `services/aluu.py` : ce module ne fait que traduire vers le contrat
`Provider` consommé par le domaine MGS. Aucun autre module ne doit importer `services.aluu`.

Sources documentaires (doc ALUU, `docs/pdfspark-output.pdf`) :
- Name Check, base `/api/check` : section « Name Check » → « Overview ».
- Paramètres par endpoint : « Which endpoint for which game » (`code`, `characterId`,
  `server_code`), « Mobile Legends — GET /api/check/mlbb-check » (`user_id`, `server_id`),
  « BGMI — GET /api/check/bgmi » (`gameCode`, `id`).
- Corps de création `game`/`denom`/`userid`/`serverid`/`charname` : « Products & Orders » →
  « POST /api/v.1/create ».
- Webhook : « Webhooks & signatures » → « Top-up webhooks » ; l'exemple receveur indique
  explicitement « data.orderid is your partner_orderid ».
- Statuts `pending` / `successful` / `error` / `cancelled` : « Products & Orders » →
  « Checking status ».

Points volontairement NON tranchés ici (voir rapport de lot) :
- `get_categories` : la liste des jeux autorisés est FOURNIE (config `games` ou argument
  explicite), jamais décidée par l'adapter ;
- table d'alias `Name Check → corps /create` (`characterId` → `userid`) : déduite de la doc
  (les deux champs désignent l'ID joueur), à confirmer avant tout envoi réel.
"""
import hmac
import inspect
import logging
import re
import time
from collections.abc import Callable, Iterable, Mapping

from services import aluu
from services.providers.base import (IdentityValidation, OrderStatus, Provider, ProviderOrder,
                                     ProviderWebhookEvent)
from services.providers.errors import (ProviderError, ProviderInsufficientBalanceError,
                                       ProviderOrderError, ProviderTimeout,
                                       ProviderUnavailableError, ProviderValidationError)

logger = logging.getLogger("mgs.aluu.adapter")

# Traduction statut brut ALUU -> statut MGS normalisé (doc « Checking status »).
_STATUS_MAP = {
    "pending": OrderStatus.PROCESSING,
    "successful": OrderStatus.COMPLETED,
    "error": OrderStatus.FAILED,
    "cancelled": OrderStatus.FAILED,
    # À CONFIRMER : « failed » n'apparaît que dans l'exemple receveur webhook ; la section
    # « Checking status » ne le liste pas. Traité comme `error`/`cancelled` en attendant.
    "failed": OrderStatus.FAILED,
}

# Fenêtre anti-rejeu des webhooks (doc « Top-up webhooks » : rejeter au-delà de 5 minutes).
WEBHOOK_TOLERANCE_S = 300

# Paramètres fixes par endpoint Name Check (doc « Which endpoint for which game »).
# `code=<game_code>` pour game-check, `gameCode=bgmi` pour BGMI, rien pour MLBB
# (les deux paramètres attendus viennent du mapping d'identité).
_ENDPOINT_FIXED_PARAMS: dict[str, dict[str, str]] = {"bgmi": {"gameCode": "bgmi"}}

# Alias documenté `paramètre Name Check -> champ du corps /create`.
# Les deux espaces de noms sont distincts chez ALUU : Name Check parle `characterId` /
# `server_code`, la création parle `userid` / `serverid` / `charname`.
# À CONFIRMER avant le premier envoi réel (voir rapport du lot 2).
_ORDER_FIELD_ALIASES = {
    "characterId": "userid",
    "user_id": "userid",
    "id": "userid",
    "userid": "userid",
    "server_code": "serverid",
    "server_id": "serverid",
    "serverid": "serverid",
    "charname": "charname",
    "char_name": "charname",
}

_FIELD_LABELS = {
    "userid": "Player ID",
    "serverid": "Server / zone ID",
    "charname": "Character name",
}

_MISSING_CONFIG = "Jeu non configuré pour ALUU (configuration incomplète)."
_UNSUPPORTED_IDENTITY = "La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur."

# Liste blanche des codes d'erreur que le domaine MGS expose (routeurs admin, frontend).
# Un `code` du payload ALUU (`INVALID_PACK`, `PACK_NOT_VISIBLE`, `INSUFFICIENT_BALANCE`, …) n'y
# figure jamais : il est ramené à `None`, et le consommateur retombe alors sur
# `provider_unavailable`. La doc précise d'ailleurs « Other codes can appear » : aucune liste
# exhaustive n'existe côté fournisseur, donc on n'expose que ce que MGS sait nommer.
_MGS_ERROR_CODES = frozenset({
    "duplicate_order_mismatch", "insufficient_balance", "invalid_order", "missing_field",
    "order_not_found", "order_rejected", "pack_unavailable", "polling_stopped",
    "provider_timeout", "provider_unavailable", "rate_limited", "unsupported_game",
})

_TIMESTAMP_RE = re.compile(r"^\d+$")

GameConfigSource = Iterable[Mapping] | Mapping | Callable[[], object]


def _mask(value: str | None) -> str:
    """Masque un identifiant dans les logs (jamais de valeur complète)."""
    text = str(value or "")
    if not text:
        return "-"
    return "***" if len(text) <= 4 else f"{text[:2]}***{text[-2:]}"


def _mgs_code(code: str | None) -> str | None:
    """Code d'erreur exposable au domaine MGS, ou `None` si le code vient d'ALUU.

    Seul un code déjà nommé par MGS traverse l'adapter : un code ALUU inconnu devient `None`,
    ce qui laisse le consommateur retomber sur `provider_unavailable`.
    """
    text = str(code or "").strip()
    return text if text in _MGS_ERROR_CODES else None


def _read_config(doc: dict | None, *, require_endpoint: bool) -> dict | None:
    """Lit la configuration ALUU d'un document `games` fourni. `None` = inutilisable (fail-closed).

    Aucun repli sur un champ d'un autre nom, aucune clé devinée : `provider`, `aluu_game_code`
    et `aluu_identity_map` doivent être explicitement présents et valides.
    """
    if not isinstance(doc, Mapping):
        return None
    if str(doc.get("provider") or "").strip().lower() != "aluu":
        return None
    game_code = str(doc.get("aluu_game_code") or "").strip()
    mapping = doc.get("aluu_identity_map")
    if not game_code or not isinstance(mapping, Mapping) or not mapping:
        return None
    identity_map: dict[str, str] = {}
    for mgs_key, aluu_param in mapping.items():
        key = str(mgs_key or "").strip()
        param = str(aluu_param or "").strip()
        if not key or not param:
            return None
        identity_map[key] = param
    endpoint = str(doc.get("aluu_check_endpoint") or "").strip()
    if require_endpoint and endpoint not in aluu.CHECK_ENDPOINTS:
        return None
    return {
        "game_id": str(doc.get("id") or "").strip() or None,
        "game_code": game_code,
        "check_endpoint": endpoint or None,
        "identity_map": identity_map,
    }


def _fill(identity_map: Mapping[str, str], fields: dict | None,
          aliases: Mapping[str, str] | None = None,
          *, strict: bool = False) -> dict[str, str]:
    """Traduit les champs MGS vers les paramètres ALUU, uniquement via les clés déclarées.

    Un champ MGS absent ou vide n'est JAMAIS remplacé par un autre champ (aucune identité devinée).
    `strict=True` refuse un paramètre ALUU inconnu de la table d'alias (mapping à corriger).
    """
    out: dict[str, str] = {}
    for mgs_key, aluu_param in identity_map.items():
        value = (fields or {}).get(mgs_key)
        text = value.strip() if isinstance(value, str) else ""
        if not text:
            continue
        target = aliases.get(aluu_param) if aliases else aluu_param
        if target is None:
            if strict:
                raise ValueError(aluu_param)
            target = aluu_param
        out[target] = text
    return out


class AluuProvider(Provider):
    """Implémentation `Provider` du fournisseur ALUU.in.

    La configuration par jeu est INJECTÉE (lecture disque/base laissée à l'appelant, lot 3) :
    - `game_configs` : itérable de documents `games`, ou callable (sync/async) qui les renvoie ;
    - `authorized_codes` : liste explicite des codes ALUU autorisés au catalogue (facultatif).
    """

    name = "aluu"

    def __init__(self, game_configs: GameConfigSource | None = None,
                 authorized_codes: Iterable[str] | None = None) -> None:
        self._game_configs = game_configs
        self._authorized_codes = tuple(authorized_codes or ())

    # ------------------------------------------------------------------ configuration

    async def _load_configs(self) -> list[dict]:
        source = self._game_configs
        if source is None:
            return []
        data = source() if callable(source) else source
        if inspect.isawaitable(data):
            data = await data
        if isinstance(data, Mapping):
            data = [data]
        return [doc for doc in data or [] if isinstance(doc, Mapping)]

    async def _config_for_game(self, game_id: str, *, require_endpoint: bool) -> dict | None:
        for doc in await self._load_configs():
            if str(doc.get("id") or "").strip() != game_id:
                continue
            return _read_config(doc, require_endpoint=require_endpoint)
        return None

    async def _config_for_code(self, game_code: str) -> dict | None:
        for doc in await self._load_configs():
            if str(doc.get("aluu_game_code") or "").strip() != game_code:
                continue
            return _read_config(doc, require_endpoint=False)
        return None

    async def _authorized(self) -> set[str]:
        codes = {str(code).strip() for code in self._authorized_codes if str(code).strip()}
        if codes:
            return codes
        for doc in await self._load_configs():
            if str(doc.get("provider") or "").strip().lower() != "aluu":
                continue
            code = str(doc.get("aluu_game_code") or "").strip()
            if code and _read_config(doc, require_endpoint=False):
                codes.add(code)
        return codes

    # ------------------------------------------------------------------ statuts

    def normalize_status(self, raw_status: str | None) -> str:
        """`pending → processing`, `successful → completed`, `error`/`cancelled → failed`."""
        # Défaut prudent : un statut inconnu reste « processing » (ni livraison ni alerte).
        return _STATUS_MAP.get((raw_status or "").strip().lower(), OrderStatus.PROCESSING)

    # ------------------------------------------------------------------ identité

    async def validate_identity(self, game_id: str | None, fields: dict) -> IdentityValidation:
        """Name Check ALUU pour un jeu configuré. Fail-closed si la configuration est incomplète."""
        game = (game_id or "").strip()
        if not game:
            raise ProviderValidationError(_UNSUPPORTED_IDENTITY, status_code=503,
                                          code="unsupported_game")
        config = await self._config_for_game(game, require_endpoint=True)
        if config is None:
            raise ProviderValidationError(_UNSUPPORTED_IDENTITY, status_code=503,
                                          code="unsupported_game")

        params: dict[str, str] = {}
        missing: list[str] = []
        for mgs_key, aluu_param in config["identity_map"].items():
            value = (fields or {}).get(mgs_key)
            text = value.strip() if isinstance(value, str) else ""
            if not text:
                missing.append(mgs_key)
                continue
            if params.get(aluu_param, text) != text:
                raise ProviderValidationError(_UNSUPPORTED_IDENTITY, status_code=503,
                                              code="unsupported_game")
            params[aluu_param] = text
        if missing:
            # Tous les champs déclarés dans `aluu_identity_map` sont exigés : aucun repli sur un
            # autre champ, aucune valeur complétée d'office (identité jamais devinée).
            raise ProviderValidationError("Champ d'identité requis manquant.", status_code=400,
                                          code="missing_field")

        endpoint = config["check_endpoint"]
        for name, fixed in _ENDPOINT_FIXED_PARAMS.get(endpoint, {}).items():
            if params.get(name, fixed) != fixed:
                raise ProviderValidationError(_UNSUPPORTED_IDENTITY, status_code=503,
                                              code="unsupported_game")
            params[name] = fixed
        if endpoint == "game-check":
            if params.get("code", config["game_code"]) != config["game_code"]:
                raise ProviderValidationError(_UNSUPPORTED_IDENTITY, status_code=503,
                                              code="unsupported_game")
            params["code"] = config["game_code"]

        try:
            result = await aluu.name_check(endpoint, params)
        except aluu.AluuRateLimitedError as exc:
            raise ProviderError("Trop de requêtes vers le fournisseur. Réessayez dans un instant.",
                                status_code=429, code="rate_limited") from None
        except aluu.AluuNotConfiguredError:
            raise ProviderUnavailableError(_MISSING_CONFIG, status_code=503,
                                           code="provider_unavailable") from None
        except ProviderError:
            raise  # 502 / 503 déjà normalisés par le client

        if result.get("valid"):
            return IdentityValidation(valid=True, player_name=result.get("player_name"),
                                      region=None, raw=result)
        # `verification_failed` (400 ambigu de `game-check`) ne doit JAMAIS sortir d'ici :
        # il accuserait un joueur peut-être valide. Il devient une indisponibilité fournisseur.
        if result.get("code") == "verification_failed":
            raise ProviderUnavailableError(
                "La vérification d'identité est momentanément indisponible chez le fournisseur.",
                status_code=502, code="provider_unavailable")
        return IdentityValidation(valid=False, player_name=None, region=None, raw=result)

    # ------------------------------------------------------------------ catalogue

    async def get_categories(self) -> list[dict]:
        """Catalogue ALUU restreint aux jeux AUTORISÉS (jamais décidé par l'adapter).

        La liste vient de `authorized_codes` s'il est fourni, sinon des documents `games`
        configurés `provider = "aluu"` (proposition du lot 2, à valider). Liste vide = aucun
        jeu autorisé, donc aucun catalogue (fail-closed).
        """
        codes = await self._authorized()
        if not codes:
            logger.warning("aluu get_categories: aucun jeu autorisé configuré")
            return []
        return [
            {"category_id": game["game_code"], "name": game.get("name")}
            for game in await aluu.games()
            if game.get("game_code") in codes
        ]

    async def get_offers(self, category_id: str, fresh: bool = False) -> dict:
        """Packs ALUU d'un jeu (`category_id` = `aluu_game_code`, `offer_id` = `denom`).

        `fresh` est sans effet : le client ALUU ne met rien en cache par jeu.
        """
        code = (category_id or "").strip()
        if not code:
            raise ProviderUnavailableError("Code jeu ALUU manquant.", status_code=502,
                                           code="provider_unavailable")
        packs = await aluu.products(code)
        offers = [{
            "offer_id": pack["denom"],
            "name": pack.get("name") or pack["denom"],
            "price_usd": pack.get("price_usd"),
            "stock_status": pack.get("stock_status"),
        } for pack in packs]
        return {"category_id": code, "name": None, "note": None, "offers": offers,
                "fields": self._required_fields(packs)}

    @staticmethod
    def _required_fields(packs: list[dict]) -> list[dict]:
        """Champs du corps /create réellement exigés par les packs du jeu (doc « POST /create »)."""
        keys = ["userid"]  # toujours obligatoire
        if any(pack.get("requires_server_id") for pack in packs):
            keys.append("serverid")
        if any(pack.get("requires_char_name") for pack in packs):
            keys.append("charname")
        return [{"key": key, "label": _FIELD_LABELS[key], "type": "string"} for key in keys]

    # ------------------------------------------------------------------ commandes

    async def create_order(self, category_id: str, offer_id: str, fields: dict,
                           idempotency_key: str) -> ProviderOrder:
        """UNE commande ALUU. `idempotency_key` = `partner_orderid` (clé MGS stable)."""
        game_code = (category_id or "").strip()
        denom = (offer_id or "").strip()
        key = (idempotency_key or "").strip()
        if not (game_code and denom and key):
            raise ProviderOrderError(409, "Commande fournisseur incomplète.", "invalid_order")

        config = await self._config_for_code(game_code)
        if config is None:
            raise ProviderOrderError(409, _MISSING_CONFIG, "unsupported_game")
        try:
            body = _fill(config["identity_map"], fields, _ORDER_FIELD_ALIASES, strict=True)
        except ValueError:
            raise ProviderOrderError(
                409, "Champ d'identité non transmissible à ALUU (mapping à corriger).",
                "unsupported_game") from None
        userid = body.get("userid")
        if not userid:
            raise ProviderOrderError(409, "Identité joueur incomplète pour ALUU.", "missing_field")

        try:
            data = await aluu.create_order(
                game_code=game_code, denom=denom, user_id=userid, partner_orderid=key,
                server_id=body.get("serverid"), char_name=body.get("charname"))
        except aluu.AluuDuplicateOrderError as exc:
            return self._duplicate_order(exc.existing_order, game_code, denom, userid, key)
        except ProviderTimeout:
            raise  # le retry doit réutiliser la même clé
        except ProviderInsufficientBalanceError as exc:
            # 402 : le code du payload ALUU ne sort jamais tel quel (liste blanche seulement).
            raise ProviderInsufficientBalanceError(
                exc.status_code, exc.message, _mgs_code(exc.code)) from None
        except aluu.AluuRateLimitedError as exc:
            raise ProviderError("Trop de requêtes vers le fournisseur. Réessayez dans un instant.",
                                status_code=429, code="rate_limited") from None
        except (aluu.AluuInvalidOrderError, aluu.AluuPackUnavailableError,
                aluu.AluuOrderFailedError) as exc:
            raise ProviderOrderError(409, exc.message, _mgs_code(exc.code)) from None

        raw_status = str(data.get("status") or "pending")
        return ProviderOrder(id=key, status=raw_status,
                             normalized_status=self.normalize_status(raw_status), raw=data)

    def _duplicate_order(self, existing: dict | None, game_code: str, denom: str,
                         userid: str, key: str) -> ProviderOrder:
        """`409` : la commande existante n'est acceptée que si jeu, pack ET joueur correspondent."""
        if not isinstance(existing, Mapping) or not self._same_order(existing, game_code, denom, userid):
            logger.warning("aluu duplicate_order rejected partner_orderid=%s (contenu different)",
                           _mask(key))
            raise ProviderOrderError(
                409, "Commande fournisseur déjà existante pour cette clé avec un contenu différent.",
                "duplicate_order_mismatch")
        raw_status = str(existing.get("status") or "pending")
        logger.info("aluu duplicate_order accepted partner_orderid=%s status=%s",
                    _mask(key), raw_status)
        return ProviderOrder(id=key, status=raw_status,
                             normalized_status=self.normalize_status(raw_status), raw=dict(existing))

    @staticmethod
    def _same_order(existing: Mapping, game_code: str, denom: str, userid: str) -> bool:
        def same(field: str, expected: str) -> bool:
            return str(existing.get(field) or "").strip() == expected

        return same("game", game_code) and same("denom", denom) and same("userid", userid)

    async def get_order(self, provider_order_id: str) -> ProviderOrder:
        """Statut courant d'une commande ALUU (`partner_orderid`)."""
        order_key = (provider_order_id or "").strip()
        if not order_key:
            raise ProviderOrderError(404, "Commande fournisseur introuvable.", "order_not_found")
        try:
            data = await aluu.get_order(order_key)
        except aluu.AluuOrderNotFoundError as exc:
            raise ProviderOrderError(404, "Commande fournisseur introuvable.",
                                     _mgs_code(exc.code) or "order_not_found") from None
        except aluu.AluuPollingStoppedError:
            # 410 : ALUU demande d'arrêter d'interroger cet identifiant ; statut final conservé.
            raise ProviderError("Le fournisseur demande d'arrêter le suivi de cette commande.",
                                status_code=410, code="polling_stopped") from None
        except aluu.AluuRateLimitedError as exc:
            raise ProviderError("Trop de requêtes vers le fournisseur. Réessayez dans un instant.",
                                status_code=429, code="rate_limited") from None

        raw_status = str(data.get("status") or "pending")
        return ProviderOrder(id=order_key, status=raw_status,
                             normalized_status=self.normalize_status(raw_status), raw=data)

    # ------------------------------------------------------------------ webhook

    def verify_webhook_signature(self, raw_body: bytes, signature: str | None,
                                 timestamp: str | None = None) -> bool:
        """Signature webhook top-up ALUU + fenêtre de 5 minutes (doc « Top-up webhooks »)."""
        if not signature or not timestamp:
            return False
        stamp = str(timestamp).strip()
        if not _TIMESTAMP_RE.fullmatch(stamp):
            return False
        if abs(time.time() - int(stamp)) > WEBHOOK_TOLERANCE_S:
            return False
        try:
            expected = aluu.webhook_signature(stamp, raw_body)
        except ProviderError:  # secret absent = rejet, jamais un 500
            return False
        # Comparaison sur des OCTETS : `compare_digest` lève `TypeError` sur une `str`
        # non-ASCII, or l'en-tête de signature est une entrée non fiable. Sur octets, une
        # signature non-ASCII est simplement différente → `False`, jamais une exception.
        return hmac.compare_digest(str(signature).encode(), expected.encode())

    def parse_webhook_event(self, payload: dict) -> ProviderWebhookEvent:
        """Payload webhook top-up ALUU → événement normalisé.

        Doc « Top-up webhooks », exemple receveur : « data.orderid is your partner_orderid ».
        `provider_order_id` porte donc le `partner_orderid` (identique à `ProviderOrder.id`),
        et non le `provider_order_id` ALUU (référence interne, conservée dans `raw`).
        Un top-up webhook ne transporte ni identifiant d'événement ni nom d'événement :
        `event_id` / `event` / `previous_status` restent `None`, la déduplication se fait
        sur `(orderid, status, updatedAt)` du payload brut.
        """
        data = payload.get("data") if isinstance(payload, Mapping) else None
        data = data if isinstance(data, Mapping) else {}
        return ProviderWebhookEvent(
            event_id=None, event=None,
            provider_order_id=data.get("orderid"), status=data.get("status"),
            previous_status=None, raw=dict(payload) if isinstance(payload, Mapping) else {})


__all__ = ["AluuProvider"]
