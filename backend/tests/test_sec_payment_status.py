"""SEC-FIND-FIX — IDOR sur le statut de paiement.

Un client authentifié ne doit jamais lire le statut de paiement d'une commande
appartenant à un autre client. Les commandes invité (sans `user_id`) restent
consultables publiquement, et le staff garde l'accès.
"""
import os
import random
import time
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


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _register(prefix="qa_sec_status"):
    email = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "Sec QA"},
                      headers=_ip())
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "user_id": data["user"]["user_id"],
            "headers": {"Authorization": f"Bearer {data['access_token']}"}}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _seed_paid_order(user_id):
    """Commande + tentative déjà `completed` : aucun appel réseau vers une passerelle."""
    order_id = str(uuid.uuid4())
    order_number = "MGS-" + uuid.uuid4().hex[:6].upper()
    mongo.orders.insert_one({
        "id": order_id, "order_number": order_number, "user_id": user_id, "email": None,
        "pubg_id": "5123456789", "pseudo": "Sec QA", "game_id": "pubg-mobile",
        "items": [{"product_id": "sec-status", "slug": "sec-status", "name": "Sec", "type": "uc",
                   "duration_months": None, "unit_price": 1000, "quantity": 1, "line_total": 1000}],
        "subtotal": 1000, "payment_fee": 0, "total": 1000, "currency": "Ar",
        "payment_method": "manual", "payment_provider": None, "payment_phone": None,
        "manual_reference": "SEC-STATUS", "status": "awaiting_verification", "admin_note": None,
        "created_at": _iso(), "updated_at": _iso(),
        "history": [{"status": "created", "at": _iso()}],
    })
    mongo.payments.insert_one({
        "order_id": order_id, "order_number": order_number, "attempt_no": 1,
        "client_ref": order_number, "provider": "manual", "gateway": "manual",
        "provider_ref": "sec-status", "amount": 1000, "status": "completed",
        "payment_url": None, "simulated": False,
        "created_at": _iso(), "updated_at": _iso(), "expires_at": _iso(),
    })
    return order_id


def _status(order_id, user=None):
    headers = _ip()
    if user:
        headers.update(user["headers"])
    return requests.get(f"{API}/payments/{order_id}/status", headers=headers)


def _make_staff(user):
    mongo.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": "admin"}})
    return user


class TestPaymentStatusOwnership:
    def test_other_customer_cannot_read_payment_status(self):
        owner = _register("qa_sec_status_owner")
        attacker = _register("qa_sec_status_attacker")
        order_id = _seed_paid_order(owner["user_id"])

        r = _status(order_id, attacker)
        assert r.status_code == 403, r.text

    def test_owner_and_staff_can_read_payment_status(self):
        owner = _register("qa_sec_status_owner2")
        staff = _make_staff(_register("qa_sec_status_staff"))
        order_id = _seed_paid_order(owner["user_id"])

        owner_response = _status(order_id, owner)
        assert owner_response.status_code == 200, owner_response.text
        assert owner_response.json()["payment_status"] == "completed"

        staff_response = _status(order_id, staff)
        assert staff_response.status_code == 200, staff_response.text

    def test_guest_order_status_stays_public(self):
        order_id = _seed_paid_order(None)

        assert _status(order_id).status_code == 200
        assert _status(order_id, _register("qa_sec_status_guest")).status_code == 200

    def test_unknown_order_still_404(self):
        response = requests.get(f"{API}/payments/{uuid.uuid4()}/status", headers=_ip())
        assert response.status_code == 404, response.text
