from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from core.db import db
from core.games import (DEFAULT_GAME_ID, PUBG_ID_RE, VALIDATION_NOT_REQUIRED, VALIDATION_OPTIONAL,
                        check_identity_payload, identity_spec, validation_policy_of)
from core.ratelimit import check, client_ip, setting
from core.security import require_permission
from services import fazercards, identity_gate, providers

router = APIRouter(tags=["fazercards"])


class PubgValidateIn(BaseModel):
    player_id: str

    @field_validator("player_id")
    @classmethod
    def normalize(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("ID PUBG Mobile requis.")
        if not PUBG_ID_RE.fullmatch(v):
            raise ValueError("ID PUBG Mobile mal formé (9 à 13 chiffres).")
        return v


class IdentityValidateIn(BaseModel):
    """Validation d'identité GÉNÉRIQUE (multi-jeux).

    `fields` porte les champs DYNAMIQUES du jeu (ex. {"player_id": "..."} ou
    {"zone_id": "...", "player_id": "..."}) : aucune clé n'est imposée par le domaine.
    """

    game_id: str = Field(default="pubg-mobile", min_length=1, max_length=60)
    fields: dict[str, str]

    @field_validator("fields")
    @classmethod
    def normalize(cls, v):
        if not 1 <= len(v) <= 10:
            raise ValueError("1 à 10 champs d'identité requis.")
        clean = {str(k): str(val or "").strip() for k, val in v.items()}
        if not any(clean.values()):
            raise ValueError("Au moins un champ d'identité doit être renseigné.")
        return clean


@router.post("/fazercards/validate-id")
async def validate_identity(body: IdentityValidateIn, request: Request):
    """Validation d'identité joueur pour N'IMPORTE QUEL jeu configuré.

    Réponse TOUJOURS explicite (`status`) et jamais ambiguë :
      - "valid"        : le fournisseur a confirmé l'identité ;
      - "invalid"      : l'identifiant a été explicitement refusé ;
      - "unsupported"  : le fournisseur ne propose pas de validation pour ce jeu (état normal) —
                         `can_sell_without_validation` indique si l'administration l'a autorisé ;
      - "not_required" : le jeu est explicitement configuré pour vendre sans vérification ;
      - erreur technique (timeout, 401/403, 5xx, réponse inattendue) → 502/503/504 : elle n'est
        JAMAIS présentée comme une réussite ni comme une simple absence de prise en charge.
    """
    check(f"fzr_validate:ip:{client_ip(request)}", setting("FZR_VALIDATE_PER_10MIN_PER_IP", 30), 600)
    game = await identity_gate.game_for_gate(body.game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    policy = validation_policy_of(game)
    checked = check_identity_payload(identity_spec(game), body.fields)
    if not checked:
        # Même contrat serveur que la création de commande : une saisie mal formée n'atteint
        # jamais le fournisseur.
        return {"valid": False, "status": "invalid_format", "validation_policy": policy,
                "can_sell_without_validation": False,
                "message": "Format d'identifiant invalide pour ce jeu."}
    if policy == VALIDATION_NOT_REQUIRED:
        # Aucune vérification demandée par l'administration : on ne prétend PAS avoir vérifié.
        return {"valid": False, "status": "not_required", "validation_policy": policy,
                "can_sell_without_validation": True, "verified": False,
                "message": "Vérification d'identité non requise pour ce jeu (configuration administrateur)."}
    try:
        result = await providers.get_provider(body.game_id).validate_identity(body.game_id, checked[0])
    except providers.ProviderError as exc:
        status_code = int(getattr(exc, "status_code", 502) or 502)
        raise HTTPException(status_code=status_code if status_code >= 500 else 503,
                            detail=identity_gate.UNAVAILABLE_DETAIL)
    if result.status == "unsupported":
        allowed = policy == VALIDATION_OPTIONAL
        return {"valid": False, "status": "unsupported", "validation_policy": policy,
                "can_sell_without_validation": allowed, "verified": False,
                "message": ("Le fournisseur ne propose pas de vérification d'identité pour ce jeu. "
                            + ("Vous pouvez poursuivre : cette vente sans vérification est autorisée "
                               "explicitement." if allowed else
                               "La vente de ce jeu est indisponible tant que ce point n'est pas configuré."))}
    if not result.valid:
        # Message neutre par jeu : PUBG Mobile garde son libellé historique.
        if body.game_id == DEFAULT_GAME_ID:
            return {"valid": False, "status": "invalid", "validation_policy": policy,
                    "verified": False, "message": "ID PUBG Mobile invalide"}
        return {"valid": False, "status": "invalid", "validation_policy": policy,
                "verified": False, "message": "Identifiant joueur invalide pour ce jeu."}
    return {"valid": True, "status": "valid", "verified": True, "validation_policy": policy,
            "player_name": result.player_name, "region": result.region}


@router.post("/fazercards/pubg/validate-id")
async def validate_pubg_id(body: PubgValidateIn, request: Request):
    """Compat historique (PUBG Mobile). Délègue au même chemin que la validation générique."""
    check(f"fzr_validate:ip:{client_ip(request)}", setting("FZR_VALIDATE_PER_10MIN_PER_IP", 30), 600)
    result = await providers.get_provider("pubg-mobile").validate_identity("pubg-mobile", {"player_id": body.player_id})
    if not result.valid:
        return {"valid": False, "message": "ID PUBG Mobile invalide"}
    return {"valid": True, "player_name": result.player_name, "region": result.region}


@router.get("/fazercards/pubg/catalog", dependencies=[Depends(require_permission("catalog.manage"))])
async def pubg_catalog():
    """Admin only: live FazerCards PUBG Mobile categories, offers, supplier USD prices and required fields."""
    return {"categories": await fazercards.pubg_catalog()}
