import uuid
from datetime import datetime, timezone

from core.db import db

DEFAULT_GAME_ID = "pubg-mobile"
FREE_FIRE_GAME_ID = "free-fire"
PUBG_GAME = {
    "id": DEFAULT_GAME_ID, "slug": DEFAULT_GAME_ID, "name": "PUBG Mobile", "active": True, "sort_order": 0,
    "icon_url": "https://customer-assets-0z36b82j.emergentagent.net/job_games-nav-polish/artifacts/ih6044zb_pubgm_app-icon_512x512%281%29.e9f7efc0.png",
    "description": "UC, Prime, Prime+ & Pack évolutif", "description_en": "UC, Prime, Prime+ & Evolving Pack",
}
# Phase 3 — second real game. `icon_url` is intentionally left empty: the logo is
# admin-configurable (Admin → Jeux) and the storefront falls back to the design-system
# placeholder until an administrator sets it. No commercial data is invented here.
# `active` stays False until Free Fire has a REAL, confirmed commercial configuration
# (admin sets the logo, a purchasable catalog exists and supplier mappings are linked):
# a game with no catalog must never be advertised to customers as ready to sell.
FREE_FIRE_GAME = {
    "id": FREE_FIRE_GAME_ID, "slug": FREE_FIRE_GAME_ID, "name": "Free Fire", "active": False, "sort_order": 1,
    "icon_url": None,
    "description": "Diamants Free Fire", "description_en": "Free Fire Diamonds",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


async def seed_games():
    """Idempotent: inserts the known games once, never overwrites admin edits."""
    for game in (PUBG_GAME, FREE_FIRE_GAME):
        await db.games.update_one({"id": game["id"]}, {"$setOnInsert": {**game, "created_at": _now()}}, upsert=True)


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


def _mapping_ok(mapping: dict | None) -> bool:
    """Mapping fournisseur utilisable (direct ou composé) : structure complète et confirmée.

    Copie locale volontaire de `services.fzr_mapping.mapping_ok` : `core` ne peut pas importer
    `services` (cycle d'import). La règle reste identique.
    """
    if not mapping or mapping.get("confirmed") is False:
        return False
    if mapping.get("mode", "direct") == "direct":
        return bool(mapping.get("category_id") and mapping.get("offer_id"))
    return bool(mapping.get("category_id") and mapping.get("components"))


async def game_has_sellable_catalog(game_id: str) -> bool:
    """Un jeu est VENDABLE s'il a au moins un produit ACTIF réellement livrable.

    L'existence d'un document produit ne suffit pas : un produit inactif, ou actif mais
    exigeant un mapping fournisseur absent/non confirmé, n'est pas vendable. C'est la
    condition d'activation publique d'un jeu — un jeu sans catalogue vendable ne doit
    jamais être annoncé au client.
    """
    async for p in db.products.find({"game_id": game_id, "active": True},
                                    {"_id": 0, "requires_mapping": 1, "fazercards_mapping": 1}):
        if not p.get("requires_mapping") or _mapping_ok(p.get("fazercards_mapping")):
            return True
    return False


async def reconcile_sellable_games():
    """Garantit l'invariant : un jeu PUBLIC a un catalogue VENDABLE. Idempotent, additif.

    Un jeu actif sans produit vendable est invisible pour le client mais apparaîtrait dans
    le sélecteur comme « prêt à vendre » puis ouvrirait une boutique vide. On le désactive —
    l'administrateur le réactive dans Admin → Jeux une fois son catalogue et ses mappings
    fournisseur en place. Ne touche jamais un jeu qui a un catalogue vendable.
    """
    active_ids = [g["id"] async for g in db.games.find({"active": True}, {"_id": 0, "id": 1})]
    for game_id in active_ids:
        if not await game_has_sellable_catalog(game_id):
            await db.games.update_one({"id": game_id}, {"$set": {"active": False, "updated_at": _now()}})


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


async def migrate_saved_pubg_ids():
    """Additive + idempotent: each legacy saved PUBG ID becomes one GameIdentity, exactly once.
    `pubg_ids_migrated` remembers handled IDs so a later deleted identity is never recreated."""
    query = {"saved_pubg_ids.0": {"$exists": True}}
    async for user in db.users.find(query, {"_id": 0, "user_id": 1, "saved_pubg_ids": 1, "pubg_ids_migrated": 1}):
        done = set(user.get("pubg_ids_migrated") or [])
        todo = [pid for pid in dict.fromkeys(user["saved_pubg_ids"]) if isinstance(pid, str) and pid and pid not in done]
        if not todo:
            continue
        existing = {d["fields"].get("player_id") async for d in db.game_identities.find(
            {"user_id": user["user_id"], "game_id": DEFAULT_GAME_ID}, {"_id": 0, "fields": 1})}
        docs = [{"id": str(uuid.uuid4()), "user_id": user["user_id"], "game_id": DEFAULT_GAME_ID, "label": f"PUBG {pid}",
                 "fields": {"player_id": pid}, "source": "saved_pubg_ids", "validated": False, "validated_at": None,
                 "created_at": _now(), "updated_at": _now()} for pid in todo if pid not in existing]
        if docs:
            await db.game_identities.insert_many(docs)
        await db.users.update_one({"user_id": user["user_id"]}, {"$addToSet": {"pubg_ids_migrated": {"$each": todo}}})
