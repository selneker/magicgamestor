"""Targeted tests: per-type Prime/Prime+ rule per PUBG ID, expiration, concurrency, admin transitions."""
import asyncio
import os
import random
import uuid

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
BASE = os.environ.get("TEST_API_URL", "http://localhost:8001").rstrip("/") + "/api"
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}


def pubg():
    return str(random.randint(10**9, 10**10 - 1))


@pytest.fixture(scope="module")
def products():
    with httpx.Client(base_url=BASE, timeout=20) as c:
        items = c.get("/products").json()
        items = items.get("items", items) if isinstance(items, dict) else items
    by = {}
    for p in items:
        by.setdefault(p["type"], []).append(p)
    for k in by:
        by[k].sort(key=lambda p: (p.get("duration_months") or 0, p["price"]))
    return by


@pytest.fixture(scope="module")
def admin():
    c = httpx.Client(base_url=BASE, timeout=20)
    r = c.post("/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        c.headers["Authorization"] = f"Bearer {token}"
    return c


def order(client, pid, items, method="mvola"):
    body = {"pubg_id": pid, "pseudo": "Tester", "items": [{"product_id": i, "quantity": 1} for i in items],
            "payment_method": method, "payment_phone": "0341234567"}
    return client.post("/orders", json=body)


def test_uc_plus_prime_plus_primeplus_allowed(products):
    with httpx.Client(base_url=BASE, timeout=20) as c:
        pid = pubg()
        r = order(c, pid, [products["uc"][0]["id"], products["prime"][0]["id"], products["prime_plus"][0]["id"]])
        assert r.status_code == 201, r.text
        active = c.get("/orders/subscriptions", params={"pubg_id": pid}).json()["active"]
        assert set(active) == {"prime", "prime_plus"}


def test_same_type_twice_in_one_order_rejected(products):
    with httpx.Client(base_url=BASE, timeout=20) as c:
        r = order(c, pubg(), [products["prime"][0]["id"], products["prime"][1]["id"]])
        assert r.status_code == 400
        r = order(c, pubg(), [products["prime_plus"][0]["id"], products["prime_plus"][1]["id"]])
        assert r.status_code == 400


def test_pending_prime_blocks_prime_only(products):
    with httpx.Client(base_url=BASE, timeout=20) as c:
        pid = pubg()
        assert order(c, pid, [products["prime"][0]["id"]]).status_code == 201
        r = order(c, pid, [products["prime"][1]["id"]])  # other duration, same type
        assert r.status_code == 409 and "Prime" in r.json()["detail"]
        assert order(c, pid, [products["prime_plus"][0]["id"]]).status_code == 201
        assert order(c, pid, [products["prime_plus"][1]["id"]]).status_code == 409
        assert order(c, pid, [products["uc"][0]["id"]]).status_code == 201  # UC unaffected
        assert order(c, pid, [products["uc"][1]["id"], products["prime"][0]["id"]]).status_code == 409


def test_cancelled_and_failed_release_lock(products, admin):
    with httpx.Client(base_url=BASE, timeout=20) as c:
        pid = pubg()
        first = order(c, pid, [products["prime"][0]["id"]]).json()
        assert order(c, pid, [products["prime"][0]["id"]]).status_code == 409
        r = admin.patch(f"/admin/orders/{first['id']}", json={"status": "cancelled"})
        assert r.status_code == 200, r.text
        second = order(c, pid, [products["prime"][0]["id"]])
        assert second.status_code == 201
        assert admin.patch(f"/admin/orders/{second.json()['id']}", json={"status": "failed"}).status_code == 200
        assert order(c, pid, [products["prime"][0]["id"]]).status_code == 201


def test_expired_subscription_allows_repurchase(products, admin):
    from pymongo import MongoClient
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    with httpx.Client(base_url=BASE, timeout=20) as c:
        pid = pubg()
        o = order(c, pid, [products["prime_plus"][0]["id"]]).json()
        admin.patch(f"/admin/orders/{o['id']}", json={"status": "paid"})
        assert order(c, pid, [products["prime_plus"][0]["id"]]).status_code == 409
        db.subscription_locks.update_one({"order_id": o["id"]}, {"$set": {"expires_at": "2000-01-01T00:00:00+00:00"}})
        assert c.get("/orders/subscriptions", params={"pubg_id": pid}).json()["active"] == {}
        assert order(c, pid, [products["prime_plus"][0]["id"]]).status_code == 201


def test_concurrent_requests_single_winner(products):
    pid = pubg()

    async def run():
        async with httpx.AsyncClient(base_url=BASE, timeout=30) as c:
            body = {"pubg_id": pid, "pseudo": "Race", "items": [{"product_id": products["prime"][0]["id"], "quantity": 1}],
                    "payment_method": "mvola", "payment_phone": "0341234567"}
            return await asyncio.gather(*[c.post("/orders", json=body) for _ in range(8)])
    codes = sorted(r.status_code for r in asyncio.run(run()))
    assert codes.count(201) == 1 and codes.count(409) == 7, codes


def test_admin_transitions_enforced(products, admin):
    with httpx.Client(base_url=BASE, timeout=20) as c:
        o = order(c, pubg(), [products["uc"][0]["id"]]).json()
    assert admin.patch(f"/admin/orders/{o['id']}", json={"status": "delivered"}).status_code == 409  # pending -> delivered
    assert admin.patch(f"/admin/orders/{o['id']}", json={"status": "paid"}).status_code == 200
    assert admin.patch(f"/admin/orders/{o['id']}", json={"status": "delivered"}).status_code == 200
    assert admin.patch(f"/admin/orders/{o['id']}", json={"status": "cancelled"}).status_code == 409  # terminal
    assert admin.patch(f"/admin/orders/{o['id']}", json={"status": "delivered", "admin_note": "ok"}).status_code == 200  # same status ok
    assert admin.patch(f"/admin/orders/{uuid.uuid4()}", json={"status": "paid"}).status_code == 404
