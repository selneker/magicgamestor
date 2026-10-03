import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core.db import db
from core.security import get_current_user

router = APIRouter(tags=["games"])
PUBLIC = {"_id": 0}
FIELD_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


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
