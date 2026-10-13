"""Iter6 extras: push config gating and admin transitions via public URL."""
import os
import httpx
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://theme-chat-subs-ui.preview.emergentagent.com").rstrip("/") + "/api"
ADMIN = {"email": "admin@magicgame.store", "password": "Admin12345!"}


@pytest.fixture(scope="module")
def admin_client():
    c = httpx.Client(base_url=BASE, timeout=30)
    r = c.post("/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        c.headers["Authorization"] = f"Bearer {token}"
    return c


def test_push_config_admin_ok(admin_client):
    r = admin_client.get("/admin/push/config")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("configured") is True
    assert isinstance(data.get("public_key"), str) and len(data["public_key"]) > 10


def test_push_config_non_admin_blocked():
    with httpx.Client(base_url=BASE, timeout=20) as c:
        r = c.get("/admin/push/config")
        assert r.status_code in (401, 403), r.status_code


def test_products_public_url_works():
    with httpx.Client(base_url=BASE, timeout=20) as c:
        r = c.get("/products")
        assert r.status_code == 200
        data = r.json()
        items = data.get("items", data) if isinstance(data, dict) else data
        types = {p["type"] for p in items}
        assert {"uc", "prime", "prime_plus"}.issubset(types)
