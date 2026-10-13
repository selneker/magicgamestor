"""Seed test data (UI/UX validation only): a composite mapping + a paid order + pending orders.
Idempotent-ish: removes prior MGS-TEST* orders before inserting. Does NOT touch fulfillment logic."""
import os, uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
mongo_url = os.environ["MONGO_URL"]
db = MongoClient(mongo_url)[os.environ["DB_NAME"]]


def now():
    return datetime.now(timezone.utc).isoformat()


# 1) Composite mapping on the 120 UC product (60 + 60) — data only, provider not called.
p120 = db.products.find_one({"uc_amount": 120}) or db.products.find_one({"slug": "120-uc"})
if not p120:
    raise SystemExit("120 UC product not found")
mapping = {
    "mode": "composite", "category_id": "pubgm", "confirmed": True, "linked_at": now(),
    "components": [{"offer_id": "60_uc", "offer_name": "60 UC", "quantity": 2, "uc_amount": 60, "price_usd_at_link": "0.30"}],
    "total_uc": 120, "total_price_usd_at_link": 0.60,
}
db.products.update_one({"id": p120["id"]}, {"$set": {"fazercards_mapping": mapping, "supplier_cost_usd": 0.60}})
print("composite mapping set on", p120["name"], p120["id"])

# 1b) Direct mapping on the 60 UC product (for direct quantity > 1 tests).
p60 = db.products.find_one({"uc_amount": 60}) or db.products.find_one({"slug": "60-uc"})
if p60:
    db.products.update_one({"id": p60["id"]}, {"$set": {"fazercards_mapping": {
        "mode": "direct", "category_id": "pubgm", "confirmed": True, "linked_at": now(),
        "offer_id": "60_uc", "offer_name": "60 UC", "uc_amount": 60, "price_usd_at_link": "0.30",
    }, "supplier_cost_usd": 0.30}})
    print("direct mapping set on", p60["name"], p60["id"])


def make_order(number, status, product, qty=1):
    return {
        "id": str(uuid.uuid4()), "order_number": number, "user_id": None, "email": "buyer@example.com",
        "pubg_id": "52502644815", "pseudo": "Kapotue",
        "items": [{"product_id": product["id"], "slug": product["slug"], "name": product["name"], "type": product["type"],
                   "duration_months": product.get("duration_months"), "unit_price": product["price"], "quantity": qty,
                   "line_total": product["price"] * qty}],
        "total": product["price"] * qty, "currency": "Ar", "payment_method": "mvola",
        "payment_phone": "0340000000", "manual_reference": None, "status": status,
        "admin_note": None, "created_at": now(), "updated_at": now(),
        "history": [{"status": "created", "at": now()}],
    }


db.orders.delete_many({"order_number": {"$regex": "^MGS-TEST"}})
orders = [
    make_order("MGS-TEST01", "paid", p120),            # paid composite qty1 -> readyCount 2
    make_order("MGS-TEST02", "pending_payment", p120),   # pending -> dashboard count + USD 0.60
    make_order("MGS-TEST03", "pending_payment", p120),   # pending -> dashboard count + USD 0.60
    make_order("MGS-TEST04", "paid", p120, qty=2),       # paid composite qty2 -> readyCount 4
]
if p60:
    orders.append(make_order("MGS-TEST05", "paid", p60, qty=3))   # paid direct qty3 -> readyCount 3
    orders.append(make_order("MGS-TEST06", "paid", p60, qty=1))   # paid direct qty1 -> readyCount 1
db.orders.insert_many(orders)
print("inserted orders:", [o["order_number"] for o in orders])
print("expected readyCount: TEST01=2, TEST04=4, TEST05=3, TEST06=1")
