"""Binance USDT on-chain payment tests.

Imports backend modules directly (cwd must be /app/backend) and monkeypatches
services.binance.deposit_history to simulate deposits. Uses sync pymongo for DB
assertions and asyncio.run() for watcher invocations (fresh loop per call so
motor's AsyncIOMotorClient re-binds cleanly).

Covers API, admin, create_payment, confirm/detect/fail paths, and all unmatched reasons.
"""
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

from services import binance, binance_watcher, crypto  # noqa: E402

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
mongo = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

TRON_ADDR = "TXyzBinanceTestAddress00000000000001"
TON_ADDR = "UQBinanceTestTonAddress00000000000001"
BEP20_ADDR = "0xDEADBEEFBINANCETESTBEP20000000000001"


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


_PERSIST_LOOP = asyncio.new_event_loop()


def _run(coro):
    """Run coroutine in a single persistent loop so motor keeps its executor alive."""
    return _PERSIST_LOOP.run_until_complete(coro)


# ---------- fixtures ----------


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def uc_product():
    products = requests.get(f"{API}/products").json()
    uc = sorted([p for p in products if p["type"] == "uc"], key=lambda p: p["price"])
    assert uc
    return uc[0]


@pytest.fixture(scope="module", autouse=True)
def enable_binance(admin_headers):
    body = {
        "enabled": True, "rate_ar_per_usdt": 4500, "expiry_minutes": 30,
        "wallets": {
            "TRC20": {"address": TRON_ADDR, "memo": "", "active": True},
            "TON": {"address": TON_ADDR, "memo": "123456", "active": True},
            "BEP20": {"address": BEP20_ADDR, "memo": "", "active": True},
            "APTOS": {"address": "", "memo": "", "active": False},
        },
    }
    r = requests.patch(f"{API}/crypto/admin/settings", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    yield
    requests.patch(f"{API}/crypto/admin/settings", json={
        "enabled": False,
        "wallets": {k: {"address": "", "memo": "", "active": False} for k in ("TRC20", "TON", "BEP20", "APTOS")}
    }, headers=admin_headers)


def _make_order(product):
    body = {
        "pubg_id": str(random.randint(10 ** 9, 10 ** 10 - 1)),
        "pseudo": f"TEST_bin_{uuid.uuid4().hex[:4]}",
        "items": [{"product_id": product["id"], "quantity": 1}],
        "payment_method": "binance",
    }
    r = requests.post(f"{API}/orders", json=body, headers=_ip())
    assert r.status_code == 201, r.text
    return r.json()


def _initiate(order, network="TRC20"):
    r = requests.post(f"{API}/crypto/initiate", json={"order_id": order["id"], "network": network}, headers=_ip())
    assert r.status_code == 200, r.text
    return r.json()


def _mk_deposit(payment, amount_override=None, network_override=None, address_override=None,
                tag_override=None, tx_override=None, status=1, insert_time_offset_s=10):
    import time
    insert_time = int((time.time() + insert_time_offset_s) * 1000)
    network = network_override or binance.NETWORKS[payment["network"]]
    return {
        "id": str(uuid.uuid4()),
        "txId": tx_override or f"TEST_{uuid.uuid4().hex}",
        "coin": "USDT", "network": network,
        "amount": amount_override if amount_override is not None else payment["amount_usdt"],
        "address": address_override if address_override is not None else payment["address"],
        "addressTag": tag_override if tag_override is not None else (payment.get("memo") or ""),
        "status": status,
        "insertTime": insert_time,
    }


async def _ret(deposits):
    return deposits


def _run_watcher(deposits, monkeypatch):
    monkeypatch.setattr(binance, "deposit_history", lambda start_ms, end_ms=None: _ret(deposits))
    binance_watcher._last["at"] = 0.0
    return _run(binance_watcher.check_once(force=True))


# ---------- API tests ----------


class TestConfigAndAdmin:
    def test_config_available(self):
        cfg = requests.get(f"{API}/crypto/config").json()
        assert cfg["available"] is True
        keys = {n["key"] for n in cfg["networks"]}
        assert {"TRC20", "TON", "BEP20"}.issubset(keys)
        ton = next(n for n in cfg["networks"] if n["key"] == "TON")
        assert ton["memo_required"] is True
        trc = next(n for n in cfg["networks"] if n["key"] == "TRC20")
        assert trc["memo_required"] is False

    def test_enable_without_wallet_rejected(self, admin_headers):
        r = requests.patch(f"{API}/crypto/admin/settings",
                           json={"enabled": True, "wallets": {k: {"address": "", "memo": "", "active": False} for k in ("TRC20", "TON", "BEP20", "APTOS")}},
                           headers=admin_headers)
        assert r.status_code == 400, r.text
        # Restore full enabled state
        r = requests.patch(f"{API}/crypto/admin/settings", json={
            "enabled": True, "rate_ar_per_usdt": 4500,
            "wallets": {
                "TRC20": {"address": TRON_ADDR, "memo": "", "active": True},
                "TON": {"address": TON_ADDR, "memo": "123456", "active": True},
                "BEP20": {"address": BEP20_ADDR, "memo": "", "active": True},
                "APTOS": {"address": "", "memo": "", "active": False},
            }}, headers=admin_headers)
        assert r.status_code == 200, r.text

    def test_order_rejected_when_disabled(self, admin_headers, uc_product):
        requests.patch(f"{API}/crypto/admin/settings", json={"enabled": False}, headers=admin_headers)
        body = {"pubg_id": "1234567890", "pseudo": "TEST_x", "payment_method": "binance",
                "items": [{"product_id": uc_product["id"], "quantity": 1}]}
        r = requests.post(f"{API}/orders", json=body, headers=_ip())
        assert r.status_code == 409
        requests.patch(f"{API}/crypto/admin/settings", json={"enabled": True}, headers=admin_headers)


class TestOrderAndInitiate:
    def test_create_order_and_initiate_trc20(self, uc_product):
        order = _make_order(uc_product)
        assert order["payment_method"] == "binance"
        assert order["payment_provider"] == "binance"
        assert order["status"] == "pending_payment"
        payment = _initiate(order, "TRC20")
        assert payment["network"] == "TRC20"
        assert payment["address"] == TRON_ADDR
        assert payment["currency"] == "USDT"
        base = crypto.base_amount(order["total"], 4500)
        assert Decimal(payment["amount_usdt"]) > base
        # idempotent
        p2 = _initiate(order, "TRC20")
        assert p2["amount_usdt"] == payment["amount_usdt"]
        assert p2["id"] == payment["id"]
        r = requests.get(f"{API}/crypto/{order['id']}/status")
        assert r.status_code == 200
        assert r.json()["payment"]["id"] == payment["id"]

    def test_different_orders_unique_amount(self, uc_product):
        o1 = _make_order(uc_product)
        o2 = _make_order(uc_product)
        p1 = _initiate(o1, "TRC20")
        p2 = _initiate(o2, "TRC20")
        assert p1["amount_usdt"] != p2["amount_usdt"]

    def test_switching_network_blocked(self, uc_product):
        o = _make_order(uc_product)
        _initiate(o, "TRC20")
        r = requests.post(f"{API}/crypto/initiate", json={"order_id": o["id"], "network": "TON"}, headers=_ip())
        assert r.status_code == 409


# ---------- Watcher tests ----------


@pytest.fixture
def new_order_and_payment(uc_product):
    def _factory(network="TRC20"):
        order = _make_order(uc_product)
        payment = _initiate(order, network)
        return order, payment
    return _factory


class TestWatcher:
    def test_correct_deposit_confirms(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        dep = _mk_deposit(payment, status=1)
        result = _run_watcher([dep], monkeypatch)
        assert result["ran"] is True
        assert result["results"].get("confirmed", 0) >= 1
        p = mongo.crypto_payments.find_one({"id": payment["id"]})
        assert p["status"] == crypto.CONFIRMED
        assert p["tx_hash"] == dep["txId"]
        o = mongo.orders.find_one({"id": order["id"]})
        assert o["status"] == "paid"
        assert o.get("paid_attempt_ref") == payment["id"]

    def test_pending_then_success_transitions(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        tx = f"TEST_{uuid.uuid4().hex}"
        res1 = _run_watcher([_mk_deposit(payment, status=0, tx_override=tx)], monkeypatch)
        assert res1["results"].get("detected", 0) >= 1
        assert mongo.crypto_payments.find_one({"id": payment["id"]})["status"] == crypto.DETECTED
        res2 = _run_watcher([_mk_deposit(payment, status=1, tx_override=tx)], monkeypatch)
        assert res2["results"].get("confirmed", 0) >= 1
        p = mongo.crypto_payments.find_one({"id": payment["id"]})
        assert p["status"] == crypto.CONFIRMED
        assert mongo.orders.find_one({"id": order["id"]})["status"] == "paid"

    def test_wrong_network(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        dep = _mk_deposit(payment, network_override="BSC", address_override=BEP20_ADDR, status=1)
        _run_watcher([dep], monkeypatch)
        p = mongo.crypto_payments.find_one({"id": payment["id"]})
        assert p["status"] == crypto.WAITING
        um = mongo.crypto_unmatched.find_one({"tx_hash": dep["txId"]})
        assert um and um["reason"] == "wrong_network"

    def test_wrong_amount(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        wrong = str((Decimal(payment["amount_usdt"]) + Decimal("5.1234")).quantize(Decimal("0.0001")))
        dep = _mk_deposit(payment, amount_override=wrong, status=1)
        _run_watcher([dep], monkeypatch)
        um = mongo.crypto_unmatched.find_one({"tx_hash": dep["txId"]})
        assert um and um["reason"] == "amount_not_matching"
        assert mongo.crypto_payments.find_one({"id": payment["id"]})["status"] == crypto.WAITING

    def test_unknown_transaction(self, new_order_and_payment):
        # Need an open slot to pass the busy check
        new_order_and_payment("TRC20")
        import time
        dep = {
            "id": str(uuid.uuid4()), "txId": f"TEST_{uuid.uuid4().hex}", "coin": "USDT",
            "network": "BSC", "amount": "99999.9991", "address": BEP20_ADDR,
            "addressTag": "", "status": 1, "insertTime": int(time.time() * 1000),
        }
        min_ms = int((time.time() - 3600) * 1000)
        r = _run(binance_watcher.process_deposit(dep, min_ms))
        assert r == "unknown_transaction"

    def test_duplicate_tx(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        dep = _mk_deposit(payment, status=1)
        _run_watcher([dep], monkeypatch)
        res2 = _run_watcher([dep], monkeypatch)
        assert any(k in res2["results"] for k in ("duplicate", "ignored"))
        count = mongo.crypto_payments.count_documents({"tx_hash": dep["txId"], "status": crypto.CONFIRMED})
        assert count == 1

    def test_wrong_address(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        dep = _mk_deposit(payment, address_override="TOtherAddressWrongXXXXXXXXXXXXXXXXX01", status=1)
        _run_watcher([dep], monkeypatch)
        um = mongo.crypto_unmatched.find_one({"tx_hash": dep["txId"]})
        assert um and um["reason"] == "wrong_address"
        assert mongo.crypto_payments.find_one({"id": payment["id"]})["status"] == crypto.WAITING

    def test_wrong_memo_then_correct_memo(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TON")
        assert payment["memo"] == "123456"
        bad = _mk_deposit(payment, tag_override="999999", status=1)
        _run_watcher([bad], monkeypatch)
        um = mongo.crypto_unmatched.find_one({"tx_hash": bad["txId"]})
        assert um and um["reason"] == "wrong_memo"
        assert mongo.crypto_payments.find_one({"id": payment["id"]})["status"] == crypto.WAITING
        good = _mk_deposit(payment, tag_override="123456", status=1)
        _run_watcher([good], monkeypatch)
        assert mongo.crypto_payments.find_one({"id": payment["id"]})["status"] == crypto.CONFIRMED

    def test_expiry_fails_payment_and_order(self, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        mongo.crypto_payments.update_one({"id": payment["id"]}, {"$set": {"expires_at": past}})
        _run(binance_watcher.expire_due())
        p = mongo.crypto_payments.find_one({"id": payment["id"]})
        assert p["status"] == crypto.FAILED
        assert p.get("failure_reason") == "expired"
        o = mongo.orders.find_one({"id": order["id"]})
        assert o["status"] == "expired"

    def test_deposit_after_expiry_unmatched(self, monkeypatch, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        mongo.crypto_payments.update_one({"id": payment["id"]}, {"$set": {"expires_at": past}})
        _run(binance_watcher.expire_due())
        dep = _mk_deposit(payment, status=1)
        _run_watcher([dep], monkeypatch)
        um = mongo.crypto_unmatched.find_one({"tx_hash": dep["txId"]})
        assert um is not None
        assert um["reason"] in ("payment_expired", "outside_payment_window", "unknown_transaction", "amount_not_matching")
        assert mongo.orders.find_one({"id": order["id"]})["status"] == "expired"

    def test_admin_rate_change_does_not_alter_existing(self, admin_headers, new_order_and_payment):
        order, payment = new_order_and_payment("TRC20")
        before_amount = payment["amount_usdt"]
        before_rate = payment["rate_ar_per_usdt"]
        r = requests.patch(f"{API}/crypto/admin/settings", json={"rate_ar_per_usdt": 6000}, headers=admin_headers)
        assert r.status_code == 200
        p = mongo.crypto_payments.find_one({"id": payment["id"]})
        assert p["amount_usdt"] == before_amount
        assert p["rate_ar_per_usdt"] == before_rate
        requests.patch(f"{API}/crypto/admin/settings", json={"rate_ar_per_usdt": 4500}, headers=admin_headers)


class TestAdminLists:
    def test_admin_payments(self, admin_headers):
        r = requests.get(f"{API}/crypto/admin/payments", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_unmatched(self, admin_headers):
        r = requests.get(f"{API}/crypto/admin/unmatched", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
