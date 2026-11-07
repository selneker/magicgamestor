"""PL-NOTIF-4 — relance des commandes payées non traitées.

Aucun réseau, aucun Mongo, aucune lecture de `backend/.env` : commandes, journal et transport Push
sont simulés. Les identités et coordonnées utilisées sont des sentinelles, jamais des données réelles.
"""
import asyncio
import json
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from starlette.requests import Request

from routers import reminders as reminders_router
from services import notifications, push, reminders

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _reminder_env(monkeypatch):
    monkeypatch.setenv("REMINDER_AFTER_MIN", "10")
    monkeypatch.setenv("REMINDER_MAX", "3")
    monkeypatch.setenv("REMINDER_BATCH", "200")


# --------------------------------------------------------------------------- #
# Faux Mongo / faux Push (formes minimales utilisées par le module)
# --------------------------------------------------------------------------- #
class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, key, direction=1):
        self.docs.sort(key=lambda doc: doc.get(key), reverse=direction == -1)
        return self

    def limit(self, count):
        self.docs = self.docs[:count]
        return self

    def __aiter__(self):
        self._iter = iter(self.docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


def _matches(doc, query):
    for key, value in (query or {}).items():
        if key == "$or":
            if not any(_matches(doc, part) for part in value):
                return False
        elif isinstance(value, dict) and "$exists" in value:
            if (key in doc) is not value["$exists"]:
                return False
        elif isinstance(value, dict) and "$lt" in value:
            if key in doc and not doc[key] < value["$lt"]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class FakeOrders:
    def __init__(self, docs=()):
        self.docs = list(docs)

    def find(self, query=None, projection=None):
        # Projection volontairement ignorée : le test « aucune donnée personnelle » doit tenir
        # même si le document complet fuit jusqu'au module.
        return _Cursor([doc for doc in self.docs if _matches(doc, query)])

    async def update_one(self, query, update):
        for doc in self.docs:
            if not _matches(doc, query):
                continue
            doc.update(update.get("$set") or {})
            for key, value in (update.get("$max") or {}).items():
                doc[key] = max(doc.get(key, value), value)
            return


class FakeAlertLog:
    """Journal avec la même contrainte unique (event, dedupe_key) que l'index Mongo."""

    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        key = doc.get("dedupe_key")
        if key is not None and any(d["event"] == doc["event"] and d.get("dedupe_key") == key
                                   for d in self.docs):
            raise DuplicateKeyError("dedupe")
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if doc["_id"] == query["_id"]:
                doc.update(update.get("$set") or {})
                return


class FakeSubs:
    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]

    def find(self, query=None):
        return _Cursor(self.docs)

    async def delete_one(self, query):
        self.docs = [d for d in self.docs if d["_id"] != query["_id"]]

    async def count_documents(self, query):
        return len(self.docs)


class FakeUsers:
    def __init__(self, roles=None):
        self.roles = dict(roles or {"adm1": "admin"})

    def find(self, query=None, projection=None):
        wanted = ((query or {}).get("role") or {}).get("$in") or []
        return _Cursor([{"user_id": uid} for uid, role in self.roles.items() if role in wanted])


class FakeDB:
    def __init__(self, orders=(), roles=None):
        self.orders = FakeOrders(orders)
        self.alert_log = FakeAlertLog()
        self.push_subscriptions = FakeSubs([_sub("s1", "adm1")])
        self.users = FakeUsers(roles)


def _sub(sid, user_id):
    return {"_id": sid, "user_id": user_id, "endpoint": "https://fcm.googleapis.com/fcm/send/x",
            "keys": {"p256dh": "k", "auth": "a"}, "updated_at": "2026-01-01T00:00:00Z"}


def _patchers(db, sent, send=None):
    return [
        patch.object(reminders, "db", db),
        patch.object(notifications, "db", db),
        patch.object(push, "db", db),
        patch.object(push, "configured", lambda: True),
        patch.object(push, "_send", send or (lambda sub, payload: sent.append(payload))),
    ]


def _boom(*args, **kwargs):
    raise RuntimeError("transport coupé")


def _order(order_id="o1", ref="MGS-001", status="paid", age_min=12, paid_at=True, **extra):
    since = NOW - timedelta(minutes=age_min)
    doc = {
        "id": order_id, "order_number": ref, "status": status,
        "items": [{"name": "Diamants 660"}], "total": 25000, "currency": "Ar",
        "created_at": since - timedelta(minutes=5), "updated_at": since,
        "history": [{"status": "created", "at": (since - timedelta(minutes=5)).isoformat()},
                    {"status": "paid", "at": since.isoformat()}],
    }
    if paid_at:
        doc["paid_at"] = since.isoformat()
    doc.update(extra)
    return doc


def _request(token=None):
    headers = [] if token is None else [(b"x-cron-token", token.encode())]
    return Request({"type": "http", "method": "POST", "path": "/api/internal/reminders/run",
                    "headers": headers, "client": ("127.0.0.1", 1234)})


def _keys(db):
    return [row["dedupe_key"] for row in db.alert_log.docs]


# --------------------------------------------------------------------------- #
# Route : jeton
# --------------------------------------------------------------------------- #
def test_route_is_disabled_without_configured_token(monkeypatch):
    monkeypatch.delenv("CRON_TOKEN", raising=False)
    with pytest.raises(HTTPException) as exc:
        _run(reminders_router.run(_request("quelconque")))
    assert exc.value.status_code == 503


@pytest.mark.parametrize("token", [None, "", "mauvais-jeton"])
def test_route_rejects_missing_or_wrong_token(monkeypatch, token):
    monkeypatch.setenv("CRON_TOKEN", "sentinelle-jeton")
    with pytest.raises(HTTPException) as exc:
        _run(reminders_router.run(_request(token)))
    assert exc.value.status_code == 401
    assert "sentinelle-jeton" not in str(exc.value.detail)


def test_route_runs_with_good_token_and_returns_only_counters(monkeypatch):
    monkeypatch.setenv("CRON_TOKEN", "sentinelle-jeton")
    result = {"checked": 3, "reminded": 1, "skipped": 2}
    with patch.object(reminders, "run_once", AsyncMock(return_value=result)):
        payload = _run(reminders_router.run(_request("sentinelle-jeton")))
    assert payload == result
    assert set(payload) == {"checked", "reminded", "skipped"}


# --------------------------------------------------------------------------- #
# Critère « à relancer »
# --------------------------------------------------------------------------- #
def test_no_candidate_returns_zero_counters():
    db = FakeDB()
    with ExitStack() as stack:
        for patcher in _patchers(db, []):
            stack.enter_context(patcher)
        counts = _run(reminders.run_once(now=NOW))
    assert counts == {"checked": 0, "reminded": 0, "skipped": 0}
    assert db.alert_log.docs == []


def test_recent_paid_order_is_not_reminded():
    db = FakeDB([_order(age_min=5)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        counts = _run(reminders.run_once(now=NOW))
    assert counts == {"checked": 1, "reminded": 0, "skipped": 1}
    assert sent == [] and db.alert_log.docs == []


@pytest.mark.parametrize("status", ["delivered", "cancelled", "failed", "expired", "pending_payment"])
def test_orders_outside_paid_are_never_reminded(status):
    db = FakeDB([_order(status=status, age_min=500)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        counts = _run(reminders.run_once(now=NOW))
    assert counts == {"checked": 0, "reminded": 0, "skipped": 0}
    assert sent == []


def test_old_paid_order_is_reminded_once_at_tier_one():
    db = FakeDB([_order(age_min=12)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        counts = _run(reminders.run_once(now=NOW))
    assert counts == {"checked": 1, "reminded": 1, "skipped": 0}
    assert len(sent) == 1
    assert _keys(db) == ["remind:MGS-001:1"]
    body = sent[0]["body"]
    assert "MGS-001" in body and "12 min" in body and "25 000 Ar" in body


def test_second_immediate_run_does_not_repeat_tier_one():
    db = FakeDB([_order(age_min=12)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        first = _run(reminders.run_once(now=NOW))
        second = _run(reminders.run_once(now=NOW))
    assert first["reminded"] == 1
    assert second == {"checked": 1, "reminded": 0, "skipped": 1}
    assert len(sent) == 1
    assert _keys(db) == ["remind:MGS-001:1"]


def test_tier_two_when_time_has_passed():
    db = FakeDB([_order(age_min=12)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        _run(reminders.run_once(now=NOW))
        later = _run(reminders.run_once(now=NOW + timedelta(minutes=25)))
    assert later["reminded"] == 1
    assert len(sent) == 2
    assert _keys(db) == ["remind:MGS-001:1", "remind:MGS-001:2"]


def test_max_tiers_is_respected():
    db = FakeDB([_order(age_min=200)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        first = _run(reminders.run_once(now=NOW))
        second = _run(reminders.run_once(now=NOW + timedelta(minutes=1000)))
    assert first["reminded"] == 1 and second == {"checked": 0, "reminded": 0, "skipped": 0}
    assert _keys(db) == ["remind:MGS-001:3"]
    assert len(sent) == 1


def test_scan_advances_past_exhausted_orders(monkeypatch):
    """Une commande au dernier palier ne doit pas masquer les suivantes (limite par exécution)."""
    monkeypatch.setenv("REMINDER_BATCH", "1")
    db = FakeDB([
        _order("o1", "MGS-001", age_min=200, created_at=NOW - timedelta(minutes=300)),
        _order("o2", "MGS-002", age_min=200, created_at=NOW - timedelta(minutes=290)),
    ])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        first = _run(reminders.run_once(now=NOW))
        second = _run(reminders.run_once(now=NOW))
    assert (first["checked"], first["reminded"]) == (1, 1)
    assert (second["checked"], second["reminded"]) == (1, 1)
    assert _keys(db) == ["remind:MGS-001:3", "remind:MGS-002:3"]


def test_reminder_max_can_lower_the_cap(monkeypatch):
    monkeypatch.setenv("REMINDER_MAX", "1")
    db = FakeDB([_order(age_min=500)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        _run(reminders.run_once(now=NOW))
    assert _keys(db) == ["remind:MGS-001:1"]


def test_manual_admin_paid_uses_history_timestamp():
    db = FakeDB([_order(age_min=40, paid_at=False)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        counts = _run(reminders.run_once(now=NOW))
    assert counts["reminded"] == 1
    assert _keys(db) == ["remind:MGS-001:2"]


def test_order_processed_between_runs_stops_being_reminded():
    order = _order(age_min=12)
    db = FakeDB([order])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        _run(reminders.run_once(now=NOW))
        order["status"] = "delivered"
        later = _run(reminders.run_once(now=NOW + timedelta(minutes=25)))
    assert later == {"checked": 0, "reminded": 0, "skipped": 0}
    assert len(sent) == 1


def test_batch_limit_bounds_the_scan(monkeypatch):
    monkeypatch.setenv("REMINDER_BATCH", "1")
    db = FakeDB([_order("o1", "MGS-001", age_min=12), _order("o2", "MGS-002", age_min=12)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        counts = _run(reminders.run_once(now=NOW))
    assert counts["checked"] == 1
    assert len(sent) == 1


# --------------------------------------------------------------------------- #
# Données, panne et concurrence
# --------------------------------------------------------------------------- #
def test_no_personal_data_in_push_or_journal():
    sentinels = {
        "email": "client-sentinelle@example.invalid",
        "pseudo": "PseudoSentinelle",
        "pubg_id": "512345678901",
        "payment_phone": "+261000000000",
    }
    db = FakeDB([_order(age_min=12, **sentinels)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        _run(reminders.run_once(now=NOW))
    blob = json.dumps({"push": sent, "journal": db.alert_log.docs}, default=str)
    for value in sentinels.values():
        assert value not in blob
    assert "MGS-001" in blob


def test_push_failure_still_returns_200_with_coherent_counters(monkeypatch):
    monkeypatch.setenv("CRON_TOKEN", "sentinelle-jeton")
    db = FakeDB([_order(age_min=12)])
    with ExitStack() as stack:
        for patcher in _patchers(db, [], send=_boom):
            stack.enter_context(patcher)
        payload = _run(reminders_router.run(_request("sentinelle-jeton")))
    assert payload == {"checked": 1, "reminded": 0, "skipped": 1}
    assert len(db.alert_log.docs) == 1  # la tentative reste tracée, en échec


def test_vapid_not_configured_skips_without_consuming_the_tier():
    db = FakeDB([_order(age_min=12)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)
        stack.enter_context(patch.object(push, "configured", lambda: False))
        counts = _run(reminders.run_once(now=NOW))
    assert counts == {"checked": 0, "reminded": 0, "skipped": 0}
    assert sent == [] and db.alert_log.docs == []


def test_two_concurrent_runs_send_a_tier_once():
    db = FakeDB([_order(age_min=12)])
    sent = []
    with ExitStack() as stack:
        for patcher in _patchers(db, sent):
            stack.enter_context(patcher)

        async def both():
            return await asyncio.gather(reminders.run_once(now=NOW), reminders.run_once(now=NOW))

        results = _run(both())
    assert sum(result["reminded"] for result in results) == 1
    assert sum(result["skipped"] for result in results) == 1
    assert len(sent) == 1
    assert _keys(db) == ["remind:MGS-001:1"]
