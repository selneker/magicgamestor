"""PL-BINANCE-2 — fenêtre de recherche des dépôts Binance liée aux paiements ouverts.

Aucun réseau, aucun Mongo, aucune lecture de `backend/.env` : collections simulées et
`deposit_history` remplacé par une fonction locale. Les adresses et montants sont des sentinelles.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from services import binance, binance_watcher, crypto

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)
ADDRESS = "TAddressSentinelle00000000000001"
TX = "TXSENTINELLE0001"


def _run(coro):
    return asyncio.run(coro)


def _iso(delta: timedelta) -> str:
    return (NOW + delta).isoformat()


class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _NoLock:
    """`_lock` du module est lié à une boucle : chaque test tourne dans la sienne."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def _matches(doc, query):
    for key, value in (query or {}).items():
        if key == "$or":
            if not any(_matches(doc, part) for part in value):
                return False
        elif isinstance(value, dict) and "$in" in value:
            if doc.get(key) not in value["$in"]:
                return False
        elif isinstance(value, dict) and "$gte" in value:
            if not (doc.get(key) or "") >= value["$gte"]:
                return False
        elif isinstance(value, dict) and "$lte" in value:
            if not (doc.get(key) or "") <= value["$lte"]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class FakePayments:
    def __init__(self, docs=(), fail=False, fail_oldest=False):
        self.docs = [dict(doc) for doc in docs]
        self.fail = fail
        self.fail_oldest = fail_oldest
        self.confirmations = 0

    def _failure(self, query):
        if self.fail:
            return True
        return self.fail_oldest and isinstance((query or {}).get("status"), dict)

    async def find_one(self, query=None, projection=None, sort=None):
        if self._failure(query):
            raise RuntimeError("mongo indisponible")
        docs = [doc for doc in self.docs if _matches(doc, query)]
        if sort:
            key, direction = sort[0]
            docs.sort(key=lambda doc: doc.get(key) or "", reverse=direction == -1)
        return dict(docs[0]) if docs else None

    def find(self, query=None, projection=None):
        return _Cursor([doc for doc in self.docs if _matches(doc, query)])

    async def update_one(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set") or {})
                return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set") or {})
                self.confirmations += 1
                return dict(doc)
        return None


class FakeUnmatched:
    def __init__(self):
        self.docs = []

    async def find_one(self, query=None, projection=None):
        return next((dict(doc) for doc in self.docs if _matches(doc, query)), None)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class FakeDB:
    def __init__(self, crypto_payments):
        self.crypto_payments = crypto_payments
        self.crypto_unmatched = FakeUnmatched()


def _payment(created: timedelta, expires: timedelta, **extra) -> dict:
    doc = {"id": "pay-sentinelle", "order_id": "order-sentinelle", "order_number": "MGS-SENTINELLE",
           "user_id": None, "network": "TRC20", "binance_network": "TRX", "currency": "USDT",
           "address": ADDRESS, "memo": None, "rate_ar_per_usdt": 4500, "amount_ar": 55517,
           "base_usdt": "12.3400", "amount_usdt": "12.3405", "status": crypto.WAITING, "slot_open": True,
           "tx_hash": None, "deposit_id": None, "created_at": _iso(created), "expires_at": _iso(expires),
           "updated_at": _iso(created), "history": []}
    doc.update(extra)
    return doc


def _deposit(payment: dict, insert_time: datetime, tx: str = TX) -> dict:
    return {"id": "dep-sentinelle", "txId": tx, "coin": "USDT", "network": "TRX",
            "amount": payment["amount_usdt"], "address": payment["address"], "addressTag": "",
            "status": 1, "insertTime": int(insert_time.timestamp() * 1000)}


class _History:
    """Remplace `binance.deposit_history` : capture la borne `start_ms`, ne sort jamais du réseau."""

    def __init__(self, deposits=()):
        self.deposits = list(deposits)
        self.start_ms: int | None = None

    async def __call__(self, start_ms, end_ms=None):
        self.start_ms = start_ms
        return list(self.deposits)


def _ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def _stack(db, history, **extra):
    """`crypto.now` figé sur NOW : les deux bornes et les fenêtres de paiement partagent la même horloge."""
    patchers = [patch.object(binance_watcher, "db", db),
                patch.object(crypto, "now", lambda: NOW),
                patch.object(binance, "configured", lambda: True),
                patch.object(binance, "deposit_history", history),
                patch.object(binance_watcher, "_lock", _NoLock())]
    return patchers + [patch.object(binance_watcher, name, value) for name, value in extra.items()]


def _run_with(patchers, coro):
    for patcher in patchers:
        patcher.start()
    try:
        return _run(coro)
    finally:
        for patcher in reversed(patchers):
            patcher.stop()


# --------------------------------------------------------------------------- #
# Borne de la fenêtre (`search_since`)
# --------------------------------------------------------------------------- #
def test_open_payment_ten_hours_old_widens_window_to_ten_hours():
    db = FakeDB(FakePayments([_payment(timedelta(hours=-10), timedelta(hours=-9, minutes=-30))]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=10)


def test_no_open_payment_keeps_six_hour_lookback():
    db = FakeDB(FakePayments())
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - binance_watcher.LOOKBACK


@pytest.mark.parametrize("closed_status", [crypto.CONFIRMED, crypto.FAILED])
def test_closed_payments_do_not_widen_window(closed_status):
    db = FakeDB(FakePayments([_payment(timedelta(hours=-30), timedelta(hours=-29),
                                      status=closed_status, slot_open=False)]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=6)


def test_window_is_capped_by_default_at_forty_eight_hours(monkeypatch):
    monkeypatch.delenv("BINANCE_LOOKBACK_MAX_H", raising=False)
    db = FakeDB(FakePayments([_payment(timedelta(hours=-72), timedelta(hours=-70))]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=48)


def test_window_cap_is_configurable(monkeypatch):
    monkeypatch.setenv("BINANCE_LOOKBACK_MAX_H", "12")
    db = FakeDB(FakePayments([_payment(timedelta(hours=-30), timedelta(hours=-29))]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=12)


@pytest.mark.parametrize("value,expected_h", [("2", 6), ("0", 10), ("-5", 10), ("abc", 10),
                                              ("nan", 10), ("inf", 10)])
def test_invalid_cap_falls_back_and_never_drops_below_six_hours(monkeypatch, value, expected_h):
    monkeypatch.setenv("BINANCE_LOOKBACK_MAX_H", value)
    db = FakeDB(FakePayments([_payment(timedelta(hours=-10), timedelta(hours=-9))]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=expected_h)


def test_broken_read_falls_back_to_six_hours_without_raising():
    db = FakeDB(FakePayments([_payment(timedelta(hours=-10), timedelta(hours=-9))], fail=True))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=6)


def test_unreadable_created_at_falls_back_to_six_hours():
    payment = _payment(timedelta(hours=-10), timedelta(hours=-9), created_at="pas-une-date")
    db = FakeDB(FakePayments([payment]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=6)


def test_naive_created_at_is_read_as_utc():
    payment = _payment(timedelta(hours=-10), timedelta(hours=-9))
    payment["created_at"] = datetime.fromisoformat(payment["created_at"]).replace(tzinfo=None).isoformat()
    db = FakeDB(FakePayments([payment]))
    patchers = [patch.object(binance_watcher, "db", db)]
    assert _run_with(patchers, binance_watcher.search_since(NOW)) == NOW - timedelta(hours=10)


# --------------------------------------------------------------------------- #
# `check_once` : la borne passée à Binance suit les paiements ouverts
# --------------------------------------------------------------------------- #
def test_check_once_reaches_ten_hours_and_confirms_the_deposit():
    payment = _payment(timedelta(hours=-10), timedelta(hours=-9, minutes=-30))
    db = FakeDB(FakePayments([payment]))
    history = _History([_deposit(payment, insert_time=NOW - timedelta(hours=9, minutes=55))])
    paid = AsyncMock()
    patchers = _stack(db, history, audit=AsyncMock(), on_order_paid=paid)
    patchers.append(patch.object(binance_watcher.notifications, "schedule"))
    patchers.append(patch("routers.payments._set_order_status", AsyncMock(return_value=True)))
    result = _run_with(patchers, binance_watcher.check_once(force=True))
    assert result["ran"] is True
    assert result["results"].get("confirmed") == 1
    assert history.start_ms == _ms(NOW - timedelta(hours=10))
    assert db.crypto_payments.docs[0]["status"] == crypto.CONFIRMED
    assert db.crypto_payments.confirmations == 1
    assert paid.await_count == 1


def test_check_once_uses_six_hours_when_open_payment_query_fails():
    payment = _payment(timedelta(hours=-10), timedelta(hours=1))  # encore ouverte, non expirée
    db = FakeDB(FakePayments([payment], fail_oldest=True))
    history = _History()
    patchers = _stack(db, history, expire_due=AsyncMock())
    result = _run_with(patchers, binance_watcher.check_once(force=True))
    assert result["ran"] is True
    assert history.start_ms == _ms(NOW - timedelta(hours=6))


def test_replayed_deposit_confirms_only_one_order():
    payment = _payment(timedelta(hours=-10), timedelta(hours=-9, minutes=-30))
    db = FakeDB(FakePayments([payment]))
    dep = _deposit(payment, insert_time=NOW - timedelta(hours=9, minutes=55))
    min_ms = _ms(NOW - timedelta(hours=10))
    paid = AsyncMock()
    patchers = [patch.object(crypto, "now", lambda: NOW),
                patch.object(binance_watcher, "db", db),
                patch.object(binance_watcher, "audit", AsyncMock()),
                patch.object(binance_watcher, "on_order_paid", paid),
                patch.object(binance_watcher.notifications, "schedule"),
                patch("routers.payments._set_order_status", AsyncMock(return_value=True))]

    async def scenario():
        first = await binance_watcher.process_deposit(dict(dep), min_ms)
        second = await binance_watcher.process_deposit(dict(dep), min_ms)
        return first, second

    first, second = _run_with(patchers, scenario())
    assert first == "confirmed"
    assert second == "duplicate"
    assert db.crypto_payments.confirmations == 1
    assert paid.await_count == 1
    assert db.crypto_unmatched.docs == []


def test_deposit_before_widened_window_is_still_ignored():
    """Un dépôt antérieur à la borne reste hors fenêtre, même quand celle-ci est élargie."""
    payment = _payment(timedelta(hours=-10), timedelta(hours=-9, minutes=-30))
    db = FakeDB(FakePayments([payment]))
    dep = _deposit(payment, insert_time=NOW - timedelta(hours=11))
    patchers = _stack(db, _History([dep]), expire_due=AsyncMock())
    result = _run_with(patchers, binance_watcher.check_once(force=True))
    assert result["results"].get("ignored") == 1
    assert db.crypto_payments.confirmations == 0
