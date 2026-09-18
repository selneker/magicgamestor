"""Backend tests for Magic Game Store — PUBG UC/Prime top-up shop."""
import os
import time
import uuid

import pytest
import requests

# Prefer BACKEND_TEST_URL override; else use REACT_APP_BACKEND_URL; fall back to localhost.
# NOTE: In this preview env the external ingress currently 404s on /api/*, so we test against localhost:8001.
_ext = os.environ.get("BACKEND_TEST_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
BASE_URL = _ext.rstrip("/")
# Probe: if external URL 404s on /api/, silently fall back to localhost:8001 for tests
try:
    _probe = requests.get(f"{BASE_URL}/api/", timeout=5)
    if _probe.status_code != 200:
        BASE_URL = "http://localhost:8001"
except Exception:
    BASE_URL = "http://localhost:8001"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASSWORD = "Admin@2026!"


# ------------- Fixtures -------------
@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def customer(s):
    email = f"qa_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "QA Tester"})
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "password": "Qa123456", "token": data["access_token"], "user_id": data["user"]["user_id"]}


@pytest.fixture(scope="session")
def customer_headers(customer):
    return {"Authorization": f"Bearer {customer['token']}"}


# ------------- Products -------------
class TestProducts:
    def test_all_active_count_22(self):
        r = requests.get(f"{API}/products")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 22, f"expected 22 active products, got {len(data)}"

    def test_filter_type_uc_14(self):
        r = requests.get(f"{API}/products", params={"type": "uc"})
        assert r.status_code == 200
        assert len(r.json()) == 14

    def test_filter_type_prime_8(self):
        r = requests.get(f"{API}/products", params={"type": "prime,prime_plus"})
        assert r.status_code == 200
        assert len(r.json()) == 8

    def test_popular_filter(self):
        r = requests.get(f"{API}/products", params={"popular": "true"})
        assert r.status_code == 200
        for p in r.json():
            assert p["popular"] is True

    def test_price_range_and_sort_asc(self):
        r = requests.get(f"{API}/products", params={"min_price": 5000, "max_price": 100000, "sort": "price_asc"})
        assert r.status_code == 200
        prices = [p["price"] for p in r.json()]
        assert all(5000 <= p <= 100000 for p in prices)
        assert prices == sorted(prices)

    def test_sort_desc(self):
        r = requests.get(f"{API}/products", params={"sort": "price_desc"})
        prices = [p["price"] for p in r.json()]
        assert prices == sorted(prices, reverse=True)

    def test_search_q(self):
        r = requests.get(f"{API}/products", params={"q": "uc"})
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_product_detail_with_related(self):
        r = requests.get(f"{API}/products/60-uc")
        assert r.status_code == 200
        data = r.json()
        assert data["slug"] == "60-uc"
        assert "related" in data and isinstance(data["related"], list)
        assert len(data["related"]) <= 4
        for rp in data["related"]:
            assert rp["slug"] != "60-uc"
            assert rp["type"] == data["type"]

    def test_product_not_found(self):
        r = requests.get(f"{API}/products/does-not-exist")
        assert r.status_code == 404


# ------------- Auth -------------
class TestAuth:
    def test_register_sets_cookies_and_returns_token(self):
        s = requests.Session()
        email = f"qa_reg_{int(time.time())}_{uuid.uuid4().hex[:4]}@test.mg"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "QA Tester"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["email"] == email
        assert data["user"]["role"] == "customer"
        assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20
        # cookies set
        cookies = {c.name for c in s.cookies}
        assert "access_token" in cookies
        assert "refresh_token" in cookies

    def test_register_duplicate_email(self, customer):
        r = requests.post(f"{API}/auth/register", json={"email": customer["email"], "password": "Qa123456", "name": "Dup"})
        assert r.status_code == 409

    def test_login_admin_ok(self, admin_token):
        assert admin_token

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-nope"})
        assert r.status_code == 401

    def test_5_wrong_attempts_lock(self):
        # Use a unique bad email to isolate lock keying (identifier is ip:email)
        bad_email = f"lock_{int(time.time())}_{uuid.uuid4().hex[:4]}@test.mg"
        codes = []
        for _ in range(8):
            r = requests.post(f"{API}/auth/login", json={"email": bad_email, "password": "wrong"})
            codes.append(r.status_code)
        # Expect 429 eventually. NOTE: In K8s ingress behind multi-pod backend,
        # request.client.host rotates between pod IPs, splitting the failure counter
        # and defeating the lockout entirely (security bug).
        assert 429 in codes, f"expected 429 after ~5 wrong attempts, got: {codes}. LIKELY BUG: brute-force lockout keyed on request.client.host which rotates behind proxy."

    def test_me_with_bearer(self, customer_headers, customer):
        r = requests.get(f"{API}/auth/me", headers=customer_headers)
        assert r.status_code == 200
        assert r.json()["email"] == customer["email"]

    def test_me_with_cookie(self):
        if BASE_URL.startswith("http://"):
            pytest.skip("Cookies are Secure+SameSite=None; requests won't send them over plain HTTP. Prod uses HTTPS.")
        s = requests.Session()
        email = f"qa_cook_{int(time.time())}_{uuid.uuid4().hex[:4]}@test.mg"
        s.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "Cook"})
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == email

    def test_patch_me(self, customer_headers):
        r = requests.patch(f"{API}/auth/me", headers=customer_headers,
                           json={"name": "QA Updated", "phone": "0341234567", "saved_pubg_ids": ["5123456789", "5123456789", "abc"]})
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "QA Updated"
        assert data["phone"] == "0341234567"
        # duplicates removed, non-digit removed
        assert data["saved_pubg_ids"] == ["5123456789"]

    def test_logout_clears_cookies(self):
        if BASE_URL.startswith("http://"):
            pytest.skip("Cookies are Secure+SameSite=None; requests won't send them over plain HTTP. Prod uses HTTPS.")
        s = requests.Session()
        email = f"qa_out_{int(time.time())}_{uuid.uuid4().hex[:4]}@test.mg"
        s.post(f"{API}/auth/register", json={"email": email, "password": "Qa123456", "name": "Out"})
        assert s.get(f"{API}/auth/me").status_code == 200
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # After logout cookies should be gone → me returns 401
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401


# ------------- Orders -------------
def _get_product_id(slug):
    r = requests.get(f"{API}/products/{slug}")
    return r.json()["id"], r.json()["price"]


class TestOrders:
    def test_create_mvola_requires_phone(self):
        pid, _ = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "Ghost", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola",
        })
        assert r.status_code == 400

    def test_invalid_pubg_id_short(self):
        pid, _ = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "51234567", "pseudo": "Ghost", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        assert r.status_code == 422

    def test_invalid_pubg_id_nondigit(self):
        pid, _ = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "51234abcde", "pseudo": "Ghost", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        assert r.status_code == 422

    def test_unknown_product(self):
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "Ghost",
            "items": [{"product_id": "does-not-exist", "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        assert r.status_code == 400

    def test_create_mvola_order(self):
        pid, price = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "Ghost",
            "items": [{"product_id": pid, "quantity": 2}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["order_number"].startswith("MGS-")
        assert data["status"] == "pending_payment"
        # server computes total (client cannot set price)
        assert data["total"] == price * 2
        return data

    def test_manual_order_awaiting_verification(self):
        pid, _ = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "Ghost",
            "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "manual", "manual_reference": "TX-QA-123",
        })
        assert r.status_code == 201
        assert r.json()["status"] == "awaiting_verification"

    def test_track_wrong_pubg_id(self):
        pid, _ = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "Ghost",
            "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        order_no = r.json()["order_number"]
        r2 = requests.get(f"{API}/orders/track", params={"order_number": order_no, "pubg_id": "9999999999"})
        assert r2.status_code == 404
        r3 = requests.get(f"{API}/orders/track", params={"order_number": order_no, "pubg_id": "5123456789"})
        assert r3.status_code == 200

    def test_orders_me_requires_auth(self):
        r = requests.get(f"{API}/orders/me")
        assert r.status_code == 401

    def test_authed_order_links_user_and_saves_pubg_id(self, customer_headers, customer):
        pid, _ = _get_product_id("60-uc")
        pubg = "5987654321"
        r = requests.post(f"{API}/orders", headers=customer_headers, json={
            "pubg_id": pubg, "pseudo": "AuthGhost",
            "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        assert r.status_code == 201
        assert r.json()["user_id"] == customer["user_id"]
        # saved to user
        me = requests.get(f"{API}/auth/me", headers=customer_headers).json()
        assert pubg in me["saved_pubg_ids"]
        # /orders/me lists it
        my = requests.get(f"{API}/orders/me", headers=customer_headers).json()
        assert any(o["order_number"] == r.json()["order_number"] for o in my)


# ------------- Payments -------------
class TestPayments:
    def _create_order(self):
        pid, _ = _get_product_id("60-uc")
        r = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "PayGhost",
            "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567",
        })
        return r.json()

    def test_initiate_simulated(self):
        order = self._create_order()
        r = requests.post(f"{API}/payments/initiate", json={"order_id": order["id"]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["simulated"] is True
        assert data["provider_ref"].startswith("sim-")

    def test_status_pending_then_completed(self):
        order = self._create_order()
        requests.post(f"{API}/payments/initiate", json={"order_id": order["id"]})
        r1 = requests.get(f"{API}/payments/{order['id']}/status")
        assert r1.status_code == 200
        assert r1.json()["payment_status"] == "pending"
        time.sleep(10)  # simulated auto-completes 8s after initiation
        r2 = requests.get(f"{API}/payments/{order['id']}/status")
        j = r2.json()
        assert j["payment_status"] == "completed", j
        assert j["order_status"] == "paid"

    def test_admin_simulate_failed(self, admin_headers):
        order = self._create_order()
        requests.post(f"{API}/payments/initiate", json={"order_id": order["id"]})
        r = requests.post(f"{API}/payments/{order['id']}/simulate", json={"outcome": "failed"}, headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "failed"
        # order becomes failed
        o = requests.get(f"{API}/orders/{order['id']}").json()
        assert o["status"] == "failed"

    def test_mvola_callback_removed(self):
        # Legacy endpoint should no longer exist (migrated to PAPI).
        r = requests.put(f"{API}/payments/mvola/callback",
                         json={"serverCorrelationId": "sim-nope-xxx", "transactionStatus": "completed"})
        assert r.status_code in (404, 405), r.status_code

    def test_orange_notification_removed(self):
        r = requests.post(f"{API}/payments/orange/notification", json={"notif_token": "nope", "status": "SUCCESS"})
        assert r.status_code in (404, 405), r.status_code

    def test_payments_config(self):
        r = requests.get(f"{API}/payments/config")
        assert r.status_code == 200
        j = r.json()
        assert j["mode"] == "simulation"
        assert j["live"] is False
        assert j["gateway"] == "papi"
        assert "mvola" in j["providers"] and "orange" in j["providers"]

    def test_papi_notification_unsigned_401(self):
        r = requests.post(f"{API}/payments/papi/notification",
                          json={"merchantPaymentReference": "nope", "notificationToken": "nope"})
        assert r.status_code == 401


# ------------- Health -------------
class TestHealth:
    def test_health_root(self):
        # /health is NOT under /api
        r = requests.get(f"{BASE_URL}/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_api_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ------------- Admin -------------
class TestAdmin:
    def test_customer_forbidden_on_admin(self, customer_headers):
        r = requests.get(f"{API}/admin/orders", headers=customer_headers)
        assert r.status_code == 403

    def test_admin_orders_and_filter(self, admin_headers):
        r = requests.get(f"{API}/admin/orders", headers=admin_headers, params={"status": "all"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_patch_and_delete_order(self, admin_headers):
        # create order to update
        pid, _ = _get_product_id("60-uc")
        order = requests.post(f"{API}/orders", json={
            "pubg_id": "5123456789", "pseudo": "AdminTest",
            "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "manual", "manual_reference": "ADM-QA",
        }).json()
        r = requests.patch(f"{API}/admin/orders/{order['id']}", headers=admin_headers, json={"status": "delivered"})
        assert r.status_code == 200
        assert r.json()["status"] == "delivered"
        # delete
        r2 = requests.delete(f"{API}/admin/orders/{order['id']}", headers=admin_headers)
        assert r2.status_code == 200

    def test_admin_stats(self, admin_headers):
        r = requests.get(f"{API}/admin/stats", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        for key in ("revenue", "status_count", "by_method", "daily", "top_products"):
            assert key in j

    def test_admin_export_csv(self, admin_headers):
        r = requests.get(f"{API}/admin/export", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "order_number" in r.text

    def test_admin_status_toggle(self, admin_headers):
        r = requests.post(f"{API}/admin/status", headers=admin_headers, json={"online": False})
        assert r.status_code == 200
        assert requests.get(f"{API}/settings/status").json()["online"] is False
        # restore
        requests.post(f"{API}/admin/status", headers=admin_headers, json={"online": True})
        assert requests.get(f"{API}/settings/status").json()["online"] is True

    def test_products_crud(self, admin_headers):
        slug = f"qa-{uuid.uuid4().hex[:6]}"
        create = requests.post(f"{API}/admin/products", headers=admin_headers, json={
            "slug": slug, "type": "uc", "name": "QA 10 UC", "price": 1000,
        })
        assert create.status_code == 200, create.text
        pid = create.json()["id"]
        upd = requests.put(f"{API}/admin/products/{pid}", headers=admin_headers, json={
            "slug": slug, "type": "uc", "name": "QA 10 UC v2", "price": 1500,
        })
        assert upd.status_code == 200 and upd.json()["price"] == 1500
        d = requests.delete(f"{API}/admin/products/{pid}", headers=admin_headers)
        assert d.status_code == 200

    def test_events_crud_and_like(self, admin_headers):
        slug = f"qa-evt-{uuid.uuid4().hex[:6]}"
        c = requests.post(f"{API}/admin/events", headers=admin_headers, json={
            "slug": slug, "title_fr": "QA Event", "title_en": "QA Event",
        })
        assert c.status_code == 200, c.text
        eid = c.json()["id"]
        # like
        session_id = f"qa-sess-{uuid.uuid4().hex}"
        l = requests.post(f"{API}/events/{eid}/like", json={"session_id": session_id})
        assert l.status_code == 200
        assert l.json()["liked"] is True
        # toggle off
        l2 = requests.post(f"{API}/events/{eid}/like", json={"session_id": session_id})
        assert l2.json()["liked"] is False
        # list contains the event
        events = requests.get(f"{API}/events").json()
        assert any(e["id"] == eid for e in events)
        # delete
        d = requests.delete(f"{API}/admin/events/{eid}", headers=admin_headers)
        assert d.status_code == 200
