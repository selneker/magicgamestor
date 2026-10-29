"""Lot 1 — client HTTP ALUU.in.

Tests PURS : aucun réseau réel (`httpx.MockTransport`), aucune base de données, aucun secret
de production. Les valeurs ci-dessous sont des valeurs de test inventées pour l'occasion.
"""
import asyncio
import hashlib
import hmac
import json
import logging

import httpx
import pytest

from services import aluu
from services.providers import errors as perr

RealAsyncClient = httpx.AsyncClient
API_KEY = "aluu_dummy_key_for_tests"
SECRET = "aluu_dummy_secret_for_tests"
PLAYER_ID = "51234567890"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def aluu_env(monkeypatch):
    """Environnement isolé : aucune valeur du `.env` local ne doit influencer ces tests."""
    monkeypatch.setenv("ALUU_API_KEY", API_KEY)
    monkeypatch.setenv("ALUU_API_BASE", "https://aluu.in")
    monkeypatch.delenv("ALUU_SECRET_KEY", raising=False)
    monkeypatch.delenv("ALUU_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("ALUU_TIMEOUT_S", raising=False)
    yield


def mock_transport(monkeypatch, handler):
    """Remplace `httpx.AsyncClient` par un client dont le transport est un MockTransport."""
    def factory(**_kwargs):
        return RealAsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(aluu.httpx, "AsyncClient", factory)


def _json_response(status, payload):
    return httpx.Response(status, json=payload)


# --------------------------------------------------------------------------- authentification

def test_api_key_header_is_sent_without_signature(monkeypatch):
    seen = {}

    def handler(req):
        seen["headers"] = dict(req.headers)
        return _json_response(200, {"success": True, "data": [
            {"Name": "PUBG Mobile", "gamecode": "pubgm", "image": "/productImages/pubgm.jpg"},
        ]})

    mock_transport(monkeypatch, handler)
    result = run(aluu.games())

    assert result == [{
        "game_code": "pubgm", "name": "PUBG Mobile", "image": "/productImages/pubgm.jpg",
        "raw": {"Name": "PUBG Mobile", "gamecode": "pubgm", "image": "/productImages/pubgm.jpg"},
    }]
    assert seen["headers"]["x-api-key"] == API_KEY
    # IP whitelistée : pas de signature de requête.
    assert "x-timestamp" not in seen["headers"]
    assert "x-signature" not in seen["headers"]


def test_missing_api_key_fails_closed_without_network(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return _json_response(200, {"success": True, "data": []})

    mock_transport(monkeypatch, handler)
    monkeypatch.delenv("ALUU_API_KEY")
    with pytest.raises(aluu.AluuNotConfiguredError) as exc:
        run(aluu.games())
    assert exc.value.status_code == 503 and exc.value.code == "provider_unavailable"
    assert calls == []


# --------------------------------------------------------------------------- signature de requête

def test_request_signature_follows_documented_recipe(monkeypatch):
    """ts.METHOD.path_with_query.raw_body, HMAC-SHA256 hex (doc « Signing a request »)."""
    monkeypatch.setenv("ALUU_SECRET_KEY", SECRET)
    monkeypatch.setattr(aluu.time, "time", lambda: 1768472100)
    seen = {}

    def handler(req):
        seen["method"] = req.method
        seen["url"] = str(req.url)
        seen["headers"] = dict(req.headers)
        seen["body"] = req.content
        return _json_response(200, {"success": True, "message": "Order accepted",
                                    "data": {"orderid": "MGS-1", "status": "pending"}})

    mock_transport(monkeypatch, handler)
    run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                          partner_orderid="MGS-1"))

    raw = seen["body"].decode()
    to_sign = f"1768472100.POST./api/v.1/create.{raw}"
    expected = hmac.new(SECRET.encode(), to_sign.encode(), hashlib.sha256).hexdigest()
    assert seen["method"] == "POST"
    assert seen["url"] == "https://aluu.in/api/v.1/create"
    assert seen["headers"]["x-timestamp"] == "1768472100"
    assert seen["headers"]["x-signature"] == expected
    # Les octets signés sont exactement les octets envoyés.
    assert json.loads(raw) == {"game": "pubgm", "denom": "60", "userid": PLAYER_ID,
                               "partner_orderid": "MGS-1"}


def test_request_signature_get_without_body_ends_with_a_dot(monkeypatch):
    monkeypatch.setenv("ALUU_SECRET_KEY", SECRET)
    monkeypatch.setattr(aluu.time, "time", lambda: 1768472100)
    seen = {}

    def handler(req):
        seen["headers"] = dict(req.headers)
        return _json_response(200, {"success": True, "data": []})

    mock_transport(monkeypatch, handler)
    run(aluu.games())

    expected = hmac.new(SECRET.encode(), b"1768472100.GET./api/v.1/games.",
                        hashlib.sha256).hexdigest()
    assert seen["headers"]["x-signature"] == expected


# --------------------------------------------------------------------------- transport / retry

def test_get_is_retried_once_on_server_error(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        if len(calls) == 1:
            return _json_response(500, {"success": False})
        return _json_response(200, {"success": True, "data": [{"Name": "PUBG Mobile",
                                                               "gamecode": "pubgm"}]})

    mock_transport(monkeypatch, handler)
    assert run(aluu.games())[0]["game_code"] == "pubgm"
    assert len(calls) == 2


def test_get_timeout_after_retries_is_a_504(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        raise httpx.ConnectTimeout("boom", request=req)

    mock_transport(monkeypatch, handler)
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(aluu.games())
    assert exc.value.status_code == 504 and exc.value.code == "provider_timeout"
    assert len(calls) == 2


def test_create_is_never_retried_on_server_error(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return _json_response(500, {"success": False})

    mock_transport(monkeypatch, handler)
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    assert exc.value.status_code == 502
    assert len(calls) == 1  # une création n'est JAMAIS rejouée


def test_create_timeout_is_reported_once_without_retry(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        raise httpx.ReadTimeout("boom", request=req)

    mock_transport(monkeypatch, handler)
    with pytest.raises(perr.ProviderTimeout):
        run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    assert len(calls) == 1


# --------------------------------------------------------------------------- matrice d'erreurs

def test_401_maps_to_provider_unavailable_502(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(401, {"success": False}))
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(aluu.games())
    assert exc.value.status_code == 502 and exc.value.code == "provider_unavailable"


def test_403_ip_not_allowed_maps_to_502_and_logs_the_code(monkeypatch, caplog):
    mock_transport(monkeypatch, lambda req: _json_response(
        403, {"success": False, "message": "IP not whitelisted", "code": "IP_NOT_ALLOWED"}))
    with caplog.at_level(logging.WARNING):
        with pytest.raises(perr.ProviderUnavailableError) as exc:
            run(aluu.games())
    assert exc.value.status_code == 502
    assert "IP_NOT_ALLOWED" in caplog.text
    assert "IP not whitelisted" not in caplog.text  # message ALUU jamais recopié


def test_403_daily_quota_maps_to_503(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(
        403, {"success": False, "code": "DAILY_LIMIT_REACHED", "remaining": 0}))
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(aluu.name_check("game-check", {"code": "pubgm", "characterId": PLAYER_ID}))
    assert exc.value.status_code == 503 and exc.value.code == "provider_unavailable"


def test_429_maps_to_rate_limited_without_retry(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return _json_response(429, {"success": False, "message": "Too many requests"})

    mock_transport(monkeypatch, handler)
    with pytest.raises(aluu.AluuRateLimitedError) as exc:
        run(aluu.games())
    assert exc.value.status_code == 429 and exc.value.code == "rate_limited"
    assert len(calls) == 1


@pytest.mark.parametrize("status,expected", [(502, 502), (500, 502), (504, 504)])
def test_5xx_maps_to_provider_unavailable(monkeypatch, status, expected):
    mock_transport(monkeypatch, lambda req: _json_response(status, {"success": False}))
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(aluu.get_order("MGS-1"))
    assert exc.value.status_code == expected


def test_create_200_success_false_is_a_rejection(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(
        200, {"success": False, "message": "Order failed",
              "data": {"orderid": "MGS-1", "status": "error"}}))
    with pytest.raises(aluu.AluuOrderFailedError) as exc:
        run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    assert exc.value.status_code == 409 and exc.value.code == "order_rejected"


def test_create_402_is_insufficient_balance(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(402, {"success": False}))
    with pytest.raises(perr.ProviderInsufficientBalanceError) as exc:
        run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    assert exc.value.status_code == 402


def test_create_400_is_invalid_order(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(
        400, {"success": False, "message": "invalid pack", "code": "INVALID_PACK"}))
    with pytest.raises(aluu.AluuInvalidOrderError) as exc:
        run(aluu.create_order(game_code="pubgm", denom="999", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    assert exc.value.status_code == 409 and exc.value.code == "INVALID_PACK"


def test_create_503_is_pack_unavailable(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(503, {"success": False}))
    with pytest.raises(aluu.AluuPackUnavailableError) as exc:
        run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    assert exc.value.code == "pack_unavailable"


def test_create_409_is_a_duplicate_and_not_a_success(monkeypatch):
    existing = {"orderid": "MGS-1", "status": "pending", "game": "pubgm",
                "denom": "60", "userid": PLAYER_ID}
    mock_transport(monkeypatch, lambda req: _json_response(
        409, {"success": False, "message": "Duplicate order", "data": existing}))

    with pytest.raises(aluu.AluuDuplicateOrderError) as exc:
        run(aluu.create_order(game_code="pubgm", denom="60", user_id=PLAYER_ID,
                              partner_orderid="MGS-1"))
    # La commande existante est FOURNIE mais l'appel n'est pas un succès :
    # l'adaptateur (Lot 2) devra vérifier jeu / pack / joueur.
    assert exc.value.existing_order == existing
    assert exc.value.status_code == 409 and exc.value.code == "duplicate_order"


def test_get_404_is_order_not_found(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(404, {"success": False}))
    with pytest.raises(aluu.AluuOrderNotFoundError) as exc:
        run(aluu.get_order("MGS-1"))
    assert exc.value.status_code == 404


def test_get_410_stops_polling(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(410, {"success": False}))
    with pytest.raises(aluu.AluuPollingStoppedError) as exc:
        run(aluu.get_order("MGS-1"))
    assert exc.value.status_code == 410 and exc.value.code == "polling_stopped"


# --------------------------------------------------------------------------- Name Check

@pytest.mark.parametrize("endpoint,status,payload,expected", [
    # game-check répond 200 même pour un joueur inconnu.
    ("game-check", 200, {"valid": "valid", "name": "PlayerName", "region": "Asia"},
     {"valid": True, "player_name": "PlayerName", "code": None}),
    ("game-check", 200, {"valid": "invalid", "name": "na", "region": "na"},
     {"valid": False, "player_name": None, "code": "invalid_id"}),
    # Certains jeux game-check répondent success:true + username sans champ `valid`.
    ("game-check", 200, {"success": True, "username": "PlayerName", "uid": "1"},
     {"valid": True, "player_name": "PlayerName", "code": None}),
    # mlbb-check : 400 = joueur inconnu.
    ("mlbb-check", 400, {"success": False, "message": "Player not found"},
     {"valid": False, "player_name": None, "code": "invalid_id"}),
    # bgmi : 404 = joueur inconnu.
    ("bgmi", 404, {"success": False, "message": "Player not found"},
     {"valid": False, "player_name": None, "code": "invalid_id"}),
    # game-check : 400 ambigu → échec neutre, JAMAIS « ID invalide ».
    ("game-check", 400, {"success": False, "message": "Bad request"},
     {"valid": False, "player_name": None, "code": "verification_failed"}),
    # game-check : 404 non documenté (la doc ne le définit que pour BGMI) → échec neutre.
    ("game-check", 404, {"success": False, "message": "Not found"},
     {"valid": False, "player_name": None, "code": "verification_failed"}),
    # mlbb-check : 404 non documenté (la doc n'y décrit que le 400) → échec neutre.
    ("mlbb-check", 404, {"success": False, "message": "Not found"},
     {"valid": False, "player_name": None, "code": "verification_failed"}),
])
def test_name_check_normalization(monkeypatch, endpoint, status, payload, expected):
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        return _json_response(status, payload)

    mock_transport(monkeypatch, handler)
    result = run(aluu.name_check(endpoint, {"code": "pubgm", "characterId": PLAYER_ID}))
    assert result == expected
    assert f"/api/check/{endpoint}" in seen["url"]


def test_name_check_rejects_unknown_endpoint():
    with pytest.raises(ValueError):
        run(aluu.name_check("anything", {"id": "1"}))


def test_name_check_logs_never_contain_player_id_or_api_key(monkeypatch, caplog):
    """Sortie RÉELLE des logs (httpx compris) : ni ID joueur complet, ni clé API."""
    def handler(req):
        return _json_response(200, {"valid": "valid", "name": "PlayerName"})

    mock_transport(monkeypatch, handler)
    caplog.set_level(logging.DEBUG)

    result = run(aluu.name_check("game-check", {"code": "pubgm", "characterId": PLAYER_ID}))
    assert result["valid"] is True

    assert PLAYER_ID not in caplog.text          # aucun ID joueur complet
    assert API_KEY not in caplog.text            # aucune clé API
    assert "51***90" in caplog.text              # le masque applicatif est bien appliqué
    assert "/api/check/game-check" in caplog.text  # la requête reste traçable, sans query


# --------------------------------------------------------------------------- statut groupé

def test_batch_status_refuses_more_than_fifty_ids_without_http_call(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return _json_response(200, {"success": True, "results": {}})

    mock_transport(monkeypatch, handler)
    with pytest.raises(ValueError):
        run(aluu.batch_status([f"MGS-{i}" for i in range(51)]))
    assert calls == []


def test_batch_status_posts_ids_and_normalizes_results(monkeypatch):
    seen = {}

    def handler(req):
        seen["body"] = json.loads(req.content)
        seen["url"] = str(req.url)
        return _json_response(200, {"success": True, "cached_not_found": 1, "results": {
            "MGS-1": {"orderid": "MGS-1", "status": "successful"},
            "MGS-2": None,
        }})

    mock_transport(monkeypatch, handler)
    result = run(aluu.batch_status(["MGS-1", "MGS-2"]))
    assert seen["url"] == "https://aluu.in/api/v.1/status/batch"
    assert seen["body"] == {"ids": ["MGS-1", "MGS-2"]}
    assert result["cached_not_found"] == 1
    assert result["results"]["MGS-1"]["status"] == "successful"
    assert result["results"]["MGS-2"] is None


def test_batch_status_empty_list_does_not_call_the_api(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return _json_response(200, {"success": True, "results": {}})

    mock_transport(monkeypatch, handler)
    assert run(aluu.batch_status([])) == {"results": {}, "cached_not_found": 0}
    assert calls == []


# --------------------------------------------------------------------------- autres appels

def test_products_normalizes_pack_field(monkeypatch):
    mock_transport(monkeypatch, lambda req: _json_response(200, {
        "success": True, "gameCode": "pubgm", "count": 1,
        "data": [{"name": "60 UC", "gamecode": "pubgm", "Pack": "60",
                  "requiresUserId": True, "requiresServerId": False,
                  "requiresCharName": False, "price": 0.83, "stockStatus": "in_stock"}],
    }))
    packs = run(aluu.products("pubgm"))
    assert packs == [{
        "game_code": "pubgm", "denom": "60", "name": "60 UC", "price_usd": 0.83,
        "requires_user_id": True, "requires_server_id": False, "requires_char_name": False,
        "stock_status": "in_stock",
        "raw": {"name": "60 UC", "gamecode": "pubgm", "Pack": "60", "requiresUserId": True,
                "requiresServerId": False, "requiresCharName": False, "price": 0.83,
                "stockStatus": "in_stock"},
    }]


def test_server_options_is_a_post_with_gamecode(monkeypatch):
    seen = {}

    def handler(req):
        seen["method"] = req.method
        seen["body"] = json.loads(req.content)
        return _json_response(200, {"success": True, "requiresServerId": True,
                                    "serverMode": "select",
                                    "server_list": [{"value": "os_asia", "label": "os_asia"}],
                                    "servers": {"os_asia": "os_asia"}})

    mock_transport(monkeypatch, handler)
    result = run(aluu.server_options("mlbb"))
    assert seen == {"method": "POST", "body": {"gamecode": "mlbb"}}
    assert result["server_mode"] == "select"
    assert result["server_list"] == [{"value": "os_asia", "label": "os_asia"}]


def test_track_order_is_a_post_without_body(monkeypatch):
    seen = {}

    def handler(req):
        seen["method"] = req.method
        seen["url"] = str(req.url)
        seen["body"] = req.content
        return _json_response(200, {"success": True,
                                    "data": {"orderid": "MGS-1", "status": "successful"}})

    mock_transport(monkeypatch, handler)
    order = run(aluu.track_order("MGS-1"))
    assert seen["method"] == "POST"
    assert seen["url"] == "https://aluu.in/api/v.1/MGS-1/track"
    assert seen["body"] == b""
    assert order["status"] == "successful"


# --------------------------------------------------------------------------- webhook

def test_webhook_signature_is_hex_hmac_of_timestamp_dot_body(monkeypatch):
    monkeypatch.setenv("ALUU_WEBHOOK_SECRET", SECRET)
    raw = b'{"success":true,"data":{"orderid":"MGS-1","status":"successful"}}'
    expected = hmac.new(SECRET.encode(), b"1768472100." + raw, hashlib.sha256).hexdigest()
    signature = aluu.webhook_signature("1768472100", raw)
    assert signature == expected
    assert len(signature) == 64
    assert aluu.webhook_signature("1768472100", raw, SECRET) == expected


def test_webhook_signature_requires_a_secret(monkeypatch):
    with pytest.raises(aluu.AluuNotConfiguredError):
        aluu.webhook_signature("1768472100", b"{}")
