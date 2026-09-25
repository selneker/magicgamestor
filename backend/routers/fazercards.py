from fastapi import APIRouter, Request
from pydantic import BaseModel, field_validator

from core.ratelimit import check, client_ip, setting
from services import fazercards

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


@router.post("/fazercards/pubg/validate-id")
async def validate_pubg_id(body: PubgValidateIn, request: Request):
    check(f"fzr_validate:ip:{client_ip(request)}", setting("FZR_VALIDATE_PER_10MIN_PER_IP", 30), 600)
    result = await fazercards.validate_pubg_id(body.player_id)
    if not result["valid"]:
        return {"valid": False, "message": "ID PUBG Mobile invalide"}
    return {"valid": True, "player_name": result.get("player_name"), "region": result.get("region")}
