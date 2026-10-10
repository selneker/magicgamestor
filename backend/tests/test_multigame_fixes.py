"""Corrections ciblées de l'audit backend multi-jeux (branche fix/multigame-backend-audit).

Couvre, sans jamais créer de vraie commande fournisseur ni toucher la production :
- A. cohérence vente/livraison : produit actif sans mapping valide non achetable ; `include_inactive`
     réservé au staff ;
- B. identités réellement multi-jeux : validation d'identité dynamique par jeu, `identity_snapshot`
     dynamique, message de validation neutre par jeu, compatibilité PUBG historique ;
- C. isolation des mappings : un mapping d'un autre jeu n'est jamais utilisable ; changer le jeu d'un
     produit porteur d'un mapping est refusé ; le filtre admin des mappings isole par jeu.

Les tests unitaires utilisent le Mongo local + les helpers de test_fzr_phase3 (loop partagée).
Aucun appel réseau réel : httpx est mocké.
"""
import uuid

import httpx
import pytest
from fastapi import HTTPException

from test_fzr_phase3 import (VALIDATE_LIST, db, happy_handler, make_mapped_product, make_order,
                             mock_transport, run)  # noqa: F401
from services import fazercards, fzr_fulfillment, fzr_mapping  # noqa: E402
from services.providers import fazercards_adapter  # noqa: E402

PUBG = "pubg-mobile"
FREE_FIRE = "free-fire"


@pytest.fixture(autouse=True)
def _clear_discovery(monkeypatch):
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
    fazercards._discovery_cache["data"] = None
    fazercards._game_discovery_cache.clear()
    yield
    fazercards._discovery_cache["data"] = None
    fazercards._game_discovery_cache.clear()


# --------------------------------------------------------------------------- #
# B. Validation d'identité dynamique par jeu
# --------------------------------------------------------------------------- #

FF_VALIDATE_LIST = {"ok": True, "items": [
    {"category_id": "pubg_mobile", "name": "PUBG Mobile",
     "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]},
    {"category_id": "free_fire", "name": "Free Fire",
     "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]},
]}


def test_validation_target_pubg_uses_legacy_discovery(monkeypatch):
    """PUBG Mobile conserve EXACTEMENT la découverte historique (cache legacy)."""
    mock_transport(monkeypatch, happy_handler())
    assert run(fazercards.validation_target(PUBG)) == ("pubg_mobile", "player_id")
    assert run(fazercards.validation_target(None)) == ("pubg_mobile", "player_id")


def test_validation_target_other_game_uses_its_own_category(monkeypatch):
    """Un autre jeu est résolu via GAME_MATCHERS : sa propre catégorie, jamais celle de PUBG."""
    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=FF_VALIDATE_LIST)
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    assert run(fazercards.validation_target(FREE_FIRE)) == ("free_fire", "player_id")


def test_validation_target_unknown_game_fails_safely(monkeypatch):
    """Un jeu inconnu (aucune correspondance) échoue explicitement — jamais de repli PUBG."""
    mock_transport(monkeypatch, happy_handler())
    with pytest.raises(HTTPException) as e:
        run(fazercards.validation_target("some-unknown-game"))
    assert e.value.status_code == 503
    assert "PUBG" not in e.value.detail


def test_validation_target_configured_game_without_target_fails_safely(monkeypatch):
    """Un jeu configuré mais sans cible de validation chez le fournisseur échoue (503), sans repli PUBG."""
    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)  # seule la cible PUBG existe
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    with pytest.raises(HTTPException) as e:
        run(fazercards.validation_target(FREE_FIRE))
    assert e.value.status_code == 503
    assert "PUBG" not in e.value.detail


def test_validate_identity_unknown_game_fails_safely(monkeypatch):
    """`validate_identity` propage l'échec sûr (503) pour un jeu non reconnu."""
    mock_transport(monkeypatch, happy_handler())
    with pytest.raises(HTTPException) as e:
        run(fazercards.validate_identity({"player_id": "1"}, "some-unknown-game"))
    assert e.value.status_code == 503


def test_validate_identity_sends_the_game_category(monkeypatch):
    """La validation d'un jeu dynamique envoie SA catégorie fournisseur (pas PUBG)."""
    seen = {}

    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=FF_VALIDATE_LIST)
        if req.url.path.endswith("/topups/validate-id"):
            import json as _json
            seen["body"] = _json.loads(req.content)
            return httpx.Response(200, json={"ok": True, "valid": True, "player_name": "FFPlayer"})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    out = run(fazercards.validate_identity({"player_id": "123456789"}, FREE_FIRE))
    assert out["valid"] is True and out["player_name"] == "FFPlayer"
    assert seen["body"]["category_id"] == "free_fire"
    assert seen["body"]["fields"] == {"player_id": "123456789"}


def test_validate_identity_without_game_keeps_pubg_behaviour(monkeypatch):
    """Sans `game_id`, comportement historique PUBG (compat legacy)."""
    seen = {}

    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if req.url.path.endswith("/topups/validate-id"):
            import json as _json
            seen["body"] = _json.loads(req.content)
            return httpx.Response(200, json={"ok": True, "valid": True, "player_name": "Kapotue"})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    run(fazercards.validate_identity({"player_id": "52328390220"}))
    assert seen["body"]["category_id"] == "pubg_mobile"


def test_adapter_forwards_game_id(monkeypatch):
    """L'adapter transmet bien le game_id à la validation (identité dynamique)."""
    seen = {}

    async def fake_validate(fields, game_id=None):
        seen["game_id"] = game_id
        return {"valid": True, "player_name": "X"}

    monkeypatch.setattr(fazercards, "validate_identity", fake_validate)
    out = run(fazercards_adapter.FazerCardsProvider().validate_identity(FREE_FIRE, {"player_id": "1"}))
    assert seen["game_id"] == FREE_FIRE and out.valid is True


def test_identity_fields_prefers_dynamic_snapshot():
    """`_identity_fields` transmet les champs dynamiques du snapshot, repli legacy sur pubg_id."""
    dynamic = {"identity_snapshot": {"fields": {"player_id": "1", "zone_id": "2214"}}, "pubg_id": "1"}
    assert fzr_fulfillment._identity_fields(dynamic) == {"player_id": "1", "zone_id": "2214"}
    legacy = {"pubg_id": "52328390220"}
    assert fzr_fulfillment._identity_fields(legacy) == {"player_id": "52328390220"}


def test_preflight_invalid_identity_message_is_game_neutral(monkeypatch):
    """Un jeu non-PUBG reçoit un message neutre ; PUBG garde son libellé historique.

    Le fournisseur expose ici une cible de validation Free Fire (sinon l'échec sûr 503
    s'applique) : on vérifie donc bien la neutralité du message quand la validation aboutit.
    """
    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=FF_VALIDATE_LIST)
        if req.url.path.endswith("/topups/validate-id"):
            return httpx.Response(200, json={"ok": True, "valid": False})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    pid = make_mapped_product()
    ff_order = make_order(status="paid", product_id=pid)
    run(db.orders.update_one({"id": ff_order["id"]}, {"$set": {"game_id": FREE_FIRE}}))
    with pytest.raises(HTTPException) as e:
        run(fzr_fulfillment.preflight(ff_order["id"]))
    assert e.value.status_code == 409 and "PUBG" not in e.value.detail

    pubg_order = make_order(status="paid", product_id=pid)
    with pytest.raises(HTTPException) as e2:
        run(fzr_fulfillment.preflight(pubg_order["id"]))
    assert e2.value.status_code == 409 and "PUBG" in e2.value.detail


# --------------------------------------------------------------------------- #
# C. Isolation des mappings par jeu
# --------------------------------------------------------------------------- #

def test_offers_for_game_rejects_foreign_category(monkeypatch):
    """Une catégorie d'un autre jeu est refusée (aucun mélange de catalogues)."""
    async def fake_categories(game_id):
        return [{"category_id": "ff_cat", "name": "Free Fire"}]

    async def fake_offers(category_id):
        return {"category_id": category_id, "offers": [], "fields": []}

    monkeypatch.setattr(fazercards, "game_categories", fake_categories)
    monkeypatch.setattr(fazercards, "pubg_offers_fresh", fake_offers)
    assert run(fzr_mapping.offers_for_game(FREE_FIRE, "ff_cat"))["category_id"] == "ff_cat"
    with pytest.raises(HTTPException) as e:
        run(fzr_mapping.offers_for_game(FREE_FIRE, "pubg_cat"))
    assert e.value.status_code == 409
    # Sans jeu connu → comportement historique (aucun contrôle).
    assert run(fzr_mapping.offers_for_game(None, "pubg_cat"))["category_id"] == "pubg_cat"


def test_update_product_refuses_game_change_with_mapping():
    """Changer le jeu d'un produit porteur d'un mapping est refusé (mapping d'un autre jeu)."""
    from routers.products import ProductIn, update_product
    tag = uuid.uuid4().hex[:8]
    pid = f"qa-gc-{tag}"
    run(db.games.update_one({"id": PUBG}, {"$setOnInsert": {"id": PUBG, "name": "PUBG Mobile", "active": True}}, upsert=True))
    run(db.games.update_one({"id": FREE_FIRE}, {"$setOnInsert": {"id": FREE_FIRE, "name": "Free Fire", "active": False}}, upsert=True))
    run(db.products.insert_one({
        "id": pid, "slug": f"qa-gc-{tag}", "type": "uc", "uc_amount": 60, "name": "QA GC 60",
        "price": 5000, "active": True, "game_id": PUBG, "requires_mapping": True,
        "fazercards_mapping": {"mode": "direct", "category_id": "pubg_cat_qa", "offer_id": "uc_60",
                               "offer_name": "60 UC", "price_usd_at_link": "0.88", "confirmed": True}}))
    body = ProductIn(slug=f"qa-gc-{tag}", type="uc", name="QA GC 60", uc_amount=60, price=5000,
                     active=True, game_id=FREE_FIRE)
    try:
        with pytest.raises(HTTPException) as e:
            run(update_product(pid, body))
        assert e.value.status_code == 409
        # Le mapping n'a pas bougé et le produit reste sur son jeu d'origine.
        stored = run(db.products.find_one({"id": pid}, {"_id": 0, "game_id": 1, "fazercards_mapping": 1}))
        assert stored["game_id"] == PUBG and stored["fazercards_mapping"]["category_id"] == "pubg_cat_qa"
    finally:
        run(db.products.delete_one({"id": pid}))


def test_admin_mappings_filter_isolates_games():
    """Le filtre admin des mappings isole par jeu (PUBG inclut le legacy, l'autre jeu non)."""
    from routers.fzr_orders import fzr_mappings
    tag = uuid.uuid4().hex[:8]
    pubg_id, ff_id, legacy_id = f"qa-m-{tag}-p", f"qa-m-{tag}-f", f"qa-m-{tag}-l"
    run(db.products.insert_many([
        {"id": pubg_id, "slug": f"qa-m-{tag}-p", "type": "uc", "name": "P", "price": 1, "active": True, "game_id": PUBG},
        {"id": ff_id, "slug": f"qa-m-{tag}-f", "type": "uc", "name": "F", "price": 1, "active": True, "game_id": FREE_FIRE},
        {"id": legacy_id, "slug": f"qa-m-{tag}-l", "type": "uc", "name": "L", "price": 1, "active": True},
    ]))
    try:
        ff = {p["id"] for p in run(fzr_mappings(FREE_FIRE))["products"]}
        assert ff_id in ff and pubg_id not in ff and legacy_id not in ff
        pubg = {p["id"] for p in run(fzr_mappings(PUBG))["products"]}
        assert pubg_id in pubg and legacy_id in pubg and ff_id not in pubg
    finally:
        run(db.products.delete_many({"id": {"$in": [pubg_id, ff_id, legacy_id]}}))


# --------------------------------------------------------------------------- #
# A. Cohérence vente / livraison
# --------------------------------------------------------------------------- #

def test_active_product_without_valid_mapping_is_not_purchasable():
    """Un produit actif exigeant un mapping absent/non confirmé n'est pas achetable."""
    assert fzr_mapping.purchase_blocked({"name": "X", "requires_mapping": True}) is not None
    assert fzr_mapping.purchase_blocked(
        {"name": "X", "requires_mapping": True, "fazercards_mapping": {"confirmed": False}}) is not None
    assert fzr_mapping.purchase_blocked(
        {"name": "X", "requires_mapping": True,
         "fazercards_mapping": {"mode": "direct", "category_id": "c", "offer_id": "o", "confirmed": True}}) is None
    assert fzr_mapping.purchase_blocked({"name": "X", "requires_mapping": False}) is None


def test_include_inactive_is_staff_only():
    """`include_inactive` n'est honoré que pour un compte staff (jamais pour un visiteur)."""
    from routers.products import list_products
    tag = uuid.uuid4().hex[:8]
    pid = f"qa-inact-{tag}"
    run(db.products.insert_one({"id": pid, "slug": f"qa-inact-{tag}", "type": "uc", "name": "Inactif",
                                "price": 1, "active": False, "game_id": PUBG}))
    try:
        anon = {p["id"] for p in run(list_products(sort="default", include_inactive=True, user=None))}
        assert pid not in anon
        staff = {p["id"] for p in run(list_products(sort="default", include_inactive=True, user={"role": "admin"}))}
        assert pid in staff
    finally:
        run(db.products.delete_one({"id": pid}))
