"""PL-NOTIF-3 — alertes admin des événements critiques (paiement, livraison, crypto).

Aucun réseau, aucun Mongo, aucune lecture de `backend/.env` : collections, journal et transport
Push sont simulés. Aucune donnée réelle n'est utilisée ; les valeurs d'identité sont des sentinelles.
"""
import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from starlette.background import BackgroundTasks

from routers import fiveone as fiveone_router
from routers import orders as orders_router
from routers import payments as payments_router
from services import binance_watcher, crypto, fzr_fulfillment, notifications, push


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clear_detached():
    """Une tâche détachée d'un test ne doit jamais être attendue par le test suivant (autre boucle)."""
    notifications._DETACHED.clear()
    yield
    notifications._DETACHED.clear()


def _now():
    return datetime.now(timezone.utc)


def _iso(delta_minutes=0):
    return (_now() + timedelta(minutes=delta_minutes)).isoformat()


# --------------------------------------------------------------------------- #
# Faux Mongo / faux Push (mêmes formes que `test_notif_alert_journal.py`)
# --------------------------------------------------------------------------- #
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
    """Journal : dédup (event, dedupe_key) comme l'index unique partiel du dépôt."""

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
        return _Cursor([d for d in self.docs if _matches(d, query)])


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


class FakeOrdersRead:
    """Lecture seule des commandes (libellé produit des alertes)."""

    def __init__(self, doc=None):
        self.doc = dict(doc or {})

    async def find_one(self, query, projection=None, *args, **kwargs):
        return dict(self.doc) if query.get("id") == self.doc.get("id") else None


class FakeDB:
    def __init__(self, subs=(), admins=(), fail_journal=False, order=None):
        self.push_subscriptions = FakeSubs(subs)
        self.users = FakeUsers(admins)
        self.alert_log = FakeAlertLog(fail_insert=fail_journal)
        self.orders = FakeOrdersRead(order)


def _sub(sid, user_id):
    return {"_id": sid, "user_id": user_id, "endpoint": "https://fcm.googleapis.com/fcm/send/x",
            "keys": {"p256dh": "k", "auth": "a"}, "updated_at": "2026-01-01T00:00:00Z"}


def _patched(db, send=None):
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


def _my_alert_db(**kwargs):
    return FakeDB(subs=[_sub("s1", "adm1")], admins=["adm1"], **kwargs)


# --------------------------------------------------------------------------- #
# Faux état de paiement (transitions réelles de `routers/payments.py`)
# --------------------------------------------------------------------------- #
class FakePayments:
    def __init__(self, attempt):
        self.doc = dict(attempt)

    def _selected(self, query):
        ref = query.get("client_ref")
        if ref is not None and ref != self.doc.get("client_ref"):
            return False
        if query.get("order_id") is not None and query["order_id"] != self.doc.get("order_id"):
            return False
        status = query.get("status")
        if isinstance(status, str) and status != self.doc.get("status"):
            return False
        return True

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        if not self._selected(query):
            return None
        self.doc.update(update.get("$set") or {})
        return dict(self.doc)

    async def find_one(self, query, projection=None, sort=None):
        return dict(self.doc) if self._selected(query) else None

    async def update_one(self, query, update):
        if not self._selected(query):
            return SimpleNamespace(modified_count=0, matched_count=0)
        self.doc.update(update.get("$set") or {})
        return SimpleNamespace(modified_count=1, matched_count=1)


class FakeOrders:
    def __init__(self, order):
        self.doc = dict(order)

    async def find_one(self, query, projection=None, *args, **kwargs):
        return dict(self.doc) if query.get("id") == self.doc.get("id") else None

    async def update_one(self, query, update):
        if query.get("id") != self.doc.get("id"):
            return SimpleNamespace(modified_count=0, matched_count=0)
        status = query.get("status")
        if isinstance(status, dict) and self.doc.get("status") not in (status.get("$in") or []):
            return SimpleNamespace(modified_count=0, matched_count=1)
        self.doc.update(update.get("$set") or {})
        for key, value in (update.get("$push") or {}).items():
            self.doc.setdefault(key, []).append(value)
        return SimpleNamespace(modified_count=1, matched_count=1)


class FakeAudit:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class FlowDB:
    def __init__(self, attempt, order):
        self.payments = FakePayments(attempt)
        self.orders = FakeOrders(order)
        self.audit_logs = FakeAudit()


def _attempt(**over):
    doc = {"client_ref": "MGS-1-1", "order_id": "o1", "order_number": "MGS-1", "attempt_no": 1,
           "provider": "mvola", "gateway": "papi", "amount": 12000, "customer_phone": "0340000000",
           "status": "pending", "simulated": False, "created_at": _iso(-1), "updated_at": _iso(-1),
           "expires_at": _iso(10)}
    doc.update(over)
    return doc


def _order(**over):
    doc = {"id": "o1", "order_number": "MGS-1", "status": "pending_payment", "total": 12000,
           "items": [{"name": "60 UC", "type": "uc", "quantity": 1}], "payment_method": "mvola",
           "pubg_id": "IDJ-777", "pseudo": "PseudoSecret", "payment_phone": "0340000000",
           "email": "secret@test.mg", "user_id": "user-secret"}
    doc.update(over)
    return doc


def _flow(attempt=None, order=None):
    return FlowDB(attempt or _attempt(), order or _order())


def _patch_flow(db):
    """Base simulée des deux côtés + audit simulé."""
    return [patch.object(payments_router, "db", db), patch.object(fiveone_router, "db", db),
            patch.object(orders_router, "db", db), patch.object(notifications, "db", db),
            patch("core.audit.db", db), patch.object(binance_watcher, "db", db),
            patch.object(orders_router, "release_subscription_locks", AsyncMock())]


# --------------------------------------------------------------------------- #
# order_paid : une alerte par transition réelle, jamais simulation / admin
# --------------------------------------------------------------------------- #
def test_order_paid_alerted_once_per_real_transition():
    db = _flow()
    notify = AsyncMock()
    first_bg, replay_bg = BackgroundTasks(), BackgroundTasks()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(payments_router, "on_order_paid", AsyncMock())] + _patch_flow(db)
    _with(tasks)
    try:
        result = _run(payments_router.apply_status(_attempt(), "completed", "papi", first_bg))
        _run(first_bg())  # la tâche de fond s'exécute APRÈS la réponse
        replay = _run(payments_router.apply_status(_attempt(), "completed", "papi", replay_bg))
        _run(replay_bg())
    finally:
        _stop(tasks)
    assert result["status"] == "completed" and replay["status"] == "completed"
    assert db.orders.doc["status"] == "paid"
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "order_paid"
    assert notify.await_args.kwargs["dedupe_key"] == "paid:MGS-1"
    assert notify.await_args.kwargs["order_ref"] == "MGS-1"
    body = notify.await_args.kwargs["body"]
    assert "MGS-1" in body and "60 UC" in body and "12 000 Ar" in body and "papi" in body


@pytest.mark.parametrize("source", ["simulation", "admin:u-1", "manual"])
def test_order_paid_not_alerted_for_internal_sources(source):
    db = _flow()
    notify = AsyncMock()
    background = BackgroundTasks()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(payments_router, "on_order_paid", AsyncMock())] + _patch_flow(db)
    _with(tasks)
    try:
        _run(payments_router.apply_status(_attempt(), "completed", source, background))
        _run(background())
    finally:
        _stop(tasks)
    assert db.orders.doc["status"] == "paid"  # le paiement lui-même est inchangé
    assert notify.await_count == 0


def test_order_paid_order_transition_is_the_only_trigger():
    """Paiement gagné mais commande déjà payée : aucune alerte (pas de transition réelle)."""
    db = _flow(order=_order(status="paid"))
    notify = AsyncMock()
    background = BackgroundTasks()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(payments_router, "on_order_paid", AsyncMock())] + _patch_flow(db)
    _with(tasks)
    try:
        _run(payments_router.apply_status(_attempt(), "completed", "papi", background))
        _run(background())
    finally:
        _stop(tasks)
    assert notify.await_count == 0
    assert any(d["action"] == "payment.completed_without_order_transition" for d in db.audit_logs.docs)


# --------------------------------------------------------------------------- #
# payment_failed / payment_expired
# --------------------------------------------------------------------------- #
def test_payment_failed_alerted_once_and_replay_is_silent():
    db = _flow()
    notify = AsyncMock()
    first_bg, replay_bg = BackgroundTasks(), BackgroundTasks()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(payments_router, "on_payment_failed", AsyncMock())] + _patch_flow(db)
    _with(tasks)
    try:
        _run(payments_router.apply_status(_attempt(), "failed", "papi", first_bg))
        _run(first_bg())
        _run(payments_router.apply_status(_attempt(), "failed", "papi", replay_bg))
        _run(replay_bg())
    finally:
        _stop(tasks)
    assert db.orders.doc["status"] == "failed"
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "payment_failed"
    assert notify.await_args.kwargs["dedupe_key"] == "payfail:MGS-1"


def test_payment_expired_alerted_once_and_replay_is_silent():
    db = _flow(attempt=_attempt(expires_at=_iso(-1)))
    notify = AsyncMock()
    first_bg, replay_bg = BackgroundTasks(), BackgroundTasks()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(payments_router, "on_payment_failed", AsyncMock())] + _patch_flow(db)
    _with(tasks)
    try:
        first = _run(payments_router.expire_attempt(_attempt(expires_at=_iso(-1)), first_bg))
        _run(first_bg())
        second = _run(payments_router.expire_attempt(_attempt(expires_at=_iso(-1)), replay_bg))
        _run(replay_bg())
    finally:
        _stop(tasks)
    assert first["status"] == "expired" and second["status"] == "expired"
    assert db.orders.doc["status"] == "expired"
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "payment_expired"
    assert notify.await_args.kwargs["dedupe_key"] == "payexp:MGS-1"


def test_payment_expired_not_alerted_for_simulated_attempt():
    db = _flow(attempt=_attempt(simulated=True, expires_at=_iso(-1)))
    notify = AsyncMock()
    background = BackgroundTasks()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(payments_router, "on_payment_failed", AsyncMock())] + _patch_flow(db)
    _with(tasks)
    try:
        _run(payments_router.expire_attempt(_attempt(simulated=True, expires_at=_iso(-1)), background))
        _run(background())
    finally:
        _stop(tasks)
    assert notify.await_count == 0


# --------------------------------------------------------------------------- #
# late_success / amount_mismatch
# --------------------------------------------------------------------------- #
def test_late_success_alerted_once_and_uses_mismatch_key():
    db = _flow(attempt=_attempt(status="expired", expires_at=_iso(-20)))
    notify = AsyncMock()
    tasks = [patch.object(notifications, "notify_admin", notify)] + _patch_flow(db)
    _with(tasks)
    try:
        async def scenario():
            won = await payments_router.record_late_success(dict(db.payments.doc), "papi", {})
            await notifications.flush_detached()
            again = await payments_router.record_late_success(dict(db.payments.doc), "papi", {})
            await notifications.flush_detached()
            return won, again
        won, again = _run(scenario())
    finally:
        _stop(tasks)
    assert won["status"] == "late_success" and again["status"] == "late_success"
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "late_success"
    assert notify.await_args.kwargs["dedupe_key"] == "mismatch:MGS-1"


def test_amount_mismatch_lookup_alerts_without_changing_result():
    db = _flow()
    notify = AsyncMock()
    background = BackgroundTasks()
    wrong = AsyncMock(return_value={"status": "completed", "amount": 999, "fiveonepay_reference": "F-1"})
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(fiveone_router.fiveone, "get_payment", wrong)] + _patch_flow(db)
    _with(tasks)
    try:
        result = _run(fiveone_router.refresh_from_provider(_attempt(gateway="fiveone", provider_ref="F-1"), background))
        _run(background())
    finally:
        _stop(tasks)
    assert result["status"] == "pending"  # comportement existant : aucun statut touché
    assert db.payments.doc["status"] == "pending"
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "amount_mismatch"
    assert notify.await_args.kwargs["dedupe_key"] == "mismatch:MGS-1"


# --------------------------------------------------------------------------- #
# delivery_blocked
# --------------------------------------------------------------------------- #
def test_delivery_blocked_alerted_on_auto_refusal():
    notify = AsyncMock()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch("core.audit.db", SimpleNamespace(audit_logs=FakeAudit())),
             patch.object(fzr_fulfillment, "auto_enabled", AsyncMock(return_value=True)),
             patch.object(fzr_fulfillment, "eligible_lines", AsyncMock(return_value=[{"unit": 1}])),
             patch.object(fzr_fulfillment, "fulfill_order",
                          AsyncMock(side_effect=HTTPException(status_code=409, detail="refus")))]
    _with(tasks)
    try:
        async def scenario():
            await fzr_fulfillment.auto_fulfill(_order(status="paid"))
            await notifications.flush_detached()
        _run(scenario())
    finally:
        _stop(tasks)
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "delivery_blocked"
    assert notify.await_args.kwargs["dedupe_key"] == "delblock:MGS-1:http_409"
    assert "MGS-1" in notify.await_args.kwargs["body"]


def test_delivery_blocked_alerted_on_auto_error():
    notify = AsyncMock()
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch.object(fzr_fulfillment, "auto_enabled", AsyncMock(return_value=True)),
             patch.object(fzr_fulfillment, "eligible_lines", AsyncMock(return_value=[{"unit": 1}])),
             patch.object(fzr_fulfillment, "fulfill_order", AsyncMock(side_effect=RuntimeError("boom")))]
    _with(tasks)
    try:
        async def scenario():
            await fzr_fulfillment.auto_fulfill(_order(status="paid"))
            await notifications.flush_detached()
        _run(scenario())
    finally:
        _stop(tasks)
    assert notify.await_count == 1
    assert notify.await_args.kwargs["dedupe_key"] == "delblock:MGS-1:error"


# --------------------------------------------------------------------------- #
# crypto_unmatched + order_paid Binance
# --------------------------------------------------------------------------- #
class FakeCryptoUnmatched:
    def __init__(self, fail=False):
        self.docs = []
        self.fail = fail

    async def insert_one(self, doc):
        if self.fail:
            raise DuplicateKeyError("dup")
        self.docs.append(dict(doc))


class FakeCryptoPayments:
    def __init__(self, doc, modified=1):
        self.doc = dict(doc)
        self.modified = modified

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        if query.get("id") != self.doc.get("id"):
            return None
        if self.modified:
            self.doc.update(update.get("$set") or {})
            return dict(self.doc)
        return None

    async def update_one(self, query, update):
        if self.modified:
            self.doc.update(update.get("$set") or {})
        return SimpleNamespace(modified_count=self.modified, matched_count=1)


def _crypto_db(payment=None, unmatched=None, modified=1):
    db = SimpleNamespace(crypto_payments=FakeCryptoPayments(payment or {}, modified),
                         crypto_unmatched=unmatched or FakeCryptoUnmatched(), audit_logs=FakeAudit())
    return db


def test_crypto_unmatched_alerted_for_unmatched_deposit():
    db = _crypto_db()
    notify = AsyncMock()
    dep = {"id": "dep-1", "txId": "TXSECRETADDRESS", "amount": "12.34", "coin": "USDT",
           "network": "TRC20", "address": "TSecretAddressXYZ"}
    tasks = [patch.object(notifications, "notify_admin", notify), patch.object(binance_watcher, "db", db),
             patch("core.audit.db", db)]
    _with(tasks)
    try:
        async def scenario():
            await binance_watcher._unmatched(dep, "wrong_network")
            await notifications.flush_detached()
        _run(scenario())
    finally:
        _stop(tasks)
    assert notify.await_count == 1
    kwargs = notify.await_args.kwargs
    assert kwargs["event"] == "crypto_unmatched"
    assert kwargs["dedupe_key"].startswith("crypto:")
    assert "12.34 USDT" in kwargs["body"]
    assert "TSecretAddressXYZ" not in kwargs["body"] and "TXSECRETADDRESS" not in kwargs["body"]


def test_crypto_unmatched_alerted_when_payment_expires():
    payment = {"id": "pay-1234567890", "order_id": "o1", "order_number": "MGS-1", "status": crypto.WAITING,
               "amount_usdt": "12.34"}
    db = _crypto_db(payment=payment)
    notify = AsyncMock()
    tasks = [patch.object(notifications, "notify_admin", notify), patch.object(binance_watcher, "db", db),
             patch("core.audit.db", db), patch.object(payments_router, "_set_order_status", AsyncMock(return_value=True)),
             patch("routers.orders.release_subscription_locks", AsyncMock())]
    _with(tasks)
    try:
        async def scenario():
            await binance_watcher._fail(dict(payment), "expired")
            await notifications.flush_detached()
        _run(scenario())
    finally:
        _stop(tasks)
    assert notify.await_count == 1
    assert notify.await_args.kwargs["event"] == "crypto_unmatched"
    assert "expiré" in notify.await_args.kwargs["body"]


def test_crypto_unmatched_silent_when_transition_already_done():
    payment = {"id": "pay-1234567890", "order_id": "o1", "order_number": "MGS-1", "status": crypto.WAITING,
               "amount_usdt": "12.34"}
    db = _crypto_db(payment=payment, modified=0)
    notify = AsyncMock()
    tasks = [patch.object(notifications, "notify_admin", notify), patch.object(binance_watcher, "db", db),
             patch("core.audit.db", db)]
    _with(tasks)
    try:
        async def scenario():
            await binance_watcher._fail(dict(payment), "expired")
            await notifications.flush_detached()
        _run(scenario())
    finally:
        _stop(tasks)
    assert notify.await_count == 0


def test_binance_confirmation_alerts_order_paid_once():
    payment = {"id": "pay-1234567890", "order_id": "o1", "order_number": "MGS-1", "status": crypto.DETECTED,
               "amount_usdt": "12.34", "amount_ar": 12000}
    db = _crypto_db(payment=payment)
    notify = AsyncMock()
    dep = {"txId": "TX1", "id": "dep-1", "amount": "12.34", "status": 1}
    tasks = [patch.object(notifications, "notify_admin", notify), patch.object(binance_watcher, "db", db),
             patch("core.audit.db", db), patch.object(binance_watcher, "on_order_paid", AsyncMock()),
             patch.object(payments_router, "_set_order_status", AsyncMock(return_value=True))]
    _with(tasks)
    try:
        async def scenario():
            outcome = await binance_watcher._confirm(dict(payment), dep)
            await notifications.flush_detached()
            return outcome
        assert _run(scenario()) == "confirmed"
    finally:
        _stop(tasks)
    assert notify.await_count == 1
    kwargs = notify.await_args.kwargs
    assert kwargs["event"] == "order_paid" and kwargs["dedupe_key"] == "paid:MGS-1"
    assert "12 000 Ar" in kwargs["body"]


# --------------------------------------------------------------------------- #
# Déduplication : la `dedupe_key` est le second filet
# --------------------------------------------------------------------------- #
def test_dedupe_key_blocks_a_forced_duplicate():
    db = _my_alert_db(order=_order())
    sent = []
    tasks = _patched(db, send=lambda sub, payload: sent.append(payload))
    _with(tasks)
    try:
        first = _run(notifications.notify_order_paid("o1", "MGS-1", 12000, "papi", "papi"))
        second = _run(notifications.notify_order_paid("o1", "MGS-1", 12000, "papi", "papi"))
    finally:
        _stop(tasks)
    assert len(sent) == 1
    assert len(db.alert_log.docs) == 1
    assert second is None  # `_critical` ne renvoie rien ; le doublon est journalisé `skipped`
    assert db.alert_log.docs[0]["event"] == "order_paid"
    assert db.alert_log.docs[0]["dedupe_key"] == "paid:MGS-1"


# --------------------------------------------------------------------------- #
# Une alerte en panne ne change ni paiement, ni livraison, ni réponse
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("broken", ["raises", "journal_down", "slow"])
def test_alert_failure_never_changes_payment_result(broken):
    db = _flow()
    background = BackgroundTasks()
    journal = _my_alert_db(fail_journal=(broken == "journal_down"), order=_order())
    tasks = [patch.object(payments_router, "db", db), patch("core.audit.db", db),
             patch.object(notifications, "db", journal), patch.object(push, "db", journal),
             patch.object(push, "configured", lambda: True),
             patch.object(payments_router, "on_order_paid", AsyncMock())]
    if broken == "raises":
        tasks.append(patch.object(notifications, "notify_admin", AsyncMock(side_effect=RuntimeError("en panne"))))
    elif broken == "slow":
        async def slow(*args, **kwargs):
            await asyncio.sleep(0.2)
            raise RuntimeError("réseau lent")
        tasks.append(patch.object(notifications, "notify_admin", AsyncMock(side_effect=slow)))
    else:
        tasks.append(patch.object(push, "dispatch_to_admins", AsyncMock(side_effect=RuntimeError("coupé"))))
    _with(tasks)
    try:
        started = time.perf_counter()
        result = _run(payments_router.apply_status(_attempt(), "completed", "papi", background))
        elapsed = time.perf_counter() - started
        _run(background())
    finally:
        _stop(tasks)
    assert result["status"] == "completed"
    assert db.payments.doc["status"] == "completed"
    assert db.orders.doc["status"] == "paid"
    assert elapsed < 0.1  # l'alerte n'est jamais attendue par la transition
    if broken == "journal_down":
        assert journal.alert_log.docs == []  # journal en panne : aucune ligne, aucune exception


def test_delivery_result_unchanged_when_alert_raises():
    notify = AsyncMock(side_effect=RuntimeError("alerte en panne"))
    tasks = [patch.object(notifications, "notify_admin", notify),
             patch("core.audit.db", SimpleNamespace(audit_logs=FakeAudit())),
             patch.object(fzr_fulfillment, "auto_enabled", AsyncMock(return_value=True)),
             patch.object(fzr_fulfillment, "eligible_lines", AsyncMock(return_value=[{"unit": 1}])),
             patch.object(fzr_fulfillment, "fulfill_order",
                          AsyncMock(side_effect=HTTPException(status_code=409, detail="refus")))]
    _with(tasks)
    try:
        async def scenario():
            await fzr_fulfillment.auto_fulfill(_order(status="paid"))
            await notifications.flush_detached()
        _run(scenario())  # ne lève jamais
    finally:
        _stop(tasks)
    assert notify.await_count == 1


# --------------------------------------------------------------------------- #
# Aucune donnée personnelle ni secret dans le titre, le corps ou le journal
# --------------------------------------------------------------------------- #
def test_alert_payloads_and_journal_hold_no_customer_data():
    order = _order()
    db = _my_alert_db(order=order)
    payloads = []
    tasks = _patched(db, send=lambda sub, payload: payloads.append(payload))
    _with(tasks)
    try:
        _run(notifications.notify_order_paid("o1", "MGS-1", 12000, "papi", "papi"))
        _run(notifications.notify_payment_failed("o1", "MGS-1", "papi", "papi"))
        _run(notifications.notify_payment_expired("o1", "MGS-1", "papi", "system"))
        _run(notifications.notify_late_success("o1", "MGS-1", "papi"))
        _run(notifications.notify_amount_mismatch("o1", "MGS-1", "papi"))
        _run(notifications.notify_delivery_blocked("o1", "MGS-1", "http_409", "refus fournisseur (409)"))
        _run(notifications.notify_crypto_unmatched("wrong_network", "12.34", "USDT", "dep-1"))
    finally:
        _stop(tasks)
    text = json.dumps([{"t": p["title"], "b": p["body"], "u": p.get("url")} for p in payloads])
    journal = json.dumps(db.alert_log.docs, default=str)
    for secret in ("0340000000", "secret@test.mg", "PseudoSecret", "IDJ-777", "user-secret", "TSecretAddress"):
        assert secret not in text and secret not in journal
    assert [d["order_ref"] for d in db.alert_log.docs] == ["MGS-1", "MGS-1", "MGS-1", "MGS-1", "MGS-1", "MGS-1", None]


# --------------------------------------------------------------------------- #
# Reprise : chaque nouvel événement est reconstruit par `retry_pending`
# --------------------------------------------------------------------------- #
def test_retry_pending_rebuilds_every_new_event():
    db = _my_alert_db()
    old = _now() - timedelta(minutes=5)
    events = ["order_paid", "payment_failed", "payment_expired", "delivery_blocked",
              "crypto_unmatched", "amount_mismatch", "late_success"]
    db.alert_log.docs = [{"_id": event, "event": event, "channel": "push", "status": "pending",
                          "reason": None, "created_at": old, "updated_at": old, "attempts": 0}
                         for event in events]
    tasks = _patched(db, send=lambda sub, payload: None)
    _with(tasks)
    try:
        results = _run(notifications.retry_pending(older_than_s=60))
    finally:
        _stop(tasks)
    assert sorted(r["event"] for r in results) == sorted(events)
    assert all(r["status"] == "sent" for r in results)  # charge utile connue, aucun `unknown_event`
