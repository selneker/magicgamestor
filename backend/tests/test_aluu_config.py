"""Lot 3 — résolution du fournisseur par jeu (`providers.provider_for_game`).

Tests PURS : aucun Mongo (collection `games` factice), aucun appel réseau réel
(`httpx.MockTransport`), aucun secret de production, aucun identifiant joueur complet loggué.
"""
import asyncio
import logging
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import fazercards
from services import aluu
from services import fazercards as fzr
from services import providers
from services.providers.aluu_adapter import AluuProvider
from services.providers.base import IdentityValidation, Provider
from services.providers.errors import ProviderUnavailableError
from services.providers.fazercards_adapter import FazerCardsProvider

RealAsyncClient = httpx.AsyncClient
API_KEY = "aluu_dummy_key_for_tests"
PLAYER_ID = "51234567890"

ALUU_GAME = {
    "id": "pubg-mobile", "provider": "aluu", "aluu_game_code": "pubgm",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
    "identity_fields": [
        {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,13}$",
         "min_length": 6, "max_length": 13, "required": True, "primary": True},
    ],
}
FAZER_GAME = {"id": "free-fire"}


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- faux Mongo

class FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    async def to_list(self, length=None):
        return [dict(doc) for doc in self._docs][:length] if length else [dict(doc) for doc in self._docs]


class FakeCollection:
    """Collection `games` factice : filtre égalité simple, aucune connexion réseau."""

    def __init__(self, docs: list[dict]):
        self.docs = [dict(doc) for doc in docs]
        self.find_one_calls: list[dict] = []
        self.find_calls: list[dict] = []

    async def find_one(self, query, projection=None):
        self.find_one_calls.append(dict(query))
        for doc in self.docs:
            if doc.get("id") == query.get("id"):
                return dict(doc)
        return None

    def find(self, query, projection=None):
        self.find_calls.append(dict(query))
        return FakeCursor([doc for doc in self.docs if self._matches(doc, query)])

    @staticmethod
    def _matches(doc: dict, query: dict) -> bool:
        """Sous-ensemble du langage de requête Mongo réellement utilisé : égalité, `$exists`, `$or`."""
        for key, expected in query.items():
            if key == "$or":
                if not any(FakeCollection._matches(doc, sub) for sub in expected):
                    return False
            elif isinstance(expected, dict) and "$exists" in expected:
                if (key in doc) is not bool(expected["$exists"]):
                    return False
            elif expected is None:
                if doc.get(key) is not None:
                    return False
            elif str(doc.get(key)).strip().lower() != str(expected).strip().lower():
                return False
        return True


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    """Cache vide et environnement isolé : aucune valeur du .env local ne doit influencer."""
    monkeypatch.setenv("ALUU_API_KEY", API_KEY)
    monkeypatch.setenv("ALUU_API_BASE", "https://aluu.in")
    monkeypatch.delenv("ALUU_SECRET_KEY", raising=False)
    monkeypatch.delenv("ALUU_WEBHOOK_SECRET", raising=False)
    providers.invalidate_provider_cache()
    yield
    providers.invalidate_provider_cache()


def mock_transport(monkeypatch, handler):
    def factory(**_kwargs):
        return RealAsyncClient(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(aluu.httpx, "AsyncClient", factory)


# --------------------------------------------------------------------------- résolution

def test_game_without_provider_uses_exactly_the_fazercards_path(monkeypatch):
    """Jeu sans champ `provider` : chemin FazerCards historique, sans détour ALUU."""
    calls: list[tuple] = []

    async def fake_validate(fields, game_id=None):
        calls.append((fields, game_id))
        return {"valid": True, "player_name": "FFPlayer", "region": None}

    monkeypatch.setattr(fzr, "validate_identity", fake_validate)
    collection = FakeCollection([FAZER_GAME])

    provider = run(providers.provider_for_game("free-fire", games=collection))
    result = run(provider.validate_identity("free-fire", {"player_id": "123456789"}))

    assert isinstance(provider, FazerCardsProvider)
    assert provider.name == "fazercards"
    assert calls == [({"player_id": "123456789"}, "free-fire")]
    assert result == IdentityValidation(valid=True, player_name="FFPlayer", region=None,
                                        raw={"valid": True, "player_name": "FFPlayer", "region": None})


def test_explicit_fazercards_provider_is_respected():
    collection = FakeCollection([{"id": "free-fire", "provider": "fazercards"}])
    assert run(providers.provider_for_game("free-fire", games=collection)).name == "fazercards"


def test_missing_game_document_keeps_the_current_behaviour():
    """Document introuvable : aucun jeu n'est présumé ALUU."""
    provider = run(providers.provider_for_game("inconnu", games=FakeCollection([])))
    assert provider.name == "fazercards"


def test_blank_game_id_keeps_fazercards_and_reads_no_database():
    collection = FakeCollection([ALUU_GAME])
    assert run(providers.provider_for_game(None, games=collection)).name == "fazercards"
    assert run(providers.provider_for_game("   ", games=collection)).name == "fazercards"
    assert collection.find_one_calls == []


def test_aluu_game_resolves_to_the_aluu_provider():
    provider = run(providers.provider_for_game("pubg-mobile", games=FakeCollection([ALUU_GAME])))
    assert isinstance(provider, AluuProvider)
    assert isinstance(provider, Provider)
    assert provider.name == "aluu"


def test_provider_field_is_normalized():
    doc = {**ALUU_GAME, "provider": "  ALUU "}
    provider = run(providers.provider_for_game("pubg-mobile", games=FakeCollection([doc])))
    assert provider.name == "aluu"


@pytest.mark.parametrize("provider_name", ["stripe", "fazer-cards", "none"])
def test_unknown_provider_is_an_error_never_a_fallback(provider_name):
    collection = FakeCollection([{"id": "free-fire", "provider": provider_name}])

    with pytest.raises(ProviderUnavailableError) as exc:
        run(providers.provider_for_game("free-fire", games=collection))

    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"


@pytest.mark.parametrize("override", [
    {"aluu_game_code": ""},                                   # code jeu absent
    {"aluu_check_endpoint": ""},                              # endpoint absent
    {"aluu_check_endpoint": "nope"},                          # endpoint non documenté
    {"aluu_identity_map": None},                              # table d'identité absente
    {"aluu_identity_map": {}},                                # table vide
    {"aluu_identity_map": {"player_id": "  "}},               # mapping vide
])
def test_aluu_game_with_incomplete_config_fails_closed(override):
    doc = {**ALUU_GAME, **override}
    collection = FakeCollection([doc])

    with pytest.raises(ProviderUnavailableError) as exc:
        run(providers.provider_for_game("pubg-mobile", games=collection))

    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"
    assert collection.find_one_calls  # la config a bien été relue


# --------------------------------------------------------------------------- cache

def test_resolution_is_cached_for_sixty_seconds():
    collection = FakeCollection([ALUU_GAME])

    assert run(providers.provider_for_game("pubg-mobile", games=collection)).name == "aluu"
    expires_at, name = providers._PROVIDER_CACHE["pubg-mobile"]
    assert name == "aluu"
    assert expires_at - time.monotonic() == pytest.approx(providers.PROVIDER_CACHE_TTL_S, abs=2)
    assert providers.PROVIDER_CACHE_TTL_S == 60

    assert run(providers.provider_for_game("pubg-mobile", games=collection)).name == "aluu"
    assert len(collection.find_one_calls) == 1          # un seul document lu


def test_expired_entry_triggers_a_new_read():
    collection = FakeCollection([ALUU_GAME])
    providers._PROVIDER_CACHE["pubg-mobile"] = (time.monotonic() - 1, "fazercards")

    assert run(providers.provider_for_game("pubg-mobile", games=collection)).name == "aluu"
    assert len(collection.find_one_calls) == 1


def test_explicit_invalidation_forces_a_new_read():
    collection = FakeCollection([ALUU_GAME])
    run(providers.provider_for_game("pubg-mobile", games=collection))
    collection.docs = [{"id": "pubg-mobile", "provider": "fazercards"}]

    providers.invalidate_provider_cache("pubg-mobile")
    assert run(providers.provider_for_game("pubg-mobile", games=collection)).name == "fazercards"
    assert len(collection.find_one_calls) == 2


def test_global_invalidation_clears_every_entry():
    providers._PROVIDER_CACHE["a"] = (time.monotonic() + 60, "aluu")
    providers._PROVIDER_CACHE["b"] = (time.monotonic() + 60, "fazercards")

    providers.invalidate_provider_cache()

    assert providers._PROVIDER_CACHE == {}


def test_a_broken_config_is_never_cached():
    """Une config corrigée prend effet immédiatement : aucune erreur mise en cache."""
    collection = FakeCollection([{**ALUU_GAME, "aluu_check_endpoint": ""}])

    with pytest.raises(ProviderUnavailableError):
        run(providers.provider_for_game("pubg-mobile", games=collection))
    assert "pubg-mobile" not in providers._PROVIDER_CACHE

    collection.docs = [ALUU_GAME]
    assert run(providers.provider_for_game("pubg-mobile", games=collection)).name == "aluu"


def test_cached_aluu_game_still_fails_closed_when_config_degrades(monkeypatch):
    """Le cache ne peut pas transformer une config dégradée en appel réseau."""
    collection = FakeCollection([ALUU_GAME])
    provider = run(providers.provider_for_game("pubg-mobile", games=collection))
    collection.docs = [{key: value for key, value in ALUU_GAME.items()
                        if key != "aluu_identity_map"}]

    def no_network(**_kwargs):  # pragma: no cover - ne doit jamais être appelé
        raise AssertionError("aucun appel réseau attendu")

    monkeypatch.setattr(aluu.httpx, "AsyncClient", no_network)

    with pytest.raises(providers.ProviderError) as exc:
        run(provider.validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"


# --------------------------------------------------------------------------- contrat HTTP

@pytest.fixture
def make_client(monkeypatch):
    """Mini-app FastAPI : le routeur est monté tel quel, la base est remplacée par un faux."""

    def _make(docs: list[dict]):
        collection = FakeCollection(docs)
        monkeypatch.setattr(fazercards.db, "games", collection)
        monkeypatch.setattr(fazercards, "check", lambda *args, **kwargs: None)
        app = FastAPI()
        app.include_router(fazercards.router)
        return TestClient(app), collection

    return _make


def test_router_aluu_success_keeps_the_response_shape(make_client, monkeypatch):
    mock_transport(monkeypatch, lambda req: httpx.Response(
        200, json={"valid": "valid", "username": "PlayerName"}))
    client, _ = make_client([ALUU_GAME])

    response = client.post("/fazercards/validate-id",
                           json={"game_id": "pubg-mobile", "fields": {"player_id": PLAYER_ID}})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "player_name": "PlayerName", "region": None,
                               "game_id": "pubg-mobile"}


def test_router_aluu_error_never_falls_back_to_fazercards(make_client, monkeypatch):
    """403 ALUU → 502 applicatif ; FazerCards n'est JAMAIS appelé pour un jeu ALUU."""
    async def forbidden(*_args, **_kwargs):  # pragma: no cover - ne doit jamais être appelé
        raise AssertionError("repli FazerCards interdit pour un jeu configuré ALUU")

    monkeypatch.setattr(fzr, "validate_identity", forbidden)
    mock_transport(monkeypatch, lambda req: httpx.Response(
        403, json={"success": False, "code": "IP_NOT_ALLOWED"}))
    client, _ = make_client([ALUU_GAME])

    response = client.post("/fazercards/validate-id",
                           json={"game_id": "pubg-mobile", "fields": {"player_id": PLAYER_ID}})

    data = response.json()
    assert response.status_code == 502
    assert data["code"] == "provider_unavailable"
    assert data["game_id"] == "pubg-mobile"
    assert data["detail"]  # message conservé


def test_router_verification_failed_never_reaches_the_client(make_client, monkeypatch):
    """400 ambigu de `game-check` : 502 neutre, jamais « ID invalide » ni le code interne."""
    mock_transport(monkeypatch, lambda req: httpx.Response(
        400, json={"success": False, "message": "Bad request"}))
    client, _ = make_client([ALUU_GAME])

    response = client.post("/fazercards/validate-id",
                           json={"game_id": "pubg-mobile", "fields": {"player_id": PLAYER_ID}})

    data = response.json()
    assert response.status_code == 502
    assert data["code"] == "provider_unavailable"
    assert "verification_failed" not in str(data)
    assert data["game_id"] == "pubg-mobile"


def test_router_incomplete_aluu_config_is_unsupported_game(make_client, monkeypatch):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))
    client, _ = make_client([{**ALUU_GAME, "aluu_game_code": ""}])

    response = client.post("/fazercards/validate-id",
                           json={"game_id": "pubg-mobile", "fields": {"player_id": PLAYER_ID}})

    data = response.json()
    assert response.status_code == 503
    assert data["code"] == "unsupported_game"
    assert data["game_id"] == "pubg-mobile"
    assert "ALUU" in data["detail"]
    assert calls == []  # fail-closed avant tout appel réseau


def test_router_unknown_provider_is_unsupported_game(make_client, monkeypatch):
    async def forbidden(*_args, **_kwargs):  # pragma: no cover - ne doit jamais être appelé
        raise AssertionError("aucun repli attendu")

    monkeypatch.setattr(fzr, "validate_identity", forbidden)
    client, _ = make_client([{"id": "pubg-mobile", "provider": "stripe",
                              "identity_fields": ALUU_GAME["identity_fields"]}])

    response = client.post("/fazercards/validate-id",
                           json={"game_id": "pubg-mobile", "fields": {"player_id": PLAYER_ID}})

    data = response.json()
    assert response.status_code == 503
    assert data["code"] == "unsupported_game"
    assert data["game_id"] == "pubg-mobile"


def test_router_fazercards_game_is_unchanged(make_client, monkeypatch):
    """Régression : jeu sans `provider` → provider FazerCards, réponse identique à avant."""
    captured = {}

    class FakeFazerProvider:
        name = "fazercards"

        async def validate_identity(self, game_id, fields):
            captured["args"] = (game_id, dict(fields))
            return IdentityValidation(valid=True, player_name="FFPlayer", region=None)

    def fake_get_provider(game_id=None):
        captured["game_id"] = game_id
        return FakeFazerProvider()

    monkeypatch.setattr(fazercards.providers, "get_provider", fake_get_provider)
    client, _ = make_client([{"id": "free-fire",
                              "identity_fields": [{"key": "player_id", "label": "Player ID",
                                                   "pattern": r"^[0-9]{6,13}$", "min_length": 6,
                                                   "max_length": 13, "required": True,
                                                   "primary": True}]}])

    response = client.post("/fazercards/validate-id",
                           json={"game_id": "free-fire", "fields": {"player_id": "123456789"}})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "player_name": "FFPlayer", "region": None,
                               "game_id": "free-fire"}
    assert captured["game_id"] == "free-fire"
    assert captured["args"] == ("free-fire", {"player_id": "123456789"})


# ------------------------------------------------------------ route PUBG historique (compat)

LEGACY = "/fazercards/pubg/validate-id"


def test_legacy_pubg_route_fazercards_is_unchanged(make_client, monkeypatch):
    """Jeu sans `provider` : chemin FazerCards et corps de réponse identiques à avant."""
    calls = []

    async def fake_validate(fields, game_id=None):
        calls.append((fields, game_id))
        return {"valid": True, "player_name": "FZRName", "region": "Asia"}

    monkeypatch.setattr(fzr, "validate_identity", fake_validate)
    client, _ = make_client([{"id": "pubg-mobile"}])

    response = client.post(LEGACY, json={"player_id": PLAYER_ID})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "player_name": "FZRName", "region": "Asia"}
    assert calls == [({"player_id": PLAYER_ID}, "pubg-mobile")]


def test_legacy_pubg_route_fazercards_invalid_is_unchanged(make_client, monkeypatch):
    async def fake_validate(fields, game_id=None):
        return {"valid": False}

    monkeypatch.setattr(fzr, "validate_identity", fake_validate)
    client, _ = make_client([{"id": "pubg-mobile"}])

    response = client.post(LEGACY, json={"player_id": PLAYER_ID})

    assert response.status_code == 200
    assert response.json() == {"valid": False, "message": "ID PUBG Mobile invalide"}


def test_legacy_pubg_route_fazercards_error_keeps_the_plain_detail(make_client, monkeypatch):
    """Erreur FazerCards : même corps qu'avant (un `detail` seul, aucun `code`)."""
    detail = "Vérification d'ID indisponible."

    async def fake_validate(fields, game_id=None):
        raise fzr.IdentityValidationHTTPException(
            status_code=503, detail=detail, code="provider_unavailable")

    monkeypatch.setattr(fzr, "validate_identity", fake_validate)
    client, _ = make_client([{"id": "pubg-mobile"}])

    response = client.post(LEGACY, json={"player_id": PLAYER_ID})

    assert response.status_code == 503
    assert response.json() == {"detail": detail}


def test_legacy_pubg_route_aluu_valid_has_the_same_body_shape(make_client, monkeypatch):
    mock_transport(monkeypatch, lambda req: httpx.Response(
        200, json={"valid": "valid", "username": "PlayerName"}))
    client, _ = make_client([ALUU_GAME])

    response = client.post(LEGACY, json={"player_id": PLAYER_ID})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "player_name": "PlayerName", "region": None}


def test_legacy_pubg_route_aluu_invalid_keeps_the_historical_message(make_client, monkeypatch):
    mock_transport(monkeypatch, lambda req: httpx.Response(
        200, json={"valid": "invalid", "name": "na", "region": "na"}))
    client, _ = make_client([ALUU_GAME])

    response = client.post(LEGACY, json={"player_id": PLAYER_ID})

    assert response.status_code == 200
    assert response.json() == {"valid": False, "message": "ID PUBG Mobile invalide"}


def test_legacy_pubg_route_aluu_error_is_a_plain_detail_and_never_falls_back(
        make_client, monkeypatch):
    """403 ALUU → 502 avec un `detail` seul ; FazerCards n'est JAMAIS appelé."""
    async def forbidden(*_args, **_kwargs):  # pragma: no cover - ne doit jamais être appelé
        raise AssertionError("repli FazerCards interdit pour un jeu configuré ALUU")

    monkeypatch.setattr(fzr, "validate_identity", forbidden)
    mock_transport(monkeypatch, lambda req: httpx.Response(
        403, json={"success": False, "code": "IP_NOT_ALLOWED"}))
    client, _ = make_client([ALUU_GAME])

    response = client.post(LEGACY, json={"player_id": PLAYER_ID})

    data = response.json()
    assert response.status_code == 502
    assert data.keys() == {"detail"}          # ni `code`, ni `game_id` : contrat historique
    assert data["detail"]
    assert "aluu" not in str(data).lower()


# --------------------------------------------------------------------- journal (doc absent)

def test_missing_game_document_logs_at_debug_and_keeps_fazercards(caplog):
    """Document absent = cas normal : trace en `debug`, jamais une alerte."""
    with caplog.at_level("DEBUG", logger="services.providers"):
        provider = run(providers.provider_for_game("jeu-inexistant", games=FakeCollection([])))

    messages = [record.getMessage() for record in caplog.records
                if record.name == "services.providers"]
    assert provider.name == "fazercards"
    assert any("jeu-inexistant" in message and "fazercards" in message for message in messages)
    assert all(record.levelno < logging.WARNING for record in caplog.records
               if record.name == "services.providers")
    assert all(PLAYER_ID not in message for message in messages)


def test_existing_fazercards_document_logs_no_warning(caplog):
    """Document présent sans `provider` = cas NORMAL : aucune alerte."""
    with caplog.at_level("WARNING", logger="services.providers"):
        provider = run(providers.provider_for_game("free-fire", games=FakeCollection([FAZER_GAME])))

    assert provider.name == "fazercards"
    assert [record for record in caplog.records if record.name == "services.providers"] == []
