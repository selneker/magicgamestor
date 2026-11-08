"""PL-SEC-HARDEN-1 A/B — CAPTCHA Turnstile et verrouillage progressif (aucun réseau réel).

Tests unitaires : httpx est simulé, la collection `login_attempts` est en mémoire.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

FAKE_KEY = "test-only-turnstile-secret"


def _run(coro):
    return asyncio.run(coro)


def _now():
    return datetime.now(timezone.utc)


class FakeRequest:
    headers: dict = {}
    client = SimpleNamespace(host="203.0.113.7")


class FakeResponse:
    def __init__(self, success=True, status_code=200):
        self._success = success
        self.status_code = status_code

    def json(self):
        return {"success": self._success}


class FakeHttpClient:
    """Remplace httpx.AsyncClient : enregistre l'appel et renvoie un succès/échec simulé."""

    calls: list = []
    response = FakeResponse()
    raises = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, data=None):
        type(self).calls.append({"url": url, "data": data or {}})
        if type(self).raises:
            raise type(self).raises
        return type(self).response


def _captcha_http(success=True, raises=None):
    FakeHttpClient.calls = []
    FakeHttpClient.response = FakeResponse(success=success)
    FakeHttpClient.raises = raises
    return patch("services.captcha.httpx.AsyncClient", FakeHttpClient)


class TestCaptchaServerVerification:
    def test_disabled_accepts_without_network(self, monkeypatch):
        from services import captcha
        monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
        with _captcha_http():
            assert _run(captcha.verify_turnstile(None, "203.0.113.7")) is True
        assert FakeHttpClient.calls == []

    def test_disabled_by_flag_even_with_key(self, monkeypatch):
        from services import captcha
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        monkeypatch.setenv("TURNSTILE_ENABLED", "false")
        assert captcha.enabled() is False
        assert _run(captcha.verify_turnstile(None, None)) is True

    def test_enabled_valid_token_passes(self, monkeypatch):
        from services import captcha
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        monkeypatch.delenv("TURNSTILE_ENABLED", raising=False)
        with _captcha_http(success=True):
            assert _run(captcha.verify_turnstile("fake-token", "203.0.113.7")) is True
        assert len(FakeHttpClient.calls) == 1
        sent = FakeHttpClient.calls[0]["data"]
        assert sent["secret"] == FAKE_KEY and sent["response"] == "fake-token"
        assert sent["remoteip"] == "203.0.113.7"

    def test_enabled_missing_or_rejected_token_is_refused(self, monkeypatch):
        from services import captcha
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with _captcha_http(success=True):
            assert _run(captcha.verify_turnstile(None, "203.0.113.7")) is False
        assert FakeHttpClient.calls == []  # jeton absent : aucun appel réseau
        with _captcha_http(success=False):
            assert _run(captcha.verify_turnstile("bad-token", None)) is False

    def test_network_error_never_raises(self, monkeypatch):
        from services import captcha
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with _captcha_http(raises=TimeoutError("réseau indisponible")):
            assert _run(captcha.verify_turnstile("fake-token", None)) is False

    def test_require_raises_generic_400_only_when_enabled_and_invalid(self, monkeypatch):
        from fastapi import HTTPException
        from services import captcha
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with _captcha_http(success=False):
            with pytest.raises(HTTPException) as exc:
                _run(captcha.require("bad-token", "203.0.113.7"))
        assert exc.value.status_code == 400
        assert exc.value.detail == "Vérification anti-robot requise."
        monkeypatch.delenv("TURNSTILE_SECRET_KEY")
        _run(captcha.require(None, "203.0.113.7"))  # désactivé : passe


class FakeAttempts:
    def __init__(self, count=None, minutes_ago=0):
        self.doc = None if count is None else {
            "identifier": "client@example.test", "count": count,
            "last_at": (_now() - timedelta(minutes=minutes_ago)).isoformat(),
        }

    async def find_one(self, query):
        return self.doc

    async def delete_one(self, query):
        self.doc = None


def _check(count, token=None, minutes_ago=0):
    from routers import auth
    attempts = FakeAttempts(count, minutes_ago)
    with patch.object(auth, "db", SimpleNamespace(login_attempts=attempts)):
        _run(auth._check_lock("client@example.test", FakeRequest(), token))
    return attempts


class TestProgressiveLoginCaptcha:
    def test_two_failures_do_not_require_captcha_yet(self, monkeypatch):
        from routers import auth
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with patch.object(auth.captcha, "verify_turnstile", AsyncMock(return_value=False)) as verify:
            _check(1, token=None)  # 2e tentative : mot de passe seul
        verify.assert_not_awaited()

    def test_third_attempt_without_captcha_is_refused(self, monkeypatch):
        from fastapi import HTTPException
        from routers import auth
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with patch.object(auth.captcha, "verify_turnstile", AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc:
                _check(2, token=None)
        assert exc.value.status_code == 400

    def test_third_attempt_with_valid_captcha_is_processed(self, monkeypatch):
        from routers import auth
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with patch.object(auth.captcha, "verify_turnstile", AsyncMock(return_value=True)) as verify:
            _check(2, token="fake-token")
        verify.assert_awaited_once()

    def test_hard_lock_after_ten_failures_even_with_captcha(self, monkeypatch):
        from fastapi import HTTPException
        from routers import auth
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with patch.object(auth.captcha, "verify_turnstile", AsyncMock(return_value=True)):
            with pytest.raises(HTTPException) as exc:
                _check(10, token="fake-token")
        assert exc.value.status_code == 429

    def test_captcha_disabled_keeps_five_attempt_lock(self, monkeypatch):
        from fastapi import HTTPException
        from routers import auth
        monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
        _check(4)  # pas encore verrouillé
        with pytest.raises(HTTPException) as exc:
            _check(5)
        assert exc.value.status_code == 429

    def test_window_expiry_resets_the_counter(self, monkeypatch):
        from routers import auth
        monkeypatch.setenv("TURNSTILE_SECRET_KEY", FAKE_KEY)
        with patch.object(auth.captcha, "verify_turnstile", AsyncMock(return_value=False)) as verify:
            attempts = _check(2, token=None, minutes_ago=20)
        verify.assert_not_awaited()
        assert attempts.doc is None
