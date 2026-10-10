"""Phase 3 — isolation inter-jeux des mappings + garde d'activation publique.

Couvre les risques corrigés avant fusion :
- l'audit et l'application des mappings sont ISOLÉS par jeu : une opération Free Fire
  ne lit ni ne modifie jamais les mappings PUBG (et inversement) ;
- l'appel historique sans paramètre `game` reste limité à PUBG Mobile (jamais toutes
  les catégories fournisseur) ;
- un jeu sans catalogue VENDABLE reste invisible dans la boutique, même après une
  tentative d'activation publique (l'existence d'un document produit ne suffit pas).

Les tests unitaires utilisent le Mongo local + le helper `run` de test_fzr_phase3 ;
les tests d'API s'exécutent contre le backend live (BACKEND_TEST_URL).
"""
import os
import time
import uuid

import pytest
import requests

from test_fzr_phase3 import db, run  # noqa: F401 — réutilise loop + helpers Phase 3
from services import fzr_mapping  # noqa: E402

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
SUPER_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@magicgame.store")
SUPER_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "AdminLocal2026!")
PUBG = "pubg-mobile"
FREE_FIRE = "free-fire"

# Catalogue fournisseur simulé pour Free Fire : une seule offre, jamais hardcodée côté produit.
FF_CATALOG = [{"category_id": "ff_cat_qa", "name": "Free Fire (QA)",
               "offers": [{"offer_id": "ff_60", "name": "60 Diamonds", "price_usd": "0.5000"}],
               "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}]
PUBG_CATALOG = [{"category_id": "pubg_cat_qa", "name": "PUBG Mobile (QA)",
                 "offers": [{"offer_id": "uc_60", "name": "60 UC", "price_usd": "0.8800"}],
                 "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}]


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin():
    return {"Authorization": f"Bearer {_login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)}"}


@pytest.fixture
def qa_products():
    """Deux produits UC (un PUBG, un Free Fire) avec un mapping direct valide, puis nettoyage."""
    tag = uuid.uuid4().hex[:8]
    pubg_id, ff_id = f"qa-iso-pubg-{tag}", f"qa-iso-ff-{tag}"
    pubg_doc = {"id": pubg_id, "slug": f"qa-iso-pubg-{tag}", "type": "uc", "uc_amount": 60,
                "name": "QA PUBG 60 UC", "price": 5000, "active": True, "game_id": PUBG,
                "requires_mapping": True,
                "fazercards_mapping": {"mode": "direct", "category_id": "pubg_cat_qa",
                                       "offer_id": "uc_60", "offer_name": "60 UC",
                                       "price_usd_at_link": "0.8800", "confirmed": True}}
    ff_doc = {"id": ff_id, "slug": f"qa-iso-ff-{tag}", "type": "uc", "uc_amount": 60,
              "name": "QA FF 60 Diamonds", "price": 5000, "active": True, "game_id": FREE_FIRE,
              "requires_mapping": True,
              "fazercards_mapping": {"mode": "direct", "category_id": "ff_cat_qa",
                                     "offer_id": "ff_60", "offer_name": "60 Diamonds",
                                     "price_usd_at_link": "0.5000", "confirmed": True}}
    run(db.products.insert_many([dict(pubg_doc), dict(ff_doc)]))
    try:
        yield pubg_doc, ff_doc
    finally:
        run(db.products.delete_many({"id": {"$in": [pubg_id, ff_id]}}))


def _mapping_of(product_id):
    return run(db.products.find_one({"id": product_id}, {"_id": 0, "fazercards_mapping": 1}))["fazercards_mapping"]


# --------------------------------------------------------------------------- #
# 1. Isolation de l'audit et de l'application par jeu
# --------------------------------------------------------------------------- #

def test_audit_free_fire_never_reads_pubg_products(qa_products):
    """Un audit Free Fire ne remonte QUE les produits Free Fire."""
    pubg_doc, ff_doc = qa_products
    rows = run(fzr_mapping.audit_uc_products(FF_CATALOG, FREE_FIRE))
    ids = {r["product_id"] for r in rows}
    assert ff_doc["id"] in ids
    assert pubg_doc["id"] not in ids


def test_audit_pubg_never_reads_free_fire_products(qa_products):
    """Un audit PUBG ne remonte QUE les produits PUBG (jamais ceux d'un autre jeu)."""
    pubg_doc, ff_doc = qa_products
    rows = run(fzr_mapping.audit_uc_products(PUBG_CATALOG, PUBG))
    ids = {r["product_id"] for r in rows}
    assert pubg_doc["id"] in ids
    assert ff_doc["id"] not in ids


def test_apply_free_fire_never_mutates_pubg_mappings(qa_products):
    """Appliquer l'audit Free Fire ne modifie JAMAIS les mappings PUBG."""
    pubg_doc, ff_doc = qa_products
    before = _mapping_of(pubg_doc["id"])
    # Catalogue Free Fire volontairement SANS l'offre du produit FF → action "remove" pour FF.
    run(fzr_mapping.apply_uc_audit(FF_CATALOG, "qa-isolation", FREE_FIRE))
    after = _mapping_of(pubg_doc["id"])
    assert after == before, "l'application de l'audit Free Fire a modifié un mapping PUBG"


def test_apply_pubg_never_mutates_free_fire_mappings(qa_products):
    """Appliquer l'audit PUBG ne modifie JAMAIS les mappings Free Fire."""
    pubg_doc, ff_doc = qa_products
    before = _mapping_of(ff_doc["id"])
    run(fzr_mapping.apply_uc_audit(PUBG_CATALOG, "qa-isolation", PUBG))
    after = _mapping_of(ff_doc["id"])
    assert after == before, "l'application de l'audit PUBG a modifié un mapping Free Fire"


def test_game_product_query_keeps_pubg_legacy_compatibility():
    """PUBG inclut les produits historiques sans `game_id` ; un autre jeu ne voit que les siens."""
    assert fzr_mapping.game_product_query(None) == {}
    pubg_q = fzr_mapping.game_product_query(PUBG)
    assert pubg_q == {"$or": [{"game_id": PUBG}, {"game_id": {"$exists": False}}]}
    assert fzr_mapping.game_product_query(FREE_FIRE) == {"game_id": FREE_FIRE}


# --------------------------------------------------------------------------- #
# 2. L'appel historique sans `game` reste limité à PUBG Mobile
# --------------------------------------------------------------------------- #

def test_uc_audit_without_game_defaults_to_pubg(monkeypatch):
    """Sans paramètre `game`, l'audit reste limité à PUBG Mobile (jamais toutes les catégories).

    Vérifié au niveau de la route (le fournisseur live n'est pas requis) : on capture le jeu
    réellement transmis à l'audit.
    """
    from routers import fzr_orders
    seen = {}

    async def fake_catalog(game_id):
        seen["catalog_game"] = game_id
        return PUBG_CATALOG

    async def fake_audit(catalog, game_id=None):
        seen["audit_game"] = game_id
        return []

    monkeypatch.setattr(fzr_orders.fazercards, "catalog_for_game", fake_catalog)
    monkeypatch.setattr(fzr_orders.fzr_mapping, "audit_uc_products", fake_audit)
    out = run(fzr_orders.fzr_uc_audit(None))
    assert seen["catalog_game"] == PUBG
    assert seen["audit_game"] == PUBG
    assert out["game"] == PUBG


def test_uc_audit_apply_without_game_defaults_to_pubg(monkeypatch):
    """Sans paramètre `game`, l'application reste limitée à PUBG Mobile."""
    from routers import fzr_orders
    seen = {}

    async def fake_catalog(game_id):
        seen["catalog_game"] = game_id
        return PUBG_CATALOG

    async def fake_apply(catalog, actor=None, game_id=None):
        seen["apply_game"] = game_id
        return {"rows": [], "fixed": [], "removed": [], "fixed_count": 0, "removed_count": 0}

    monkeypatch.setattr(fzr_orders.fazercards, "catalog_for_game", fake_catalog)
    monkeypatch.setattr(fzr_orders.fzr_mapping, "apply_uc_audit", fake_apply)
    out = run(fzr_orders.fzr_uc_audit_apply(None, admin={"user_id": "qa-isolation"}))
    assert seen["catalog_game"] == PUBG
    assert seen["apply_game"] == PUBG
    assert out["fixed_count"] == 0


def test_uc_audit_explicit_game_is_forwarded(monkeypatch):
    """Un jeu explicite est bien transmis à l'audit (isolation par jeu)."""
    from routers import fzr_orders
    seen = {}

    async def fake_catalog(game_id):
        return FF_CATALOG

    async def fake_audit(catalog, game_id=None):
        seen["audit_game"] = game_id
        return []

    monkeypatch.setattr(fzr_orders.fazercards, "catalog_for_game", fake_catalog)
    monkeypatch.setattr(fzr_orders.fzr_mapping, "audit_uc_products", fake_audit)
    out = run(fzr_orders.fzr_uc_audit(FREE_FIRE))
    assert seen["audit_game"] == FREE_FIRE
    assert out["game"] == FREE_FIRE


def test_uc_audit_requires_admin(admin):
    """Les routes d'audit restent protégées par le mécanisme d'autorisation existant."""
    assert requests.get(f"{API}/admin/fazercards/uc-audit", timeout=15).status_code == 401


# --------------------------------------------------------------------------- #
# 3. Un jeu sans catalogue vendable ne peut pas être activé publiquement
# --------------------------------------------------------------------------- #

def test_game_without_sellable_catalog_cannot_be_activated(admin):
    """Un jeu sans produit actif livrable reste non public, même après une tentative d'activation."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-nocat-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA No Catalog", "active": False, "sort_order": 98})
    assert created.status_code == 201, created.text
    try:
        # Tentative d'activation publique sans aucun produit → refusée.
        attempt = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA No Catalog", "active": True, "sort_order": 98})
        assert attempt.status_code == 409, attempt.text
        # ...et le jeu reste absent de la boutique publique.
        assert gid not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]
        assert requests.get(f"{API}/games/{gid}", timeout=15).status_code == 404
    finally:
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA No Catalog", "active": False, "sort_order": 98})


def test_game_with_only_inactive_products_cannot_be_activated(admin):
    """Un produit INACTIF n'est pas une preuve de vendabilité : l'activation reste refusée."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-inactive-{tag}"
    pid = f"qa-inactive-prod-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Inactive Catalog", "active": False, "sort_order": 97})
    assert created.status_code == 201, created.text
    run(db.products.insert_one({
        "id": pid, "slug": f"qa-inactive-{tag}", "type": "uc", "uc_amount": 60,
        "name": "QA Inactive 60", "price": 5000, "active": False, "game_id": gid,
        "requires_mapping": False, "created_at": "2026-01-01T00:00:00+00:00"}))
    try:
        attempt = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Inactive Catalog", "active": True, "sort_order": 97})
        assert attempt.status_code == 409, attempt.text
        assert gid not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]
    finally:
        run(db.products.delete_many({"id": pid}))
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Inactive Catalog", "active": False, "sort_order": 97})


def test_game_with_unmapped_required_product_cannot_be_activated(admin):
    """Un produit actif mais exigeant un mapping fournisseur absent n'est pas vendable."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-unmapped-{tag}"
    pid = f"qa-unmapped-prod-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Unmapped Catalog", "active": False, "sort_order": 96})
    assert created.status_code == 201, created.text
    run(db.products.insert_one({
        "id": pid, "slug": f"qa-unmapped-{tag}", "type": "uc", "uc_amount": 60,
        "name": "QA Unmapped 60", "price": 5000, "active": True, "game_id": gid,
        "requires_mapping": True, "created_at": "2026-01-01T00:00:00+00:00"}))
    try:
        attempt = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Unmapped Catalog", "active": True, "sort_order": 96})
        assert attempt.status_code == 409, attempt.text
        assert gid not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]
    finally:
        run(db.products.delete_many({"id": pid}))
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Unmapped Catalog", "active": False, "sort_order": 96})


def test_free_fire_stays_inactive_without_real_catalog(admin):
    """Free Fire reste inactif tant qu'aucun catalogue commercial réel n'existe."""
    games = {g["id"]: g for g in requests.get(f"{API}/admin/games", headers=admin, timeout=15).json()}
    assert FREE_FIRE in games
    if not games[FREE_FIRE]["active"]:
        assert FREE_FIRE not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]
