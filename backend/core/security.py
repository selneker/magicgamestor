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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "access", "exp": datetime.now(timezone.utc) + timedelta(seconds=ACCESS_TTL)}
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "refresh", "exp": datetime.now(timezone.utc) + timedelta(seconds=REFRESH_TTL)}
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


def set_auth_cookies(response: Response, user_id: str):
    common = cookie_options()
    response.set_cookie("access_token", create_access_token(user_id), max_age=ACCESS_TTL, **common)
    response.set_cookie("refresh_token", create_refresh_token(user_id), max_age=REFRESH_TTL, **common)


def clear_auth_cookies(response: Response):
    common = cookie_options()
    common.pop("httponly", None)
    for name in ("access_token", "refresh_token", "session_token"):
        response.delete_cookie(name, **common)


def new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


async def _user_from_jwt(token: str):
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "access" or not payload.get("sub"):
        return None
    return await db.users.find_one({"user_id": payload["sub"]}, PUBLIC_USER_FIELDS)


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
    return await db.users.find_one({"user_id": session["user_id"]}, PUBLIC_USER_FIELDS)


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
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
