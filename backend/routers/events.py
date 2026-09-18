import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.security import require_admin

router = APIRouter(tags=["events"])
PUBLIC = {"_id": 0}


class EventIn(BaseModel):
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    title_fr: str
    title_en: str
    description_fr: str = ""
    description_en: str = ""
    image_url: str | None = None
    badge: str | None = None
    product_slug: str | None = None
    price_label: str | None = None
    old_price_label: str | None = None
    active: bool = True


class ReactionIn(BaseModel):
    session_id: str = Field(min_length=6, max_length=80)


class StatusIn(BaseModel):
    online: bool


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _with_counts(event: dict) -> dict:
    likes = await db.reactions.count_documents({"event_id": event["id"], "kind": "like"})
    shares = await db.reactions.count_documents({"event_id": event["id"], "kind": "share"})
    return {**event, "likes": likes, "shares": shares}


@router.get("/events")
async def list_events():
    events = await db.events.find({"active": True}, PUBLIC).sort("created_at", -1).to_list(50)
    return [await _with_counts(e) for e in events]


@router.post("/events/{event_id}/like")
async def like_event(event_id: str, body: ReactionIn):
    if not await db.events.find_one({"id": event_id}):
        raise HTTPException(status_code=404, detail="Event not found")
    existing = await db.reactions.find_one({"event_id": event_id, "session_id": body.session_id, "kind": "like"})
    if existing:
        await db.reactions.delete_one({"_id": existing["_id"]})
        liked = False
    else:
        await db.reactions.insert_one({"event_id": event_id, "session_id": body.session_id, "kind": "like", "at": _now()})
        liked = True
    return {"liked": liked, "likes": await db.reactions.count_documents({"event_id": event_id, "kind": "like"})}


@router.post("/events/{event_id}/share")
async def share_event(event_id: str, body: ReactionIn):
    await db.reactions.update_one({"event_id": event_id, "session_id": body.session_id, "kind": "share"},
                                  {"$set": {"at": _now()}}, upsert=True)
    return {"shares": await db.reactions.count_documents({"event_id": event_id, "kind": "share"})}


@router.get("/settings/status")
async def store_status():
    doc = await db.settings.find_one({"key": "store"}, PUBLIC)
    return {"online": bool(doc and doc.get("admin_online"))}


@router.post("/admin/status", dependencies=[Depends(require_admin)])
async def set_status(body: StatusIn):
    await db.settings.update_one({"key": "store"}, {"$set": {"admin_online": body.online, "updated_at": _now()}}, upsert=True)
    return {"online": body.online}


@router.get("/admin/events", dependencies=[Depends(require_admin)])
async def admin_events():
    return [await _with_counts(e) for e in await db.events.find({}, PUBLIC).sort("created_at", -1).to_list(100)]


@router.post("/admin/events", dependencies=[Depends(require_admin)])
async def create_event(body: EventIn):
    if await db.events.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug already exists")
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "created_at": _now()}
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/admin/events/{event_id}", dependencies=[Depends(require_admin)])
async def update_event(event_id: str, body: EventIn):
    res = await db.events.update_one({"id": event_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    return await db.events.find_one({"id": event_id}, PUBLIC)


@router.delete("/admin/events/{event_id}", dependencies=[Depends(require_admin)])
async def delete_event(event_id: str):
    res = await db.events.delete_one({"id": event_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.reactions.delete_many({"event_id": event_id})
    return {"ok": True}
