"""Batch fulfillment multi-lignes — une commande MGS, N fulfillments FazerCards indépendants."""
import asyncio
import json
import uuid

import httpx
import pytest
from fastapi import HTTPException

from test_fzr_phase3 import (  # noqa: F401 — réutilise helpers + loop Phase 3
    _LOOP, OFFERS, VALIDATE_LIST, VALIDATE_OK, RealAsyncClient, _now,
    cleanup_test_artifacts, db, fazercards, fzr_fulfillment, make_mapped_product, make_order, run,
)


@pytest.fixture(autouse=True)
def env_and_cache(monkeypatch):
    asyncio.set_event_loop(_LOOP)
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


MULTI_OFFERS = {**OFFERS, "offers": [{"offer_id": "uc_60", "name": "60 UC", "price_usd": "0.8800"},
                                     {"offer_id": "first_purchase_pack", "name": "First Purchase Pack", "price_usd": "0.8800"}]}


def multi_handler(order_calls: list, fail_indices=(), provider_status="processing"):
    """Chaque POST /topups/order reçoit un id unique ; fail_indices = n° d'appel (base 0) à faire échouer."""
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if path.endswith("/topups/validate-id"):
            return httpx.Response(200, json=VALIDATE_OK)
        if path.endswith("/topups/offers"):
            return httpx.Response(200, json=MULTI_OFFERS)
        if path.endswith("/topups/order"):
            n = len(order_calls)
            order_calls.append({"idempotency_key": req.headers.get("Idempotency-Key"), "body": json.loads(req.content)})
            if n in fail_indices:
                return httpx.Response(400, json={"ok": False, "error": "Insufficient balance", "code": "insufficient_balance"})
            return httpx.Response(200, json={"ok": True, "order": {"id": f"ord-m{n}-{uuid.uuid4().hex[:6]}", "kind": "topup", "status": provider_status}})
        if "/orders/" in path:
            return httpx.Response(200, json={"ok": True, "order": {"id": path.rsplit("/", 1)[-1], "kind": "topup", "status": "completed"}})
        return httpx.Response(404, json={"ok": False, "error": "not found"})
    return handler


def make_multi_order(n_mapped=2, extra_items=None, status="paid"):
    pids = [make_mapped_product() for _ in range(n_mapped)]
    items = [{"product_id": pid, "slug": f"p{i}", "name": f"Produit {i}", "type": "uc",
              "unit_price": 5000, "quantity": 1, "line_total": 5000} for i, pid in enumerate(pids)]
    return make_order(status=status, items=items + (extra_items or []))


class TestMultiLineFulfill:
    def test_two_lines_two_distinct_fulfillments(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2)
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert len(out["results"]) == 2 and all(r["ok"] for r in out["results"])
        assert len(calls) == 2
        keys = [c["idempotency_key"] for c in calls]
        assert keys[0] == f"{order['order_number']}-1" and keys[1] == f"{order['order_number']}-L2-1"
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        rec0, rec1 = stored["fazercards"], stored["fazercards_lines"]["1"]
        assert rec0["provider_order_id"] and rec1["provider_order_id"]
        assert rec0["provider_order_id"] != rec1["provider_order_id"]
        assert stored["status"] == "paid"  # processing fournisseur ⇒ pas delivered

    def test_three_lines_three_fulfillments(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(3)
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert len(calls) == 3 and len([r for r in out["results"] if r["ok"]]) == 3
        assert len({c["idempotency_key"] for c in calls}) == 3

    def test_no_fulfillable_line_no_send(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_order(status="paid", items=[
            {"product_id": str(uuid.uuid4()), "slug": "a", "name": "A", "type": "uc", "unit_price": 1, "quantity": 1, "line_total": 1},
            {"product_id": str(uuid.uuid4()), "slug": "b", "name": "B", "type": "uc", "unit_price": 1, "quantity": 1, "line_total": 1}])
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and calls == []

    def test_payment_not_confirmed_no_send(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2, status="pending_payment")
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and calls == []

    def test_qty_gt1_line_skipped_others_sent(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        pid2 = make_mapped_product()
        order = make_multi_order(1, extra_items=[{"product_id": pid2, "slug": "x2", "name": "60 UC x2",
                                                  "type": "uc", "unit_price": 5000, "quantity": 2, "line_total": 10000}])
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert len(calls) == 1 and len(out["results"]) == 1
        assert any("Quantité" in s["reason"] for s in out["skipped"])

    def test_partial_then_second_click_sends_only_remaining(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls, fail_indices=(1,)))  # 2e POST échoue
        order = make_multi_order(2)
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert out["results"][0]["ok"] is True and out["results"][1]["ok"] is False
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["fazercards"]["provider_order_id"]
        assert stored["fazercards_lines"]["1"]["status"] == "error"
        first_key_l2 = calls[1]["idempotency_key"]
        # deuxième clic : uniquement la ligne restante, même clé d'idempotence
        calls2 = []
        mock_transport(monkeypatch, multi_handler(calls2))
        out2 = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert len(calls2) == 1 and calls2[0]["idempotency_key"] == first_key_l2 == f"{order['order_number']}-L2-1"
        assert len(out2["results"]) == 1 and out2["results"][0]["ok"]

    def test_all_sent_second_click_rejected_no_duplicate(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2)
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and len(calls) == 2

    def test_concurrent_requests_no_duplicate(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2)

        async def both():
            return await asyncio.gather(
                fzr_fulfillment.fulfill_order(order["id"], "a"),
                fzr_fulfillment.fulfill_order(order["id"], "b"),
                return_exceptions=True)
        run(both())
        assert len(calls) == 2  # 2 lignes ⇒ exactement 2 commandes fournisseur, jamais 4
        assert len({c["idempotency_key"] for c in calls}) == 2

    def test_partial_status_not_delivered_until_all_completed(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2)
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        # ligne 0 completed, ligne 1 processing → MGS reste paid
        run(fzr_fulfillment._update_record(order["id"], 0, {"provider_status": "completed"}))
        run(fzr_fulfillment._sync_mgs_status(order["id"], "test"))
        assert run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))["status"] == "paid"
        # refresh → fournisseur renvoie completed pour toutes → delivered
        rec = run(fzr_fulfillment.refresh_status(order["id"], "test"))
        assert all(l["fazercards"]["provider_status"] == "completed" for l in rec["lines"])
        assert run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))["status"] == "delivered"

    def test_webhook_targets_correct_line(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2)
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        pid_line1 = stored["fazercards_lines"]["1"]["provider_order_id"]
        event = {"event": "order.status_changed", "event_id": str(uuid.uuid4()),
                 "data": {"order_id": pid_line1, "status": "completed", "previous_status": "processing"}}
        assert run(fzr_fulfillment.apply_webhook_event(event)) == {"ok": True}
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["fazercards_lines"]["1"]["provider_status"] == "completed"
        assert stored["fazercards"]["provider_status"] == "processing"  # ligne 0 intacte
        assert stored["status"] == "paid"  # pas toutes completed

    def test_no_secret_in_batch_response(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, multi_handler(calls))
        order = make_multi_order(2)
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        text = json.dumps(out).lower()
        assert "fc_" not in text and "x-api-key" not in text and "fzr.cards" not in text
