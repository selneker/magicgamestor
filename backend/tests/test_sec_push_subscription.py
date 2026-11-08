"""SEC-FIND-FIX — prise de contrôle d'une souscription Push.

L'endpoint est unique globalement, mais un admin ne doit pas pouvoir réaffecter
à son compte la souscription d'un autre admin en réutilisant le même endpoint.
"""
import base64
import os
import random
import time
import uuid
from pathlib import Path

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _register(prefix="qa_sec_push"):
    email = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "Sec Push"},
                      headers=_ip())
    assert r.status_code == 200, r.text
    data = r.json()
    user = {"email": email, "user_id": data["user"]["user_id"],
            "headers": {"Authorization": f"Bearer {data['access_token']}"}}
    mongo.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": "admin"}})
    return user


def _keys():
    private_key = ec.generate_private_key(ec.SECP256R1())
    raw = private_key.public_key().public_bytes(serialization.Encoding.X962,
                                                serialization.PublicFormat.UncompressedPoint)
    return {"p256dh": base64.urlsafe_b64encode(raw).rstrip(b"=").decode(),
            "auth": base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()}


def _endpoint():
    return f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4().hex}"


def _subscribe(user, endpoint, keys):
    return requests.post(f"{API}/admin/push/subscriptions", json={"endpoint": endpoint, "keys": keys},
                         headers={**_ip(), **user["headers"]})


def _status(user, endpoint):
    return requests.post(f"{API}/admin/push/status", json={"endpoint": endpoint},
                         headers={**_ip(), **user["headers"]})


class TestPushSubscriptionOwnership:
    def test_other_admin_cannot_take_over_endpoint(self):
        owner = _register("qa_sec_push_owner")
        attacker = _register("qa_sec_push_attacker")
        endpoint, keys = _endpoint(), _keys()

        assert _subscribe(owner, endpoint, keys).status_code == 200

        takeover = _subscribe(attacker, endpoint, _keys())
        assert takeover.status_code == 409, takeover.text

        stored = mongo.push_subscriptions.find_one({"endpoint": endpoint}, {"_id": 0, "user_id": 1})
        assert stored["user_id"] == owner["user_id"]
        assert _status(owner, endpoint).json() == {"registered": True}
        assert _status(attacker, endpoint).json() == {"registered": False}

    def test_owner_can_rotate_keys_idempotently(self):
        owner = _register("qa_sec_push_rotate")
        endpoint = _endpoint()

        assert _subscribe(owner, endpoint, _keys()).status_code == 200
        rotated = _keys()
        assert _subscribe(owner, endpoint, rotated).status_code == 200
        stored = mongo.push_subscriptions.find_one({"endpoint": endpoint}, {"_id": 0, "keys": 1})
        assert stored["keys"] == rotated

    def test_distinct_endpoints_coexist_for_two_admins(self):
        first = _register("qa_sec_push_first")
        second = _register("qa_sec_push_second")
        ep_first, ep_second = _endpoint(), _endpoint()

        assert _subscribe(first, ep_first, _keys()).status_code == 200
        assert _subscribe(second, ep_second, _keys()).status_code == 200
        assert _status(first, ep_first).json() == {"registered": True}
        assert _status(second, ep_second).json() == {"registered": True}
