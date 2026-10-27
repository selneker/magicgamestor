"""Lot 4 — `core.games` : catalogue vendable et readiness pilotés par le fournisseur du jeu.

Tests PURS : `core.games.db` est remplacé par un double en mémoire (aucune Mongo).
La branche FazerCards (document sans `provider`) doit rester strictement identique.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core import games
from services import fzr_mapping

ALUU_GAME = {
    "id": "free-fire", "provider": "aluu", "aluu_game_code": "ff",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
    "identity_fields": [{"key": "player_id", "label": "ID", "required": True, "primary": True}],
    "product_types": [{"key": "diamond", "label": "Diamants"}],
}
FAZER_GAME = {
    "id": "free-fire",
    "identity_fields": [{"key": "player_id", "label": "ID", "required": True, "primary": True}],
    "product_types": [{"key": "diamond", "label": "Diamants"}],
}
ALUU_MAPPING = {"game_code": "ff", "denom": "60", "confirmed": True}
FAZER_MAPPING = {"mode": "direct", "category_id": "cat", "offer_id": "60", "confirmed": True}


def run(coro):
    return asyncio.run(coro)


class FakeCursor:
    def __init__(self, documents):
        self._documents = list(documents)

    async def to_list(self, _limit):
        return list(self._documents)

    def __aiter__(self):
        async def generator():
            for document in self._documents:
                yield document

        return generator()


class FakeProducts:
    def __init__(self, documents):
        self.documents = list(documents)

    def find(self, query, projection=None):
        return FakeCursor([doc for doc in self.documents
                           if all(doc.get(k) == v for k, v in query.items()
                                  if not isinstance(v, dict))])


class FakeGames:
    def __init__(self, documents):
        self.documents = list(documents)

    async def find_one(self, query, projection=None):
        for doc in self.documents:
            if doc.get("id") == query.get("id"):
                return dict(doc)
        return None


class FakeDb:
    def __init__(self, games_docs=(), products=()):
        self.games = FakeGames(games_docs)
        self.products = FakeProducts(products)


def install(monkeypatch, games_docs, products):
    fake = FakeDb(games_docs, products)
    monkeypatch.setattr(games, "db", fake)
    monkeypatch.setattr(fzr_mapping, "db", fake)
    return fake


# --------------------------------------------------------------------------- fournisseur

def test_game_provider_is_fail_closed():
    assert games.game_provider(None) == "fazercards"
    assert games.game_provider({}) == "fazercards"
    assert games.game_provider({"provider": "stripe"}) == "fazercards"
    assert games.game_provider({"provider": "ALUU"}) == "aluu"


# --------------------------------------------------------------------------- catalogue vendable

def test_fazercards_game_keeps_its_historical_rule(monkeypatch):
    install(monkeypatch, [FAZER_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "fazercards_mapping": FAZER_MAPPING}])

    assert run(games.game_has_sellable_catalog("free-fire")) is True


def test_aluu_game_with_aluu_mapping_is_sellable(monkeypatch):
    install(monkeypatch, [ALUU_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "aluu_mapping": ALUU_MAPPING}])

    assert run(games.game_has_sellable_catalog("free-fire")) is True


def test_aluu_game_with_only_a_fazercards_mapping_is_not_sellable(monkeypatch):
    """Fail-closed : un mapping FazerCards ne rend JAMAIS un jeu ALUU vendable."""
    install(monkeypatch, [ALUU_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "fazercards_mapping": FAZER_MAPPING}])

    assert run(games.game_has_sellable_catalog("free-fire")) is False


def test_aluu_game_with_incomplete_config_is_not_sellable(monkeypatch):
    incomplete = {**ALUU_GAME, "aluu_check_endpoint": ""}
    install(monkeypatch, [incomplete], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "aluu_mapping": ALUU_MAPPING}])

    assert run(games.game_has_sellable_catalog("free-fire")) is False


def test_product_without_required_mapping_stays_sellable(monkeypatch):
    install(monkeypatch, [ALUU_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": False}])

    assert run(games.game_has_sellable_catalog("free-fire")) is True


def test_inactive_products_never_make_a_game_sellable(monkeypatch):
    install(monkeypatch, [FAZER_GAME], [
        {"game_id": "free-fire", "active": False, "requires_mapping": False}])

    assert run(games.game_has_sellable_catalog("free-fire")) is False


# --------------------------------------------------------------------------- readiness

def test_fazercards_readiness_keeps_exactly_the_six_historical_checks(monkeypatch):
    install(monkeypatch, [FAZER_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "type": "diamond", "name": "60 Diamants", "fazercards_mapping": FAZER_MAPPING}])

    report = run(games.game_readiness(FAZER_GAME))

    assert [c["key"] for c in report["checks"]] == [
        "identity", "product_types", "provider_categories", "catalog", "type_compat",
        "mapping_scope"]
    assert "provider_config" not in {c["key"] for c in report["checks"]}


def test_aluu_readiness_adds_a_provider_config_check_and_uses_aluu_mapping(monkeypatch):
    install(monkeypatch, [ALUU_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "type": "diamond", "name": "60 Diamants", "aluu_mapping": ALUU_MAPPING}])

    report = run(games.game_readiness(ALUU_GAME))
    checks = {c["key"]: c for c in report["checks"]}

    assert "provider_config" in checks and checks["provider_config"]["ok"] is True
    assert checks["catalog"]["ok"] is True
    assert checks["provider_categories"]["ok"] is True   # code jeu ALUU présent
    assert report["ready"] is True


def test_aluu_readiness_refuses_a_mapping_linked_to_another_game_code(monkeypatch):
    install(monkeypatch, [ALUU_GAME], [
        {"game_id": "free-fire", "active": True, "requires_mapping": True,
         "type": "diamond", "name": "60 Diamants",
         "aluu_mapping": {"game_code": "pubgm", "denom": "60", "confirmed": True}}])

    report = run(games.game_readiness(ALUU_GAME))
    checks = {c["key"]: c for c in report["checks"]}

    assert checks["mapping_scope"]["ok"] is False
    assert "60 Diamants" in checks["mapping_scope"]["detail"]
    assert report["ready"] is False


def test_aluu_readiness_flags_an_incomplete_provider_configuration(monkeypatch):
    incomplete = {**ALUU_GAME, "aluu_identity_map": {}}
    install(monkeypatch, [incomplete], [])

    report = run(games.game_readiness(incomplete))
    checks = {c["key"]: c for c in report["checks"]}

    assert checks["provider_config"]["ok"] is False
    assert report["ready"] is False


# --------------------------------------------------------------------------- fzr_mapping

class FakeProvider:
    def __init__(self, name):
        self.name = name
        self.calls = []

    async def get_offers(self, category_id):
        self.calls.append(category_id)
        return {"category_id": category_id, "offers": [
            {"offer_id": "60", "name": "60 Diamonds", "price_usd": 0.83}], "fields": []}


def _patch_provider(monkeypatch, provider):
    async def fake_provider_for_game(game_id, *, games=None):
        return provider

    monkeypatch.setattr(fzr_mapping.providers, "provider_for_game", fake_provider_for_game)
    return provider


def test_build_mapping_refuses_an_aluu_game_without_reading_any_catalogue(monkeypatch):
    _patch_provider(monkeypatch, FakeProvider("aluu"))

    async def forbidden(*_args, **_kwargs):  # pragma: no cover - ne doit jamais être appelé
        raise AssertionError("aucun catalogue ne doit être lu pour un jeu ALUU")

    monkeypatch.setattr(fzr_mapping, "offers_for_game", forbidden)

    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.build_mapping({"id": "p", "game_id": "free-fire"},
                                      SimpleNamespace(category_id="ff", mode="direct")))

    assert exc.value.status_code == 409
    assert "ALUU" in exc.value.detail


def test_apply_uc_audit_refuses_an_aluu_game(monkeypatch):
    _patch_provider(monkeypatch, FakeProvider("aluu"))

    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.apply_uc_audit([], actor="admin:1", game_id="free-fire"))

    assert exc.value.status_code == 409


def test_audit_uc_products_ignores_an_aluu_game_without_querying_products(monkeypatch):
    _patch_provider(monkeypatch, FakeProvider("aluu"))

    async def forbidden(*_args, **_kwargs):  # pragma: no cover
        raise AssertionError("aucun produit ne doit être lu pour un jeu ALUU")

    monkeypatch.setattr(fzr_mapping.db, "products",
                        SimpleNamespace(find=forbidden))

    assert run(fzr_mapping.audit_uc_products([], game_id="free-fire")) == []


def test_offers_for_game_keeps_the_fazercards_calls_unchanged(monkeypatch):
    calls = []

    async def fake_categories(game_id):
        calls.append(("categories", game_id))
        return [{"category_id": "cat-a"}]

    async def fake_offers(category_id):
        calls.append(("offers", category_id))
        return {"category_id": category_id, "offers": []}

    monkeypatch.setattr(fzr_mapping.fazercards, "game_categories", fake_categories)
    monkeypatch.setattr(fzr_mapping.fazercards, "pubg_offers_fresh", fake_offers)

    result = run(fzr_mapping.offers_for_game("pubg-mobile", "cat-a",
                                             provider=FakeProvider("fazercards")))

    assert calls == [("categories", "pubg-mobile"), ("offers", "cat-a")]
    assert result == {"category_id": "cat-a", "offers": []}


def test_offers_for_game_refuses_a_category_that_is_not_the_aluu_game_code(monkeypatch):
    install(monkeypatch, [ALUU_GAME], [])
    provider = FakeProvider("aluu")

    with pytest.raises(HTTPException) as exc:
        run(fzr_mapping.offers_for_game("free-fire", "pubgm", provider=provider))

    assert exc.value.status_code == 409
    assert provider.calls == []


def test_offers_for_game_reads_the_aluu_game_code_catalogue(monkeypatch):
    install(monkeypatch, [ALUU_GAME], [])
    provider = FakeProvider("aluu")

    result = run(fzr_mapping.offers_for_game("free-fire", "ff", provider=provider))

    assert provider.calls == ["ff"]
    assert result["category_id"] == "ff"


def test_offers_for_game_without_game_id_keeps_the_historical_path(monkeypatch):
    calls = []

    async def fake_offers(category_id):
        calls.append(category_id)
        return {"category_id": category_id, "offers": []}

    monkeypatch.setattr(fzr_mapping.fazercards, "pubg_offers_fresh", fake_offers)

    assert run(fzr_mapping.offers_for_game(None, "any"))["category_id"] == "any"
    assert calls == ["any"]
