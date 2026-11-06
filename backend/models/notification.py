"""Journal des alertes admin (PL-NOTIF-1) : un document par tentative d'envoi.

`created_at` est une vraie date BSON (jamais une chaîne ISO) : l'index TTL de `core.db` ne peut
expirer que des dates. Aucune charge utile, aucun nom, e-mail ni identifiant de joueur n'est stocké :
seuls l'événement, le canal, l'état, les compteurs et une référence courte de commande le sont.
"""
from datetime import datetime, timezone
from typing import Literal

from pydantic import Field

from models.messaging import BaseDocument


def now() -> datetime:
    return datetime.now(timezone.utc)


class AlertLog(BaseDocument):
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    event: str
    channel: str = "push"
    status: Literal["pending", "sent", "failed", "skipped"] = "pending"
    reason: str | None = None
    targeted: int = 0
    sent: int = 0
    removed: int = 0
    failed: int = 0
    attempts: int = 0
    dedupe_key: str | None = None
    order_ref: str | None = None
