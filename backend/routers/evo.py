import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core.audit import audit
from core.db import db
from core.security import require_permission
from services.fzr_mapping import purchase_blocked

router = APIRouter(tags=["evo"])
PUBLIC = {"_id": 0}
EVO_TYPE = "evo"
INACTIVE_ORDER_STATUSES = ("cancelled", "failed", "expired")


def _now():
    return datetime.now(timezone.utc).isoformat()


def week_key() -> str:
    """Server-side ISO week (UTC), never the browser clock."""
    y, w, _ = datetime.now(timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


async def active_season() -> dict | None:
    return await db.seasons.find_one({"active": True}, PUBLIC)


async def evo_period(product: dict) -> tuple[str, dict | None]:
    limit = product.get("evo_limit")
    if limit == "season":
        season = await active_season()
        if not season:
            raise HTTPException(status_code=409, detail="Aucune saison PUBG Mobile active pour le moment. Réessayez plus tard.")
        return f"season:{season['id']}", season
    if limit == "week":
        return f"week:{week_key()}", None
    return "lifetime", None


def _blocked_reason(product: dict, holder_status: str, season: dict | None) -> str:
    name = product["name"].upper()
    if holder_status in ("pending_payment", "awaiting_verification"):
        return f"Une commande {name} est déjà en cours pour cet ID PUBG Mobile."
    limit = product.get("evo_limit")
    if limit == "season":
        return f"{name} déjà acheté pendant cette saison ({season['name']})."
    if limit == "week":
        return f"{name} déjà acheté cette semaine (1 fois par semaine et par ID PUBG Mobile)."
    return f"{name} déjà utilisé pour cet ID PUBG Mobile (1 seule fois au total)."


async def _holder_status(lock: dict) -> str | None:
    holder = await db.orders.find_one({"id": lock["order_id"]}, {"status": 1})
    return holder["status"] if holder else None


async def check_evo(product: dict, pubg_id: str) -> dict:
    period_key, season = await evo_period(product)
    lock = await db.evo_locks.find_one({"pubg_id": pubg_id, "offer_slug": product["slug"], "period_key": period_key})
    if lock:
        status = await _holder_status(lock)
        if status and status not in INACTIVE_ORDER_STATUSES:
            return {"eligible": False, "reason": _blocked_reason(product, status, season), "period_key": period_key, "season": season}
    return {"eligible": True, "reason": None, "period_key": period_key, "season": season}


async def reserve_evo(pubg_id: str, product: dict, order_id: str) -> tuple[str, dict | None]:
    """Atomic per-(pubg_id, offer, period) reservation via the unique index on evo_locks."""
    period_key, season = await evo_period(product)
    for _ in range(3):
        try:
            await db.evo_locks.insert_one({"pubg_id": pubg_id, "offer_slug": product["slug"], "period_key": period_key,
                                           "order_id": order_id, "created_at": _now()})
            return period_key, season
        except DuplicateKeyError:
            existing = await db.evo_locks.find_one({"pubg_id": pubg_id, "offer_slug": product["slug"], "period_key": period_key})
            if not existing:
                continue
            status = await _holder_status(existing)
            if status and status not in INACTIVE_ORDER_STATUSES:
                raise HTTPException(status_code=409, detail=_blocked_reason(product, status, season))
            await db.evo_locks.delete_one({"_id": existing["_id"]})
    raise HTTPException(status_code=409, detail="Réessayez dans un instant.")


async def release_evo_locks(order_id: str):
    await db.evo_locks.delete_many({"order_id": order_id})


@router.get("/evo/season")
async def public_season():
    return {"season": await active_season(), "week": week_key()}


@router.get("/evo/eligibility")
async def eligibility(product_id: str = Query(min_length=1), pubg_id: str = Query(min_length=1)):
    pubg_id = pubg_id.strip()
    if not pubg_id.isdigit() or not (9 <= len(pubg_id) <= 13):
        raise HTTPException(status_code=400, detail="ID PUBG Mobile invalide (9 à 13 chiffres).")
    product = await db.products.find_one({"id": product_id, "type": EVO_TYPE}, PUBLIC)
    if not product:
        raise HTTPException(status_code=404, detail="Offre introuvable.")
    if not product.get("active"):
        return {"eligible": False, "reason": "Cette offre n'est pas disponible actuellement.", "season": None}
    blocked = purchase_blocked(product)
    if blocked:
        return {"eligible": False, "reason": blocked, "season": None}
    try:
        result = await check_evo(product, pubg_id)
    except HTTPException as exc:
        if exc.status_code == 409:
            return {"eligible": False, "reason": exc.detail, "season": None}
        raise
    return {**result, "pubg_id": pubg_id, "week": week_key()}


# ---------- Admin: PUBG Mobile seasons ----------
class SeasonIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    activate: bool = True


@router.get("/admin/seasons", dependencies=[Depends(require_permission("catalog.manage"))])
async def list_seasons():
    return await db.seasons.find({}, PUBLIC).sort("created_at", -1).to_list(100)


@router.post("/admin/seasons", status_code=201)
async def create_season(body: SeasonIn, admin=Depends(require_permission("catalog.manage"))):
    name = body.name.strip()
    if await db.seasons.find_one({"name": name}):
        raise HTTPException(status_code=409, detail="Une saison porte déjà ce nom.")
    season = {"id": str(uuid.uuid4()), "name": name, "active": bool(body.activate),
              "created_at": _now(), "created_by": admin["user_id"]}
    if body.activate:
        await db.seasons.update_many({"active": True}, {"$set": {"active": False}})
    await db.seasons.insert_one(season)
    await audit("season.created", admin["user_id"], season["id"], {"name": name, "active": season["active"]})
    season.pop("_id", None)
    return season


@router.post("/admin/seasons/{season_id}/activate")
async def activate_season(season_id: str, admin=Depends(require_permission("catalog.manage"))):
    season = await db.seasons.find_one({"id": season_id}, PUBLIC)
    if not season:
        raise HTTPException(status_code=404, detail="Saison introuvable.")
    await db.seasons.update_many({"active": True}, {"$set": {"active": False}})
    await db.seasons.update_one({"id": season_id}, {"$set": {"active": True}})
    await audit("season.activated", admin["user_id"], season_id, {"name": season["name"]})
    return {**season, "active": True}
