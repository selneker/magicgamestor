"""Iteration 7 hotfix verification:
- JWT edge cases (malformed, expired, missing 'sub') must return 401, never 500.
- Subscription enforcement per pubg_id (Prime/Prime+ rules) + concurrency.
- Admin gating (403 for customer, 200 for admin).
"""
import asyncio
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import jwt as pyjwt
import pytest
import requests
from dotenv import dotenv_values

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
ADMIN_EMAIL = _env["ADMIN_EMAIL"]
ADMIN_PASSWORD = _env["ADMIN_PASSWORD"]
JWT_SECRET = _env["JWT_SECRET"]


def _pubg():
    return str(random.randint(10**9, 10**10 - 1))


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def customer():
    email = f"qa_it7_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "QA it7"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["access_token"], "user_id": d["user"]["user_id"]}


@pytest.fixture(scope="module")
def products():
    r = requests.get(f"{API}/products")
    assert r.status_code == 200
    by = {}
    for p in r.json():
        by.setdefault(p["type"], []).append(p)
    for k in by:
        by[k].sort(key=lambda p: (p.get("duration_months") or 0, p["price"]))
    return by


# ---------- 1) JWT regression: never 500 ----------
class TestJWTRegression:
    def test_admin_login_returns_token_and_cookies(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        assert isinstance(r.json()["access_token"], str)
        cookies = {c.name for c in s.cookies}
        assert "access_token" in cookies and "refresh_token" in cookies

    def test_me_with_bearer(self, customer):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {customer['token']}"})
        assert r.status_code == 200
        assert r.json()["email"] == customer["email"]

    def test_me_with_cookie(self):
        # Register with a session; server sets access_token cookie automatically.
        # requests won't return Secure cookies via HTTP, so manually copy from Set-Cookie header.
        s = requests.Session()
        email = f"qa_it7_c_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
        reg = s.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "Cookie"})
        assert reg.status_code == 200, reg.text
        set_cookie_hdrs = reg.headers.get("set-cookie", "") + "\n" + "\n".join(
            [v for k, v in reg.raw.headers.items() if k.lower() == "set-cookie"]
        ) if hasattr(reg, "raw") else reg.headers.get("set-cookie", "")
        # Parse access_token from Set-Cookie response
        import re
        m = re.search(r"access_token=([^;]+)", set_cookie_hdrs)
        assert m, f"no access_token cookie: {set_cookie_hdrs!r}"
        s2 = requests.Session()
        r = s2.get(f"{API}/auth/me", cookies={"access_token": m.group(1)})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == email

    def test_malformed_jwt_returns_401(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-jwt-at-all"})
        assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text}"

    def test_forged_jwt_bad_signature_401(self):
        tok = pyjwt.encode({"sub": "user_fake", "type": "access",
                            "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                           "wrong-secret", algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401

    def test_expired_jwt_401(self):
        tok = pyjwt.encode({"sub": "user_fake", "type": "access",
                            "exp": datetime.now(timezone.utc) - timedelta(minutes=5)},
                           JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401

    def test_jwt_missing_sub_returns_401_not_500(self):
        """Regression: previously payload without 'sub' hit users.find_one({'user_id': None}) or crashed."""
        tok = pyjwt.encode({"type": "access",
                            "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                           JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401, f"MUST be 401, got {r.status_code} {r.text}"

    def test_jwt_wrong_type_refresh_returns_401(self):
        tok = pyjwt.encode({"sub": "user_fake", "type": "refresh",
                            "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                           JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401

    def test_jwt_empty_sub_returns_401(self):
        tok = pyjwt.encode({"sub": "", "type": "access",
                            "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                           JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401

    def test_no_auth_returns_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------- 2) Admin gating ----------
class TestAdminGating:
    def test_customer_forbidden_admin_orders(self, customer):
        r = requests.get(f"{API}/admin/orders",
                         headers={"Authorization": f"Bearer {customer['token']}"})
        assert r.status_code == 403

    def test_admin_ok_admin_orders(self, admin_headers):
        r = requests.get(f"{API}/admin/orders", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_forged_jwt_forbidden_admin(self):
        tok = pyjwt.encode({"sub": "user_fake", "type": "access",
                            "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                           "wrong", algorithm="HS256")
        r = requests.get(f"{API}/admin/orders", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401


# ---------- 3) Subscription rules ----------
def _order(pubg_id, item_ids, method="mvola"):
    body = {"pubg_id": pubg_id, "pseudo": "Tester",
            "items": [{"product_id": i, "quantity": 1} for i in item_ids],
            "payment_method": method, "payment_phone": "0341234567"}
    return requests.post(f"{API}/orders", json=body)


class TestSubscriptionRules:
    def test_first_prime_ok_second_prime_409(self, products):
        pid = _pubg()
        r1 = _order(pid, [products["prime"][0]["id"]])
        assert r1.status_code == 201, r1.text
        r2 = _order(pid, [products["prime"][0]["id"]])
        assert r2.status_code == 409

    def test_prime_and_prime_plus_both_allowed(self, products):
        pid = _pubg()
        assert _order(pid, [products["prime"][0]["id"]]).status_code == 201
        assert _order(pid, [products["prime_plus"][0]["id"]]).status_code == 201
        assert _order(pid, [products["prime_plus"][0]["id"]]).status_code == 409

    def test_cart_two_prime_items_400(self, products):
        r = _order(_pubg(), [products["prime"][0]["id"], products["prime"][1]["id"]])
        assert r.status_code == 400

    def test_cart_prime_quantity_2_400(self, products):
        body = {"pubg_id": _pubg(), "pseudo": "Tester",
                "items": [{"product_id": products["prime"][0]["id"], "quantity": 2}],
                "payment_method": "mvola", "payment_phone": "0341234567"}
        r = requests.post(f"{API}/orders", json=body)
        assert r.status_code == 400, r.text

    def test_cart_uc_plus_prime_plus_primeplus_ok(self, products):
        pid = _pubg()
        r = _order(pid, [products["uc"][0]["id"], products["prime"][0]["id"], products["prime_plus"][0]["id"]])
        assert r.status_code == 201, r.text
        active = requests.get(f"{API}/orders/subscriptions", params={"pubg_id": pid}).json()["active"]
        assert set(active.keys()) == {"prime", "prime_plus"}

    def test_uc_only_never_blocked(self, products):
        pid = _pubg()
        for _ in range(3):
            r = _order(pid, [products["uc"][0]["id"]])
            assert r.status_code == 201
        # quantity>1 UC is fine
        body = {"pubg_id": pid, "pseudo": "Tester",
                "items": [{"product_id": products["uc"][0]["id"], "quantity": 5}],
                "payment_method": "mvola", "payment_phone": "0341234567"}
        assert requests.post(f"{API}/orders", json=body).status_code == 201

    def test_cancel_releases_lock(self, products, admin_headers):
        pid = _pubg()
        o = _order(pid, [products["prime"][0]["id"]]).json()
        assert _order(pid, [products["prime"][0]["id"]]).status_code == 409
        r = requests.patch(f"{API}/admin/orders/{o['id']}", headers=admin_headers,
                           json={"status": "cancelled"})
        assert r.status_code == 200
        assert _order(pid, [products["prime"][0]["id"]]).status_code == 201

    def test_failed_releases_lock(self, products, admin_headers):
        pid = _pubg()
        o = _order(pid, [products["prime_plus"][0]["id"]]).json()
        # transition pending_payment -> failed (allowed)
        r = requests.patch(f"{API}/admin/orders/{o['id']}", headers=admin_headers,
                           json={"status": "failed"})
        assert r.status_code == 200, r.text
        assert _order(pid, [products["prime_plus"][0]["id"]]).status_code == 201

    def test_subscriptions_endpoint_excludes_cancelled(self, products, admin_headers):
        pid = _pubg()
        o = _order(pid, [products["prime"][0]["id"]]).json()
        active = requests.get(f"{API}/orders/subscriptions", params={"pubg_id": pid}).json()["active"]
        assert "prime" in active
        requests.patch(f"{API}/admin/orders/{o['id']}", headers=admin_headers,
                       json={"status": "cancelled"})
        active = requests.get(f"{API}/orders/subscriptions", params={"pubg_id": pid}).json()["active"]
        assert "prime" not in active


# ---------- 4) Concurrency ----------
class TestConcurrency:
    def test_concurrent_prime_orders_single_winner(self, products):
        pid = _pubg()
        prime_id = products["prime"][0]["id"]

        async def run():
            async with httpx.AsyncClient(base_url=API, timeout=30) as c:
                body = {"pubg_id": pid, "pseudo": "Race",
                        "items": [{"product_id": prime_id, "quantity": 1}],
                        "payment_method": "mvola", "payment_phone": "0341234567"}
                return await asyncio.gather(*[c.post("/orders", json=body) for _ in range(8)])

        codes = sorted(r.status_code for r in asyncio.run(run()))
        assert codes.count(201) == 1, codes
        assert codes.count(409) == 7, codes
