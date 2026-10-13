"""Phase 3 finalization: B1 (full-string identity validation), S1 (public catalogue isolation),
per-game product types and the data-driven activation readiness gate.

Pure-function tests need no I/O. API tests use the local backend (BACKEND_TEST_URL) + local Mongo
and never contact a real provider or payment service."""
import os
import uuid

import pytest
import requests
from fastapi import HTTPException

from test_fzr_phase3 import db, run  # noqa: F401
from core.games import (DEFAULT_IDENTITY_FIELDS, check_identity_payload, normalize_product_types,
                        product_types_for)

API = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/") + "/api"
PUBG_SPEC = DEFAULT_IDENTITY_FIELDS["pubg-mobile"]
TAG = "tst-p3f-"


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": os.environ["ADMIN_EMAIL"],
                                                  "password": os.environ["ADMIN_PASSWORD"]}, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    run(db.games.delete_many({"id": {"$regex": f"^{TAG}"}}))
    run(db.products.delete_many({"slug": {"$regex": f"^{TAG}"}}))


def _game(admin, **extra):
    gid = f"{TAG}{uuid.uuid4().hex[:6]}"
    body = {"id": gid, "name": "Test Game", "active": False, "currency_label": "CP",
            "product_types": [{"key": "cp", "label": "CP"}, {"key": "battle_pass", "label": "Battle Pass"}],
            **extra}
    r = requests.post(f"{API}/admin/games", json=body, headers=admin, timeout=15)
    assert r.status_code == 201, r.text
    return gid


def _product(admin, gid, type_="cp", active=False, **extra):
    slug = f"{TAG}{uuid.uuid4().hex[:8]}"
    body = {"slug": slug, "type": type_, "name": "Test 80 CP", "price": 5000, "game_id": gid,
            "active": active, "uc_amount": 80, **extra}
    return requests.post(f"{API}/admin/products", json=body, headers=admin, timeout=15), slug


# ---------------------------------------------------------------- B1 (pure)
@pytest.mark.parametrize("value,ok", [
    ("123456789", True), ("1234567890123", True),
    ("12345678", False), ("12345678901234", False),          # length bounds
    ("123456789a", False), ("a123456789", False),            # extra characters (partial match)
    ("123456789\n", True),                                   # stripped before matching
    ("１２３４５６７８９", False), ("١٢٣٤٥٦٧٨٩", False),        # non-ASCII digits
    ("12345 6789", False),
])
def test_pubg_identity_is_full_string_9_to_13_digits(value, ok):
    assert (check_identity_payload(PUBG_SPEC, {"player_id": value}) is not None) is ok


def test_admin_pattern_without_anchors_still_requires_full_match():
    spec = [{"key": "uid", "label": "UID", "pattern": "[0-9]{6}", "min_length": 1, "max_length": 20,
             "required": True, "primary": True}]
    assert check_identity_payload(spec, {"uid": "123456"})
    assert check_identity_payload(spec, {"uid": "1234567"}) is None
    assert check_identity_payload(spec, {"uid": "x123456"}) is None


def test_legacy_pubg_validate_endpoint_matches_order_contract():
    for bad in ("12345", "12345678901234567", "12345678a"):
        r = requests.post(f"{API}/fazercards/pubg/validate-id", json={"player_id": bad}, timeout=15)
        assert r.status_code == 422, (bad, r.status_code)


def test_generic_validate_rejects_malformed_before_provider():
    r = requests.post(f"{API}/fazercards/validate-id",
                      json={"game_id": "pubg-mobile", "fields": {"player_id": "12345678x"}}, timeout=15)
    assert r.status_code == 200 and r.json()["valid"] is False


# ---------------------------------------------------------------- product types (pure)
def test_pubg_keeps_legacy_product_types():
    assert [t["key"] for t in product_types_for({"id": "pubg-mobile"})] == ["uc", "prime", "prime_plus", "evo"]


def test_reserved_pubg_types_refused_for_other_games():
    with pytest.raises(HTTPException):
        normalize_product_types([{"key": "prime", "label": "Prime"}], "codm")
    assert normalize_product_types([{"key": "cp", "label": "CP"}], "codm")[0]["key"] == "cp"


def test_new_game_has_no_implicit_types():
    assert product_types_for({"id": "free-fire"}) == []


# ---------------------------------------------------------------- product types (API)
def test_product_type_must_belong_to_game(admin):
    gid = _game(admin)
    r, _ = _product(admin, gid, type_="uc")
    assert r.status_code == 400 and "non configure" in r.json()["detail"]
    r, _ = _product(admin, gid, type_="cp")
    assert r.status_code == 200 and r.json()["type"] == "cp"
    r, _ = _product(admin, "pubg-mobile", type_="cp")
    assert r.status_code == 400


def test_pubg_product_keeps_existing_type(admin):
    pubg = requests.get(f"{API}/products?game=pubg-mobile", timeout=15).json()
    assert pubg, "seeded PUBG catalogue expected"
    p = pubg[0]
    full = run(db.products.find_one({"id": p["id"]}, {"_id": 0}))
    body = {k: full.get(k) for k in ("slug", "type", "evo_limit", "name", "name_en", "uc_amount", "duration_months",
                                     "price", "old_price", "popular", "badge", "image_url", "active", "sort_order")}
    body.update(description_fr=full.get("description_fr") or "", description_en=full.get("description_en") or "",
                game_id="pubg-mobile")
    body = {k: v for k, v in body.items() if v is not None}
    r = requests.put(f"{API}/admin/products/{p['id']}", json=body, headers=admin, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["type"] == p["type"]


# ---------------------------------------------------------------- readiness + S1 (API)
def test_readiness_explains_missing_steps_and_blocks_activation(admin):
    gid = _game(admin)
    rd = requests.get(f"{API}/admin/games/{gid}/readiness", headers=admin, timeout=15).json()
    failed = {c["key"] for c in rd["checks"] if not c["ok"]}
    assert rd["ready"] is False and {"identity", "provider_categories", "catalog"} <= failed
    game = run(db.games.find_one({"id": gid}, {"_id": 0, "created_at": 0, "updated_at": 0}))
    r = requests.put(f"{API}/admin/games/{gid}", json={**game, "active": True}, headers=admin, timeout=15)
    assert r.status_code == 409 and "Activation refusee" in r.json()["detail"]
    assert "PUBG Mobile" not in r.json()["detail"], "the old hard-coded PUBG-only refusal must be gone"


def test_fully_configured_game_activates_and_inactive_game_is_isolated(admin):
    gid = _game(admin, identity_fields=[{"key": "uid", "label": "UID", "pattern": "[0-9]{6,12}"}])
    run(db.games.update_one({"id": gid}, {"$set": {"fazercards_categories_configured": True,
                                                    "fazercards_categories": ["test_cat"]}}))
    r, slug = _product(admin, gid, type_="cp")
    assert r.status_code == 200, r.text
    # Fail-closed delivery rule: only a confirmed mapping scoped to the game's categories is deliverable.
    run(db.products.update_one({"slug": slug}, {"$set": {"active": True, "requires_mapping": True,
        "fazercards_mapping": {"category_id": "test_cat", "offer_id": "o1", "confirmed": True}}}))
    # S1: inactive game -> nothing public, even with explicit game query or product URL.
    assert requests.get(f"{API}/products?game={gid}", timeout=15).json() == []
    assert slug not in [p["slug"] for p in requests.get(f"{API}/products", timeout=15).json()]
    assert requests.get(f"{API}/products/{slug}", timeout=15).status_code == 404
    assert requests.get(f"{API}/games/{gid}", timeout=15).status_code == 404
    game = run(db.games.find_one({"id": gid}, {"_id": 0, "created_at": 0, "updated_at": 0}))
    r = requests.put(f"{API}/admin/games/{gid}", json={**game, "active": True}, headers=admin, timeout=15)
    assert r.status_code == 200, r.text
    assert [p["slug"] for p in requests.get(f"{API}/products?game={gid}", timeout=15).json()] == [slug]
    assert requests.get(f"{API}/products/{slug}", timeout=15).status_code == 200
    pub = requests.get(f"{API}/games/{gid}", timeout=15).json()
    assert [t["key"] for t in pub["product_types"]] == ["cp", "battle_pass"]
    assert "fazercards_categories" not in pub


def test_active_game_without_identity_contract_is_not_public(admin):
    gid = _game(admin)
    _r, slug = _product(admin, gid, type_="cp")
    run(db.products.update_one({"slug": slug}, {"$set": {"active": True}}))
    run(db.games.update_one({"id": gid}, {"$set": {"active": True}}))  # misconfigured directly in DB
    assert requests.get(f"{API}/products?game={gid}", timeout=15).json() == []
    assert requests.get(f"{API}/products/{slug}", timeout=15).status_code == 404
    assert gid not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]


def test_free_fire_stays_inactive():
    ff = run(db.games.find_one({"id": "free-fire"}, {"_id": 0, "active": 1}))
    assert ff and ff["active"] is False
    assert requests.get(f"{API}/products?game=free-fire", timeout=15).json() == []


def test_pubg_catalogue_preserved():
    games = requests.get(f"{API}/games", timeout=15).json()
    pubg = next(g for g in games if g["id"] == "pubg-mobile")
    assert pubg["identity_fields"][0]["key"] == "player_id"
    assert requests.get(f"{API}/products?game=pubg-mobile", timeout=15).json()
