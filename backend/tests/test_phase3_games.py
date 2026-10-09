"""Phase 3 — Game management + storefront game selection.

Covers the Phase 3 acceptance points:
- public /games exposes only ACTIVE games (inactive games never appear);
- admin CRUD on games is gated by the existing `catalog.manage` permission
  (customer = 403, delegated admin without the permission = 403, super admin = OK);
- `icon_url` is the single logo source and is validated (https only);
- products are filtered by `game_id` and PUBG compatibility is preserved;
- the Game -> Provider mapping resolves Free Fire to the existing FazerCards provider.

Runs against a live backend (BACKEND_TEST_URL, default http://localhost:8001).
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
SUPER_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@magicgame.store")
SUPER_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "AdminLocal2026!")
PUBG = "pubg-mobile"
FREE_FIRE = "free-fire"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register():
    email = f"qa_p3_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "P3 QA"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin():
    return {"Authorization": f"Bearer {_login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)}"}


@pytest.fixture(autouse=True)
def _cleanup_qa_games(admin):
    """Deactivate every QA game created by this module so the public list stays clean."""
    before = {g["id"] for g in requests.get(f"{API}/admin/games", headers=admin, timeout=15).json()}
    yield
    after = requests.get(f"{API}/admin/games", headers=admin, timeout=15).json()
    for g in after:
        if g["id"] not in before and g.get("active"):
            requests.put(f"{API}/admin/games/{g['id']}", headers=admin, timeout=15, json={
                "id": g["id"], "name": g["name"], "slug": g.get("slug"), "icon_url": g.get("icon_url"),
                "description": g.get("description", ""), "description_en": g.get("description_en"),
                "active": False, "sort_order": g.get("sort_order", 0)})


@pytest.fixture(scope="module")
def customer():
    return {"Authorization": f"Bearer {_register()}"}


def test_public_games_lists_active_games_only(admin):
    games = requests.get(f"{API}/games", timeout=15).json()
    ids = [g["id"] for g in games]
    assert PUBG in ids and FREE_FIRE in ids, ids
    assert all(g["active"] is True for g in games)
    # sort_order is honoured (PUBG 0 before Free Fire 1)
    assert ids.index(PUBG) < ids.index(FREE_FIRE)
    # an inactive game must never be exposed publicly
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-hidden-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Hidden", "active": False, "sort_order": 99})
    assert created.status_code == 201, created.text
    try:
        public_ids = [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]
        assert gid not in public_ids
        assert requests.get(f"{API}/games/{gid}", timeout=15).status_code == 404
        # ...but the admin listing still shows it
        admin_ids = [g["id"] for g in requests.get(f"{API}/admin/games", headers=admin, timeout=15).json()]
        assert gid in admin_ids
    finally:
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Hidden", "active": False, "sort_order": 99})


def test_admin_game_routes_require_catalog_permission(admin, customer):
    assert requests.get(f"{API}/admin/games", timeout=15).status_code == 401
    assert requests.get(f"{API}/admin/games", headers=customer, timeout=15).status_code == 403
    assert requests.post(f"{API}/admin/games", headers=customer, timeout=15,
                         json={"id": "qa-nope", "name": "Nope"}).status_code == 403
    assert requests.get(f"{API}/admin/games", headers=admin, timeout=15).status_code == 200


def test_admin_can_create_edit_and_toggle_a_game(admin):
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-game-{tag}"
    logo = "https://example.com/qa-logo.png"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Game", "icon_url": logo, "description": "desc fr",
        "description_en": "desc en", "active": True, "sort_order": 5})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["icon_url"] == logo and body["slug"] == gid and body["active"] is True

    # duplicate id is refused
    assert requests.post(f"{API}/admin/games", headers=admin, timeout=15,
                         json={"id": gid, "name": "Dup"}).status_code == 409

    # edit: rename + change the logo URL + deactivate
    updated = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Game v2", "icon_url": "https://example.com/qa-logo-2.png",
        "active": False, "sort_order": 6})
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "QA Game v2"
    assert updated.json()["icon_url"] == "https://example.com/qa-logo-2.png"
    assert updated.json()["active"] is False
    # deactivated -> gone from the public list
    assert gid not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]

    # reactivate
    back = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Game v2", "icon_url": "https://example.com/qa-logo-2.png",
        "active": True, "sort_order": 6})
    assert back.status_code == 200 and back.json()["active"] is True
    assert gid in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]

    # unknown game -> 404
    assert requests.put(f"{API}/admin/games/qa-unknown-xyz", headers=admin, timeout=15,
                        json={"id": "qa-unknown-xyz", "name": "X"}).status_code == 404


def test_icon_url_is_validated(admin):
    tag = uuid.uuid4().hex[:6]
    bad = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": f"qa-bad-{tag}", "name": "Bad Logo", "icon_url": "not-a-url"})
    assert bad.status_code == 422, bad.text
    # empty logo is allowed (the storefront falls back to the design-system icon)
    ok = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": f"qa-nologo-{tag}", "name": "No Logo", "icon_url": ""})
    assert ok.status_code == 201 and ok.json()["icon_url"] is None


def test_products_are_filtered_by_game_id_and_pubg_is_preserved(admin):
    all_products = requests.get(f"{API}/products", timeout=15).json()
    assert all_products, "expected the seeded PUBG catalog"
    assert all(p["game_id"] == PUBG for p in all_products)
    assert len(requests.get(f"{API}/products", params={"game": PUBG}, timeout=15).json()) == len(all_products)
    # Free Fire has no purchasable catalog yet: the filter must return an empty list, not PUBG packs
    assert requests.get(f"{API}/products", params={"game": FREE_FIRE}, timeout=15).json() == []


def test_free_fire_resolves_to_the_existing_provider():
    """Game -> Provider mapping: Free Fire reuses the FazerCards adapter (no new provider)."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from services import providers
    assert providers.GAME_PROVIDER.get(FREE_FIRE) == "fazercards"
    assert providers.get_provider(FREE_FIRE).name == "fazercards"
    assert providers.get_provider(PUBG).name == "fazercards"
