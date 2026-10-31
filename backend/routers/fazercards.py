import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from core.db import db
from core.games import PUBG_ID_RE, check_identity_payload, identity_spec
from core.ratelimit import check, client_ip, setting
from core.security import require_permission
from services import fazercards, providers

router = APIRouter(tags=["fazercards"])
logger = logging.getLogger(__name__)

PUBG_GAME_ID = "pubg-mobile"
# Projection minimale pour résoudre le vérificateur d'identité d'un jeu : le contrat de saisie
# (`identity_fields`) et la configuration admin du vérificateur (`identity_verifier`). Ces deux
# champs sont indispensables à `resolve_identity_provider` ; les oublier ferait retomber
# silencieusement le jeu sur FazerCards.
IDENTITY_GAME_PROJECTION = {"_id": 0, "id": 1, "identity_fields": 1, "identity_verifier": 1}


def _identity_error_code(spec: list[dict], fields: dict | None) -> str:
    """Distingue un champ requis absent d'un identifiant présent mais invalide."""
    for field in spec or []:
        if field.get("required", True):
            value = (fields or {}).get(field["key"])
            if not isinstance(value, str) or not value.strip():
                return "missing_field"
    return "invalid_id"


def _http_error_code(exc: HTTPException) -> str:
    """Code stable pour les erreurs qui ne portent pas déjà le leur."""
    if exc.status_code == 429:
        return "rate_limited"
    if exc.status_code == 400:
        return "missing_field"
    if exc.status_code in (502, 504):
        return "provider_unavailable"
    if exc.status_code == 404:
        return "unsupported_game"
    if exc.status_code == 503:
        detail = str(exc.detail)
        if ("service non configuré" in detail
                or "refusée par le fournisseur" in detail
                or "PUBG Mobile n'est pas disponible" in detail):
            return "provider_unavailable"
        return "unsupported_game"
    return "provider_unavailable"


def _error_response(exc: HTTPException, game_id: str) -> JSONResponse:
    """Corps additif : `detail` historique inchangé, plus `code` et `game_id`."""
    return JSONResponse(status_code=exc.status_code, content={
        "detail": exc.detail,
        "code": getattr(exc, "code", None) or _http_error_code(exc),
        "game_id": game_id,
    })


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

    FAIL-CLOSED : un jeu sans cible de validation chez le fournisseur reçoit un 503 explicite
    (voir services.fazercards.validation_target) — jamais un repli silencieux sur PUBG Mobile.
    """
    # Compatibilité : le défaut Pydantic reste PUBG Mobile. On trace seulement l'appel legacy,
    # sans jamais journaliser les champs joueur.
    if "game_id" not in body.model_fields_set:
        logger.warning("fazercards validate-id: game_id absent, repli historique sur pubg-mobile")

    try:
        check(f"fzr_validate:ip:{client_ip(request)}", setting("FZR_VALIDATE_PER_10MIN_PER_IP", 30), 600)
        game = await db.games.find_one({"id": body.game_id}, IDENTITY_GAME_PROJECTION)
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        spec = identity_spec(game)
        checked = check_identity_payload(spec, body.fields)
        if not checked:
            # Same server-side contract as the order endpoint: malformed input never reaches the provider.
            return {
                "valid": False,
                "message": "Format d'identifiant invalide pour ce jeu.",
                "code": _identity_error_code(spec, body.fields),
                "game_id": body.game_id,
            }
        # Le vérificateur d'identité est une donnée du jeu (`identity_verifier`) : Neferbyte s'il
        # est configuré, FazerCards sinon. Le contrat de réponse ci-dessous ne change pas.
        provider = providers.resolve_identity_provider(game)
        result = await provider.validate_identity(body.game_id, checked[0])
        if not result.valid:
            # Message neutre par jeu : PUBG Mobile garde son libellé historique.
            if body.game_id == "pubg-mobile":
                message = "ID PUBG Mobile invalide"
            else:
                message = "Identifiant joueur invalide pour ce jeu."
            return {"valid": False, "message": message, "code": "invalid_id", "game_id": body.game_id}
        return {
            "valid": True,
            "player_name": result.player_name,
            "region": result.region,
            "game_id": body.game_id,
        }
    except HTTPException as exc:
        return _error_response(exc, body.game_id)


@router.post("/fazercards/pubg/validate-id")
async def validate_pubg_id(body: PubgValidateIn, request: Request):
    """Compat historique (PUBG Mobile). Délègue au même chemin que la validation générique."""
    check(f"fzr_validate:ip:{client_ip(request)}", setting("FZR_VALIDATE_PER_10MIN_PER_IP", 30), 600)
    # Même résolution que la route générique : le vérificateur configuré pour PUBG Mobile
    # s'applique aussi ici. Document jeu absent = aucun `identity_verifier` enregistré : on
    # conserve le comportement historique (FazerCards) plutôt que d'inventer un 404.
    game = await db.games.find_one({"id": PUBG_GAME_ID}, IDENTITY_GAME_PROJECTION) \
        or {"id": PUBG_GAME_ID}
    result = await providers.resolve_identity_provider(game).validate_identity(
        PUBG_GAME_ID, {"player_id": body.player_id})
    if not result.valid:
        return {"valid": False, "message": "ID PUBG Mobile invalide"}
    return {"valid": True, "player_name": result.player_name, "region": result.region}


@router.get("/fazercards/pubg/catalog", dependencies=[Depends(require_permission("catalog.manage"))])
async def pubg_catalog():
    """Admin only: live FazerCards PUBG Mobile categories, offers, supplier USD prices and required fields."""
    return {"categories": await fazercards.pubg_catalog()}
