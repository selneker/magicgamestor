"""Frontière Provider — interface et types normalisés consommés par le cœur MGS.

Le domaine (Order / Product / GameIdentity) ne connaît que cette interface et ces résultats.
Un nouveau fournisseur = une nouvelle implémentation de `Provider`, sans toucher au domaine.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class OrderStatus:
    """Ensemble de statuts MGS normalisés (cible de la traduction depuis le fournisseur)."""

    CREATED = "created"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUND = "refund"
    ALL = (CREATED, PROCESSING, COMPLETED, FAILED, REFUND)


@dataclass
class IdentityValidation:
    """Résultat générique d'une validation d'identité (champs optionnels selon le jeu)."""

    valid: bool
    player_name: str | None = None
    region: str | None = None
    raw: dict = field(default_factory=dict)


@dataclass
class ProviderOrder:
    """Commande fournisseur normalisée. `status` = statut brut fournisseur ; `normalized_status` ∈ OrderStatus."""

    id: str
    status: str
    normalized_status: str
    raw: dict = field(default_factory=dict)


@dataclass
class ProviderWebhookEvent:
    """Événement webhook fournisseur normalisé (après vérification de signature)."""

    event_id: str | None
    event: str | None
    provider_order_id: str | None
    status: str | None = None
    previous_status: str | None = None
    raw: dict = field(default_factory=dict)


class Provider(ABC):
    """Capacités réellement nécessaires à MGS. Les noms restent proches du vocabulaire existant."""

    name: str = "provider"

    # ---------- identité ----------
    @abstractmethod
    async def validate_identity(self, game_id: str | None, fields: dict) -> IdentityValidation:
        """Valide une identité à partir de ses `fields` dynamiques (jamais une hypothèse player_id rigide)."""

    # ---------- catalogue ----------
    @abstractmethod
    async def get_categories(self) -> list[dict]:
        """Catégories/offres disponibles chez le fournisseur (ids jamais hardcodés)."""

    @abstractmethod
    async def get_offers(self, category_id: str, fresh: bool = False) -> dict:
        """Offres + champs requis pour une catégorie. `fresh=True` contourne le cache (revalidation pré-commande)."""

    # ---------- commande ----------
    @abstractmethod
    async def create_order(self, category_id: str, offer_id: str, fields: dict, idempotency_key: str) -> ProviderOrder:
        """Crée UNE commande fournisseur. Le retry réutilise la même `idempotency_key` (aucun double achat)."""

    @abstractmethod
    async def get_order(self, provider_order_id: str) -> ProviderOrder:
        """Lecture/statut d'une commande fournisseur."""

    # ---------- statut ----------
    @abstractmethod
    def normalize_status(self, raw_status: str | None) -> str:
        """Traduit un statut brut fournisseur vers l'ensemble OrderStatus."""

    # ---------- webhook ----------
    @abstractmethod
    def verify_webhook_signature(self, raw_body: bytes, signature: str | None) -> bool:
        """Vérifie la signature sur le RAW BODY (avant tout parsing)."""

    @abstractmethod
    def parse_webhook_event(self, payload: dict) -> ProviderWebhookEvent:
        """Traduit le payload fournisseur en événement normalisé."""
