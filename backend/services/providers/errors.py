"""Erreurs fournisseur normalisées (indépendantes de FazerCards).

Le domaine MGS ne manipule que ces types : aucun message/exception spécifique FazerCards ne doit
remonter au-delà de l'adapter. Les noms suivent les conventions déjà présentes (ProviderTimeout /
ProviderOrderError existaient dans services.fazercards et sont ici centralisés, sans changement de signature).
"""


class ProviderError(Exception):
    """Erreur fournisseur générique. `status_code` sert au mapping HTTP côté routeur."""

    def __init__(self, message: str = "Erreur fournisseur.", *, status_code: int = 502, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class ProviderUnavailableError(ProviderError):
    """Fournisseur injoignable / non configuré / indisponible (5xx, réseau)."""


class ProviderValidationError(ProviderError):
    """La validation d'identité a échoué côté fournisseur (format, refus)."""


class ProviderTimeout(ProviderError):
    """Timeout réseau APRÈS soumission d'une commande : le retry DOIT réutiliser la même Idempotency-Key."""

    def __init__(self, message: str = "timeout après soumission", *, status_code: int = 504, code: str | None = None):
        super().__init__(message, status_code=status_code, code=code)


class ProviderOrderError(ProviderError):
    """Commande fournisseur refusée. Signature historique conservée : (status_code, error, code)."""

    def __init__(self, status_code: int, error: str, code: str | None = None):
        super().__init__(error, status_code=status_code, code=code)
        self.error = error


class ProviderInsufficientBalanceError(ProviderOrderError):
    """Solde fournisseur insuffisant (sous-type d'erreur de commande)."""


class ProviderUnknownError(ProviderError):
    """Erreur fournisseur inattendue / non classifiée."""
