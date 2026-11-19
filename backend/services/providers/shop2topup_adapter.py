"""Adapter Shop2Topup derrière l'interface Provider — T07 (catalogue, identité) et T08
(commande, webhook, budget de requêtes).

Tout ce qui est propre à Shop2Topup reste ici : URL, en-tête d'authentification, enveloppe de
réponse, codes d'erreur, statuts, signature de webhook. Le domaine ne voit que `Provider`,
`ProviderOrder`, `ProviderWebhookEvent` et les erreurs de `services.providers.errors`.

Quatre règles portent ce module :

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
4. **Le budget est une limite dure, jamais un `sleep`.** Les limites publiées (3 req/60 s par
   commande, 2 req/60 s par lot, 5000 pour le catalogue et la création) sont tenues par un
   compteur à fenêtre glissante : au-delà, la requête n'est pas envoyée et l'admin est alerté.
"""
import hashlib
import hmac
import logging
import os
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Sequence

import httpx

from services import notifications
from services.providers.base import (IdentityValidation, OrderStatus, Provider, ProviderOrder,
                                     ProviderWebhookEvent)
from services.providers.errors import (ProviderInsufficientBalanceError, ProviderOrderError,
                                       ProviderTimeout, ProviderUnavailableError,
                                       ProviderValidationError)

logger = logging.getLogger("mgs.shop2topup")

BASE_URL = "https://shop2topup.com/api/endpoints/v1"
KEY_ENV = "SHOP2TOPUP_API_KEY"
WEBHOOK_SECRET_ENV = "SHOP2TOPUP_WEBHOOK_SECRET"
TIMEOUT_S = 20.0
USER_AGENT = "MagicGameStore/1.0"

# Limites documentées (RAPPORT § 7), appliquées comme budget dur — jamais comme une attente.
BUDGET_WINDOW_S = 60.0
BUDGETS = {
    "catalog": 5000,       # les 5 routes catalogue, toutes réponses confondues
    "create": 5000,        # POST /orders/create
    "status_single": 3,    # GET /orders/{id}, compté par compte ET par commande
    "status_batch": 2,     # POST /orders/batch (jusqu'à 50 commandes par appel)
}
BATCH_MAX = 50

# Clé d'identifiant de commande en entrée de `POST /orders/batch`. La RÉPONSE est documentée
# (`orders[]`, `not_found[]`, RAPPORT § 4) ; le nom du champ d'entrée ne l'est pas. Il est isolé ici
# pour qu'une correction après le premier appel réel ne touche qu'une ligne — et signalé en point ouvert.
BATCH_REQUEST_KEY = "order_ids"

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
DUPLICATE_ORDER = "DUPLICATE_ORDER"


class RequestBudget:
    """Compteur à fenêtre glissante : le budget est une limite dure, jamais un `sleep`.

    `take()` dit si une requête peut partir *maintenant*. Au-delà de la limite, il rend l'attente
    restante et l'appelant refuse la requête (`_gate`) : aucune attente n'est codée en dur, aucun
    thread n'est bloqué, et le cron n'est jamais suspendu par un quota fournisseur.
    """

    def __init__(self, limit: int, window_s: float = BUDGET_WINDOW_S, *, clock=time.monotonic):
        self.limit = max(1, int(limit))
        self.window_s = float(window_s)
        self._clock = clock
        self._hits: deque[float] = deque()

    def _prune(self, now: float) -> None:
        while self._hits and now - self._hits[0] >= self.window_s:
            self._hits.popleft()

    def wait_seconds(self) -> float:
        """Attente restante avant qu'une place se libère (0 = une place est disponible)."""
        now = self._clock()
        self._prune(now)
        if len(self._hits) < self.limit:
            return 0.0
        return max(0.0, self.window_s - (now - self._hits[0]))

    def take(self) -> float:
        """Consomme une place ; rend 0 si la requête peut partir, sinon l'attente nécessaire."""
        wait = self.wait_seconds()
        if wait > 0:
            return wait
        self._hits.append(self._clock())
        return 0.0


@dataclass
class BatchStatus:
    """Résultat d'un appel `POST /orders/batch` : trouvées, inconnues, demandées."""

    orders: dict[str, ProviderOrder] = field(default_factory=dict)
    not_found: list[str] = field(default_factory=list)
    requested: int = 0


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


_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _parse_moment(raw) -> datetime | None:
    """Date ISO (ou `datetime`) en UTC ; illisible ou absente ⇒ `None` (jamais une date inventée)."""
    if isinstance(raw, datetime):
        moment = raw
    elif isinstance(raw, str) and raw.strip():
        try:
            moment = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def oldest_first(units: Sequence[dict]) -> list[dict]:
    """Unités triées de la plus ancienne à la plus récente, pour la réconciliation.

    Une date absente ou illisible passe EN PREMIER : elle ne doit jamais être affamée par des
    unités datées. Les unités sans `provider_order_id` sont écartées (rien à interroger).
    """
    def key(unit: dict):
        moment = _parse_moment(unit.get("created_at") or unit.get("updated_at"))
        return (0 if moment is None else 1, moment or _EPOCH)

    return sorted((unit for unit in units
                   if str(unit.get("provider_order_id") or "").strip()), key=key)


class Shop2TopupProvider(Provider):
    name = "shop2topup"

    def __init__(self, client: httpx.AsyncClient | None = None):
        # `client` sert aux tests (transport bouchonné) ; en production, un client par requête
        # évite de garder une connexion ouverte entre deux passages de cron.
        self._client = client
        self._budgets = {"catalog": RequestBudget(BUDGETS["catalog"]),
                         "create": RequestBudget(BUDGETS["create"]),
                         "status_batch": RequestBudget(BUDGETS["status_batch"])}
        # La limite de statut est comptée PAR COMMANDE : un budget par identifiant fournisseur.
        self._status_budgets: dict[str, RequestBudget] = {}
        self._budget_alerted: set[str] = set()

    # ------------------------------------------------------------------ #
    # Transport et budget
    # ------------------------------------------------------------------ #
    async def _alert_budget(self, route: str, wait_s: float) -> None:
        """Une alerte par épisode de saturation — jamais une par requête refusée."""
        logger.warning("budget de requêtes épuisé sur %s (attente %.0f s) : requête refusée",
                       route, wait_s)
        if route in self._budget_alerted:
            return
        self._budget_alerted.add(route)
        try:
            await notifications.notify_admin(
                event="shop2topup_budget_exceeded",
                title="Budget de requêtes fournisseur épuisé",
                body="Une requête a été refusée pour ne pas dépasser la limite du fournisseur. "
                     "Aucune commande n'a été envoyée.",
                url="/admin/catalogue")
        except Exception as exc:  # une alerte ratée ne doit pas masquer le refus
            logger.warning("alerte de budget non envoyée (%s)", type(exc).__name__)

    async def _gate(self, route: str, budget: RequestBudget) -> None:
        """Consomme une place ou refuse la requête. Ne dort jamais."""
        wait = budget.take()
        if wait <= 0:
            self._budget_alerted.discard(route)
            return
        await self._alert_budget(route, wait)
        raise ProviderUnavailableError(
            "Budget de requêtes fournisseur épuisé : requête non envoyée.",
            status_code=429, code="rate_budget_exceeded")

    async def _request(self, method: str, path: str, *, json=None, params=None,
                       budget_name: str | None = None,
                       budget: RequestBudget | None = None) -> dict:
        key = (os.environ.get(KEY_ENV) or "").strip()
        if not key:
            raise ProviderUnavailableError("Service d'achat indisponible.", status_code=503,
                                           code="not_configured")
        if budget is None and budget_name:
            budget = self._budgets.get(budget_name)
        if budget is not None:
            await self._gate(budget_name or "status", budget)
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
        body = await self._request("GET", "/catalog/categories", budget_name="catalog")
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
                                   params={"categoryId": category_id}, budget_name="catalog")
        items = _payload(body, "subcategories")
        if not isinstance(items, list):
            raise ProviderUnavailableError("Réponse catalogue inattendue.", status_code=502,
                                           code="bad_payload")
        requirements = await self._request(
            "GET", f"/catalog/category/{category_id}/requirements", budget_name="catalog")
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
    def _status_budget(self, provider_order_id: str) -> RequestBudget:
        """Budget de statut PAR COMMANDE : la limite du fournisseur est comptée par `order_id`."""
        key = str(provider_order_id or "").strip() or "-"
        budget = self._status_budgets.get(key)
        if budget is None:
            budget = RequestBudget(BUDGETS["status_single"])
            # Un dict qui grandit avec l'historique du processus : ~une entrée par commande suivie,
            # soit quelques dizaines d'octets. On ne purge pas — oublier un compteur rendrait une
            # requête supplémentaire possible, donc moins sûr que la mémoire gardée.
            self._status_budgets[key] = budget
        return budget

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
        try:
            body = await self._request("POST", "/orders/create", json=payload,
                                       budget_name="create")
        except ProviderOrderError as exc:
            if str(exc.code or "").upper() != DUPLICATE_ORDER:
                raise
            # Le fournisseur a DÉJÀ cette commande (même `order_id`, donc même clé MGS) : la relire
            # est la seule réponse honnête. Si la lecture échoue, on ne prétend ni succès ni échec —
            # une erreur d'indisponibilité laisse la ligne en attente, et le retry réutilisera la
            # même clé : aucun second achat n'est possible.
            try:
                return await self.get_order(order_id)
            except ProviderUnavailableError as read_error:
                raise ProviderUnavailableError(
                    "Commande déjà connue du fournisseur, statut momentanément illisible.",
                    status_code=502, code=read_error.code or DUPLICATE_ORDER) from None
        return _provider_order(_payload(body, "order"), order_id)

    async def get_order(self, provider_order_id: str) -> ProviderOrder:
        order_id = str(provider_order_id or "").strip()
        if not order_id:
            raise ProviderOrderError(409, "Identifiant de commande absent : aucune requête envoyée.",
                                     "missing_order_id")
        body = await self._request("GET", f"/orders/{order_id}", budget_name="status_single",
                                   budget=self._status_budget(order_id))
        return _provider_order(_payload(body, "order"), order_id)

    async def get_orders(self, provider_order_ids: Iterable[str]) -> BatchStatus:
        """Statut en LOT (≤ 50 identifiants par appel, `POST /orders/batch`).

        Le lot est préféré au statut par commande : à 3 req/60 s par commande, un arriéré de 30
        commandes demanderait 10 minutes de budget par commande ; le lot en traite 50 par requête.
        Un appel = une place du budget `status_batch`. Aucune boucle d'attente : un lot trop gros
        est découpé, pas attendu.
        """
        ids = [str(value or "").strip() for value in provider_order_ids]
        ids = [value for value in ids if value]
        result = BatchStatus(requested=len(ids))
        for start in range(0, len(ids), BATCH_MAX):
            chunk = ids[start:start + BATCH_MAX]
            body = await self._request("POST", "/orders/batch",
                                       json={BATCH_REQUEST_KEY: chunk},
                                       budget_name="status_batch")
            found = _payload(body, "orders")
            if not isinstance(found, list):
                raise ProviderUnavailableError("Réponse de statut en lot inattendue.",
                                               status_code=502, code="bad_payload")
            for order in found:
                parsed = _provider_order(order, "")
                result.orders[parsed.id] = parsed
            # `not_found` est lu dans le conteneur RÉEL de la réponse (racine ou `data`), sans
            # réutiliser `_payload` : sur une réponse sans `orders`, `_payload` retomberait sur
            # `data` entier et confondrait les deux listes.
            data = body.get("data")
            container = data if isinstance(data, dict) else body
            missing = container.get("not_found")
            if isinstance(missing, list):
                result.not_found.extend(str(value) for value in missing if value)
        return result

    async def reconcile(self, units: Sequence[dict], *, limit: int | None = None) -> dict:
        """Réconcilie les unités en attente : **les plus anciennes d'abord**, dans le budget.

        `units` = lignes du domaine portant `provider_order_id` (obligatoire) et `created_at`.
        Retour : `checked` (id → `ProviderOrder`), `not_found`, `starved` (unités non interrogées
        faute de budget) et compteurs. Les affamées ne sont jamais perdues : elles sont journalisées
        et resteront les premières au passage suivant, puisque le tri est chronologique.
        """
        ordered = oldest_first(units)
        if limit is not None:
            ordered = ordered[:max(0, int(limit))]
        report = {"requested": len(ordered), "checked": {}, "not_found": [], "starved": [],
                  "batches": 0}
        for start in range(0, len(ordered), BATCH_MAX):
            chunk = ordered[start:start + BATCH_MAX]
            ids = [str(unit.get("provider_order_id")).strip() for unit in chunk]
            if self._budgets["status_batch"].wait_seconds() > 0:
                # Budget épuisé : on s'arrête net, on ne dort pas et on ne « force » pas la limite.
                report["starved"].extend(ids)
                break
            try:
                batch = await self.get_orders(ids)
            except ProviderUnavailableError as exc:
                if exc.code != "rate_budget_exceeded":
                    raise
                report["starved"].extend(ids)
                break
            report["batches"] += 1
            report["checked"].update(batch.orders)
            if batch.not_found:
                report["not_found"].extend(batch.not_found)
                logger.info("statut en lot : %d commande(s) inconnue(s) du fournisseur",
                            len(batch.not_found))
        if report["starved"]:
            logger.warning(
                "réconciliation : %d unité(s) non interrogée(s) ce passage (budget), "
                "la plus ancienne reste prioritaire au passage suivant ; première : %s",
                len(report["starved"]), report["starved"][0])
        return report

    # ------------------------------------------------------------------ #
    # Webhook
    # ------------------------------------------------------------------ #
    def verify_webhook_signature(self, raw_body: bytes, signature: str | None) -> bool:
        """HMAC-SHA256 du corps BRUT, format `sha256=<hex>` (`X-Shop2Topup-Signature`)."""
        secret = (os.environ.get(WEBHOOK_SECRET_ENV) or "").strip()
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
