import os
import uuid
from datetime import datetime, timezone

from core.db import db
from core.security import hash_password, verify_password, new_user_id

UC_PACKS = [
    (30, 3500, 3000, True), (60, 5500, 5000, True), (90, 8500, 8000, False), (120, 11000, 10000, False),
    (180, 16000, 15000, False), (325, 22000, 21000, True), (415, 30000, 29500, False), (660, 42000, 41000, True),
    (720, 45500, 44500, False), (985, 63000, 62000, False), (1320, 82000, 81000, True), (1800, 102000, 100000, True),
    (3850, 204000, 202000, False), (16200, 801000, 793000, False),
]
PRIME_PACKS = [
    ("prime", 1, None, 6000), ("prime", 3, None, 17000), ("prime", 6, None, 28000), ("prime", 12, None, 50000),
    ("prime_plus", 1, 42000, 41000), ("prime_plus", 3, 191000, 188000), ("prime_plus", 6, 233000, 229000),
    ("prime_plus", 12, 457000, 448000),
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def build_products():
    items = []
    for i, (uc, old, price, popular) in enumerate(UC_PACKS):
        items.append({
            "id": str(uuid.uuid4()), "slug": f"{uc}-uc", "type": "uc", "name": f"{uc:,} UC".replace(",", " "),
            "uc_amount": uc, "duration_months": None, "price": price, "old_price": old, "popular": popular,
            "badge": "popular" if popular else None,
            "description_fr": f"Recharge de {uc:,} UC (Unknown Cash) créditée directement sur votre compte PUBG Mobile.".replace(",", " "),
            "description_en": f"{uc:,} UC (Unknown Cash) top-up credited directly to your PUBG Mobile account.".replace(",", " "),
            "active": True, "sort_order": i, "created_at": _now(),
        })
    for j, (kind, months, old, price) in enumerate(PRIME_PACKS):
        label = "Prime+" if kind == "prime_plus" else "Prime"
        items.append({
            "id": str(uuid.uuid4()), "slug": f"{kind.replace('_', '-')}-{months}m", "type": kind,
            "name": f"{label} {months} mois", "name_en": f"{label} {months} month{'s' if months > 1 else ''}",
            "uc_amount": None, "duration_months": months, "price": price, "old_price": old,
            "popular": kind == "prime_plus" and months == 1, "badge": "-2%" if old else None,
            "description_fr": f"Abonnement {label} PUBG Mobile pour {months} mois : UC quotidiens, réductions boutique et bonus exclusifs.",
            "description_en": f"PUBG Mobile {label} subscription for {months} month(s): daily UC, shop discounts and exclusive bonuses.",
            "active": True, "sort_order": 100 + j, "created_at": _now(),
        })
    return items


DEFAULT_EVENT = {
    "id": str(uuid.uuid4()), "slug": "pre-order-rp-a18", "title_fr": "Pré-commande Royal Pass A18",
    "title_en": "Royal Pass A18 Pre-Order",
    "description_fr": "Promotion exclusive Royal Pass A18 disponible pour une durée limitée. Réservez votre RP dès maintenant.",
    "description_en": "Exclusive Royal Pass A18 promotion for a limited time. Reserve your RP now.",
    "image_url": "https://images.unsplash.com/photo-1639656333400-ee5240f757a0?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
    "badge": "promo", "product_slug": "60-uc", "price_label": "60 UC", "old_price_label": "720 UC",
    "active": True, "created_at": _now(),
}


async def seed_all():
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "user_id": new_user_id(), "email": admin_email, "name": "Admin", "role": "admin",
            "password_hash": hash_password(admin_password), "auth_provider": "password",
            "picture": None, "saved_pubg_ids": [], "created_at": _now(),
        })
    elif not existing.get("password_hash") or not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password), "role": "admin"}})

    if await db.products.count_documents({}) == 0:
        await db.products.insert_many(build_products())
    if await db.events.count_documents({}) == 0:
        await db.events.insert_one(dict(DEFAULT_EVENT))
    if not await db.settings.find_one({"key": "store"}):
        await db.settings.insert_one({"key": "store", "admin_online": True, "papi_auto": False, "updated_at": _now()})
    # Papi auto OFF par défaut (USSD manuel) pour les installations existantes sans le réglage.
    await db.settings.update_one({"key": "store", "papi_auto": {"$exists": False}}, {"$set": {"papi_auto": False}})
