"""Backend hardening: fail-closed delivery rule, recovery of stuck `creating` attempts, server-side
provider identity check. Mocked FazerCards transport + local Mongo only (no real provider/payment)."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import requests
from fastapi import HTTPException

from test_fzr_phase3 import (API, VALIDATE_LIST, db, env_and_cache, make_order, mock_transport,  # noqa: F401
                             run)
from core.games import game_has_sellable_catalog, product_deliverable
from routers import orders as orders_router
from services import fzr_fulfillment

MAP = {"category_id": "pubg_mobile_auto", "offer_id": "uc_60", "offer_name": "60 UC", "confirmed": True}


# ---------------------------------------------------------------- Priority 1: delivery rule
def test_requires_mapping_false_is_not_a_bypass_for_non_pubg_games():
    game = {"id": "codm", "fazercards_categories_configured": True, "fazercards_categories": ["codm_cat"]}
    assert product_deliverable({"requires_mapping": False}, game) is False
    assert product_deliverable({"requires_mapping": True}, game) is False
    assert product_deliverable({"fazercards_mapping": {**MAP, "category_id": "codm_cat"}}, game) is True


def test_mapping_must_be_scoped_to_the_games_categories():
    game = {"id": "codm", "fazercards_categories_configured": True, "fazercards_categories": ["codm_cat"]}
    assert product_deliverable({"fazercards_mapping": MAP}, game) is False  # PUBG category on another game
    assert product_deliverable({"fazercards_mapping": {**MAP, "confirmed": False, "category_id": "codm_cat"}}, game) is False


def test_pubg_legacy_manual_delivery_preserved():
    pubg = {"id": "pubg-mobile"}
    assert product_deliverable({"requires_mapping": False}, pubg) is True
    assert product_deliverable({"requires_mapping": True}, pubg) is False
    assert product_deliverable({"requires_mapping": True, "fazercards_mapping": MAP}, pubg) is True


def test_unmapped_active_product_does_not_make_a_game_sellable():
    gid = f"tst-hard-{uuid.uuid4().hex[:6]}"
    run(db.games.insert_one({"id": gid, "name": "X", "active": False, "fazercards_categories_configured": True,
                             "fazercards_categories": ["x_cat"]}))
    try:
        run(db.products.insert_one({"id": str(uuid.uuid4()), "slug": f"{gid}-p", "type": "cp", "name": "P",
                                    "price": 1, "active": True, "requires_mapping": False, "game_id": gid}))
        assert run(game_has_sellable_catalog(gid)) is False
        run(db.products.update_one({"slug": f"{gid}-p"}, {"$set": {"fazercards_mapping": {**MAP, "category_id": "x_cat"}}}))
        assert run(game_has_sellable_catalog(gid)) is True
    finally:
        run(db.games.delete_one({"id": gid}))
        run(db.products.delete_many({"game_id": gid}))


def test_free_fire_still_not_public():
    assert (run(db.games.find_one({"id": "free-fire"}, {"_id": 0, "active": 1})) or {}).get("active") is not True
    assert requests.get(f"{API}/products?game=free-fire", timeout=15).json() == []


# ---------------------------------------------------------------- Priority 2: recovery
def _stuck_order(minutes_ago=30, status="creating"):
    order = make_order()
    at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    rec = {"provider": "fazercards", "status": status, "provider_order_id": None, "provider_status": None,
           "line_index": 0, "component_index": None, "quantity_index": 0, "category_id": "pubg_mobile_auto",
           "offer_id": "uc_60", "identity_snapshot": {"player_id": order["pubg_id"]},
           "idempotency_key": f"{order['order_number']}-1", "created_at": at, "updated_at": at}
    run(db.orders.update_one({"id": order["id"]}, {"$set": {"fazercards": rec}}))
    return order, rec


def _order_handler(calls, response):
    def handler(req):
        if req.url.path.endswith("/topups/order"):
            calls.append(req.headers.get("Idempotency-Key"))
            return response(req) if callable(response) else response
        return httpx.Response(404, json={"ok": False})
    return handler


def test_fresh_creating_is_never_touched(monkeypatch):
    calls = []
    mock_transport(monkeypatch, _order_handler(calls, httpx.Response(200, json={"ok": True, "order": {"id": "x", "status": "processing"}})))
    order, _ = _stuck_order(minutes_ago=1)
    out = run(fzr_fulfillment.reconcile_order(order["id"], "test"))
    assert out["results"] == [] and calls == []
    # and the normal fulfill path refuses to claim an in-flight unit
    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment._fulfill_unit(run(db.orders.find_one({"id": order["id"]}, {"_id": 0})), {
            "index": 0, "component_index": None, "path": "fazercards", "product": "60 UC", "category_id": "pubg_mobile_auto",
            "offer_id": "uc_60", "offer_name": "60 UC", "price_usd": "0.88", "idempotency_key": f"{order['order_number']}-1",
            "field_key": "player_id"}, "test"))
    assert exc.value.status_code == 409 and calls == []


def test_stale_creating_reconciled_with_same_idempotency_key(monkeypatch):
    calls = []
    mock_transport(monkeypatch, _order_handler(calls, httpx.Response(200, json={"ok": True, "order": {"id": "ord-replayed", "status": "processing"}})))
    order, rec = _stuck_order()
    out = run(fzr_fulfillment.reconcile_order(order["id"], "test"))
    assert calls == [rec["idempotency_key"]]
    saved = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))["fazercards"]
    assert saved["status"] == "submitted" and saved["provider_order_id"] == "ord-replayed"
    assert saved["idempotency_key"] == rec["idempotency_key"] and out["results"][0]["ok"] is True
    # second run: nothing left to reconcile, no further provider call
    run(fzr_fulfillment.reconcile_order(order["id"], "test"))
    assert len(calls) == 1
    assert run(db.audit_logs.find_one({"target": order["id"], "action": "fzr.reconciled"})) is not None


@pytest.mark.parametrize("response,expected", [
    (lambda req: (_ for _ in ()).throw(httpx.ReadTimeout("t")), "needs_reconciliation"),
    (httpx.Response(409, json={"ok": False, "error": "idempotency conflict"}), "needs_reconciliation"),
])
def test_undetermined_outcome_stays_flagged(monkeypatch, response, expected):
    calls = []
    mock_transport(monkeypatch, _order_handler(calls, response))
    order, rec = _stuck_order()
    run(fzr_fulfillment.reconcile_order(order["id"], "test"))
    saved = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))["fazercards"]
    assert saved["status"] == expected and saved["provider_order_id"] is None
    assert saved["idempotency_key"] == rec["idempotency_key"]
    assert saved["status"] not in fzr_fulfillment.RETRYABLE  # never picked up by automatic retries
    assert [p for p, _ in fzr_fulfillment.recoverable_units(run(db.orders.find_one({"id": order["id"]}, {"_id": 0})))] == ["fazercards"]


def test_concurrent_reconcilers_replay_a_unit_once(monkeypatch):
    calls = []
    mock_transport(monkeypatch, _order_handler(calls, httpx.Response(200, json={"ok": True, "order": {"id": "ord-once", "status": "processing"}})))
    order, _ = _stuck_order()

    async def both():
        return await asyncio.gather(fzr_fulfillment.reconcile_order(order["id"], "a"),
                                    fzr_fulfillment.reconcile_order(order["id"], "b"))
    results = run(both())
    assert len(calls) == 1
    statuses = [r["status"] for out in results for r in out["results"]]
    assert statuses.count("submitted") == 1


# ---------------------------------------------------------------- Priority 3: server-side identity
def _validate_handler(valid=None, exc=None):
    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if req.url.path.endswith("/topups/validate-id"):
            if exc:
                raise exc
            return httpx.Response(200, json={"ok": True, "valid": valid, "player_name": "Kapotue" if valid else None})
        return httpx.Response(404)
    return handler


def test_provider_valid_id_marks_snapshot_validated(monkeypatch):
    mock_transport(monkeypatch, _validate_handler(valid=True))
    out = run(orders_router._provider_identity_check("pubg-mobile", {"player_id": "5123456789"}))
    assert out["validated"] is True and out["provider_check"] == "valid"


def test_provider_invalid_id_blocks_order_before_payment(monkeypatch):
    mock_transport(monkeypatch, _validate_handler(valid=False))
    with pytest.raises(HTTPException) as exc:
        run(orders_router._provider_identity_check("pubg-mobile", {"player_id": "5123456789"}))
    assert exc.value.status_code == 422


@pytest.mark.parametrize("err", [httpx.ReadTimeout("t"), httpx.ConnectError("down")])
def test_provider_timeout_or_outage_does_not_block_but_is_not_validated(monkeypatch, err):
    mock_transport(monkeypatch, _validate_handler(exc=err))
    out = run(orders_router._provider_identity_check("pubg-mobile", {"player_id": "5123456789"}))
    assert out == {**out, "validated": False, "provider_check": "unavailable"}


def test_provider_not_configured_is_reported_honestly(monkeypatch):
    monkeypatch.delenv("FAZERCARDS_API_KEY")
    out = run(orders_router._provider_identity_check("pubg-mobile", {"player_id": "5123456789"}))
    assert out["validated"] is False and out["provider_check"] == "not_configured"


def test_direct_api_cannot_forge_validation_or_send_malformed_ids():
    pubg = requests.get(f"{API}/products?game=pubg-mobile&type=uc", timeout=15).json()
    assert pubg
    base = {"game_id": "pubg-mobile", "pseudo": "Direct", "items": [{"product_id": pubg[0]["id"], "quantity": 1}],
            "payment_method": "manual", "manual_reference": "mvola:HARD1"}
    for bad in ("12345678", "12345678901234", "1234567890a"):
        r = requests.post(f"{API}/orders", json={**base, "pubg_id": bad}, timeout=15)
        assert r.status_code in (400, 422), (bad, r.status_code)
    r = requests.post(f"{API}/orders", json={**base, "pubg_id": "5123456789", "validated": True,
                                             "identity_snapshot": {"validated": True}}, timeout=15)
    assert r.status_code == 201, r.text
    snap = run(db.orders.find_one({"id": r.json()["id"]}, {"_id": 0, "identity_snapshot": 1}))["identity_snapshot"]
    assert snap["validated"] is False and snap["provider_check"] in ("not_configured", "unavailable")
    run(db.orders.delete_one({"id": r.json()["id"]}))
