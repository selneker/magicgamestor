"""Backend tests for iteration 3 new features: chat, push, subscription rule."""
import base64
import os
import time
import uuid
import secrets
from pathlib import Path
from dotenv import dotenv_values

import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

ROOT = Path(__file__).resolve().parents[2]
backend_env = dotenv_values(ROOT / "backend/.env")
frontend_env = dotenv_values(ROOT / "frontend/.env")
BASE_URL = (os.environ.get("BACKEND_TEST_URL") or frontend_env["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL") or backend_env["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or backend_env["ADMIN_PASSWORD"]


def _mk_customer():
    email = f"qa_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    password = secrets.token_urlsafe(24)
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "QA"})
    assert r.status_code == 200, r.text
    with (ROOT / "memory/test_credentials.md").open("a") as f:
        f.write(f"\nQA customer (automated targeted tests):\n- email: {email}\n- password: {password}\n")
    d = r.json()
    return {"email": email, "token": d["access_token"], "user_id": d["user"]["user_id"],
            "headers": {"Authorization": f"Bearer {d['access_token']}"}}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def user_a():
    return _mk_customer()


@pytest.fixture(scope="module")
def user_b():
    return _mk_customer()


# ================ CHAT ================
class TestChatAuth:
    def test_conversations_requires_auth(self):
        r = requests.get(f"{API}/chat/conversations")
        assert r.status_code == 401

    def test_start_conversation_requires_auth(self):
        r = requests.post(f"{API}/chat/conversations")
        assert r.status_code == 401

    def test_unread_requires_auth(self):
        r = requests.get(f"{API}/chat/unread")
        assert r.status_code == 401


class TestChatFlow:
    def test_customer_start_conversation_idempotent(self, user_a):
        r1 = requests.post(f"{API}/chat/conversations", headers=user_a["headers"])
        assert r1.status_code == 201, r1.text
        c1 = r1.json()
        assert c1["user_id"] == user_a["user_id"]
        # second call must return same conversation
        r2 = requests.post(f"{API}/chat/conversations", headers=user_a["headers"])
        assert r2.status_code == 201
        assert r2.json()["id"] == c1["id"]
        user_a["conversation_id"] = c1["id"]

    def test_admin_cannot_start_conversation(self, admin_headers):
        r = requests.post(f"{API}/chat/conversations", headers=admin_headers)
        assert r.status_code == 403

    def test_customer_send_message(self, user_a):
        cid = user_a["conversation_id"]
        r = requests.post(f"{API}/chat/conversations/{cid}/messages",
                          headers=user_a["headers"], json={"text": "Bonjour, j'ai un souci."})
        assert r.status_code == 201, r.text
        assert r.json()["sender_role"] == "customer"
        assert r.json()["text"] == "Bonjour, j'ai un souci."

    def test_empty_message_rejected(self, user_a):
        cid = user_a["conversation_id"]
        r = requests.post(f"{API}/chat/conversations/{cid}/messages",
                          headers=user_a["headers"], json={"text": "   "})
        assert r.status_code == 422

    def test_too_long_message_rejected(self, user_a):
        cid = user_a["conversation_id"]
        r = requests.post(f"{API}/chat/conversations/{cid}/messages",
                          headers=user_a["headers"], json={"text": "x" * 2001})
        assert r.status_code == 422

    def test_forged_sender_id_ignored(self, user_a):
        # Extra fields are forbidden by ConfigDict(extra="forbid")
        cid = user_a["conversation_id"]
        r = requests.post(f"{API}/chat/conversations/{cid}/messages",
                          headers=user_a["headers"], json={"text": "hi", "sender_id": "hacker"})
        assert r.status_code == 422

    def test_admin_sees_conversation_in_list(self, admin_headers, user_a):
        r = requests.get(f"{API}/chat/conversations", headers=admin_headers)
        assert r.status_code == 200
        items = r.json()["items"]
        found = [c for c in items if c["id"] == user_a["conversation_id"]]
        assert found, "admin should see customer conversation"
        # unread count > 0 (customer message)
        assert found[0]["unread_count"] >= 1

    def test_admin_replies(self, admin_headers, user_a):
        cid = user_a["conversation_id"]
        r = requests.post(f"{API}/chat/conversations/{cid}/messages",
                          headers=admin_headers, json={"text": "Bonjour, comment aider ?"})
        assert r.status_code == 201
        assert r.json()["sender_role"] == "admin"

    def test_customer_reads_messages_and_marks_read(self, user_a):
        cid = user_a["conversation_id"]
        r = requests.get(f"{API}/chat/conversations/{cid}/messages", headers=user_a["headers"])
        assert r.status_code == 200
        j = r.json()
        assert j["conversation"]["id"] == cid
        assert len(j["messages"]) >= 2
        # Customer marks admin reply as read
        admin_msg_ids = [m["id"] for m in j["messages"] if m["sender_role"] == "admin"]
        assert admin_msg_ids
        r2 = requests.post(f"{API}/chat/conversations/{cid}/read",
                           headers=user_a["headers"], json={"message_ids": admin_msg_ids})
        assert r2.status_code == 200
        assert r2.json()["marked"] >= 1
        # unread now 0
        u = requests.get(f"{API}/chat/unread", headers=user_a["headers"])
        assert u.status_code == 200
        assert u.json()["count"] == 0

    def test_cross_user_isolation(self, user_a, user_b):
        # user_b tries to read user_a conversation
        cid = user_a["conversation_id"]
        r = requests.get(f"{API}/chat/conversations/{cid}/messages", headers=user_b["headers"])
        assert r.status_code == 404
        r2 = requests.post(f"{API}/chat/conversations/{cid}/messages",
                           headers=user_b["headers"], json={"text": "leak"})
        assert r2.status_code == 404
        r3 = requests.post(f"{API}/chat/conversations/{cid}/read",
                           headers=user_b["headers"], json={"message_ids": ["x"]})
        assert r3.status_code == 404

    def test_customer_sees_only_own(self, user_a, user_b):
        # user_b starts its own conversation
        requests.post(f"{API}/chat/conversations", headers=user_b["headers"])
        rb = requests.get(f"{API}/chat/conversations", headers=user_b["headers"])
        assert rb.status_code == 200
        items_b = rb.json()["items"]
        assert all(c["user_id"] == user_b["user_id"] for c in items_b)


# ================ PUSH ================
def _gen_valid_p256dh():
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(pub).rstrip(b"=").decode()


def _gen_auth():
    return base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()


class TestPushAdmin:
    def test_push_endpoints_require_admin(self, user_a):
        for path in ["config", "status", "subscriptions", "test"]:
            method = requests.get if path == "config" else requests.post
            r = method(f"{API}/admin/push/{path}",
                       headers=user_a["headers"],
                       json={"endpoint": "https://fcm.googleapis.com/fcm/send/abc"} if path != "config" else None)
            assert r.status_code == 403, f"{path} should be admin-only, got {r.status_code}"

    def test_push_endpoints_require_auth(self):
        r = requests.get(f"{API}/admin/push/config")
        assert r.status_code == 401

    def test_config_returns_public_key(self, admin_headers):
        r = requests.get(f"{API}/admin/push/config", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        assert j["configured"] is True
        assert j["public_key"] and isinstance(j["public_key"], str)
        # never leaks private key
        assert "PRIVATE" not in j["public_key"].upper()
        assert "BEGIN" not in j["public_key"]

    def test_status_unregistered(self, admin_headers):
        r = requests.post(f"{API}/admin/push/status",
                          headers=admin_headers,
                          json={"endpoint": "https://fcm.googleapis.com/fcm/send/never"})
        assert r.status_code == 200
        assert r.json()["registered"] is False

    def test_subscribe_invalid_endpoint_ssrf(self, admin_headers):
        body = {
            "endpoint": "https://evil.example.com/x",
            "keys": {"p256dh": _gen_valid_p256dh(), "auth": _gen_auth()},
        }
        r = requests.post(f"{API}/admin/push/subscriptions", headers=admin_headers, json=body)
        assert r.status_code == 422

    def test_subscribe_invalid_scheme(self, admin_headers):
        body = {
            "endpoint": "http://fcm.googleapis.com/fcm/send/abc",
            "keys": {"p256dh": _gen_valid_p256dh(), "auth": _gen_auth()},
        }
        r = requests.post(f"{API}/admin/push/subscriptions", headers=admin_headers, json=body)
        assert r.status_code == 422

    def test_subscribe_invalid_p256dh(self, admin_headers):
        body = {
            "endpoint": "https://fcm.googleapis.com/fcm/send/abc",
            "keys": {"p256dh": "AAAA", "auth": _gen_auth()},
        }
        r = requests.post(f"{API}/admin/push/subscriptions", headers=admin_headers, json=body)
        assert r.status_code == 422

    def test_subscribe_and_status_and_unsubscribe(self, admin_headers):
        endpoint = f"https://fcm.googleapis.com/fcm/send/qa-{uuid.uuid4().hex}"
        body = {"endpoint": endpoint, "keys": {"p256dh": _gen_valid_p256dh(), "auth": _gen_auth()}}
        r = requests.post(f"{API}/admin/push/subscriptions", headers=admin_headers, json=body)
        assert r.status_code == 200, r.text
        assert r.json()["registered"] is True
        # upsert idempotent
        r2 = requests.post(f"{API}/admin/push/subscriptions", headers=admin_headers, json=body)
        assert r2.status_code == 200

        s = requests.post(f"{API}/admin/push/status", headers=admin_headers, json={"endpoint": endpoint})
        assert s.status_code == 200
        assert s.json()["registered"] is True

        # test send: will hit FCM which will reject with 404/410 (bogus token) → expired path
        t = requests.post(f"{API}/admin/push/test", headers=admin_headers, json={"endpoint": endpoint})
        # Accept any of: 410 (expired cleanup), 502 (transport), 200 (unlikely). Not 500.
        assert t.status_code in (200, 410, 502), t.text

        # Cleanup
        d = requests.request("DELETE", f"{API}/admin/push/subscriptions",
                             headers=admin_headers, json={"endpoint": endpoint})
        assert d.status_code == 200

    def test_test_send_unknown_endpoint_404(self, admin_headers):
        r = requests.post(f"{API}/admin/push/test", headers=admin_headers,
                          json={"endpoint": "https://fcm.googleapis.com/fcm/send/does-not-exist"})
        assert r.status_code == 404


# ================ SUBSCRIPTION (Prime) RULE ================
def _prime_product_id():
    r = requests.get(f"{API}/products", params={"type": "prime,prime_plus"})
    return r.json()[0]["id"]


def _uc_product_id():
    r = requests.get(f"{API}/products/60-uc")
    return r.json()["id"]


def _fresh_pubg():
    # 10-digit unique pubg id
    return str(5_000_000_000 + uuid.uuid4().int % 999_999_999)


class TestSubscriptionRule:
    def test_first_prime_ok_second_refused(self):
        pubg = _fresh_pubg()
        prime = _prime_product_id()
        payload = {"pubg_id": pubg, "pseudo": "PrimeQA",
                   "items": [{"product_id": prime, "quantity": 1}],
                   "payment_method": "mvola", "payment_phone": "0341234567"}
        r1 = requests.post(f"{API}/orders", json=payload)
        assert r1.status_code == 201, r1.text
        r2 = requests.post(f"{API}/orders", json=payload)
        assert r2.status_code == 409
        assert "abonnement" in r2.json()["detail"].lower()

    def test_uc_never_limited(self):
        pubg = _fresh_pubg()
        uc = _uc_product_id()
        payload = {"pubg_id": pubg, "pseudo": "UcQA",
                   "items": [{"product_id": uc, "quantity": 1}],
                   "payment_method": "mvola", "payment_phone": "0341234567"}
        for _ in range(3):
            r = requests.post(f"{API}/orders", json=payload)
            assert r.status_code == 201, r.text

    def test_uc_before_and_after_prime(self):
        pubg = _fresh_pubg()
        uc = _uc_product_id()
        prime = _prime_product_id()
        base = {"pubg_id": pubg, "pseudo": "MixQA",
                "payment_method": "mvola", "payment_phone": "0341234567"}
        r1 = requests.post(f"{API}/orders", json={**base, "items": [{"product_id": uc, "quantity": 1}]})
        assert r1.status_code == 201
        r2 = requests.post(f"{API}/orders", json={**base, "items": [{"product_id": prime, "quantity": 1}]})
        assert r2.status_code == 201
        # subsequent UC still ok
        r3 = requests.post(f"{API}/orders", json={**base, "items": [{"product_id": uc, "quantity": 1}]})
        assert r3.status_code == 201
        # subsequent prime blocked
        r4 = requests.post(f"{API}/orders", json={**base, "items": [{"product_id": prime, "quantity": 1}]})
        assert r4.status_code == 409

    def test_concurrent_first_prime_exactly_one_accepted(self):
        import concurrent.futures as cf
        pubg = _fresh_pubg()
        prime = _prime_product_id()
        payload = {"pubg_id": pubg, "pseudo": "RaceQA",
                   "items": [{"product_id": prime, "quantity": 1}],
                   "payment_method": "mvola", "payment_phone": "0341234567"}

        def go():
            return requests.post(f"{API}/orders", json=payload).status_code

        with cf.ThreadPoolExecutor(max_workers=2) as ex:
            r = list(ex.map(lambda _: go(), range(2)))
        # exactly one 201, one 409 (atomicity via partial unique index)
        assert sorted(r) == [201, 409], f"expected [201, 409], got {r}"
