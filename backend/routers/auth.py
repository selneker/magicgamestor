import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from core.db import db
from core.security import (PUBLIC_USER_FIELDS, JWT_ALGORITHM, clear_auth_cookies, create_access_token,
                           get_current_user, hash_password, new_user_id, set_auth_cookies, verify_password, ACCESS_TTL)

router = APIRouter(prefix="/auth", tags=["auth"])
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
MAX_ATTEMPTS, LOCK_MINUTES = 5, 15


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=2, max_length=60)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionIn(BaseModel):
    session_id: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    phone: str | None = Field(default=None, max_length=20)
    saved_pubg_ids: list[str] | None = None


def _now():
    return datetime.now(timezone.utc)


async def _public_user(query: dict) -> dict:
    doc = await db.users.find_one(query, PUBLIC_USER_FIELDS)
    return {k: v for k, v in doc.items() if k not in ("_id", "password_hash")}


async def _check_lock(identifier: str):
    doc = await db.login_attempts.find_one({"identifier": identifier})
    if doc and doc.get("count", 0) >= MAX_ATTEMPTS:
        locked_until = datetime.fromisoformat(doc["last_at"]) + timedelta(minutes=LOCK_MINUTES)
        if locked_until > _now():
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
        await db.login_attempts.delete_one({"identifier": identifier})


async def _record_failure(identifier: str):
    await db.login_attempts.update_one(
        {"identifier": identifier}, {"$inc": {"count": 1}, "$set": {"last_at": _now().isoformat()}}, upsert=True)


@router.post("/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = {
        "user_id": new_user_id(), "email": email, "name": body.name.strip(), "role": "customer",
        "password_hash": hash_password(body.password), "auth_provider": "password", "picture": None,
        "phone": None, "saved_pubg_ids": [], "created_at": _now().isoformat(),
    }
    await db.users.insert_one(user)
    set_auth_cookies(response, user["user_id"])
    user.pop("_id", None); user.pop("password_hash", None)
    return {"user": user, "access_token": create_access_token(user["user_id"])}


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    identifier = email
    await _check_lock(identifier)
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        await _record_failure(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_one({"identifier": identifier})
    set_auth_cookies(response, user["user_id"])
    user.pop("_id", None); user.pop("password_hash", None)
    return {"user": user, "access_token": create_access_token(user["user_id"])}


@router.post("/google/session")
async def google_session(body: GoogleSessionIn, response: Response):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
    if r.is_error:
        raise HTTPException(status_code=401, detail="Invalid Google session")
    data = r.json()
    email = data["email"].lower()
    user = await db.users.find_one({"email": email})
    if user:
        await db.users.update_one({"email": email}, {"$set": {"picture": data.get("picture"), "name": user.get("name") or data.get("name")}})
    else:
        user = {
            "user_id": new_user_id(), "email": email, "name": data.get("name") or email.split("@")[0], "role": "customer",
            "auth_provider": "google", "picture": data.get("picture"), "phone": None, "saved_pubg_ids": [],
            "created_at": _now().isoformat(),
        }
        await db.users.insert_one(user)
    session_token = data["session_token"]
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {"user_id": user["user_id"], "expires_at": (_now() + timedelta(days=7)).isoformat(), "created_at": _now().isoformat()}},
        upsert=True)
    response.set_cookie("session_token", session_token, httponly=True, secure=True, samesite="none", path="/", max_age=7 * 24 * 3600)
    return {"user": await _public_user({"email": email})}


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    access = create_access_token(payload["sub"])
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", path="/", max_age=ACCESS_TTL)
    return {"access_token": access}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user


@router.patch("/me")
async def update_me(body: ProfileIn, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "saved_pubg_ids" in updates:
        updates["saved_pubg_ids"] = [p for p in dict.fromkeys(updates["saved_pubg_ids"]) if p.isdigit()][:10]
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    return await _public_user({"user_id": user["user_id"]})


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    clear_auth_cookies(response)
    return {"ok": True}
