"""SEC-FIND-FIX — suivi public de commande : PII et absence de limitation.

`GET /orders/track` est public (numéro de commande à 24 bits + identifiant joueur).
Il ne doit exposer ni l'email ni le téléphone de paiement, et doit être limité par IP
pour rendre le balayage de numéros de commande inexploitable.
"""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _seed_order(email="victime@example.test", phone="0341234567"):
    order_id = str(uuid.uuid4())
    order_number = "MGS-" + uuid.uuid4().hex[:6].upper()
    mongo.orders.insert_one({
        "id": order_id, "order_number": order_number, "user_id": None,
        "email": email, "pubg_id": "5123456789", "pseudo": "Suivi Public", "game_id": "pubg-mobile",
        "items": [{"product_id": "sec-track", "slug": "sec-track", "name": "Sec", "type": "uc",
                   "duration_months": None, "unit_price": 1000, "quantity": 1, "line_total": 1000}],
        "subtotal": 1000, "payment_fee": 0, "total": 1000, "currency": "Ar",
        "payment_method": "manual", "payment_provider": None, "payment_phone": phone,
        "manual_reference": "SEC-TRACK", "status": "delivered", "admin_note": None,
        "created_at": _iso(), "updated_at": _iso(),
        "history": [{"status": "created", "at": _iso()}],
    })
    return order_number


def _track(order_number, ip):
    return requests.get(f"{API}/orders/track",
                        params={"order_number": order_number, "pubg_id": "5123456789"},
                        headers={"X-Forwarded-For": ip})


class TestPublicOrderTracking:
    def test_tracking_does_not_expose_contact_pii(self):
        order_number = _seed_order()
        r = _track(order_number, "198.51.100.10")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["order_number"] == order_number
        assert body["pubg_id"] == "5123456789"
        assert "email" not in body
        assert "payment_phone" not in body

    def test_tracking_is_rate_limited_per_ip(self):
        from core import ratelimit as rl
        limit = rl.setting("ORDER_TRACK_PER_HOUR_PER_IP", 20)
        order_number = _seed_order(email=None, phone=None)
        codes = [_track(order_number, "198.51.100.77").status_code for _ in range(limit + 1)]
        assert codes[0] == 200
        assert codes[-1] == 429, codes

    def test_unknown_order_still_404(self):
        r = _track("MGS-000000", "198.51.100.99")
        assert r.status_code == 404, r.text
