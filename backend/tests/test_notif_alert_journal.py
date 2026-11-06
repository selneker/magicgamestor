"""PL-NOTIF-1 — journal des alertes admin et envoi unifié (push).

Aucun réseau, aucun Mongo, aucune lecture de `backend/.env` : les collections et le transport Push
sont simulés. Aucune donnée réelle (ni e-mail, ni pseudo, ni identifiant de joueur) n'est utilisée.
"""
import asyncio
import inspect
import json
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.routing import APIRoute
from pymongo.errors import DuplicateKeyError
from requests.exceptions import Timeout
from starlette.background import BackgroundTasks
from starlette.requests import Request
from pywebpush import WebPushException

from core.security import require_admin
from routers import chat as chat_router
from routers import notifications as notifications_router
from routers import orders as orders_router
from services import notifications, push


def _run(coro):
    return asyncio.run(coro)


def _now():
    return datetime.now(timezone.utc)


class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        if isinstance(key, str):
            self._docs.sort(key=lambda d: d.get(key), reverse=direction == -1)
        return self

    def limit(self, count):
        self._docs = self._docs[:count]
        return self

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration

    async def to_list(self, length=None):
        return self._docs if length is None else self._docs[:length]


def _matches(doc, query):
    for key, value in (query or {}).items():
        if isinstance(value, dict) and "$lte" in value:
            if not doc.get(key) <= value["$lte"]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class FakeAlertLog:
    """Journal Mongo simulé : dédup (event, dedupe_key) comme l'index unique partiel."""

    def __init__(self, fail_insert=False):
        self.docs = []
        self.fail_insert = fail_insert

    async def insert_one(self, doc):
        if self.fail_insert:
            raise RuntimeError("journal indisponible")
        key = doc.get("dedupe_key")
        if key is not None and any(d["event"] == doc["event"] and d.get("dedupe_key") == key for d in self.docs):
            raise DuplicateKeyError("dedupe")
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if doc["_id"] == query["_id"]:
                doc.update(update["$set"])

    def find(self, query=None, projection=None):
        docs = [d for d in self.docs if _matches(d, query)]
        if projection:
            docs = [{k: d.get(k) for k, keep in projection.items() if keep} for d in docs]
        return _Cursor(docs)

    def by_status(self, status):
        return [d for d in self.docs if d["status"] == status]


class FakeSubs:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    def find(self, query=None):
        return _Cursor([d for d in self.docs if _matches(d, query)])

    async def delete_one(self, query):
        self.docs = [d for d in self.docs if d["_id"] != query["_id"]]

    async def count_documents(self, query):
        return len([d for d in self.docs if _matches(d, query)])


class FakeUsers:
    def __init__(self, admin_ids=()):
        self.admin_ids = set(admin_ids)

    async def find_one(self, query, *args, **kwargs):
        if query.get("role") == "admin" and query.get("user_id") in self.admin_ids:
            return {"_id": "u"}
        return None


class FakeDB:
    def __init__(self, subs=(), admins=(), fail_journal=False):
        self.push_subscriptions = FakeSubs(subs)
        self.users = FakeUsers(admins)
        self.alert_log = FakeAlertLog(fail_insert=fail_journal)


def _sub(sid, user_id, endpoint="https://fcm.googleapis.com/fcm/send/x"):
    return {"_id": sid, "user_id": user_id, "endpoint": endpoint,
            "keys": {"p256dh": "k", "auth": "a"}, "updated_at": "2026-01-01T00:00:00Z"}


class _Response:
    def __init__(self, status_code):
        self.status_code = status_code


def _webpush_error(status_code):
    return WebPushException("push failed", response=_Response(status_code))


def _patched(db, send=None):
    """Patch commun : base simulée des deux côtés, VAPID configuré, transport Push simulé."""
    stack = [patch.object(push, "db", db), patch.object(notifications, "db", db),
             patch.object(push, "configured", lambda: True)]
    if send is not None:
        stack.append(patch.object(push, "_send", send))
    return stack


def _with(stack):
    for patcher in stack:
        patcher.start()


def _stop(stack):
    for patcher in reversed(stack):
        patcher.stop()


# --------------------------------------------------------------------------- #
# Envoi : succès, abonnements morts, erreurs, configuration absente
# --------------------------------------------------------------------------- #
def test_success_is_journaled_sent_with_counters():
    db = FakeDB(subs=[_sub("s1", "adm1"), _sub("s2", "adm1"), _sub("s3", "cust1")], admins=["adm1"])
    sent = []
    stack = _patched(db, send=lambda sub, payload: sent.append(payload))
    _with(stack)
    try:
        result = _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes",
                                                 dedupe_key="order:MGS-AAA", order_ref="MGS-AAA"))
    finally:
        _stop(stack)
    assert result["status"] == "sent" and result["reason"] is None
    assert (result["targeted"], result["sent"], result["removed"], result["failed"]) == (2, 2, 0, 0)
    assert len(sent) == 2
    row = db.alert_log.docs[0]
    assert (row["event"], row["channel"], row["status"], row["reason"]) == ("order_created", "push", "sent", None)
    assert row["order_ref"] == "MGS-AAA" and row["attempts"] == 1
    # L'abonnement d'un compte non admin est nettoyé, comme avant.
    assert [s["_id"] for s in db.push_subscriptions.docs] == ["s1", "s2"]


def test_gone_subscription_is_removed_and_journaled():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])

    def gone(*args, **kwargs):
        raise _webpush_error(410)

    stack = _patched(db, send=gone)
    _with(stack)
    try:
        result = _run(notifications.notify_admin("chat_message", "T", "B", "/admin/messages"))
    finally:
        _stop(stack)
    assert result["status"] == "failed" and result["reason"] == "subscription_gone"
    assert result["removed"] == 1 and result["sent"] == 0
    assert db.push_subscriptions.docs == []
    assert db.alert_log.docs[0]["reason"] == "subscription_gone"


def test_server_error_keeps_subscription_and_journals_failure():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])

    def boom(*args, **kwargs):
        raise _webpush_error(500)

    stack = _patched(db, send=boom)
    _with(stack)
    try:
        result = _run(notifications.notify_admin("test", "T", "B", "/admin/commandes"))
    finally:
        _stop(stack)
    assert (result["status"], result["reason"]) == ("failed", "send_error")
    assert [s["_id"] for s in db.push_subscriptions.docs] == ["s1"]  # conservé
    assert db.alert_log.docs[0]["status"] == "failed"


def test_timeout_keeps_subscription_and_is_distinguished():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])

    def slow(*args, **kwargs):
        raise Timeout("trop lent")

    stack = _patched(db, send=slow)
    _with(stack)
    try:
        result = _run(notifications.notify_admin("test", "T", "B", "/admin/commandes"))
    finally:
        _stop(stack)
    assert (result["status"], result["reason"]) == ("failed", "timeout")
    assert [s["_id"] for s in db.push_subscriptions.docs] == ["s1"]


def test_vapid_missing_is_skipped_and_visible():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    with patch.object(push, "db", db), patch.object(notifications, "db", db), \
         patch.object(push, "configured", lambda: False), \
         patch.object(push, "_send", lambda *a, **k: pytest.fail("aucun envoi sans VAPID")):
        result = _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes"))
    assert (result["status"], result["reason"]) == ("skipped", "vapid_not_configured")
    assert db.alert_log.docs[0]["status"] == "skipped"
    assert db.alert_log.docs[0]["reason"] == "vapid_not_configured"


def test_no_subscription_is_skipped():
    db = FakeDB()
    stack = _patched(db)
    _with(stack)
    try:
        result = _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes"))
    finally:
        _stop(stack)
    assert (result["status"], result["reason"]) == ("skipped", "no_subscription")
    assert db.alert_log.docs[0]["reason"] == "no_subscription"


# --------------------------------------------------------------------------- #
# Déduplication, écriture « pending » d'abord, reprise
# --------------------------------------------------------------------------- #
def test_same_dedupe_key_sends_once():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    sent = []
    stack = _patched(db, send=lambda sub, payload: sent.append(payload))
    _with(stack)
    try:
        first = _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes",
                                                dedupe_key="order:MGS-AAA"))
        second = _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes",
                                                 dedupe_key="order:MGS-AAA"))
    finally:
        _stop(stack)
    assert first["status"] == "sent"
    assert (second["status"], second["reason"]) == ("skipped", "duplicate")
    assert len(sent) == 1 and len(db.alert_log.docs) == 1


def test_pending_row_is_written_before_sending_and_survives_a_crash():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    seen = {}

    class _Crash(BaseException):
        """Coupure du processus : même `notify_admin` ne peut pas la convertir en échec."""

    async def inspecting_dispatch(payload):
        seen["statuses"] = [d["status"] for d in db.alert_log.docs]
        raise _Crash()

    with patch.object(push, "db", db), patch.object(notifications, "db", db), \
         patch.object(push, "configured", lambda: True), \
         patch.object(push, "dispatch_to_admins", inspecting_dispatch):
        with pytest.raises(_Crash):
            _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes"))
    assert seen["statuses"] == ["pending"]
    assert [d["status"] for d in db.alert_log.docs] == ["pending"]


def test_retry_pending_resends_old_rows_once():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    old = _now() - timedelta(minutes=5)
    recent = _now()
    db.alert_log.docs = [
        {"_id": "old", "event": "order_created", "channel": "push", "status": "pending", "reason": None,
         "created_at": old, "updated_at": old, "attempts": 0, "order_ref": "MGS-AAA", "dedupe_key": "order:MGS-AAA"},
        {"_id": "recent", "event": "order_created", "channel": "push", "status": "pending", "reason": None,
         "created_at": recent, "updated_at": recent, "attempts": 0, "order_ref": "MGS-BBB", "dedupe_key": "order:MGS-BBB"},
    ]
    sent = []
    stack = _patched(db, send=lambda sub, payload: sent.append(payload))
    _with(stack)
    try:
        first = _run(notifications.retry_pending(older_than_s=60))
        second = _run(notifications.retry_pending(older_than_s=60))
    finally:
        _stop(stack)
    assert [r["id"] for r in first] == ["old"]
    assert second == []  # déjà reprise : aucune 2e livraison
    assert len(sent) == 1 and len(db.alert_log.docs) == 2  # aucune ligne en double
    rows = {d["_id"]: d for d in db.alert_log.docs}
    assert rows["old"]["status"] == "sent" and rows["old"]["attempts"] == 1
    assert rows["recent"]["status"] == "pending"


def test_retry_pending_skips_unknown_event():
    db = FakeDB()
    db.alert_log.docs = [{"_id": "x", "event": "inconnu", "channel": "push", "status": "pending",
                          "created_at": _now() - timedelta(hours=1)}]
    stack = _patched(db)
    _with(stack)
    try:
        result = _run(notifications.retry_pending(older_than_s=60))
    finally:
        _stop(stack)
    assert result[0]["status"] == "skipped" and result[0]["reason"] == "unknown_event"


# --------------------------------------------------------------------------- #
# Jamais d'exception : journal ni transport ne peuvent changer l'issue de l'appelant
# --------------------------------------------------------------------------- #
def test_notify_admin_never_raises_when_journal_and_dispatch_fail():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"], fail_journal=True)

    async def broken(payload):
        raise RuntimeError("réseau coupé")

    with patch.object(push, "db", db), patch.object(notifications, "db", db), \
         patch.object(push, "configured", lambda: True), \
         patch.object(push, "dispatch_to_admins", broken):
        result = _run(notifications.notify_admin("order_created", "T", "B", "/admin/commandes"))
    assert (result["status"], result["reason"]) == ("failed", "send_error")


def test_alert_payloads_and_journal_hold_no_customer_data():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    payloads = []
    stack = _patched(db, send=lambda sub, payload: payloads.append(payload))
    _with(stack)
    try:
        order = {"id": "o1", "order_number": "MGS-ABCDEF", "total": 12000}
        _run(notifications.notify_new_order(order))
        _run(notifications.notify_new_message("c1", "NomClient", "Bonjour, mon numéro est 0340000000"))
    finally:
        _stop(stack)
    assert payloads[0]["body"] == "Nouvelle commande MGS-ABCDEF\n12 000 Ar"
    assert payloads[0]["url"] == "/admin/commandes?order=o1" and payloads[0]["tag"] == "o1"
    assert "NomClient" in payloads[1]["body"] and payloads[1]["tag"] == "chat-c1"
    journal = json.dumps(db.alert_log.docs, default=str)
    for secret in ("NomClient", "0340000000", "Bonjour", "o1"):
        assert secret not in journal  # seuls event/canal/état/compteurs/références sont stockés
    assert [d["order_ref"] for d in db.alert_log.docs] == ["MGS-ABCDEF", None]


def test_repeated_chat_messages_are_all_sent():
    """Un message n'est pas une commande : deux messages de la même conversation = deux alertes."""
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    sent = []
    stack = _patched(db, send=lambda sub, payload: sent.append(payload))
    _with(stack)
    try:
        _run(notifications.notify_new_message("c1", "NomClient", "un"))
        _run(notifications.notify_new_message("c1", "NomClient", "deux"))
    finally:
        _stop(stack)
    assert len(sent) == 2 and len(db.alert_log.docs) == 2


# --------------------------------------------------------------------------- #
# Routes « création de commande » et « message client » : échec d'alerte injecté
# --------------------------------------------------------------------------- #
class _ChatDB:
    def __init__(self, conversation):
        self.chat_conversations = _Conversations(conversation)
        self.chat_messages = _Messages()

    def __getattr__(self, name):  # alert_log / push_subscriptions / users fournis par FakeDB
        raise AttributeError(name)


class _Conversations:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, query, *args, **kwargs):
        return self.doc if query.get("_id") == self.doc["_id"] else None

    async def update_one(self, query, update):
        self.doc.update(update.get("$set") or {})


class _Messages:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


def test_chat_route_result_unchanged_when_alert_fails():
    conversation = {"_id": "c1", "user_id": "u1", "user_name": "NomClient", "user_email": "client@test.mg",
                    "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z", "last_message": ""}
    db = _ChatDB(conversation)
    db.alert_log = FakeAlertLog(fail_insert=True)
    tasks = BackgroundTasks()
    user = {"user_id": "u1", "email": "client@test.mg", "role": "customer"}

    async def broken(payload):
        await asyncio.sleep(0.2)  # alerte lente : ne doit pas retarder la réponse
        raise RuntimeError("réseau coupé")

    with patch.object(chat_router, "db", db), patch.object(push, "db", db), \
         patch.object(notifications, "db", db), patch.object(push, "configured", lambda: True), \
         patch.object(push, "dispatch_to_admins", broken):
        started = time.perf_counter()
        message = _run(chat_router.send_message("c1", chat_router.MessageIn(text="  hello  "), tasks, user))
        elapsed = time.perf_counter() - started
        before = [dict(d) for d in db.chat_messages.docs]
        _run(tasks())  # la tâche de fond s'exécute APRÈS la réponse

    assert elapsed < 0.1  # l'alerte n'est pas attendue par la route
    assert message["text"] == "hello"
    assert db.chat_messages.docs == before  # le message enregistré n'est pas retouché par l'alerte
    assert len(tasks.tasks) == 1


class _OrdersDB:
    def __init__(self, product, inserted):
        self.games = _Static({"find_one": {"id": "pubg-mobile"}})
        self.products = _Products(product)
        self.orders = _Orders(inserted)


class _Static:
    def __init__(self, results):
        self.results = results

    async def find_one(self, *args, **kwargs):
        return self.results["find_one"]


class _Products:
    def __init__(self, product):
        self.product = product

    def find(self, query, projection=None):
        return _Cursor([self.product])

    async def find_one(self, query, projection=None):
        return self.product


class _Orders:
    def __init__(self, sink):
        self.sink = sink

    async def insert_one(self, doc):
        self.sink.append(dict(doc))


def test_order_route_result_unchanged_when_alert_fails():
    product = {"id": "p1", "slug": "uc-60", "name": "60 UC", "type": "uc", "price": 1000,
               "active": True, "game_id": "pubg-mobile"}
    inserted = []
    db = _OrdersDB(product, inserted)
    db.alert_log = FakeAlertLog(fail_insert=True)
    tasks = BackgroundTasks()
    request = Request({"type": "http", "method": "POST", "path": "/api/orders", "headers": [],
                       "client": ("127.0.0.1", 1234)})
    body = orders_router.OrderIn(pubg_id="51234567890", pseudo="Testeur",
                                 items=[orders_router.OrderItemIn(product_id="p1", quantity=1)],
                                 payment_method="manual", manual_reference="REF-1")

    async def broken(payload):
        raise RuntimeError("réseau coupé")

    with patch.object(orders_router, "db", db), patch.object(push, "db", db), \
         patch.object(notifications, "db", db), patch.object(push, "configured", lambda: True), \
         patch.object(push, "dispatch_to_admins", broken), \
         patch.object(orders_router.ratelimit, "client_ip", lambda request: "127.0.0.1"), \
         patch.object(orders_router.ratelimit, "check", lambda *a, **k: None), \
         patch.object(orders_router.ratelimit, "setting", lambda *a, **k: 100), \
         patch.object(orders_router, "game_sale_path_ready", AsyncMock(return_value=(True, ""))), \
         patch.object(orders_router, "_identity_snapshot",
                      AsyncMock(return_value={"source": "checkout", "game_id": "pubg-mobile",
                                              "fields": {"player_id": "51234567890"},
                                              "player_name": "Testeur", "validated": False,
                                              "captured_at": "2026-01-01T00:00:00Z"})), \
         patch.object(orders_router, "purchase_blocked", lambda product: None), \
         patch("services.fees.calculate_payment_fee", AsyncMock(return_value=0)):
        order = _run(orders_router.create_order(body, tasks, request, user=None))
        stored = [dict(d) for d in inserted]
        _run(tasks())

    assert order["status"] == "awaiting_verification"  # paiement manuel : statut historique inchangé
    assert order["total"] == 1000
    assert order["items"][0]["name"] == "60 UC"
    assert inserted == stored  # la commande enregistrée n'est pas modifiée par l'alerte
    assert len(tasks.tasks) == 1  # alerte planifiée, jamais exécutée avant la réponse


# --------------------------------------------------------------------------- #
# Routes admin : protection et absence de secret
# --------------------------------------------------------------------------- #
def test_admin_notification_routes_require_admin():
    routes = {route.path: route for route in notifications_router.router.routes if isinstance(route, APIRoute)}
    assert set(routes) == {"/admin/notifications/status", "/admin/notifications/test"}
    for route in routes.values():
        assert require_admin in [dep.call for dep in route.dependant.dependencies]


def test_status_route_returns_no_secret():
    db = FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"])
    db.alert_log.docs = [{"_id": "a1", "created_at": _now(), "event": "order_created", "channel": "push",
                          "status": "sent", "reason": None, "order_ref": "MGS-AAA"}]
    with patch.object(notifications_router, "db", db), patch.object(push, "configured", lambda: True):
        payload = _run(notifications_router.status(user={"role": "admin"}))
    assert set(payload) == {"vapid_configured", "push_subscriptions", "alerts"}
    assert payload["vapid_configured"] is True
    assert payload["push_subscriptions"] == 1
    assert len(payload["alerts"]) == 1
    assert set(payload["alerts"][0]) == {"_id", "created_at", "event", "channel", "status", "reason"}
    text = json.dumps(payload, default=str)
    for secret in ("VAPID_PRIVATE", "VAPID_PUBLIC", "p256dh", "MGS-AAA", "adm1"):
        assert secret not in text


def test_test_route_uses_the_same_path_and_returns_details():
    db = FakeDB()
    stack = _patched(db)
    _with(stack)
    try:
        with patch.object(notifications_router, "db", db):
            result = _run(notifications_router.test(user={"role": "admin"}))
    finally:
        _stop(stack)
    assert result["event"] == "test"
    assert set(result) == {"id", "event", "channel", "status", "reason", "targeted", "sent", "removed", "failed"}
    assert (result["status"], result["reason"]) == ("skipped", "no_subscription")


# --------------------------------------------------------------------------- #
# Réglages d'envoi et index du journal
# --------------------------------------------------------------------------- #
def test_push_settings_defaults_and_override(monkeypatch):
    for name in ("PUSH_TTL_S", "PUSH_URGENCY", "PUSH_TIMEOUT_S"):
        monkeypatch.delenv(name, raising=False)
    assert push.ttl_seconds() == 86400
    assert push.urgency() == "high"
    assert push.timeout_seconds() == 10.0
    monkeypatch.setenv("PUSH_TTL_S", "7200")
    monkeypatch.setenv("PUSH_URGENCY", "normal")
    monkeypatch.setenv("PUSH_TIMEOUT_S", "3")
    assert push.ttl_seconds() == 7200
    assert push.urgency() == "normal"
    assert push.timeout_seconds() == 3.0
    monkeypatch.setenv("PUSH_TTL_S", "n'importe quoi")
    monkeypatch.setenv("PUSH_TIMEOUT_S", "x")
    assert push.ttl_seconds() == 86400
    assert push.timeout_seconds() == 10.0


def test_urgency_header_and_ttl_are_passed_to_pywebpush():
    """pywebpush 2.5.0 n'a pas de paramètre `urgency` : il part par `headers` (vérifié dans la lib)."""
    captured = {}

    class _Sub:
        endpoint = "https://fcm.googleapis.com/fcm/send/x"
        keys = {"p256dh": "k", "auth": "a"}

    def fake_webpush(**kwargs):
        captured.update(kwargs)

    with patch.object(push, "webpush", fake_webpush), \
         patch.object(push, "_vapid", lambda: "vapid"), \
         patch.dict("os.environ", {"VAPID_SUBJECT": "mailto:admin@test.mg"}):
        push._send(_Sub(), {"title": "T"})
    assert captured["headers"] == {"urgency": "high"}
    assert captured["ttl"] == 86400
    assert captured["timeout"] == 10.0


def test_alert_log_ttl_seconds_default_and_bounds(monkeypatch):
    monkeypatch.delenv("ALERT_LOG_TTL_DAYS", raising=False)
    assert notifications.alert_log_ttl_seconds() == 30 * 86400
    monkeypatch.setenv("ALERT_LOG_TTL_DAYS", "7")
    assert notifications.alert_log_ttl_seconds() == 7 * 86400
    monkeypatch.setenv("ALERT_LOG_TTL_DAYS", "0")
    assert notifications.alert_log_ttl_seconds() == 86400
    monkeypatch.setenv("ALERT_LOG_TTL_DAYS", "bogus")
    assert notifications.alert_log_ttl_seconds() == 30 * 86400


class _IndexRecorder:
    def __init__(self, name):
        self.name = name
        self.created = []

    async def create_index(self, keys, **kwargs):
        self.created.append((keys, kwargs))
        return "idx"

    async def index_information(self):
        return {}


class _IndexDB:
    def __init__(self):
        self.collections = {}

    def __getattr__(self, name):
        return self.collections.setdefault(name, _IndexRecorder(name))


def test_ensure_indexes_creates_alert_log_ttl_and_dedupe():
    import core.db as core_db

    fake = _IndexDB()
    with patch.object(core_db, "db", fake), \
         patch("core.identity_keys.ensure_lock_indexes", AsyncMock()):
        _run(core_db.ensure_indexes())
    created = fake.collections["alert_log"].created
    assert (("created_at", {"expireAfterSeconds": 30 * 86400, "name": "alert_log_ttl"}) in created)
    dedupe = [kw for keys, kw in created if keys == [("event", 1), ("dedupe_key", 1)]]
    assert dedupe and dedupe[0]["unique"] is True
    assert dedupe[0]["partialFilterExpression"] == {"dedupe_key": {"$type": "string"}}


def test_alert_journal_module_has_no_network_or_secret_reads():
    source = inspect.getsource(notifications)
    assert "requests" not in source and "webpush(" not in source
    assert "os.environ" in source  # seul ALERT_LOG_TTL_DAYS est lu
    assert "ALERT_LOG_TTL_DAYS" in source
