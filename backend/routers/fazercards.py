from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from core.ratelimit import check, client_ip, setting
from core.security import require_permission
from services import fazercards, providers

router = APIRouter(tags=["fazercards"])


class PubgValidateIn(BaseModel):
    player_id: str

    @field_validator("player_id")
    @classmethod
    def normalize(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("ID PUBG Mobile requis.")
        if not v.isdigit() or not (5 <= len(v) <= 20):
            raise ValueError("ID PUBG Mobile mal formé (chiffres uniquement, 5 à 20 caractères).")
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

    FAIL-CLOSED : un jeu sans cible de validation chez le fournisseur reçoit un 503 explicite
    (voir services.fazercards.validation_target) — jamais un repli silencieux sur PUBG Mobile.
    """
    check(f"fzr_validate:ip:{client_ip(request)}", setting("FZR_VALIDATE_PER_10MIN_PER_IP", 30), 600)
    result = await providers.get_provider(body.game_id).validate_identity(body.game_id, body.fields)
    if not result.valid:
        # Message neutre par jeu : PUBG Mobile garde son libellé historique.
        if body.game_id == "pubg-mobile":
            return {"valid": False, "message": "ID PUBG Mobile invalide"}
        return {"valid": False, "message": "Identifiant joueur invalide pour ce jeu."}
    return {"valid": True, "player_name": result.player_name, "region": result.region}


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
