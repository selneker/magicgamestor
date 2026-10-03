"""Iter15 — live endpoint checks for Phase 3 FazerCards (no order created)."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://price-alert-v3.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASS = "AdminLocal2026!"
TARGET_ORDER_ID = "6a695f32-4271-4e2e-9b93-4ca3f940c580"
TARGET_ORDER_NUMBER = "MGS-33861A"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


class TestPhase3LiveEndpoints:
    def test_settings_requires_auth(self):
        r = requests.get(f"{API}/admin/fazercards/settings", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_settings_returns_fzr_auto_false(self, admin_headers):
        r = requests.get(f"{API}/admin/fazercards/settings", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "fzr_auto" in data and data["fzr_auto"] is False, f"fzr_auto not OFF: {data}"
        assert "webhook_configured" in data
        print(f"settings: {data}")

    def test_price_alerts(self, admin_headers):
        r = requests.get(f"{API}/admin/fazercards/price-alerts", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data and isinstance(data["alerts"], list)
        assert "unacknowledged" in data
        print(f"price-alerts: {len(data['alerts'])} alerts, unack={data['unacknowledged']}")

    def test_mappings_includes_60uc(self, admin_headers):
        r = requests.get(f"{API}/admin/fazercards/mappings", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "products" in data
        linked = [p for p in data["products"] if p.get("fazercards_mapping")]
        print(f"mappings: {len(data['products'])} products, {len(linked)} linked")
        uc60 = next((p for p in data["products"] if (p.get("name") == "60 UC" or p.get("slug") == "60-uc")), None)
        assert uc60 is not None, "60 UC product missing"
        assert uc60.get("fazercards_mapping"), f"60 UC has no mapping: {uc60}"
        m = uc60["fazercards_mapping"]
        assert m.get("category_id") == "pubg_mobile_auto"
        assert m.get("offer_id") in ("uc_60", "60_uc")
        assert "price_usd_at_link" in m
        print(f"60 UC mapping: {m}")

    def test_webhook_unsigned_401(self):
        r = requests.post(f"{API}/fazercards/webhook", json={"event": "order.status_changed"}, timeout=15)
        assert r.status_code == 401

    def test_preflight_target_order(self, admin_headers):
        r = requests.get(f"{API}/admin/orders/{TARGET_ORDER_ID}/fazercards/preflight",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200, f"preflight failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        print(f"preflight keys: {list(data.keys())}")
        print(f"preflight: {data}")
        # idempotency_key MGS-33861A-1
        idem = data.get("idempotency_key") or (data.get("provider_payload", {}) or {}).get("idempotency_key")
        assert idem == f"{TARGET_ORDER_NUMBER}-1", f"idempotency_key mismatch: got {idem}"
