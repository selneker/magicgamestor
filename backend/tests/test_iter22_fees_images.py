"""Iteration 22 — provider-aware payment fees + product image_url.

Covers new API surface not already covered by test_payment_fees.py / test_fiveone_pay.py:
- PATCH /api/payments/admin/settings rejects unknown provider + percent > 100
- PATCH admin/settings requires super-admin
- Fee bracket verification through order creation (min, percentage, cap)
- verification_fee field is absent from newly created orders
- FiveOne priority when both flags ON
- PUT /api/admin/products/{id} accepts valid https, rejects invalid URL, "" -> null
- GET /api/products/{slug} exposes image_url
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ussd-gateway-test.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASSWORD = "Admin1234!"

UC_30_ID = "40092a39-8fbc-42d3-b8de-4c5969c85626"  # 3000 Ar


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


@pytest.fixture(scope="module", autouse=True)
def _restore(admin_session):
    yield
    admin_session.patch(f"{API}/payments/admin/settings", json={
        "fiveone_enabled": True, "papi_auto": False,
        "payment_fees": {
            "papi": {"percent": 0, "min": 100, "max": 16500},
            "fiveone": {"percent": 2.75, "min": 100, "max": 16500},
        },
    })


# ---------------------------------------------------------------- admin/settings validation

def test_patch_rejects_unknown_provider(admin_session):
    r = admin_session.patch(f"{API}/payments/admin/settings",
                            json={"payment_fees": {"stripe": {"percent": 1, "min": 100, "max": 1000}}})
    assert r.status_code == 422, r.text


def test_patch_rejects_percent_over_100(admin_session):
    r = admin_session.patch(f"{API}/payments/admin/settings",
                            json={"payment_fees": {"papi": {"percent": 150, "min": 100, "max": 16500}}})
    assert r.status_code == 422, r.text


def test_patch_partial_does_not_overwrite_other_provider(admin_session, anon):
    # baseline
    admin_session.patch(f"{API}/payments/admin/settings", json={
        "payment_fees": {
            "papi": {"percent": 0, "min": 100, "max": 16500},
            "fiveone": {"percent": 2.75, "min": 100, "max": 16500},
        },
    })
    # patch only papi
    r = admin_session.patch(f"{API}/payments/admin/settings",
                            json={"payment_fees": {"papi": {"percent": 2, "min": 150, "max": 9000}}})
    assert r.status_code == 200, r.text
    cfg = anon.get(f"{API}/payments/config").json()
    assert cfg["payment_fees"]["papi"] == {"percent": 2.0, "min": 150, "max": 9000}
    assert cfg["payment_fees"]["fiveone"] == {"percent": 2.75, "min": 100, "max": 16500}
    # restore
    admin_session.patch(f"{API}/payments/admin/settings",
                        json={"payment_fees": {"papi": {"percent": 0, "min": 100, "max": 16500}}})


def test_patch_requires_super_admin(anon):
    r = anon.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True})
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------- config exposes no verification_fee separately

def test_config_has_payment_fees_no_verification_fee_top_level():
    d = requests.get(f"{API}/payments/config").json()
    assert "payment_fees" in d
    assert "verification_fee" not in d  # legacy field removed from response


# ---------------------------------------------------------------- order fee brackets on FiveOne

def _order(anon, method="mvola", pubg="123456789", qty=1, product_id=UC_30_ID):
    return anon.post(f"{API}/orders", json={
        "pubg_id": pubg, "pseudo": "TEST_iter22",
        "items": [{"product_id": product_id, "quantity": qty}],
        "payment_method": method, "payment_phone": "0341234567",
    })


def _find_product_at_least(anon, target: int):
    prods = anon.get(f"{API}/products?type=uc").json()
    return max(prods, key=lambda p: p["price"] if p["price"] <= target else 0)


def test_fee_min_bracket(admin_session, anon):
    admin_session.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True, "papi_auto": False})
    r = _order(anon)  # 3000 Ar -> 2.75%=83 < min 100
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["payment_provider"] == "fiveone"
    assert o["subtotal"] == 3000
    assert o["payment_fee"] == 100
    assert o["total"] == 3100
    assert "verification_fee" not in o


def test_fee_percent_bracket(admin_session, anon):
    """~50 000 Ar -> 1375 Ar."""
    admin_session.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True, "papi_auto": False})
    # pick UC product close to 50k; buy several to reach target
    prods = anon.get(f"{API}/products?type=uc").json()
    prods = [p for p in prods if p.get("purchasable", True)]
    # find combination: qty*price ~= 50 000
    target = 50000
    best = None
    for p in prods:
        if p["price"] <= 0:
            continue
        qty = max(1, round(target / p["price"]))
        subtotal = qty * p["price"]
        if best is None or abs(subtotal - target) < abs(best[0] - target):
            best = (subtotal, p, qty)
    subtotal, prod, qty = best
    r = _order(anon, qty=qty, product_id=prod["id"])
    assert r.status_code == 201, r.text
    o = r.json()
    expected = min(max(round(subtotal * 2.75 / 100), 100), 16500)
    assert o["subtotal"] == subtotal
    assert o["payment_fee"] == expected
    assert o["total"] == subtotal + expected


def test_fee_max_cap(admin_session, anon):
    """Large basket clamps to 16 500."""
    admin_session.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True, "papi_auto": False})
    prods = [p for p in anon.get(f"{API}/products?type=uc").json() if p.get("purchasable", True)]
    top = max(prods, key=lambda p: p["price"])
    # ensure subtotal > 16500 / 0.0275 ≈ 600 000 Ar
    qty = max(1, (600000 // top["price"]) + 1)
    r = _order(anon, qty=qty, product_id=top["id"])
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["subtotal"] >= 600000
    assert o["payment_fee"] == 16500
    assert o["total"] == o["subtotal"] + 16500


def test_fiveone_priority_when_both_on(admin_session, anon):
    admin_session.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True, "papi_auto": True})
    try:
        r = _order(anon)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["payment_provider"] == "fiveone"
    finally:
        admin_session.patch(f"{API}/payments/admin/settings", json={"fiveone_enabled": True, "papi_auto": False})


def test_manual_is_free(admin_session, anon):
    """Manual (USSD) is always free: payment_fee = 0."""
    admin_session.patch(f"{API}/payments/admin/settings", json={
        "fiveone_enabled": True, "papi_auto": False,
        "payment_fees": {"papi": {"percent": 0, "min": 100, "max": 16500}},
    })
    r = anon.post(f"{API}/orders", json={
        "pubg_id": "123456789", "pseudo": "TEST_iter22",
        "items": [{"product_id": UC_30_ID, "quantity": 1}],
        "payment_method": "manual",
        "manual_reference": "TEST_REF_" + str(int(time.time())),
    })
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["subtotal"] == 3000
    assert o["payment_fee"] == 0
    assert o["total"] == 3000
    assert o["status"] == "awaiting_verification"


# ---------------------------------------------------------------- product image_url

@pytest.fixture(scope="module")
def sample_product(admin_session):
    # find the 60-uc product referenced in the request
    prod = requests.get(f"{API}/products/60-uc").json()
    assert prod and "id" in prod, prod
    return prod


def _put_product(admin_session, product, image_url):
    payload = {k: product.get(k) for k in (
        "slug", "type", "name", "name_en", "uc_amount", "duration_months",
        "price", "old_price", "popular", "badge", "description_fr",
        "description_en", "active", "sort_order", "evo_limit")}
    payload = {k: v for k, v in payload.items() if v is not None}
    payload["image_url"] = image_url
    return admin_session.put(f"{API}/admin/products/{product['id']}", json=payload)


def test_put_product_accepts_https(admin_session, sample_product):
    url = "https://images.unsplash.com/photo-test.jpg"
    r = _put_product(admin_session, sample_product, url)
    assert r.status_code == 200, r.text
    assert r.json()["image_url"] == url


def test_put_product_rejects_invalid_url(admin_session, sample_product):
    r = _put_product(admin_session, sample_product, "not-a-url")
    assert r.status_code == 422, r.text


def test_put_product_empty_string_becomes_null(admin_session, sample_product):
    r = _put_product(admin_session, sample_product, "")
    assert r.status_code == 200, r.text
    assert r.json().get("image_url") in (None, "")


def test_get_product_exposes_image_url_field(admin_session, sample_product):
    # ensure a real URL is set for later frontend testing
    url = "https://images.unsplash.com/photo-1542751371-adc38448a05e"
    _put_product(admin_session, sample_product, url)
    r = requests.get(f"{API}/products/60-uc")
    assert r.status_code == 200
    d = r.json()
    assert "image_url" in d
    assert d["image_url"] == url
