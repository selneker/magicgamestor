"""Iteration 23 — USSD manual = 0 MGA (non-configurable), collapsible fees, legal pages.

Covers:
- GET /api/payments/config exposes manual={0,0,0}, papi, fiveone
- PATCH /payments/admin/settings rejects payment_fees.manual (422) and accepts papi/fiveone
- Manual order => payment_fee=0, total=subtotal, status awaiting_verification (2 sub-totals)
- FiveOne fee brackets (min/percent/cap) applied on total
- Both OFF => 409 on mvola/orange, manual still accepted
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ussd-gateway-test.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASS = "Admin1234!"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def initial_settings(admin_session):
    r = admin_session.get(f"{API}/payments/admin/settings", timeout=15)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def restore_state(admin_session, initial_settings):
    """Final restore: fiveone ON, papi_auto OFF, fees defaults."""
    yield
    admin_session.patch(f"{API}/payments/admin/settings", json={
        "fiveone_enabled": True, "papi_auto": False,
        "payment_fees": {
            "papi": {"percent": 0, "min": 100, "max": 16500},
            "fiveone": {"percent": 2.75, "min": 100, "max": 16500},
        },
    }, timeout=15)


# ---------- 1) /payments/config exposes manual ----------

def test_config_exposes_manual_zero():
    r = requests.get(f"{API}/payments/config", timeout=15)
    assert r.status_code == 200
    fees = r.json()["payment_fees"]
    assert fees["manual"] == {"percent": 0.0, "min": 0, "max": 0}
    assert "papi" in fees and "fiveone" in fees
    assert all(k in fees["papi"] for k in ("percent", "min", "max"))
    assert all(k in fees["fiveone"] for k in ("percent", "min", "max"))


# ---------- 2) PATCH rejects manual, accepts papi/fiveone ----------

def test_patch_rejects_manual_key(admin_session):
    r = admin_session.patch(f"{API}/payments/admin/settings", json={
        "payment_fees": {"manual": {"percent": 5, "min": 100, "max": 500}}
    }, timeout=15)
    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


def test_patch_accepts_papi_and_fiveone(admin_session):
    r = admin_session.patch(f"{API}/payments/admin/settings", json={
        "payment_fees": {
            "papi": {"percent": 0, "min": 100, "max": 16500},
            "fiveone": {"percent": 2.75, "min": 100, "max": 16500},
        }
    }, timeout=15)
    assert r.status_code == 200, r.text
    fees = r.json()["payment_fees"]
    assert fees["fiveone"]["percent"] == 2.75
    assert fees["papi"]["min"] == 100
    # manual should always be forced back to zero
    assert fees["manual"] == {"percent": 0.0, "min": 0, "max": 0}


# ---------- 3) Manual order => fee 0 ----------

def _find_products():
    r = requests.get(f"{API}/products", timeout=15)
    r.raise_for_status()
    products = [p for p in r.json() if p.get("active") and p.get("type") == "uc"]
    assert products, "No active UC products available"
    return products


def _place_manual_order(subtotal_target):
    products = _find_products()
    # find single product whose price is close to subtotal_target
    prod = min(products, key=lambda p: abs(p["price"] - subtotal_target))
    payload = {
        "pubg_id": "5123456789", "pseudo": "TEST_iter23",
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": "manual", "manual_reference": "mvola:REF123456",
        "email": "test_iter23@example.com",
    }
    r = requests.post(f"{API}/orders", json=payload, timeout=20)
    assert r.status_code == 201, r.text
    return r.json(), prod


def test_manual_order_small_cart_fee_zero():
    order, prod = _place_manual_order(3000)
    assert order["payment_method"] == "manual"
    assert order["payment_provider"] is None
    assert order["payment_fee"] == 0
    assert order["subtotal"] == prod["price"]
    assert order["total"] == order["subtotal"]
    assert order["status"] == "awaiting_verification"


def test_manual_order_large_cart_fee_zero():
    order, prod = _place_manual_order(50000)
    assert order["payment_fee"] == 0
    assert order["total"] == order["subtotal"]
    assert order["status"] == "awaiting_verification"


# ---------- 4) FiveOne fee brackets ----------

def _place_auto_order(prod, phone="0341234567", method="mvola"):
    payload = {
        "pubg_id": "5123456789", "pseudo": "TEST_iter23",
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "payment_method": method, "payment_phone": phone,
        "email": "test_iter23@example.com",
    }
    return requests.post(f"{API}/orders", json=payload, timeout=20)


def test_fiveone_fee_brackets(admin_session):
    # Ensure fiveone ON, papi_auto OFF, defaults
    admin_session.patch(f"{API}/payments/admin/settings", json={
        "fiveone_enabled": True, "papi_auto": False,
        "payment_fees": {
            "papi": {"percent": 0, "min": 100, "max": 16500},
            "fiveone": {"percent": 2.75, "min": 100, "max": 16500},
        },
    }, timeout=15).raise_for_status()

    products = _find_products()
    # Small product (subtotal < ~3636 triggers min=100)
    small = min(products, key=lambda p: p["price"])
    r = _place_auto_order(small)
    assert r.status_code == 201, r.text
    o = r.json()
    expected = min(max(round(o["subtotal"] * 2.75 / 100), 100), 16500)
    assert o["payment_fee"] == expected, f"subtotal={o['subtotal']} expected {expected}, got {o['payment_fee']}"
    assert o["total"] == o["subtotal"] + o["payment_fee"]
    assert o["payment_provider"] == "fiveone"

    # Larger product for percent range
    mid = min(products, key=lambda p: abs(p["price"] - 50000))
    r2 = _place_auto_order(mid)
    assert r2.status_code == 201, r2.text
    o2 = r2.json()
    expected2 = min(max(round(o2["subtotal"] * 2.75 / 100), 100), 16500)
    assert o2["payment_fee"] == expected2


# ---------- 5) Both OFF => 409 on auto method, manual still works ----------

def test_both_off_blocks_auto_but_allows_manual(admin_session):
    # Turn both OFF
    admin_session.patch(f"{API}/payments/admin/settings", json={
        "fiveone_enabled": False, "papi_auto": False,
    }, timeout=15).raise_for_status()
    time.sleep(0.3)
    try:
        prod = _find_products()[0]
        # Auto method should 409
        r = _place_auto_order(prod)
        assert r.status_code == 409, f"Expected 409 got {r.status_code}: {r.text}"
        # Manual still works
        payload = {
            "pubg_id": "5123456789", "pseudo": "TEST_iter23",
            "items": [{"product_id": prod["id"], "quantity": 1}],
            "payment_method": "manual", "manual_reference": "mvola:REF123456",
            "email": "test_iter23@example.com",
        }
        r2 = requests.post(f"{API}/orders", json=payload, timeout=20)
        assert r2.status_code == 201, r2.text
        assert r2.json()["payment_fee"] == 0
    finally:
        # Restore fiveone ON before next tests / final teardown
        admin_session.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True}, timeout=15)
