"""SEC-FIND-FIX — contrôles de sécurité déjà en place (tests de non-régression).

Ces tests ne prouvent pas un correctif : ils figent les protections vérifiées
pendant l'audit (jetons, hachage, verrouillage, IDOR, opérateurs Mongo, webhooks,
jeton cron). Ils tournent contre un backend local et une base Mongo locale.
"""
import hashlib
import hmac
import json
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt as pyjwt
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]
SECRET = _env["PAPI_WEBHOOK_SECRET"]


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _iso(delta_minutes=0):
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()


def _register(prefix="qa_sec_reg"):
    email = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "Sec Reg"},
                      headers=_ip())
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "password": "Secret123!", "user_id": data["user"]["user_id"],
            "headers": {"Authorization": f"Bearer {data['access_token']}"}}


def _seed_order(user_id=None, status="delivered", pseudo="Sec Reg", email=None):
    order_id = str(uuid.uuid4())
    order_number = "MGS-" + uuid.uuid4().hex[:6].upper()
    mongo.orders.insert_one({
        "id": order_id, "order_number": order_number, "user_id": user_id,
        "email": email, "pubg_id": "5123456789", "pseudo": pseudo, "game_id": "pubg-mobile",
        "items": [{"product_id": "sec-reg", "slug": "sec-reg", "name": "Sec", "type": "uc",
                   "duration_months": None, "unit_price": 1000, "quantity": 1, "line_total": 1000}],
        "subtotal": 1000, "payment_fee": 0, "total": 1000, "currency": "Ar",
        "payment_method": "manual", "payment_provider": None, "payment_phone": "0341234567",
        "manual_reference": "SEC-REG", "status": status, "admin_note": None,
        "created_at": _iso(), "updated_at": _iso(),
        "history": [{"status": "created", "at": _iso()}],
    })
    return order_id, order_number


class TestAuthControls:
    def test_expired_access_token_rejected(self):
        user = _register("qa_sec_reg_expired")
        expired = pyjwt.encode({"sub": user["user_id"], "type": "access", "v": 0,
                                "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
                               _env["JWT_SECRET"], algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={**_ip(), "Authorization": f"Bearer {expired}"})
        assert r.status_code == 401, r.text

    def test_tampered_access_token_rejected(self):
        user = _register("qa_sec_reg_tampered")
        token = user["headers"]["Authorization"].split(" ", 1)[1]
        tampered = token[:-1] + ("a" if token[-1] != "a" else "b")
        r = requests.get(f"{API}/auth/me", headers={**_ip(), "Authorization": f"Bearer {tampered}"})
        assert r.status_code == 401, r.text

    def test_password_is_stored_hashed(self):
        user = _register("qa_sec_reg_hash")
        stored = mongo.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 1})
        assert stored["password_hash"] != user["password"]
        assert stored["password_hash"].startswith(("$2a$", "$2b$", "$2y$"))

    def test_login_locks_after_repeated_failures(self):
        email = f"qa_sec_reg_lock_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
        ip = f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"
        codes = [requests.post(f"{API}/auth/login", json={"email": email, "password": "WrongPass123!"},
                               headers={"X-Forwarded-For": ip}).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5
        assert codes[-1] == 429, codes


class TestIdorControls:
    def test_other_customer_cannot_read_order(self):
        owner, attacker = _register("qa_sec_reg_owner"), _register("qa_sec_reg_attacker")
        order_id, _ = _seed_order(owner["user_id"])
        assert requests.get(f"{API}/orders/{order_id}", headers={**_ip(), **attacker["headers"]}).status_code == 403
        assert requests.get(f"{API}/orders/{order_id}", headers={**_ip(), **owner["headers"]}).status_code == 200

    def test_profile_is_bound_to_token(self):
        first, second = _register("qa_sec_reg_me1"), _register("qa_sec_reg_me2")
        assert requests.get(f"{API}/auth/me", headers={**_ip(), **first["headers"]}).json()["email"] == first["email"]
        assert requests.get(f"{API}/auth/me", headers={**_ip(), **second["headers"]}).json()["email"] == second["email"]

    def test_customer_cannot_read_another_chat(self):
        owner, attacker = _register("qa_sec_reg_chat1"), _register("qa_sec_reg_chat2")
        conversation = requests.post(f"{API}/chat/conversations", headers={**_ip(), **owner["headers"]})
        assert conversation.status_code == 201, conversation.text
        cid = conversation.json()["id"]
        assert requests.get(f"{API}/chat/conversations/{cid}/messages",
                            headers={**_ip(), **owner["headers"]}).status_code == 200
        assert requests.get(f"{API}/chat/conversations/{cid}/messages",
                            headers={**_ip(), **attacker["headers"]}).status_code == 404

    def test_customer_cannot_use_admin_user_endpoints(self):
        customer, target = _register("qa_sec_reg_cust"), _register("qa_sec_reg_target")
        assert requests.get(f"{API}/admin/users", headers={**_ip(), **customer["headers"]}).status_code == 403
        assert requests.get(f"{API}/admin/users/{target['user_id']}",
                            headers={**_ip(), **customer["headers"]}).status_code == 403


class TestInjectionControls:
    def test_mongo_operator_rejected_in_login_body(self):
        r = requests.post(f"{API}/auth/login", json={"email": {"$ne": None}, "password": "x"}, headers=_ip())
        assert r.status_code == 422, r.text

    def test_mongo_operator_rejected_in_register_body(self):
        r = requests.post(f"{API}/auth/register",
                          json={"email": {"$gt": ""}, "password": "Secret123!", "name": "Sec"}, headers=_ip())
        assert r.status_code == 422, r.text

    def test_html_in_pseudo_round_trips_as_text(self):
        """Caractérisation : l'API renvoie le texte brut ; React l'échappe (aucun dangerouslySetInnerHTML)."""
        owner = _register("qa_sec_reg_xss")
        payload = "<img src=x onerror=alert(1)>"
        order_id, _ = _seed_order(owner["user_id"], status="delivered", pseudo=payload)
        body = requests.get(f"{API}/orders/{order_id}", headers={**_ip(), **owner["headers"]}).json()
        assert body["pseudo"] == payload  # JSON texte, jamais du HTML exécutable

    def test_html_in_chat_message_round_trips_as_text(self):
        user = _register("qa_sec_reg_chatxss")
        cid = requests.post(f"{API}/chat/conversations", headers={**_ip(), **user["headers"]}).json()["id"]
        payload = "<script>alert(1)</script>"
        sent = requests.post(f"{API}/chat/conversations/{cid}/messages", json={"text": payload},
                             headers={**_ip(), **user["headers"]})
        assert sent.status_code == 201, sent.text
        assert sent.json()["text"] == payload


class TestPaymentWebhookControls:
    @staticmethod
    def _sign(raw, secret=SECRET, t=None):
        t = int(time.time()) if t is None else t
        return f"t={t},v1={hmac.new(secret.encode(), str(t).encode() + b'.' + raw, hashlib.sha256).hexdigest()}"

    def _pending_payment(self):
        order_id, order_number = _seed_order(status="pending_payment")
        token = "sec-" + uuid.uuid4().hex
        mongo.payments.insert_one({
            "order_id": order_id, "order_number": order_number, "attempt_no": 1,
            "client_ref": order_number, "provider": "mvola", "gateway": "papi",
            "provider_ref": None, "amount": 1000, "status": "pending", "simulated": False,
            "notif_token": token, "payment_url": "https://example.test/pay",
            "created_at": _iso(), "updated_at": _iso(), "expires_at": _iso(15),
        })
        body = json.dumps({"merchantPaymentReference": order_number, "notificationToken": token,
                           "paymentStatus": "SUCCESS", "paymentReference": "papi-sec",
                           "amount": 1000}).encode()
        return order_id, order_number, body

    def _notify(self, raw, signature):
        headers = _ip()
        if signature is not None:
            headers["X-Papi-Signature"] = signature
        return requests.post(f"{API}/payments/papi/notification", data=raw, headers=headers)

    def test_missing_and_wrong_signatures_rejected(self):
        _, _, raw = self._pending_payment()
        assert self._notify(raw, None).status_code == 401
        assert self._notify(raw, "t=%d,v1=%s" % (int(time.time()), "0" * 64)).status_code == 401
        assert self._notify(raw, self._sign(raw, secret="wrong-secret")).status_code == 401
        assert self._notify(raw, self._sign(raw, t=int(time.time()) - 3600)).status_code == 401

    def test_wrong_notification_token_rejected(self):
        _, _, raw = self._pending_payment()
        parsed = json.loads(raw)
        parsed["notificationToken"] = "wrong-token"
        forged = json.dumps(parsed).encode()
        assert self._notify(forged, self._sign(forged)).status_code == 403

    def test_replay_and_double_payment_are_idempotent(self):
        order_id, _, raw = self._pending_payment()
        signature = self._sign(raw)
        first = self._notify(raw, signature)
        assert first.status_code == 200, first.text
        assert first.json() == {"ok": True}
        assert mongo.payments.find_one({"order_id": order_id})["status"] == "completed"
        assert mongo.orders.find_one({"id": order_id})["status"] == "paid"

        replay = self._notify(raw, signature)
        assert replay.json().get("duplicate") is True

        second_raw = raw.replace(b"papi-sec", b"papi-sec-2")
        repeated = self._notify(second_raw, self._sign(second_raw))
        assert repeated.status_code == 200
        assert repeated.json().get("duplicate") is True
        paid_events = [h for h in mongo.orders.find_one({"id": order_id})["history"] if h["status"] == "paid"]
        assert len(paid_events) == 1


class TestCronToken:
    def test_cron_requires_the_configured_token(self):
        token = (_env.get("CRON_TOKEN") or "").strip()
        without = requests.post(f"{API}/internal/reminders/run", headers=_ip())
        if not token:
            assert without.status_code == 503, without.text
            return
        assert without.status_code == 401, without.text
        wrong = requests.post(f"{API}/internal/reminders/run", headers={**_ip(), "x-cron-token": "wrong-token"})
        assert wrong.status_code == 401, wrong.text
        right = requests.post(f"{API}/internal/reminders/run", headers={**_ip(), "x-cron-token": token})
        assert right.status_code == 200, right.text
