"""Service Neferbyte — client de vérification d'identité (PL-003-BE-2).

Tests 100 % mockés : aucun appel réseau réel, aucune clé réelle, aucun ID réel de production.
On vérifie le contrat typé (`ok`, `invalid_id`, `provider_unavailable`, `timeout`, `config_error`),
le branchement sur `success` (pas sur le statut HTTP), l'encodage d'URL, la règle du nouvel essai
unique et l'absence d'ID/pseudo/clé dans les logs.
"""
import asyncio
import logging

import httpx
import pytest

from services import neferbyte

KEY = "0123456789abcdef0123456789abcdef"
BASE = "https://api.neferbyte.com"
GAME_ID = "1958604115"
NICKNAME = "PlayerOne"
SERVER = "15748"
REAL_ASYNC_CLIENT = httpx.AsyncClient  # capturé avant tout monkeypatch


def run(coro):
    return asyncio.run(coro)


def mock_http(monkeypatch, handler):
    """Remplace le client httpx par un transport simulé (rien ne sort de la machine)."""
    monkeypatch.setattr(neferbyte.httpx, "AsyncClient",
                        lambda **kwargs: REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)))


def ok_body(username: str = NICKNAME, **data) -> dict:
    return {"success": True, "data": {"game": "G", "userId": GAME_ID, "username": username, **data}}


def error_body(message: str) -> dict:
    return {"error": True, "msg": message}


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    """Aucune attente réelle : on enregistre les délais demandés par le client."""
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setenv("NEFERBYTE_API_KEY", KEY)
    monkeypatch.delenv("NEFERBYTE_API_BASE", raising=False)
    monkeypatch.delenv("NEFERBYTE_TIMEOUT_S", raising=False)
    monkeypatch.setattr(neferbyte, "_sleep", fake_sleep)
    return delays


# --------------------------------------------------------------------------- #
# Catalogue (source : PDF officiel)
# --------------------------------------------------------------------------- #
def test_catalogue_has_the_39_documented_endpoints():
    documented = {
        # 32 jeux
        "mobile-legends", "free-fire", "ff-global", "bgmi", "pubgm-global", "pubgm-lite",
        "cod-mobile", "valorant", "honor-of-kings", "arena-of-valor", "blood-strike",
        "arena-breakout", "pokemonunite", "genshin", "mu-devils-awaken", "mu-origin-3",
        "dragon-raja", "lifeafter", "opm-the-strongest", "metal-slug", "revelation",
        "gov-nikke", "eggy-party", "tom-and-jerry-chase", "whiteoutsurvival", "ace-racer",
        "speed-drifters", "mcgg", "dfm", "dfm-garena", "teen-patti-gold", "jawaker",
        # 7 live & social
        "bigo-live", "poppo", "tumile", "livu", "higgs-domino", "mixu", "hiya",
    }
    assert len(documented) == 39
    assert set(neferbyte.GAMES) == documented


def test_catalogue_particularities_match_the_documentation():
    assert neferbyte.GAMES["mobile-legends"].needs_server
    assert neferbyte.GAMES["mobile-legends"].server_label == "server"
    assert neferbyte.GAMES["valorant"].needs_server
    assert neferbyte.GAMES["valorant"].id_kind == "text"
    assert neferbyte.GAMES["valorant"].server_label == "tag"
    assert not neferbyte.GAMES["free-fire"].needs_server
    assert neferbyte.GAMES["ff-global"].returns_region
    assert neferbyte.GAMES["genshin"].returns_region
    assert neferbyte.GAMES["pubgm-global"].returns_is_ban
    assert neferbyte.GAMES["honor-of-kings"].returns_is_ban
    assert neferbyte.GAMES["bgmi"].requires_addon


# --------------------------------------------------------------------------- #
# Succès
# --------------------------------------------------------------------------- #
def test_success_id_only(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=ok_body())

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.OK and res.ok
    assert res.player_name == NICKNAME
    assert res.region is None and res.is_ban is None
    assert len(calls) == 1
    assert str(calls[0].url) == f"{BASE}/game-id-checker/free-fire/{GAME_ID}"
    assert calls[0].headers["x-api-key"] == KEY


def test_success_with_server_segment(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=ok_body())

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("mobile-legends", "1393323764", SERVER))

    assert res.status == neferbyte.OK
    assert str(calls[0].url) == f"{BASE}/game-id-checker/mobile-legends/1393323764/{SERVER}"


def test_valorant_name_and_tag_are_percent_encoded(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=ok_body())

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("valorant", "player name", "#1234"))

    assert res.status == neferbyte.OK
    assert str(calls[0].url) == f"{BASE}/game-id-checker/valorant/player%20name/%231234"


def test_region_and_ban_flag_are_exposed_when_documented(monkeypatch):
    def handler_genshin(request):
        return httpx.Response(200, json=ok_body(server="asia"))

    mock_http(monkeypatch, handler_genshin)
    assert run(neferbyte.verify_identity("genshin", "844335555")).region == "asia"

    def handler_pubg(request):
        return httpx.Response(200, json=ok_body(is_ban=True))

    mock_http(monkeypatch, handler_pubg)
    res = run(neferbyte.verify_identity("pubgm-global", "52115806933"))
    assert res.status == neferbyte.OK and res.is_ban is True


# --------------------------------------------------------------------------- #
# config_error — AUCUN appel réseau
# --------------------------------------------------------------------------- #
def _forbid_network(monkeypatch):
    def handler(request):  # pragma: no cover - ne doit jamais être atteint
        raise AssertionError("aucun appel réseau ne doit être émis")

    mock_http(monkeypatch, handler)


def test_unknown_slug_is_config_error(monkeypatch):
    _forbid_network(monkeypatch)
    res = run(neferbyte.verify_identity("not-a-neferbyte-game", GAME_ID))
    assert res.status == neferbyte.CONFIG_ERROR and res.reason == "unknown_slug"


def test_missing_id_is_config_error(monkeypatch):
    _forbid_network(monkeypatch)
    res = run(neferbyte.verify_identity("free-fire", "   "))
    assert res.status == neferbyte.CONFIG_ERROR and res.reason == "missing_id"


def test_missing_server_is_config_error(monkeypatch):
    _forbid_network(monkeypatch)
    res = run(neferbyte.verify_identity("mobile-legends", "1393323764"))
    assert res.status == neferbyte.CONFIG_ERROR and res.reason == "missing_server"


def test_unexpected_server_is_config_error(monkeypatch):
    _forbid_network(monkeypatch)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID, SERVER))
    assert res.status == neferbyte.CONFIG_ERROR and res.reason == "unexpected_server"


# --------------------------------------------------------------------------- #
# Indisponibilité / configuration serveur
# --------------------------------------------------------------------------- #
def test_missing_key_is_unavailable_without_call(monkeypatch):
    _forbid_network(monkeypatch)
    monkeypatch.delenv("NEFERBYTE_API_KEY")
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))
    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "not_configured"


def test_http_auth_and_quota_are_unavailable_without_retry(monkeypatch, no_sleep):
    # Un 429 sans mention du quota journalier est une limite de débit momentanée : il ne doit
    # PAS être confondu avec le quota du jour (BE-6, correctif A).
    for status_code, reason in ((401, "auth"), (403, "auth"), (429, "rate_limited")):
        calls: list[httpx.Request] = []

        def handler(request, code=status_code):
            calls.append(request)
            return httpx.Response(code, json=error_body("nope"))

        mock_http(monkeypatch, handler)
        res = run(neferbyte.verify_identity("free-fire", GAME_ID))
        assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == reason
        assert len(calls) == 1
    assert no_sleep == []


@pytest.mark.parametrize("body", [
    {"error": True, "msg": "You have reached your daily limit today."},
    {"error": True, "msg": "DAILY LIMIT reached for your plan."},
    {"success": False, "msg": "Daily limit exceeded", "data": None},
])
def test_http_429_with_a_daily_limit_indication_is_a_quota(monkeypatch, no_sleep, body):
    """Un 429 qui annonce explicitement le quota journalier reste `quota` (jour à fermer)."""
    calls: list[httpx.Request] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, json=body)

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "quota"
    assert len(calls) == 1                   # jamais de nouvel essai immédiat
    assert no_sleep == []


@pytest.mark.parametrize("body", [None, "not json", ["unexpected"], {"msg": 42}])
def test_http_429_with_an_unreadable_body_stays_momentary(monkeypatch, no_sleep, body):
    """Charge utile illisible : aucune indication de quota, donc pas de fermeture du jour."""
    def handler(request):
        if body is None:
            return httpx.Response(429)
        if body == "not json":
            return httpx.Response(429, text="not json")
        return httpx.Response(429, json=body)

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "rate_limited"


@pytest.mark.parametrize("message, reason", [
    ("Authentication is required.", "auth"),
    ("Enter a valid X-Api-Key.", "auth"),
    ("Sorry, you don't have an active subscription.", "subscription"),
    ("Sorry, you don't have an active subscription for this endpoint.", "subscription"),
    ("You have reached your daily limit today.", "quota"),
    ("Under maintenance.", "maintenance"),
])
def test_provider_messages_are_unavailable_without_retry(monkeypatch, no_sleep, message, reason):
    calls: list[httpx.Request] = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=error_body(message))

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == reason
    assert len(calls) == 1 and no_sleep == []


def test_unknown_error_message_fails_closed(monkeypatch, no_sleep):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=error_body("Something brand new upstream"))

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "unknown_error"
    assert len(calls) == 1 and no_sleep == []


# --------------------------------------------------------------------------- #
# invalid_id
# --------------------------------------------------------------------------- #
def test_not_found_is_invalid_id_and_retried_once(monkeypatch, no_sleep):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=error_body('Can\'t find a username for "User ID: 99999".'))

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.INVALID_ID and res.reason == "not_found"
    assert len(calls) == 2  # un seul nouvel essai
    assert no_sleep == [neferbyte.RETRY_DELAY_S]


@pytest.mark.parametrize("message", [
    "The ID field is required.",
    "The ID field must contain only numbers.",
    "The Tag field must contain valid tags.",
])
def test_rejected_entry_is_invalid_id_without_retry(monkeypatch, no_sleep, message):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=error_body(message))

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.INVALID_ID and res.reason == "invalid_entry"
    assert len(calls) == 1 and no_sleep == []


# --------------------------------------------------------------------------- #
# Transport / réponses inattendues
# --------------------------------------------------------------------------- #
def test_server_error_is_retried_once_then_unavailable(monkeypatch, no_sleep):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503, json=error_body("upstream"))

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "server_error"
    assert len(calls) == 2 and no_sleep == [neferbyte.RETRY_DELAY_S]


def test_server_error_then_success(monkeypatch, no_sleep):
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(502, json=error_body("upstream"))
        return httpx.Response(200, json=ok_body())

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.OK and res.player_name == NICKNAME
    assert len(calls) == 2


def test_timeout_is_reported_after_the_single_retry(monkeypatch, no_sleep):
    calls = []

    def handler(request):
        calls.append(request)
        raise httpx.TimeoutException("slow")

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.TIMEOUT and res.reason == "timeout"
    assert len(calls) == 2 and no_sleep == [neferbyte.RETRY_DELAY_S]


def test_network_error_is_unavailable_after_the_single_retry(monkeypatch, no_sleep):
    calls = []

    def handler(request):
        calls.append(request)
        raise httpx.ConnectError("boom")

    mock_http(monkeypatch, handler)
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))

    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "network"
    assert len(calls) == 2


def test_unexpected_payload_fails_closed(monkeypatch):
    for body in ({}, {"success": False}, {"data": {"username": "x"}}, [1, 2, 3]):
        mock_http(monkeypatch, lambda request, b=body: httpx.Response(200, json=b))
        res = run(neferbyte.verify_identity("free-fire", GAME_ID))
        assert res.status == neferbyte.PROVIDER_UNAVAILABLE, body


def test_success_without_username_is_never_validated(monkeypatch):
    for username in (None, "", "   "):
        mock_http(monkeypatch, lambda request, u=username: httpx.Response(200, json=ok_body(u)))
        res = run(neferbyte.verify_identity("free-fire", GAME_ID))
        assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "missing_username"


def test_non_json_response_fails_closed(monkeypatch):
    mock_http(monkeypatch, lambda request: httpx.Response(200, text="<html>oops</html>"))
    res = run(neferbyte.verify_identity("free-fire", GAME_ID))
    assert res.status == neferbyte.PROVIDER_UNAVAILABLE and res.reason == "invalid_json"


# --------------------------------------------------------------------------- #
# Logs — jamais d'ID joueur, de pseudo ni de clé
# --------------------------------------------------------------------------- #
def test_logs_never_contain_id_nickname_or_key(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)

    def not_found(request):
        # Le message fournisseur contient l'ID en clair : il ne doit jamais être logué tel quel.
        return httpx.Response(200, json=error_body(f'Can\'t find a username for "User ID: {GAME_ID}".'))

    mock_http(monkeypatch, not_found)
    run(neferbyte.verify_identity("free-fire", GAME_ID))

    def unavailable(request):
        return httpx.Response(503, json=error_body("upstream"))

    mock_http(monkeypatch, unavailable)
    run(neferbyte.verify_identity("free-fire", GAME_ID))

    def success(request):
        return httpx.Response(200, json=ok_body())

    mock_http(monkeypatch, success)
    run(neferbyte.verify_identity("free-fire", GAME_ID))

    text = caplog.text
    assert GAME_ID not in text
    assert NICKNAME not in text
    assert KEY not in text


# --------------------------------------------------------------------------- #
# Configuration du timeout
# --------------------------------------------------------------------------- #
def test_timeout_is_configurable_and_bounded(monkeypatch):
    assert neferbyte._timeout() == neferbyte.DEFAULT_TIMEOUT_S
    monkeypatch.setenv("NEFERBYTE_TIMEOUT_S", "3.5")
    assert neferbyte._timeout() == 3.5
    for invalid in ("abc", "0", "-2", ""):
        monkeypatch.setenv("NEFERBYTE_TIMEOUT_S", invalid)
        assert neferbyte._timeout() == neferbyte.DEFAULT_TIMEOUT_S


def test_timeout_is_passed_to_the_client(monkeypatch):
    seen = {}

    def factory(**kwargs):
        seen["timeout"] = kwargs.get("timeout")
        return REAL_ASYNC_CLIENT(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=ok_body())))

    monkeypatch.setenv("NEFERBYTE_TIMEOUT_S", "4")
    monkeypatch.setattr(neferbyte.httpx, "AsyncClient", factory)
    run(neferbyte.verify_identity("free-fire", GAME_ID))
    assert seen["timeout"] == 4.0
