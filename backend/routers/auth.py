import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from core import ratelimit
from core.audit import audit
from core.db import db
from core.security import (ADMIN_ROLES, PUBLIC_USER_FIELDS, JWT_ALGORITHM, clear_auth_cookies, cookie_options, create_access_token,
                           get_current_user, hash_password, new_user_id, set_auth_cookies, verify_password, ACCESS_TTL)
from services import mailer

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("mgs.auth")
MAX_ATTEMPTS, LOCK_MINUTES = 5, 15
VERIFY_TTL_H, RESET_TTL_MIN = 24, 30
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=2, max_length=60)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    phone: str | None = Field(default=None, max_length=20)
    saved_pubg_ids: list[str] | None = None


class TokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(TokenIn):
    password: str = Field(min_length=8, max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str | None = None
    new_password: str = Field(min_length=8, max_length=128)


class DeleteIn(BaseModel):
    password: str | None = None
    confirmation: str = Field(min_length=1, max_length=20)


def _now():
    return datetime.now(timezone.utc)


def _frontend() -> str:
    return (os.environ.get("FRONTEND_URL") or "").rstrip("/")


def _backend(request: Request) -> str:
    return (os.environ.get("BACKEND_PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL") or str(request.base_url).rstrip("/"))


def _public_dict(user: dict) -> dict:
    return {k: v for k, v in user.items() if k not in ("_id", "password_hash")}


async def _public_user(query: dict) -> dict:
    return _public_dict(await db.users.find_one(query, PUBLIC_USER_FIELDS))


def _auth_response(response: Response, user: dict) -> dict:
    version = int(user.get("auth_version", 0))
    set_auth_cookies(response, user["user_id"], version)
    return {"user": _public_dict(user), "access_token": create_access_token(user["user_id"], version)}


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


# ---------- One-time tokens (stored hashed) ----------
def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def issue_token(user_id: str, purpose: str, ttl: timedelta) -> str:
    await db.auth_tokens.delete_many({"user_id": user_id, "purpose": purpose})  # invalidate older requests
    token = secrets.token_urlsafe(32)
    await db.auth_tokens.insert_one({"token_hash": _hash(token), "user_id": user_id, "purpose": purpose,
                                     "expires_at": _now() + ttl, "created_at": _now().isoformat(), "used_at": None})
    return token


async def consume_token(token: str, purpose: str) -> dict:
    doc = await db.auth_tokens.find_one_and_update(
        {"token_hash": _hash(token), "purpose": purpose, "used_at": None, "expires_at": {"$gt": _now()}},
        {"$set": {"used_at": _now().isoformat()}})
    if not doc:
        raise HTTPException(status_code=400, detail="Lien invalide ou expiré.")
    return doc


async def send_verification_email(user: dict):
    token = await issue_token(user["user_id"], "verify_email", timedelta(hours=VERIFY_TTL_H))
    await mailer.send_verification(user["email"], user.get("name") or "", token)


# ---------- Email / password ----------
@router.post("/register")
async def register(body: RegisterIn, request: Request, response: Response, background: BackgroundTasks):
    ratelimit.check(f"register:ip:{ratelimit.client_ip(request)}", ratelimit.setting("REGISTER_PER_HOUR_PER_IP", 10), 3600)
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = {
        "user_id": new_user_id(), "email": email, "name": body.name.strip(), "role": "customer",
        "password_hash": hash_password(body.password), "auth_provider": "password", "picture": None,
        "phone": None, "saved_pubg_ids": [], "email_verified": False, "auth_version": 0,
        "loyalty": {"earned": 0, "promo": 0}, "created_at": _now().isoformat(),
    }
    await db.users.insert_one(user)
    background.add_task(send_verification_email, user)
    return _auth_response(response, user)


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    ratelimit.check(f"login:ip:{ratelimit.client_ip(request)}", ratelimit.setting("LOGIN_PER_10MIN_PER_IP", 30), 600)
    await _check_lock(email)
    user = await db.users.find_one({"email": email})
    if not user or user.get("deleted_at") or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        await _record_failure(email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("blocked"):
        raise HTTPException(status_code=403, detail="Ce compte est bloqué. Contactez le support.")
    await db.login_attempts.delete_one({"identifier": email})
    return _auth_response(response, user)


@router.post("/verify-email")
async def verify_email(body: TokenIn):
    doc = await consume_token(body.token, "verify_email")
    await db.users.update_one({"user_id": doc["user_id"]}, {"$set": {"email_verified": True, "email_verified_at": _now().isoformat()}})
    await audit("auth.email_verified", doc["user_id"], doc["user_id"])
    return {"ok": True}


@router.post("/resend-verification")
async def resend_verification(request: Request, background: BackgroundTasks, user=Depends(get_current_user)):
    if user.get("email_verified"):
        return {"ok": True, "already_verified": True}
    ratelimit.check(f"verify:user:{user['user_id']}", ratelimit.setting("VERIFY_EMAILS_PER_HOUR", 3), 3600,
                    "Email déjà envoyé. Réessayez dans une heure.")
    ratelimit.check(f"verify:ip:{ratelimit.client_ip(request)}", ratelimit.setting("AUTH_EMAILS_PER_HOUR_PER_IP", 10), 3600)
    background.add_task(send_verification_email, user)
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn, request: Request, background: BackgroundTasks):
    ratelimit.check(f"forgot:ip:{ratelimit.client_ip(request)}", ratelimit.setting("AUTH_EMAILS_PER_HOUR_PER_IP", 10), 3600)
    email = body.email.lower()
    ratelimit.check(f"forgot:email:{email}", ratelimit.setting("FORGOT_PER_HOUR_PER_EMAIL", 3), 3600)
    user = await db.users.find_one({"email": email, "deleted_at": {"$exists": False}})
    if user and user.get("password_hash"):
        async def _send():
            token = await issue_token(user["user_id"], "reset_password", timedelta(minutes=RESET_TTL_MIN))
            await mailer.send_password_reset(user["email"], user.get("name") or "", token)
        background.add_task(_send)
    await audit("auth.forgot_password", f"ip:{ratelimit.client_ip(request)}", None, {"known": bool(user)})
    return {"ok": True}  # identical response whether or not the account exists


async def _rotate_credentials(user: dict, new_password: str, actor: str):
    await db.users.update_one({"user_id": user["user_id"]}, {
        "$set": {"password_hash": hash_password(new_password), "password_changed_at": _now().isoformat()}, "$inc": {"auth_version": 1}})
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    await db.login_attempts.delete_one({"identifier": user["email"]})
    await db.auth_tokens.delete_many({"user_id": user["user_id"], "purpose": "reset_password"})
    await audit("auth.password_changed", actor, user["user_id"])
    await mailer.send_password_changed(user["email"], user.get("name") or "")


@router.post("/reset-password")
async def reset_password(body: ResetIn, request: Request):
    ratelimit.check(f"reset:ip:{ratelimit.client_ip(request)}", ratelimit.setting("RESET_PER_HOUR_PER_IP", 10), 3600)
    doc = await consume_token(body.token, "reset_password")
    user = await db.users.find_one({"user_id": doc["user_id"], "deleted_at": {"$exists": False}})
    if not user:
        raise HTTPException(status_code=400, detail="Lien invalide ou expiré.")
    await _rotate_credentials(user, body.password, "reset_link")
    return {"ok": True}


@router.post("/change-password")
async def change_password(body: ChangePasswordIn, response: Response, user=Depends(get_current_user)):
    full = await db.users.find_one({"user_id": user["user_id"]})
    if full.get("password_hash"):
        if not body.current_password or not verify_password(body.current_password, full["password_hash"]):
            raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect.")
    await _rotate_credentials(full, body.new_password, user["user_id"])
    updated = await db.users.find_one({"user_id": user["user_id"]})
    return _auth_response(response, updated)


# ---------- Google OAuth 2.0 / OIDC owned by Magic Game Store ----------
def google_enabled() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def _safe_return_to(value: str | None) -> str:
    return value if value and re.fullmatch(r"/[A-Za-z0-9_\-/?=&%.]*", value) and not value.startswith("//") else "/compte"


@router.get("/google/config")
async def google_config():
    return {"enabled": google_enabled()}


@router.get("/google/start")
async def google_start(request: Request, return_to: str | None = None):
    if not google_enabled():
        raise HTTPException(status_code=503, detail="Google login is not configured")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    await db.oauth_states.insert_one({"state": state, "nonce": nonce, "return_to": _safe_return_to(return_to), "created_at": _now()})
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": f"{_backend(request)}/api/auth/google/callback",
        "response_type": "code", "scope": "openid email profile", "state": state, "nonce": nonce,
        "access_type": "online", "prompt": "select_account",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)


def _decode_id_token(id_token: str, nonce: str) -> dict:
    # The id_token comes straight from Google's token endpoint over TLS (client-secret authenticated),
    # so the signature is trusted by construction; we still validate the standard OIDC claims.
    claims = jwt.decode(id_token, options={"verify_signature": False, "verify_exp": True, "verify_aud": False})
    if claims.get("iss") not in GOOGLE_ISSUERS or claims.get("aud") != os.environ["GOOGLE_CLIENT_ID"]:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    if claims.get("nonce") != nonce or not claims.get("email") or not claims.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Invalid Google token")
    return claims


@router.get("/google/callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    failure = RedirectResponse(f"{_frontend()}/connexion?error=google", status_code=302)
    if error or not code or not state:
        return failure
    stored = await db.oauth_states.find_one_and_delete({"state": state})
    if not stored:
        return failure
    data = {"code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": f"{_backend(request)}/api/auth/google/callback", "grant_type": "authorization_code"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(GOOGLE_TOKEN_URL, data=data)
    if r.is_error:
        logger.warning("Google token exchange failed (%s)", r.status_code)
        return failure
    try:
        claims = _decode_id_token(r.json().get("id_token", ""), stored["nonce"])
    except (HTTPException, jwt.InvalidTokenError):
        return failure
    email = claims["email"].lower()
    user = await db.users.find_one({"email": email})
    if user and (user.get("deleted_at") or user.get("blocked")):
        return failure
    if user:
        await db.users.update_one({"email": email}, {"$set": {"picture": claims.get("picture") or user.get("picture"), "name": user.get("name") or claims.get("name"),
                                                             "email_verified": True, "google_sub": claims.get("sub")}})
        user = await db.users.find_one({"email": email})
    else:
        user = {"user_id": new_user_id(), "email": email, "name": claims.get("name") or email.split("@")[0], "role": "customer",
                "auth_provider": "google", "google_sub": claims.get("sub"), "picture": claims.get("picture"), "phone": None,
                "saved_pubg_ids": [], "email_verified": True, "auth_version": 0, "loyalty": {"earned": 0, "promo": 0},
                "created_at": _now().isoformat()}
        await db.users.insert_one(user)
    response = RedirectResponse(f"{_frontend()}{stored['return_to']}", status_code=302)
    set_auth_cookies(response, user["user_id"], int(user.get("auth_version", 0)))
    await audit("auth.google_login", user["user_id"], user["user_id"])
    return response


# ---------- Session ----------
@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh" or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"user_id": payload["sub"]}, {"auth_version": 1, "deleted_at": 1})
    if not user or user.get("deleted_at") or int(payload.get("v", 0)) != int(user.get("auth_version", 0)):
        raise HTTPException(status_code=401, detail="Session expired")
    access = create_access_token(payload["sub"], int(user.get("auth_version", 0)))
    response.set_cookie("access_token", access, max_age=ACCESS_TTL, **cookie_options())
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


# ---------- Account deletion (anonymisation, transactional history preserved) ----------
@router.post("/me/delete")
async def delete_account(body: DeleteIn, response: Response, user=Depends(get_current_user)):
    if user.get("role") in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Un compte administrateur ne peut pas être supprimé ici.")
    if body.confirmation.strip().upper() != "SUPPRIMER":
        raise HTTPException(status_code=400, detail="Tapez SUPPRIMER pour confirmer.")
    full = await db.users.find_one({"user_id": user["user_id"]})
    if full.get("password_hash") and (not body.password or not verify_password(body.password, full["password_hash"])):
        raise HTTPException(status_code=401, detail="Mot de passe incorrect.")
    if await db.orders.find_one({"user_id": user["user_id"], "status": {"$in": ["pending_payment", "awaiting_verification", "paid"]}}):
        raise HTTPException(status_code=409, detail="Une commande est encore en cours. Attendez sa livraison ou son annulation.")
    uid, email, name = user["user_id"], full["email"], full.get("name") or ""
    from services import loyalty
    bal = await loyalty.balances(uid)
    for bucket in ("earned", "promo"):
        if bal[bucket] > 0:
            await loyalty.debit(uid, "forfeit", bal[bucket], bucket, uid, "Suppression du compte")
    await db.users.update_one({"user_id": uid}, {
        "$set": {"email": f"deleted_{uid}@anonyme.invalid", "name": "Compte supprimé", "phone": None, "picture": None, "saved_pubg_ids": [],
                 "password_hash": None, "google_sub": None, "auth_provider": "deleted", "email_verified": False,
                 "deleted_at": _now().isoformat(), "email_hash": _hash(email)},
        "$inc": {"auth_version": 1}})
    await db.orders.update_many({"user_id": uid}, {"$set": {"email": None}})  # transactional records kept, PII removed
    await db.user_sessions.delete_many({"user_id": uid})
    await db.push_subscriptions.delete_many({"user_id": uid})
    await db.auth_tokens.delete_many({"user_id": uid})
    conv = await db.chat_conversations.find_one({"user_id": uid}, {"_id": 1})
    if conv:
        await db.chat_messages.delete_many({"conversation_id": str(conv["_id"])})
        await db.chat_conversations.delete_one({"_id": conv["_id"]})
    await audit("account.deleted", uid, uid, {"orders_kept": await db.orders.count_documents({"user_id": uid})})
    await mailer.send_account_deleted(email, name)
    clear_auth_cookies(response)
    return {"ok": True}
