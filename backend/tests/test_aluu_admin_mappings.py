"""Lot 4 bis — écran admin des mappings : `mapping_status` / `fulfillable` par fournisseur.

Tests PURS (faux db de `test_aluu_fulfillment`). L'écran existant ne change pas : les trois
clés qu'il lit (`mapping_status`, `fulfillable`, `supplier_cost_usd`) disent la vérité pour un
jeu ALUU, comme pour un jeu FazerCards.
"""
import asyncio

from core import db as core_db
from routers import fzr_orders
from services import fzr_mapping

from test_aluu_fulfillment import FakeDb

import pytest

GAME = "free-fire"
PUBG = "pubg-mobile"

ALUU_GAME = {
    "id": GAME, "name": "Free Fire", "provider": "aluu", "aluu_game_code": "ff",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
}
FAZER_GAME = {"id": PUBG, "name": "PUBG Mobile"}
BROKEN_ALUU_GAME = {"id": GAME, "name": "Free Fire", "provider": "aluu"}

ALUU_MAPPING_OK = {"game_code": "ff", "denom": "60", "confirmed": True,
                   "offer_name": "60 Diamonds", "price_usd_at_link": 0.83}
FC_MAPPING_OK = {"mode": "direct", "category_id": "free_fire", "offer_id": "60",
                 "confirmed": True, "price_usd_at_link": 0.9}
FC_COMPOSITE = {"mode": "composite", "category_id": "uc", "confirmed": True,
                "components": [{"offer_id": "660", "quantity": 1}, {"offer_id": "60", "quantity": 1}],
                "total_price_usd_at_link": 9.5}

VIEW_KEYS = {"mapping_status", "fulfillable", "supplier_cost_usd"}


def run(coro):
    return asyncio.run(coro)


def product(product_id, game_id, **fields):
    return {"id": product_id, "slug": product_id, "name": product_id.upper(), "type": "currency",
            "price": 5000, "uc_amount": 60, "active": True, "requires_mapping": True,
            "game_id": game_id, **fields}


@pytest.fixture
def fake(monkeypatch):
    def install(*, games, products):
        doc = FakeDb(games=games, products=products)
        monkeypatch.setattr(core_db, "db", doc)
        monkeypatch.setattr(fzr_orders, "db", doc)
        monkeypatch.setattr(fzr_mapping, "db", doc)
        return doc

    return install


def by_id(products):
    return {p["id"]: p for p in products}


# --------------------------------------------------------------------------- jeu ALUU

def test_aluu_product_is_reported_from_aluu_mapping(fake):
    fake(games=[ALUU_GAME],
         products=[product("p-aluu", GAME, aluu_mapping=ALUU_MAPPING_OK)])
    row = by_id(run(fzr_orders.fzr_mappings(game=GAME))["products"])["p-aluu"]
    assert row["mapping_status"] == "direct"
    assert row["fulfillable"] is True
    assert row["supplier_cost_usd"] == 0.83


def test_aluu_product_without_mapping_is_reported_as_missing(fake):
    fake(games=[ALUU_GAME], products=[product("p-aluu", GAME)])
    row = by_id(run(fzr_orders.fzr_mappings(game=GAME))["products"])["p-aluu"]
    assert row["mapping_status"] == "missing"
    assert row["fulfillable"] is False
    assert row["supplier_cost_usd"] is None


def test_aluu_game_does_not_report_a_legacy_fazercards_mapping_as_fulfillable(fake):
    """L'écran doit montrer la vérité : ce produit ne partira pas chez ALUU."""
    fake(games=[ALUU_GAME],
         products=[product("p-legacy", GAME, fazercards_mapping=FC_MAPPING_OK)])
    row = by_id(run(fzr_orders.fzr_mappings(game=GAME))["products"])["p-legacy"]
    assert row["mapping_status"] == "missing"
    assert row["fulfillable"] is False


def test_aluu_product_with_unconfirmed_mapping_is_reported_as_unconfirmed(fake):
    fake(games=[ALUU_GAME],
         products=[product("p-aluu", GAME, aluu_mapping={**ALUU_MAPPING_OK, "confirmed": False})])
    row = by_id(run(fzr_orders.fzr_mappings(game=GAME))["products"])["p-aluu"]
    assert row["mapping_status"] == "unconfirmed"
    assert row["fulfillable"] is False


def test_broken_aluu_configuration_still_renders_the_screen(fake):
    """L'écran admin ne doit jamais tomber en 500 à cause d'une config de jeu invalide."""
    fake(games=[BROKEN_ALUU_GAME],
         products=[product("p-aluu", GAME, aluu_mapping=ALUU_MAPPING_OK)])
    row = by_id(run(fzr_orders.fzr_mappings(game=GAME))["products"])["p-aluu"]
    # Le champ `provider` du document suffit à lire le bon mapping : la vérité reste affichée.
    assert row["mapping_status"] == "direct"
    assert row["fulfillable"] is True


# --------------------------------------------------------------------------- FazerCards inchangé

def test_fazercards_values_are_unchanged(fake):
    fake(games=[FAZER_GAME],
         products=[product("p-direct", PUBG, fazercards_mapping=FC_MAPPING_OK),
                   product("p-comp", PUBG, fazercards_mapping=FC_COMPOSITE),
                   product("p-none", PUBG)])
    rows = by_id(run(fzr_orders.fzr_mappings(game=PUBG))["products"])
    assert (rows["p-direct"]["mapping_status"], rows["p-direct"]["fulfillable"]) == ("direct", True)
    assert rows["p-direct"]["supplier_cost_usd"] == 0.9
    assert (rows["p-comp"]["mapping_status"], rows["p-comp"]["fulfillable"]) == ("composite", True)
    assert rows["p-comp"]["supplier_cost_usd"] == 9.5
    assert (rows["p-none"]["mapping_status"], rows["p-none"]["fulfillable"]) == ("missing", False)


def test_game_document_absent_keeps_the_fazercards_reading(fake):
    fake(games=[], products=[product("p-legacy", None, fazercards_mapping=FC_MAPPING_OK)])
    row = by_id(run(fzr_orders.fzr_mappings())["products"])["p-legacy"]
    assert row["mapping_status"] == "direct"
    assert row["fulfillable"] is True


# --------------------------------------------------------------------------- liste mixte

def test_each_row_uses_the_provider_of_its_own_game(fake):
    fake(games=[ALUU_GAME, FAZER_GAME],
         products=[product("p-aluu", GAME, aluu_mapping=ALUU_MAPPING_OK),
                   product("p-fc", PUBG, fazercards_mapping=FC_MAPPING_OK)])
    rows = by_id(run(fzr_orders.fzr_mappings())["products"])
    assert rows["p-aluu"]["fulfillable"] is True and rows["p-aluu"]["mapping_status"] == "direct"
    assert rows["p-fc"]["fulfillable"] is True and rows["p-fc"]["mapping_status"] == "direct"


def test_the_three_keys_read_by_the_existing_screen_are_present_on_every_row(fake):
    fake(games=[ALUU_GAME, FAZER_GAME],
         products=[product("p-aluu", GAME), product("p-fc", PUBG)])
    for row in run(fzr_orders.fzr_mappings())["products"]:
        assert VIEW_KEYS <= set(row)
