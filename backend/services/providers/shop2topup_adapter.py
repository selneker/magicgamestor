"""Adapter Shop2Topup derrière l'interface Provider — T07.

Tout ce qui est propre à Shop2Topup reste ici : URL, en-tête d'authentification, enveloppe de
réponse, codes d'erreur, statuts. Le domaine ne voit que `Provider`, `ProviderOrder`,
`ProviderWebhookEvent` et les erreurs de `services.providers.errors`.

Trois règles portent ce module :

1. **La clé ne sort jamais.** `SHOP2TOPUP_API_KEY` est lue à chaque appel via `os.environ`, posée
   dans l'en-tête, et n'est ni journalisée, ni stockée, ni incluse dans un message d'erreur. Une
   clé absente n'envoie aucune requête.
2. **On lit l'enveloppe RÉELLE, pas seulement celle du document.** Le relevé du 18/11/2026
   (`RAPPORT-SHOP2TOPUP-API.md` § 3 bis) montre la charge utile sous `data` (ou `account`), alors
   que la documentation annonce `categories` / `subcategories` / `price`. `_payload()` accepte les
   deux formes : aucune des deux n'est inventée, elles sont toutes deux observées ou documentées.
3. **Aucune valeur fournisseur n'est devinée.** Les identifiants de catégorie et d'offre viennent
   des réponses ; l'identité exige l'offre (`sub_category_id`) et, sans elle, aucune requête n'est
   envoyée. Un statut inconnu reste `processing`, comme l'adaptateur FazerCards
   (`fazercards_adapter.py:40-42`).
"""
import hashlib
import hmac
import logging
import os
import uuid

import httpx

from services.providers.base import (IdentityValidation, OrderStatus, Provider, ProviderOrder,
                                     ProviderWebhookEvent)
from services.providers.errors import (ProviderInsufficientBalanceError, ProviderOrderError,
                                       ProviderTimeout, ProviderUnavailableError,
                                       ProviderValidationError)

logger = logging.getLogger("mgs.shop2topup")

BASE_URL = "https://shop2topup.com/api/endpoints/v1"
KEY_ENV = "SHOP2TOPUP_API_KEY"
TIMEOUT_S = 20.0
USER_AGENT = "MagicGameStore/1.0"

# La clé d'idempotence MGS (`fzr_fulfillment.py:123-134`) n'est pas un UUID ; l'API en exige un.
# `uuid5(espace, clé)` rend TOUJOURS le même UUID pour la même clé : un retry retombe sur la même
# commande fournisseur, donc l'idempotence existante est préservée telle quelle.
ORDER_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://magicgamestore.mg/order")

# Statuts bruts Shop2Topup -> statuts MGS (doc `/orders` : pending, completed, refunded, partial).
_STATUS_MAP = {
    "pending": OrderStatus.PROCESSING,
    "completed": OrderStatus.COMPLETED,
    "refunded": OrderStatus.REFUND,
    # `partial` = une partie livrée, le reste remboursé. Aucun statut MGS ne le représente : le
    # laisser en `processing` interdit une livraison ou un remboursement décidés à l'aveugle ;
    # l'unité reste visible et se règle à la main.
    "partial": OrderStatus.PROCESSING,
}

# Codes d'erreur (doc `/errors`). On branche sur le CODE, jamais sur le message.
BALANCE_CODES = frozenset({"INSUFFICIENT_BALANCE"})
AUTH_CODES = frozenset({"MISSING_API_KEY", "INVALID_API_KEY", "IP_NOT_ALLOWED",
                        "ACCOUNT_DISABLED", "ACCOUNT_FROZEN"})
RATE_CODES = frozenset({"RATE_LIMIT_EXCEEDED"})
PLAYER_NOT_FOUND = "PLAYER_NOT_FOUND"
REGION_MISMATCH = "REGION_MISMATCH"

# Noms sous lesquels le domaine peut fournir l'offre à valider (aucune hypothèse sur un seul nom).
_ITEM_ID_KEYS = ("offer_id", "item_id", "sub_category_id")


def configured() -> bool:
    """Vrai si la clé est présente dans l'environnement — aucune lecture de fichier."""
    return bool((os.environ.get(KEY_ENV) or "").strip())


def normalize_status(raw_status: str | None) -> str:
    """Traduit un statut Shop2Topup vers `OrderStatus`. Inconnu ⇒ `processing` (prudent)."""
    return _STATUS_MAP.get((raw_status or "").strip().lower(), OrderStatus.PROCESSING)


def provider_order_id_for(idempotency_key: str) -> str:
    """UUID déterministe d'une clé d'idempotence MGS (même clé ⇒ même commande)."""
    return str(uuid.uuid5(ORDER_NAMESPACE, str(idempotency_key)))


def _payload(body: dict, key: str):
    """Charge utile : clé documentée, sinon `data` (forme mesurée), sinon `data` entier."""
    if not isinstance(body, dict):
        return None
    if key in body and body[key] is not None:
        return body[key]
    data = body.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and key in data:
        return data[key]
    return data


def _error_payload(body: dict) -> tuple[str, str]:
    """(code, message) — `error.code` d'abord, repli sur `code`/`msg` (enveloppe mesurée § 3)."""
    error = body.get("error") if isinstance(body.get("error"), dict) else {}
    code = str(error.get("code") or body.get("code") or "").strip()
    message = str(error.get("message") or body.get("msg") or "").strip()
    return code, message


def _raise_provider_error(body: dict, status: int) -> None:
    """Traduit une erreur Shop2Topup vers les classes normalisées existantes. Ne retourne jamais."""
    code, message = _error_payload(body)
    upper = code.upper()
    message = message[:300] or f"Refus fournisseur (HTTP {status})."
    if upper in BALANCE_CODES:
        raise ProviderInsufficientBalanceError(status, message, code or None)
    if upper in AUTH_CODES:
        # Clé refusée / IP hors allowlist / compte gelé : le fournisseur est inutilisable, pas la
        # commande. Un 503 explicite vaut mieux qu'un refus de commande trompeur.
        raise ProviderUnavailableError(message, status_code=503, code=code or "unauthorized")
    if upper in RATE_CODES:
        raise ProviderUnavailableError(message, status_code=429, code=code)
    if status >= 500:
        raise ProviderUnavailableError(message, status_code=502, code=code or None)
    # Refus métier (stock, prix, paramètre, doublon…) : la commande n'est pas passée.
    raise ProviderOrderError(status, message, code or None)


def _as_number(value):
    """Identifiant numérique quand il l'est, chaîne sinon — jamais de conversion devinée."""
    text = str(value or "").strip()
    return int(text) if text.isdigit() else text


def _provider_order(order, fallback_id: str) -> ProviderOrder:
    if not isinstance(order, dict) or not order.get("order_id"):
        raise ProviderOrderError(502, "Réponse fournisseur inattendue (commande absente).",
                                 "bad_payload")
    status = str(order.get("status") or "").strip()
    return ProviderOrder(id=str(order.get("order_id") or fallback_id), status=status or "unknown",
                         normalized_status=normalize_status(status), raw=order)


def _item_id(fields: dict | None) -> str | None:
    """Offre (`sub_category_id`) lue dans les champs fournis par le domaine, jamais inventée."""
    for key in _ITEM_ID_KEYS:
        value = str((fields or {}).get(key) or "").strip()
        if value:
            return value
    return None


class Shop2TopupProvider(Provider):
    name = "shop2topup"

    def __init__(self, client: httpx.AsyncClient | None = None):
        # `client` sert aux tests (transport bouchonné) ; en production, un client par requête
        # évite de garder une connexion ouverte entre deux passages de cron.
        self._client = client

    # ------------------------------------------------------------------ #
    # Transport
    # ------------------------------------------------------------------ #
    async def _request(self, method: str, path: str, *, json=None, params=None) -> dict:
        key = (os.environ.get(KEY_ENV) or "").strip()
        if not key:
            raise ProviderUnavailableError("Service d'achat indisponible.", status_code=503,
                                           code="not_configured")
        headers = {"Authorization": f"Bearer {key}", "Accept": "application/json",
                   "User-Agent": USER_AGENT}
        url = f"{BASE_URL}{path}"
        try:
            if self._client is not None:
                response = await self._client.request(method, url, headers=headers,
                                                      json=json, params=params)
            else:
                async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                    response = await client.request(method, url, headers=headers,
                                                    json=json, params=params)
        except httpx.TimeoutException:
            # Timeout APRÈS soumission possible : l'appelant doit réessayer avec la MÊME clé.
            raise ProviderTimeout()
        except httpx.HTTPError as exc:
            logger.warning("fournisseur injoignable (%s)", type(exc).__name__)
            raise ProviderUnavailableError("Fournisseur injoignable.", status_code=502,
                                           code="network_error") from None
        try:
            body = response.json()
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        if response.is_error or body.get("success") is False:
            # Ni le corps ni les en-têtes ne sont journalisés : le solde et l'e-mail du compte y
            # figurent. Seul le code d'erreur remonte.
            _raise_provider_error(body, response.status_code)
        return body

    # ------------------------------------------------------------------ #
    # Statuts
    # ------------------------------------------------------------------ #
    def normalize_status(self, raw_status: str | None) -> str:
        return normalize_status(raw_status)

    # ------------------------------------------------------------------ #
    # Identité
    # ------------------------------------------------------------------ #
    async def validate_identity(self, game_id: str | None, fields: dict) -> IdentityValidation:
        """`POST /player/validate` : rend le pseudo en jeu, comme l'exige le préflight.

        L'API exige l'offre (`sub_category_id`) : elle est lue dans `fields` (`offer_id`,
        `item_id` ou `sub_category_id`). Sans elle, la requête n'est pas envoyée — une validation
        sans produit n'a pas de sens et ne doit jamais être simulée.
        """
        item_id = _item_id(fields)
        if item_id is None:
            raise ProviderValidationError("Offre requise pour valider l'identité joueur.",
                                          status_code=409, code="missing_offer")
        payload = {k: v for k, v in (fields or {}).items()
                   if k not in _ITEM_ID_KEYS and v not in (None, "")}
        if not str(payload.get("player_id") or "").strip():
            raise ProviderValidationError("Identifiant joueur manquant.", status_code=409,
                                          code="missing_player_id")
        payload["sub_category_id"] = _as_number(item_id)
        try:
            body = await self._request("POST", "/player/validate", json=payload)
        except ProviderOrderError as exc:
            code = str(exc.code or "").upper()
            if code == PLAYER_NOT_FOUND:
                return IdentityValidation(valid=False)  # refus explicite du jeu, aucun pseudo
            if code == REGION_MISMATCH:
                raise ProviderValidationError(
                    "Cette identité ne peut pas recevoir ce produit.", status_code=409,
                    code=exc.code) from None
            raise
        player = _payload(body, "player") or {}
        if not isinstance(player, dict):
            player = {}
        return IdentityValidation(valid=True, player_name=player.get("player_name"),
                                  region=player.get("region") or player.get("zone_id"), raw=body)

    # ------------------------------------------------------------------ #
    # Catalogue
    # ------------------------------------------------------------------ #
    async def get_categories(self) -> list[dict]:
        """Catégories du fournisseur — identifiants lus dans la réponse, jamais codés en dur."""
        body = await self._request("GET", "/catalog/categories")
        items = _payload(body, "categories")
        if not isinstance(items, list):
            raise ProviderUnavailableError("Réponse catalogue inattendue.", status_code=502,
                                           code="bad_payload")
        return [{"category_id": str(item.get("id")), "name": item.get("name"),
                 "note": item.get("description")}
                for item in items
                if isinstance(item, dict) and item.get("id") is not None]

    async def get_offers(self, category_id: str, fresh: bool = False) -> dict:
        """Offres vendables d'une catégorie + champs d'identité exigés par elle.

        `fresh` est conservé pour l'interface : ce module ne met rien en cache, donc chaque appel
        est déjà frais. Le prix rendu est celui de la liste ; le prix exact d'achat se lit juste
        avant de commander (`/catalog/subcategory/{item_id}/price`, T09).
        """
        body = await self._request("GET", "/catalog/subcategories",
                                   params={"categoryId": category_id})
        items = _payload(body, "subcategories")
        if not isinstance(items, list):
            raise ProviderUnavailableError("Réponse catalogue inattendue.", status_code=502,
                                           code="bad_payload")
        requirements = await self._request(
            "GET", f"/catalog/category/{category_id}/requirements")
        fields = _payload(requirements, "requirements")
        name = next((item.get("category_name") for item in items
                     if isinstance(item, dict) and item.get("category_name")), None)
        return {
            "category_id": str(category_id),
            "name": name,
            "offers": [{"offer_id": str(item.get("item_id")), "name": item.get("name"),
                        "price": item.get("price"), "product_type": item.get("product_type")}
                       for item in items
                       if isinstance(item, dict) and item.get("item_id") is not None],
            "fields": [{"key": field.get("field_name"), "label": field.get("placeholder"),
                        "type": field.get("data_type"),
                        **({"options": field.get("select_options")}
                           if field.get("select_options") else {})}
                       for field in (fields if isinstance(fields, list) else [])
                       if isinstance(field, dict) and field.get("field_name")],
        }

    # ------------------------------------------------------------------ #
    # Commandes
    # ------------------------------------------------------------------ #
    async def create_order(self, category_id: str, offer_id: str, fields: dict,
                           idempotency_key: str) -> ProviderOrder:
        """UNE unité = UN appel (`quantity: 1`) ; la clé MGS devient un `order_id` UUID stable."""
        if not str(idempotency_key or "").strip():
            raise ProviderOrderError(409, "Clé d'idempotence absente : commande non envoyée.",
                                     "missing_idempotency_key")
        if not str(offer_id or "").strip():
            raise ProviderOrderError(409, "Offre absente : commande non envoyée.", "missing_offer")
        order_id = provider_order_id_for(idempotency_key)
        requirements = {k: v for k, v in (fields or {}).items() if v not in (None, "")}
        payload = {"order_id": order_id, "sub_category_id": _as_number(offer_id),
                   "quantity": 1, "requirements": requirements}
        body = await self._request("POST", "/orders/create", json=payload)
        return _provider_order(_payload(body, "order"), order_id)

    async def get_order(self, provider_order_id: str) -> ProviderOrder:
        body = await self._request("GET", f"/orders/{provider_order_id}")
        return _provider_order(_payload(body, "order"), str(provider_order_id))

    # ------------------------------------------------------------------ #
    # Webhook
    # ------------------------------------------------------------------ #
    def verify_webhook_signature(self, raw_body: bytes, signature: str | None) -> bool:
        """HMAC-SHA256 du corps BRUT, format `sha256=<hex>` (`X-Shop2Topup-Signature`)."""
        secret = (os.environ.get("SHOP2TOPUP_WEBHOOK_SECRET") or "").strip()
        if not secret or not signature:
            return False
        expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(str(signature).strip(), expected)

    def parse_webhook_event(self, payload: dict) -> ProviderWebhookEvent:
        """Événement normalisé (`order.completed`, `order.refunded`, `webhook.test`).

        La livraison ne porte pas d'identifiant propre : `event_id` reste `None` et l'idempotence
        se joue sur `order_id` + `status`, tous deux fournis ici.
        """
        payload = payload if isinstance(payload, dict) else {}
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        return ProviderWebhookEvent(
            event_id=None, event=payload.get("event"),
            provider_order_id=data.get("order_id"), status=data.get("status"),
            previous_status=None, raw=payload)
