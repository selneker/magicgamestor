"""Décomposition INTERNE des produits UC composés au fulfillment fournisseur.
Le panier/prix client ne changent pas : 1 × 720 UC reste 1 ligne ; mais l'envoi fournisseur crée
660 UC + 60 UC (2 commandes FazerCards indépendantes, provider_order_id + idempotency propres)."""
import asyncio
import json
import uuid

import httpx
import pytest
from fastapi import HTTPException

from test_fzr_phase3 import (  # noqa: F401 — réutilise helpers + loop Phase 3
    _LOOP, OFFERS, VALIDATE_LIST, VALIDATE_OK, RealAsyncClient, _now,
    cleanup_test_artifacts, db, fazercards, fzr_fulfillment, make_order, run,
)

# Catalogue fournisseur simulé : offres UC DIRECTES uniquement (aucun SKU 720/120/…).
UC_OFFERS = [("uc_60", "60 UC", "0.8800"), ("uc_325", "325 UC", "4.3000"), ("uc_660", "660 UC", "8.4000"),
             ("uc_8100", "8100 UC", "80.0000"), ("first_purchase_pack", "First Purchase Pack", "0.5000")]
CAT_OFFERS = {**OFFERS, "offers": [{"offer_id": oid, "name": n, "price_usd": p} for oid, n, p in UC_OFFERS]}


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
    monkeypatch.setattr(fazercards.httpx, "AsyncClient", lambda **kw: RealAsyncClient(transport=httpx.MockTransport(handler)))


def handler_factory(order_calls, fail_indices=(), provider_status="processing"):
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if path.endswith("/topups/validate-id"):
            return httpx.Response(200, json=VALIDATE_OK)
        if path.endswith("/topups/offers"):
            return httpx.Response(200, json=CAT_OFFERS)
        if path.endswith("/topups/order"):
            n = len(order_calls)
            order_calls.append({"idempotency_key": req.headers.get("Idempotency-Key"), "body": json.loads(req.content)})
            if n in fail_indices:
                return httpx.Response(400, json={"ok": False, "error": "Insufficient balance", "code": "insufficient_balance"})
            return httpx.Response(200, json={"ok": True, "order": {"id": f"ord-c{n}-{uuid.uuid4().hex[:6]}", "kind": "topup", "status": provider_status}})
        if "/orders/" in path:
            return httpx.Response(200, json={"ok": True, "order": {"id": path.rsplit("/", 1)[-1], "kind": "topup", "status": "completed"}})
        return httpx.Response(404, json={"ok": False, "error": "not found"})
    return handler


def make_composite_product(uc_amount, components):
    """components: liste de (offer_id, offer_name, uc_amount, quantity)."""
    pid = str(uuid.uuid4())
    comps = [{"offer_id": o, "offer_name": n, "uc_amount": a, "quantity": q, "price_usd_at_link": "0.8800"}
             for (o, n, a, q) in components]
    run(db.products.insert_one({
        "id": pid, "slug": f"test-comp-{uc_amount}-{pid[:6]}", "type": "uc", "name": f"{uc_amount} UC",
        "price": 5000, "active": True,
        "fazercards_mapping": {"mode": "composite", "category_id": "pubg_mobile_auto", "confirmed": True,
                               "linked_at": _now(), "components": comps,
                               "total_uc": uc_amount, "total_price_usd_at_link": 1.0}}))
    return pid


def make_direct_product(offer_id, offer_name, name):
    pid = str(uuid.uuid4())
    run(db.products.insert_one({
        "id": pid, "slug": f"test-direct-{offer_id}-{pid[:6]}", "type": "uc", "name": name, "price": 5000, "active": True,
        "fazercards_mapping": {"mode": "direct", "category_id": "pubg_mobile_auto", "offer_id": offer_id,
                               "offer_name": offer_name, "price_usd_at_link": "0.8800", "confirmed": True, "linked_at": _now()}}))
    return pid


def order_with(pid, name):
    return make_order(status="paid", items=[{"product_id": pid, "slug": "s", "name": name, "type": "uc",
                                             "unit_price": 44500, "quantity": 1, "line_total": 44500}])


COMPOSITIONS = {
    120: [("uc_60", "60 UC", 60, 2)],
    180: [("uc_60", "60 UC", 60, 3)],
    720: [("uc_660", "660 UC", 660, 1), ("uc_60", "60 UC", 60, 1)],
    985: [("uc_660", "660 UC", 660, 1), ("uc_325", "325 UC", 325, 1)],
    1320: [("uc_660", "660 UC", 660, 2)],
    16200: [("uc_8100", "8100 UC", 8100, 2)],
}


class TestCompositeDecomposition:
    @pytest.mark.parametrize("uc_amount", list(COMPOSITIONS))
    def test_composite_expands_to_independent_orders(self, monkeypatch, uc_amount):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        comps = COMPOSITIONS[uc_amount]
        n_units = sum(q for *_, q in comps)
        order = order_with(make_composite_product(uc_amount, comps), f"{uc_amount} UC")
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        # 1 commande MGS → n_units commandes FazerCards indépendantes
        assert len(calls) == n_units
        assert len(out["results"]) == n_units and all(r["ok"] for r in out["results"])
        # provider_order_id distincts + clés d'idempotence distinctes et stables (L1-C1, L1-C2, …)
        pids = [r["fazercards"]["provider_order_id"] for r in out["results"]]
        assert len(set(pids)) == n_units
        keys = [c["idempotency_key"] for c in calls]
        assert keys == [f"{order['order_number']}-L1-C{i + 1}" for i in range(n_units)]
        # offres directes envoyées = composants attendus (aucune quantité inventée)
        sent_offers = sorted(c["body"]["offer_id"] for c in calls)
        expected = sorted([o for (o, _n, _a, q) in comps for _ in range(q)])
        assert sent_offers == expected
        # commande client intacte : 1 ligne, prix inchangé
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert len(stored["items"]) == 1 and stored["items"][0]["line_total"] == 44500
        assert list(stored["fazercards_components"]["0"].keys()) == [str(i) for i in range(n_units)]

    def test_direct_product_unchanged(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        order = order_with(make_direct_product("uc_60", "60 UC", "60 UC"), "60 UC")
        rec = run(fzr_fulfillment.fulfill_order(order["id"], "test"))  # mono-ligne directe → record historique
        assert len(calls) == 1 and calls[0]["idempotency_key"] == f"{order['order_number']}-1"
        assert rec["provider_order_id"] and rec.get("component_index") is None

    def test_composite_plus_other_product_all_independent(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        pid_720 = make_composite_product(720, COMPOSITIONS[720])
        pid_fp = make_direct_product("first_purchase_pack", "First Purchase Pack", "Premier achat")
        order = make_order(status="paid", items=[
            {"product_id": pid_720, "slug": "720", "name": "720 UC", "type": "uc", "unit_price": 44500, "quantity": 1, "line_total": 44500},
            {"product_id": pid_fp, "slug": "fp", "name": "Premier achat", "type": "uc", "unit_price": 2000, "quantity": 1, "line_total": 2000}])
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert len(calls) == 3 and len([r for r in out["results"] if r["ok"]]) == 3
        keys = {c["idempotency_key"] for c in calls}
        assert keys == {f"{order['order_number']}-L1-C1", f"{order['order_number']}-L1-C2", f"{order['order_number']}-L2-1"}

    def test_partial_failure_retry_only_failed_component(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls, fail_indices=(1,)))  # 2e composant (60 UC) échoue
        order = order_with(make_composite_product(720, COMPOSITIONS[720]), "720 UC")
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert out["results"][0]["ok"] is True and out["results"][1]["ok"] is False
        stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))
        assert stored["fazercards_components"]["0"]["0"]["provider_order_id"]  # 660 envoyé
        assert stored["fazercards_components"]["0"]["1"]["status"] == "error"   # 60 en erreur
        assert stored["status"] == "paid"  # succès partiel → pas delivered
        # retry : uniquement le composant 60, MÊME clé d'idempotence
        failed_key = calls[1]["idempotency_key"]
        calls2 = []
        mock_transport(monkeypatch, handler_factory(calls2))
        out2 = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert len(calls2) == 1 and calls2[0]["idempotency_key"] == failed_key == f"{order['order_number']}-L1-C2"
        assert len(out2["results"]) == 1 and out2["results"][0]["ok"]

    def test_all_sent_no_duplicate_on_second_click(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        order = order_with(make_composite_product(120, COMPOSITIONS[120]), "120 UC")
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and len(calls) == 2  # jamais renvoyé

    def test_concurrent_no_duplicate(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        order = order_with(make_composite_product(120, COMPOSITIONS[120]), "120 UC")

        async def both():
            return await asyncio.gather(
                fzr_fulfillment.fulfill_order(order["id"], "a"),
                fzr_fulfillment.fulfill_order(order["id"], "b"), return_exceptions=True)
        run(both())
        assert len(calls) == 2  # 2 composants → exactement 2 commandes fournisseur, jamais 4
        assert len({c["idempotency_key"] for c in calls}) == 2

    def test_all_components_completed_delivers_order(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        order = order_with(make_composite_product(720, COMPOSITIONS[720]), "720 UC")
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        rec = run(fzr_fulfillment.refresh_status(order["id"], "test"))  # mock /orders/ → completed
        assert all(l["fazercards"]["provider_status"] == "completed" for l in rec["lines"])
        assert run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))["status"] == "delivered"

    def test_payment_not_confirmed_no_fulfillment(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        pid = make_composite_product(120, COMPOSITIONS[120])
        order = make_order(status="pending_payment", items=[{"product_id": pid, "slug": "s", "name": "120 UC",
                                                             "type": "uc", "unit_price": 9000, "quantity": 1, "line_total": 9000}])
        with pytest.raises(HTTPException) as e:
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        assert e.value.status_code == 409 and calls == []

    def test_no_secret_in_response(self, monkeypatch):
        calls = []
        mock_transport(monkeypatch, handler_factory(calls))
        order = order_with(make_composite_product(985, COMPOSITIONS[985]), "985 UC")
        out = run(fzr_fulfillment.fulfill_order(order["id"], "test"))
        text = json.dumps(out).lower()
        assert "fc_" not in text and "x-api-key" not in text and "fzr.cards" not in text
