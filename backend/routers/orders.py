import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, field_validator

from core.db import db
from core.security import get_current_user, get_optional_user, require_admin
from services.push import notify_new_order

router = APIRouter(tags=["orders"])
PUBLIC = {"_id": 0}
STATUSES = ["pending_payment", "awaiting_verification", "paid", "delivered", "cancelled", "failed"]
SUBSCRIPTION_TYPES = ("prime", "prime_plus")
SUBSCRIPTION_LABELS = {"prime": "Prime", "prime_plus": "Prime+"}
INACTIVE_STATUSES = ("cancelled", "failed")
TRANSITIONS = {
    "pending_payment": {"paid", "cancelled", "failed"},
    "awaiting_verification": {"paid", "delivered", "cancelled", "failed"},
    "paid": {"delivered", "cancelled"},
    "failed": {"paid", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
}


class OrderItemIn(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, le=20)


class OrderIn(BaseModel):
    pubg_id: str
    pseudo: str = Field(min_length=2, max_length=40)
    items: list[OrderItemIn] = Field(min_length=1, max_length=20)
    payment_method: str = Field(pattern=r"^(mvola|orange|manual)$")
    payment_phone: str | None = None
    manual_reference: str | None = Field(default=None, max_length=60)
    email: str | None = None

    @field_validator("pubg_id")
    @classmethod
    def valid_pubg(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or not (9 <= len(v) <= 13):
            raise ValueError("PUBG ID must be 9 to 13 digits")
        return v

    @field_validator("payment_phone")
    @classmethod
    def valid_phone(cls, v):
        if v is None:
            return v
        digits = "".join(ch for ch in v if ch.isdigit())
        if len(digits) < 10:
            raise ValueError("Invalid phone number")
        return digits[-10:] if len(digits) > 10 else digits


class StatusIn(BaseModel):
    status: str = Field(pattern="^(" + "|".join(STATUSES) + ")$")
    admin_note: str | None = Field(default=None, max_length=300)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _order_number():
    return "MGS-" + secrets.token_hex(3).upper()


def subscription_expiry(created_at: str, months: int) -> str:
    start = datetime.fromisoformat(created_at)
    month_index = start.month - 1 + int(months or 1)
    year, month = start.year + month_index // 12, month_index % 12 + 1
    day = min(start.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return start.replace(year=year, month=month, day=day).isoformat()


def _blocked_message(sub_type: str, expires_at: str) -> str:
    label = SUBSCRIPTION_LABELS[sub_type]
    until = datetime.fromisoformat(expires_at).strftime("%d/%m/%Y")
    return f"Un abonnement {label} est déjà actif ou en attente pour ce PUBG ID (jusqu’au {until}). Un seul {label} actif par PUBG ID."


async def release_subscription_locks(order_id: str):
    await db.subscription_locks.delete_many({"order_id": order_id})


async def reserve_subscription(pubg_id: str, sub_type: str, order: dict, months: int):
    """Atomic per-(pubg_id, type) reservation via the unique index on subscription_locks."""
    expires_at = subscription_expiry(order["created_at"], months)
    for _ in range(3):
        try:
            await db.subscription_locks.insert_one({"pubg_id": pubg_id, "type": sub_type, "order_id": order["id"],
                                                    "expires_at": expires_at, "created_at": _now()})
            return
        except DuplicateKeyError:
            existing = await db.subscription_locks.find_one({"pubg_id": pubg_id, "type": sub_type})
            if not existing:
                continue
            holder = await db.orders.find_one({"id": existing["order_id"]}, {"status": 1})
            stale = not holder or holder["status"] in INACTIVE_STATUSES or existing["expires_at"] <= _now()
            if not stale:
                raise HTTPException(status_code=409, detail=_blocked_message(sub_type, existing["expires_at"]))
            await db.subscription_locks.delete_one({"_id": existing["_id"]})
    raise HTTPException(status_code=409, detail="Réessayez dans un instant.")


async def active_subscriptions(pubg_id: str) -> dict:
    result = {}
    async for lock in db.subscription_locks.find({"pubg_id": pubg_id}):
        holder = await db.orders.find_one({"id": lock["order_id"]}, {"status": 1})
        if holder and holder["status"] not in INACTIVE_STATUSES and lock["expires_at"] > _now():
            result[lock["type"]] = {"expires_at": lock["expires_at"], "status": holder["status"], "order_id": lock["order_id"]}
    return result


async def backfill_subscription_locks():
    """One-off: register still-valid legacy subscription orders that predate the locks collection."""
    query = {"items.type": {"$in": list(SUBSCRIPTION_TYPES)}, "status": {"$nin": list(INACTIVE_STATUSES)}}
    async for order in db.orders.find(query, PUBLIC).sort("created_at", 1):
        for item in order["items"]:
            if item["type"] not in SUBSCRIPTION_TYPES:
                continue
            months = item.get("duration_months")
            if months is None:
                product = await db.products.find_one({"id": item["product_id"]}, {"duration_months": 1})
                months = (product or {}).get("duration_months") or 1
            expires_at = subscription_expiry(order["created_at"], months)
            if expires_at <= _now():
                continue
            try:
                await db.subscription_locks.insert_one({"pubg_id": order["pubg_id"], "type": item["type"], "order_id": order["id"],
                                                        "expires_at": expires_at, "created_at": _now()})
            except DuplicateKeyError:
                pass


@router.post("/orders", status_code=201)
async def create_order(body: OrderIn, background_tasks: BackgroundTasks, user=Depends(get_optional_user)):
    if body.payment_method in ("mvola", "orange") and not body.payment_phone:
        raise HTTPException(status_code=400, detail="Payment phone number is required")
    if body.payment_method == "manual" and not body.manual_reference:
        raise HTTPException(status_code=400, detail="Transaction reference is required")
    ids = [i.product_id for i in body.items]
    products = {p["id"]: p for p in await db.products.find({"id": {"$in": ids}, "active": True}, PUBLIC).to_list(100)}
    if len(products) != len(set(ids)):
        raise HTTPException(status_code=400, detail="One or more products are unavailable")
    items, total = [], 0
    for line in body.items:
        p = products[line.product_id]
        items.append({"product_id": p["id"], "slug": p["slug"], "name": p["name"], "type": p["type"],
                      "duration_months": p.get("duration_months"),
                      "unit_price": p["price"], "quantity": line.quantity, "line_total": p["price"] * line.quantity})
        total += p["price"] * line.quantity
    subscriptions = [i for i in items if i["type"] in SUBSCRIPTION_TYPES]
    for sub_type in SUBSCRIPTION_TYPES:
        same = [i for i in subscriptions if i["type"] == sub_type]
        if len(same) > 1 or (same and same[0]["quantity"] > 1):
            raise HTTPException(status_code=400, detail=f"Un seul abonnement {SUBSCRIPTION_LABELS[sub_type]} par commande et par PUBG ID.")
    order = {
        "id": str(uuid.uuid4()), "order_number": _order_number(), "user_id": user["user_id"] if user else None,
        "email": (user or {}).get("email") or body.email, "pubg_id": body.pubg_id, "pseudo": body.pseudo.strip(),
        "items": items, "total": total, "currency": "Ar", "payment_method": body.payment_method,
        "payment_phone": body.payment_phone, "manual_reference": body.manual_reference,
        "status": "awaiting_verification" if body.payment_method == "manual" else "pending_payment",
        "admin_note": None, "created_at": _now(), "updated_at": _now(),
        "history": [{"status": "created", "at": _now()}],
    }
    try:
        for item in subscriptions:
            await reserve_subscription(body.pubg_id, item["type"], order, item.get("duration_months") or 1)
        await db.orders.insert_one(order)
    except Exception:
        await release_subscription_locks(order["id"])
        raise
    background_tasks.add_task(notify_new_order, order)
    if user and body.pubg_id not in user.get("saved_pubg_ids", []):
        await db.users.update_one({"user_id": user["user_id"]}, {"$push": {"saved_pubg_ids": {"$each": [body.pubg_id], "$slice": -10}}})
    order.pop("_id", None)
    return order


@router.get("/orders/me")
async def my_orders(user=Depends(get_current_user)):
    return await db.orders.find({"user_id": user["user_id"]}, PUBLIC).sort("created_at", -1).to_list(200)


@router.get("/orders/subscriptions")
async def subscription_status(pubg_id: str = Query(min_length=9, max_length=13)):
    return {"pubg_id": pubg_id.strip(), "active": await active_subscriptions(pubg_id.strip())}


@router.get("/orders/track")
async def track_order(order_number: str = Query(min_length=6), pubg_id: str = Query(min_length=9)):
    order = await db.orders.find_one({"order_number": order_number.upper().strip(), "pubg_id": pubg_id.strip()}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.get("/orders/{order_id}")
async def get_order(order_id: str, user=Depends(get_optional_user)):
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("user_id") and (not user or (user["user_id"] != order["user_id"] and user.get("role") != "admin")):
        raise HTTPException(status_code=403, detail="Forbidden")
    return order


# ---------- Admin ----------
@router.get("/admin/orders", dependencies=[Depends(require_admin)])
async def admin_orders(status: str | None = None, method: str | None = None, q: str | None = None, limit: int = 200):
    query = {}
    if status and status != "all":
        query["status"] = status
    if method and method != "all":
        query["payment_method"] = method
    if q:
        query["$or"] = [{"pubg_id": {"$regex": q}}, {"pseudo": {"$regex": q, "$options": "i"}},
                        {"order_number": {"$regex": q.upper()}}, {"email": {"$regex": q, "$options": "i"}}]
    return await db.orders.find(query, PUBLIC).sort("created_at", -1).to_list(min(limit, 1000))


@router.patch("/admin/orders/{order_id}", dependencies=[Depends(require_admin)])
async def admin_update_order(order_id: str, body: StatusIn):
    current = await db.orders.find_one({"id": order_id}, {"status": 1})
    if not current:
        raise HTTPException(status_code=404, detail="Order not found")
    if body.status != current["status"] and body.status not in TRANSITIONS[current["status"]]:
        raise HTTPException(status_code=409, detail=f"Transition impossible : {current['status']} → {body.status}.")
    updates = {"status": body.status, "updated_at": _now()}
    if body.admin_note is not None:
        updates["admin_note"] = body.admin_note
    push = {"history": {"status": body.status, "at": _now()}} if body.status != current["status"] else None
    res = await db.orders.update_one({"id": order_id, "status": current["status"]}, {"$set": updates, **({"$push": push} if push else {})})
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail="La commande a changé, rechargez la liste.")
    if body.status in INACTIVE_STATUSES:
        await release_subscription_locks(order_id)
    return await db.orders.find_one({"id": order_id}, PUBLIC)


@router.delete("/admin/orders/{order_id}", dependencies=[Depends(require_admin)])
async def admin_delete_order(order_id: str):
    res = await db.orders.delete_one({"id": order_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    await db.payments.delete_one({"order_id": order_id})
    await release_subscription_locks(order_id)
    return {"ok": True}


@router.get("/admin/stats", dependencies=[Depends(require_admin)])
async def admin_stats():
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}}]
    by_status = {row["_id"]: row for row in await db.orders.aggregate(pipeline).to_list(20)}
    revenue = sum(row["revenue"] for s, row in by_status.items() if s in ("paid", "delivered"))
    by_method = await db.orders.aggregate([{"$group": {"_id": "$payment_method", "count": {"$sum": 1}}}]).to_list(10)
    daily = await db.orders.aggregate([
        {"$match": {"status": {"$in": ["paid", "delivered"]}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "revenue": {"$sum": "$total"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": -1}}, {"$limit": 14},
    ]).to_list(14)
    top = await db.orders.aggregate([
        {"$unwind": "$items"}, {"$group": {"_id": "$items.name", "qty": {"$sum": "$items.quantity"}}},
        {"$sort": {"qty": -1}}, {"$limit": 5},
    ]).to_list(5)
    return {
        "total_orders": sum(r["count"] for r in by_status.values()), "revenue": revenue,
        "status_count": {s: by_status.get(s, {}).get("count", 0) for s in STATUSES},
        "by_method": {r["_id"]: r["count"] for r in by_method}, "daily": list(reversed(daily)), "top_products": top,
        "customers": await db.users.count_documents({"role": "customer"}),
    }


@router.get("/admin/export", dependencies=[Depends(require_admin)])
async def admin_export():
    orders = await db.orders.find({}, PUBLIC).sort("created_at", -1).to_list(5000)
    header = "order_number,date,status,pubg_id,pseudo,items,total,payment_method,payment_phone,manual_reference,email\n"
    rows = []
    for o in orders:
        items = " | ".join(f"{i['quantity']}x {i['name']}" for i in o["items"])
        rows.append(",".join('"' + str(v or "").replace('"', "'") + '"' for v in [
            o["order_number"], o["created_at"], o["status"], o["pubg_id"], o["pseudo"], items, o["total"],
            o["payment_method"], o.get("payment_phone"), o.get("manual_reference"), o.get("email")]))
    from fastapi.responses import Response
    return Response(content=header + "\n".join(rows), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=orders-{datetime.now(timezone.utc).date()}.csv"})
