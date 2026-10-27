"""Lot 4 bis — `purchase_blocked` conscient du fournisseur du jeu.

Tests PURS : aucun réseau, aucune Mongo. Le faux db est celui de `test_aluu_fulfillment`
(réutilisé tel quel) ; `providers.provider_for_game` est RÉEL, seule la collection change.
"""
import asyncio

import pytest

from core import db as core_db
from services import fzr_mapping, providers

from test_aluu_fulfillment import FakeDb

GAME = "free-fire"

ALUU_GAME = {
    "id": GAME, "provider": "aluu", "aluu_game_code": "ff",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
}
# Configuration ALUU incomplète : la résolution doit échouer (fail-closed à l'achat).
ALUU_GAME_BROKEN = {"id": GAME, "provider": "aluu", "aluu_game_code": "", "aluu_check_endpoint": "",
                    "aluu_identity_map": {}}
# Fournisseur inconnu : jamais interprété comme ALUU ni comme FazerCards.
GAME_UNKNOWN_PROVIDER = {"id": GAME, "provider": "binance"}
FAZER_GAME = {"id": GAME}
FAZER_GAME_EXPLICIT = {"id": GAME, "provider": "fazercards"}

ALUU_MAPPING_OK = {"game_code": "ff", "denom": "60", "confirmed": True, "price_usd_at_link": 0.83}
FC_MAPPING_OK = {"mode": "direct", "category_id": "free_fire", "offer_id": "60", "confirmed": True}

BLOCKED_MESSAGE = ("« 60 Diamants » n'est pas encore disponible : "
                   "mapping fournisseur manquant ou non confirmé.")


def run(coro):
    return asyncio.run(coro)


def product(**fields):
    doc = {"id": "p-60", "game_id": GAME, "name": "60 Diamants", "requires_mapping": True}
    doc.update(fields)
    return doc


@pytest.fixture
def games(monkeypatch):
    """Installe le faux db et remet le cache de résolution à zéro (sinon fuite entre tests)."""
    def install(documents):
        fake = FakeDb(games=documents)
        monkeypatch.setattr(core_db, "db", fake)
        monkeypatch.setattr(fzr_mapping, "db", fake)
        monkeypatch.setattr(providers, "_PROVIDER_CACHE", {})
        monkeypatch.setattr(providers, "_INSTANCES", {})
        return fake

    return install


# --------------------------------------------------------------------------- jeu ALUU

def test_aluu_product_with_a_confirmed_aluu_mapping_is_sellable(games):
    games([ALUU_GAME])
    assert run(fzr_mapping.purchase_blocked(product(aluu_mapping=ALUU_MAPPING_OK))) is None


def test_aluu_product_without_any_mapping_is_blocked(games):
    games([ALUU_GAME])
    assert run(fzr_mapping.purchase_blocked(product())) == BLOCKED_MESSAGE


def test_aluu_product_with_an_unconfirmed_aluu_mapping_is_blocked(games):
    games([ALUU_GAME])
    mapping = {**ALUU_MAPPING_OK, "confirmed": False}
    assert run(fzr_mapping.purchase_blocked(product(aluu_mapping=mapping))) == BLOCKED_MESSAGE


def test_aluu_product_with_an_incomplete_aluu_mapping_is_blocked(games):
    games([ALUU_GAME])
    assert run(fzr_mapping.purchase_blocked(
        product(aluu_mapping={"game_code": "ff", "confirmed": True}))) == BLOCKED_MESSAGE


def test_aluu_game_with_only_a_legacy_fazercards_mapping_is_blocked(games):
    """Le cas de la migration : jeu passé FazerCards → ALUU, ancien mapping resté en base."""
    games([ALUU_GAME])
    assert run(fzr_mapping.purchase_blocked(product(fazercards_mapping=FC_MAPPING_OK))) == BLOCKED_MESSAGE


def test_aluu_game_ignores_a_fazercards_mapping_even_when_both_are_present(games):
    """Le champ lu est celui du fournisseur du jeu, jamais « le premier mapping trouvé »."""
    games([ALUU_GAME])
    broken = {**ALUU_MAPPING_OK, "denom": ""}
    assert run(fzr_mapping.purchase_blocked(
        product(aluu_mapping=broken, fazercards_mapping=FC_MAPPING_OK))) == BLOCKED_MESSAGE


# --------------------------------------------------------------------------- FazerCards

def test_fazercards_product_is_unchanged(games):
    games([FAZER_GAME])
    assert run(fzr_mapping.purchase_blocked(product())) == BLOCKED_MESSAGE
    assert run(fzr_mapping.purchase_blocked(product(fazercards_mapping=FC_MAPPING_OK))) is None
    assert run(fzr_mapping.purchase_blocked(
        product(fazercards_mapping={**FC_MAPPING_OK, "confirmed": False}))) == BLOCKED_MESSAGE


def test_fazercards_explicit_provider_and_missing_game_document_behave_the_same(games):
    games([FAZER_GAME_EXPLICIT])
    assert run(fzr_mapping.purchase_blocked(product(fazercards_mapping=FC_MAPPING_OK))) is None
    games([])  # document absent = défaut historique FazerCards
    assert run(fzr_mapping.purchase_blocked(product(fazercards_mapping=FC_MAPPING_OK))) is None


def test_fazercards_never_reads_aluu_mapping(games):
    """Un produit FazerCards sans `fazercards_mapping` reste bloqué même s'il porte un aluu_mapping."""
    games([FAZER_GAME])
    assert run(fzr_mapping.purchase_blocked(product(aluu_mapping=ALUU_MAPPING_OK))) == BLOCKED_MESSAGE


def test_product_without_requires_mapping_is_never_blocked(games):
    games([ALUU_GAME])
    assert run(fzr_mapping.purchase_blocked({"name": "X", "requires_mapping": False})) is None
    assert run(fzr_mapping.purchase_blocked(
        {"name": "X", "requires_mapping": False, "game_id": GAME})) is None


# --------------------------------------------------------------------------- fail-closed

def test_broken_aluu_configuration_blocks_the_purchase(games):
    """Config ALUU incomplète : la résolution lève — l'achat est BLOQUÉ, pas un 500."""
    games([ALUU_GAME_BROKEN])
    assert run(fzr_mapping.purchase_blocked(product(aluu_mapping=ALUU_MAPPING_OK))) == BLOCKED_MESSAGE


def test_unknown_provider_blocks_the_purchase(games):
    games([GAME_UNKNOWN_PROVIDER])
    assert run(fzr_mapping.purchase_blocked(product(fazercards_mapping=FC_MAPPING_OK))) == BLOCKED_MESSAGE


def test_database_failure_blocks_the_purchase(games, monkeypatch):
    class BrokenGames:
        @staticmethod
        async def find_one(*_args, **_kwargs):
            raise RuntimeError("base indisponible")

    class BrokenDb:
        games = BrokenGames()

    games([])
    monkeypatch.setattr(core_db, "db", BrokenDb())
    assert run(fzr_mapping.purchase_blocked(product(aluu_mapping=ALUU_MAPPING_OK))) == BLOCKED_MESSAGE


# --------------------------------------------------------------------------- vue admin

def test_mapping_view_reads_the_field_of_the_game_provider(games):
    aluu = product(aluu_mapping=ALUU_MAPPING_OK, fazercards_mapping={"confirmed": False})
    view = fzr_mapping.mapping_view(aluu, "aluu")
    assert view == {"mapping_status": "direct", "fulfillable": True, "supplier_cost_usd": 0.83}

    assert fzr_mapping.mapping_view(product(), "aluu")["mapping_status"] == "missing"
    assert fzr_mapping.mapping_view(
        product(aluu_mapping={**ALUU_MAPPING_OK, "confirmed": False}), "aluu")["mapping_status"] == "unconfirmed"
    assert fzr_mapping.mapping_view(
        product(aluu_mapping={"game_code": "ff", "confirmed": True}), "aluu")["mapping_status"] == "invalid"


def test_mapping_view_keeps_the_fazercards_vocabulary():
    composite = {"mode": "composite", "category_id": "c",
                 "components": [{"offer_id": "o", "quantity": 2}], "confirmed": True,
                 "total_price_usd_at_link": 1.7}
    view = fzr_mapping.mapping_view(product(fazercards_mapping=composite), None)
    assert view == {"mapping_status": "composite", "fulfillable": True, "supplier_cost_usd": 1.7}
    assert fzr_mapping.mapping_view(product(), "fazercards")["mapping_status"] == "missing"
