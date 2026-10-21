"""Validation d'identité Mobile Legends — contrat d'erreur et routage fournisseur.

Tests isolés : aucune connexion Mongo, aucun appel réseau réel, aucun ID complet loggué.
Le routeur est monté dans une mini-app FastAPI pour vérifier les corps JSON réels.
"""
import asyncio
import json
import logging
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import fazercards
from services import fazercards as fzr
from services.providers.base import IdentityValidation

ML = "mobile-legends"
FREE_FIRE = "free-fire"
PUBG = "pubg-mobile"

ML_GAME = {
    "id": ML,
    "identity_fields": [
        {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
         "min_length": 6, "max_length": 12, "required": True, "primary": True},
        {"key": "zone_id", "label": "Zone", "pattern": r"^[0-9]{1,5}$",
         "min_length": 1, "max_length": 5, "required": True},
    ],
    "fazercards_validation_category": "mobile_legends",
}

FREE_FIRE_GAME = {
    "id": FREE_FIRE,
    "identity_fields": [
        {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
         "min_length": 6, "max_length": 12, "required": True, "primary": True},
    ],
    "fazercards_validation_category": "free_fire",
}

PUBG_GAME = {"id": PUBG}


class FakeProvider:
    """Provider minimal : enregistre les arguments reçus par le vérificateur."""

    def __init__(self, result=None, exc: Exception | None = None):
        self.result = result or IdentityValidation(valid=True, player_name="MLPlayer", region="ID")
        self.exc = exc
        self.calls: list[tuple[str, dict]] = []

    async def validate_identity(self, game_id: str, fields: dict):
        self.calls.append((game_id, dict(fields)))
        if self.exc:
            raise self.exc
        return self.result


@pytest.fixture(autouse=True)
def _clear_validation_caches():
    fzr._discovery_cache["data"] = None
    fzr._game_discovery_cache.clear()
    yield
    fzr._discovery_cache["data"] = None
    fzr._game_discovery_cache.clear()


@pytest.fixture
def make_client(monkeypatch):
    def _make(game: dict, provider: FakeProvider, rate_limit_exc: HTTPException | None = None):
        async def fake_find_one(query, projection=None):
            return game if query.get("id") == game.get("id") else None

        def fake_check(*args, **kwargs):
            if rate_limit_exc:
                raise rate_limit_exc
            return None

        monkeypatch.setattr(fazercards.db, "games", SimpleNamespace(find_one=fake_find_one))
        monkeypatch.setattr(fazercards, "check", fake_check)
        monkeypatch.setattr(fazercards.providers, "get_provider", lambda game_id=None: provider)
        app = FastAPI()
        app.include_router(fazercards.router)
        return TestClient(app)

    return _make


def test_ml_transmits_game_id_and_both_fields(make_client):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="MLPlayer", region="ID"))
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "MLPlayer", "region": "ID", "game_id": ML}
    assert provider.calls == [(ML, {"player_id": "12345678", "zone_id": "2214"})]


def test_ml_success_keeps_existing_response_shape(make_client):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="MLPlayer"))
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    data = r.json()
    assert r.status_code == 200
    assert data["valid"] is True
    assert data["player_name"] == "MLPlayer"
    assert data["game_id"] == ML


def test_ml_refusal_returns_invalid_id_and_no_pubg_label(make_client):
    provider = FakeProvider(IdentityValidation(valid=False))
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    data = r.json()
    assert r.status_code == 200
    assert data["valid"] is False
    assert data["code"] == "invalid_id"
    assert data["game_id"] == ML
    assert data["message"] == "Identifiant joueur invalide pour ce jeu."
    assert "PUBG" not in data["message"]


def test_ml_missing_zone_returns_missing_field_without_provider_call(make_client):
    provider = FakeProvider()
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678"},
    })

    data = r.json()
    assert r.status_code == 200
    assert data["valid"] is False
    assert data["code"] == "missing_field"
    assert data["game_id"] == ML
    assert data["message"] == "Format d'identifiant invalide pour ce jeu."
    assert provider.calls == []


def test_ml_timeout_is_provider_unavailable_5xx(make_client):
    detail = "La vérification a expiré. Réessayez."
    provider = FakeProvider(exc=HTTPException(status_code=504, detail=detail))
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    data = r.json()
    assert r.status_code == 504
    assert data["detail"] == detail
    assert data["code"] == "provider_unavailable"
    assert data["game_id"] == ML
    assert data["code"] != "invalid_id"


def test_ml_provider_5xx_is_provider_unavailable(make_client):
    detail = "Service de vérification momentanément indisponible. Réessayez plus tard."
    provider = FakeProvider(exc=HTTPException(status_code=502, detail=detail))
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    data = r.json()
    assert r.status_code == 502
    assert data["detail"] == detail
    assert data["code"] == "provider_unavailable"
    assert data["game_id"] == ML


def test_ml_missing_validation_category_is_unsupported_game(make_client):
    detail = "La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur."
    provider = FakeProvider(exc=HTTPException(status_code=503, detail=detail))
    client = make_client(ML_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    data = r.json()
    assert r.status_code == 503
    assert data["detail"] == detail
    assert data["code"] == "unsupported_game"
    assert data["game_id"] == ML


def test_rate_limit_is_rate_limited(make_client):
    detail = "Trop de requêtes. Réessayez dans quelques minutes."
    provider = FakeProvider()
    client = make_client(ML_GAME, provider, rate_limit_exc=HTTPException(status_code=429, detail=detail))

    r = client.post("/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })

    data = r.json()
    assert r.status_code == 429
    assert data["detail"] == detail
    assert data["code"] == "rate_limited"
    assert data["game_id"] == ML
    assert provider.calls == []


def test_pubg_message_unchanged(make_client):
    provider = FakeProvider(IdentityValidation(valid=False))
    client = make_client(PUBG_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": PUBG,
        "fields": {"player_id": "52328390220"},
    })

    data = r.json()
    assert r.status_code == 200
    assert data["valid"] is False
    assert data["message"] == "ID PUBG Mobile invalide"
    assert data["code"] == "invalid_id"
    assert data["game_id"] == PUBG


def test_free_fire_still_uses_its_own_identity(make_client):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="FFPlayer"))
    client = make_client(FREE_FIRE_GAME, provider)

    r = client.post("/fazercards/validate-id", json={
        "game_id": FREE_FIRE,
        "fields": {"player_id": "123456789"},
    })

    data = r.json()
    assert r.status_code == 200
    assert data["valid"] is True
    assert data["game_id"] == FREE_FIRE
    assert provider.calls == [(FREE_FIRE, {"player_id": "123456789"})]


def test_missing_game_id_logs_warning_without_player_data(make_client, caplog):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="PUBGPlayer"))
    client = make_client(PUBG_GAME, provider)

    with caplog.at_level(logging.WARNING):
        r = client.post("/fazercards/validate-id", json={"fields": {"player_id": "5123456789"}})

    assert r.status_code == 200
    assert any("game_id" in record.message.lower() and "absent" in record.message.lower()
               for record in caplog.records)
    assert "5123456789" not in caplog.text


# --------------------------------------------------------------------------- #
# Service : erreurs réelles de transport / catégorie absente
# --------------------------------------------------------------------------- #

def _mock_async_client(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(**kwargs)

    monkeypatch.setattr(fzr.httpx, "AsyncClient", factory)


def test_service_timeout_has_provider_unavailable_code(monkeypatch):
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_test")
    _mock_async_client(monkeypatch, lambda req: (_ for _ in ()).throw(httpx.ConnectTimeout("boom")))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(fzr._request("POST", "/topups/validate-id"))

    assert exc.value.status_code == 504
    assert getattr(exc.value, "code", None) == "provider_unavailable"


def test_service_5xx_has_provider_unavailable_code(monkeypatch):
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_test")
    _mock_async_client(monkeypatch, lambda req: httpx.Response(500, json={"ok": False}))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(fzr._request("POST", "/topups/validate-id"))

    assert exc.value.status_code == 502
    assert getattr(exc.value, "code", None) == "provider_unavailable"


def test_service_invalid_json_has_provider_unavailable_code(monkeypatch):
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_test")
    _mock_async_client(monkeypatch, lambda req: httpx.Response(200, text="<html>not json</html>"))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(fzr._request("POST", "/topups/validate-id"))

    assert exc.value.status_code == 502
    assert getattr(exc.value, "code", None) == "provider_unavailable"


def test_service_missing_category_is_unsupported_game(monkeypatch):
    async def fake_find_one(query, projection=None):
        return {"id": ML, "fazercards_validation_category": None}

    monkeypatch.setattr(fzr.db, "games", SimpleNamespace(find_one=fake_find_one))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(fzr.validation_target(ML))

    assert exc.value.status_code == 503
    assert exc.value.detail == "La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur."
    assert getattr(exc.value, "code", None) == "unsupported_game"


def test_service_ml_sends_category_and_both_fields(monkeypatch):
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_test")

    async def fake_find_one(query, projection=None):
        return {"id": ML, "fazercards_validation_category": "mobile_legends"}

    monkeypatch.setattr(fzr.db, "games", SimpleNamespace(find_one=fake_find_one))

    sent = {}

    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json={"ok": True, "items": [{
                "category_id": "mobile_legends",
                "fields": [{"key": "player_id"}, {"key": "zone_id"}],
            }]})
        sent.update(json.loads(req.content))
        return httpx.Response(200, json={"ok": True, "valid": False})

    _mock_async_client(monkeypatch, handler)
    result = asyncio.run(fzr.validate_identity({"player_id": "12345678", "zone_id": "2214"}, ML))

    assert result["valid"] is False
    assert sent == {"category_id": "mobile_legends",
                    "fields": {"player_id": "12345678", "zone_id": "2214"}}


# --------------------------------------------------------------------------- #
# Contrat HTTP réel : application ASGI complète (server.app)
# Un test par code, JSON brut, `detail` toujours une chaîne quand présent.
# --------------------------------------------------------------------------- #

def _real_server_client(monkeypatch, game: dict, provider, rate_limit_exc: HTTPException | None = None):
    """Monte la vraie application ASGI, sans lifespan ni Mongo ni réseau."""
    async def fake_find_one(query, projection=None):
        return game if query.get("id") == game.get("id") else None

    def fake_check(*args, **kwargs):
        if rate_limit_exc:
            raise rate_limit_exc
        return None

    import server as server_module

    monkeypatch.setattr(fazercards.db, "games", SimpleNamespace(find_one=fake_find_one))
    monkeypatch.setattr(fazercards, "check", fake_check)
    monkeypatch.setattr(fazercards.providers, "get_provider", lambda game_id=None: provider)
    return TestClient(server_module.app)


def _post_real(client: TestClient):
    return client.post("/api/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678", "zone_id": "2214"},
    })


def test_asgi_invalid_id_raw_body(monkeypatch):
    provider = FakeProvider(IdentityValidation(valid=False))
    r = _post_real(_real_server_client(monkeypatch, ML_GAME, provider))

    body = json.loads(r.text)
    assert r.status_code == 200
    assert body == {
        "valid": False,
        "message": "Identifiant joueur invalide pour ce jeu.",
        "code": "invalid_id",
        "game_id": ML,
    }
    assert isinstance(body["message"], str)
    assert "detail" not in body
    assert "PUBG" not in body["message"]


def test_asgi_missing_field_raw_body(monkeypatch):
    provider = FakeProvider()
    client = _real_server_client(monkeypatch, ML_GAME, provider)
    r = client.post("/api/fazercards/validate-id", json={
        "game_id": ML,
        "fields": {"player_id": "12345678"},
    })

    body = json.loads(r.text)
    assert r.status_code == 200
    assert body == {
        "valid": False,
        "message": "Format d'identifiant invalide pour ce jeu.",
        "code": "missing_field",
        "game_id": ML,
    }
    assert isinstance(body["message"], str)
    assert "detail" not in body
    assert provider.calls == []


def test_asgi_unsupported_game_raw_body(monkeypatch):
    from services.providers.fazercards_adapter import FazerCardsProvider

    game = {k: v for k, v in ML_GAME.items() if k != "fazercards_validation_category"}
    r = _post_real(_real_server_client(monkeypatch, game, FazerCardsProvider()))

    body = json.loads(r.text)
    assert r.status_code == 503
    assert body == {
        "detail": "La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur.",
        "code": "unsupported_game",
        "game_id": ML,
    }
    assert type(body["detail"]) is str


def test_asgi_provider_unavailable_502_raw_body(monkeypatch):
    detail = "Service de vérification momentanément indisponible. Réessayez plus tard."
    provider = FakeProvider(exc=fzr.IdentityValidationHTTPException(
        status_code=502, detail=detail, code="provider_unavailable"))
    r = _post_real(_real_server_client(monkeypatch, ML_GAME, provider))

    body = json.loads(r.text)
    assert r.status_code == 502
    assert body == {"detail": detail, "code": "provider_unavailable", "game_id": ML}
    assert type(body["detail"]) is str


def test_asgi_provider_unavailable_504_raw_body(monkeypatch):
    detail = "La vérification a expiré. Réessayez."
    provider = FakeProvider(exc=fzr.IdentityValidationHTTPException(
        status_code=504, detail=detail, code="provider_unavailable"))
    r = _post_real(_real_server_client(monkeypatch, ML_GAME, provider))

    body = json.loads(r.text)
    assert r.status_code == 504
    assert body == {"detail": detail, "code": "provider_unavailable", "game_id": ML}
    assert type(body["detail"]) is str


def test_asgi_rate_limited_raw_body(monkeypatch):
    detail = "Trop de requêtes. Réessayez dans quelques minutes."
    client = _real_server_client(
        monkeypatch, ML_GAME, FakeProvider(),
        rate_limit_exc=HTTPException(status_code=429, detail=detail),
    )
    r = _post_real(client)

    body = json.loads(r.text)
    assert r.status_code == 429
    assert body == {"detail": detail, "code": "rate_limited", "game_id": ML}
    assert type(body["detail"]) is str


def test_asgi_success_raw_body(monkeypatch):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="MLPlayer", region="ID"))
    r = _post_real(_real_server_client(monkeypatch, ML_GAME, provider))

    body = json.loads(r.text)
    assert r.status_code == 200
    assert body == {
        "valid": True,
        "player_name": "MLPlayer",
        "region": "ID",
        "game_id": ML,
    }
    assert "code" not in body
    assert "detail" not in body


def test_real_app_has_no_custom_global_exception_handler():
    """Le code est produit par le JSONResponse local de la route, pas par un handler global."""
    from starlette.exceptions import HTTPException as StarletteHTTPException
    import server as server_module

    handler = server_module.app.exception_handlers.get(StarletteHTTPException)
    assert handler is not None
    assert handler.__module__ == "fastapi.exception_handlers"
    assert Exception not in server_module.app.exception_handlers
