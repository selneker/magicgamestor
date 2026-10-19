import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request
from fastapi.responses import Response

from core.db import db

JWT_ALGORITHM = "HS256"
ACCESS_TTL = 15 * 60
REFRESH_TTL = 30 * 24 * 3600  # « Rester connecté » : session de 30 jours (cookies HttpOnly, révocable)
PUBLIC_USER_FIELDS = {"_id": 0, "password_hash": 0}
SESSION_KIND = "refresh"  # tag des entrées du registre user_sessions créées par set_auth_cookies

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


def create_access_token(user_id: str, auth_version: int = 0, sid: str | None = None) -> str:
    """Access token court ; `sid` le rattache à la session du registre pour une révocation immédiate."""
    payload = {"sub": user_id, "type": "access", "v": auth_version, "exp": datetime.now(timezone.utc) + timedelta(seconds=ACCESS_TTL)}
    if sid:
        payload["sid"] = sid
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, auth_version: int = 0, jti: str | None = None, remember: bool = True) -> str:
    payload = {"sub": user_id, "type": "refresh", "v": auth_version, "remember": bool(remember),
               "exp": datetime.now(timezone.utc) + timedelta(seconds=REFRESH_TTL)}
    if jti:
        payload["jti"] = jti
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


async def set_auth_cookies(response: Response, user_id: str, auth_version: int = 0, remember: bool = True):
    """Emet les cookies de session et enregistre la session de rafraîchissement côté serveur.

    Le refresh token porte un identifiant unique (`jti`) conservé dans user_sessions :
    le logout peut ainsi révoquer précisément cet appareil, tandis qu'un changement de mot
    de passe / blocage / suppression purge déjà toutes les sessions du compte (auth_version
    + delete_many). `remember=False` émet un cookie de session : il disparaît à la fermeture
    du navigateur (appareils partagés).
    """
    now = datetime.now(timezone.utc)
    jti = secrets.token_hex(16)
    await db.user_sessions.delete_many({"kind": SESSION_KIND, "expires_at": {"$lt": now}})  # ménage des sessions expirées
    await db.user_sessions.insert_one({"session_token": jti, "kind": SESSION_KIND, "user_id": user_id,
                                       "auth_version": auth_version, "remember": bool(remember),
                                       "created_at": now.isoformat(),
                                       "expires_at": now + timedelta(seconds=REFRESH_TTL)})
    access = create_access_token(user_id, auth_version, sid=jti)
    refresh = create_refresh_token(user_id, auth_version, jti, remember=remember)
    common = cookie_options()
    response.set_cookie("access_token", access, max_age=ACCESS_TTL if remember else None, **common)
    response.set_cookie("refresh_token", refresh, max_age=REFRESH_TTL if remember else None, **common)
    return {"access_token": access}


async def session_exists(user_id: str, session_id: str) -> bool:
    """La session (jti) existe-t-elle encore dans le registre serveur ?"""
    return bool(await db.user_sessions.find_one(
        {"session_token": session_id, "kind": SESSION_KIND, "user_id": user_id}, {"_id": 1}))


async def refresh_session_valid(user_id: str, jti: str | None) -> bool:
    """Vérifie le registre des sessions. Les refresh tokens émis avant l'existence du
    registre (sans jti) restent valides jusqu'à leur expiration (≤ 7 jours après déploiement)."""
    if not jti:
        return True
    return await session_exists(user_id, jti)


def refresh_remember(request: Request) -> bool:
    """Préférence « Rester connecté » portée par le refresh token signé (legacy : True)."""
    token = request.cookies.get("refresh_token")
    if not token:
        return True
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return True
    if payload.get("type") != "refresh":
        return True
    return bool(payload.get("remember", True))


async def revoke_refresh_session(jti: str | None):
    if jti:
        await db.user_sessions.delete_many({"session_token": jti, "kind": SESSION_KIND})


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
    # Les access tokens émis depuis le registre portent le sid de leur session : le logout
    # supprime cette entrée et révoque donc l'access token immédiatement, sans toucher aux
    # autres appareils. Les tokens legacy sans sid restent valides ≤ 15 min (déploiement).
    sid = payload.get("sid")
    if sid and not await session_exists(payload["sub"], sid):
        return None
    return _active(await db.users.find_one({"user_id": payload["sub"]}, PUBLIC_USER_FIELDS), payload.get("v", 0))


async def _user_from_session(token: str):
    # Seules les sessions opaques historiques (cookie session_token) sont résolues ici :
    # les entrées du registre refresh (kind=refresh, valeur = jti) ne doivent jamais
    # authentifier à elles seules.
    session = await db.user_sessions.find_one({"session_token": token, "kind": {"$ne": SESSION_KIND}}, {"_id": 0})
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
