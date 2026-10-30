"""Adapter Neferbyte derrière l'interface `IdentityProvider` + résolution par jeu.

Neferbyte ne fait QUE la vérification d'identité : cet adapter n'implémente que
`IdentityProvider` (aucune méthode de commande — par construction il ne peut pas créer de
commande fournisseur). Le top-up reste FazerCards, résolu par `get_provider()`, inchangé.

Le choix du vérificateur est une DONNÉE du document jeu (`identity_verifier`) :

    {"provider": "neferbyte", "slug": "mobile-legends",
     "id_field": "player_id", "server_field": "zone_id"}

- champ absent ou `None`           -> FazerCards (comportement historique, aucun jeu ne change) ;
- `{"provider": "fazercards"}`     -> FazerCards (retour arrière explicite) ;
- `{"provider": "neferbyte", ...}` -> Neferbyte, si la configuration est cohérente ;
- toute autre valeur, ou une configuration incohérente -> 503 `unsupported_game`, SANS appel.

Le retour arrière par jeu = suppression (ou remplacement) du champ dans le document jeu :
aucune migration, aucun changement de frontend, aucun redéploiement de configuration.

La signalisation d'indisponibilité est EXACTEMENT celle de FazerCards
(`IdentityValidationHTTPException` : `status_code` + `detail` + `code`), pour que le routeur
de validation (BE-4) n'ait qu'un seul mapping à connaître.
"""
from __future__ import annotations

import logging

from services import neferbyte
from services.providers.base import IdentityProvider, IdentityValidation

logger = logging.getLogger(__name__)

NEFERBYTE = "neferbyte"
FAZERCARDS = "fazercards"

# Même message que le client FazerCards (contrat client inchangé, aucune fuite de détail interne).
PROVIDER_ERROR = "Service de vérification momentanément indisponible. Réessayez plus tard."
# Message public d'une configuration inutilisable : le motif précis reste dans les logs admin.
UNSUPPORTED_GAME_DETAIL = "La vérification d'identité n'est pas correctement configurée pour ce jeu."
# Message public d'un dépassement de délai (identique à FazerCards).
TIMEOUT_DETAIL = "La vérification a expiré. Réessayez."


class IdentityVerifierError(ValueError):
    """`identity_verifier` inutilisable. Le message est sûr (jamais d'ID joueur ni de secret)."""


def _http_error(status_code: int, detail: str, code: str):
    """Construit la MÊME exception que FazerCards, sans importer son client au chargement.

    L'import est différé : `services.fazercards` importe `core.db` et `services.providers.errors`,
    et un import de module ici créerait un cycle selon l'ordre d'import de l'application.
    """
    from services.fazercards import IdentityValidationHTTPException

    return IdentityValidationHTTPException(status_code=status_code, detail=detail, code=code)


# --------------------------------------------------------------------------- #
# Validation de la configuration (partagée écriture admin / résolution)
# --------------------------------------------------------------------------- #
def _identity_keys(identity_fields: list[dict] | None) -> list[str]:
    return [str(f.get("key")) for f in (identity_fields or []) if isinstance(f, dict) and f.get("key")]


def normalize_identity_verifier(raw, game_id: str | None, identity_fields: list[dict] | None) -> dict | None:
    """Valide et normalise `identity_verifier` ; lève `IdentityVerifierError` si incohérent.

    Args:
        raw: valeur brute du champ dans le document jeu (ou dans la requête admin).
        game_id: identifiant du jeu, pour appliquer le défaut d'identité du jeu legacy.
        identity_fields: champs d'identité déclarés/enregistrés pour ce jeu.

    Returns:
        `None` (FazerCards), `{"provider": "fazercards"}` (retour arrière explicite) ou la
        configuration Neferbyte normalisée `{"provider", "slug", "id_field", "server_field"}`.

    Raises:
        IdentityVerifierError: configuration inutilisable — l'appelant décide du code HTTP
            (400 à l'écriture admin, 503 `unsupported_game` à la résolution).
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise IdentityVerifierError("`identity_verifier` doit être un objet JSON.")

    provider = raw.get("provider")
    provider = provider.strip().lower() if isinstance(provider, str) else ""
    if not provider:
        raise IdentityVerifierError(
            "`identity_verifier.provider` est requis (« neferbyte » ou « fazercards »).")
    if provider == FAZERCARDS:
        # Retour arrière explicite : aucun autre champ n'est conservé.
        return {"provider": FAZERCARDS}
    if provider != NEFERBYTE:
        raise IdentityVerifierError(
            f"Fournisseur d'identité inconnu : « {provider[:32]} » "
            "(attendu : « neferbyte » ou « fazercards »).")

    slug = raw.get("slug")
    slug = slug.strip() if isinstance(slug, str) else ""
    if not slug:
        raise IdentityVerifierError("`identity_verifier.slug` est requis pour Neferbyte.")
    spec = neferbyte.GAMES.get(slug)
    if spec is None:
        raise IdentityVerifierError(
            f"slug Neferbyte inconnu : « {slug[:40]} » (casse exacte du catalogue requise).")

    id_field = raw.get("id_field")
    id_field = id_field.strip() if isinstance(id_field, str) else ""
    if not id_field:
        raise IdentityVerifierError("`identity_verifier.id_field` est requis pour Neferbyte.")
    keys = _identity_keys(identity_fields)
    if not keys:
        # Jeu legacy sans déclaration explicite : appliquer son contrat par défaut (PUBG Mobile)
        # plutôt que de refuser une configuration valide.
        from core.games import identity_spec

        keys = _identity_keys(identity_spec({"id": game_id, "identity_fields": identity_fields}))
    if not keys:
        raise IdentityVerifierError(
            "Ce jeu n'a aucun champ d'identité déclaré (Admin -> Jeux) : `id_field` ne peut pas "
            "désigner un champ existant.")
    if id_field not in keys:
        raise IdentityVerifierError(
            f"`id_field` « {id_field[:32]} » n'est pas un champ d'identité de ce jeu "
            f"(champs déclarés : {', '.join(keys)}).")

    server_field = raw.get("server_field")
    server_field = server_field.strip() if isinstance(server_field, str) else ""
    if spec.needs_server:
        if not server_field:
            raise IdentityVerifierError(
                f"L'endpoint Neferbyte « {slug} » exige ID + {spec.server_label} : "
                "`server_field` est requis.")
        if server_field not in keys:
            raise IdentityVerifierError(
                f"`server_field` « {server_field[:32]} » n'est pas un champ d'identité de ce jeu "
                f"(champs déclarés : {', '.join(keys)}).")
        if server_field == id_field:
            raise IdentityVerifierError(
                "`server_field` doit désigner un champ différent de `id_field`.")
    elif server_field:
        raise IdentityVerifierError(
            f"L'endpoint Neferbyte « {slug} » ne prend pas de second segment : "
            "`server_field` doit être absent.")

    return {"provider": NEFERBYTE, "slug": slug, "id_field": id_field,
            "server_field": server_field or None}


# --------------------------------------------------------------------------- #
# Fournisseur d'identité Neferbyte
# --------------------------------------------------------------------------- #
class NeferbyteProvider(IdentityProvider):
    """Vérification d'identité par Neferbyte — `IdentityProvider` uniquement.

    Traduction du résultat typé de `services.neferbyte` vers le contrat existant :
    `ok` -> `IdentityValidation(valid=True, ...)` ; `invalid_id` -> `valid=False` ;
    indisponibilité / timeout / config inutilisable -> la signalisation FazerCards
    (`IdentityValidationHTTPException`, code `provider_unavailable` ou `unsupported_game`).
    Ne renvoie JAMAIS `valid=True` sur autre chose qu'un `ok` explicite du fournisseur.
    """

    name = NEFERBYTE

    def __init__(self, slug: str, id_field: str, server_field: str | None = None) -> None:
        self.slug = slug
        self.id_field = id_field
        self.server_field = server_field

    def __repr__(self) -> str:  # pragma: no cover - confort de debug, aucune donnée joueur
        return f"NeferbyteProvider(slug={self.slug!r}, id_field={self.id_field!r})"

    async def validate_identity(self, game_id: str | None, fields: dict) -> IdentityValidation:
        values = fields or {}
        raw_id = values.get(self.id_field)
        player_id = raw_id.strip() if isinstance(raw_id, str) else None
        raw_server = values.get(self.server_field) if self.server_field else None
        server = raw_server.strip() if isinstance(raw_server, str) else None

        check = await neferbyte.verify_identity(self.slug, player_id, server)

        if check.status == neferbyte.OK:
            return IdentityValidation(valid=True, player_name=check.player_name,
                                      region=check.region, raw=check.raw)
        if check.status == neferbyte.INVALID_ID:
            return IdentityValidation(valid=False)
        if check.status == neferbyte.TIMEOUT:
            raise _http_error(504, TIMEOUT_DETAIL, "provider_unavailable")
        if check.status == neferbyte.CONFIG_ERROR:
            # Défense en profondeur : la résolution valide déjà la config, mais une config
            # devenue incohérente ne doit jamais dégrader en erreur fournisseur générique.
            logger.warning("neferbyte %s: configuration inutilisable (%s)", self.slug, check.reason)
            raise _http_error(503, UNSUPPORTED_GAME_DETAIL, "unsupported_game")
        # `provider_unavailable` et tout statut inconnu : fail-closed, jamais validé.
        logger.warning("neferbyte %s: indisponible (%s)", self.slug, check.reason or check.status)
        raise _http_error(503, PROVIDER_ERROR, "provider_unavailable")


# --------------------------------------------------------------------------- #
# Résolution par jeu (synchrone : le document jeu est déjà chargé)
# --------------------------------------------------------------------------- #
def _fazercards() -> IdentityProvider:
    """Fournisseur par défaut : FazerCards, instance unique réutilisée par `get_provider`.

    Le défaut ne dépend pas du jeu (aucun jeu ne change de comportement tant que
    `identity_verifier` est absent) ; `get_provider` est appelé sans game_id exprès.
    """
    from services.providers import get_provider

    provider = get_provider(None)
    # Vérification de CAPACITÉ (et non de type nominal) : un fournisseur qui ne sait pas valider
    # une identité est une mauvaise configuration (503), mais un provider simulé/duck-typé qui
    # expose `validate_identity` reste utilisable (les bancs de tests existants en dépendent).
    if not callable(getattr(provider, "validate_identity", None)):
        raise _http_error(503, UNSUPPORTED_GAME_DETAIL, "unsupported_game")
    return provider


def resolve_identity_provider(game: dict | None = None) -> IdentityProvider:
    """Fournisseur d'identité EFFECTIF d'un jeu, d'après le champ `identity_verifier`.

    FazerCards si le champ est absent / `None` / `{"provider": "fazercards"}` ; Neferbyte si la
    configuration est cohérente ; 503 `unsupported_game` sinon (aucun appel fournisseur).
    """
    from core.games import identity_spec

    game = game or {}
    raw = game.get("identity_verifier")
    if raw is None:
        return _fazercards()
    try:
        config = normalize_identity_verifier(raw, game.get("id"), identity_spec(game))
    except IdentityVerifierError as exc:
        # Motif précis côté logs admin uniquement : jamais renvoyé tel quel au client.
        logger.warning("identity_verifier inutilisable pour le jeu %s : %s", game.get("id"), exc)
        raise _http_error(503, UNSUPPORTED_GAME_DETAIL, "unsupported_game") from None
    if config is None or config["provider"] == FAZERCARDS:
        return _fazercards()
    return NeferbyteProvider(slug=config["slug"], id_field=config["id_field"],
                             server_field=config["server_field"])


__all__ = [
    "FAZERCARDS", "NEFERBYTE", "NeferbyteProvider", "IdentityVerifierError",
    "normalize_identity_verifier", "resolve_identity_provider",
]
