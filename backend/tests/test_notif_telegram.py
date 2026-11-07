"""PL-NOTIF-5 — canal de secours Telegram des alertes admin.

Aucun réseau, aucun Mongo, aucune lecture de `backend/.env` : journal, Push et client HTTP sont
simulés. Le jeton et l'identifiant de conversation utilisés sont des **sentinelles** ; les tests
vérifient qu'ils ne sortent ni du journal, ni des logs, ni des réponses des routes.
"""
import asyncio
import importlib.util
import json
import logging
import re
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from pymongo.errors import DuplicateKeyError

from routers import notifications as notifications_router
from services import notifications, push, telegram

BACKEND_DIR = Path(__file__).resolve().parents[1]
TOKEN = "sentinelle-jeton-bot-000"
CHAT_ID = "sentinelle-chat-4242"


def _run(coro):
    return asyncio.run(coro)


def _now():
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Faux journal, faux Push, faux client HTTP
# --------------------------------------------------------------------------- #
class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        return self

    def limit(self, count):
        self._docs = self._docs[:count]
        return self

    async def to_list(self, length=None):
        return self._docs if length is None else self._docs[:length]


class FakeAlertLog:
    """Même contrainte que l'index unique `(event, dedupe_key)`."""

    def __init__(self, fail_insert=False):
        self.docs = []
        self.fail_insert = fail_insert

    async def insert_one(self, doc):
        if self.fail_insert:
            raise RuntimeError("journal indisponible")
        key = doc.get("dedupe_key")
        if key is not None and any(d["event"] == doc["event"] and d.get("dedupe_key") == key
                                   for d in self.docs):
            raise DuplicateKeyError("dedupe")
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if doc["_id"] == query["_id"]:
                doc.update(update["$set"])

    def find(self, query=None, projection=None):
        return _Cursor(self.docs)

    def channels(self, channel):
        return [d for d in self.docs if d.get("channel") == channel]


class FakeSubs:
    async def count_documents(self, query):
        return 0


class FakeDB:
    def __init__(self, fail_journal=False):
        self.alert_log = FakeAlertLog(fail_insert=fail_journal)
        self.push_subscriptions = FakeSubs()


class FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = {"ok": True, "result": {}} if body is None else body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class FakeClient:
    def __init__(self, response=None, error=None):
        self.response = response or FakeResponse()
        self.error = error
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        self.calls.append({"url": url, "json": json})
        if self.error is not None:
            raise self.error
        return self.response


def _http(response=None, error=None):
    client = FakeClient(response=response, error=error)
    return client, patch.object(telegram.httpx, "AsyncClient", lambda **kwargs: client)


def _push_patch(db, status="sent", error=None, configured=True):
    async def dispatch(payload):
        if error is not None:
            raise error
        return {"targeted": 1, "sent": 1 if status == "sent" else 0, "expired": 0,
                "failed": 0 if status == "sent" else 1, "ignored": 0,
                "reasons": [] if status == "sent" else ["send_error"]}

    return [patch.object(notifications, "db", db), patch.object(push, "db", db),
            patch.object(push, "configured", lambda: configured),
            patch.object(push, "dispatch_to_admins", dispatch)]


def _with_all(patchers):
    stack = ExitStack()
    for patcher in patchers:
        stack.enter_context(patcher)
    return stack


def _configure(monkeypatch, token=TOKEN, chat_id=CHAT_ID):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", token)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", chat_id)


def _journal_text(db):
    return json.dumps(db.alert_log.docs, default=str)


# --------------------------------------------------------------------------- #
# Module : configuration, texte, catégories d'échec
# --------------------------------------------------------------------------- #
def test_not_configured_is_skipped_without_network():
    def boom(**kwargs):
        pytest.fail("aucun appel réseau sans configuration")

    with patch.object(telegram.httpx, "AsyncClient", boom):
        assert _run(telegram.send_message("texte")) == ("skipped", "telegram_not_configured")
    assert telegram.configured() is False


def test_configured_sends_one_plain_text_message(monkeypatch):
    _configure(monkeypatch)
    client, patcher = _http()
    with patcher:
        assert _run(telegram.send_message("Titre\nCorps")) == ("sent", None)
    assert len(client.calls) == 1
    payload = client.calls[0]["json"]
    assert payload["chat_id"] == CHAT_ID
    assert payload["text"] == "Titre\nCorps"
    assert "parse_mode" not in payload  # texte brut : aucun balisage interprété


@pytest.mark.parametrize("raw,expected", [("", 5.0), ("x", 5.0), ("0", 1.0), ("999", 30.0), ("7", 7.0)])
def test_timeout_is_bounded(monkeypatch, raw, expected):
    monkeypatch.setenv("TELEGRAM_TIMEOUT_S", raw)
    assert telegram.timeout_seconds() == expected


def test_text_is_bounded(monkeypatch):
    _configure(monkeypatch)
    client, patcher = _http()
    with patcher:
        _run(telegram.send_message("a" * 5000))
    text = client.calls[0]["json"]["text"]
    assert len(text) <= telegram.MAX_TEXT and text.endswith("…")


def test_timeout_maps_to_a_category(monkeypatch):
    _configure(monkeypatch)
    _, patcher = _http(error=httpx.TimeoutException("trop lent"))
    with patcher:
        assert _run(telegram.send_message("texte")) == ("failed", "telegram_timeout")


def test_network_error_maps_to_a_category(monkeypatch):
    _configure(monkeypatch)
    _, patcher = _http(error=httpx.ConnectError(f"connexion refusée {TOKEN}"))
    with patcher:
        assert _run(telegram.send_message("texte")) == ("failed", "telegram_network_error")


def test_http_error_maps_to_a_category(monkeypatch):
    _configure(monkeypatch)
    _, patcher = _http(response=FakeResponse(status_code=400))
    with patcher:
        assert _run(telegram.send_message("texte")) == ("failed", "telegram_http_400")


def test_ok_false_is_rejected_without_echoing_the_body(monkeypatch):
    _configure(monkeypatch)
    _, patcher = _http(response=FakeResponse(body={"ok": False, "description": "Bad Request: chat not found"}))
    with patcher:
        assert _run(telegram.send_message("texte")) == ("failed", "telegram_rejected")


def test_unreadable_body_is_rejected(monkeypatch):
    _configure(monkeypatch)
    _, patcher = _http(response=FakeResponse(body=ValueError("pas du JSON")))
    with patcher:
        assert _run(telegram.send_message("texte")) == ("failed", "telegram_rejected")


def test_unexpected_exception_never_raises(monkeypatch):
    _configure(monkeypatch)
    _, patcher = _http(error=RuntimeError(f"panne {TOKEN}"))
    with patcher:
        assert _run(telegram.send_message("texte")) == ("failed", "telegram_error")


def test_httpx_logger_is_below_info_because_it_logs_the_url():
    """httpx écrit l'URL complète en INFO : le jeton y serait visible sans ce bridage."""
    assert logging.getLogger("httpx").level >= logging.WARNING


# --------------------------------------------------------------------------- #
# Intégration : indépendance des deux canaux, journal, déduplication
# --------------------------------------------------------------------------- #
def test_enabled_events_write_a_telegram_line(monkeypatch):
    _configure(monkeypatch)
    db = FakeDB()
    client, http = _http()
    with _with_all([http, *_push_patch(db)]):
        _run(notifications.notify_admin("order_paid", "T", "B", "/admin/commandes",
                                        dedupe_key="paid:MGS-1"))
    rows = db.alert_log.channels("telegram")
    assert len(rows) == 1 and rows[0]["status"] == "sent"
    assert rows[0]["dedupe_key"] == "tg:paid:MGS-1"
    assert client.calls[0]["json"]["text"] == "T\nB"


@pytest.mark.parametrize("event", ["chat_message", "payment_expired"])
def test_excluded_events_send_nothing_on_telegram(monkeypatch, event):
    _configure(monkeypatch)
    db = FakeDB()
    client, http = _http()
    with _with_all([http, patch.object(notifications, "db", db), patch.object(push, "db", db),
                    patch.object(push, "configured", lambda: False)]):
        result = _run(notifications.notify_admin(event, "T", "B", "/admin/x", include_channels=True))
    assert client.calls == [] and db.alert_log.channels("telegram") == []
    assert result["telegram"] == {"status": "skipped", "reason": "event_disabled"}


def test_event_list_override_is_respected(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setenv("TELEGRAM_ALERT_EVENTS", "order_created")
    db = FakeDB()
    client, http = _http()
    with _with_all([http, patch.object(notifications, "db", db), patch.object(push, "db", db),
                    patch.object(push, "configured", lambda: False)]):
        skipped = _run(notifications.notify_admin("test", "T", "B", "/admin/x", include_channels=True))
        sent = _run(notifications.notify_admin("order_created", "T", "B", "/admin/x",
                                               include_channels=True))
    assert skipped["telegram"] == {"status": "skipped", "reason": "event_disabled"}
    assert sent["telegram"] == {"status": "sent", "reason": None}
    assert len(client.calls) == 1


def test_not_configured_writes_no_telegram_line():
    db = FakeDB()
    with _with_all([patch.object(notifications, "db", db), patch.object(push, "db", db),
                    patch.object(push, "configured", lambda: False)]):
        result = _run(notifications.notify_admin("order_paid", "T", "B", "/admin/x",
                                                 include_channels=True))
    assert result["telegram"] == {"status": "skipped", "reason": "telegram_not_configured"}
    assert db.alert_log.channels("telegram") == []


def test_push_failure_does_not_block_telegram(monkeypatch):
    _configure(monkeypatch)
    db = FakeDB()
    client, http = _http()
    with _with_all([http, *_push_patch(db, error=RuntimeError("push coupé"))]):
        result = _run(notifications.notify_admin("order_paid", "T", "B", "/admin/x",
                                                 include_channels=True))
    assert (result["status"], result["reason"]) == ("failed", "send_error")
    assert result["telegram"] == {"status": "sent", "reason": None}
    assert len(client.calls) == 1
    assert db.alert_log.channels("telegram")[0]["status"] == "sent"


def test_telegram_failure_does_not_change_the_push_result(monkeypatch):
    _configure(monkeypatch)
    db = FakeDB()
    _, http = _http(response=FakeResponse(status_code=500))
    with _with_all([http, *_push_patch(db)]):
        result = _run(notifications.notify_admin("order_paid", "T", "B", "/admin/x",
                                                 include_channels=True))
    assert (result["status"], result["sent"]) == ("sent", 1)
    assert result["telegram"] == {"status": "failed", "reason": "telegram_http_500"}
    assert db.alert_log.channels("telegram")[0]["status"] == "failed"


def test_replayed_event_sends_one_telegram_message(monkeypatch):
    _configure(monkeypatch)
    db = FakeDB()
    client, http = _http()
    with _with_all([http, *_push_patch(db)]):
        first = _run(notifications.notify_admin("order_paid", "T", "B", "/admin/x",
                                                dedupe_key="paid:MGS-1"))
        second = _run(notifications.notify_admin("order_paid", "T", "B", "/admin/x",
                                                 dedupe_key="paid:MGS-1"))
    assert first["status"] == "sent"
    assert (second["status"], second["reason"]) == ("skipped", "duplicate")
    assert len(client.calls) == 1
    assert len(db.alert_log.channels("telegram")) == 1


def test_pending_telegram_line_is_retried_on_its_own_channel(monkeypatch):
    """Une ligne `pending` Telegram interrompue est reprise par `retry_pending`, sans toucher au Push."""
    _configure(monkeypatch)
    db = FakeDB()
    db.alert_log.docs = [{"_id": "tg1", "event": "order_paid", "channel": "telegram", "status": "pending",
                          "reason": None, "created_at": _now().replace(year=2020), "updated_at": _now(),
                          "attempts": 0, "order_ref": "MGS-1", "dedupe_key": "tg:paid:MGS-1"}]
    client, http = _http()
    with _with_all([http, patch.object(notifications, "db", db),
                    patch.object(push, "configured", lambda: True)]):
        rows = _run(notifications.retry_pending(older_than_s=60))
    assert rows[0]["channel"] == "telegram" and rows[0]["status"] == "sent"
    assert len(client.calls) == 1


# --------------------------------------------------------------------------- #
# Aucune fuite : jeton, chat id, données personnelles
# --------------------------------------------------------------------------- #
def test_no_secret_in_journal_logs_or_http_payloads(monkeypatch, caplog):
    _configure(monkeypatch)
    db = FakeDB()
    _, http = _http(error=httpx.ConnectError(f"échec vers https://api.telegram.org/bot{TOKEN}/sendMessage"))
    with caplog.at_level(logging.DEBUG), _with_all([http, *_push_patch(db)]):
        _run(notifications.notify_admin("order_paid", "T", "B", "/admin/x", dedupe_key="paid:MGS-1"))
    captured = caplog.text + _journal_text(db)
    assert TOKEN not in captured and CHAT_ID not in captured
    assert "ConnectError" in caplog.text  # la catégorie/le type suffisent


def test_no_personal_data_in_telegram_text(monkeypatch):
    _configure(monkeypatch)
    sentinels = {"email": "client-sentinelle@example.invalid", "phone": "+261000000000",
                 "pseudo": "PseudoSentinelle", "pubg_id": "512345678901"}
    db = FakeDB()
    client, http = _http()
    with _with_all([http, *_push_patch(db)]):
        order = {"id": "o1", "order_number": "MGS-ABCDEF", "total": 12000, **sentinels}
        _run(notifications.notify_new_order(order))
    blob = client.calls[0]["json"]["text"] + _journal_text(db)
    for value in sentinels.values():
        assert value not in blob
    assert "MGS-ABCDEF" in client.calls[0]["json"]["text"]


def test_status_route_reports_configuration_without_secret(monkeypatch):
    _configure(monkeypatch)
    db = FakeDB()
    db.alert_log.docs = [{"_id": "a1", "created_at": _now(), "event": "order_paid", "channel": "telegram",
                          "status": "sent", "reason": None}]

    async def admin_ids():
        return {"adm1"}

    with _with_all([patch.object(notifications_router, "db", db),
                    patch.object(push, "configured", lambda: True),
                    patch.object(push, "admin_user_ids", admin_ids)]):
        payload = _run(notifications_router.status(user={"role": "admin"}))
    assert payload["telegram_configured"] is True
    assert set(payload) == {"vapid_configured", "telegram_configured", "push_subscriptions", "alerts"}
    text = json.dumps(payload, default=str)
    assert TOKEN not in text and CHAT_ID not in text


def test_test_route_returns_the_telegram_result(monkeypatch):
    _configure(monkeypatch)
    db = FakeDB()
    _, http = _http()
    with _with_all([http, *_push_patch(db), patch.object(notifications_router, "db", db)]):
        result = _run(notifications_router.test(user={"role": "admin"}))
    assert result["telegram"] == {"status": "sent", "reason": None}
    assert result["event"] == "test"
    text = json.dumps(result, default=str)
    assert TOKEN not in text and CHAT_ID not in text


# --------------------------------------------------------------------------- #
# Script local d'obtention du chat id
# --------------------------------------------------------------------------- #
def _load_script():
    path = BACKEND_DIR / "scripts" / "telegram_get_chat_id.py"
    spec = importlib.util.spec_from_file_location("telegram_get_chat_id", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_chat_id_script_without_token_does_not_print_anything_secret(capsys, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    module = _load_script()
    assert module.main() == 1
    captured = capsys.readouterr()
    assert "TELEGRAM_BOT_TOKEN" in captured.err


def test_chat_id_script_hides_the_token_on_network_error(capsys, monkeypatch):
    module = _load_script()
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)

    def boom(*args, **kwargs):
        raise module.requests.RequestException(
            f"connexion refusée https://api.telegram.org/bot{TOKEN}/getUpdates")

    with patch.object(module.requests, "get", boom):
        assert module.main() == 1
    captured = capsys.readouterr()
    assert TOKEN not in captured.out + captured.err
    assert "RequestException" in captured.err


def test_chat_id_script_prints_only_the_latest_private_chat(capsys, monkeypatch):
    module = _load_script()
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return {"ok": True, "result": [
                {"message": {"chat": {"id": 111, "type": "private"}}},
                {"message": {"chat": {"id": 222, "type": "private"}}},
            ]}

    with patch.object(module.requests, "get", lambda *a, **k: _Response()):
        assert module.main() == 0
    captured = capsys.readouterr()
    assert "222" in captured.out and "111" not in captured.out
    assert TOKEN not in captured.out
    assert re.search(r"chat_id\s*:\s*222", captured.out)
