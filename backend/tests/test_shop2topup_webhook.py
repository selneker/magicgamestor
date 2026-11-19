"""PL-006-T08C-V1 — route webhook Shop2Topup.

La route est testée sur une application FastAPI minimale (pas le serveur complet) : signature sur
le corps brut, `503` sans secret, `401` sur signature fausse, `400` sur corps non-objet, et
délégation à `apply_shop2topup_event` une fois la signature valide. Aucun réseau, aucune base.
"""
import hashlib
import hmac
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import shop2topup_webhook
from services import order_maintenance

SECRET = "sentinelle-webhook-shop2topup"
HEADER = shop2topup_webhook.SIGNATURE_HEADER


@pytest.fixture
def app():
    application = FastAPI()
    application.include_router(shop2topup_webhook.router)
    return application


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_WEBHOOK_SECRET", SECRET)


def sign(raw: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


@pytest.fixture
def applied(monkeypatch):
    calls = []

    async def fake_apply(payload):
        calls.append(payload)
        return {"ok": True}

    monkeypatch.setattr(order_maintenance, "apply_shop2topup_event", fake_apply)
    return calls


def test_secret_absent_repond_503(app, monkeypatch, applied):
    monkeypatch.delenv("SHOP2TOPUP_WEBHOOK_SECRET", raising=False)
    raw = json.dumps({"event": "order.status_changed", "data": {"order_id": "x"}}).encode()

    response = TestClient(app).post("/shop2topup/webhook", content=raw,
                                    headers={HEADER: sign(raw)})

    assert response.status_code == 503
    assert applied == []


def test_signature_fausse_repond_401(app, applied):
    raw = json.dumps({"event": "order.status_changed", "data": {"order_id": "x"}}).encode()

    response = TestClient(app).post("/shop2topup/webhook", content=raw,
                                    headers={HEADER: "sha256=" + "0" * 64})

    assert response.status_code == 401
    assert applied == []


def test_en_tete_absent_repond_401(app, applied):
    raw = json.dumps({"event": "order.status_changed", "data": {"order_id": "x"}}).encode()

    response = TestClient(app).post("/shop2topup/webhook", content=raw)

    assert response.status_code == 401
    assert applied == []


def test_corps_non_json_repond_400(app, applied):
    raw = b"pas du json"

    response = TestClient(app).post("/shop2topup/webhook", content=raw,
                                    headers={HEADER: sign(raw)})

    assert response.status_code == 400
    assert applied == []


def test_corps_json_non_objet_repond_400(app, applied):
    raw = b"[]"

    response = TestClient(app).post("/shop2topup/webhook", content=raw,
                                    headers={HEADER: sign(raw)})

    assert response.status_code == 400
    assert applied == []


def test_signature_valide_delegue_l_evenement(app, applied):
    payload = {"event": "order.status_changed",
               "data": {"order_id": "s2t-1", "status": "completed"}}
    raw = json.dumps(payload).encode()

    response = TestClient(app).post("/shop2topup/webhook", content=raw,
                                    headers={HEADER: sign(raw)})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert applied == [payload]
