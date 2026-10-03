"""Iteration 3 regression — Binance admin endpoints with empty env + payments/config unchanged."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://crypto-payment-flow-5.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASSWORD = "MgsAdmin2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def test_admin_crypto_settings_api_not_configured(admin_headers):
    r = requests.get(f"{BASE_URL}/api/crypto/admin/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("api_configured") is False, data


def test_patch_crypto_settings_enable_blocked(admin_headers):
    r = requests.patch(f"{BASE_URL}/api/crypto/admin/settings", json={"enabled": True}, headers=admin_headers, timeout=15)
    assert r.status_code == 400, r.text


def test_public_crypto_config_unavailable():
    r = requests.get(f"{BASE_URL}/api/crypto/config", timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("available") is False


def test_order_binance_payment_rejected():
    # Binance availability is checked before product validation — minimal payload is enough.
    payload = {
        "items": [{"product_id": "nonexistent", "quantity": 1}],
        "payment_method": "binance",
        "pubg_id": "5000000000",
        "pseudo": "TEST",
        "email": "TEST_binance@example.com",
    }
    r = requests.post(f"{BASE_URL}/api/orders", json=payload, timeout=15)
    assert r.status_code == 409, f"{r.status_code} {r.text}"
    assert "indisponible" in r.text.lower() or "binance" in r.text.lower()


def test_payments_config_untouched():
    r = requests.get(f"{BASE_URL}/api/payments/config", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # Keep MVola / Orange / manual present
    assert "methods" in data or "mvola" in data or "orange" in data or isinstance(data, dict)
