"""Iteration 12 - Pack Evolutif + /orders/me history tests."""
import os
import time
import uuid
import concurrent.futures

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://mgs-evolvable-pack.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASSWORD = "AdminLocal2026!"

EVO_SLUGS = {
    "evo-fragments-materiaux": {"price": 17000, "limit": "season"},
    "evo-premier-achat": {"price": 5800, "limit": "lifetime"},
    "evo-embleme-mythique": {"price": 20500, "limit": "week"},
    "evo-fragments-mythique": {"price": 24000, "limit": "season"},
}


def _fresh_pubg():
    # random 10-digit id starting with 6 to reduce collisions
    return "6" + str(uuid.uuid4().int)[:9]


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def evo_products():
    r = requests.get(f"{API}/products", params={"type": "evo"}, timeout=15)
    assert r.status_code == 200
    items = r.json()
    by_slug = {p["slug"]: p for p in items}
    for slug in EVO_SLUGS:
        assert slug in by_slug, f"missing evo product {slug}"
    return by_slug


def _register(email_prefix):
    email = f"TEST_{email_prefix}_{uuid.uuid4().hex[:6]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!TEST", "name": email_prefix}, timeout=15)
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text}"
    # auto-logged in via cookies typically; ensure
    if not s.cookies:
        s.post(f"{API}/auth/login", json={"email": email, "password": "Passw0rd!TEST"}, timeout=15)
    return s, email


# ---------- Catalog tests ----------
def test_products_evo_returns_4_offers(evo_products):
    assert len(evo_products) >= 4
    for slug, exp in EVO_SLUGS.items():
        p = evo_products[slug]
        assert p["price"] == exp["price"], f"{slug} price mismatch: {p['price']}"
        assert p.get("evo_limit") == exp["limit"], f"{slug} evo_limit mismatch"
        assert p["type"] == "evo"


def test_evo_season_endpoint():
    r = requests.get(f"{API}/evo/season", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("season") is not None
    assert data["season"].get("active") is True
    assert "week" in data
    assert data["week"].startswith("20") and "-W" in data["week"]


# ---------- Eligibility ----------
def test_eligibility_new_id(evo_products):
    p = evo_products["evo-fragments-materiaux"]
    pid = _fresh_pubg()
    r = requests.get(f"{API}/evo/eligibility", params={"product_id": p["id"], "pubg_id": pid}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["eligible"] is True


def test_eligibility_invalid_pubg(evo_products):
    p = evo_products["evo-fragments-materiaux"]
    r = requests.get(f"{API}/evo/eligibility", params={"product_id": p["id"], "pubg_id": "12"}, timeout=15)
    assert r.status_code == 400
    r2 = requests.get(f"{API}/evo/eligibility", params={"product_id": p["id"], "pubg_id": "abcdefghi"}, timeout=15)
    assert r2.status_code == 400


def test_eligibility_unknown_product():
    r = requests.get(f"{API}/evo/eligibility", params={"product_id": "unknown-id", "pubg_id": _fresh_pubg()}, timeout=15)
    assert r.status_code == 404


# ---------- Helpers ----------
def _place_order(product_id, pubg_id, session=None, pseudo="TestPlayer"):
    s = session or requests
    body = {
        "pubg_id": pubg_id, "pseudo": pseudo,
        "items": [{"product_id": product_id, "quantity": 1}],
        "payment_method": "manual", "manual_reference": f"mvola:{uuid.uuid4().hex[:8]}",
    }
    return s.post(f"{API}/orders", json=body, timeout=20)


# ---------- Season offer flow ----------
def test_fragments_materiaux_season_flow(admin_session, evo_products):
    p = evo_products["evo-fragments-materiaux"]
    pid = _fresh_pubg()
    r1 = _place_order(p["id"], pid)
    assert r1.status_code == 201, r1.text
    order1 = r1.json()
    # Validate evo item fields snapshot
    item = order1["items"][0]
    assert item["evo_limit"] == "season"
    assert item.get("period_key", "").startswith("season:")
    assert item.get("season_id") and item.get("season_name")
    assert order1["total"] == p["price"]
    assert item["unit_price"] == p["price"]

    # 2nd same offer same season -> 409
    r2 = _place_order(p["id"], pid)
    assert r2.status_code == 409, r2.text

    # Cancel first order
    rc = admin_session.patch(f"{API}/admin/orders/{order1['id']}", json={"status": "cancelled"}, timeout=15)
    assert rc.status_code == 200, rc.text

    # Now eligible again
    r3 = requests.get(f"{API}/evo/eligibility", params={"product_id": p["id"], "pubg_id": pid}, timeout=15)
    assert r3.status_code == 200 and r3.json()["eligible"] is True
    # And place another
    r4 = _place_order(p["id"], pid)
    assert r4.status_code == 201
    order2 = r4.json()

    # Cleanup: cancel order2 to release lock
    admin_session.patch(f"{API}/admin/orders/{order2['id']}", json={"status": "cancelled"}, timeout=15)


def test_new_season_frees_id(admin_session, evo_products):
    p = evo_products["evo-fragments-mythique"]
    pid = _fresh_pubg()
    r1 = _place_order(p["id"], pid)
    assert r1.status_code == 201, r1.text
    order1 = r1.json()

    # 2nd same season -> 409
    r2 = _place_order(p["id"], pid)
    assert r2.status_code == 409

    # Save current active season to restore later
    seasons_before = admin_session.get(f"{API}/admin/seasons", timeout=15).json()
    active_before = next((s for s in seasons_before if s.get("active")), None)
    assert active_before is not None

    # Create new active season
    new_name = f"TEST Saison {uuid.uuid4().hex[:6]}"
    rs = admin_session.post(f"{API}/admin/seasons", json={"name": new_name, "activate": True}, timeout=15)
    assert rs.status_code == 201, rs.text
    new_season = rs.json()

    try:
        # Now eligible again in new season
        r3 = requests.get(f"{API}/evo/eligibility", params={"product_id": p["id"], "pubg_id": pid}, timeout=15)
        assert r3.status_code == 200 and r3.json()["eligible"] is True

        r4 = _place_order(p["id"], pid)
        assert r4.status_code == 201
        order2 = r4.json()
        admin_session.patch(f"{API}/admin/orders/{order2['id']}", json={"status": "cancelled"}, timeout=15)
    finally:
        # Reactivate the original season, keep new season inactive
        act = admin_session.post(f"{API}/admin/seasons/{active_before['id']}/activate", timeout=15)
        assert act.status_code == 200
        admin_session.patch(f"{API}/admin/orders/{order1['id']}", json={"status": "cancelled"}, timeout=15)


# ---------- Lifetime ----------
def test_premier_achat_lifetime(admin_session, evo_products):
    p = evo_products["evo-premier-achat"]
    pid = _fresh_pubg()
    r1 = _place_order(p["id"], pid)
    assert r1.status_code == 201
    order1 = r1.json()
    assert order1["items"][0]["evo_limit"] == "lifetime"
    assert order1["items"][0]["period_key"] == "lifetime"

    r2 = _place_order(p["id"], pid)
    assert r2.status_code == 409

    # Even creating a new season doesn't help
    seasons_before = admin_session.get(f"{API}/admin/seasons", timeout=15).json()
    active_before = next((s for s in seasons_before if s.get("active")), None)
    rs = admin_session.post(f"{API}/admin/seasons", json={"name": f"TEST L {uuid.uuid4().hex[:6]}", "activate": True}, timeout=15)
    assert rs.status_code == 201
    try:
        r3 = _place_order(p["id"], pid)
        assert r3.status_code == 409
    finally:
        admin_session.post(f"{API}/admin/seasons/{active_before['id']}/activate", timeout=15)
        admin_session.patch(f"{API}/admin/orders/{order1['id']}", json={"status": "cancelled"}, timeout=15)


# ---------- Week ----------
def test_embleme_mythique_week(admin_session, evo_products):
    p = evo_products["evo-embleme-mythique"]
    pid = _fresh_pubg()
    r1 = _place_order(p["id"], pid)
    assert r1.status_code == 201, r1.text
    order1 = r1.json()
    item = order1["items"][0]
    assert item["evo_limit"] == "week"
    assert item["period_key"].startswith("week:")
    assert item.get("week_key")

    # Mark first as paid so the "already this week" message is used (else "en cours" is shown)
    rp = admin_session.patch(f"{API}/admin/orders/{order1['id']}", json={"status": "paid"}, timeout=15)
    assert rp.status_code == 200, rp.text

    r2 = _place_order(p["id"], pid)
    assert r2.status_code == 409
    assert "semaine" in r2.json().get("detail", "").lower(), r2.json()

    admin_session.patch(f"{API}/admin/orders/{order1['id']}", json={"status": "cancelled"}, timeout=15)


# ---------- Concurrency ----------
def test_concurrent_orders_same_id(admin_session, evo_products):
    p = evo_products["evo-fragments-materiaux"]
    pid = _fresh_pubg()

    def submit():
        return _place_order(p["id"], pid)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futs = [ex.submit(submit), ex.submit(submit)]
        results = [f.result() for f in futs]
    codes = sorted([r.status_code for r in results])
    assert codes == [201, 409], f"expected [201, 409] got {codes}: {[r.text for r in results]}"
    # cleanup
    for r in results:
        if r.status_code == 201:
            admin_session.patch(f"{API}/admin/orders/{r.json()['id']}", json={"status": "cancelled"}, timeout=15)


# ---------- Order validation ----------
def test_evo_quantity_2_rejected(evo_products):
    p = evo_products["evo-fragments-materiaux"]
    body = {
        "pubg_id": _fresh_pubg(), "pseudo": "T",
        "items": [{"product_id": p["id"], "quantity": 2}],
        "payment_method": "manual", "manual_reference": "mvola:x",
    }
    r = requests.post(f"{API}/orders", json=body, timeout=15)
    # pseudo min_length 2, use proper
    if r.status_code == 422:
        body["pseudo"] = "TestPlayer"
        r = requests.post(f"{API}/orders", json=body, timeout=15)
    assert r.status_code == 400, r.text


def test_evo_duplicate_offer_in_items(evo_products):
    p = evo_products["evo-fragments-materiaux"]
    body = {
        "pubg_id": _fresh_pubg(), "pseudo": "TestPlayer",
        "items": [{"product_id": p["id"], "quantity": 1}, {"product_id": p["id"], "quantity": 1}],
        "payment_method": "manual", "manual_reference": "mvola:x",
    }
    r = requests.post(f"{API}/orders", json=body, timeout=15)
    assert r.status_code == 400, r.text


def _product_update_body(p, **overrides):
    """PUT /admin/products requires full body — build from current product doc."""
    fields = ["slug", "type", "evo_limit", "name", "name_en", "uc_amount", "duration_months",
              "price", "old_price", "popular", "badge", "description_fr", "description_en",
              "active", "sort_order"]
    body = {k: p.get(k) for k in fields if p.get(k) is not None or k in ("description_fr", "description_en", "active", "popular", "sort_order", "price")}
    body.update(overrides)
    return body


# ---------- Inactive product ----------
def test_inactive_evo_offer(admin_session, evo_products):
    p = evo_products["evo-premier-achat"]
    # Deactivate
    rd = admin_session.put(f"{API}/admin/products/{p['id']}", json=_product_update_body(p, active=False), timeout=15)
    assert rd.status_code == 200, rd.text
    try:
        r = requests.get(f"{API}/evo/eligibility", params={"product_id": p["id"], "pubg_id": _fresh_pubg()}, timeout=15)
        assert r.status_code == 200
        assert r.json()["eligible"] is False
        assert "disponible" in r.json()["reason"].lower()

        r2 = _place_order(p["id"], _fresh_pubg())
        assert r2.status_code == 400
    finally:
        admin_session.put(f"{API}/admin/products/{p['id']}", json=_product_update_body(p, active=True), timeout=15)


# ---------- Price history ----------
def test_price_history_snapshot(admin_session, evo_products):
    p = evo_products["evo-fragments-materiaux"]
    original_price = p["price"]
    pid1 = _fresh_pubg()
    r1 = _place_order(p["id"], pid1)
    assert r1.status_code == 201
    order1 = r1.json()
    assert order1["total"] == original_price

    # change price
    new_price = original_price + 1000
    rp = admin_session.put(f"{API}/admin/products/{p['id']}", json=_product_update_body(p, price=new_price), timeout=15)
    assert rp.status_code == 200, rp.text
    try:
        # old order still has old price
        rget = admin_session.get(f"{API}/admin/orders", timeout=15)
        assert rget.status_code == 200
        fetched = next((o for o in rget.json() if o["id"] == order1["id"]), None)
        assert fetched and fetched["total"] == original_price
        assert fetched["items"][0]["unit_price"] == original_price

        # new order uses new price
        pid2 = _fresh_pubg()
        r2 = _place_order(p["id"], pid2)
        assert r2.status_code == 201
        order2 = r2.json()
        assert order2["total"] == new_price
        assert order2["items"][0]["unit_price"] == new_price
        admin_session.patch(f"{API}/admin/orders/{order2['id']}", json={"status": "cancelled"}, timeout=15)
    finally:
        admin_session.put(f"{API}/admin/products/{p['id']}", json=_product_update_body(p, price=original_price), timeout=15)
        admin_session.patch(f"{API}/admin/orders/{order1['id']}", json={"status": "cancelled"}, timeout=15)


# ---------- /orders/me ----------
def test_orders_me_unauth():
    r = requests.get(f"{API}/orders/me", timeout=15)
    assert r.status_code == 401


def test_orders_me_scoped_and_sorted(evo_products):
    p = evo_products["evo-embleme-mythique"]
    sA, emailA = _register("userA")
    sB, emailB = _register("userB")

    pidA = _fresh_pubg()
    rA = _place_order(p["id"], pidA, session=sA)
    assert rA.status_code == 201, rA.text
    orderA = rA.json()

    pidB = _fresh_pubg()
    # Use a different offer to avoid week collision if same week key not an issue since different pid
    p2 = evo_products["evo-fragments-mythique"]
    rB = _place_order(p2["id"], pidB, session=sB)
    assert rB.status_code == 201

    # A's /orders/me should only contain A's order
    rMeA = sA.get(f"{API}/orders/me", timeout=15)
    assert rMeA.status_code == 200
    ordersA = rMeA.json()
    assert all(o["user_id"] for o in ordersA)
    assert any(o["id"] == orderA["id"] for o in ordersA)
    assert not any(o["id"] == rB.json()["id"] for o in ordersA)
    # sorted desc
    dates = [o["created_at"] for o in ordersA]
    assert dates == sorted(dates, reverse=True)

    # B cannot fetch A's order by id (403)
    rGetA = sB.get(f"{API}/orders/{orderA['id']}", timeout=15)
    assert rGetA.status_code == 403

    # cleanup
    admin_s = requests.Session()
    admin_s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    admin_s.patch(f"{API}/admin/orders/{orderA['id']}", json={"status": "cancelled"}, timeout=15)
    admin_s.patch(f"{API}/admin/orders/{rB.json()['id']}", json={"status": "cancelled"}, timeout=15)


# ---------- Admin seasons permissions ----------
def test_admin_seasons_permissions(admin_session):
    r = requests.get(f"{API}/admin/seasons", timeout=15)
    assert r.status_code in (401, 403)
    r2 = requests.post(f"{API}/admin/seasons", json={"name": "X", "activate": True}, timeout=15)
    assert r2.status_code in (401, 403)

    rs = admin_session.get(f"{API}/admin/seasons", timeout=15)
    assert rs.status_code == 200
    seasons = rs.json()
    actives = [s for s in seasons if s.get("active")]
    assert len(actives) == 1, f"expected exactly one active season, got {len(actives)}"
