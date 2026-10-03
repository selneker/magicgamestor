"""Adapter FazerCards derrière l'interface Provider.

Tous les détails spécifiques FazerCards (endpoints, noms de champs, structures de réponse,
statuts bruts, signature webhook) restent concentrés ici. Le client HTTP bas niveau demeure
`services.fazercards` (réutilisé tel quel pour ne rien casser), cet adapter ne fait que l'exposer
sous la forme normalisée attendue par le domaine MGS.
"""
import hashlib
import hmac
import os

from services import fazercards
from services.providers.base import (IdentityValidation, OrderStatus, Provider, ProviderOrder,
                                      ProviderWebhookEvent)

# Traduction statut brut FazerCards -> statut MGS normalisé.
_STATUS_MAP = {
    "created": OrderStatus.CREATED,
    "pending": OrderStatus.PROCESSING,
    "queued": OrderStatus.PROCESSING,
    "processing": OrderStatus.PROCESSING,
    "in_progress": OrderStatus.PROCESSING,
    "completed": OrderStatus.COMPLETED,
    "success": OrderStatus.COMPLETED,
    "delivered": OrderStatus.COMPLETED,
    "done": OrderStatus.COMPLETED,
    "failed": OrderStatus.FAILED,
    "error": OrderStatus.FAILED,
    "cancelled": OrderStatus.FAILED,
    "canceled": OrderStatus.FAILED,
    "rejected": OrderStatus.FAILED,
    "refund": OrderStatus.REFUND,
    "refunded": OrderStatus.REFUND,
}


class FazerCardsProvider(Provider):
    name = "fazercards"

    def normalize_status(self, raw_status: str | None) -> str:
        # Défaut prudent : un statut inconnu reste "processing" (ne déclenche ni livraison ni alerte).
        return _STATUS_MAP.get((raw_status or "").strip().lower(), OrderStatus.PROCESSING)

    async def validate_identity(self, game_id: str | None, fields: dict) -> IdentityValidation:
        data = await fazercards.validate_identity(fields)
        return IdentityValidation(valid=bool(data.get("valid")), player_name=data.get("player_name"),
                                  region=data.get("region"), raw=data)

    async def get_categories(self) -> list[dict]:
        return await fazercards.pubg_categories()

    async def get_offers(self, category_id: str, fresh: bool = False) -> dict:
        if fresh:
            return await fazercards.pubg_offers_fresh(category_id)
        return await fazercards.pubg_offers(category_id)

    async def create_order(self, category_id: str, offer_id: str, fields: dict, idempotency_key: str) -> ProviderOrder:
        order = await fazercards.create_topup_order(category_id, offer_id, fields, idempotency_key)
        raw_status = str(order.get("status") or "processing")
        return ProviderOrder(id=order["id"], status=raw_status,
                             normalized_status=self.normalize_status(raw_status), raw=order)

    async def get_order(self, provider_order_id: str) -> ProviderOrder:
        order = await fazercards.get_provider_order(provider_order_id)
        raw_status = str(order.get("status") or "processing")
        return ProviderOrder(id=order.get("id") or provider_order_id, status=raw_status,
                             normalized_status=self.normalize_status(raw_status), raw=order)

    def verify_webhook_signature(self, raw_body: bytes, signature: str | None) -> bool:
        secret = os.environ.get("FAZERCARDS_WEBHOOK_SECRET", "")
        if not secret or not signature:
            return False
        expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)

    def parse_webhook_event(self, payload: dict) -> ProviderWebhookEvent:
        data = payload.get("data") or {}
        return ProviderWebhookEvent(
            event_id=payload.get("event_id"), event=payload.get("event"),
            provider_order_id=data.get("order_id"), status=data.get("status"),
            previous_status=data.get("previous_status"), raw=payload)
