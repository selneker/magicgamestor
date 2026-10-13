"""Supplementary tests for Phase 3 review (orders + saved identities). Local backend, simulation payments."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def pubg_uc_product():
    products = requests.get(f"{API}/products?game=pubg-mobile", timeout=20).json()
    uc = [p for p in products if p.get("type") == "uc" and p.get("active", True)]
    assert uc, "need an active PUBG uc product"
    return uc[0]


# ---- Orders ----
def test_order_rejects_8_digit_pubg_id(pubg_uc_product):
    body = {
        "game_id": "pubg-mobile",
        "pubg_id": "51234567",  # 8 digits => invalid
        "pseudo": "Tester",
        "items": [{"product_id": pubg_uc_product["id"], "quantity": 1}],
        "payment_method": "mvola",
        "payment_phone": "0341234567",
    }
    r = requests.post(f"{API}/orders", json=body, timeout=20)
    assert r.status_code == 422, r.text


def test_order_happy_path_simulation(pubg_uc_product):
    body = {
        "game_id": "pubg-mobile",
        "pubg_id": "5123456789",
        "pseudo": "Tester",
        "items": [{"product_id": pubg_uc_product["id"], "quantity": 1}],
        "payment_method": "manual",
        "payment_phone": "0341234567",
        "manual_reference": "QAREF123",
    }
    r = requests.post(f"{API}/orders", json=body, timeout=20)
    assert r.status_code in (200, 201), r.text
    data = r.json()
    snap = data.get("identity_snapshot") or {}
    fields = snap.get("fields") or {}
    assert fields.get("player_id") == "5123456789", data


def test_order_rejects_product_from_other_game(admin_headers, pubg_uc_product):
    # Create a secondary active game with an active product, then mix.
    gid = f"qa-{uuid.uuid4().hex[:6]}"
    g = requests.post(f"{API}/admin/games", json={
        "id": gid, "name": "QA Mix Game", "active": False, "currency_label": "CP",
        "product_types": [{"key": "cp", "label": "CP"}],
        "identity_fields": [{"key": "uid", "label": "UID", "pattern": "[0-9]{6,12}"}],
    }, headers=admin_headers, timeout=20)
    assert g.status_code == 201, g.text
    try:
        slug = f"qa-{uuid.uuid4().hex[:8]}"
        p = requests.post(f"{API}/admin/products", json={
            "slug": slug, "type": "cp", "name": "QA 80 CP", "price": 5000,
            "game_id": gid, "active": True, "uc_amount": 80,
        }, headers=admin_headers, timeout=20)
        assert p.status_code == 200, p.text
        other_pid = p.json()["id"]
        body = {
            "game_id": "pubg-mobile",
            "pubg_id": "5123456789",
            "pseudo": "Tester",
            "items": [
                {"product_id": pubg_uc_product["id"], "quantity": 1},
                {"product_id": other_pid, "quantity": 1},
            ],
            "payment_method": "manual",
            "payment_phone": "0341234567",
            "manual_reference": "QAREF456",
        }
        r = requests.post(f"{API}/orders", json=body, timeout=20)
        assert r.status_code == 400, r.text
    finally:
        # Cleanup
        requests.delete(f"{API}/admin/games/{gid}", headers=admin_headers, timeout=20)


# ---- Saved identities ----
@pytest.fixture(scope="module")
def user_headers():
    email = f"qa-user-{uuid.uuid4().hex[:6]}@example.com"
    pwd = "QaPassword!2026"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": pwd, "name": "QA User"}, timeout=20)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed: {r.status_code} {r.text}")
    tok = r.json().get("access_token")
    if not tok:
        lr = requests.post(f"{API}/auth/login",
                          json={"email": email, "password": pwd}, timeout=20)
        assert lr.status_code == 200, lr.text
        tok = lr.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def test_saved_identity_rejects_short_player_id(user_headers):
    r = requests.post(f"{API}/me/game-identities",
                      json={"game_id": "pubg-mobile", "fields": {"player_id": "123"}},
                      headers=user_headers, timeout=20)
    assert r.status_code in (400, 422), r.text


def test_saved_identity_accepts_valid_and_patch_validates(user_headers):
    r = requests.post(f"{API}/me/game-identities",
                      json={"game_id": "pubg-mobile", "fields": {"player_id": "5123456789"}},
                      headers=user_headers, timeout=20)
    assert r.status_code in (200, 201), r.text
    ident = r.json()
    ident_id = ident.get("id")
    assert ident_id, ident
    # PATCH with invalid player id
    patch = requests.patch(f"{API}/me/game-identities/{ident_id}",
                           json={"fields": {"player_id": "bad"}},
                           headers=user_headers, timeout=20)
    assert patch.status_code in (400, 422), patch.text
    # cleanup
    requests.delete(f"{API}/me/game-identities/{ident_id}",
                    headers=user_headers, timeout=20)
