"""Payment lifecycle hardening — the 14 mandatory scenarios.

Runs against the local backend (PAYMENT_MODE=simulation) and manipulates attempt deadlines directly in Mongo
to simulate the 15-minute expiry. Signatures use PAPI_WEBHOOK_SECRET from backend/.env.
"""
import asyncio
import hashlib
import hmac
import json
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
SECRET = _env["PAPI_WEBHOOK_SECRET"]
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]


def _sign(raw: bytes, secret=SECRET, t=None):
    t = t or int(time.time())
    return f"t={t},v1={hmac.new(secret.encode(), str(t).encode() + b'.' + raw, hashlib.sha256).hexdigest()}"


def _notify(attempt, status="SUCCESS", amount=None, token=None, ref=None, secret=SECRET, t=None, papi_ref=None):
    body = {"merchantPaymentReference": ref or attempt["client_ref"], "notificationToken": token or attempt["notif_token"],
            "paymentStatus": status, "amount": attempt["amount"] if amount is None else amount,
            "paymentReference": papi_ref or f"PAPI-{uuid.uuid4().hex[:8]}", "paymentMethod": "MVOLA"}
    raw = json.dumps(body).encode()
    return requests.post(f"{API}/payments/papi/notification", data=raw,
                         headers={"Content-Type": "application/json", "X-Papi-Signature": _sign(raw, secret, t)})


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": _env["ADMIN_EMAIL"], "password": _env["ADMIN_PASSWORD"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def uc_product():
    return sorted([p for p in requests.get(f"{API}/products").json() if p["type"] == "uc"], key=lambda p: p["price"])[0]


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _order(product, method="mvola", headers=None):
    body = {"pubg_id": str(random.randint(10**9, 10**10 - 1)), "pseudo": "PayTest", "items": [{"product_id": product["id"], "quantity": 1}],
            "payment_method": method, "payment_phone": "0341234567"}
    r = requests.post(f"{API}/orders", json=body, headers=headers or _ip())
    assert r.status_code == 201, r.text
    return r.json()


def _initiate(order, expect=200, headers=None):
    r = requests.post(f"{API}/payments/initiate", json={"order_id": order["id"]}, headers=headers or _ip())
    assert r.status_code == expect, r.text
    return r.json()


def _attempt(client_ref):
    return mongo.payments.find_one({"client_ref": client_ref})


def _order_status(order_id):
    return mongo.orders.find_one({"id": order_id})["status"]


def _expire(client_ref):
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    mongo.payments.update_one({"client_ref": client_ref}, {"$set": {"expires_at": past}})


def _bypass_retry_delay(client_ref):
    mongo.payments.update_one({"client_ref": client_ref}, {"$set": {"created_at": (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()}})


class TestSignatureVector:
    def test_official_papi_test_vector(self):
        from services.payments import verify_papi_signature
        os.environ["PAPI_WEBHOOK_SECRET"] = "pwhsec_5f1c2b7e9a0d4c3b8e6f1a2d9c7b4e0f3a6d8c1b5e9f2a7d4c0b3e6f9a1d8c2b"
        raw = b'{"paymentReference":"PAPI-TEST-0001","paymentStatus":"SUCCESS","amount":150000}'
        header = "t=1757750400,v1=66c446f11f07c733a8ded2580681d7e0430cc490637479178506fd2a66595d53"
        assert verify_papi_signature(raw, header, tolerance=0) is True
        assert verify_papi_signature(raw, header) is False  # stale timestamp rejected in production mode
        assert verify_papi_signature(raw + b" ", header, tolerance=0) is False


class TestLifecycle:
    def test_1_pending_to_paid(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        assert p["status"] == "pending" and p["attempt_no"] == 1 and p["client_ref"] == o["order_number"] and "notif_token" not in p
        assert datetime.fromisoformat(p["expires_at"]) - datetime.fromisoformat(p["created_at"]) == timedelta(minutes=15)
        assert _notify(_attempt(p["client_ref"])).status_code == 200
        assert _attempt(p["client_ref"])["status"] == "completed"
        assert _order_status(o["id"]) == "paid"
        assert mongo.orders.find_one({"id": o["id"]})["paid_attempt_ref"] == p["client_ref"]

    def test_2_pending_to_failed(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        assert _notify(_attempt(p["client_ref"]), status="FAILED").status_code == 200
        assert _attempt(p["client_ref"])["status"] == "failed"
        assert _order_status(o["id"]) == "failed"

    def test_3_pending_to_expired(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        _expire(p["client_ref"])
        s = requests.get(f"{API}/payments/{o['id']}/status").json()
        assert s["payment_status"] == "expired" and s["order_status"] == "expired" and s["payment_url"] is None
        assert mongo.subscription_locks.count_documents({"order_id": o["id"]}) == 0

    def test_4_expired_then_late_success_never_delivers(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        _expire(p["client_ref"])
        r = _notify(_attempt(p["client_ref"]), papi_ref="PAPI-LATE-1")
        assert r.status_code == 200
        a = _attempt(p["client_ref"])
        assert a["status"] == "late_success"
        order = mongo.orders.find_one({"id": o["id"]})
        assert order["status"] == "expired" and order["late_payment"]["client_ref"] == p["client_ref"]
        assert mongo.audit_logs.find_one({"action": "payment.late_success", "target": o["id"]})
        # a second SUCCESS for the same reference stays inert
        assert _notify(a, papi_ref="PAPI-LATE-2").json().get("duplicate") is True
        assert _order_status(o["id"]) == "expired"

    def test_5_cancelled_order_cannot_retry(self, uc_product, admin_headers):
        o = _order(uc_product)
        p = _initiate(o)
        assert requests.patch(f"{API}/admin/orders/{o['id']}", headers=admin_headers, json={"status": "cancelled"}).status_code == 200
        _bypass_retry_delay(p["client_ref"])
        # the old pending attempt cannot resurrect the cancelled order either
        _notify(_attempt(p["client_ref"]))
        assert _order_status(o["id"]) == "cancelled"
        # explicit new attempt is refused
        pending = mongo.payments.find_one({"order_id": o["id"], "status": "pending"})
        if pending:
            mongo.payments.update_one({"client_ref": pending["client_ref"]}, {"$set": {"status": "failed"}})
        _initiate(o, expect=400)

    def test_6_failed_then_retry_new_reference(self, uc_product):
        o = _order(uc_product)
        p1 = _initiate(o)
        _notify(_attempt(p1["client_ref"]), status="FAILED")
        _initiate(o, expect=429)  # minimum delay between attempts
        _bypass_retry_delay(p1["client_ref"])
        p2 = _initiate(o)
        assert p2["attempt_no"] == 2 and p2["client_ref"] == f"{o['order_number']}-A2" and p2["client_ref"] != p1["client_ref"]
        assert _order_status(o["id"]) == "pending_payment"
        # old failed reference can no longer pay the order
        _notify(_attempt(p1["client_ref"]))
        assert _order_status(o["id"]) == "pending_payment"
        _notify(_attempt(p2["client_ref"]))
        assert _order_status(o["id"]) == "paid"
        assert mongo.orders.find_one({"id": o["id"]})["paid_attempt_ref"] == p2["client_ref"]

    def test_7_duplicate_callback_idempotent(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])
        body = json.dumps({"merchantPaymentReference": a["client_ref"], "notificationToken": a["notif_token"], "paymentStatus": "SUCCESS",
                           "amount": a["amount"], "paymentReference": "PAPI-DUP"}).encode()
        h = {"Content-Type": "application/json", "X-Papi-Signature": _sign(body)}
        r1 = requests.post(f"{API}/payments/papi/notification", data=body, headers=h)
        r2 = requests.post(f"{API}/payments/papi/notification", data=body, headers=h)  # exact replay
        r3 = _notify(a, papi_ref="PAPI-DUP")  # re-sent notification (new t / signature)
        assert r1.status_code == r2.status_code == r3.status_code == 200
        assert r2.json()["duplicate"] is True and r3.json()["duplicate"] is True
        order = mongo.orders.find_one({"id": o["id"]})
        assert order["status"] == "paid" and [h for h in order["history"] if h["status"] == "paid"].__len__() == 1
        assert mongo.audit_logs.count_documents({"action": "order.paid", "target": o["id"]}) == 1

    def test_8_concurrent_callbacks_single_delivery(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])

        async def run():
            async with httpx.AsyncClient(base_url=API, timeout=30) as c:
                reqs = []
                for i in range(10):
                    body = json.dumps({"merchantPaymentReference": a["client_ref"], "notificationToken": a["notif_token"], "paymentStatus": "SUCCESS",
                                       "amount": a["amount"], "paymentReference": f"PAPI-C{i}"}).encode()
                    reqs.append(c.post("/payments/papi/notification", content=body, headers={"Content-Type": "application/json", "X-Papi-Signature": _sign(body)}))
                return await asyncio.gather(*reqs)

        codes = [r.status_code for r in asyncio.run(run())]
        assert all(c == 200 for c in codes), codes
        order = mongo.orders.find_one({"id": o["id"]})
        assert order["status"] == "paid"
        assert len([h for h in order["history"] if h["status"] == "paid"]) == 1
        assert mongo.audit_logs.count_documents({"action": "order.paid", "target": o["id"]}) == 1

    def test_9_amount_mismatch_rejected(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])
        assert _notify(a, amount=a["amount"] - 500).status_code == 400
        assert _attempt(p["client_ref"])["status"] == "pending" and _order_status(o["id"]) == "pending_payment"
        assert _attempt(p["client_ref"])["amount_mismatch"]["received"] == a["amount"] - 500
        assert mongo.audit_logs.find_one({"action": "payment.amount_mismatch", "target": o["id"]})

    def test_10_wrong_reference_rejected(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])
        assert _notify(a, ref="MGS-DOESNOTEXIST").status_code == 403
        other = _initiate(_order(uc_product))
        # valid reference of ANOTHER attempt with this attempt's token → rejected, nothing paid
        assert _notify(a, ref=other["client_ref"]).status_code == 403
        assert _order_status(o["id"]) == "pending_payment"

    def test_11_invalid_signature_rejected(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])
        assert _notify(a, secret="pwhsec_wrong").status_code == 401
        assert _notify(a, t=int(time.time()) - 3600).status_code == 401  # replayed old timestamp
        raw = json.dumps({"merchantPaymentReference": a["client_ref"], "paymentStatus": "SUCCESS"}).encode()
        assert requests.post(f"{API}/payments/papi/notification", data=raw, headers={"Content-Type": "application/json"}).status_code == 401
        assert requests.post(f"{API}/payments/papi/notification", data=raw, headers={"Content-Type": "application/json", "X-Papi-Signature": "garbage"}).status_code == 401
        assert _order_status(o["id"]) == "pending_payment"

    def test_12_invalid_notification_token_rejected(self, uc_product):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])
        assert _notify(a, token="not-the-token").status_code == 403
        assert _order_status(o["id"]) == "pending_payment"

    def test_13_duplicate_delivery_protection_across_channels(self, uc_product, admin_headers):
        o = _order(uc_product)
        p = _initiate(o)
        a = _attempt(p["client_ref"])
        _notify(a)  # webhook wins
        # status poll (simulation would also say completed) + admin forcing must not re-deliver
        requests.get(f"{API}/payments/{o['id']}/status")
        requests.post(f"{API}/payments/{o['id']}/simulate", headers=admin_headers, json={"outcome": "completed"})
        order = mongo.orders.find_one({"id": o["id"]})
        assert len([h for h in order["history"] if h["status"] == "paid"]) == 1
        assert mongo.audit_logs.count_documents({"action": "order.paid", "target": o["id"]}) == 1
        # a paid order cannot open a new attempt
        _bypass_retry_delay(p["client_ref"])
        _initiate(o, expect=400)

    def test_14_retry_lifecycle_expired_then_paid(self, uc_product):
        o = _order(uc_product)
        p1 = _initiate(o)
        _expire(p1["client_ref"])
        requests.get(f"{API}/payments/{o['id']}/status")
        assert _order_status(o["id"]) == "expired"
        _bypass_retry_delay(p1["client_ref"])
        p2 = _initiate(o)
        assert p2["attempt_no"] == 2 and _order_status(o["id"]) == "pending_payment"
        assert mongo.subscription_locks.count_documents({"order_id": o["id"]}) == 0  # UC → no locks
        # late success on attempt 1 must not touch the order now owned by attempt 2
        _notify(_attempt(p1["client_ref"]))
        assert _order_status(o["id"]) == "pending_payment" and _attempt(p1["client_ref"])["status"] == "late_success"
        _notify(_attempt(p2["client_ref"]))
        assert _order_status(o["id"]) == "paid"
        attempts = requests.get(f"{API}/payments/{o['id']}/attempts", headers={"Authorization": "Bearer x"})
        assert attempts.status_code == 401
        idem = requests.post(f"{API}/payments/initiate", json={"order_id": o["id"]}, headers=_ip())
        assert idem.status_code == 400


class TestAntiSpam:
    def test_payment_initiate_rate_limit_per_ip(self, uc_product):
        from core import ratelimit as rl
        limit = rl.setting("PAYMENT_INITIATE_PER_10MIN_PER_IP", 15)
        ip = _ip()
        codes = []
        for _ in range(limit + 3):
            o = _order(uc_product)
            codes.append(requests.post(f"{API}/payments/initiate", json={"order_id": o["id"]}, headers=ip).status_code)
        assert 429 in codes and codes[0] == 200

    def test_orders_rate_limit_per_ip(self, uc_product):
        from core import ratelimit as rl
        limit = rl.setting("ORDERS_PER_HOUR_PER_IP", 30)
        ip = _ip()
        body = {"pubg_id": "5123456789", "pseudo": "Spam", "items": [{"product_id": uc_product["id"], "quantity": 1}], "payment_method": "mvola", "payment_phone": "0341234567"}
        codes = [requests.post(f"{API}/orders", json=body, headers=ip).status_code for _ in range(limit + 2)]
        assert codes[0] == 201 and codes[-1] == 429
