"""Phase 2 — frontière Provider / adapter FazerCards.

Vérifie que :
- l'adapter FazerCards respecte l'interface Provider ;
- les statuts fournisseur sont normalisés vers l'ensemble MGS ;
- la validation transmet des `fields` DYNAMIQUES (aucune hypothèse player_id rigide) ;
- create_order renvoie une commande normalisée et transfère l'Idempotency-Key ;
- la signature webhook est vérifiée sur le RAW BODY + l'événement est parsé ;
- les erreurs fournisseur sont normalisées (solde insuffisant) ;
- le fulfillment transmet GameIdentity.fields au provider sans payload PUBG hardcodé.

Appels FazerCards mockés (httpx). Aucun secret de production requis.
"""
import hashlib
import hmac
import json
import uuid

import httpx
import pytest

from test_fzr_phase3 import (OFFERS, VALIDATE_LIST, VALIDATE_OK, RealAsyncClient, db,  # noqa: F401
                             cleanup_test_artifacts, fazercards, fzr_fulfillment, make_mapped_product,
                             make_order, run)

from services import providers
from services.providers import errors as perr
from services.providers.base import (IdentityValidation, OrderStatus, Provider, ProviderOrder,
                                      ProviderWebhookEvent)


@pytest.fixture(autouse=True)
def env_and_cache(monkeypatch):
    fazercards._catalog_cache.clear()
    fazercards._discovery_cache["data"] = None
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
    yield
    fazercards._catalog_cache.clear()
    fazercards._discovery_cache["data"] = None


def mock_transport(monkeypatch, handler):
    monkeypatch.setattr(fazercards.httpx, "AsyncClient",
                        lambda **kw: RealAsyncClient(transport=httpx.MockTransport(handler)))


def test_adapter_implements_provider_interface():
    prov = providers.get_provider("pubg-mobile")
    assert isinstance(prov, Provider) and prov.name == "fazercards"
    assert providers.get_provider("pubg-mobile") is prov  # registry : instance réutilisée
    # Un jeu inconnu retombe sur le provider par défaut (un seul provider en Phase 2).
    assert providers.get_provider("future-game").name == "fazercards"


def test_status_normalization_maps_to_mgs_set():
    prov = providers.get_provider("pubg-mobile")
    assert prov.normalize_status("processing") == OrderStatus.PROCESSING
    assert prov.normalize_status("completed") == OrderStatus.COMPLETED
    assert prov.normalize_status("refunded") == OrderStatus.REFUND
    assert prov.normalize_status("failed") == OrderStatus.FAILED
    assert prov.normalize_status("cancelled") == OrderStatus.FAILED
    assert prov.normalize_status("created") == OrderStatus.CREATED
    assert prov.normalize_status("totally-unknown") == OrderStatus.PROCESSING
    assert prov.normalize_status(None) == OrderStatus.PROCESSING


def test_validate_identity_passes_dynamic_fields(monkeypatch):
    captured = {}

    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        captured["body"] = json.loads(req.content)
        return httpx.Response(200, json={"ok": True, "valid": True, "player_name": "Zed", "region": "ASIA"})
    mock_transport(monkeypatch, handler)
    prov = providers.get_provider("pubg-mobile")
    res = run(prov.validate_identity("pubg-mobile", {"player_id": "123456", "zone_id": "2214"}))
    assert isinstance(res, IdentityValidation) and res.valid
    assert res.player_name == "Zed" and res.region == "ASIA"
    # Les champs dynamiques sont transmis tels quels : aucune hypothèse "player_id seul".
    assert captured["body"]["fields"] == {"player_id": "123456", "zone_id": "2214"}


def test_create_order_returns_normalized_and_forwards_idempotency(monkeypatch):
    calls = []

    def handler(req):
        if req.url.path.endswith("/topups/order"):
            calls.append(req.headers.get("Idempotency-Key"))
            return httpx.Response(200, json={"ok": True, "order": {"id": "ord-xyz", "kind": "topup", "status": "processing"}})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    prov = providers.get_provider("pubg-mobile")
    po = run(prov.create_order("pubg_mobile_auto", "uc_60", {"player_id": "1"}, "MGS-ABC-1"))
    assert isinstance(po, ProviderOrder) and po.id == "ord-xyz"
    assert po.status == "processing" and po.normalized_status == OrderStatus.PROCESSING
    assert calls == ["MGS-ABC-1"]  # Idempotency-Key transmise à FazerCards


def test_webhook_signature_and_parse(monkeypatch):
    secret = "whsec_phase2"
    monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", secret)
    prov = providers.get_provider("pubg-mobile")
    raw = (b'{"event":"order.status_changed","event_id":"evt-1",'
           b'"data":{"order_id":"ord-1","status":"completed","previous_status":"processing"}}')
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    assert prov.verify_webhook_signature(raw, sig) is True
    assert prov.verify_webhook_signature(raw, "sha256=" + "0" * 64) is False
    monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", "")
    assert prov.verify_webhook_signature(raw, sig) is False  # secret vide = rejet
    monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", secret)
    evt = prov.parse_webhook_event(json.loads(raw))
    assert isinstance(evt, ProviderWebhookEvent)
    assert evt.event_id == "evt-1" and evt.event == "order.status_changed"
    assert evt.provider_order_id == "ord-1" and evt.status == "completed" and evt.previous_status == "processing"


def test_provider_error_normalized(monkeypatch):
    def handler(req):
        if req.url.path.endswith("/topups/order"):
            return httpx.Response(400, json={"ok": False, "error": "Insufficient balance", "code": "insufficient_balance"})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    with pytest.raises(perr.ProviderInsufficientBalanceError) as e:
        run(fazercards.create_topup_order("c", "o", {"player_id": "1"}, "k"))
    assert isinstance(e.value, perr.ProviderOrderError)  # sous-type : les handlers existants le captent toujours
    assert e.value.status_code == 400 and e.value.code == "insufficient_balance"
    assert fazercards.ProviderOrderError is perr.ProviderOrderError  # compat : même classe


def test_fulfillment_transmits_identity_fields_dynamically(monkeypatch):
    """Le core ne reconstruit pas un payload PUBG : il transmet GameIdentity.fields (incl. zone_id)."""
    calls = []

    def handler(req):
        p = req.url.path
        if p.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if p.endswith("/topups/validate-id"):
            return httpx.Response(200, json=VALIDATE_OK)
        if p.endswith("/topups/offers"):
            return httpx.Response(200, json=OFFERS)
        if p.endswith("/topups/order"):
            calls.append(json.loads(req.content))
            return httpx.Response(200, json={"ok": True, "order": {"id": f"ord-{uuid.uuid4().hex[:6]}", "status": "processing"}})
        if "/orders/" in p:
            return httpx.Response(200, json={"ok": True, "order": {"id": "x", "status": "completed"}})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    order = make_order(status="paid", product_id=make_mapped_product())
    run(db.orders.update_one({"id": order["id"]}, {"$set": {"identity_snapshot": {
        "source": "identity", "fields": {"player_id": order["pubg_id"], "zone_id": "2214"}}}}))
    run(fzr_fulfillment.fulfill_order(order["id"], "test"))
    assert len(calls) == 1
    assert calls[0]["fields"] == {"player_id": order["pubg_id"], "zone_id": "2214"}


def test_legacy_order_without_snapshot_falls_back_to_pubg_id(monkeypatch):
    """Commande legacy (aucun identity_snapshot) : repli sur {player_id: pubg_id}. Aucune régression."""
    calls = []

    def handler(req):
        p = req.url.path
        if p.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if p.endswith("/topups/validate-id"):
            return httpx.Response(200, json=VALIDATE_OK)
        if p.endswith("/topups/offers"):
            return httpx.Response(200, json=OFFERS)
        if p.endswith("/topups/order"):
            calls.append(json.loads(req.content))
            return httpx.Response(200, json={"ok": True, "order": {"id": f"ord-{uuid.uuid4().hex[:6]}", "status": "processing"}})
        return httpx.Response(404, json={"ok": False})
    mock_transport(monkeypatch, handler)
    order = make_order(status="paid", product_id=make_mapped_product())  # pas d'identity_snapshot
    run(fzr_fulfillment.fulfill_order(order["id"], "test"))
    assert len(calls) == 1 and calls[0]["fields"] == {"player_id": order["pubg_id"]}
