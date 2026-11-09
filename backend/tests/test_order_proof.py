"""PL-ORDER-PROOF-1 — commande + preuve de paiement (backend uniquement).

Aucun réseau réel : Azure Blob est remplacé par un faux client en mémoire, les alertes sont
enregistrées au lieu d'être envoyées. Chaque test travaille dans une base MongoDB LOCALE jetable
(`mgs_proof_test_<aléa>`) : aucun document réel, aucune interférence entre workers xdist.
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
                   core_security, core_audit, evo_router):
        monkeypatch.setattr(module, "db", motor_db)
    alerts = _Alerts()
    monkeypatch.setattr("services.notifications.schedule", alerts)
    monkeypatch.setattr(binance_watcher.notifications, "schedule", alerts)
    _arun(core_db.ensure_indexes)
    yield SimpleNamespace(db=sync_db, alerts=alerts)
    loop.run_until_complete(_close_client(async_client))
    _mongo.drop_database(name)


class FakeDownload:
    def __init__(self, payload):
        self.payload = payload

    def readall(self):
        return self.payload


class FakeBlob:
    """Faux blob Azure : un dictionnaire partagé, aucune connexion réseau."""

    def __init__(self, store, name, failures):
        self.store, self.name, self.failures = store, name, failures

    def upload_blob(self, data, overwrite=False, content_settings=None):
        assert overwrite is False
        assert content_settings.content_type == "image/jpeg"
        self.store[self.name] = data

    def download_blob(self):
        if self.name not in self.store:
            raise FileNotFoundError(self.name)
        return FakeDownload(self.store[self.name])

    def delete_blob(self):
        from azure.core.exceptions import ResourceNotFoundError

        if self.name in self.failures:
            raise RuntimeError("azure down")
        if self.name not in self.store:
            raise ResourceNotFoundError("absent")  # idempotence : déjà supprimé = pas une erreur
        del self.store[self.name]


@pytest.fixture
def blob_store(monkeypatch):
    store, failures = {}, set()
    monkeypatch.setenv("AZURE_STORAGE_CONNECTION_STRING", "UseDevelopmentStorage=true")
    monkeypatch.setenv("AZURE_PROOF_CONTAINER", "proofs-test")
    monkeypatch.setattr(proofs, "_blob_client", lambda name: FakeBlob(store, name, failures))
    return store, failures


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
    def test_owner_and_guest_uuid_can_upload(self, client, blob_store, ctx):
        owner, owner_headers = _user(ctx)
        mine = _order(ctx, user_id=owner["user_id"])
        guest = _order(ctx)  # invité : l'UUID est le secret de fait

        assert _upload(client, mine["id"], [_file(_png())], owner_headers).status_code == 200
        assert _upload(client, guest["id"], [_file(_png())]).status_code == 200
        assert ctx.alerts.named("notify_proof_submitted")
        assert ctx.db.orders.find_one({"id": guest["id"]})["status"] == "proof_submitted"

    def test_other_user_and_anonymous_are_refused(self, client, blob_store, ctx):
        owner, _owner_headers = _user(ctx)
        _intruder, intruder_headers = _user(ctx)
        order = _order(ctx, user_id=owner["user_id"])

        assert _upload(client, order["id"], [_file(_png())], intruder_headers).status_code == 403
        assert _upload(client, order["id"], [_file(_png())]).status_code == 403
        assert ctx.db.orders.find_one({"id": order["id"]})["status"] == "pending_payment"
        # UUID inconnu (invité sans le bon identifiant) : 404, jamais une fuite d'existence.
        assert _upload(client, str(uuid.uuid4()), [_file(_png())]).status_code == 404

    def test_non_manual_order_is_refused(self, client, blob_store, ctx):
        order = _order(ctx, payment_method="binance", payment_provider="binance")
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_not_allowed"

    def test_expired_deadline_is_refused(self, client, blob_store, ctx):
        order = _order(ctx, payment_deadline_at=_iso(datetime.now(timezone.utc) - timedelta(seconds=1)))
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_deadline_passed"

    def test_order_no_longer_waiting_is_refused(self, client, blob_store, ctx):
        order = _order(ctx, status="proof_submitted", payment_deadline_at=None,
                       payment_proofs=[_proof_entry()])
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_not_pending"


class TestProofValidation:
    def test_fake_jpeg_is_refused_by_content(self, client, blob_store, ctx):
        order = _order(ctx)
        r = _upload(client, order["id"], [_file(b"not an image at all", "capture.jpg", "image/jpeg")])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_format"
        assert ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"] == []
        assert blob_store[0] == {}

    def test_extension_and_content_type_are_ignored(self, client, blob_store, ctx):
        order = _order(ctx)
        # Vrai PNG annoncé en .jpg : accepté, c'est le contenu qui décide.
        r = _upload(client, order["id"], [_file(_png(), "capture.jpg", "image/jpeg")])
        assert r.status_code == 200, r.text
        stored = list(blob_store[0].values())[0]
        assert stored.startswith(b"\xff\xd8\xff")  # réencodé en JPEG côté serveur

    def test_more_than_three_files_in_one_request(self, client, blob_store, ctx):
        order = _order(ctx)
        r = _upload(client, order["id"], [_file(_png()) for _ in range(4)])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_count"

    def test_three_images_maximum_for_the_order(self, client, blob_store, ctx):
        # Deux preuves déjà déposées (état impossible via l'API, possible via admin/import) :
        # le plafond cumulé de 3 refusek la salve supplémentaire.
        order = _order(ctx, payment_proofs=[_proof_entry("x.jpg"), _proof_entry("y.jpg")])
        r = _upload(client, order["id"], [_file(_png()), _file(_png())])
        assert r.status_code == 409 and r.json()["detail"]["code"] == "proof_limit"
        assert len(ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"]) == 2

    def test_oversized_input_is_refused(self, client, blob_store, ctx):
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

    def test_azure_missing_disables_the_feature_only(self, client, monkeypatch, ctx):
        monkeypatch.delenv("AZURE_STORAGE_CONNECTION_STRING", raising=False)
        monkeypatch.delenv("AZURE_PROOF_CONTAINER", raising=False)
        order = _order(ctx)
        r = _upload(client, order["id"], [_file(_png())])
        assert r.status_code == 503
        assert proofs.configured() is False
        assert _arun(order_maintenance.purge_order_proofs())["skipped"] == "storage_not_configured"
        # Le reste du site fonctionne : la commande se lit normalement.
        assert client.get(f"/api/orders/{order['id']}").status_code == 200

    def test_public_payload_hides_blob_name_and_hash(self, client, blob_store, ctx):
        order = _order(ctx)
        assert _upload(client, order["id"], [_file(_png())]).status_code == 200
        body = client.get(f"/api/orders/{order['id']}").json()
        assert set(body["payment_proofs"][0]) == {"size", "content_type", "uploaded_at"}
        assert body["payment_deadline_at"] is None
        assert body["status"] == "proof_submitted"

    def test_admin_reads_content_through_authenticated_route(self, client, blob_store, ctx):
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
# Partie 4 — suppression des preuves
# --------------------------------------------------------------------------- #
class TestProofPurge:
    def _final_order(self, ctx, blobs, ages_days=8, status="delivered"):
        stamp = _iso(datetime.now(timezone.utc) - timedelta(days=ages_days))
        return _order(ctx, status=status, payment_deadline_at=None,
                      payment_proofs=[{**_proof_entry(name), "uploaded_at": stamp} for name in blobs],
                      updated_at=stamp)

    def test_purge_is_idempotent_and_keeps_metadata(self, blob_store, ctx):
        store, _failures = blob_store
        order = self._final_order(ctx, ["a.jpg", "b.jpg"])
        store.update({"a.jpg": b"1", "b.jpg": b"2"})

        first = _arun(order_maintenance.purge_order_proofs())
        second = _arun(order_maintenance.purge_order_proofs())

        assert first["purged_blobs"] == 2
        assert second["purged_blobs"] == 0
        assert store == {}
        doc = ctx.db.orders.find_one({"id": order["id"]})
        assert all(entry["purged_at"] for entry in doc["payment_proofs"])
        assert all(entry["sha256"] and entry["size"] for entry in doc["payment_proofs"])
        assert "proofs_purged_at" in doc

    def test_azure_failure_never_blocks_the_rest(self, blob_store, ctx):
        store, failures = blob_store
        broken = self._final_order(ctx, ["ko.jpg"])
        healthy = self._final_order(ctx, ["ok.jpg"])
        store.update({"ko.jpg": b"1", "ok.jpg": b"2"})
        failures.add("ko.jpg")

        result = _arun(order_maintenance.purge_order_proofs())

        assert result["purged_blobs"] == 1
        assert ctx.db.orders.find_one({"id": healthy["id"]})["proofs_purged_at"]
        broken_doc = ctx.db.orders.find_one({"id": broken["id"]})
        assert "purged_at" not in broken_doc["payment_proofs"][0]
        assert "ok.jpg" not in store and "ko.jpg" in store

        # Le blob en échec est réessayé au passage suivant (updated_at non rajeuni).
        failures.clear()
        retry = _arun(order_maintenance.purge_order_proofs())
        assert retry["purged_blobs"] == 1
        assert ctx.db.orders.find_one({"id": broken["id"]})["proofs_purged_at"]
        assert store == {}

    def test_recent_final_order_is_kept(self, blob_store, ctx):
        store, _failures = blob_store
        order = self._final_order(ctx, ["recent.jpg"], ages_days=1)
        store["recent.jpg"] = b"1"

        assert _arun(order_maintenance.purge_order_proofs())["purged_blobs"] == 0
        assert "recent.jpg" in store
        assert "purged_at" not in ctx.db.orders.find_one({"id": order["id"]})["payment_proofs"][0]

    def test_purge_covers_cancelled_failed_and_expired(self, blob_store, ctx):
        store, _failures = blob_store
        orders = [self._final_order(ctx, [f"{status}.jpg"], status=status)
                  for status in ("cancelled", "failed", "expired")]
        for entry in orders:
            store[f"{entry['status']}.jpg"] = b"1"

        assert _arun(order_maintenance.purge_order_proofs())["purged_blobs"] == 3
        assert store == {}


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
