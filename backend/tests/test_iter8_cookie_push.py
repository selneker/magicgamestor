"""Iteration 8 hotfix verification:
- Cookie-based auth (login sets HttpOnly access_token/refresh_token; /auth/me works via cookies)
- /api/chat/unread returns 200 when authed, 401 when not
- Refresh flow: /auth/refresh with only refresh cookie returns new access_token
- Logout clears cookies
- Admin push config returns configured=true with public_key, no private key leak
- Push subscription accept/reject by endpoint host
"""
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
ADMIN_EMAIL = _env["ADMIN_EMAIL"]
ADMIN_PASSWORD = _env["ADMIN_PASSWORD"]


# Valid-looking test push keys (base64url). p256dh is 65-byte uncompressed point on P-256.
def _gen_keys():
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    import base64, os as _os
    k = ec.generate_private_key(ec.SECP256R1())
    pub = k.public_key().public_bytes(encoding=serialization.Encoding.X962,
                                      format=serialization.PublicFormat.UncompressedPoint)
    return (base64.urlsafe_b64encode(pub).rstrip(b"=").decode(),
            base64.urlsafe_b64encode(_os.urandom(16)).rstrip(b"=").decode())

P256DH, AUTH_KEY = _gen_keys()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


# -------- Cookie auth --------
def test_login_sets_httponly_cookies_and_me_works():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    # cookies set
    assert "access_token" in s.cookies
    assert "refresh_token" in s.cookies
    # HttpOnly + Secure flags present on the Set-Cookie headers
    set_cookie_headers = r.headers.get("set-cookie", "").lower()
    assert "httponly" in set_cookie_headers
    assert "secure" in set_cookie_headers
    # /auth/me works with cookies only (no Authorization header)
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == ADMIN_EMAIL.lower()


def test_me_unauthenticated_returns_401():
    r = requests.get(f"{API}/auth/me")
    assert r.status_code == 401


def test_chat_unread_requires_auth():
    r = requests.get(f"{API}/chat/unread")
    assert r.status_code == 401


def test_chat_unread_authed(admin_session):
    r = admin_session.get(f"{API}/chat/unread")
    assert r.status_code == 200
    data = r.json()
    assert "count" in data
    assert isinstance(data["count"], int)


def test_refresh_with_only_refresh_cookie():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    # Drop access_token, keep refresh_token
    refresh_val = s.cookies.get("refresh_token")
    s.cookies.clear()
    s.cookies.set("refresh_token", refresh_val)
    r = s.post(f"{API}/auth/refresh")
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()
    # New access cookie set
    assert "access_token" in s.cookies
    # /auth/me works
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200


def test_refresh_without_token_returns_401():
    r = requests.post(f"{API}/auth/refresh")
    assert r.status_code == 401


def test_logout_clears_cookies():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    r = s.post(f"{API}/auth/logout")
    assert r.status_code == 200
    # After logout, /auth/me should be 401
    # (session cookies should be cleared by server via Set-Cookie deletion)
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 401


# -------- Admin push --------
def test_push_config_admin(admin_session):
    r = admin_session.get(f"{API}/admin/push/config")
    assert r.status_code == 200
    data = r.json()
    assert data["configured"] is True
    assert data.get("public_key")
    assert isinstance(data["public_key"], str)
    # Sanity: no private key related fields
    assert "private" not in {k.lower() for k in data.keys()}


def test_push_config_unauth_401():
    r = requests.get(f"{API}/admin/push/config")
    assert r.status_code == 401


def test_push_config_customer_forbidden():
    email = f"qa_it8_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "QA"})
    assert r.status_code == 200
    r = s.get(f"{API}/admin/push/config")
    assert r.status_code == 403


def test_push_subscription_reject_bad_host(admin_session):
    body = {"endpoint": "https://evil.example.com/x", "keys": {"p256dh": P256DH, "auth": AUTH_KEY}}
    r = admin_session.post(f"{API}/admin/push/subscriptions", json=body)
    assert r.status_code == 422, r.text


def test_push_subscription_register_status_delete(admin_session):
    endpoint = f"https://fcm.googleapis.com/fcm/send/qa-{uuid.uuid4().hex[:12]}"
    body = {"endpoint": endpoint, "keys": {"p256dh": P256DH, "auth": AUTH_KEY}}
    r = admin_session.post(f"{API}/admin/push/subscriptions", json=body)
    assert r.status_code == 200, r.text
    assert r.json() == {"registered": True}

    r = admin_session.post(f"{API}/admin/push/status", json={"endpoint": endpoint})
    assert r.status_code == 200
    assert r.json()["registered"] is True

    r = admin_session.delete(f"{API}/admin/push/subscriptions", json={"endpoint": endpoint})
    assert r.status_code == 200

    r = admin_session.post(f"{API}/admin/push/status", json={"endpoint": endpoint})
    assert r.json()["registered"] is False


def test_push_test_not_missing_config(admin_session):
    """POST /admin/push/test to a non-existent endpoint should NOT return 503 (missing VAPID)."""
    endpoint = f"https://fcm.googleapis.com/fcm/send/qa-{uuid.uuid4().hex[:12]}"
    r = admin_session.post(f"{API}/admin/push/test", json={"endpoint": endpoint})
    # Should be 404 (no subscription) - definitely not 503
    assert r.status_code != 503, r.text
