"""FazerCards Phase 3 — commande fournisseur, idempotence, statut, webhook, alertes prix. Unit (mock httpx + Mongo local)."""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx
import pytest
import requests
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

_LOOP = asyncio.new_event_loop()  # single loop set BEFORE importing motor (client binds to default loop)
asyncio.set_event_loop(_LOOP)

from core.db import db  # noqa: E402
from services import fazercards, fzr_fulfillment  # noqa: E402
from routers.fzr_orders import verify_fzr_signature  # noqa: E402


def _default_base() -> str:
    try:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return "http://localhost:8001"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", _default_base()).rstrip("/")
API = f"{BASE_URL}/api"
RealAsyncClient = httpx.AsyncClient

VALIDATE_LIST = {"ok": True, "items": [{"category_id": "pubg_mobile", "name": "PUBG Mobile",
                                        "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}]}
VALIDATE_OK = {"ok": True, "valid": True, "player_name": "Kapotue"}
OFFERS = {"ok": True, "kind": "topup", "category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)",
          "offers": [{"offer_id": "uc_60", "name": "60 UC", "price_usd": "0.8800"}],
          "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}
ORDER_OK = {"ok": True, "order": {"id": "ord-9002", "kind": "topup", "status": "processing"}}


def run(coro):
    asyncio.set_event_loop(_LOOP)  # other modules' asyncio.run() clears the current loop on shared xdist workers
    return _LOOP.run_until_complete(coro)


def _now():
    return datetime.now(timezone.utc).isoformat()


def make_order(status="paid", product_id=None, qty=1, items=None):
    n = uuid.uuid4().hex[:6].upper()
    order = {
        "id": str(uuid.uuid4()), "order_number": f"MGS-{n}", "user_id": None, "email": None,
        "pubg_id": "52328390220", "pseudo": "Kapotue",
        "items": items if items is not None else [{"product_id": product_id or str(uuid.uuid4()), "slug": "60-uc",
                                                   "name": "60 UC", "type": "uc", "unit_price": 5000, "quantity": qty,
                                                   "line_total": 5000 * qty}],
        "total": 5000, "currency": "Ar", "payment_method": "manual", "manual_reference": "mvola:X",
        "status": status, "admin_note": None, "created_at": _now(), "updated_at": _now(),
        "history": [{"status": "created", "at": _now()}],
    }
    run(db.orders.insert_one(dict(order)))
    return order


def make_mapped_product():
    pid = str(uuid.uuid4())
    run(db.products.insert_one({
        "id": pid, "slug": f"test-60-uc-{pid[:6]}", "type": "uc", "name": "60 UC", "price": 5000, "active": True,
        "fazercards_mapping": {"category_id": "pubg_mobile_auto", "offer_id": "uc_60", "offer_name": "60 UC",
                               "price_usd_at_link": "0.8800", "linked_at": _now()}}))
    return pid


@pytest.fixture(autouse=True)
def env_and_cache(monkeypatch):
    asyncio.set_event_loop(_LOOP)  # motor resolves the loop at coroutine-creation time
    fazercards._catalog_cache.clear()
    fazercards._discovery_cache["data"] = None
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
    yield
    fazercards._catalog_cache.clear()
    fazercards._discovery_cache["data"] = None


def mock_transport(monkeypatch, handler):
    def factory(**kwargs):
        return RealAsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(fazercards.httpx, "AsyncClient", factory)


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_artifacts():
    yield
    asyncio.set_event_loop(_LOOP)
    run(db.products.delete_many({"slug": {"$regex": "^test-60-uc-"}}))
    run(db.orders.delete_many({"pubg_id": "52328390220", "manual_reference": "mvola:X"}))


def happy_handler(order_calls: list | None = None, order_response=None, validate=VALIDATE_OK, provider_id=None):
    provider_id = provider_id or f"ord-{uuid.uuid4().int % 10**8}"

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if path.endswith("/topups/validate-id"):
            return httpx.Response(200, json=validate)
        if path.endswith("/topups/offers"):
            return httpx.Response(200, json=OFFERS)
        if path.endswith("/topups/order"):
            if order_calls is not None:
                order_calls.append({"idempotency_key": req.headers.get("Idempotency-Key"),
                                    "body": json.loads(req.content)})
            resp = order_response or httpx.Response(200, json={"ok": True, "order": {"id": provider_id, "kind": "topup", "status": "processing"}})
            if callable(resp):
                return resp(req)
            return resp
        if "/orders/" in path:
            return httpx.Response(200, json={"ok": True, "order": {"id": provider_id, "kind": "topup", "status": "completed"}})
        return httpx.Response(404, json={"ok": False, "error": "not found"})
    handler.provider_id = provider_id
    return handler


class TestFulfillPreconditions:
    def test_payment_not_confirmed_no_provider_order(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, happy_handler(calls))
        pid = make_mapped_product()
        order = make_order(status="pending_payment", product_id=pid)
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and calls == []

    def test_unmapped_product_not_eligible(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, happy_handler(calls))
        order = make_order(status="paid")  # produit sans mapping
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and calls == []

    def test_invalid_player_id_no_order(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, happy_handler(calls, validate={"ok": True, "valid": False}))
        order = make_order(status="paid", product_id=make_mapped_product())
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and "ID PUBG" in e.value.detail and calls == []

    def test_provider_down_is_service_error_not_invalid_id(self, monkeypatch):
        def handler(req):
            if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
                return httpx.Response(200, json=VALIDATE_LIST)
            raise httpx.ConnectTimeout("t")
        mock_transport(monkeypatch, handler)
        order = make_order(status="paid", product_id=make_mapped_product())
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 504  # jamais "ID invalide"

    def test_offer_gone_from_live_catalog(self, monkeypatch):
        def handler(req):
            if req.url.path.endswith("/topups/validate-id"):
                return httpx.Response(200, json=VALIDATE_LIST if req.method == "GET" else VALIDATE_OK)
            if req.url.path.endswith("/topups/offers"):
                return httpx.Response(200, json={**OFFERS, "offers": []})
            return httpx.Response(500)
        mock_transport(monkeypatch, handler)
        order = make_order(status="paid", product_id=make_mapped_product())
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and "indisponible" in e.value.detail.lower()

    def test_multi_item_order_not_eligible(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler())
        pid = make_mapped_product()
        order = make_order(status="paid", items=[
            {"product_id": pid, "slug": "60-uc", "name": "60 UC", "type": "uc", "unit_price": 5000, "quantity": 2, "line_total": 10000}])
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409


class TestFulfillSuccess:
    def test_order_accepted_snapshot_and_provider_id(self, monkeypatch):
        calls = []
        h = happy_handler(calls)
        mock_transport(monkeypatch, h)
        order = make_order(status="paid", product_id=make_mapped_product())
        rec = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert rec["provider_order_id"] == h.provider_id
        assert rec["provider_status"] == "processing"
        assert rec["supplier_price_usd_at_order"] == "0.8800"
        assert rec["player_name_at_validation"] == "Kapotue"
        assert rec["idempotency_key"] == f"{order['order_number']}-1"
        assert calls[0]["idempotency_key"] == f"{order['order_number']}-1"
        assert calls[0]["body"] == {"category_id": "pubg_mobile_auto", "offer_id": "uc_60",
                                    "fields": {"player_id": "52328390220"}}
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["status"] == "paid"  # processing fournisseur ⇒ MGS reste payée

    def test_double_fulfill_rejected(self, monkeypatch):
        h = happy_handler()
        mock_transport(monkeypatch, h)
        order = make_order(status="paid", product_id=make_mapped_product())
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and h.provider_id in e.value.detail


class TestIdempotencyRetry:
    def test_timeout_then_retry_reuses_same_key(self, monkeypatch):
        calls = []
        fail_first = {"n": 0}

        def order_resp(req):
            fail_first["n"] += 1
            if fail_first["n"] == 1:
                raise httpx.ReadTimeout("t")
            return httpx.Response(200, json=ORDER_OK)
        mock_transport(monkeypatch, happy_handler(calls, order_response=order_resp))
        order = make_order(status="paid", product_id=make_mapped_product())
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 504
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["fazercards"]["status"] == "submit_timeout"
        rec = run(fzr_fulfillment.fulfill_order(order["id"], "test"))  # retry
        assert rec["provider_order_id"]
        assert len(calls) == 2 and calls[0]["idempotency_key"] == calls[1]["idempotency_key"]

    def test_insufficient_balance_maps_to_409_and_error_state(self, monkeypatch):
        resp = httpx.Response(400, json={"ok": False, "error": "Insufficient balance", "code": "insufficient_balance"})
        mock_transport(monkeypatch, happy_handler(order_response=resp))
        order = make_order(status="paid", product_id=make_mapped_product())
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and "Insufficient balance" in e.value.detail
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["fazercards"]["status"] == "error" and stored["fazercards"]["provider_order_id"] is None

    def test_provider_5xx_maps_to_502(self, monkeypatch):
        resp = httpx.Response(500, json={"ok": False, "error": "boom"})
        mock_transport(monkeypatch, happy_handler(order_response=resp))
        order = make_order(status="paid", product_id=make_mapped_product())
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 502


class TestStatusSync:
    def test_refresh_status_completed_delivers_mgs_order(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler())
        order = make_order(status="paid", product_id=make_mapped_product())
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        rec = run(fzr_fulfillment.refresh_status(order["id"], "test"))
        assert rec["provider_status"] == "completed"
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["status"] == "delivered"
        assert any(h["status"] == "delivered" for h in stored["history"])

    def test_refresh_without_provider_order_404(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler())
        order = make_order(status="paid")
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.refresh_status(order["id"], "test"))
        assert e.value.status_code == 404


class TestWebhook:
    SECRET = "whsec_test_123"

    def _sig(self, raw: bytes) -> str:
        return "sha256=" + hmac.new(self.SECRET.encode(), raw, hashlib.sha256).hexdigest()

    def test_signature_valid(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", self.SECRET)
        raw = b'{"event":"order.status_changed"}'
        assert verify_fzr_signature(raw, self._sig(raw)) is True

    def test_signature_invalid_or_missing_secret(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", self.SECRET)
        raw = b'{"event":"x"}'
        assert verify_fzr_signature(raw, "sha256=" + "0" * 64) is False
        monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", "")
        assert verify_fzr_signature(raw, self._sig(raw)) is False

    def test_webhook_event_completes_order(self, monkeypatch):
        h = happy_handler()
        mock_transport(monkeypatch, h)
        order = make_order(status="paid", product_id=make_mapped_product())
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        event = {"event": "order.status_changed", "event_id": str(uuid.uuid4()),
                 "timestamp": _now(), "data": {"order_id": h.provider_id, "type": "topup",
                                               "status": "completed", "previous_status": "processing"}}
        result = run(fzr_fulfillment.apply_webhook_event(event))
        assert result == {"ok": True}
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["status"] == "delivered" and stored["fazercards"]["provider_status"] == "completed"
        # replay same event_id → dédupliqué
        assert run(fzr_fulfillment.apply_webhook_event(event)).get("duplicate") is True

    def test_webhook_unknown_order_ignored(self):
        event = {"event": "order.status_changed", "event_id": str(uuid.uuid4()),
                 "data": {"order_id": f"ord-{uuid.uuid4().hex[:8]}", "status": "completed"}}
        assert run(fzr_fulfillment.apply_webhook_event(event)).get("ignored") is True

    def test_live_endpoint_rejects_unsigned(self):
        r = requests.post(f"{API}/fazercards/webhook", json={"event": "order.status_changed"}, timeout=15)
        assert r.status_code == 401


class TestPriceSnapshot:
    def test_price_change_never_touches_past_order(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler())
        order = make_order(status="paid", product_id=make_mapped_product())
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        run(db.fzr_offer_prices.update_one(
            {"category_id": "pubg_mobile_auto", "offer_id": "uc_60"},
            {"$set": {"price_usd": "0.9500", "updated_at": _now()}}, upsert=True))
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["fazercards"]["supplier_price_usd_at_order"] == "0.8800"

    def test_no_secret_in_fulfillment_record(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler())
        order = make_order(status="paid", product_id=make_mapped_product())
        rec = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        text = json.dumps(rec).lower()
        assert "fc_" not in text and "x-api-key" not in text and "fzr.cards" not in text


class TestAutoMode:
    def test_auto_disabled_by_default_no_order(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, happy_handler(calls))
        run(db.settings.update_one({"key": "store"}, {"$unset": {"fzr_auto": ""}}, upsert=True))
        order = make_order(status="paid", product_id=make_mapped_product())
        run(fzr_fulfillment.auto_fulfill(order))
        assert calls == []
        assert run(db.orders.find_one({"id": order["id"]}, {"_id": 0})).get("fazercards") is None

    def test_auto_enabled_creates_order_with_all_checks(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, happy_handler(calls))
        run(db.settings.update_one({"key": "store"}, {"$set": {"fzr_auto": True}}, upsert=True))
        try:
            order = make_order(status="paid", product_id=make_mapped_product())
            run(fzr_fulfillment.auto_fulfill(order))
            stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
            assert stored["fazercards"]["provider_order_id"]
            assert calls[0]["idempotency_key"] == f"{order['order_number']}-1"
        finally:
            run(db.settings.update_one({"key": "store"}, {"$set": {"fzr_auto": False}}))

    def test_auto_kill_switch_off_stops_fulfillment(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, happy_handler(calls))
        run(db.settings.update_one({"key": "store"}, {"$set": {"fzr_auto": False}}, upsert=True))
        order = make_order(status="paid", product_id=make_mapped_product())
        run(fzr_fulfillment.auto_fulfill(order))
        assert calls == []


class TestMemorizedIdRevalidation:
    """L'ID mémorisé passe toujours par validate-id (source de vérité FazerCards)."""

    def test_revalidation_returns_current_player_name(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler(validate={"ok": True, "valid": True, "player_name": "NouveauNom"}))
        result = run(fazercards.validate_pubg_id("52328390220"))
        assert result == {"valid": True, "player_name": "NouveauNom", "region": None}

    def test_id_became_invalid(self, monkeypatch):
        mock_transport(monkeypatch, happy_handler(validate={"ok": True, "valid": False}))
        assert run(fazercards.validate_pubg_id("52328390220")) == {"valid": False}

    def test_service_down_is_not_invalid_id(self, monkeypatch):
        def handler(req):
            if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
                return httpx.Response(200, json=VALIDATE_LIST)
            return httpx.Response(500, json={"ok": False})
        mock_transport(monkeypatch, handler)
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id("52328390220"))
        assert e.value.status_code == 502
