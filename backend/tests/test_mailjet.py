"""Mailjet Send API transport — unit tests, HTTP fully mocked (no real email is ever sent)."""
import asyncio
import logging

import httpx
import pytest

from services import mailer

CREDS = {
    "MAILJET_API_KEY": "key-test-123",
    "MAILJET_SECRET_KEY": "secret-test-456",
    "MAILJET_FROM_EMAIL": "admin@magicgame.store",
    "MAILJET_FROM_NAME": "Magic Game Store",
    "FRONTEND_URL": "https://magicgame.store",
}


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"Messages": [{"Status": "success"}]}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeClient:
    """Stands in for httpx.AsyncClient; records the single outgoing request."""

    calls = []

    def __init__(self, result, **kwargs):
        self._result = result

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, auth=None):
        FakeClient.calls.append({"url": url, "json": json, "auth": auth})
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


@pytest.fixture(autouse=True)
def creds(monkeypatch):
    for k, v in CREDS.items():
        monkeypatch.setenv(k, v)
    FakeClient.calls = []
    yield


def patch_http(monkeypatch, result):
    monkeypatch.setattr(mailer.httpx, "AsyncClient", lambda **kw: FakeClient(result, **kw))


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


# ---------- transport behaviour ----------
def test_2xx_success_and_correct_sender(monkeypatch):
    patch_http(monkeypatch, FakeResponse(200))
    assert run(mailer.send("user@example.com", "Sujet", "Titre", "<p>hi</p>", "hi")) is True
    call = FakeClient.calls[0]
    assert call["url"] == "https://api.mailjet.com/v3.1/send"
    assert call["auth"] == ("key-test-123", "secret-test-456")
    msg = call["json"]["Messages"][0]
    assert msg["From"] == {"Email": "admin@magicgame.store", "Name": "Magic Game Store"}
    assert msg["To"] == [{"Email": "user@example.com"}]
    assert msg["Subject"] == "Sujet" and msg["TextPart"] == "hi" and "<p>hi</p>" in msg["HTMLPart"]


@pytest.mark.parametrize("code", [400, 401, 403])
def test_4xx_returns_false(monkeypatch, code):
    patch_http(monkeypatch, FakeResponse(code, {"ErrorMessage": "bad"}))
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is False


def test_5xx_returns_false(monkeypatch):
    patch_http(monkeypatch, FakeResponse(500, {"ErrorMessage": "boom"}))
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is False


def test_timeout_returns_false(monkeypatch):
    patch_http(monkeypatch, httpx.ReadTimeout("timeout"))
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is False


def test_connection_error_returns_false(monkeypatch):
    patch_http(monkeypatch, httpx.ConnectError("refused"))
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is False


def test_invalid_json_2xx_still_success(monkeypatch):
    patch_http(monkeypatch, FakeResponse(200, ValueError("not json")))
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is True


def test_message_level_error_returns_false(monkeypatch):
    patch_http(monkeypatch, FakeResponse(200, {"Messages": [{"Status": "error"}]}))
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is False


def test_missing_credentials_skips_call(monkeypatch):
    monkeypatch.delenv("MAILJET_API_KEY", raising=False)
    patch_http(monkeypatch, FakeResponse(200))
    assert mailer.configured() is False
    assert run(mailer.send("user@example.com", "Sujet", "T", "<p>x</p>", "x")) is False
    assert FakeClient.calls == []


# ---------- business emails still go through Mailjet ----------
def test_verification_email(monkeypatch):
    patch_http(monkeypatch, FakeResponse(200))
    assert run(mailer.send_verification("user@example.com", "Rado", "tok-verify-abc")) is True
    msg = FakeClient.calls[0]["json"]["Messages"][0]
    assert "verifier-email/tok-verify-abc" in msg["HTMLPart"]
    assert "Confirmez votre email" in msg["Subject"]


def test_password_reset_email(monkeypatch):
    patch_http(monkeypatch, FakeResponse(200))
    assert run(mailer.send_password_reset("user@example.com", "Rado", "tok-reset-xyz")) is True
    msg = FakeClient.calls[0]["json"]["Messages"][0]
    assert "reinitialiser/tok-reset-xyz" in msg["HTMLPart"]


def test_password_changed_email(monkeypatch):
    patch_http(monkeypatch, FakeResponse(200))
    assert run(mailer.send_password_changed("user@example.com", "Rado")) is True


# ---------- no secrets / tokens in logs ----------
def test_no_secret_or_token_in_logs(monkeypatch, caplog):
    patch_http(monkeypatch, FakeResponse(200))
    with caplog.at_level(logging.INFO, logger="mgs.mail"):
        run(mailer.send_password_reset("user@example.com", "Rado", "tok-reset-xyz"))
        patch_http(monkeypatch, FakeResponse(500))
        run(mailer.send_password_reset("user@example.com", "Rado", "tok-reset-xyz"))
        patch_http(monkeypatch, httpx.ReadTimeout("t"))
        run(mailer.send_password_reset("user@example.com", "Rado", "tok-reset-xyz"))
    logs = caplog.text
    for forbidden in ("tok-reset-xyz", "secret-test-456", "key-test-123", "user@example.com"):
        assert forbidden not in logs
    assert "u***@example.com" in logs
