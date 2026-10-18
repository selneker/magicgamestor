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
    """Un autre jeu est résolu via sa catégorie de validation déclarée (fazercards_validation_category),
    jamais via une correspondance de mots-clés, jamais celle de PUBG."""
    from types import SimpleNamespace

    async def fake_find_one(query, projection=None):
        if query.get("id") == FREE_FIRE:
            return {"fazercards_validation_category": "free_fire"}
        return None

    monkeypatch.setattr(fazercards.db, "games", SimpleNamespace(find_one=fake_find_one))
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
    from types import SimpleNamespace

    async def fake_find_one(query, projection=None):
        if query.get("id") == FREE_FIRE:
            return {"fazercards_validation_category": None}
        return None

    monkeypatch.setattr(fazercards.db, "games", SimpleNamespace(find_one=fake_find_one))
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
    """La validation d'un jeu dynamique envoie SA catégorie déclarée (pas PUBG)."""
    from types import SimpleNamespace

    async def fake_find_one(query, projection=None):
        if query.get("id") == FREE_FIRE:
            return {"fazercards_validation_category": "free_fire"}
        return None

    monkeypatch.setattr(fazercards.db, "games", SimpleNamespace(find_one=fake_find_one))
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
    from types import SimpleNamespace

    async def fake_find_one(query, projection=None):
        if query.get("id") == FREE_FIRE:
            return {"fazercards_validation_category": "free_fire"}
        return None

    monkeypatch.setattr(fazercards.db, "games", SimpleNamespace(find_one=fake_find_one))
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


# --------------------------------------------------------------------------- #
# D. Isolation inter-jeux FAIL-CLOSED + compatibilité PUBG historique (durcissement)
# --------------------------------------------------------------------------- #

# Catalogue fournisseur simulé : une catégorie PUBG standard, une catégorie PUBG LEGACY dont
# l'id/le nom ne contient PAS « pubg_mobile »/« pubg mobile » (ex. `pubgm_uc`), et une catégorie
# d'un autre jeu. Aucun appel réseau réel.
MIXED_CATALOG = [
    {"category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)", "note": ""},
    {"category_id": "pubgm_uc", "name": "UC 60", "note": ""},
    {"category_id": "free_fire", "name": "Free Fire", "note": ""},
]


def _patch_catalog(monkeypatch, catalog):
    async def fake_all():
        return [dict(c) for c in catalog]
    monkeypatch.setattr(fazercards, "_topup_categories", fake_all)


def test_unknown_game_categories_fail_closed(monkeypatch):
    """Un jeu inconnu/non supporté échoue explicitement (409) — jamais le catalogue complet."""
    _patch_catalog(monkeypatch, MIXED_CATALOG)
    with pytest.raises(HTTPException) as e:
        run(fazercards.game_categories("some-unknown-game"))
    assert e.value.status_code == 409
    # Le message ne divulgue aucune catégorie fournisseur (aucune fuite du catalogue complet).
    assert "pubg_mobile_auto" not in e.value.detail and "free_fire" not in e.value.detail


def test_unknown_game_offers_for_game_fail_closed(monkeypatch):
    """`offers_for_game` d'un jeu inconnu échoue (409) au lieu de servir une catégorie arbitraire."""
    _patch_catalog(monkeypatch, MIXED_CATALOG)
    with pytest.raises(HTTPException) as e:
        run(fzr_mapping.offers_for_game("some-unknown-game", "pubg_mobile_auto"))
    assert e.value.status_code == 409


def test_foreign_category_rejected_for_configured_game(monkeypatch):
    """Une catégorie d'un autre jeu est refusée pour un jeu configuré (aucun mélange)."""
    _patch_catalog(monkeypatch, MIXED_CATALOG)
    with pytest.raises(HTTPException) as e:
        run(fzr_mapping.offers_for_game(FREE_FIRE, "pubg_mobile_auto"))
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e2:
        run(fzr_mapping.offers_for_game(PUBG, "free_fire"))
    assert e2.value.status_code == 409


def test_legacy_pubg_category_without_pubg_mobile_token_is_kept(monkeypatch):
    """Une catégorie PUBG LEGACY (`pubgm_uc`) reste reconnue pour PUBG Mobile (Fix B).

    Son id/name ne contient ni « pubg_mobile » ni « pubg mobile » : elle ne doit PAS être rejetée.
    """
    _patch_catalog(monkeypatch, MIXED_CATALOG)
    ids = {c["category_id"] for c in run(fazercards.game_categories(PUBG))}
    assert "pubgm_uc" in ids
    # Et elle reste utilisable pour lier un mapping PUBG (aucun rejet de catégorie légitime).
    async def fake_offers(category_id):
        return {"category_id": category_id, "offers": [], "fields": []}
    monkeypatch.setattr(fazercards, "pubg_offers_fresh", fake_offers)
    assert run(fzr_mapping.offers_for_game(PUBG, "pubgm_uc"))["category_id"] == "pubgm_uc"


def test_standard_supported_pubg_category_is_kept(monkeypatch):
    """Une catégorie PUBG standard (`pubg_mobile_auto`) reste reconnue pour PUBG Mobile."""
    _patch_catalog(monkeypatch, MIXED_CATALOG)
    ids = {c["category_id"] for c in run(fazercards.game_categories(PUBG))}
    assert "pubg_mobile_auto" in ids
    assert "free_fire" not in ids  # isolation : jamais la catégorie d'un autre jeu


def test_game_without_configured_provider_target_returns_empty(monkeypatch):
    """Un jeu configuré sans catégorie fournisseur correspondante → liste VIDE, jamais tout le catalogue."""
    _patch_catalog(monkeypatch, [{"category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)", "note": ""}])
    assert run(fazercards.game_categories(FREE_FIRE)) == []


def test_legacy_no_game_id_stays_limited_to_pubg(monkeypatch):
    """Le chemin de compatibilité historique (game_id absent) reste limité aux catégories PUBG."""
    _patch_catalog(monkeypatch, MIXED_CATALOG)
    ids = {c["category_id"] for c in run(fazercards.game_categories(None))}
    assert ids == {"pubg_mobile_auto", "pubgm_uc"}
    assert "free_fire" not in ids


def test_validation_target_legacy_and_fail_closed(monkeypatch):
    """`validation_target` : PUBG/legacy garde la découverte historique ; un jeu inconnu échoue (503)."""
    mock_transport(monkeypatch, happy_handler())
    assert run(fazercards.validation_target(PUBG)) == ("pubg_mobile", "player_id")
    assert run(fazercards.validation_target(None)) == ("pubg_mobile", "player_id")
    with pytest.raises(HTTPException) as e:
        run(fazercards.validation_target("some-unknown-game"))
    assert e.value.status_code == 503


def test_build_mapping_rejects_foreign_category(monkeypatch):
    """Protection du mapping produit : lier un produit à une catégorie d'un autre jeu est refusé."""
    import types
    _patch_catalog(monkeypatch, MIXED_CATALOG)

    async def fake_offers(category_id):
        return {"category_id": category_id, "offers": [], "fields": []}
    monkeypatch.setattr(fazercards, "pubg_offers_fresh", fake_offers)

    product = {"id": "qa-bm", "name": "QA", "type": "uc", "uc_amount": 60, "game_id": FREE_FIRE}
    body = types.SimpleNamespace(category_id="pubg_mobile_auto", mode="direct", offer_id="uc_60", confirmed=True)
    with pytest.raises(HTTPException) as e:
        run(fzr_mapping.build_mapping(product, body))
    assert e.value.status_code == 409


def test_purchase_blocking_protections_unchanged():
    """Les protections d'achat existantes restent intactes (mapping manquant/non confirmé bloquant)."""
    assert fzr_mapping.mapping_ok(None) is False
    assert fzr_mapping.mapping_ok({"confirmed": False, "mode": "direct", "category_id": "c", "offer_id": "o"}) is False
    assert fzr_mapping.mapping_ok({"mode": "direct", "category_id": "c", "offer_id": "o"}) is True
    assert fzr_mapping.purchase_blocked({"name": "X", "requires_mapping": True}) is not None
    assert fzr_mapping.purchase_blocked(
        {"name": "X", "requires_mapping": True,
         "fazercards_mapping": {"mode": "direct", "category_id": "c", "offer_id": "o", "confirmed": True}}) is None
def test_free_fire_currency_product_composition(monkeypatch):
    from types import SimpleNamespace
    """Testez la composition de produits de monnaie pour Free Fire."""
    # Setup Free Fire game with currency label
    run(db.games.update_one(
        {"id": FREE_FIRE},
        {"$set": {"active": True, "currency_label": "Diamants", "fazercards_categories": ["ff_cat_1"], "fazercards_categories_configured": True}},
        upsert=True,
    ))
    # Ensure PUBG game remains active for regression
    run(db.games.update_one(
        {"id": PUBG},
        {"$set": {"active": True}},
        upsert=True,
    ))

    # Mock categories for Free Fire
    def _patch_categor(monkeypatch, catalog):
        async def fake_all():
            return [dict(c) for c in catalog]
        monkeypatch.setattr(fazercards, "_topup_categories", fake_all)
    _patch_categor(monkeypatch, [{"category_id": "ff_cat_1", "name": "Free Fire Category", "note": ""}])

    # Mock offers for Free Fire category
    ff_offers = [
        {"offer_id": "ff_30", "name": "30 Diamants", "price_usd": "0.50"},
        {"offer_id": "ff_70", "name": "70 Diamants", "price_usd": "1.10"},
        {"offer_id": "ff_20", "name": "20 Diamants", "price_usd": "0.35"},
        {"offer_id": "ff_ambig", "name": "Diamonds Pack", "price_usd": "1.00"},
        {"offer_id": "ff_two", "name": "20 30 Diamonds", "price_usd": "1.50"},
    ]

    async def fake_offers(category_id):
        if category_id == "ff_cat_1":
            return {"category_id": category_id, "offers": ff_offers, "fields": []}
        return {"category_id": category_id, "offers": [], "fields": []}

    monkeypatch.setattr(fazercards, "pubg_offers_fresh", fake_offers)

    # Create a Free Fire currency product
    product_id = str(uuid.uuid4())
    slug = f"ff-100-diamonds-{product_id[:8]}"
    run(db.products.insert_one({
        "id": product_id,
        "slug": slug,
        "type": "uc",
        "name": "100 Diamonds",
        "uc_amount": 100,
        "price": 5000,
        "active": True,
        "game_id": FREE_FIRE,
        "requires_mapping": True,
        "fazercards_mapping": None,
    }))

    product = {"id": product_id, "slug": slug, "type": "uc", "name": "100 Diamonds",
               "uc_amount": 100, "price": 5000, "active": True, "game_id": FREE_FIRE, "requires_mapping": True,
               "fazercards_mapping": None}

    # Helper to create mapping body
    def make_body(category_id, mode, components=None, offer_id=None, confirmed=True):
        from types import SimpleNamespace
        return SimpleNamespace(
            category_id=category_id,
            mode=mode,
            components=components,
            offer_id=offer_id,
            confirmed=confirmed,
        )

    # 1. Exact composition accepted (30 + 70 = 100)
    body = make_body("ff_cat_1", "composite", components=[
        SimpleNamespace(offer_id="ff_30", quantity=1),
        SimpleNamespace(offer_id="ff_70", quantity=1),
    ])
    mapping = run(fzr_mapping.build_mapping(product, body))
    assert mapping["mode"] == "composite"
    assert len(mapping["components"]) == 2
    assert mapping["total_uc"] == 100
    assert {c["offer_id"] for c in mapping["components"]} == {"ff_30", "ff_70"}

    # 2. Wrong sum refused (30 + 20 = 50 != 100)
    body = make_body("ff_cat_1", "composite", components=[
        SimpleNamespace(offer_id="ff_30", quantity=1),
        SimpleNamespace(offer_id="ff_20", quantity=1),
    ])
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(product, body))
    assert exc.value.status_code == 409
    assert "Composition invalide" in exc.value.detail
    assert "50 Diamants" in exc.value.detail or "50" in exc.value.detail

    # 3. Offer without clear quantity refused
    body = make_body("ff_cat_1", "composite", components=[
        SimpleNamespace(offer_id="ff_ambig", quantity=1),
    ])
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(product, body))
    assert exc.value.status_code == 409
    assert "n'est pas une offre" in exc.value.detail
    assert "Diamants" in exc.value.detail

    # 4. Prime product refused in composition
    prime_product_id = str(uuid.uuid4())
    run(db.products.insert_one({
        "id": prime_product_id,
        "slug": f"ff-prime-{prime_product_id[:8]}",
        "type": "prime",
        "name": "Prime Subscription",
        "price": 5000,
        "active": True,
        "game_id": FREE_FIRE,
        "requires_mapping": True,
        "fazercards_mapping": None,
        "uc_amount": 0,
    }))
    prime_product = {"id": prime_product_id, "slug": f"ff-prime-{prime_product_id[:8]}", "type": "prime", "name": "Prime Subscription",
                     "price": 5000, "active": True, "game_id": FREE_FIRE, "requires_mapping": True,
                     "fazercards_mapping": None, "uc_amount": 0}
    body = make_body("ff_cat_1", "composite", components=[
        SimpleNamespace(offer_id="ff_30", quantity=1),
    ])
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(prime_product, body))
    assert exc.value.status_code == 409
    assert "La composition n'est autorisée que pour les produits" in exc.value.detail
    assert "Diamants" in exc.value.detail
    assert "Prime / Prime Plus / Pack évolutif : mapping direct uniquement." in exc.value.detail

    # 5. Direct mapping with another quantity refused (product 100 Diamants -> offer 50 Diamants)
    ff_offers_with_50 = ff_offers + [
        {"offer_id": "ff_50", "name": "50 Diamants", "price_usd": "0.75"},
    ]
    async def fake_offers_50(category_id):
        return {"category_id": category_id, "offers": ff_offers_with_50 if category_id == "ff_cat_1" else [], "fields": []}

    monkeypatch.setattr(fazercards, "pubg_offers_fresh", fake_offers_50)
    body = make_body("ff_cat_1", "direct", offer_id="ff_50")
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(product, body))
    assert exc.value.status_code == 409
    assert "Mapping direct invalide" in exc.value.detail
    assert "50 Diamants" in exc.value.detail
    assert "100 Diamants" in exc.value.detail

    # 6. Isolation between games: PUBG product cannot use Free Fire offers
    pubg_product_id = str(uuid.uuid4())
    run(db.products.insert_one({
        "id": pubg_product_id,
        "slug": f"pubg-60-uc-{pubg_product_id[:8]}",
        "type": "uc",
        "name": "60 UC",
        "price": 5000,
        "active": True,
        "game_id": PUBG,
        "requires_mapping": True,
        "fazercards_mapping": None,
        "uc_amount": 60,
    }))
    pubg_product = {"id": pubg_product_id, "slug": f"pubg-60-uc-{pubg_product_id[:8]}", "type": "uc", "name": "60 UC",
                    "price": 5000, "active": True, "game_id": PUBG, "requires_mapping": True,
                    "fazercards_mapping": None, "uc_amount": 60}
    body = make_body("ff_cat_1", "direct", offer_id="ff_30")
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(pubg_product, body))
    assert exc.value.status_code == 409
    assert "Cette catégorie FazerCards n'appartient pas au jeu" in exc.value.detail

    # 7. Free Fire product cannot use PUBG offers
    body = make_body("pubg_mobile_auto", "direct", offer_id="uc_60")
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(product, body))
    assert exc.value.status_code == 409
    assert "Cette catégorie FazerCards n'appartient pas au jeu" in exc.value.detail

    # 8. PUBG regression: ensure a PUBG product still works as before
    pubg_simple_id = str(uuid.uuid4())
    run(db.products.insert_one({
        "id": pubg_simple_id,
        "slug": f"pubg-simple-{pubg_simple_id[:8]}",
        "type": "uc",
        "name": "60 UC Simple",
        "price": 5000,
        "active": True,
        "game_id": PUBG,
        "requires_mapping": True,
        "fazercards_mapping": {"mode": "direct", "category_id": "pubg_mobile_auto", "offer_id": "uc_60",
                               "offer_name": "60 UC", "price_usd_at_link": "0.88", "confirmed": True},
    }))
    stored = run(db.products.find_one({"id": pubg_simple_id}, {"_id": 0, "fazercards_mapping": 1}))
    assert stored["fazercards_mapping"] is not None
    assert fzr_mapping.mapping_ok(stored["fazercards_mapping"]) is True

    # Cleanup
    run(db.products.delete_many({"id": [product_id, prime_product_id, pubg_product_id, pubg_simple_id]}))
    run(db.games.update_one({"id": FREE_FIRE}, {"$set": {"active": False}}))
    run(db.games.update_one({"id": PUBG}, {"$set": {"active": True}}))


FF_OFFERS_SIMPLE = [{"offer_id": "ff_30", "name": "30 Diamants", "price_usd": "0.50"},
                    {"offer_id": "ff_70", "name": "70 Diamants", "price_usd": "1.10"}]


def _setup_free_fire(monkeypatch, offers=None):
    """Jeu Free Fire configuré (catégorie + monnaie) et catalogue mocké, sans réseau réel."""
    run(db.games.update_one(
        {"id": FREE_FIRE},
        {"$set": {"active": True, "currency_label": "Diamants",
                  "fazercards_categories": ["ff_cat_1"], "fazercards_categories_configured": True}},
        upsert=True))

    async def fake_all():
        return [{"category_id": "ff_cat_1", "name": "Free Fire Category", "note": ""}]
    monkeypatch.setattr(fazercards, "_topup_categories", fake_all)
    catalog = offers or FF_OFFERS_SIMPLE

    async def fake_offers(category_id):
        return {"category_id": category_id, "offers": catalog if category_id == "ff_cat_1" else [], "fields": []}
    monkeypatch.setattr(fazercards, "pubg_offers_fresh", fake_offers)


@pytest.mark.parametrize("type_key", ["prime", "prime_plus", "evo"])
def test_free_fire_non_currency_composition_refused(monkeypatch, type_key):
    """Prime / Prime+ / Pack évolutif : composition toujours refusée, même avec une quantité,
    et le message porte la monnaie du jeu."""
    from types import SimpleNamespace
    _setup_free_fire(monkeypatch)
    product = {"id": str(uuid.uuid4()), "slug": f"ff-{type_key}", "type": type_key,
               "name": "Abonnement FF", "uc_amount": 70 if type_key == "evo" else 0,
               "price": 5000, "active": True, "game_id": FREE_FIRE}
    body = SimpleNamespace(category_id="ff_cat_1", mode="composite", offer_id=None, confirmed=True,
                           components=[SimpleNamespace(offer_id="ff_30", quantity=1)])
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(product, body))
    assert exc.value.status_code == 409
    assert exc.value.detail == ("La composition n'est autorisée que pour les produits Diamants. "
                                "Prime / Prime Plus / Pack évolutif : mapping direct uniquement.")


def test_free_fire_direct_mapping_requires_same_quantity(monkeypatch):
    """La règle « même quantité que l'offre » s'applique aussi aux produits de monnaie non-PUBG."""
    from types import SimpleNamespace
    _setup_free_fire(monkeypatch, offers=[{"offer_id": "ff_50", "name": "50 Diamants", "price_usd": "0.75"},
                                          {"offer_id": "ff_100", "name": "100 Diamants", "price_usd": "1.50"}])
    product = {"id": str(uuid.uuid4()), "slug": "ff-100", "type": "uc", "name": "100 Diamants",
               "uc_amount": 100, "price": 5000, "active": True, "game_id": FREE_FIRE}
    # Quantité différente → refus, message avec la monnaie du jeu
    body = SimpleNamespace(category_id="ff_cat_1", mode="direct", offer_id="ff_50", confirmed=True, components=None)
    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping(product, body))
    assert exc.value.status_code == 409
    assert exc.value.detail == ("Mapping direct invalide : « 50 Diamants » = 50 Diamants ≠ 100 Diamants attendus. "
                                "Utilisez l'offre exacte ou une composition dont la somme vaut exactement 100 Diamants.")
    # Même quantité → accepté
    body = SimpleNamespace(category_id="ff_cat_1", mode="direct", offer_id="ff_100", confirmed=True, components=None)
    m = run(fzr_mapping.build_mapping(product, body))
    assert m["mode"] == "direct" and m["offer_id"] == "ff_100" and m["offer_name"] == "100 Diamants"
