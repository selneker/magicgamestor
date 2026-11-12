"""PL-STOCK-2 — signaux de rupture : remboursement fournisseur et liste des offres.

Aucune base Mongo, aucun appel réseau : collections en mémoire et fournisseur remplacé par un
`AsyncMock`. `pytest-asyncio` n'est pas une dépendance du dépôt : chaque coroutine passe par `_run`.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import notifications, stock, stock_signals  # noqa: E402

DAY = timedelta(days=1)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


# --------------------------------------------------------------------------- #
# Fakes Mongo
# --------------------------------------------------------------------------- #
def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, part) for part in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict) and expected:
            for op, operand in expected.items():
                if op == "$ne" and value == operand:
                    return False
                if op == "$in" and value not in operand:
                    return False
                if op == "$gte" and not (value is not None and value >= operand):
                    return False
                if op == "$exists" and (key in doc) != bool(operand):
                    return False
        elif value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self._docs = [dict(d) for d in docs]

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self.inserts = 0

    def _filtered(self, query):
        return [d for d in self.docs if _matches(d, query)]

    async def find_one(self, query, projection=None):
        found = self._filtered(query)
        return dict(found[0]) if found else None

    def find(self, query, projection=None):
        return _Cursor(self._filtered(query))

    async def insert_one(self, doc):
        key = doc.get("_id")
        if key is not None and any(d.get("_id") == key for d in self.docs):
            raise DuplicateKeyError("duplicate key")
        self.docs.append(dict(doc))
        self.inserts += 1

    async def update_one(self, query, update, upsert=False):
        found = self._filtered(query)
        if not found:
            if not upsert:
                return SimpleNamespace(modified_count=0, matched_count=0)
            doc = {k: v for k, v in query.items() if not k.startswith("$")}
            doc.update(update.get("$set") or {})
            self.docs.append(doc)
            return SimpleNamespace(modified_count=1, matched_count=1)
        found[0].update(update.get("$set") or {})
        return SimpleNamespace(modified_count=1, matched_count=1)


class FakeDB:
    def __init__(self, products=None, refunds=None, checks=None):
        self.products = FakeCollection(products)
        self.stock_refunds = FakeCollection(refunds)
        self.stock_offer_checks = FakeCollection(checks)


@pytest.fixture
def patched(monkeypatch):
    """Branche les deux modules sur le fake et neutralise alertes + audit (espions)."""
    monkeypatch.delenv("STOCK_SYNC_ENABLED", raising=False)
    monkeypatch.delenv("STOCK_REFUND_THRESHOLD", raising=False)
    monkeypatch.delenv("STOCK_REFUND_WINDOW_MINUTES", raising=False)
    monkeypatch.delenv("STOCK_OFFERS_SYNC_MODE", raising=False)
    fake = FakeDB()
    spies = SimpleNamespace(
        db=fake,
        unavailable=AsyncMock(return_value=None),
        restored=AsyncMock(return_value=None),
        list_absent=AsyncMock(return_value=None),
        list_suspect=AsyncMock(return_value=None),
        audit=AsyncMock(return_value=None),
    )
    with patch.object(stock_signals, "db", fake), \
         patch.object(stock, "db", fake), \
         patch.object(stock_signals, "audit", spies.audit), \
         patch.object(stock, "audit", spies.audit), \
         patch.object(notifications, "notify_stock_unavailable", spies.unavailable), \
         patch.object(notifications, "notify_stock_restored", spies.restored), \
         patch.object(notifications, "notify_stock_list_absent", spies.list_absent), \
         patch.object(notifications, "notify_stock_list_suspect", spies.list_suspect):
        yield spies


def product(pid="p1", offer="offer-1", mode="direct", **extra):
    mapping = ({"mode": "composite", "category_id": "cat-1",
                "components": [{"offer_id": o} for o in offer]} if mode == "composite"
               else {"mode": "direct", "category_id": "cat-1", "offer_id": offer, "confirmed": True})
    return {"id": pid, "name": f"Produit {pid}", "fazercards_mapping": mapping, **extra}


def order_for(customer="user:u1", order_id="o1", product_id="p1"):
    doc = {"id": order_id, "items": [{"product_id": product_id, "name": "60 UC"}]}
    if customer and customer.startswith("user:"):
        doc["user_id"] = customer[5:]
    elif customer and customer.startswith("email:"):
        doc["email"] = customer[6:]
    return doc


def refund(*, customer, offer="offer-1", provider_order_id="ord-1", raw=None, at=None):
    return _run(stock_signals.record_supplier_refund(
        order=order_for(customer), line_index=0, offer_id=offer,
        provider_order_id=provider_order_id, raw=raw, source="refresh", actor="auto"))


# --------------------------------------------------------------------------- #
# Réglages
# --------------------------------------------------------------------------- #
def test_settings_defaults_and_bounds(monkeypatch):
    monkeypatch.delenv("STOCK_REFUND_THRESHOLD", raising=False)
    monkeypatch.delenv("STOCK_REFUND_WINDOW_MINUTES", raising=False)
    monkeypatch.delenv("STOCK_OFFERS_SYNC_MODE", raising=False)
    assert stock_signals.refund_threshold() == 2
    assert stock_signals.refund_window_minutes() == 120
    assert stock_signals.offers_sync_mode() == "observe"
    monkeypatch.setenv("STOCK_REFUND_THRESHOLD", "0")
    assert stock_signals.refund_threshold() == 1
    monkeypatch.setenv("STOCK_REFUND_THRESHOLD", "999")
    assert stock_signals.refund_threshold() == stock_signals.MAX_REFUND_THRESHOLD
    monkeypatch.setenv("STOCK_REFUND_THRESHOLD", "n'importe quoi")
    assert stock_signals.refund_threshold() == 2
    monkeypatch.setenv("STOCK_REFUND_WINDOW_MINUTES", "0")
    assert stock_signals.refund_window_minutes() == 1
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "inconnu")
    assert stock_signals.offers_sync_mode() == "observe"
    for mode in ("off", "enforce"):
        monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", mode.upper())
        assert stock_signals.offers_sync_mode() == mode


def test_customer_key_never_uses_the_player_id():
    assert stock_signals.customer_key({"user_id": "u1", "pubg_id": "51234567890"}) == "user:u1"
    assert stock_signals.customer_key({"email": " A@B.C ", "pubg_id": "51234567890"}) == "email:a@b.c"
    assert stock_signals.customer_key({"pubg_id": "51234567890"}) is None


def test_reason_classification():
    assert stock_signals.extract_reason({"refund_reason": "Out of stock"}) == "Out of stock"
    assert stock_signals.extract_reason({"refund": {"reason": "sold out"}}) == "sold out"
    assert stock_signals.extract_reason({}, "timeout réseau") == "timeout réseau"
    assert stock_signals.extract_reason({}) == ""
    assert len(stock_signals.extract_reason({"reason": "x" * 500})) == stock_signals.REASON_MAX_CHARS
    for reason in ("Insufficient balance", "Solde insuffisant", "invalid player id",
                   "API key invalide", "timeout réseau", "player not found"):
        assert stock_signals.is_non_stock_reason(reason) is True
    for reason in ("", "rupture de stock", "out of stock", "stock épuisé"):
        assert stock_signals.is_non_stock_reason(reason) is False


# --------------------------------------------------------------------------- #
# Mécanismes 1 + 2 — remboursement
# --------------------------------------------------------------------------- #
def test_single_refund_does_not_block(patched):
    patched.db.products.docs = [product()]
    result = refund(customer="user:u1", provider_order_id="ord-1")
    assert result == {"recorded": True, "customers": 1, "marked": 0}
    assert stock.purchasable(patched.db.products.docs[0]) is True
    assert patched.unavailable.await_count == 0


def test_two_distinct_customers_block_the_product(patched):
    patched.db.products.docs = [product()]
    refund(customer="user:u1", provider_order_id="ord-1")
    result = refund(customer="user:u2", provider_order_id="ord-2")
    assert result["customers"] == 2 and result["marked"] == 1
    doc = patched.db.products.docs[0]
    assert doc["supplier_available"] is False
    assert stock.purchasable(doc) is False
    assert stock.unavailable_reason(doc) == "supplier_out_of_stock"
    patched.unavailable.assert_awaited_once_with("Produit p1", "p1")
    # Une seule alerte : un troisième remboursement ne la rejoue pas.
    refund(customer="user:u3", provider_order_id="ord-3")
    patched.unavailable.assert_awaited_once()


def test_same_customer_twice_counts_once(patched):
    patched.db.products.docs = [product()]
    refund(customer="user:u1", provider_order_id="ord-1")
    result = refund(customer="user:u1", provider_order_id="ord-2")
    assert result["customers"] == 1 and result["marked"] == 0
    assert stock.purchasable(patched.db.products.docs[0]) is True


def test_guest_without_email_never_reaches_the_threshold(patched):
    patched.db.products.docs = [product()]
    refund(customer="", provider_order_id="ord-1")
    result = refund(customer="", provider_order_id="ord-2")
    assert result["recorded"] is True and result["customers"] == 0
    assert stock.purchasable(patched.db.products.docs[0]) is True


def test_non_stock_reasons_are_excluded(patched):
    patched.db.products.docs = [product()]
    refund(customer="user:u1", provider_order_id="ord-1",
           raw={"reason": "Insufficient balance"})
    result = refund(customer="user:u2", provider_order_id="ord-2",
                    raw={"reason": "invalid player id"})
    assert result["recorded"] is True and result["customers"] == 0
    assert stock.purchasable(patched.db.products.docs[0]) is True
    assert len(patched.db.stock_refunds.docs) == 2  # le motif reste consultable


def test_unknown_reason_counts(patched):
    patched.db.products.docs = [product()]
    refund(customer="user:u1", provider_order_id="ord-1")
    result = refund(customer="user:u2", provider_order_id="ord-2")
    assert result["customers"] == 2 and result["marked"] == 1


def test_duplicate_refund_is_not_counted_twice(patched):
    patched.db.products.docs = [product()]
    first = refund(customer="user:u1", provider_order_id="ord-1")
    again = refund(customer="user:u1", provider_order_id="ord-1")
    assert first["recorded"] is True and again["recorded"] is False
    assert len(patched.db.stock_refunds.docs) == 1


def test_refund_outside_the_window_does_not_count(patched):
    old = _iso(_now() - 3 * DAY)
    patched.db.products.docs = [product()]
    patched.db.stock_refunds.docs = [{"_id": "ord-old:offer-1", "product_id": "p1",
                                      "offer_id": "offer-1", "customer_key": "user:old",
                                      "at": old, "raw_reason": ""}]
    result = refund(customer="user:u1", provider_order_id="ord-1")
    assert result["customers"] == 1 and result["marked"] == 0


def test_refund_without_product_or_offer_writes_nothing(patched):
    patched.db.products.docs = [product()]
    missing_offer = _run(stock_signals.record_supplier_refund(
        order=order_for("user:u1"), line_index=0, offer_id="", provider_order_id="ord-1",
        source="refresh"))
    missing_product = _run(stock_signals.record_supplier_refund(
        order={"id": "o1", "items": []}, line_index=0, offer_id="offer-1",
        provider_order_id="ord-1", source="refresh"))
    assert missing_offer["recorded"] is False and missing_product["recorded"] is False
    assert patched.db.stock_refunds.docs == []


def test_refund_marks_every_product_using_the_offer(patched):
    patched.db.products.docs = [product("p1"), product("p2")]
    refund(customer="user:u1", provider_order_id="ord-1")
    result = refund(customer="user:u2", provider_order_id="ord-2")
    assert result["marked"] == 2
    assert all(p["supplier_available"] is False for p in patched.db.products.docs)


def test_blocked_product_returns_automatically_when_state_is_stale(patched, monkeypatch):
    monkeypatch.delenv("STOCK_STALE_MINUTES", raising=False)
    patched.db.products.docs = [product()]
    refund(customer="user:u1", provider_order_id="ord-1")
    refund(customer="user:u2", provider_order_id="ord-2")
    doc = patched.db.products.docs[0]
    assert stock.purchasable(doc) is False
    # Au-delà de STOCK_STALE_MINUTES, l'état périmé vaut « inconnu » : retour automatique.
    assert stock.purchasable({**doc, "supplier_checked_at": _iso(_now() - 2 * DAY)}) is True


def test_refund_never_raises_on_db_failure():
    class Broken:
        async def insert_one(self, *args, **kwargs):
            raise RuntimeError("mongo down")

    with patch.object(stock_signals, "db", SimpleNamespace(stock_refunds=Broken())):
        result = _run(stock_signals.record_supplier_refund(
            order=order_for("user:u1"), line_index=0, offer_id="offer-1",
            provider_order_id="ord-1", source="refresh"))
    assert result == {"recorded": False, "customers": 0, "marked": 0}


# --------------------------------------------------------------------------- #
# Mécanisme 3 — liste des offres
# --------------------------------------------------------------------------- #
def _offers(*ids):
    return {"offers": [{"offer_id": offer, "name": "x", "price_usd": 1} for offer in ids]}


def _sweep(patched, now, *, offers=None, error=False, mode=None):
    if mode:
        os.environ["STOCK_OFFERS_SYNC_MODE"] = mode
    fake = AsyncMock(side_effect=RuntimeError("réseau coupé")) if error \
        else AsyncMock(return_value=offers if offers is not None else _offers("offer-1"))
    with patch.object(stock_signals.fazercards, "pubg_offers_fresh", fake):
        return _run(stock_signals.sync_offers(now))


def _cleanup_mode(monkeypatch):
    monkeypatch.delenv("STOCK_OFFERS_SYNC_MODE", raising=False)


def test_off_mode_does_nothing(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "off")
    patched.db.products.docs = [product()]
    result = _sweep(patched, _now(), offers=_offers("other"))
    assert result == {"offers_checked": 0, "offers_absent": 0, "offers_marked": 0,
                      "offers_suspect": 0}
    assert "supplier_list_checked_at" not in patched.db.products.docs[0]
    assert patched.list_absent.await_count == 0


def test_observe_never_blocks_and_alerts_once(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "observe")
    patched.db.products.docs = [product()]
    first = _sweep(patched, _now(), offers=_offers("other"))
    doc = patched.db.products.docs[0]
    assert first["offers_absent"] == 1 and first["offers_marked"] == 0
    assert doc["absent_from_supplier_list"] is True
    assert doc["supplier_list_checked_at"]
    assert "supplier_available" not in doc  # observe n'agit JAMAIS sur la vente
    assert stock.purchasable(doc) is True
    patched.list_absent.assert_awaited_once_with("Produit p1", "p1")
    # Deuxième relevé : pas de nouvelle alerte (transition déjà journalisée), toujours achetable.
    _sweep(patched, _now() + timedelta(minutes=10), offers=_offers("other"))
    assert patched.list_absent.await_count == 1
    assert stock.purchasable(patched.db.products.docs[0]) is True


def test_enforce_needs_two_spaced_readings(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "enforce")
    patched.db.products.docs = [product()]
    start = _now()
    _sweep(patched, start, offers=_offers("other"))
    assert stock.purchasable(patched.db.products.docs[0]) is True
    result = _sweep(patched, start + timedelta(minutes=10), offers=_offers("other"))
    assert result["offers_marked"] == 1
    doc = patched.db.products.docs[0]
    assert doc["supplier_available"] is False
    assert stock.purchasable(doc) is False
    patched.unavailable.assert_awaited_once()
    # Idempotence : troisième relevé, aucune nouvelle bascule ni alerte.
    _sweep(patched, start + timedelta(minutes=20), offers=_offers("other"))
    patched.unavailable.assert_awaited_once()


def test_enforce_two_readings_too_close_do_not_mark(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "enforce")
    patched.db.products.docs = [product()]
    start = _now()
    _sweep(patched, start, offers=_offers("other"))
    _sweep(patched, start + timedelta(minutes=2), offers=_offers("other"))
    assert stock.purchasable(patched.db.products.docs[0]) is True
    patched.unavailable.assert_not_awaited()


def test_empty_offer_list_is_ignored(patched):
    patched.db.products.docs = [product()]
    result = _sweep(patched, _now(), offers={"offers": []})
    assert result["offers_checked"] == 0
    assert "supplier_list_checked_at" not in patched.db.products.docs[0]
    assert patched.list_absent.await_count == 0


def test_provider_error_changes_nothing(patched):
    patched.db.products.docs = [product()]
    result = _sweep(patched, _now(), error=True)
    assert result == {"offers_checked": 0, "offers_absent": 0, "offers_marked": 0,
                      "offers_suspect": 0}
    assert "supplier_list_checked_at" not in patched.db.products.docs[0]
    assert "supplier_available" not in patched.db.products.docs[0]


def test_suspicious_mass_drop_is_ignored_and_alerted_once(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "enforce")
    patched.db.products.docs = [product()]
    patched.db.stock_offer_checks.docs = [
        {"_id": "cat-1", "offer_ids": ["a", "b", "c", "d"], "at": _iso(_now())}]
    first = _sweep(patched, _now(), offers=_offers("a"))
    assert first["offers_suspect"] == 1 and first["offers_absent"] == 0
    assert "supplier_list_checked_at" not in patched.db.products.docs[0]
    assert patched.list_suspect.await_count == 1
    # Deuxième relevé suspect : référence inchangée et alerte non rejouée.
    _sweep(patched, _now() + timedelta(minutes=10), offers=_offers("a"))
    assert patched.list_suspect.await_count == 1
    assert patched.db.stock_offer_checks.docs[0]["offer_ids"] == ["a", "b", "c", "d"]


def test_absent_offer_is_recorded_when_no_bulk_drop(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "observe")
    patched.db.products.docs = [product(offer="b")]
    patched.db.stock_offer_checks.docs = [
        {"_id": "cat-1", "offer_ids": ["a", "b", "c", "d"], "at": _iso(_now())}]
    result = _sweep(patched, _now(), offers=_offers("a", "c", "d"))
    assert result["offers_absent"] == 1
    assert patched.db.products.docs[0]["absent_from_supplier_list"] is True


def test_null_offer_id_is_unknown_never_absent(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "enforce")
    patched.db.products.docs = [product(offer=None)]
    first = _sweep(patched, _now(), offers=_offers("other"))
    assert first["offers_absent"] == 0
    doc = patched.db.products.docs[0]
    assert doc["absent_from_supplier_list"] is False
    assert stock.purchasable(doc) is True
    patched.list_absent.assert_not_awaited()


def test_composite_mapping_needs_every_component(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "observe")
    patched.db.products.docs = [product(offer=["a", "b"], mode="composite")]
    _sweep(patched, _now(), offers=_offers("a"))
    assert patched.db.products.docs[0]["absent_from_supplier_list"] is True
    _sweep(patched, _now() + timedelta(minutes=10), offers=_offers("a", "b"))
    assert patched.db.products.docs[0]["absent_from_supplier_list"] is False


def test_offer_back_after_transition_is_audited(patched, monkeypatch):
    monkeypatch.setenv("STOCK_OFFERS_SYNC_MODE", "observe")
    patched.db.products.docs = [product(absent_from_supplier_list=True, absent_streak=3)]
    _sweep(patched, _now(), offers=_offers("offer-1"))
    doc = patched.db.products.docs[0]
    assert doc["absent_from_supplier_list"] is False and doc["absent_streak"] == 0
    actions = [call.args[0] for call in patched.audit.await_args_list]
    assert actions == ["product.supplier_list_changed"]


# --------------------------------------------------------------------------- #
# Branchement cron + contrats
# --------------------------------------------------------------------------- #
def test_run_all_branches_the_offers_sweep(monkeypatch):
    from services import order_maintenance

    calls = {}

    def fake(name, result):
        async def func(now=None):
            calls[name] = True
            return result
        return func

    for attr in ("warn_expiring_orders", "expire_due_orders", "purge_expired_orders",
                 "purge_order_proofs"):
        monkeypatch.setattr(order_maintenance, attr, fake(attr, {}))
    monkeypatch.setattr(order_maintenance.proofs, "check_storage_warnings", fake("storage", {}))
    monkeypatch.setattr(order_maintenance.stock, "expire_stale_states",
                        fake("stock", {"stock_expired": 0, "stock_restored": 0}))
    monkeypatch.setattr(order_maintenance.stock_signals, "sync_offers",
                        fake("offers", {"offers_checked": 2, "offers_absent": 1,
                                        "offers_marked": 0, "offers_suspect": 0}))
    result = _run(order_maintenance.run_all(_now()))
    assert calls.get("offers") is True
    assert result["offers_checked"] == 2 and result["offers_absent"] == 1


def test_cron_route_runs_the_sweep_only_with_the_token(monkeypatch):
    from fastapi import HTTPException
    from starlette.requests import Request

    from routers import maintenance

    def request(token=None):
        raw = [] if token is None else [(b"x-cron-token", token.encode())]
        return Request({"type": "http", "method": "POST", "path": "/api/internal/orders/run",
                        "headers": raw, "client": ("127.0.0.1", 1)})

    calls = []

    async def fake_run_all(now=None):
        calls.append(True)
        return {"offers_checked": 0}

    monkeypatch.setattr(maintenance.order_maintenance, "run_all", fake_run_all)
    monkeypatch.setenv("CRON_TOKEN", "secret-stock")
    assert _run(maintenance.run(request("secret-stock"))) == {"offers_checked": 0}
    with pytest.raises(HTTPException) as denied:
        _run(maintenance.run(request("nope")))
    assert denied.value.status_code == 401
    assert calls == [True]  # refuses avant toute tâche


def test_stock_list_events_registered():
    assert "stock_list_absent" in notifications.RETRY_ALERTS
    assert "stock_list_suspect" in notifications.RETRY_ALERTS
    assert "stock_list_absent" in notifications.telegram.DEFAULT_EVENTS
    assert "stock_list_suspect" in notifications.telegram.DEFAULT_EVENTS


def test_public_view_hides_the_new_admin_fields():
    from routers.products import _public

    doc = product(absent_from_supplier_list=True,
                  supplier_list_checked_at=_iso(_now()))
    public = _public(doc)
    for field in ("absent_from_supplier_list", "supplier_list_checked_at",
                  "refund_count_window", "supplier_available", "supplier_checked_at",
                  "manual_unavailable"):
        assert field not in public
    assert set(public) >= {"purchasable", "unavailable_reason"}
    assert "absent_from_supplier_list" not in repr(public).lower().replace("purchasable", "")

    admin = _public(doc, admin=True, refund_counts={"offer-1": 2})
    assert admin["absent_from_supplier_list"] is True
    assert admin["supplier_list_checked_at"] == doc["supplier_list_checked_at"]
    assert admin["refund_count_window"] == 2


def test_admin_refund_count_uses_the_highest_mapped_offer():
    fields = stock.admin_fields(product(offer=["a", "b"], mode="composite"),
                                refund_counts={"a": 1, "b": 3})
    assert fields["refund_count_window"] == 3
    # Sans compteurs lus, le champ n'est pas inventé.
    assert "refund_count_window" not in stock.admin_fields(product())
