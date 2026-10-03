"""Phase 1.1 — saved_pubg_ids -> GameIdentity migration + account CRUD + checkout identity selection."""
import asyncio

import requests

from tests.test_multigame_core import API, GAME, _env, _ip, _order, _user, mongo


def _migrate(monkeypatch):
    from motor.motor_asyncio import AsyncIOMotorClient
    import core.games as games

    async def run():
        monkeypatch.setattr(games, "db", AsyncIOMotorClient(_env["MONGO_URL"])[_env["DB_NAME"]])  # loop-local client
        await games.migrate_saved_pubg_ids()
    asyncio.run(run())


def _idents(uid):
    return list(mongo.game_identities.find({"user_id": uid}, {"_id": 0}))


def test_saved_ids_migrate_once_and_legacy_kept(monkeypatch):
    h, uid = _user()
    ids = ["5123456789", "5987654321"]
    assert requests.patch(f"{API}/auth/me", json={"saved_pubg_ids": ids}, headers=h).status_code == 200
    _migrate(monkeypatch)
    first = _idents(uid)
    assert sorted(i["fields"]["player_id"] for i in first) == ids
    assert all(i["game_id"] == GAME and i["fields"] == {"player_id": i["fields"]["player_id"]} and i["label"] == f"PUBG {i['fields']['player_id']}"
               and "player_name" not in i and "region" not in i and i["validated"] is False for i in first)
    _migrate(monkeypatch)
    assert _idents(uid) == first  # idempotent: no duplicates, nothing rewritten
    assert mongo.users.find_one({"user_id": uid})["saved_pubg_ids"] == ids  # legacy untouched
    # Account reads them through the Phase 1 CRUD
    listed = requests.get(f"{API}/me/game-identities", params={"game_id": GAME}, headers=h).json()
    assert {i["id"] for i in listed} == {i["id"] for i in first}
    # A deleted migrated identity is never recreated
    requests.delete(f"{API}/me/game-identities/{first[0]['id']}", headers=h)
    _migrate(monkeypatch)
    assert len(_idents(uid)) == 1


def test_existing_identity_not_duplicated(monkeypatch):
    h, uid = _user()
    requests.post(f"{API}/me/game-identities", json={"game_id": GAME, "label": "Main", "fields": {"player_id": "5111111111"}}, headers=h)
    requests.patch(f"{API}/auth/me", json={"saved_pubg_ids": ["5111111111"]}, headers=h)
    _migrate(monkeypatch)
    assert [i["label"] for i in _idents(uid)] == ["Main"]


def test_account_crud_owner_only_and_checkout_with_migrated_identity(monkeypatch):
    h, uid = _user()
    requests.patch(f"{API}/auth/me", json={"saved_pubg_ids": ["5123456789"]}, headers=h)
    _migrate(monkeypatch)
    ident = requests.get(f"{API}/me/game-identities", headers=h).json()[0]
    upd = requests.patch(f"{API}/me/game-identities/{ident['id']}", json={"label": "Compte principal"}, headers=h).json()
    assert upd["label"] == "Compte principal" and upd["fields"] == {"player_id": "5123456789"}
    other, _ = _user()
    assert requests.get(f"{API}/me/game-identities", headers=other).json() == []
    assert requests.patch(f"{API}/me/game-identities/{ident['id']}", json={"label": "x"}, headers=other).status_code == 404
    assert _order(other, game_id=GAME, identity_id=ident["id"]).status_code == 400
    r = _order(h, game_id=GAME, identity_id=ident["id"])
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["identity_snapshot"]["identity_id"] == ident["id"] and o["identity_snapshot"]["label"] == "Compte principal"
    assert o["identity_snapshot"]["fields"] == {"player_id": "5123456789"} and o["pubg_id"] == "5123456789"
    requests.delete(f"{API}/me/game-identities/{ident['id']}", headers=h)
    assert requests.get(f"{API}/orders/{o['id']}", headers=h).json()["identity_snapshot"] == o["identity_snapshot"]
    legacy = _order(_ip())
    assert legacy.status_code == 201 and legacy.json()["identity_snapshot"]["source"] == "checkout"
