"""PL-ORDER-PROOF-1B — commande + preuve de paiement (stockage GridFS local).

Aucun réseau réel : le bucket GridFS est celui de la base MongoDB LOCALE jetable
(`mgs_proof_test_<aléa>`), les alertes sont enregistrées au lieu d'être envoyées. Chaque test
supprime sa base : aucun document réel, aucune interférence entre workers xdist.
"""
import asyncio
import functools
import io
import os
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from bson import ObjectId
from dotenv import dotenv_values
from fastapi import FastAPI
from PIL import Image
from pymongo import MongoClient

import core.audit as core_audit
import core.db as core_db
import core.identity_keys as core_identity
import core.security as core_security
from core import ratelimit
from core.security import create_access_token
from motor.motor_asyncio import AsyncIOMotorClient
from routers import evo as evo_router
from routers import maintenance, orders
from routers import payments as payment_router
from services import binance_watcher, order_maintenance, proofs

_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
_mongo = MongoClient(_env["MONGO_URL"])
_LOOP = None  # boucle du test courant : motor s'y lie et ne doit jamais la voir fermée ailleurs


def _arun(func, *args, **kwargs):
    """Exécute une coroutine dans la boucle du test (jamais `asyncio.run` : boucle jetable)."""
    if not callable(func):
        return _LOOP.run_until_complete(func)
    return _LOOP.run_until_complete(functools.partial(func, *args, **kwargs)())


@pytest.fixture(autouse=True)
def loop():
    """Une boucle neuve par test : aucune boucle fermée réutilisée, aucune fuite vers les autres modules."""
    global _LOOP
    previous = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            previous = asyncio.get_event_loop_policy().get_event_loop()
    except RuntimeError:
        previous = None
    current = asyncio.new_event_loop()
    asyncio.set_event_loop(current)
    _LOOP = current
    yield current
    current.run_until_complete(current.shutdown_asyncgens())
    asyncio.set_event_loop(previous)
    _LOOP = None
    current.close()


class LoopClient:
    """Client ASGI synchrone piloté par la boucle du test (équivalent TestClient)."""

    def __init__(self, loop, app):
        self.loop = loop
        self._client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    def request(self, method, url, **kwargs):
        return self.loop.run_until_complete(self._client.request(method, url, **kwargs))

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def close(self):
        self.loop.run_until_complete(self._client.aclose())


async def _make_client():
    return AsyncIOMotorClient(_env["MONGO_URL"])


async def _close_client(async_client):
    async_client.close()


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


class _Alerts:
    """Remplace `notifications.schedule` : aucune tâche détachée, aucun réseau."""

    def __init__(self):
        self.calls = []

    def __call__(self, background, func, *args):
        self.calls.append((getattr(func, "__name__", "?"), args))

    def named(self, name):
        return [call for call in self.calls if call[0] == name]


@pytest.fixture(autouse=True)
def _no_serialization_surprise(monkeypatch):
    ratelimit.reset()
    monkeypatch.delenv("ALERT_PAYMENT_EXPIRED", raising=False)


@pytest.fixture(autouse=True)
def client(loop):
    app = FastAPI()
    app.include_router(orders.router, prefix="/api")
    app.include_router(maintenance.router, prefix="/api")
    http = LoopClient(loop, app)
    yield http
    http.close()


@pytest.fixture
def ctx(monkeypatch, client, loop):
    """Base jetable + faux planificateur d'alertes.

    Les routes et services reçoivent une base **motor** (asynchrone) ; les tests lisent et
    écrivent avec le client **synchrone** sur la même base, ce qui garde les assertions lisibles.
    """
    name = f"mgs_proof_test_{uuid.uuid4().hex[:10]}"
    # Client motor créé DANS la boucle du test et détruit avec elle.
    async_client = loop.run_until_complete(_make_client())
    motor_db = async_client[name]
    sync_db = _mongo[name]
    for module in (order_maintenance, binance_watcher, orders, payment_router, core_db, core_identity,
                   core_security, core_audit, evo_router, proofs):
        monkeypatch.setattr(module, "db", motor_db)
    alerts = _Alerts()
    monkeypatch.setattr("services.notifications.schedule", alerts)
    monkeypatch.setattr(binance_watcher.notifications, "schedule", alerts)
    proofs.reset_db_usage_cache()  # PL-PROOF-QUOTA-1 : cache module global, jamais partagé entre tests
    _arun(core_db.ensure_indexes)
    yield SimpleNamespace(db=sync_db, alerts=alerts)
    loop.run_until_complete(_close_client(async_client))
    _mongo.drop_database(name)


def _user(ctx, role="user", permissions=None):
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    ctx.db.users.insert_one({"user_id": user_id, "email": f"{user_id}@example.test", "role": role,
                                "permissions": permissions or [], "auth_version": 0})
    return {"user_id": user_id}, {"Authorization": f"Bearer {create_access_token(user_id)}"}


def _order(ctx, **extra):
    order_id = str(uuid.uuid4())
    doc = {
        "id": order_id, "order_number": "MGS-" + uuid.uuid4().hex[:6].upper(),
        "user_id": None, "email": "client@example.test", "pubg_id": "5123456789",
        "pseudo": "Preuve", "game_id": "pubg-mobile",
        "items": [{"product_id": "p", "slug": "p", "name": "Produit", "type": "uc",
                   "duration_months": None, "unit_price": 1000, "quantity": 1, "line_total": 1000}],
        "subtotal": 1000, "payment_fee": 0, "total": 1000, "currency": "Ar",
        "payment_method": "manual", "payment_provider": None, "payment_phone": "0340000000",
        "manual_reference": None, "status": "pending_payment",
        "payment_deadline_at": _iso(datetime.now(timezone.utc) + timedelta(minutes=30)),
        "payment_proofs": [], "admin_note": None,
        "created_at": _iso(), "updated_at": _iso(),
        "history": [{"status": "created", "at": _iso()}],
    }
    doc.update(extra)
    ctx.db.orders.insert_one(dict(doc))
    return doc


def _png(color=(200, 30, 30), size=(32, 32)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _file(payload, name="capture.jpg", content_type="image/jpeg"):
    return ("files", (name, payload, content_type))


def _upload(client, order_id, files, headers=None):
    return client.post(f"/api/orders/{order_id}/proof", files=files, headers=headers or {})


def _proof_entry(blob="a.jpg", stamp=None):
    return {"blob_name": blob, "size": 10, "content_type": "image/jpeg",
            "sha256": "0" * 64, "uploaded_at": stamp or _iso()}


# --------------------------------------------------------------------------- #
# Partie 2 — accès et validation des fichiers
# --------------------------------------------------------------------------- #
class TestProofAccess:
    def test_owner_and_guest_uuid_can_upload(self, client, ctx):
        owner, owner_headers = _user(ctx)
        mine = _order(ctx, user_id=owner["user_id"])
        guest = _order(ctx)  # invité : l'UUID est le secret de fait

        assert _upload(client, mine["id"], [_file(_png())], owner_headers).status_code == 200
        assert _upload(client, guest["id"], [_file(_png())]).status_code == 200
        assert ctx.alerts.named("notify_proof_submitted")
        assert ctx.db.orders.find_one({"id": guest["id"]})["status"] == "proof_submitted"

    def test_other_user_and_anonymous_are_refused(self, client, ctx):
        owner, _owner_headers = _user(ctx)
        _intruder, intruder_headers = _user(ctx)
        order = _order(ctx, user_id=owner["user_id"])

        assert _upload(client, order["id"], [_file(_png())], intruder_headers).status_code == 403
        assert _upload(client, order["id"], [_file(_png())]).status_code == 403
        assert ctx.db.orders.find_one({"id": order["id"]})["status"] == "pending_payment"
        # UUID inconnu (invité sans le bon identifiant) : 404, jamais une fuite d'existence.
        assert _upload(client, str(uuid.uuid4()), [_file(_png())]).status_code == 404

    def test_non_manual_order_is_refused(self, client, ctx):
        order = _order(ctx, payment_method="binance", payment_provider="binance")
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_not_allowed"

    def test_expired_deadline_is_refused(self, client, ctx):
        order = _order(ctx, payment_deadline_at=_iso(datetime.now(timezone.utc) - timedelta(seconds=1)))
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_deadline_passed"

    def test_order_no_longer_waiting_is_refused(self, client, ctx):
        order = _order(ctx, status="proof_submitted", payment_deadline_at=None,
                       payment_proofs=[_proof_entry()])
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_not_pending"


class TestProofValidation:
    def test_fake_jpeg_is_refused_by_content(self, client, ctx):
        order = _order(ctx)
        r = _upload(client, order["id"], [_file(b"not an image at all", "capture.jpg", "image/jpeg")])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_format"
        assert ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"] == []
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0

    def test_extension_and_content_type_are_ignored(self, client, ctx):
        order = _order(ctx)
        # Vrai PNG annoncé en .jpg : accepté, c'est le contenu qui décide.
        r = _upload(client, order["id"], [_file(_png(), "capture.jpg", "image/jpeg")])
        assert r.status_code == 200, r.text
        stored_id = ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"][0]["blob_name"]
        stored = _arun(proofs.read(stored_id))
        assert stored.startswith(b"\xff\xd8\xff")  # réencodé en JPEG côté serveur
        assert ctx.db["payment_proofs.files"].count_documents({"filename": stored_id}) == 0

    def test_more_than_three_files_in_one_request(self, client, ctx):
        order = _order(ctx)
        r = _upload(client, order["id"], [_file(_png()) for _ in range(4)])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_count"

    def test_three_images_maximum_for_the_order(self, client, ctx):
        # Deux preuves déjà déposées (état impossible via l'API, possible via admin/import) :
        # le plafond cumulé de 3 refuse la salve supplémentaire.
        order = _order(ctx, payment_proofs=[_proof_entry("x.jpg"), _proof_entry("y.jpg")])
        r = _upload(client, order["id"], [_file(_png()), _file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_limit"
        assert len(ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"]) == 2

    def test_oversized_input_is_refused(self, client, ctx):
        order = _order(ctx)
        payload = b"\x89PNG\r\n\x1a\n" + b"0" * (proofs.MAX_INPUT_BYTES + 10)
        r = _upload(client, order["id"], [_file(payload)])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_too_large"

    def test_compression_under_300k_without_exif(self):
        # Image bruitée 3000x2000 + EXIF : doit ressortir ≤ 300 Ko, ≤ 1600 px, sans EXIF.
        noise = os.urandom(3000 * 2000 * 3)
        source = Image.frombytes("RGB", (3000, 2000), noise)
        exif = Image.Exif()
        exif[271] = "SecretCamera"  # Make
        raw = io.BytesIO()
        source.save(raw, format="JPEG", quality=95, exif=exif)
        output = proofs.compress(raw.getvalue())
        assert len(output) <= proofs.TARGET_BYTES
        with Image.open(io.BytesIO(output)) as result:
            assert max(result.size) <= proofs.MAX_LONG_SIDE
            assert not dict(result.getexif())

    def test_unreadable_image_is_refused(self):
        with pytest.raises(proofs.ProofError):
            proofs.compress(b"\xff\xd8\xff" + b"\x00" * 64)

    def test_storage_disabled_disables_the_feature_only(self, client, monkeypatch, ctx):
        monkeypatch.setenv("PROOF_STORAGE_ENABLED", "false")
        order = _order(ctx)
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 503
        assert proofs.storage_enabled() is False
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0
        # Les commandes et le reste du site ne sont jamais affectés.
        assert ctx.db.orders.find_one({"id": order["id"]})["status"] == "pending_payment"
        assert client.get(f"/api/orders/{order['id']}").status_code == 200

    def test_public_payload_hides_blob_name_and_hash(self, client, ctx):
        order = _order(ctx)
        assert _upload(client, order["id"], [_file(_png())]).status_code == 200
        body = client.get(f"/api/orders/{order['id']}").json()
        assert set(body["payment_proofs"][0]) == {"size", "content_type", "uploaded_at"}
        assert body["payment_deadline_at"] is None
        assert body["status"] == "proof_submitted"

    def test_admin_reads_content_through_authenticated_route(self, client, ctx):
        order = _order(ctx)
        _upload(client, order["id"], [_file(_png())])
        _admin, admin_headers = _user(ctx, role="admin", permissions=["orders.manage"])
        _user_a, user_headers = _user(ctx)
        assert client.get(f"/api/admin/orders/{order['id']}/proofs/0", headers=user_headers).status_code == 403
        r = client.get(f"/api/admin/orders/{order['id']}/proofs/0", headers=admin_headers)
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
        assert r.headers["cache-control"] == "no-store"
        assert r.content.startswith(b"\xff\xd8\xff")
        assert client.get(f"/api/admin/orders/{order['id']}/proofs/9", headers=admin_headers).status_code == 404


# --------------------------------------------------------------------------- #
# Partie 1 — échéance, expiration atomique, paiement tardif
# --------------------------------------------------------------------------- #
class TestDeadlineAndExpiration:
    def test_new_order_gets_a_deadline_only_while_waiting(self):
        assert orders.initial_status("manual", None) == "pending_payment"
        assert orders.initial_status("manual", "REF-EXISTANTE") == "awaiting_verification"
        deadline = datetime.fromisoformat(order_maintenance.payment_deadline_iso())
        delta = deadline - datetime.now(timezone.utc)
        assert timedelta(minutes=29) < delta <= timedelta(minutes=30, seconds=5)

    def test_expiration_spares_paid_or_proved_orders(self, ctx):
        past = _iso(datetime.now(timezone.utc) - timedelta(minutes=1))
        due = _order(ctx, payment_deadline_at=past)
        paid_meanwhile = _order(ctx, payment_deadline_at=past, paid_at=past, paid_attempt_ref="ref-1")
        with_proof = _order(ctx, payment_deadline_at=past, status="proof_submitted",
                            payment_proofs=[_proof_entry()])
        from_attempt = _order(ctx, payment_deadline_at=past, paid_attempt_ref="ref-2")

        result = _arun(order_maintenance.expire_due_orders())

        assert result["expired"] == 1
        assert ctx.db.orders.find_one({"id": due["id"]})["status"] == "expired"
        assert ctx.db.orders.find_one({"id": paid_meanwhile["id"]})["status"] == "pending_payment"
        assert ctx.db.orders.find_one({"id": from_attempt["id"]})["status"] == "pending_payment"
        assert ctx.db.orders.find_one({"id": with_proof["id"]})["status"] == "proof_submitted"
        # Notification d'expiration : désactivée par défaut (`ALERT_PAYMENT_EXPIRED` absent),
        # donc même planifiée, elle ne produit aucun envoi.
        from services import notifications as notifier
        assert notifier._payment_expired_enabled() is False

    def test_expiration_ignores_future_deadlines_and_legacy_orders(self, ctx):
        future = _order(ctx)
        legacy = _order(ctx)
        ctx.db.orders.update_one({"id": legacy["id"]}, {"$unset": {"payment_deadline_at": ""}})

        assert _arun(order_maintenance.expire_due_orders())["expired"] == 0
        assert ctx.db.orders.find_one({"id": future["id"]})["status"] == "pending_payment"
        assert ctx.db.orders.find_one({"id": legacy["id"]})["status"] == "pending_payment"

    def test_binance_slot_is_released_without_touching_the_unique_index(self, ctx):
        past = _iso(datetime.now(timezone.utc) - timedelta(minutes=1))
        order = _order(ctx, payment_deadline_at=past, payment_method="binance",
                       payment_provider="binance", payment_phone=None)
        payment_id = str(uuid.uuid4())
        ctx.db.crypto_payments.insert_one({
            "id": payment_id, "order_id": order["id"], "status": "WAITING", "slot_open": True,
            "network": "TRC20", "amount_usdt": f"1.{uuid.uuid4().int % 9000 + 1000}",
            "created_at": _iso(), "expires_at": _iso(datetime.now(timezone.utc) + timedelta(minutes=30)),
        })
        indexes_before = ctx.db.crypto_payments.index_information()

        result = _arun(order_maintenance.expire_due_orders())

        assert result["expired"] == 1 and result["released_crypto"] == 1
        after = ctx.db.crypto_payments.find_one({"id": payment_id})
        assert after["status"] == "FAILED" and "slot_open" not in after
        assert after["failure_reason"] == "order_expired"
        assert ctx.db.crypto_payments.index_information() == indexes_before
        assert "crypto_open_amount" in indexes_before

    def test_crypto_late_deposit_marks_late_payment_never_delivers(self, ctx):
        old = _iso(datetime.now(timezone.utc) - timedelta(hours=1))
        order = _order(ctx, status="expired", payment_method="binance", payment_provider="binance",
                       payment_phone=None, payment_deadline_at=old, expired_at=old)
        payment_id = str(uuid.uuid4())
        amount = "2.0001"
        ctx.db.crypto_payments.insert_one({"id": payment_id, "order_id": order["id"], "status": "FAILED",
                                           "network": "TRC20", "amount_usdt": amount,
                                           "failure_reason": "order_expired"})
        tx = f"tx-{uuid.uuid4().hex}"
        dep = {"txId": tx, "coin": "USDT", "amount": amount, "network": "TRC20",
               "status": 1, "insertTime": 1760000000000, "address": "TXYZ"}

        result = _arun(binance_watcher._no_candidate(dep, "TRC20", amount))

        assert result == "payment_expired"
        updated = ctx.db.orders.find_one({"id": order["id"]})
        assert updated["status"] == "late_payment"
        assert updated["late_payment"]["tx_hash"] == tx
        assert updated["history"][-1]["status"] == "late_payment"
        assert ctx.alerts.named("notify_late_success")
        assert ctx.db.crypto_unmatched.find_one({"tx_hash": tx})

    def test_late_deposit_on_a_still_pending_order_changes_nothing(self, ctx):
        order = _order(ctx, payment_method="binance", payment_provider="binance", payment_phone=None)
        payment_id = str(uuid.uuid4())
        ctx.db.crypto_payments.insert_one({"id": payment_id, "order_id": order["id"], "status": "FAILED",
                                           "network": "BEP20", "amount_usdt": "3.1234",
                                           "failure_reason": "order_expired"})
        tx = f"tx-{uuid.uuid4().hex}"
        dep = {"txId": tx, "coin": "USDT", "amount": "3.1234", "network": "BEP20",
               "status": 1, "insertTime": 1760000000000, "address": "0xabc"}

        assert _arun(binance_watcher._no_candidate(dep, "BEP20", "3.1234")) == "payment_expired"
        assert ctx.db.orders.find_one({"id": order["id"]})["status"] == "pending_payment"

    def test_gateway_late_success_turns_expired_into_late_payment(self, ctx):
        order = _order(ctx, status="expired")
        client_ref = f"ref-{uuid.uuid4().hex}"
        ctx.db.payments.insert_one({"client_ref": client_ref, "order_id": order["id"],
                                    "status": "completed", "amount": 1000, "gateway": "papi",
                                    "order_number": order["order_number"]})
        attempt = {"client_ref": client_ref, "order_id": order["id"], "amount": 1000,
                   "order_number": order["order_number"], "gateway": "papi"}

        _arun(payment_router.record_late_success(attempt, "papi", None, payment_from=("completed",)))

        assert ctx.db.orders.find_one({"id": order["id"]})["status"] == "late_payment"
        assert ctx.db.payments.find_one({"client_ref": client_ref})["status"] == "late_success"

    def test_expired_orders_are_purged_after_seven_days_only(self, ctx):
        old = _iso(datetime.now(timezone.utc) - timedelta(days=8))
        recent = _iso(datetime.now(timezone.utc) - timedelta(days=2))
        gone = _order(ctx, status="expired", expired_at=old)
        kept = _order(ctx, status="expired", expired_at=recent)
        paid = _order(ctx, status="expired", expired_at=old)
        ref = f"ref-{uuid.uuid4().hex}"
        ctx.db.payments.insert_one({"client_ref": ref, "order_id": paid["id"], "status": "completed"})

        result = _arun(order_maintenance.purge_expired_orders())

        assert result["purged_orders"] == 1
        assert ctx.db.orders.find_one({"id": gone["id"]}) is None
        assert ctx.db.orders.find_one({"id": kept["id"]}) is not None
        assert ctx.db.orders.find_one({"id": paid["id"]}) is not None


# --------------------------------------------------------------------------- #
# Partie 3 — relance client
# --------------------------------------------------------------------------- #
class TestRemind:
    def _prepared(self, ctx):
        return _order(ctx, status="proof_submitted", proof_submitted_at=_iso(), payment_deadline_at=None,
                      payment_proofs=[_proof_entry()])

    def test_cooldown_then_limit(self, client, ctx):
        order = self._prepared(ctx)
        first = client.post(f"/api/orders/{order['id']}/remind")
        assert first.status_code == 200, first.text
        assert first.json()["reminders_left"] == 2
        assert first.json()["remaining_seconds"] == 180

        again = client.post(f"/api/orders/{order['id']}/remind")
        assert again.status_code == 429
        detail = again.json()["detail"]
        assert detail["code"] == "remind_cooldown" and detail["remaining_seconds"] > 0
        assert detail["reminders_left"] == 2

        ctx.db.orders.update_one({"id": order["id"]},
                                 {"$set": {"proof_remind_count": 3,
                                           "proof_reminded_at": _iso(datetime.now(timezone.utc) - timedelta(minutes=5))}})
        capped = client.post(f"/api/orders/{order['id']}/remind")
        assert capped.status_code == 429 and capped.json()["detail"]["code"] == "remind_limit"
        assert len(ctx.alerts.named("notify_proof_remind")) == 1

    def test_remind_requires_a_pending_proof(self, client, ctx):
        order = _order(ctx)
        r = client.post(f"/api/orders/{order['id']}/remind")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "remind_not_pending"

    def test_processed_proof_cannot_be_reminded(self, client, ctx):
        order = self._prepared(ctx)
        ctx.db.orders.update_one({"id": order["id"]}, {"$set": {"proof_validated_at": _iso()}})
        r = client.post(f"/api/orders/{order['id']}/remind")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "remind_already_processed"


# --------------------------------------------------------------------------- #
# Partie 4 — stockage GridFS, quota et suppression des preuves
# --------------------------------------------------------------------------- #
def _stored(payload: bytes = b"proof") -> str:
    return _arun(proofs.save(payload))


class TestGridFSStorage:
    def test_roundtrip_read_and_idempotent_delete(self, ctx):
        stored = _stored(b"\xff\xd8\xffcontenu")
        assert _arun(proofs.read(stored)) == b"\xff\xd8\xffcontenu"
        document = ctx.db["payment_proofs.files"].find_one({"_id": ObjectId(stored)})
        assert document["filename"].endswith(".jpg")
        assert len(document["filename"]) == len("0123456789abcdef0123456789abcdef.jpg")
        assert document["metadata"]["content_type"] == "image/jpeg"
        assert _arun(proofs.delete(stored)) is True
        assert _arun(proofs.delete(stored)) is True  # déjà absent : pas une erreur
        with pytest.raises(proofs.ProofNotFound):
            _arun(proofs.read(stored))

    def test_dedicated_bucket_is_used(self, ctx):
        _stored(b"x")
        assert ctx.db["payment_proofs.files"].count_documents({}) == 1
        assert ctx.db["payment_proofs.chunks"].count_documents({}) == 1
        assert ctx.db["fs.files"].count_documents({}) == 0

    def test_public_payload_never_carries_the_storage_id(self, client, ctx):
        order = _order(ctx)
        assert _upload(client, order["id"], [_file(_png())]).status_code == 200
        body = client.get(f"/api/orders/{order['id']}").json()
        proof = body["payment_proofs"][0]
        assert set(proof) == {"size", "content_type", "uploaded_at"}
        assert "blob_name" not in proof and "sha256" not in proof
        # Aucune route de lecture publique : seules les routes admin exposent « proofs ».
        paths = [getattr(route, "path", "") for route in orders.router.routes]
        assert all(path.startswith("/admin/") for path in paths if "proofs" in path)
        assert client.get(f"/api/orders/{order['id']}/proofs/0").status_code in (404, 405)


class TestQuota:
    def test_quota_exceeded_refuses_cleanly_and_alerts_once(self, client, monkeypatch, ctx):
        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "0")
        order = _order(ctx)
        assert _upload(client, order["id"], [_file(_png())]).status_code == 503
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0
        document = ctx.db.orders.find_one({"id": order["id"]})
        assert document["status"] == "pending_payment"
        assert document["payment_proofs"] == []
        assert _upload(client, order["id"], [_file(_png())]).status_code == 503
        assert len(ctx.alerts.named("notify_proof_storage_full")) == 1

    def test_upload_under_the_quota_is_accepted(self, client, monkeypatch, ctx):
        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "1")  # 1 Mo, largement au-dessus d'une capture
        order = _order(ctx)
        assert _upload(client, order["id"], [_file(_png())]).status_code == 200
        assert ctx.db["payment_proofs.files"].count_documents({}) == 1
        assert _arun(proofs.usage_bytes()) < 1024 * 1024

    def test_alert_fires_again_after_a_recovery(self, client, monkeypatch, ctx):
        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "0")
        saturated = _order(ctx)
        assert _upload(client, saturated["id"], [_file(_png())]).status_code == 503
        assert len(ctx.alerts.named("notify_proof_storage_full")) == 1

        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "1")
        recovered = _order(ctx)
        assert _upload(client, recovered["id"], [_file(_png())]).status_code == 200

        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "0")
        again = _order(ctx)
        assert _upload(client, again["id"], [_file(_png())]).status_code == 503
        assert len(ctx.alerts.named("notify_proof_storage_full")) == 2


class TestProofPurge:
    def _final_order(self, ctx, stored_ids, ages_days=8, status="delivered"):
        stamp = _iso(datetime.now(timezone.utc) - timedelta(days=ages_days))
        return _order(ctx, status=status, payment_deadline_at=None,
                      payment_proofs=[{**_proof_entry(stored_id), "uploaded_at": stamp}
                                      for stored_id in stored_ids],
                      updated_at=stamp)

    def test_retention_of_three_days_is_honoured(self, ctx, monkeypatch):
        # PL-PROOF-QUOTA-1 : la rétention reste lue dans l'environnement (Render la réglera à 3).
        monkeypatch.setenv("PROOF_RETENTION_DAYS", "3")
        old = self._final_order(ctx, [_stored(b"1")], ages_days=4)
        recent = self._final_order(ctx, [_stored(b"2")], ages_days=2)

        assert _arun(order_maintenance.purge_order_proofs())["purged_blobs"] == 1
        assert ctx.db.orders.find_one({"id": old["id"]})["payment_proofs"][0]["purged_at"]
        assert "purged_at" not in ctx.db.orders.find_one({"id": recent["id"]})["payment_proofs"][0]
        assert ctx.db["payment_proofs.files"].count_documents({}) == 1

    def test_purge_is_idempotent_and_keeps_metadata(self, ctx):
        order = self._final_order(ctx, [_stored(b"1"), _stored(b"2")])

        first = _arun(order_maintenance.purge_order_proofs())
        second = _arun(order_maintenance.purge_order_proofs())

        assert first["purged_blobs"] == 2
        assert second["purged_blobs"] == 0
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0
        assert _arun(proofs.usage_bytes()) == 0
        doc = ctx.db.orders.find_one({"id": order["id"]})
        assert all(entry["purged_at"] for entry in doc["payment_proofs"])
        assert all(entry["sha256"] and entry["size"] for entry in doc["payment_proofs"])
        assert "proofs_purged_at" in doc

    def test_storage_failure_never_blocks_the_rest(self, ctx, monkeypatch):
        broken_id = _stored(b"1")
        healthy_id = _stored(b"2")
        broken = self._final_order(ctx, [broken_id])
        healthy = self._final_order(ctx, [healthy_id])
        real_delete = proofs.delete

        async def flaky(stored_id):
            if stored_id == broken_id:
                raise RuntimeError("gridfs down")
            return await real_delete(stored_id)

        monkeypatch.setattr(proofs, "delete", flaky)
        result = _arun(order_maintenance.purge_order_proofs())

        assert result["purged_blobs"] == 1
        assert ctx.db.orders.find_one({"id": healthy["id"]})["proofs_purged_at"]
        broken_doc = ctx.db.orders.find_one({"id": broken["id"]})
        assert "purged_at" not in broken_doc["payment_proofs"][0]

        # Le fichier en échec est réessayé au passage suivant (updated_at non rajeuni).
        monkeypatch.setattr(proofs, "delete", real_delete)
        retry = _arun(order_maintenance.purge_order_proofs())
        assert retry["purged_blobs"] == 1
        assert ctx.db.orders.find_one({"id": broken["id"]})["proofs_purged_at"]
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0

    def test_recent_final_order_is_kept(self, ctx):
        stored_id = _stored(b"1")
        order = self._final_order(ctx, [stored_id], ages_days=1)

        assert _arun(order_maintenance.purge_order_proofs())["purged_blobs"] == 0
        assert _arun(proofs.read(stored_id)) == b"1"
        assert "purged_at" not in ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"][0]

    def test_purge_covers_cancelled_failed_and_expired(self, ctx):
        orders = [self._final_order(ctx, [_stored(b"1")], status=status)
                  for status in ("cancelled", "failed", "expired")]

        assert _arun(order_maintenance.purge_order_proofs())["purged_blobs"] == 3
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0
        assert all(ctx.db.orders.find_one({"id": order["id"]})["proofs_purged_at"] for order in orders)


# --------------------------------------------------------------------------- #
# Route interne du cron
# --------------------------------------------------------------------------- #
class TestCronRoute:
    def test_route_requires_the_shared_cron_token(self, client, monkeypatch, ctx):
        called = []
        monkeypatch.setattr(order_maintenance, "run_all", lambda *a, **k: called.append(True) or {})
        monkeypatch.setenv("CRON_TOKEN", "secret-test")
        assert client.post("/api/internal/orders/run").status_code == 401
        assert client.post("/api/internal/orders/run", headers={"X-Cron-Token": "wrong"}).status_code == 401
        ok = client.post("/api/internal/orders/run", headers={"X-Cron-Token": "secret-test"})
        assert ok.status_code == 200 and called
        assert "secret-test" not in ok.text

    def test_route_is_closed_without_token(self, client, monkeypatch, ctx):
        monkeypatch.delenv("CRON_TOKEN", raising=False)
        assert client.post("/api/internal/orders/run").status_code == 503


# --------------------------------------------------------------------------- #
# PL-PROOF-QUOTA-1 — garde-fou sur la taille RÉELLE de la base (dbStats)
# --------------------------------------------------------------------------- #
MB = 1024 * 1024


def _db_stats(monkeypatch, value):
    """Remplace la lecture `dbStats` et vide le cache (une valeur fixe, comptée)."""
    calls = []

    async def fake():
        calls.append(value)
        return value

    monkeypatch.setattr(proofs, "_read_db_stats", fake)
    proofs.reset_db_usage_cache()
    return calls


class TestDbStats:
    def test_storage_plus_index_size(self, monkeypatch):
        class FakeDatabase:
            async def command(self, name, **kwargs):
                assert name == "dbStats" and kwargs.get("scale") == 1
                return {"storageSize": 300, "indexSize": 45}

        monkeypatch.setattr(proofs, "db", FakeDatabase())
        proofs.reset_db_usage_cache()
        assert _arun(proofs.db_usage_bytes) == 345

    def test_error_or_refused_command_is_unknown_never_an_exception(self, monkeypatch):
        from pymongo.errors import OperationFailure

        for error in (RuntimeError("mongo down"), OperationFailure("not allowed")):
            class FakeDatabase:
                async def command(self, *args, **kwargs):
                    raise error

            monkeypatch.setattr(proofs, "db", FakeDatabase())
            proofs.reset_db_usage_cache()
            assert _arun(proofs.db_usage_bytes) is None

    def test_cache_is_used_for_five_minutes(self, monkeypatch):
        calls = _db_stats(monkeypatch, 123)
        clock = [1000.0]
        monkeypatch.setattr(proofs, "_clock", lambda: clock[0])
        proofs.reset_db_usage_cache()

        assert _arun(proofs.db_usage_bytes) == 123
        clock[0] += 299  # toujours dans la fenêtre
        assert _arun(proofs.db_usage_bytes) == 123
        assert len(calls) == 1
        clock[0] += 2  # 301 s : re-mesure
        assert _arun(proofs.db_usage_bytes) == 123
        assert len(calls) == 2


class TestDbQuotaGuard:
    def test_full_database_refuses_with_the_existing_503_and_keeps_the_order(self, client, monkeypatch, ctx):
        _db_stats(monkeypatch, 10 * MB)
        monkeypatch.setenv("PROOF_DB_MAX_MB", "0")  # seuil atteint pour toute taille connue
        order = _order(ctx)

        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 503
        # Contrat IDENTIQUE au quota d'images existant (même corps, même message).
        assert r.json()["detail"] == "Envoi de preuve indisponible."
        document = ctx.db.orders.find_one({"id": order["id"]})
        assert document["status"] == "pending_payment"
        assert document["payment_proofs"] == []
        assert ctx.db["payment_proofs.files"].count_documents({}) == 0
        assert len(ctx.alerts.named("notify_proof_db_full")) == 1

        # Deuxième refus du même dépassement : une seule alerte.
        assert _upload(client, order["id"], [_file(_png())]).status_code == 503
        assert len(ctx.alerts.named("notify_proof_db_full")) == 1

    def test_alert_fires_again_after_a_recovery(self, client, monkeypatch, ctx):
        _db_stats(monkeypatch, 10 * MB)
        monkeypatch.setenv("PROOF_DB_MAX_MB", "0")
        blocked = _order(ctx)
        assert _upload(client, blocked["id"], [_file(_png())]).status_code == 503
        assert len(ctx.alerts.named("notify_proof_db_full")) == 1

        monkeypatch.setenv("PROOF_DB_MAX_MB", "100")  # 100 Mo > 10 Mo : un envoi repasse
        recovered = _order(ctx)
        assert _upload(client, recovered["id"], [_file(_png())]).status_code == 200
        assert ctx.db["proof_db_alerts"].count_documents({}) == 0  # marqueur refermé

        monkeypatch.setenv("PROOF_DB_MAX_MB", "0")
        again = _order(ctx)
        assert _upload(client, again["id"], [_file(_png())]).status_code == 503
        assert len(ctx.alerts.named("notify_proof_db_full")) == 2

    def test_unknown_database_size_blocks_nothing(self, client, monkeypatch, ctx):
        _db_stats(monkeypatch, None)  # commande refusée / panne : taille inconnue
        monkeypatch.setenv("PROOF_DB_MAX_MB", "0")
        order = _order(ctx)

        assert _upload(client, order["id"], [_file(_png())]).status_code == 200
        assert ctx.db.orders.find_one({"id": order["id"]})["status"] == "proof_submitted"
        assert not ctx.alerts.named("notify_proof_db_full")


class TestStorageWarning:
    def test_one_daily_alert_and_only_one(self, monkeypatch, ctx):
        _db_stats(monkeypatch, 360 * MB)
        monkeypatch.setenv("PROOF_DB_WARN_MB", "350")
        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "150")
        day1 = datetime(2026, 11, 10, 8, tzinfo=timezone.utc)

        first = _arun(order_maintenance.run_all, day1)
        assert first["storage_alerts"] == 1
        alerts = ctx.alerts.named("notify_storage_warning")
        assert len(alerts) == 1
        db_bytes, db_limit, _proofs_bytes, _proofs_limit, day = alerts[0][1]
        assert db_bytes == 360 * MB and db_limit == 400 * MB and day == "2026-11-10"

        second = _arun(order_maintenance.run_all, day1)
        assert second["storage_alerts"] == 0
        assert len(ctx.alerts.named("notify_storage_warning")) == 1

        third = _arun(order_maintenance.run_all, day1 + timedelta(days=1))
        assert third["storage_alerts"] == 1
        assert len(ctx.alerts.named("notify_storage_warning")) == 2

    def test_proofs_at_eighty_percent_trigger_the_warning(self, monkeypatch, ctx):
        _db_stats(monkeypatch, 1 * MB)
        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "100")

        async def fake_usage():
            return 80 * MB

        monkeypatch.setattr(proofs, "usage_bytes", fake_usage)
        day = datetime(2026, 11, 10, tzinfo=timezone.utc)
        assert _arun(proofs.check_storage_warnings, day) == {"storage_alerts": 1}
        assert len(ctx.alerts.named("notify_storage_warning")) == 1

    def test_below_thresholds_no_alert(self, monkeypatch, ctx):
        _db_stats(monkeypatch, 100 * MB)
        monkeypatch.setenv("PROOF_MAX_TOTAL_MB", "150")
        day = datetime(2026, 11, 10, tzinfo=timezone.utc)

        assert _arun(proofs.check_storage_warnings, day) == {"storage_alerts": 0}
        assert not ctx.alerts.named("notify_storage_warning")


class TestStorageRoute:
    def _headers(self, ctx):
        _admin, headers = _user(ctx, role="admin", permissions=["orders.manage"])
        return headers

    def test_route_is_protected_and_payload_is_minimal(self, client, ctx):
        assert client.get("/api/admin/storage").status_code == 401
        _customer, customer_headers = _user(ctx)
        assert client.get("/api/admin/storage", headers=customer_headers).status_code == 403
        _no_perm, no_perm_headers = _user(ctx, role="admin", permissions=[])
        assert client.get("/api/admin/storage", headers=no_perm_headers).status_code == 403

        _stored(b"proof")  # proofs_count = 1, aucun ordre nécessaire
        r = client.get("/api/admin/storage", headers=self._headers(ctx))
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"db_bytes", "db_limit_mb", "proofs_bytes", "proofs_limit_mb",
                             "proofs_count", "status"}
        assert body["db_limit_mb"] == 400 and body["proofs_limit_mb"] == 150
        assert body["proofs_count"] == 1 and body["status"] == "ok"
        # Aucune donnée de commande ni de client.
        assert all(key not in body for key in ("orders", "users", "email", "pubg_id"))

    def test_status_ok_warn_full_unknown(self, client, monkeypatch, ctx):
        headers = self._headers(ctx)
        value = [10 * MB]

        async def fake():
            return value[0]

        monkeypatch.setattr(proofs, "_read_db_stats", fake)

        proofs.reset_db_usage_cache()
        assert client.get("/api/admin/storage", headers=headers).json()["status"] == "ok"

        proofs.reset_db_usage_cache()
        value[0] = 360 * MB
        assert client.get("/api/admin/storage", headers=headers).json()["status"] == "warn"

        proofs.reset_db_usage_cache()
        value[0] = 400 * MB
        assert client.get("/api/admin/storage", headers=headers).json()["status"] == "full"

        proofs.reset_db_usage_cache()
        value[0] = None
        body = client.get("/api/admin/storage", headers=headers).json()
        assert body["status"] == "unknown" and body["db_bytes"] is None
