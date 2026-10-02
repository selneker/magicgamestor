"""Admin users management: listing, detail, block/unblock, role grant/revoke, permissions, anonymisation.

Authorization is centralised in core.security (require_permission / require_super_admin):
- users.manage  -> read, block/unblock, delete (anonymise)
- role & permissions changes -> super admin only
- the super admin account itself can never be blocked, deleted, demoted or edited by anyone else
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from core.audit import audit
from core.db import db
from core.security import (ADMIN_ROLES, PERMISSIONS, SUPER_ADMIN, require_permission, require_super_admin,
                           sanitize_permissions)
from pydantic import BaseModel, Field

router = APIRouter(tags=["admin-users"])

LIST_FIELDS = {
    "_id": 0, "user_id": 1, "name": 1, "email": 1, "email_verified": 1, "auth_provider": 1, "phone": 1,
    "saved_pubg_ids": 1, "created_at": 1, "last_seen_at": 1, "blocked": 1, "role": 1, "permissions": 1, "loyalty": 1,
}
DETAIL_FIELDS = {**LIST_FIELDS, "granted_by": 1, "granted_at": 1, "blocked_at": 1, "deleted_at": 1}


class StatusIn(BaseModel):
    blocked: bool


class RoleIn(BaseModel):
    role: str = Field(pattern=r"^(customer|admin)$")
    permissions: list[str] | None = None


class PermissionsIn(BaseModel):
    permissions: list[str]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _shape(doc: dict) -> dict:
    loyalty = doc.get("loyalty") or {}
    earned, promo = int(loyalty.get("earned", 0)), int(loyalty.get("promo", 0))
    return {
        **{k: doc.get(k) for k in ("user_id", "name", "email", "email_verified", "auth_provider", "phone",
                                   "saved_pubg_ids", "created_at", "last_seen_at", "role", "granted_by", "granted_at",
                                   "blocked_at", "deleted_at")},
        "blocked": bool(doc.get("blocked")),
        "permissions": doc.get("permissions") or [],
        "loyalty": {"earned": earned, "promo": promo, "balance": earned + promo},
    }


async def _target(user_id: str) -> dict:
    doc = await db.users.find_one({"user_id": user_id}, DETAIL_FIELDS)
    if not doc:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return doc


def _protect_super_admin(target: dict):
    if target.get("role") == SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Le compte super admin est protégé.")


@router.get("/admin/users")
async def list_users(
    admin=Depends(require_permission("users.manage")),
    search: str | None = None,
    role: str | None = Query(default=None, pattern=r"^(customer|admin|super_admin)$"),
    status: str | None = Query(default=None, pattern=r"^(active|blocked)$"),
    email_verified: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    query: dict = {"deleted_at": {"$exists": False}}
    if search:
        needle = search.strip()
        query["$or"] = [
            {"name": {"$regex": needle, "$options": "i"}},
            {"email": {"$regex": needle, "$options": "i"}},
            {"phone": {"$regex": needle, "$options": "i"}},
            {"saved_pubg_ids": needle},
        ]
    if role:
        query["role"] = role
    if status:
        query["blocked"] = status == "blocked"
    if email_verified is not None:
        query["email_verified"] = email_verified
    total = await db.users.count_documents(query)
    cursor = db.users.find(query, LIST_FIELDS).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    return {"items": [_shape(d) async for d in cursor], "total": total, "page": page, "page_size": page_size,
            "permissions_available": list(PERMISSIONS)}


@router.get("/admin/users/{user_id}")
async def user_detail(user_id: str, admin=Depends(require_permission("users.manage"))):
    doc = await _target(user_id)
    orders = await db.orders.count_documents({"user_id": user_id})
    recent = [{k: o.get(k) for k in ("order_number", "status", "total", "payment_method", "created_at")}
              async for o in db.orders.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(10)]
    last = await db.orders.find_one({"user_id": user_id}, {"_id": 0, "pseudo": 1}, sort=[("created_at", -1)])
    return {**_shape(doc), "orders_count": orders, "recent_orders": recent, "pubg_pseudo": (last or {}).get("pseudo")}


@router.patch("/admin/users/{user_id}/status")
async def update_status(user_id: str, body: StatusIn, admin=Depends(require_permission("users.manage"))):
    target = await _target(user_id)
    _protect_super_admin(target)
    if target["user_id"] == admin["user_id"]:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas modifier votre propre statut.")
    if body.blocked and target.get("role") in ADMIN_ROLES and admin.get("role") != SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Seul le super admin peut bloquer un administrateur.")
    if body.blocked and target.get("role") in ADMIN_ROLES:
        await _assert_admin_remains(target["user_id"])
    updates = {"blocked": body.blocked, "blocked_at": _now() if body.blocked else None}
    await db.users.update_one({"user_id": user_id}, {"$set": updates, "$inc": {"auth_version": 1}})
    if body.blocked:
        await db.user_sessions.delete_many({"user_id": user_id})
    await audit("user.blocked" if body.blocked else "user.unblocked", admin["user_id"], user_id,
                {"old": bool(target.get("blocked")), "new": body.blocked})
    return _shape(await _target(user_id))


async def _assert_admin_remains(excluded_user_id: str):
    remaining = await db.users.count_documents(
        {"role": {"$in": list(ADMIN_ROLES)}, "user_id": {"$ne": excluded_user_id},
         "blocked": {"$ne": True}, "deleted_at": {"$exists": False}})
    if remaining == 0:
        raise HTTPException(status_code=409, detail="Le système doit conserver au moins un administrateur actif.")


@router.patch("/admin/users/{user_id}/role")
async def update_role(user_id: str, body: RoleIn, admin=Depends(require_super_admin)):
    target = await _target(user_id)
    _protect_super_admin(target)
    if target["user_id"] == admin["user_id"]:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas modifier votre propre rôle.")
    old_role = target.get("role") or "customer"
    if body.role == old_role:
        return _shape(await _target(user_id))
    if body.role == "customer":
        await _assert_admin_remains(user_id)
        updates = {"role": "customer", "permissions": [], "granted_by": None, "granted_at": None}
        action = "admin.role_revoked"
    else:
        updates = {"role": "admin", "permissions": sanitize_permissions(body.permissions),
                   "granted_by": admin["user_id"], "granted_at": _now()}
        action = "admin.role_granted"
    await db.users.update_one({"user_id": user_id}, {"$set": updates, "$inc": {"auth_version": 1}})
    await db.user_sessions.delete_many({"user_id": user_id})
    await audit(action, admin["user_id"], user_id,
                {"old_role": old_role, "new_role": updates["role"], "permissions": updates["permissions"]})
    return _shape(await _target(user_id))


@router.patch("/admin/users/{user_id}/permissions")
async def update_permissions(user_id: str, body: PermissionsIn, admin=Depends(require_super_admin)):
    target = await _target(user_id)
    _protect_super_admin(target)
    if target.get("role") != "admin":
        raise HTTPException(status_code=409, detail="Seul un administrateur délégué possède des permissions.")
    granted = sanitize_permissions(body.permissions)  # orders.delete and unknown values are dropped
    await db.users.update_one({"user_id": user_id}, {"$set": {"permissions": granted, "granted_by": admin["user_id"],
                                                             "granted_at": _now()}, "$inc": {"auth_version": 1}})
    await db.user_sessions.delete_many({"user_id": user_id})
    await audit("admin.permissions_changed", admin["user_id"], user_id,
                {"old": target.get("permissions") or [], "new": granted})
    return _shape(await _target(user_id))


@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_permission("users.manage"))):
    """Anonymises the account (financial/audit history preserved) and revokes every right immediately."""
    target = await _target(user_id)
    _protect_super_admin(target)
    if target["user_id"] == admin["user_id"]:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas supprimer votre propre compte ici.")
    if target.get("role") in ADMIN_ROLES:
        if admin.get("role") != SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Seul le super admin peut supprimer un administrateur.")
        await _assert_admin_remains(user_id)
    await db.users.update_one({"user_id": user_id}, {
        "$set": {"email": f"deleted_{user_id}@anonyme.invalid", "name": "Compte supprimé", "phone": None,
                 "picture": None, "saved_pubg_ids": [], "password_hash": None, "google_sub": None,
                 "auth_provider": "deleted", "email_verified": False, "role": "customer", "permissions": [],
                 "blocked": True, "deleted_at": _now()}, "$inc": {"auth_version": 1}})
    await db.orders.update_many({"user_id": user_id}, {"$set": {"email": None}})  # transactions kept, PII removed
    await db.user_sessions.delete_many({"user_id": user_id})
    await db.auth_tokens.delete_many({"user_id": user_id})
    await audit("user.anonymized", admin["user_id"], user_id,
                {"old_role": target.get("role") or "customer", "orders_kept": await db.orders.count_documents({"user_id": user_id})})
    return {"ok": True}
