"""FazerCards Phase 1 — PUBG Mobile validate-id. Unit tests (mocked httpx) + live integration tests."""
import asyncio
import json
import os
import sys

import httpx
import pytest
import requests
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import fazercards  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ENDPOINT = f"{API}/fazercards/pubg/validate-id"

VALID_PUBG_ID = "5123456789"
INVALID_PUBG_ID = "999999999"

DISCOVERY_BODY = {"ok": True, "kind": "topup", "items": [
    {"category_id": "pubg_mobile", "name": "PUBG Mobile", "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}
]}

RealAsyncClient = httpx.AsyncClient


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def clear_cache():
    fazercards._discovery_cache["data"] = None
    fazercards._discovery_cache["at"] = 0.0
    yield


def mock_transport(monkeypatch, handler):
    def factory(**kwargs):
        return RealAsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(fazercards.httpx, "AsyncClient", factory)


# ---------- unit: configuration / provider errors ----------

class TestServiceErrors:
    def test_missing_key_returns_503(self, monkeypatch):
        monkeypatch.delenv("FAZERCARDS_API_KEY", raising=False)
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 503

    def test_invalid_key_maps_to_502_provider_error(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        mock_transport(monkeypatch, lambda req: httpx.Response(401, json={"ok": False, "error": "Unauthorized"}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 502
        assert "invalide" not in e.value.detail.lower()  # never masked as "invalid ID"

    def test_timeout_maps_to_504(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        def raise_timeout(req):
            raise httpx.ConnectTimeout("timeout")
        mock_transport(monkeypatch, raise_timeout)
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 504

    def test_network_error_maps_to_502(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        def raise_net(req):
            raise httpx.ConnectError("refused")
        mock_transport(monkeypatch, raise_net)
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 502

    def test_unexpected_response_maps_to_502(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json={"foo": "bar"}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 502

    def test_provider_5xx_maps_to_502(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        mock_transport(monkeypatch, lambda req: httpx.Response(500, json={"ok": False, "error": "boom"}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 502

    def test_valid_response_parsed_with_player_name(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        def handler(req):
            if req.method == "GET":
                return httpx.Response(200, json=DISCOVERY_BODY)
            body = json.loads(req.content)
            assert body["category_id"] == "pubg_mobile"
            assert body["fields"] == {"player_id": VALID_PUBG_ID}
            return httpx.Response(200, json={"ok": True, "category_id": "pubg_mobile", "valid": True,
                                             "player_name": "TestPlayer", "region": "EUROPE"})
        mock_transport(monkeypatch, handler)
        result = run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert result == {"valid": True, "player_name": "TestPlayer", "region": "EUROPE"}

    def test_invalid_id_parsed(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        def handler(req):
            if req.method == "GET":
                return httpx.Response(200, json=DISCOVERY_BODY)
            return httpx.Response(200, json={"ok": True, "category_id": "pubg_mobile", "valid": False, "player_name": None})
        mock_transport(monkeypatch, handler)
        assert run(fazercards.validate_pubg_id("123456789")) == {"valid": False}

    def test_pubg_not_in_discovery_maps_to_503(self, monkeypatch):
        monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json={"ok": True, "kind": "topup", "items": []}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.validate_pubg_id(VALID_PUBG_ID))
        assert e.value.status_code == 503


# ---------- live integration: MGS endpoint -> FazerCards ----------

class TestLiveEndpoint:
    def test_valid_id_returns_player_name(self):
        r = requests.post(ENDPOINT, json={"player_id": VALID_PUBG_ID}, timeout=40)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is True
        assert isinstance(data["player_name"], str) and data["player_name"]

    def test_invalid_id_returns_valid_false(self):
        # FazerCards upstream is intermittently flaky on unknown IDs -> tolerate provider 502 retries
        for _ in range(3):
            r = requests.post(ENDPOINT, json={"player_id": INVALID_PUBG_ID}, timeout=60)
            if r.status_code == 200:
                break
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is False
        assert data["message"] == "ID PUBG Mobile invalide"

    def test_empty_id_rejected_422(self):
        r = requests.post(ENDPOINT, json={"player_id": "   "}, timeout=15)
        assert r.status_code == 422

    def test_malformed_id_rejected_422(self):
        for bad in ("abc123456", "123", "1" * 25):
            r = requests.post(ENDPOINT, json={"player_id": bad}, timeout=15)
            assert r.status_code == 422, bad

    def test_no_secret_or_raw_leak_in_response(self):
        r = requests.post(ENDPOINT, json={"player_id": VALID_PUBG_ID}, timeout=40)
        assert r.status_code == 200
        text = r.text.lower()
        assert "fc_" not in text
        assert "x-api-key" not in text
        assert "fzr.cards" not in text
        assert set(r.json().keys()) <= {"valid", "player_name", "region", "message"}
