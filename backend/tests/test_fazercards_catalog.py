"""FazerCards Phase 2 — découverte catalogue PUBG (GET /topups + /topups/offers). Unit (mock) + live."""
import asyncio
import os
import sys

import httpx
import pytest
import requests
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services import fazercards  # noqa: E402

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
CATALOG = f"{API}/fazercards/pubg/catalog"

ADMIN_EMAIL = "admin@magicgame.store"
ADMIN_PASSWORD = "AdminLocal2026!"

RealAsyncClient = httpx.AsyncClient

PAGE1 = {"ok": True, "kind": "topup",
         "items": [{"category_id": "steam", "name": "Steam"},
                   {"category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)", "note": "Global"}],
         "meta": {"total": 4, "limit": 2, "next_cursor": "c2", "has_more": True}}
PAGE2 = {"ok": True, "kind": "topup",
         "items": [{"category_id": "pubg_mobile_manual", "name": "PUBG Mobile (Manual)"},
                   {"category_id": "pubg_new_state", "name": "PUBG: New State"}],
         "meta": {"total": 4, "limit": 2, "next_cursor": None, "has_more": False}}
OFFERS_BODY = {"ok": True, "kind": "topup", "category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)",
               "offers": [{"offer_id": "first_purchase_pack", "name": "First Purchase Pack", "price_usd": "0.8800"}],
               "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def clear_cache(monkeypatch):
    fazercards._catalog_cache.clear()
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
    yield
    fazercards._catalog_cache.clear()


def mock_transport(monkeypatch, handler):
    def factory(**kwargs):
        return RealAsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(fazercards.httpx, "AsyncClient", factory)


class TestCategoriesUnit:
    def test_pagination_merges_pages_and_filters_pubg(self, monkeypatch):
        seen = []
        def handler(req):
            seen.append(dict(req.url.params))
            return httpx.Response(200, json=PAGE2 if req.url.params.get("cursor") == "c2" else PAGE1)
        mock_transport(monkeypatch, handler)
        cats = run(fazercards.pubg_categories())
        assert len(seen) == 2 and seen[1].get("cursor") == "c2"
        ids = [c["category_id"] for c in cats]
        assert ids == ["pubg_mobile_auto", "pubg_mobile_manual"]  # steam + new_state exclus

    def test_pubg_absent_maps_to_503(self, monkeypatch):
        body = {"ok": True, "kind": "topup", "items": [{"category_id": "steam", "name": "Steam"}],
                "meta": {"total": 1, "limit": 200, "next_cursor": None, "has_more": False}}
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json=body))
        with pytest.raises(HTTPException) as e:
            run(fazercards.pubg_categories())
        assert e.value.status_code == 503

    def test_unexpected_response_maps_to_502(self, monkeypatch):
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json={"ok": True, "items": "oops"}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.pubg_categories())
        assert e.value.status_code == 502

    def test_timeout_maps_to_504(self, monkeypatch):
        def raise_timeout(req):
            raise httpx.ConnectTimeout("t")
        mock_transport(monkeypatch, raise_timeout)
        with pytest.raises(HTTPException) as e:
            run(fazercards.pubg_categories())
        assert e.value.status_code == 504

    def test_4xx_maps_to_502(self, monkeypatch):
        mock_transport(monkeypatch, lambda req: httpx.Response(400, json={"ok": False, "error": "bad"}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.pubg_categories())
        assert e.value.status_code == 502

    def test_5xx_maps_to_502_after_retry(self, monkeypatch):
        calls = []
        def handler(req):
            calls.append(1)
            return httpx.Response(500, json={"ok": False, "error": "boom"})
        mock_transport(monkeypatch, handler)
        with pytest.raises(HTTPException) as e:
            run(fazercards.pubg_categories())
        assert e.value.status_code == 502 and len(calls) == 2

    def test_categories_cached(self, monkeypatch):
        calls = []
        def handler(req):
            calls.append(1)
            body = dict(PAGE1); body["meta"] = {"total": 2, "limit": 200, "next_cursor": None, "has_more": False}
            return httpx.Response(200, json=body)
        mock_transport(monkeypatch, handler)
        run(fazercards.pubg_categories())
        run(fazercards.pubg_categories())
        assert len(calls) == 1


class TestOffersUnit:
    def test_offers_parsed_offer_id_price_fields(self, monkeypatch):
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json=OFFERS_BODY))
        result = run(fazercards.pubg_offers("pubg_mobile_auto"))
        assert result["category_id"] == "pubg_mobile_auto"
        offer = result["offers"][0]
        assert offer == {"offer_id": "first_purchase_pack", "name": "First Purchase Pack", "price_usd": "0.8800"}
        assert result["fields"] == [{"key": "player_id", "label": "Player ID", "type": "text"}]

    def test_offers_empty_list_ok(self, monkeypatch):
        body = dict(OFFERS_BODY); body = {**OFFERS_BODY, "offers": []}
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json=body))
        assert run(fazercards.pubg_offers("pubg_mobile_auto"))["offers"] == []

    def test_offers_missing_key_maps_to_502(self, monkeypatch):
        mock_transport(monkeypatch, lambda req: httpx.Response(200, json={"ok": True, "category_id": "x", "name": "X"}))
        with pytest.raises(HTTPException) as e:
            run(fazercards.pubg_offers("pubg_mobile_auto"))
        assert e.value.status_code == 502


class TestLiveCatalog:
    @pytest.fixture(scope="class")
    def admin(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200, f"admin login failed: {r.status_code}"
        return s

    def test_requires_admin(self):
        r = requests.get(CATALOG, timeout=15)
        assert r.status_code in (401, 403)

    def test_live_catalog_pubg_offers_and_fields(self, admin):
        r = admin.get(CATALOG, timeout=60)
        assert r.status_code == 200, r.text
        cats = r.json()["categories"]
        assert cats, "aucune catégorie PUBG"
        by_id = {c["category_id"]: c for c in cats}
        assert any("pubg_mobile" in cid for cid in by_id)
        auto = by_id.get("pubg_mobile_auto") or cats[0]
        assert auto["offers"], "aucune offre"
        offer = auto["offers"][0]
        assert offer["offer_id"] and offer["name"] and float(offer["price_usd"]) > 0
        assert any(f["key"] == "player_id" for f in auto["fields"])

    def test_no_secret_in_response(self, admin):
        r = admin.get(CATALOG, timeout=60)
        assert r.status_code == 200
        text = r.text.lower()
        assert "fc_" not in text and "x-api-key" not in text and "fzr.cards" not in text
