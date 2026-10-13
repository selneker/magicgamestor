"""Politique de validation d'identité — PORTE UNIQUE côté serveur (multi-jeux).

Le frontend n'est JAMAIS la seule barrière : cette porte est appelée par la création de commande,
par le garde-fou de paiement et par la pré-vérification de livraison fournisseur.

Quatre états sont distingués explicitement — aucun repli silencieux entre eux :

  valid         : le fournisseur a confirmé l'identité (pseudo/région éventuels).
  invalid       : le fournisseur a explicitement REFUSÉ l'identifiant.
  unsupported   : le fournisseur ne propose PAS de validation pour ce jeu (état NORMAL). Autorisé
                  uniquement quand le jeu porte une politique explicite (`optional`).
  not_required  : le jeu est explicitement autorisé par l'administration à vendre sans
                  vérification (aucun appel fournisseur, aucun affichage de succès).

Une ERREUR TECHNIQUE (timeout, 401/403, 5xx, réponse inattendue) lève TOUJOURS une HTTPException :
elle n'est jamais interprétée comme une validation réussie, ni comme une indisponibilité normale.

Rétrocompatibilité PUBG Mobile : la politique par défaut est `required` et la cible de validation
est la découverte historique — le parcours PUBG est inchangé.
"""
from dataclasses import dataclass

from fastapi import HTTPException

from core.db import db
from core.games import (DEFAULT_GAME_ID, VALIDATION_NOT_REQUIRED, VALIDATION_OPTIONAL, validation_policy_of)
from services import providers

# Projection minimale d'un jeu pour appliquer la politique (aucune donnée commerciale).
GAME_PROJECTION = {"_id": 0, "id": 1, "identity_fields": 1, "validation_policy": 1,
                   "fazercards_validation_category": 1, "fazercards_categories": 1,
                   "fazercards_categories_configured": 1}

STAGE_ORDER = "order"
STAGE_PAYMENT = "payment"
STAGE_DELIVERY = "delivery"

INVALID_IDENTITY_DETAIL = "Identifiant joueur invalide ou introuvable chez le fournisseur."
PUBG_INVALID_IDENTITY_DETAIL = "ID PUBG Mobile invalide chez le fournisseur."
REQUIRED_UNSUPPORTED_DETAIL = (
    "Validation d'identité demandée pour ce jeu mais non prise en charge par le fournisseur : "
    "associez la correspondance de validation du jeu (Admin -> Fournisseur) ou choisissez "
    "explicitement une politique sans vérification avant d'ouvrir la vente.")
UNAVAILABLE_DETAIL = ("Vérification d'identité momentanément indisponible chez le fournisseur. "
                      "Réessayez dans quelques instants.")
PAYMENT_NOT_VALIDATED_DETAIL = (
    "Paiement refusé : la vérification d'identité requise pour ce jeu n'est pas acquise "
    "(vérification en attente, refusée ou non prise en charge). Relancez la vérification.")


@dataclass
class GateResult:
    """Verdict EXPLICITE de la porte d'identité."""

    status: str                 # valid | invalid | unsupported | not_required
    validated: bool             # vrai UNIQUEMENT si le fournisseur a confirmé l'identité
    policy: str
    reason: str                 # raison technique/métier (jamais affichée telle quelle au client)
    player_name: str | None = None
    region: str | None = None
    category_id: str | None = None
    field_key: str | None = None

    @property
    def verified(self) -> bool:
        return self.validated


def invalid_detail(game_id: str | None) -> str:
    return PUBG_INVALID_IDENTITY_DETAIL if (game_id or DEFAULT_GAME_ID) == DEFAULT_GAME_ID \
        else INVALID_IDENTITY_DETAIL


def snapshot_validation(gate: GateResult) -> dict:
    """Champs de traçabilité ajoutés au snapshot d'identité de la commande.

    `validated` n'est vrai QUE si le fournisseur a réellement confirmé l'identité. Une validation
    ignorée (non prise en charge / explicitement non requise) est enregistrée comme telle : on ne
    prétend jamais que l'identité a été vérifiée.
    """
    data = {
        "validation_status": gate.status,
        "validation_policy": gate.policy,
        "validation_reason": gate.reason,
        "validated": gate.validated,
        "validated_at": None,
        "provider_checked": gate.status in ("valid", "invalid"),
    }
    # Une valeur absente ne doit jamais écraser le pseudo déjà saisi par le client.
    if gate.player_name:
        data["player_name"] = gate.player_name
    if gate.region:
        data["region"] = gate.region
    return data


def _raise_unavailable(exc: providers.ProviderError) -> None:
    """Erreur technique : jamais un succès, jamais « non prise en charge » → 502/503/504."""
    status = exc.status_code if 400 <= int(getattr(exc, "status_code", 502) or 502) < 600 else 502
    if status < 500:
        status = 503  # refus d'authentification/limite côté fournisseur : indisponibilité de service
    raise HTTPException(status_code=status, detail=UNAVAILABLE_DETAIL)


async def game_for_gate(game_id: str) -> dict:
    return await db.games.find_one({"id": game_id}, GAME_PROJECTION) or {"id": game_id}


async def gate_identity(game_id: str, fields: dict, *, stage: str = STAGE_ORDER,
                        provider=None, game: dict | None = None) -> GateResult:
    """Applique la politique de validation du jeu à une identité donnée.

    Lève une HTTPException dès qu'une validation DEMANDÉE n'est pas acquise (identifiant refusé,
    cible manquante alors que la politique l'exige) ou que le fournisseur est techniquement
    indisponible. Ne retourne un verdict positif que si le fournisseur a réellement confirmé
    l'identité (ou si la vente sans vérification est explicitement autorisée).
    """
    game = game if game is not None else await game_for_gate(game_id)
    policy = validation_policy_of(game)

    if policy == VALIDATION_NOT_REQUIRED:
        return GateResult(status="not_required", validated=False, policy=policy,
                          reason="not_required_by_admin")

    provider = provider or providers.get_provider(game_id)
    try:
        result = await provider.validate_identity(game_id, fields or {})
    except providers.ProviderError as exc:      # timeout, 5xx, 401/403, réponse inattendue…
        _raise_unavailable(exc)
        raise  # pragma: no cover - _raise_unavailable lève toujours

    status = getattr(result, "status", None) or ("valid" if result.valid else "invalid")

    if status == "unsupported":
        if policy == VALIDATION_OPTIONAL:
            # Autorisation EXPLICITE de vendre sans vérification, mais tracée comme telle.
            return GateResult(status="unsupported", validated=False, policy=policy,
                              reason=getattr(result, "reason", None) or "provider_does_not_support")
        raise HTTPException(status_code=409, detail=REQUIRED_UNSUPPORTED_DETAIL)

    if status != "valid" or not result.valid:
        raise HTTPException(status_code=422 if stage == STAGE_ORDER else 409,
                            detail=invalid_detail(game_id))

    return GateResult(status="valid", validated=True, policy=policy, reason="provider_confirmed",
                      player_name=result.player_name, region=result.region,
                      category_id=getattr(result, "category_id", None),
                      field_key=getattr(result, "field_key", None))


def payment_blocked_reason(order: dict | None) -> str | None:
    """Motif de blocage du DÉMARRAGE d'un paiement, ou None si le paiement est autorisé.

    Les commandes LEGACY (snapshot sans champ `validation_status`, créées avant ce correctif)
    ne sont jamais bloquées : leur parcours historique reste inchangé.
    """
    snapshot = (order or {}).get("identity_snapshot") or {}
    if "validation_status" not in snapshot:
        return None
    if snapshot.get("validation_status") in ("valid", "not_required", "unsupported"):
        return None
    return PAYMENT_NOT_VALIDATED_DETAIL


def region_blocked(region: str | None, mapping: dict | None) -> tuple[str, str] | None:
    """Contrôle région du compte ↔ catégorie régionale du mapping produit (si les deux sont connus).

    Délégué à `services.fazercards.region_conflict` : jamais de blocage sur une information
    absente, jamais de région devinée.
    """
    from services import fazercards
    mapping = mapping or {}
    return fazercards.region_conflict(region, mapping.get("category_id"),
                                      mapping.get("category_name") or mapping.get("offer_name"))


def region_mismatch_detail(conflict: tuple[str, str]) -> str:
    account, category = conflict
    return (f"Région du compte ({account}) incompatible avec la catégorie régionale sélectionnée "
            f"({category}) : choisissez l'offre correspondant à la région du joueur.")


def products_all_belong_to_game(products: dict, game_id: str) -> bool:
    """Règle de panier : tous les produits d'une commande appartiennent au MÊME jeu (mono-jeux)."""
    return all((p or {}).get("game_id", DEFAULT_GAME_ID) == game_id for p in (products or {}).values())
