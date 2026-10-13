import os
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request
from fastapi.responses import Response

from core.db import db

JWT_ALGORITHM = "HS256"
ACCESS_TTL = 15 * 60
REFRESH_TTL = 7 * 24 * 3600
PUBLIC_USER_FIELDS = {"_id": 0, "password_hash": 0}

SUPER_ADMIN = "super_admin"
ADMIN_ROLES = ("admin", SUPER_ADMIN)
# Grantable permissions for a delegated admin (orders deletion is deliberately absent).
PERMISSIONS = ("users.manage", "orders.manage", "loyalty.manage", "catalog.manage", "events.manage", "chat.manage")
# Reserved to the super admin, never attributable to a delegated admin.
NEVER_GRANTABLE = ("orders.delete",)


def is_super_admin(user: dict | None) -> bool:
    return bool(user) and user.get("role") == SUPER_ADMIN


def has_permission(user: dict | None, permission: str) -> bool:
    if not user or user.get("role") not in ADMIN_ROLES:
        return False
    if is_super_admin(user):
        return True
    if permission in NEVER_GRANTABLE:
        return False
    return permission in (user.get("permissions") or [])


def sanitize_permissions(values) -> list[str]:
    return [p for p in PERMISSIONS if p in set(values or [])]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, auth_version: int = 0) -> str:
    payload = {"sub": user_id, "type": "access", "v": auth_version, "exp": datetime.now(timezone.utc) + timedelta(seconds=ACCESS_TTL)}
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, auth_version: int = 0) -> str:
    payload = {"sub": user_id, "type": "refresh", "v": auth_version, "exp": datetime.now(timezone.utc) + timedelta(seconds=REFRESH_TTL)}
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def cookie_options() -> dict:
    """Cookie scope for the deployed domains.

    With COOKIE_DOMAIN=.magicgame.store the cookie is shared by magicgame.store and
    api.magicgame.store as a first-party cookie, so SameSite=Lax is enough and the
    browser no longer drops it as a blocked third-party cookie. Without that env var
    (preview/local, different registrable domains) we keep the cross-site settings.
    """
    domain = (os.environ.get("COOKIE_DOMAIN") or "").strip() or None
    samesite = (os.environ.get("COOKIE_SAMESITE") or ("lax" if domain else "none")).strip().lower()
    options = dict(httponly=True, secure=True, samesite=samesite, path="/")
    if domain:
        options["domain"] = domain
    return options


def set_auth_cookies(response: Response, user_id: str, auth_version: int = 0):
    common = cookie_options()
    response.set_cookie("access_token", create_access_token(user_id, auth_version), max_age=ACCESS_TTL, **common)
    response.set_cookie("refresh_token", create_refresh_token(user_id, auth_version), max_age=REFRESH_TTL, **common)


def clear_auth_cookies(response: Response):
    common = cookie_options()
    common.pop("httponly", None)
    for name in ("access_token", "refresh_token", "session_token"):
        response.delete_cookie(name, **common)


def new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


def _active(user: dict | None, token_version: int | None = None):
    """Deleted/anonymised or blocked accounts and tokens issued before a password reset are rejected."""
    if not user or user.get("deleted_at") or user.get("blocked"):
        return None
    if token_version is not None and int(token_version) != int(user.get("auth_version", 0)):
        return None
    return user


async def _user_from_jwt(token: str):
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "access" or not payload.get("sub"):
        return None
    return _active(await db.users.find_one({"user_id": payload["sub"]}, PUBLIC_USER_FIELDS), payload.get("v", 0))


async def _user_from_session(token: str):
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None
    return _active(await db.users.find_one({"user_id": session["user_id"]}, PUBLIC_USER_FIELDS))


async def resolve_user(request: Request):
    access = request.cookies.get("access_token")
    if access:
        user = await _user_from_jwt(access)
        if user:
            return user
    session = request.cookies.get("session_token")
    if session:
        user = await _user_from_session(session)
        if user:
            return user
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        return await _user_from_jwt(token) or await _user_from_session(token)
    return None


async def get_current_user(request: Request) -> dict:
    user = await resolve_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_optional_user(request: Request):
    return await resolve_user(request)


async def require_admin(request: Request) -> dict:
    """Any staff account (delegated admin or super admin). Blocked/deleted users never resolve."""
    user = await get_current_user(request)
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_super_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user


def require_permission(permission: str):
    """Central authorization dependency: super admin passes, delegated admin needs the permission."""
    if permission in NEVER_GRANTABLE:
        async def super_only(request: Request) -> dict:
            return await require_super_admin(request)
        return super_only

    async def dependency(request: Request) -> dict:
        user = await require_admin(request)
        if not has_permission(user, permission):
            raise HTTPException(status_code=403, detail="Permission refusée")
        return user
    return dependency
