"""Couche Provider MGS.

- Types/erreurs normalisés réexportés pour le domaine.
- `get_provider(game_id)` résout le fournisseur à partir d'une table de configuration
  Game -> Provider (une future UI admin Phase 3 pourra piloter cette table).

L'import de l'adapter est différé dans `get_provider` pour éviter tout cycle d'import
(services.fazercards importe services.providers.errors).
"""
from services.providers.base import (IdentityProvider, IdentityValidation, OrderStatus, Provider,
                                      ProviderOrder, ProviderWebhookEvent, TopupProvider)
from services.providers.errors import (ProviderError, ProviderInsufficientBalanceError,
                                        ProviderOrderError, ProviderTimeout, ProviderUnavailableError,
                                        ProviderUnknownError, ProviderValidationError)

# Mapping Game -> Provider (configuration, pas de logique métier dans le core).
GAME_PROVIDER: dict[str, str] = {"pubg-mobile": "fazercards", "free-fire": "fazercards"}
DEFAULT_PROVIDER = "fazercards"

_INSTANCES: dict[str, Provider] = {}


def get_provider(game_id: str | None = None) -> Provider:
    name = GAME_PROVIDER.get(game_id or "", DEFAULT_PROVIDER)
    provider = _INSTANCES.get(name)
    if provider is None:
        if name == "fazercards":
            from services.providers.fazercards_adapter import FazerCardsProvider
            provider = FazerCardsProvider()
        else:  # pragma: no cover - aucun autre provider en Phase 2
            from services.providers.fazercards_adapter import FazerCardsProvider
            provider = FazerCardsProvider()
        _INSTANCES[name] = provider
    return provider


# Import en fin de module : `neferbyte_adapter` n'importe `services.fazercards` qu'au moment
# d'une erreur (import différé), donc aucun cycle n'est créé quel que soit l'ordre d'import.
from services.providers.neferbyte_adapter import (IdentityVerifierError,  # noqa: E402
                                                  NeferbyteProvider, normalize_identity_verifier,
                                                  resolve_identity_provider)

__all__ = [
    "IdentityProvider", "TopupProvider",
    "IdentityValidation", "OrderStatus", "Provider", "ProviderOrder", "ProviderWebhookEvent",
    "ProviderError", "ProviderInsufficientBalanceError", "ProviderOrderError", "ProviderTimeout",
    "ProviderUnavailableError", "ProviderUnknownError", "ProviderValidationError",
    "GAME_PROVIDER", "DEFAULT_PROVIDER", "get_provider",
    "IdentityVerifierError", "NeferbyteProvider", "normalize_identity_verifier",
    "resolve_identity_provider",
]
