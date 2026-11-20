"""Couche Provider MGS.

- Types/erreurs normalisés réexportés pour le domaine.
- `get_provider(game_id, provider_name=None)` résout le fournisseur d'UNE commande : le nom porté
  par l'unité prime, puis la surcharge `TOPUP_PROVIDER_<GAME>`, puis la table Game -> Provider.
- `IDENTITY_PROVIDER` : le vérificateur d'identité ne suit PAS la table de top-up (T16).

L'import de l'adapter est différé dans `get_provider` pour éviter tout cycle d'import
(services.fazercards importe services.providers.errors).
"""
import os
import re

from services.providers.base import (IdentityProvider, IdentityValidation, OrderStatus, Provider,
                                      ProviderOrder, ProviderWebhookEvent, TopupProvider)
from services.providers.errors import (ProviderError, ProviderInsufficientBalanceError,
                                        ProviderOrderError, ProviderTimeout, ProviderUnavailableError,
                                        ProviderUnknownError, ProviderValidationError)

# Mapping Game -> Provider (configuration, pas de logique métier dans le core).
# BASCULE (T08) : PUBG Mobile passe à Shop2Topup, le fournisseur principal du chantier. Free Fire
# reste sur FazerCards tant que T12 ne l'a pas basculé — une seule ligne à changer à ce moment-là.
GAME_PROVIDER: dict[str, str] = {"pubg-mobile": "shop2topup", "free-fire": "fazercards"}
DEFAULT_PROVIDER = "shop2topup"
# Vérificateur d'identité par défaut : FazerCards, INDÉPENDAMMENT de la table de top-up. Le
# préflight n'envoie pas l'offre qu'exige `Shop2TopupProvider.validate_identity` — suivre la table
# casserait la validation d'identité PUBG du seul fait de la bascule. Le vérificateur propre à un
# jeu reste `identity_verifier` (Neferbyte).
IDENTITY_PROVIDER = "fazercards"

_INSTANCES: dict[str, Provider] = {}


def _env_provider(game_id: str | None) -> str | None:
    """Surcharge propriétaire `TOPUP_PROVIDER_<GAME>` (ex. `TOPUP_PROVIDER_PUBG_MOBILE=g2bulk`)."""
    if not game_id:
        return None
    key = "TOPUP_PROVIDER_" + re.sub(r"[^0-9A-Za-z]+", "_", game_id).upper()
    return (os.environ.get(key) or "").strip().lower() or None


def get_provider(game_id: str | None = None, provider_name: str | None = None) -> Provider:
    name = ((provider_name or "").strip().lower()
            or _env_provider(game_id)
            or GAME_PROVIDER.get(game_id or "", DEFAULT_PROVIDER))
    provider = _INSTANCES.get(name)
    if provider is None:
        # Branches NOMMÉES : un fournisseur inconnu est une erreur de configuration, pas un
        # prétexte à servir silencieusement FazerCards (repli historique supprimé, T07).
        if name == "shop2topup":
            from services.providers.shop2topup_adapter import Shop2TopupProvider
            provider = Shop2TopupProvider()
        elif name == "fazercards":
            from services.providers.fazercards_adapter import FazerCardsProvider
            provider = FazerCardsProvider()
        else:
            raise ProviderUnavailableError(f"Fournisseur inconnu : {name}", status_code=503,
                                           code="unknown_provider")
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
    "GAME_PROVIDER", "DEFAULT_PROVIDER", "IDENTITY_PROVIDER", "get_provider",
    "IdentityVerifierError", "NeferbyteProvider", "normalize_identity_verifier",
    "resolve_identity_provider",
]
