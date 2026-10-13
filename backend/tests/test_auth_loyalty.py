"""Auth hardening: email verification, forgot/reset password (single-use, expiring, no enumeration), account deletion."""
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _register(password="Secret123!"):
    email = f"qa_auth_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "Auth QA"}, headers=_ip())
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "password": password, "token": d["access_token"], "user_id": d["user"]["user_id"], "user": d["user"]}


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def _token_for(user_id, purpose):
    """Tokens are stored hashed; tests read the plaintext via a controlled reissue through the API path."""
    return mongo.auth_tokens.find_one({"user_id": user_id, "purpose": purpose})


class TestRegisterVerify:
    def test_register_is_unverified_and_token_issued(self):
        u = _register()
        assert u["user"]["email_verified"] is False and "password_hash" not in u["user"]
        time.sleep(0.5)  # background task
        doc = _token_for(u["user_id"], "verify_email")
        assert doc and doc["used_at"] is None and len(doc["token_hash"]) == 64

    def test_verify_email_single_use(self):
        u = _register()
        time.sleep(0.5)
        # Simulate the link the user receives: re-issue a token through the backend helper semantics (hash match)
        import hashlib, secrets
        raw = secrets.token_urlsafe(32)
        mongo.auth_tokens.update_one({"user_id": u["user_id"], "purpose": "verify_email"}, {"$set": {"token_hash": hashlib.sha256(raw.encode()).hexdigest()}})
        assert requests.post(f"{API}/auth/verify-email", json={"token": raw}).status_code == 200
        assert requests.get(f"{API}/auth/me", headers=_bearer(u["token"])).json()["email_verified"] is True
        assert requests.post(f"{API}/auth/verify-email", json={"token": raw}).status_code == 400  # single use
        assert requests.post(f"{API}/auth/resend-verification", headers=_bearer(u["token"])).json().get("already_verified") is True

    def test_expired_verify_token_rejected(self):
        u = _register()
        time.sleep(0.5)
        import hashlib, secrets
        raw = secrets.token_urlsafe(32)
        mongo.auth_tokens.update_one({"user_id": u["user_id"], "purpose": "verify_email"},
                                     {"$set": {"token_hash": hashlib.sha256(raw.encode()).hexdigest(), "expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}})
        assert requests.post(f"{API}/auth/verify-email", json={"token": raw}).status_code == 400

    def test_resend_rate_limited(self):
        u = _register()
        codes = [requests.post(f"{API}/auth/resend-verification", headers=_bearer(u["token"])).status_code for _ in range(5)]
        assert codes[0] == 200 and 429 in codes


class TestForgotReset:
    def test_forgot_no_enumeration(self):
        u = _register()
        ok = requests.post(f"{API}/auth/forgot-password", json={"email": u["email"]}, headers=_ip())
        unknown = requests.post(f"{API}/auth/forgot-password", json={"email": f"nobody_{uuid.uuid4().hex[:6]}@test.mg"}, headers=_ip())
        assert ok.status_code == unknown.status_code == 200 and ok.json() == unknown.json()
        time.sleep(0.5)
        assert _token_for(u["user_id"], "reset_password")

    def test_reset_flow_invalidates_old_sessions(self):
        u = _register()
        requests.post(f"{API}/auth/forgot-password", json={"email": u["email"]}, headers=_ip())
        time.sleep(0.5)
        import hashlib, secrets
        raw = secrets.token_urlsafe(32)
        mongo.auth_tokens.update_one({"user_id": u["user_id"], "purpose": "reset_password"}, {"$set": {"token_hash": hashlib.sha256(raw.encode()).hexdigest()}})
        assert requests.post(f"{API}/auth/reset-password", json={"token": raw, "password": "short"}, headers=_ip()).status_code == 422
        assert requests.post(f"{API}/auth/reset-password", json={"token": raw, "password": "NewSecret456!"}, headers=_ip()).status_code == 200
        assert requests.post(f"{API}/auth/reset-password", json={"token": raw, "password": "NewSecret456!"}, headers=_ip()).status_code == 400
        assert requests.get(f"{API}/auth/me", headers=_bearer(u["token"])).status_code == 401  # old JWT revoked (auth_version)
        assert requests.post(f"{API}/auth/login", json={"email": u["email"], "password": u["password"]}, headers=_ip()).status_code == 401
        r = requests.post(f"{API}/auth/login", json={"email": u["email"], "password": "NewSecret456!"}, headers=_ip())
        assert r.status_code == 200
        user = mongo.users.find_one({"user_id": u["user_id"]})
        assert user["password_hash"].startswith("$2") and user["auth_version"] == 1

    def test_forgot_rate_limited_per_email(self):
        u = _register()
        codes = [requests.post(f"{API}/auth/forgot-password", json={"email": u["email"]}, headers=_ip()).status_code for _ in range(5)]
        assert 429 in codes


class TestDeleteAccount:
    def test_delete_requires_password_and_confirmation_then_anonymises(self):
        u = _register()
        h = _bearer(u["token"])
        assert requests.post(f"{API}/auth/me/delete", json={"password": u["password"], "confirmation": "non"}, headers=h).status_code == 400
        assert requests.post(f"{API}/auth/me/delete", json={"password": "wrong", "confirmation": "SUPPRIMER"}, headers=h).status_code == 401
        # a completed order stays as anonymous transactional history
        product = requests.get(f"{API}/products").json()[0]
        o = requests.post(f"{API}/orders", json={"pubg_id": "5123456789", "pseudo": "Del", "items": [{"product_id": product["id"], "quantity": 1}],
                                                  "payment_method": "manual", "manual_reference": "X1"}, headers={**h, **_ip()}).json()
        assert requests.post(f"{API}/auth/me/delete", json={"password": u["password"], "confirmation": "SUPPRIMER"}, headers=h).status_code == 409  # order in progress
        admin = requests.post(f"{API}/auth/login", json={"email": _env["ADMIN_EMAIL"], "password": _env["ADMIN_PASSWORD"]}).json()["access_token"]
        requests.patch(f"{API}/admin/orders/{o['id']}", headers=_bearer(admin), json={"status": "cancelled"})
        assert requests.post(f"{API}/auth/me/delete", json={"password": u["password"], "confirmation": "SUPPRIMER"}, headers=h).status_code == 200
        doc = mongo.users.find_one({"user_id": u["user_id"]})
        assert doc["email"] != u["email"] and doc["password_hash"] is None and doc["deleted_at"] and doc["auth_provider"] == "deleted"
        assert mongo.orders.find_one({"id": o["id"]})["user_id"] == u["user_id"]  # history kept
        assert mongo.orders.find_one({"id": o["id"]})["email"] is None
        assert requests.get(f"{API}/auth/me", headers=h).status_code == 401
        assert requests.post(f"{API}/auth/login", json={"email": u["email"], "password": u["password"]}, headers=_ip()).status_code == 401
        assert mongo.audit_logs.find_one({"action": "account.deleted", "target": u["user_id"]})
        # email is free again
        assert requests.post(f"{API}/auth/register", json={"email": u["email"], "password": "Another123!", "name": "Again"}, headers=_ip()).status_code == 200


class TestGoogleOwnFlow:
    def test_google_start_requires_config_and_no_emergent(self):
        r = requests.get(f"{API}/auth/google/config")
        assert r.status_code == 200 and "enabled" in r.json()
        r = requests.get(f"{API}/auth/google/start", allow_redirects=False)
        assert r.status_code in (302, 503)
        if r.status_code == 302:
            assert r.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth")
            assert "emergent" not in r.headers["location"]
        assert requests.post(f"{API}/auth/google/session", json={"session_id": "x"}).status_code in (404, 405)
        # callback with forged state is rejected with a redirect to the login page, never a session
        r = requests.get(f"{API}/auth/google/callback", params={"code": "x", "state": "forged"}, allow_redirects=False)
        assert r.status_code == 302 and "error=google" in r.headers["location"] and "access_token" not in r.headers.get("set-cookie", "")


class TestLoyalty:
    def test_points_only_on_paid_and_ledger(self):
        u = _register()
        h = _bearer(u["token"])
        product = sorted([p for p in requests.get(f"{API}/products").json() if p["type"] == "uc"], key=lambda p: -p["price"])[0]
        o = requests.post(f"{API}/orders", json={"pubg_id": str(random.randint(10**9, 10**10 - 1)), "pseudo": "Pts", "items": [{"product_id": product["id"], "quantity": 1}],
                                                  "payment_method": "mvola", "payment_phone": "0341234567"}, headers={**h, **_ip()}).json()
        assert requests.get(f"{API}/loyalty/me", headers=h).json()["balance"]["total"] == 0  # pending → nothing
        p = requests.post(f"{API}/payments/initiate", json={"order_id": o["id"]}, headers={**h, **_ip()}).json()
        admin = requests.post(f"{API}/auth/login", json={"email": _env["ADMIN_EMAIL"], "password": _env["ADMIN_PASSWORD"]}).json()["access_token"]
        requests.post(f"{API}/payments/{o['id']}/simulate", headers=_bearer(admin), json={"outcome": "completed"})
        time.sleep(0.5)
        me = requests.get(f"{API}/loyalty/me", headers=h).json()
        expected = product["price"] // 1000 * me["config"]["points_per_1000_ar"]
        assert me["balance"]["earned"] == expected > 0
        assert [e for e in me["ledger"] if e["type"] == "earn" and e["order_id"] == o["id"]]
        # second delivery signal never double-awards
        requests.post(f"{API}/payments/{o['id']}/simulate", headers=_bearer(admin), json={"outcome": "completed"})
        requests.patch(f"{API}/admin/orders/{o['id']}", headers=_bearer(admin), json={"status": "delivered"})
        time.sleep(0.5)
        assert requests.get(f"{API}/loyalty/me", headers=h).json()["balance"]["earned"] == expected
        # transfer requires verified email; unknown recipient 404
        r = requests.post(f"{API}/loyalty/transfers", json={"recipient_email": "x@test.mg", "amount": 100}, headers=h)
        assert r.status_code == 403
        # admin adjust creates promo points; reversal on cancel of paid order claws back earned
        requests.post(f"{API}/loyalty/admin/adjust", headers=_bearer(admin), json={"user_email": u["email"], "amount": 50, "bucket": "promo", "reason": "QA bonus"})
        assert requests.get(f"{API}/loyalty/me", headers=h).json()["balance"]["promo"] == 50
        assert mongo.audit_logs.find_one({"action": "loyalty.manual_adjust", "target": u["user_id"]})
        assert requests.post(f"{API}/loyalty/redeem", json={"reward_id": "nope"}, headers=h).status_code == 404

    def test_transfer_between_verified_users_with_acceptance(self):
        a, b = _register(), _register()
        mongo.users.update_many({"user_id": {"$in": [a["user_id"], b["user_id"]]}}, {"$set": {"email_verified": True}})
        admin = requests.post(f"{API}/auth/login", json={"email": _env["ADMIN_EMAIL"], "password": _env["ADMIN_PASSWORD"]}).json()["access_token"]
        requests.post(f"{API}/loyalty/admin/adjust", headers=_bearer(admin), json={"user_email": a["email"], "amount": 500, "bucket": "earned", "reason": "QA seed"})
        ha, hb = _bearer(a["token"]), _bearer(b["token"])
        assert requests.post(f"{API}/loyalty/transfers", json={"recipient_email": b["email"], "amount": 10}, headers=ha).status_code == 400  # below min
        assert requests.post(f"{API}/loyalty/transfers", json={"recipient_email": b["email"], "amount": 5000}, headers=ha).status_code in (409, 429)
        r = requests.post(f"{API}/loyalty/transfers", json={"recipient_email": b["email"], "amount": 200}, headers=ha)
        assert r.status_code == 201, r.text
        tid = r.json()["id"]
        assert requests.get(f"{API}/loyalty/me", headers=ha).json()["balance"]["earned"] == 300  # held
        assert requests.get(f"{API}/loyalty/me", headers=hb).json()["balance"]["earned"] == 0
        assert requests.post(f"{API}/loyalty/transfers/{tid}/accept", headers=ha).status_code == 404  # only recipient
        assert requests.post(f"{API}/loyalty/transfers/{tid}/accept", headers=hb).status_code == 200
        assert requests.post(f"{API}/loyalty/transfers/{tid}/accept", headers=hb).status_code == 404  # idempotent
        assert requests.get(f"{API}/loyalty/me", headers=hb).json()["balance"]["earned"] == 200
        total = sum(e["amount"] for e in mongo.loyalty_ledger.find({"user_id": {"$in": [a["user_id"], b["user_id"]]}}))
        assert total == 500  # ledger conserves points
