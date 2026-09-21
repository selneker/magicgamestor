"""Backend tests for iteration 10 — Papi auto toggle + manual USSD orders + delete delivered.

Uses admin credentials from /app/memory/test_credentials.md and BASE_URL from env.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://game-shop-test.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASSWORD = "AdminLocal2026!"


# --------- Fixtures ---------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def admin_session(s):
    # Try login
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    admin = requests.Session()
    admin.headers.update({"Content-Type": "application/json"})
    # copy cookies
    admin.cookies.update(s.cookies)
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        admin.headers["Authorization"] = f"Bearer {token}"
    return admin


@pytest.fixture(scope="session")
def uc_product(s):
    products = s.get(f"{API}/products").json()
    uc = [p for p in products if p.get("type") == "uc"]
    if not uc:
        pytest.skip("No UC product available")
    # cheapest UC
    return sorted(uc, key=lambda p: p["price"])[0]


@pytest.fixture(scope="session", autouse=True)
def ensure_papi_off(admin_session):
    """Ensure PAPI_AUTO=false before tests, and restore to false after suite."""
    admin_session.patch(f"{API}/payments/admin/settings", json={"papi_auto": False})
    yield
    admin_session.patch(f"{API}/payments/admin/settings", json={"papi_auto": False})


def _pubg():
    return str(1000000000 + int(time.time() * 1000) % 999999999)


# --------- 1. GET /api/payments/config ---------
def test_config_papi_auto_off_and_manual_only(s):
    r = s.get(f"{API}/payments/config")
    assert r.status_code == 200
    data = r.json()
    assert data["papi_auto"] is False
    assert data["manual_only"] is True
    assert data["mode"] in ("simulation", "papi")


# --------- 2. Order rejected with mvola when papi_auto=false ---------
def test_order_mvola_rejected_when_papi_off(s, uc_product):
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_PapiOff",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "mvola", "payment_phone": "0341234567",
    }
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 409, f"Expected 409, got {r.status_code}: {r.text}"
    assert "manuel" in r.json().get("detail", "").lower() or "désactivé" in r.json().get("detail", "").lower()


def test_order_orange_rejected_when_papi_off(s, uc_product):
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_PapiOff",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "orange", "payment_phone": "0371234567",
    }
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 409


# --------- 3. Manual order requires reference ---------
def test_manual_order_without_reference_rejected(s, uc_product):
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_ManualNoRef",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "manual",
    }
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 400
    assert "reference" in r.json().get("detail", "").lower()


# --------- 4. Manual order with reference creates awaiting_verification ---------
@pytest.fixture(scope="session")
def manual_order(s, uc_product):
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_Manual",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "manual", "manual_reference": f"REF-{uuid.uuid4().hex[:8]}",
    }
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_manual_order_status_awaiting_verification(manual_order):
    assert manual_order["status"] == "awaiting_verification"
    assert manual_order["payment_method"] == "manual"
    assert manual_order["manual_reference"]
    # never paid on creation
    assert manual_order["status"] != "paid"


# --------- 5. /payments/initiate refused when papi_auto=false ---------
def test_initiate_refused_when_papi_off(s, uc_product, admin_session):
    """Create an mvola order while papi_auto is temporarily ON, then flip OFF and initiate must 409."""
    # temporarily enable
    admin_session.patch(f"{API}/payments/admin/settings", json={"papi_auto": True})
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_InitOff",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "mvola", "payment_phone": "0341234567",
    }
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 201, r.text
    order = r.json()
    # flip OFF
    admin_session.patch(f"{API}/payments/admin/settings", json={"papi_auto": False})
    # try initiate
    r2 = s.post(f"{API}/payments/initiate", json={"order_id": order["id"]})
    assert r2.status_code == 409, f"Expected 409, got {r2.status_code}: {r2.text}"


# --------- 6. Admin settings guarded + toggle round-trip ---------
def test_admin_settings_unauthorized_without_admin():
    r = requests.get(f"{API}/payments/admin/settings")
    assert r.status_code in (401, 403)
    r = requests.patch(f"{API}/payments/admin/settings", json={"papi_auto": True})
    assert r.status_code in (401, 403)


def test_admin_settings_toggle_and_mvola_accepted_when_on(s, uc_product, admin_session):
    r = admin_session.patch(f"{API}/payments/admin/settings", json={"papi_auto": True})
    assert r.status_code == 200
    assert r.json()["papi_auto"] is True
    # config reflects
    cfg = s.get(f"{API}/payments/config").json()
    assert cfg["papi_auto"] is True
    assert cfg["manual_only"] is False
    # mvola order accepted
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_MvolaOn",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "mvola", "payment_phone": "0341234567",
    }
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 201
    order = r.json()
    # initiate creates an attempt in simulation
    r2 = s.post(f"{API}/payments/initiate", json={"order_id": order["id"]})
    assert r2.status_code == 200, r2.text
    attempt = r2.json()
    assert attempt["status"] == "pending"
    assert attempt.get("simulated") is True
    # cleanup: turn OFF
    admin_session.patch(f"{API}/payments/admin/settings", json={"papi_auto": False})


# --------- 7. Admin PATCH order awaiting_verification -> paid -> delivered; DELETE delivered ok ---------
def test_admin_verify_flow_and_delete_delivered(admin_session, manual_order):
    oid = manual_order["id"]
    # awaiting_verification -> paid
    r = admin_session.patch(f"{API}/admin/orders/{oid}", json={"status": "paid"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"
    # paid -> delivered
    r = admin_session.patch(f"{API}/admin/orders/{oid}", json={"status": "delivered"})
    assert r.status_code == 200
    assert r.json()["status"] == "delivered"
    # delete delivered -> ok
    r = admin_session.delete(f"{API}/admin/orders/{oid}")
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True
    # verify removed
    r = admin_session.get(f"{API}/orders/{oid}")
    assert r.status_code == 404


def test_admin_cannot_delete_paid_non_delivered(admin_session, s, uc_product):
    # create manual order, promote to paid, then try to delete -> 409
    body = {
        "pubg_id": _pubg(), "pseudo": "TEST_PaidNoDel",
        "items": [{"product_id": uc_product["id"], "quantity": 1}],
        "payment_method": "manual", "manual_reference": "REF-KEEP-1",
    }
    order = s.post(f"{API}/orders", json=body).json()
    r = admin_session.patch(f"{API}/admin/orders/{order['id']}", json={"status": "paid"})
    assert r.status_code == 200
    r = admin_session.delete(f"{API}/admin/orders/{order['id']}")
    assert r.status_code == 409
    # cleanup: cancel + delete
    admin_session.patch(f"{API}/admin/orders/{order['id']}", json={"status": "cancelled"})
