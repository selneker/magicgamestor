"""Phase 1 — Multi-Game Core: Game, GameIdentity, Product.game_id, Order.game_id + immutable identity_snapshot."""
import asyncio
import os
import random
import time
import uuid
from pathlib import Path

import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]
GAME = "pubg-mobile"


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _user():
    email = f"qa_mg_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "MG QA"}, headers=_ip())
    assert r.status_code == 200, r.text
    d = r.json()
    return {"Authorization": f"Bearer {d['access_token']}", **_ip()}, d["user"]["user_id"]


def _identity(h, **kw):
    body = {"game_id": GAME, "label": "Compte principal", "fields": {"player_id": "5123456789"}, "player_name": "Player123", "region": "MG", **kw}
    r = requests.post(f"{API}/me/game-identities", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _uc_product():
    return next(p for p in requests.get(f"{API}/products", params={"type": "uc"}).json() if p.get("purchasable", True))


def _order(h, **kw):
    body = {"pubg_id": "5123456789", "pseudo": "Player123", "items": [{"product_id": _uc_product()["id"], "quantity": 1}],
            "payment_method": "manual", "manual_reference": "QA-REF-1", **kw}
    return requests.post(f"{API}/orders", json=body, headers=h)


def test_games_endpoint_returns_pubg():
    games = requests.get(f"{API}/games").json()
    assert [g["id"] for g in games] == [GAME] and games[0]["active"] is True
    assert mongo.games.count_documents({"id": GAME}) == 1  # seed upsert never duplicates
    assert requests.get(f"{API}/games/unknown-game").status_code == 404


def test_multiple_identities_same_and_other_game_and_ownership():
    h, uid = _user()
    a = _identity(h)
    b = _identity(h, label="Compte secondaire", fields={"player_id": "5999999999"})
    c = _identity(h, label="Zone account", fields={"player_id": "123456", "zone_id": "2214"})  # dynamic fields
    mine = requests.get(f"{API}/me/game-identities", headers=h).json()
    assert {i["id"] for i in mine} == {a["id"], b["id"], c["id"]}
    assert all(i["user_id"] == uid and i["game_id"] == GAME for i in mine)
    assert c["fields"] == {"player_id": "123456", "zone_id": "2214"} and a["validated"] is False
    other, _ = _user()
    assert requests.get(f"{API}/me/game-identities", headers=other).json() == []
    assert requests.patch(f"{API}/me/game-identities/{a['id']}", json={"label": "x"}, headers=other).status_code == 404
    assert requests.delete(f"{API}/me/game-identities/{a['id']}", headers=other).status_code == 404
    assert requests.post(f"{API}/me/game-identities", json={"game_id": "nope", "fields": {"player_id": "1"}}, headers=h).status_code == 400
    assert requests.post(f"{API}/me/game-identities", json={"game_id": GAME, "fields": {"Bad Key": "1"}}, headers=h).status_code == 422
    assert requests.get(f"{API}/me/game-identities").status_code == 401


def test_products_have_game_id_and_filter():
    all_products = requests.get(f"{API}/products").json()
    assert all_products and all(p["game_id"] == GAME for p in all_products)
    assert len(requests.get(f"{API}/products", params={"game": GAME}).json()) == len(all_products)
    assert requests.get(f"{API}/products", params={"game": "other-game"}).json() == []


def test_order_via_identity_snapshot_is_immutable():
    h, _ = _user()
    ident = _identity(h)
    r = _order(h, game_id=GAME, identity_id=ident["id"])
    assert r.status_code == 201, r.text
    order = r.json()
    snap = order["identity_snapshot"]
    assert order["game_id"] == GAME and order["pubg_id"] == "5123456789"
    assert snap["source"] == "identity" and snap["identity_id"] == ident["id"]
    assert snap["fields"] == {"player_id": "5123456789"} and snap["player_name"] == "Player123" and snap["region"] == "MG"
    requests.patch(f"{API}/me/game-identities/{ident['id']}", json={"player_name": "Renamed", "region": "FR", "label": "New"}, headers=h)
    assert requests.get(f"{API}/orders/{order['id']}", headers=h).json()["identity_snapshot"] == snap
    assert requests.delete(f"{API}/me/game-identities/{ident['id']}", headers=h).json() == {"ok": True}
    after = requests.get(f"{API}/orders/{order['id']}", headers=h).json()
    assert after["identity_snapshot"] == snap and after["pubg_id"] == "5123456789"


def test_order_identity_guards():
    h, _ = _user()
    ident = _identity(h)
    other, _ = _user()
    assert _order(other, identity_id=ident["id"]).status_code == 400  # another user's identity
    assert _order(h, identity_id=ident["id"], pubg_id="5000000001").status_code == 400  # mismatching player id
    assert _order(h, game_id="other-game").status_code == 400


def test_legacy_checkout_payload_still_works():
    r = _order(_ip())  # exact pre-Phase-1 payload: no game_id, no identity_id, anonymous
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["game_id"] == GAME and o["pubg_id"] == "5123456789" and o["pseudo"] == "Player123"
    assert o["identity_snapshot"]["fields"] == {"player_id": "5123456789"} and o["identity_snapshot"]["source"] == "checkout"
    tracked = requests.get(f"{API}/orders/track", params={"order_number": o["order_number"], "pubg_id": "5123456789"}).json()
    assert tracked["identity_snapshot"] == o["identity_snapshot"]


def test_legacy_order_without_game_id_readable():
    oid, num = str(uuid.uuid4()), "MGS-L" + uuid.uuid4().hex[:5].upper()
    mongo.orders.insert_one({"id": oid, "order_number": num, "user_id": None, "pubg_id": "5111111111", "pseudo": "OldPlayer",
                             "items": [], "total": 1000, "status": "delivered", "payment_method": "manual",
                             "created_at": "2025-01-01T00:00:00+00:00"})
    try:
        o = requests.get(f"{API}/orders/track", params={"order_number": num, "pubg_id": "5111111111"}).json()
        assert o["game_id"] == GAME and o["pubg_id"] == "5111111111"
        assert o["identity_snapshot"] == {"legacy": True, "fields": {"player_id": "5111111111"}, "player_name": "OldPlayer"}
        assert "game_id" not in mongo.orders.find_one({"id": oid})  # reads never write
    finally:
        mongo.orders.delete_one({"id": oid})


def test_startup_migration_is_idempotent_and_additive(monkeypatch):
    from motor.motor_asyncio import AsyncIOMotorClient
    import core.games as games
    tag = uuid.uuid4().hex[:6]
    p_new, p_done = f"qa-legacy-{tag}", f"qa-migrated-{tag}"
    mongo.products.insert_many([{"id": p_new, "slug": p_new, "type": "uc", "price": 1, "active": False},
                                {"id": p_done, "slug": p_done, "type": "uc", "price": 1, "active": False, "game_id": "kept-game"}])
    o_full, o_empty, o_done, o_nosnap = (f"qa-o-{k}-{tag}" for k in ("full", "empty", "done", "nosnap"))
    kept_snap = {"source": "identity", "fields": {"player_id": "1"}}
    mongo.orders.insert_many([
        {"id": o_full, "order_number": f"QA-F-{tag}", "pubg_id": "5222222222", "pseudo": "Legacy", "status": "paid"},
        {"id": o_empty, "order_number": f"QA-E-{tag}", "status": "cancelled"},
        {"id": o_done, "order_number": f"QA-D-{tag}", "pubg_id": "5333333333", "game_id": "kept-game", "identity_snapshot": kept_snap},
        {"id": o_nosnap, "order_number": f"QA-N-{tag}", "pubg_id": "5444444444", "pseudo": "NoSnap", "game_id": "kept-game"},
    ])
    ids = (o_full, o_empty, o_done, o_nosnap)
    before_count = mongo.orders.count_documents({"id": {"$in": list(ids)}})
    try:
        async def run_twice():
            monkeypatch.setattr(games, "db", AsyncIOMotorClient(_env["MONGO_URL"])[_env["DB_NAME"]])  # loop-local client
            await games.migrate_multigame()
            first = {i: mongo.orders.find_one({"id": i}, {"_id": 0}) for i in ids}
            await games.migrate_multigame()
            return first
        first = asyncio.run(run_twice())
        second = {i: mongo.orders.find_one({"id": i}, {"_id": 0}) for i in ids}
        assert first == second and mongo.orders.count_documents({"id": {"$in": list(ids)}}) == before_count
        assert mongo.products.find_one({"id": p_new})["game_id"] == GAME
        assert mongo.products.find_one({"id": p_done})["game_id"] == "kept-game"
        full, empty, done = second[o_full], second[o_empty], second[o_done]
        assert full["game_id"] == GAME and full["pubg_id"] == "5222222222" and full["pseudo"] == "Legacy"
        assert full["identity_snapshot"] == {"legacy": True, "fields": {"player_id": "5222222222"}, "player_name": "Legacy"}
        assert empty["game_id"] == GAME and empty["identity_snapshot"] == {"legacy": True, "fields": {}}
        assert done["game_id"] == "kept-game" and done["identity_snapshot"] == kept_snap
        nosnap = second[o_nosnap]
        assert nosnap["game_id"] == "kept-game" and nosnap["pubg_id"] == "5444444444"
        assert nosnap["identity_snapshot"] == {"legacy": True, "fields": {"player_id": "5444444444"}, "player_name": "NoSnap"}
    finally:
        mongo.products.delete_many({"id": {"$in": [p_new, p_done]}})
        mongo.orders.delete_many({"id": {"$in": list(ids)}})
