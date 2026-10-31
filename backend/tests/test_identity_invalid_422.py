"""PL-003-BE-9 — un 422 de FazerCards sur `validate-id` est un identifiant REFUSÉ, pas une panne.

Contexte mesuré (vraie clé, backend local) : pour un ID Free Fire inexistant, FazerCards répond
`HTTP 422` sur `POST /topups/validate-id`. Avant ce correctif, `services.fazercards._request`
tombait dans `r.is_error` et renvoyait `502 provider_unavailable` (« réessayez plus tard ») alors
que le bon verdict est `200 {valid:false, code:"invalid_id"}`, comme pour PUBG Mobile.

Cette traduction est RESTREINTE à l'appel de validation : les 5xx (dont le 502 passager de
FazerCards), les timeouts, 401/403, 429 et les réponses illisibles gardent leur traitement.

Aucun réseau, aucun backend, aucun Mongo : le fournisseur est simulé par `httpx.MockTransport`
et la base par des `SimpleNamespace`. Les identifiants sont inventés (aucun compte réel).
"""
from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import fazercards as fzr_router
from services import fazercards, fzr_fulfillment
from services.providers.fazercards_adapter import FazerCardsProvider
from test_identity_route_branching import preflight_env  # noqa: F401  (fixture partagée)

# Classe réelle capturée AVANT tout remplacement : le transport simulé l'enveloppe.
REAL_ASYNC_CLIENT = httpx.AsyncClient

FREE_FIRE = "free-fire"
PUBG = "pubg-mobile"
PLAYER_ID = "100000001"                     # valeur de test, jamais un compte réel
FF_CATEGORY = "ff_validation"
PUBG_CATEGORY = "pubg_mobile"

FF_FIELDS = [{"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
              "min_length": 6, "max_length": 12, "required": True, "primary": True}]

DISCOVERY = {"ok": True, "kind": "topup", "items": [
    {"category_id": PUBG_CATEGORY, "fields": [{"key": "player_id"}]},
    {"category_id": FF_CATEGORY, "fields": [{"key": "player_id"}]},
]}

FF_GAME = {"id": FREE_FIRE, "identity_fields": FF_FIELDS,
           "fazercards_validation_category": FF_CATEGORY}
PUBG_GAME = {"id": PUBG}


# --------------------------------------------------------------------------- #
# Bancs de test
# --------------------------------------------------------------------------- #
@pytest.fixture(autouse=True)
def offline_env(monkeypatch):
    """Client FazerCards configuré, URL inatteignable (aucun appel réel possible), caches vides."""
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
    monkeypatch.setenv("FAZERCARDS_API_BASE", "http://127.0.0.1:9")
    fazercards._discovery_cache["data"] = None
    fazercards._discovery_cache["at"] = 0.0
    fazercards._game_discovery_cache.clear()
    yield
    fazercards._discovery_cache["data"] = None
    fazercards._discovery_cache["at"] = 0.0
    fazercards._game_discovery_cache.clear()


def mock_fazercards(monkeypatch, validate_handler, discovery_handler=None):
    """Transport simulé : la découverte `GET /topups/validate-id` réussit, la validation est pilotée."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.method == "GET" and request.url.path == "/topups/validate-id":
            if discovery_handler is not None:
                return discovery_handler(request)
            return httpx.Response(200, json=DISCOVERY)
        return validate_handler(request)

    def factory(**kwargs):
        return REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler),
                                 timeout=kwargs.get("timeout"))

    monkeypatch.setattr(fazercards.httpx, "AsyncClient", factory)
    return calls


def fake_db(monkeypatch, game: dict):
    """Base simulée : seul `games.find_one` est nécessaire (catégorie de validation, champs)."""

    async def find_one(query, projection=None):
        if query.get("id") != game.get("id"):
            return None
        return {k: v for k, v in game.items()
                if (projection or {}).get(k, 1) != 0 and k != "_id"}

    games = SimpleNamespace(find_one=find_one)
    monkeypatch.setattr(fazercards, "db", SimpleNamespace(games=games))
    monkeypatch.setattr(fzr_router, "db", SimpleNamespace(games=games))


@pytest.fixture
def rate_limit(monkeypatch):
    monkeypatch.setattr(fzr_router, "check", lambda *_a, **_k: None)


def client_with_real_fazercards(monkeypatch) -> TestClient:
    """Routeur réel + VRAI client FazerCards (transport simulé) : chaîne complète 422 -> réponse."""
    monkeypatch.setattr(fzr_router.providers, "get_provider",
                        lambda game_id=None: FazerCardsProvider())
    app = FastAPI()
    app.include_router(fzr_router.router)
    return TestClient(app)


# --------------------------------------------------------------------------- #
# 1. Le client FazerCards traduit le 422 en refus d'identité
# --------------------------------------------------------------------------- #
def test_422_sur_validate_id_donne_valid_false(monkeypatch):
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": False,
                                                                     "error": "not found"}))
    fake_db(monkeypatch, FF_GAME)

    result = asyncio.run(fazercards.validate_identity({"player_id": PLAYER_ID}, FREE_FIRE))

    assert result == {"valid": False}


def test_422_ne_peut_jamais_produire_valid_true(monkeypatch):
    """Même si le corps du 422 prétend `valid:true`, le verdict reste « invalide »."""
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": True, "valid": True}))
    fake_db(monkeypatch, FF_GAME)

    assert asyncio.run(fazercards.validate_identity({"player_id": PLAYER_ID},
                                                    FREE_FIRE)) == {"valid": False}


def test_le_422_ne_vaut_que_pour_la_validation(monkeypatch):
    """La découverte d'identité (GET) garde le mapping historique 4xx -> 502."""
    refus = lambda _r: httpx.Response(422, json={"ok": False})          # noqa: E731
    mock_fazercards(monkeypatch, refus, discovery_handler=refus)
    fazercards._discovery_cache["data"] = None

    with pytest.raises(HTTPException) as exc:
        asyncio.run(fazercards.pubg_validation_target())

    assert exc.value.status_code == 502
    assert exc.value.code == "provider_unavailable"


# --------------------------------------------------------------------------- #
# 2. La route rend exactement la réponse d'un ID invalide (200, code invalid_id)
# --------------------------------------------------------------------------- #
def test_free_fire_422_donne_200_invalid_id(monkeypatch, rate_limit):
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": False}))
    fake_db(monkeypatch, FF_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": FREE_FIRE, "fields": {"player_id": PLAYER_ID}})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "Identifiant joueur invalide pour ce jeu.",
                        "code": "invalid_id", "game_id": FREE_FIRE}


def test_pubg_422_donne_200_invalid_id_avec_le_message_pubg(monkeypatch, rate_limit):
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": False}))
    fake_db(monkeypatch, PUBG_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": PUBG, "fields": {"player_id": PLAYER_ID}})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "ID PUBG Mobile invalide",
                        "code": "invalid_id", "game_id": PUBG}


def test_route_historique_pubg_422_donne_valid_false(monkeypatch, rate_limit):
    """La route historique garde son contrat historique : `valid:false` + message, sans `code`."""
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": False}))
    fake_db(monkeypatch, PUBG_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/pubg/validate-id", json={"player_id": PLAYER_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "ID PUBG Mobile invalide"}


# --------------------------------------------------------------------------- #
# 3. Tout le reste est INCHANGÉ
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("status, expected_status, expected_code", [
    (401, 502, "provider_unavailable"),
    (403, 502, "provider_unavailable"),
    (429, 429, "rate_limited"),
    (500, 502, "provider_unavailable"),
    (502, 502, "provider_unavailable"),
    (503, 502, "provider_unavailable"),
])
def test_les_autres_statuts_du_fournisseur_sont_inchanges(monkeypatch, rate_limit, status,
                                                          expected_status, expected_code):
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(status, json={"ok": False}))
    fake_db(monkeypatch, FF_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": FREE_FIRE, "fields": {"player_id": PLAYER_ID}})

    assert r.status_code == expected_status
    body = r.json()
    assert body["code"] == expected_code
    assert body["game_id"] == FREE_FIRE
    assert "valid" not in body


def test_timeout_reste_une_indisponibilite(monkeypatch, rate_limit):
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timeout simulé", request=request)

    mock_fazercards(monkeypatch, timeout)
    fake_db(monkeypatch, FF_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": FREE_FIRE, "fields": {"player_id": PLAYER_ID}})

    assert r.status_code == 504
    assert r.json()["code"] == "provider_unavailable"


def test_reponse_illisible_reste_une_indisponibilite(monkeypatch, rate_limit):
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(200, content=b"<html>panne</html>"))
    fake_db(monkeypatch, FF_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": FREE_FIRE, "fields": {"player_id": PLAYER_ID}})

    assert r.status_code == 502
    assert r.json()["code"] == "provider_unavailable"


def test_200_sans_ok_ne_donne_jamais_valid_true(monkeypatch, rate_limit):
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(200, json={"ok": False, "valid": True}))
    fake_db(monkeypatch, FF_GAME)

    r = client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": FREE_FIRE, "fields": {"player_id": PLAYER_ID}})

    assert r.status_code == 502
    assert "valid" not in r.json()


# --------------------------------------------------------------------------- #
# 4. Journalisation : la trace existe, l'identifiant joueur n'y est jamais
# --------------------------------------------------------------------------- #
def test_aucun_identifiant_dans_les_journaux(monkeypatch, rate_limit, caplog):
    caplog.set_level(logging.DEBUG)
    mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": False}))
    fake_db(monkeypatch, FF_GAME)

    client_with_real_fazercards(monkeypatch).post(
        "/fazercards/validate-id", json={"game_id": FREE_FIRE, "fields": {"player_id": PLAYER_ID}})

    assert "422" in caplog.text                       # la traduction est tracée
    assert PLAYER_ID not in caplog.text               # jamais la donnée joueur
    assert "X-API-Key" not in caplog.text


# --------------------------------------------------------------------------- #
# 5. Préflight : un 422 bloque la commande, sans envoi ni trace de vérification
# --------------------------------------------------------------------------- #
def test_preflight_422_bloque_sans_envoi_ni_trace(monkeypatch, preflight_env):
    """Reprend le banc de `test_identity_route_branching` mais avec le VRAI client FazerCards."""
    state = preflight_env                       # fixture importée du module de contrat HTTP
    state["game"] = FF_GAME
    monkeypatch.setattr(fzr_fulfillment.providers, "get_provider",
                        lambda game_id=None: FazerCardsProvider())
    fake_db(monkeypatch, FF_GAME)
    calls = mock_fazercards(monkeypatch, lambda _r: httpx.Response(422, json={"ok": False}))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 409
    assert exc.value.detail == ("Identité joueur invalide chez le fournisseur — "
                                "commande non envoyée.")
    assert state["sent"] == []                  # aucune unité envoyée au fournisseur
    assert state["writes"] == []                # aucune trace de vérification écrite
    # Un seul appel fournisseur : la validation. Jamais `POST /topups/order`.
    assert [r.url.path for r in calls if r.method == "POST"] == ["/topups/validate-id"]
