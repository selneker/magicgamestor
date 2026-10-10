import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core.audit import audit
from core.db import db
from core.games import game_has_sellable_catalog
from core.security import get_current_user, require_permission

router = APIRouter(tags=["games"])
PUBLIC = {"_id": 0}
FIELD_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
# Public activation is refused while the game has no sellable catalog (see core.games).
NO_CATALOG_DETAIL = ("Activation refusee : ce jeu n'a aucun produit actif et correctement configure "
                     "pour la livraison. Creez son catalogue, configurez les mappings fournisseur "
                     "(Admin -> Fournisseur) puis activez-le.")


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("/games")
async def list_games():
    return await db.games.find({"active": True}, PUBLIC).sort("sort_order", 1).to_list(100)


@router.get("/games/{game_id}")
async def get_game(game_id: str):
    game = await db.games.find_one({"id": game_id, "active": True}, PUBLIC)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


class IdentityUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=40)
    fields: dict[str, str] | None = None
    player_name: str | None = Field(default=None, max_length=60)
    region: str | None = Field(default=None, max_length=20)

    @field_validator("fields")
    @classmethod
    def _fields(cls, v):
        if v is None:
            return v
        if not 1 <= len(v) <= 10:
            raise ValueError("1 to 10 identity fields required")
        clean = {}
        for k, val in v.items():
            val = (val or "").strip()
            if not FIELD_KEY.match(k) or not 1 <= len(val) <= 64:
                raise ValueError(f"Invalid identity field: {k}")
            clean[k] = val
        return clean


class IdentityIn(IdentityUpdate):
    game_id: str = Field(min_length=1, max_length=60)
    label: str = Field(default="Compte principal", min_length=1, max_length=40)
    fields: dict[str, str]


async def _owned(identity_id: str, user: dict) -> dict:
    doc = await db.game_identities.find_one({"id": identity_id, "user_id": user["user_id"]}, PUBLIC)
    if not doc:
        raise HTTPException(status_code=404, detail="Identity not found")
    return doc


@router.get("/me/game-identities")
async def my_identities(game_id: str | None = None, user=Depends(get_current_user)):
    query = {"user_id": user["user_id"], **({"game_id": game_id} if game_id else {})}
    return await db.game_identities.find(query, PUBLIC).sort("created_at", 1).to_list(200)


@router.post("/me/game-identities", status_code=201)
async def create_identity(body: IdentityIn, user=Depends(get_current_user)):
    if not await db.games.find_one({"id": body.game_id, "active": True}):
        raise HTTPException(status_code=400, detail="Unknown or inactive game")
    same = await db.game_identities.find_one({"user_id": user["user_id"], "game_id": body.game_id, "fields": body.fields}, PUBLIC)
    if same:
        return same  # idempotent: identical identity already saved
    if await db.game_identities.count_documents({"user_id": user["user_id"]}) >= 50:
        raise HTTPException(status_code=409, detail="Too many game identities")
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "user_id": user["user_id"],
           "validated": False, "validated_at": None, "created_at": _now(), "updated_at": _now()}
    await db.game_identities.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/me/game-identities/{identity_id}")
async def update_identity(identity_id: str, body: IdentityUpdate, user=Depends(get_current_user)):
    current = await _owned(identity_id, user)
    updates = body.model_dump(exclude_unset=True)
    if "fields" in updates and updates["fields"] != current["fields"]:
        updates.update({"validated": False, "validated_at": None})  # changed identity = must be re-validated
    await db.game_identities.update_one({"id": identity_id, "user_id": user["user_id"]}, {"$set": {**updates, "updated_at": _now()}})
    return await _owned(identity_id, user)


@router.delete("/me/game-identities/{identity_id}")
async def delete_identity(identity_id: str, user=Depends(get_current_user)):
    await _owned(identity_id, user)
    await db.game_identities.delete_one({"id": identity_id, "user_id": user["user_id"]})
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Phase 3 — admin game management (create / edit / activate-deactivate).
# Authorization reuses the existing central mechanism: `catalog.manage`.
# `icon_url` is the single logo source (no second `logo_url` field, no upload).
# --------------------------------------------------------------------------- #


class GameIn(BaseModel):
    id: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=60)
    slug: str | None = Field(default=None, max_length=60, pattern=r"^[a-z0-9-]+$")
    icon_url: str | None = Field(default=None, max_length=500)
    description: str = ""
    description_en: str | None = None
    active: bool = True
    sort_order: int = 0

    @field_validator("icon_url")
    @classmethod
    def _http_url(cls, value):
        value = (value or "").strip()
        if not value:
            return None
        if not re.match(r"^https?://[^\s]+$", value):
            raise ValueError("URL de logo invalide (https://\u2026)")
        return value


@router.get("/admin/games")
async def admin_list_games(_=Depends(require_permission("catalog.manage"))):
    """Every game, active or not (the public /games only exposes active ones)."""
    return await db.games.find({}, PUBLIC).sort("sort_order", 1).to_list(200)


@router.post("/admin/games", status_code=201)
async def create_game(body: GameIn, user=Depends(require_permission("catalog.manage"))):
    if await db.games.find_one({"id": body.id}):
        raise HTTPException(status_code=409, detail="Ce jeu existe d\u00e9j\u00e0.")
    if body.active:
        # A brand-new game has no product yet: it can never be sellable at creation time.
        raise HTTPException(status_code=409, detail=NO_CATALOG_DETAIL)
    data = body.model_dump()
    data["slug"] = data.get("slug") or data["id"]
    doc = {**data, "created_at": _now(), "updated_at": _now()}
    await db.games.insert_one(doc)
    await audit("game.create", user["user_id"], body.id, {"name": body.name, "active": body.active})
    doc.pop("_id", None)
    return doc


@router.put("/admin/games/{game_id}")
async def update_game(game_id: str, body: GameIn, user=Depends(require_permission("catalog.manage"))):
    """Edit a game. The `id` is immutable: products, orders and identities reference it.

    Public activation is gated: a game with no ACTIVE, correctly configured (deliverable)
    product must never be advertised to customers. The mere existence of a product document
    is not proof that the game is sellable.
    """
    if not await db.games.find_one({"id": game_id}):
        raise HTTPException(status_code=404, detail="Jeu introuvable.")
    if body.active and not await game_has_sellable_catalog(game_id):
        raise HTTPException(status_code=409, detail=NO_CATALOG_DETAIL)
    data = body.model_dump()
    data.pop("id", None)  # never re-key an existing game
    data["slug"] = data.get("slug") or game_id
    await db.games.update_one({"id": game_id}, {"$set": {**data, "updated_at": _now()}})
    await audit("game.update", user["user_id"], game_id,
                {"name": body.name, "active": body.active, "icon_url": body.icon_url})
    return await db.games.find_one({"id": game_id}, PUBLIC)
