"""Lot 2 — adapter `Provider` du fournisseur ALUU.

Tests PURS : aucun réseau réel (`httpx.MockTransport`), aucune base de données, aucun secret de
production. La configuration de jeu est injectée (documents `games` factices).
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
from services.providers.aluu_adapter import _CHECK_PARAMS, AluuProvider
from services.providers.base import IdentityValidation, OrderStatus, Provider, ProviderOrder

RealAsyncClient = httpx.AsyncClient
API_KEY = "aluu_dummy_key_for_tests"
WEBHOOK_SECRET = "aluu_dummy_webhook_secret_for_tests"
PLAYER_ID = "51234567890"
ZONE_ID = "1234"
PARTNER_ID = "MGS-ABC-1"

PUBG_GAME = {
    "id": "pubg-mobile", "provider": "aluu", "aluu_game_code": "pubgm",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
}
MLBB_GAME = {
    "id": "mobile-legends", "provider": "aluu", "aluu_game_code": "mlbb",
    "aluu_check_endpoint": "mlbb-check",
    "aluu_identity_map": {"player_id": "user_id", "zone_id": "server_id"},
}
BGMI_GAME = {
    "id": "battlegrounds-mobile-india", "provider": "aluu", "aluu_game_code": "bgmi",
    "aluu_check_endpoint": "bgmi",
    "aluu_identity_map": {"player_id": "id"},
}
FAZER_GAME = {"id": "free-fire", "provider": "fazercards"}

GAMES = [PUBG_GAME, MLBB_GAME, BGMI_GAME, FAZER_GAME]


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


def fake_api(monkeypatch, status, payload, seen=None):
    """Transport factice qui enregistre la dernière requête vue."""
    seen = {} if seen is None else seen

    def handler(req):
        seen["method"] = req.method
        seen["url"] = str(req.url)
        seen["body"] = req.content
        return httpx.Response(status, json=payload)
    mock_transport(monkeypatch, handler)
    return seen


def provider(games=GAMES, **kwargs) -> AluuProvider:
    return AluuProvider(games, **kwargs)


# --------------------------------------------------------------------------- contrat

def test_adapter_implements_provider_interface():
    prov = provider()
    assert isinstance(prov, Provider)
    assert prov.name == "aluu"


@pytest.mark.parametrize("raw,expected", [
    ("pending", OrderStatus.PROCESSING),
    ("successful", OrderStatus.COMPLETED),
    ("error", OrderStatus.FAILED),
    ("cancelled", OrderStatus.FAILED),
    ("failed", OrderStatus.FAILED),   # à confirmer : seul l'exemple receveur webhook le cite
    ("SUCCESSFUL", OrderStatus.COMPLETED),
    ("something_new", OrderStatus.PROCESSING),
    (None, OrderStatus.PROCESSING),
])
def test_normalize_status(raw, expected):
    assert provider().normalize_status(raw) == expected


def test_normalize_status_failed_is_a_terminal_failure_not_processing():
    """Dédié : `failed` ne doit jamais retomber sur le défaut prudent `processing`."""
    assert provider().normalize_status("failed") == OrderStatus.FAILED


# --------------------------------------------------------------------------- identité

def test_validate_identity_valid_player(monkeypatch):
    seen = fake_api(monkeypatch, 200, {"valid": "valid", "name": "PlayerName", "region": "Asia"},
                    seen={})
    result = run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert result == IdentityValidation(valid=True, player_name="PlayerName", region=None,
                                        raw={"valid": True, "player_name": "PlayerName",
                                             "code": None})
    assert seen["url"].startswith("https://aluu.in/api/check/game-check?")
    assert "code=pubgm" in seen["url"]
    assert f"characterId={PLAYER_ID}" in seen["url"]


def test_validate_identity_uses_each_field_of_the_declared_map(monkeypatch):
    seen = fake_api(monkeypatch, 200, {"success": True, "username": "MLPlayer"})
    result = run(provider().validate_identity(
        "mobile-legends", {"player_id": PLAYER_ID, "zone_id": ZONE_ID}))

    assert result.valid is True and result.player_name == "MLPlayer"
    assert "/api/check/mlbb-check?" in seen["url"]
    assert f"user_id={PLAYER_ID}" in seen["url"]
    assert f"server_id={ZONE_ID}" in seen["url"]


def test_validate_identity_bgmi_uses_game_code_and_id(monkeypatch):
    seen = fake_api(monkeypatch, 200, {"success": True, "username": "BGPlayer"})
    result = run(provider().validate_identity(
        "battlegrounds-mobile-india", {"player_id": PLAYER_ID}))

    assert result.valid is True
    assert "/api/check/bgmi?" in seen["url"]
    assert "gameCode=bgmi" in seen["url"]
    assert f"id={PLAYER_ID}" in seen["url"]


def test_validate_identity_invalid_player_is_not_an_error(monkeypatch):
    fake_api(monkeypatch, 200, {"valid": "invalid", "name": "na"})
    result = run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert result.valid is False
    assert result.player_name is None
    assert result.raw["code"] == "invalid_id"


def test_validate_identity_mlbb_400_is_invalid_player(monkeypatch):
    fake_api(monkeypatch, 400, {"success": False, "message": "Player not found"})
    result = run(provider().validate_identity(
        "mobile-legends", {"player_id": PLAYER_ID, "zone_id": ZONE_ID}))

    assert result.valid is False


def test_validate_identity_bgmi_404_is_invalid_player(monkeypatch):
    fake_api(monkeypatch, 404, {"success": False, "message": "Player not found"})
    result = run(provider().validate_identity(
        "battlegrounds-mobile-india", {"player_id": PLAYER_ID}))

    assert result.valid is False


def test_validate_identity_game_check_404_never_means_invalid_player(monkeypatch):
    """404 non documenté pour `game-check` : indisponibilité neutre, pas « ID invalide »."""
    fake_api(monkeypatch, 404, {"success": False, "message": "Not found"})

    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 502
    assert exc.value.code == "provider_unavailable"
    assert "verification_failed" not in str(exc.value)
    assert "verification_failed" not in (exc.value.code or "")


def test_validate_identity_game_check_400_never_leaks_verification_failed(monkeypatch):
    """400 ambigu de `game-check` : échec neutre côté adapter, jamais « ID invalide »."""
    fake_api(monkeypatch, 400, {"success": False, "message": "Bad request"})

    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 502
    assert exc.value.code == "provider_unavailable"
    assert "verification_failed" not in str(exc.value)
    assert "verification_failed" not in (exc.value.code or "")


def test_validate_identity_rate_limited(monkeypatch):
    fake_api(monkeypatch, 429, {"success": False, "message": "Too many requests"})
    with pytest.raises(perr.ProviderError) as exc:
        run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 429
    assert exc.value.code == "rate_limited"


def test_validate_identity_daily_quota_is_unavailable_503(monkeypatch):
    fake_api(monkeypatch, 403, {"success": False, "code": "DAILY_LIMIT_REACHED"})
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 503
    assert exc.value.code == "provider_unavailable"


def test_validate_identity_ip_not_allowed_is_unavailable_502(monkeypatch):
    fake_api(monkeypatch, 403, {"success": False, "code": "IP_NOT_ALLOWED"})
    with pytest.raises(perr.ProviderUnavailableError) as exc:
        run(provider().validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 502


@pytest.mark.parametrize("game", [
    {"id": "pubg-mobile"},                                    # aucune config ALUU
    {"id": "pubg-mobile", "provider": "aluu"},                # code jeu absent
    {"id": "pubg-mobile", "provider": "aluu", "aluu_game_code": "pubgm"},  # endpoint absent
    {"id": "pubg-mobile", "provider": "aluu", "aluu_game_code": "pubgm",
     "aluu_check_endpoint": "game-check"},                    # map absente
    {"id": "pubg-mobile", "provider": "aluu", "aluu_game_code": "pubgm",
     "aluu_check_endpoint": "game-check", "aluu_identity_map": {"player_id": ""}},
    {"id": "pubg-mobile", "provider": "aluu", "aluu_game_code": "pubgm",
     "aluu_check_endpoint": "unknown-endpoint", "aluu_identity_map": {"player_id": "characterId"}},
    FAZER_GAME,                                               # autre fournisseur
])
def test_validate_identity_fails_closed_on_incomplete_config(monkeypatch, game):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))

    with pytest.raises(perr.ProviderValidationError) as exc:
        run(provider([game]).validate_identity(game["id"], {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"
    assert calls == []


def test_validate_identity_missing_field_never_substitutes_another_field(monkeypatch):
    """`zone_id` absent : refus explicite, jamais de repli sur `player_id`."""
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))

    with pytest.raises(perr.ProviderValidationError) as exc:
        run(provider().validate_identity("mobile-legends", {"player_id": PLAYER_ID}))

    assert exc.value.status_code == 400
    assert exc.value.code == "missing_field"
    assert calls == []


def test_validate_identity_without_game_id_is_unsupported(monkeypatch):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))
    with pytest.raises(perr.ProviderValidationError) as exc:
        run(provider().validate_identity(None, {"player_id": PLAYER_ID}))
    assert exc.value.code == "unsupported_game"
    assert calls == []


def test_validate_identity_accepts_async_config_loader(monkeypatch):
    async def loader():
        return [PUBG_GAME]

    fake_api(monkeypatch, 200, {"valid": "valid", "name": "PlayerName"})
    result = run(provider(loader).validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))
    assert result.valid is True


def test_check_params_allowlist_matches_the_documented_parameters():
    """Verrou documentaire : la liste blanche est EXACTEMENT celle de la doc ALUU.

    Doc « Which endpoint for which game » : `game-check` n'accepte que `code`,
    `characterId`, `server_code` et `charname` (« Mobile Legends — GET
    /api/check/mlbb-check » : `user_id`, `server_id` ; « BGMI — GET /api/check/bgmi » :
    `gameCode`, `id`).
    """
    assert _CHECK_PARAMS == {
        "game-check": frozenset({"code", "characterId", "server_code", "charname"}),
        "mlbb-check": frozenset({"user_id", "server_id"}),
        "bgmi": frozenset({"gameCode", "id"}),
    }


def test_validate_identity_refuses_a_param_outside_the_endpoint_allowlist(monkeypatch):
    """`denom` (paramètre de `/create`) n'existe pas en Name Check : refus AVANT tout appel."""
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))
    game = {**PUBG_GAME,
            "aluu_identity_map": {"player_id": "characterId", "zone_id": "denom"}}

    with pytest.raises(perr.ProviderValidationError) as exc:
        run(provider([game]).validate_identity(
            game["id"], {"player_id": PLAYER_ID, "zone_id": ZONE_ID}))

    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"
    assert calls == []


def test_validate_identity_refuses_mlbb_params_on_game_check(monkeypatch):
    """Une table recopiée depuis un autre jeu ne part jamais telle quelle chez le fournisseur."""
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))
    game = {**PUBG_GAME, "aluu_identity_map": {"player_id": "user_id"}}

    with pytest.raises(perr.ProviderValidationError) as exc:
        run(provider([game]).validate_identity(game["id"], {"player_id": PLAYER_ID}))

    assert exc.value.code == "unsupported_game"
    assert calls == []


# --------------------------------------------------------------------------- offres

def test_get_offers_normalizes_packs_and_required_fields(monkeypatch):
    fake_api(monkeypatch, 200, {"success": True, "data": [
        {"name": "86 Diamonds", "gamecode": "mlbb", "Pack": "86", "price": 1.53,
         "requiresUserId": True, "requiresServerId": True, "requiresCharName": False,
         "stockStatus": "in_stock"},
        {"name": "172 Diamonds", "gamecode": "mlbb", "Pack": "172", "price": 3.02,
         "requiresUserId": True, "requiresServerId": True, "requiresCharName": False,
         "stockStatus": "in_stock"},
    ]})

    result = run(provider().get_offers("mlbb"))

    assert result["category_id"] == "mlbb"
    assert [o["offer_id"] for o in result["offers"]] == ["86", "172"]
    assert result["offers"][0] == {"offer_id": "86", "name": "86 Diamonds",
                                   "price_usd": 1.53, "stock_status": "in_stock",
                                   "requires_server_id": True, "requires_char_name": False,
                                   "fields": [{"key": "userid", "label": "Player ID", "type": "string"},
                                              {"key": "serverid", "label": "Server / zone ID", "type": "string"}]}
    assert [f["key"] for f in result["fields"]] == ["userid", "serverid"]


def test_get_offers_without_packs_returns_empty_catalogue(monkeypatch):
    fake_api(monkeypatch, 200, {"success": True, "data": []})
    result = run(provider().get_offers("pubgm"))
    assert result["offers"] == []
    assert [f["key"] for f in result["fields"]] == ["userid"]


def test_get_offers_requires_a_category():
    with pytest.raises(perr.ProviderUnavailableError):
        run(provider().get_offers(""))


# --------------------------------------------------------------------------- champs requis

def test_missing_order_fields_covers_the_declared_identity():
    """`characterId` (Name Check) couvre `userid` (corps `/create`)."""
    assert run(provider().missing_order_fields("pubg-mobile", {"player_id": PLAYER_ID},
                                              ["userid"])) == []


def test_missing_order_fields_reports_serverid_when_no_field_covers_it():
    assert run(provider().missing_order_fields("pubg-mobile", {"player_id": PLAYER_ID},
                                              ["userid", "serverid"])) == ["serverid"]


def test_missing_order_fields_accepts_a_declared_server_field():
    fields = {"player_id": PLAYER_ID, "zone_id": ZONE_ID}
    assert run(provider().missing_order_fields("mobile-legends", fields,
                                              ["userid", "serverid"])) == []


def test_missing_order_fields_treats_a_blank_value_as_absent():
    assert run(provider().missing_order_fields("mobile-legends",
                                              {"player_id": PLAYER_ID, "zone_id": "   "},
                                              ["userid", "serverid"])) == ["serverid"]


def test_missing_order_fields_without_required_param_never_reads_configuration():
    """Aucun appel réseau et aucune configuration nécessaire quand rien n'est exigé."""
    assert run(provider(games=[]).missing_order_fields("inconnu", {}, [])) == []


def test_missing_order_fields_unknown_game_is_fail_closed():
    """Configuration absente = rien n'est couvert : les paramètres requis restent requis."""
    assert run(provider(games=[]).missing_order_fields("inconnu", {"player_id": PLAYER_ID},
                                                      ["userid", "serverid"])) == ["userid", "serverid"]


# --------------------------------------------------------------------------- catalogue

def test_get_categories_is_restricted_to_configured_aluu_games(monkeypatch):
    fake_api(monkeypatch, 200, {"success": True, "data": [
        {"name": "PUBG Mobile", "gamecode": "pubgm"},
        {"name": "Mobile Legends", "gamecode": "mlbb"},
        {"name": "Free Fire", "gamecode": "freefire"},
    ]})

    result = run(provider().get_categories())

    # `free-fire` est configuré FazerCards : il ne doit pas apparaître dans le catalogue ALUU.
    assert result == [{"category_id": "pubgm", "name": "PUBG Mobile"},
                      {"category_id": "mlbb", "name": "Mobile Legends"}]


def test_get_categories_without_authorized_game_calls_no_api(monkeypatch):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))
    assert run(provider([FAZER_GAME]).get_categories()) == []
    assert calls == []


def test_get_categories_accepts_an_explicit_allowlist(monkeypatch):
    fake_api(monkeypatch, 200, {"success": True, "data": [
        {"name": "PUBG Mobile", "gamecode": "pubgm"},
        {"name": "Mobile Legends", "gamecode": "mlbb"},
    ]})
    result = run(provider([], authorized_codes=["mlbb"]).get_categories())
    assert result == [{"category_id": "mlbb", "name": "Mobile Legends"}]


# --------------------------------------------------------------------------- création

def test_create_order_maps_fields_and_keeps_partner_order_id(monkeypatch):
    seen = fake_api(monkeypatch, 200, {"success": True, "message": "Order accepted", "data": {
        "orderid": PARTNER_ID, "reference": "API-XXXXXXXXX", "status": "pending",
        "game": "mlbb", "denom": "86", "userid": PLAYER_ID, "serverid": ZONE_ID}})

    order = run(provider().create_order("mlbb", "86", {"player_id": PLAYER_ID, "zone_id": ZONE_ID},
                                        PARTNER_ID))

    assert json.loads(seen["body"]) == {"game": "mlbb", "denom": "86", "userid": PLAYER_ID,
                                        "serverid": ZONE_ID, "partner_orderid": PARTNER_ID}
    assert order == ProviderOrder(id=PARTNER_ID, status="pending",
                                  normalized_status=OrderStatus.PROCESSING,
                                  raw={"orderid": PARTNER_ID, "reference": "API-XXXXXXXXX",
                                       "status": "pending", "game": "mlbb", "denom": "86",
                                       "userid": PLAYER_ID, "serverid": ZONE_ID})


def test_create_order_refuses_incomplete_identity_without_calling_the_api(monkeypatch):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().create_order("pubgm", "60", {"something_else": "x"}, PARTNER_ID))

    assert exc.value.status_code == 409
    assert exc.value.code == "missing_field"
    assert calls == []


def test_create_order_fails_closed_when_game_is_not_configured(monkeypatch):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().create_order("unknown", "60", {"player_id": PLAYER_ID}, PARTNER_ID))

    assert exc.value.code == "unsupported_game"
    assert calls == []


def test_create_order_rejects_an_unmappable_identity_field(monkeypatch):
    calls = []
    mock_transport(monkeypatch, lambda req: calls.append(req) or httpx.Response(200, json={}))
    game = {**PUBG_GAME, "aluu_identity_map": {"player_id": "not_a_create_field"}}

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider([game]).create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))

    assert exc.value.code == "unsupported_game"
    assert calls == []


def _duplicate_payload(**overrides):
    existing = {"orderid": PARTNER_ID, "reference": "API-XXXXXXXXX", "status": "pending",
                "game": "mlbb", "denom": "86", "userid": PLAYER_ID, "serverid": ZONE_ID}
    existing.update(overrides)
    return {"success": False, "message": "Duplicate order", "data": existing}


def test_create_order_409_identical_is_idempotent_success(monkeypatch):
    fake_api(monkeypatch, 409, _duplicate_payload())

    order = run(provider().create_order("mlbb", "86", {"player_id": PLAYER_ID, "zone_id": ZONE_ID},
                                        PARTNER_ID))

    assert order.id == PARTNER_ID
    assert order.status == "pending"
    assert order.normalized_status == OrderStatus.PROCESSING
    assert order.raw["reference"] == "API-XXXXXXXXX"


@pytest.mark.parametrize("override", [
    {"game": "pubgm"},          # autre jeu
    {"denom": "172"},           # autre pack
    {"userid": "51234567899"},  # autre joueur
])
def test_create_order_409_different_is_never_a_success(monkeypatch, override):
    fake_api(monkeypatch, 409, _duplicate_payload(**override))

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().create_order("mlbb", "86", {"player_id": PLAYER_ID, "zone_id": ZONE_ID},
                                    PARTNER_ID))

    assert exc.value.status_code == 409
    assert exc.value.code == "duplicate_order_mismatch"


def test_create_order_409_unverifiable_is_never_a_success(monkeypatch):
    fake_api(monkeypatch, 409, {"success": False, "data": {"orderid": PARTNER_ID}})

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().create_order("mlbb", "86", {"player_id": PLAYER_ID, "zone_id": ZONE_ID},
                                    PARTNER_ID))

    assert exc.value.code == "duplicate_order_mismatch"


def test_create_order_402_is_insufficient_balance(monkeypatch):
    fake_api(monkeypatch, 402, {"success": False})
    with pytest.raises(perr.ProviderInsufficientBalanceError):
        run(provider().create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))


@pytest.mark.parametrize("status,code", [(503, "pack_unavailable"), (200, "order_rejected")])
def test_create_order_rejections_are_provider_order_errors(monkeypatch, status, code):
    payload = {"success": False, "message": "Order failed"}
    fake_api(monkeypatch, status, payload)

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))

    assert exc.value.status_code == 409
    assert exc.value.code == code


def test_create_order_never_forwards_a_raw_aluu_code(monkeypatch):
    """Code ALUU inventé pour le test : il ne doit jamais ressortir de l'adapter."""
    fake_api(monkeypatch, 400, {"success": False, "message": "Order failed",
                                "code": "ALUU_TEST_ONLY_UNKNOWN_CODE"})

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))

    assert exc.value.status_code == 409
    assert exc.value.code is None                       # plus aucun code ALUU
    assert "ALUU_TEST_ONLY_UNKNOWN_CODE" not in str(exc.value.code)


def test_create_order_402_never_forwards_a_raw_aluu_code(monkeypatch):
    fake_api(monkeypatch, 402, {"success": False, "code": "ALUU_TEST_ONLY_INSUFFICIENT"})

    with pytest.raises(perr.ProviderInsufficientBalanceError) as exc:
        run(provider().create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))

    assert exc.value.code is None


def test_create_order_timeout_is_reported_once(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        raise httpx.ReadTimeout("boom", request=req)

    mock_transport(monkeypatch, handler)
    with pytest.raises(perr.ProviderTimeout):
        run(provider().create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))
    assert len(calls) == 1  # une création n'est jamais rejouée


def test_create_order_server_error_is_not_retried(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(500, json={"success": False})

    mock_transport(monkeypatch, handler)
    with pytest.raises(perr.ProviderUnavailableError):
        run(provider().create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))
    assert len(calls) == 1


# --------------------------------------------------------------------------- statut

def test_get_order_normalizes_successful(monkeypatch):
    seen = fake_api(monkeypatch, 200, {"success": True, "data": {
        "orderid": PARTNER_ID, "status": "successful", "reference": "API-XXXXXXXXX"}})

    order = run(provider().get_order(PARTNER_ID))

    assert seen["url"] == f"https://aluu.in/api/v.1/{PARTNER_ID}"
    assert order.id == PARTNER_ID
    assert order.status == "successful"
    assert order.normalized_status == OrderStatus.COMPLETED


@pytest.mark.parametrize("status,expected", [("error", OrderStatus.FAILED),
                                             ("cancelled", OrderStatus.FAILED),
                                             ("failed", OrderStatus.FAILED),
                                             ("anything", OrderStatus.PROCESSING)])
def test_get_order_normalizes_statuses(monkeypatch, status, expected):
    fake_api(monkeypatch, 200, {"success": True, "data": {"orderid": PARTNER_ID, "status": status}})
    assert run(provider().get_order(PARTNER_ID)).normalized_status == expected


def test_get_order_410_stops_polling(monkeypatch):
    fake_api(monkeypatch, 410, {"success": False})
    with pytest.raises(perr.ProviderError) as exc:
        run(provider().get_order(PARTNER_ID))
    assert exc.value.status_code == 410
    assert exc.value.code == "polling_stopped"


def test_get_order_404_is_not_found(monkeypatch):
    fake_api(monkeypatch, 404, {"success": False})
    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().get_order(PARTNER_ID))
    assert exc.value.status_code == 404


def test_get_order_404_never_forwards_a_raw_aluu_code(monkeypatch):
    fake_api(monkeypatch, 404, {"success": False, "code": "ALUU_TEST_ONLY_UNKNOWN_404"})

    with pytest.raises(perr.ProviderOrderError) as exc:
        run(provider().get_order(PARTNER_ID))

    assert exc.value.code == "order_not_found"   # code MGS, jamais celui d'ALUU


# --------------------------------------------------------------------------- webhook

def _sign(timestamp, raw):
    return hmac.new(WEBHOOK_SECRET.encode(), str(timestamp).encode() + b"." + raw,
                    hashlib.sha256).hexdigest()


def test_verify_webhook_signature_accepts_a_fresh_signed_body(monkeypatch):
    monkeypatch.setenv("ALUU_WEBHOOK_SECRET", WEBHOOK_SECRET)
    raw = b'{"success":true,"data":{"orderid":"MGS-ABC-1","status":"successful"}}'
    stamp = "1768472100"
    monkeypatch.setattr("services.providers.aluu_adapter.time.time", lambda: 1768472100)

    assert provider().verify_webhook_signature(raw, _sign(stamp, raw), stamp) is True


def test_verify_webhook_signature_rejects_stale_bad_and_unsigned(monkeypatch):
    monkeypatch.setenv("ALUU_WEBHOOK_SECRET", WEBHOOK_SECRET)
    raw = b'{"success":true}'
    stamp = "1768472100"
    monkeypatch.setattr("services.providers.aluu_adapter.time.time", lambda: 1768472100 + 301)
    prov = provider()

    assert prov.verify_webhook_signature(raw, _sign(stamp, raw), stamp) is False  # périmé
    assert prov.verify_webhook_signature(raw, "0" * 64, stamp) is False          # mauvaise signature
    assert prov.verify_webhook_signature(raw, _sign(stamp, raw), None) is False   # sans horodatage
    assert prov.verify_webhook_signature(raw, _sign(stamp, raw), "abc") is False  # non numérique


def test_verify_webhook_signature_without_secret_raises_a_configuration_error(monkeypatch):
    """Secret absent (revue RV-001) : erreur de configuration 503, jamais un simple `False`."""
    raw = b'{"success":true}'
    monkeypatch.setattr("services.providers.aluu_adapter.time.time", lambda: 1768472100)

    with pytest.raises(aluu.AluuNotConfiguredError) as exc:
        provider().verify_webhook_signature(raw, "0" * 64, "1768472100")

    assert exc.value.status_code == 503


def test_verify_webhook_signature_with_non_ascii_header_is_false_not_an_exception(monkeypatch):
    """En-tête non fiable : la comparaison se fait sur octets, donc `False` et jamais `TypeError`."""
    monkeypatch.setenv("ALUU_WEBHOOK_SECRET", WEBHOOK_SECRET)
    raw = b'{"success":true}'
    stamp = "1768472100"
    monkeypatch.setattr("services.providers.aluu_adapter.time.time", lambda: 1768472100)

    assert provider().verify_webhook_signature(raw, "é" * 64, stamp) is False
    assert provider().verify_webhook_signature(raw, "é" + "0" * 63, stamp) is False


def test_parse_webhook_event_uses_orderid_as_partner_order_id():
    """Doc « Top-up webhooks » : « data.orderid is your partner_orderid »."""
    payload = {"success": True, "data": {
        "orderid": PARTNER_ID, "reference": "API-XXXXXXXXX", "status": "successful",
        "provider_order_id": "PRV-0000000001", "game": "mlbb", "denom": "86", "userid": PLAYER_ID}}

    event = provider().parse_webhook_event(payload)

    assert event.provider_order_id == PARTNER_ID       # partner_orderid, pas provider_order_id
    assert event.status == "successful"
    assert event.event_id is None and event.event is None and event.previous_status is None
    assert event.raw["data"]["provider_order_id"] == "PRV-0000000001"


def test_parse_webhook_event_keeps_the_documented_event_name():
    """Le webhook documenté porte `event` (`order.successful` / `order.failed`) : on le garde."""
    event = provider().parse_webhook_event({
        "success": False, "event": "order.failed",
        "data": {"orderid": PARTNER_ID, "status": "error"}})

    assert event.event == "order.failed"
    assert event.status == "error"
    assert event.event_id is None and event.previous_status is None


# --------------------------------------------------------------------------- logs

def test_logs_never_contain_player_id_or_api_key(monkeypatch, caplog):
    """Sortie RÉELLE des logs (httpx compris) sur un aller-retour identité + commande."""
    def handler(req):
        if "game-check" in str(req.url):
            return httpx.Response(200, json={"valid": "valid", "name": "PlayerName"})
        return httpx.Response(200, json={"success": True, "data": {
            "orderid": PARTNER_ID, "status": "pending"}})

    mock_transport(monkeypatch, handler)
    caplog.set_level(logging.DEBUG)
    prov = provider()

    run(prov.validate_identity("pubg-mobile", {"player_id": PLAYER_ID}))
    run(prov.create_order("pubgm", "60", {"player_id": PLAYER_ID}, PARTNER_ID))

    assert PLAYER_ID not in caplog.text
    assert API_KEY not in caplog.text
    assert "/api/check/game-check" in caplog.text   # la requête reste traçable, sans query string
