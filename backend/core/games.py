from datetime import datetime, timezone

from core.db import db

DEFAULT_GAME_ID = "pubg-mobile"
PUBG_GAME = {
    "id": DEFAULT_GAME_ID, "slug": DEFAULT_GAME_ID, "name": "PUBG Mobile", "active": True, "sort_order": 0,
    "icon_url": "https://customer-assets-0z36b82j.emergentagent.net/job_games-nav-polish/artifacts/ih6044zb_pubgm_app-icon_512x512%281%29.e9f7efc0.png",
    "description": "UC, Prime, Prime+ & Pack évolutif", "description_en": "UC, Prime, Prime+ & Evolving Pack",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def seed_games():
    """Idempotent: inserts PUBG Mobile once, never overwrites admin edits."""
    await db.games.update_one({"id": DEFAULT_GAME_ID}, {"$setOnInsert": {**PUBG_GAME, "created_at": _now()}}, upsert=True)


def legacy_snapshot(order: dict) -> dict:
    """Snapshot rebuilt only from data really present on a pre-multi-game order."""
    snap = {"legacy": True, "fields": {}}
    if order.get("pubg_id"):
        snap["fields"]["player_id"] = order["pubg_id"]
    if order.get("pseudo"):
        snap["player_name"] = order["pseudo"]
    return snap


def with_game_defaults(order: dict | None) -> dict | None:
    """Read-time compatibility for orders not yet touched by the startup migration."""
    if order:
        order.setdefault("game_id", DEFAULT_GAME_ID)
        order.setdefault("identity_snapshot", legacy_snapshot(order))
    return order


async def migrate_multigame():
    """Additive + idempotent: only documents lacking game_id are enriched ($set only, nothing removed)."""
    await db.products.update_many({"game_id": {"$exists": False}}, {"$set": {"game_id": DEFAULT_GAME_ID}})
    missing = {"$or": [{"game_id": {"$exists": False}}, {"identity_snapshot": {"$exists": False}}]}
    async for order in db.orders.find(missing, {"_id": 0, "id": 1, "pubg_id": 1, "pseudo": 1, "game_id": 1, "identity_snapshot": 1}):
        updates = {}
        if "game_id" not in order:
            updates["game_id"] = DEFAULT_GAME_ID
        if "identity_snapshot" not in order:
            updates["identity_snapshot"] = legacy_snapshot(order)
        await db.orders.update_one({"id": order["id"], **{k: {"$exists": False} for k in updates}}, {"$set": updates})
