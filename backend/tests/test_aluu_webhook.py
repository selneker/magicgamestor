"""Lot 5 — route webhook ALUU : signature, dédup, monotonie, barrière fournisseur.

Tests PURS : aucun Mongo, aucun réseau. La route est exercée par `TestClient` (vrais en-têtes,
vrai corps binaire, vrai code HTTP) ; `core.db.db` est remplacé par un double en mémoire et le
seul appel sortant possible (`providers.get_provider_by_name("aluu")`) reste l'adaptateur réel,
dont la vérification de signature et le parsing sont purs.

Contrat vérifié, dans l'ordre de la doc « Top-up webhooks » :
1. signature HMAC sur les OCTETS BRUTS reçus, fenêtre de 5 minutes ;
2. aucun secret configuré = rejet, jamais une 500 ;
3. dédup sur `(provider, provider_order_id, status)` ;
4. statut final appliqué une seule fois, jamais remplacé ;
5. commande inconnue acquittée (pas de retry) ;
6. barrière `provider == "aluu"` : une unité FazerCards n'est jamais touchée.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import time
from copy import deepcopy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

from core import db as core_db
from routers import aluu as aluu_router
from services import fzr_fulfillment, providers

SECRET = "aluu_dummy_webhook_secret_for_tests"      # valeur de test, jamais un secret réel
PATH = "/api/aluu/webhook"
PARTNER_ID = "MGS-1-1"

GAME_ID = "example-game"
ALUU_GAME = {
    "id": GAME_ID, "provider": "aluu", "aluu_game_code": "ff",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
}
PRODUCT = {"id": "p-60", "game_id": GAME_ID, "name": "60 Diamants", "uc_amount": 60,
           "price": 5000, "active": True, "requires_mapping": True,
           "aluu_mapping": {"game_code": "ff", "denom": "60", "confirmed": True}}

ALUU_UNIT = {
    "provider": "aluu", "status": "submitted", "provider_order_id": PARTNER_ID,
    "partner_order_id": PARTNER_ID, "aluu_order_id": "ALUU-1", "provider_status": "pending",
    "line_index": 0, "component_index": None, "quantity_index": 0,
    "category_id": "ff", "offer_id": "60", "product_name": "60 Diamants",
}


def order_doc(**unit):
    return {
        "id": "ord-1", "order_number": "MGS-1", "status": "paid", "game_id": GAME_ID,
        "pubg_id": "000", "identity_snapshot": {"fields": {"player_id": "000"}},
        "total": 5000, "history": [],
        "items": [{"product_id": "p-60", "slug": "slug-p-60", "name": "60 Diamants",
                   "type": "diamond", "unit_price": 5000, "quantity": 1, "line_total": 5000}],
        "fazercards": {**ALUU_UNIT, **unit},
        "provider_order_ids": [PARTNER_ID, "ALUU-1"],
    }


# --------------------------------------------------------------------------- faux Mongo

_MISSING = object()


def _get(doc, path):
    node = doc
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return _MISSING
        node = node[part]
    return node


def _set(doc, path, value):
    parts = path.split(".")
    node = doc
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value


def _matches(doc, query) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, part) for part in expected):
                return False
            continue
        value = _get(doc, key)
        if isinstance(expected, dict):
            if "$exists" in expected:
                if (value is not _MISSING) is not bool(expected["$exists"]):
                    return False
                continue
            raise AssertionError(f"opérateur non géré : {expected}")
        if value is _MISSING:
            return False
        if isinstance(value, list):
            if expected not in value:
                return False
            continue
        if value != expected:
            return False
    return True


def _project(doc, projection):
    if not projection:
        return deepcopy(doc)
    wanted = [key for key, flag in projection.items() if flag and key != "_id"]
    out = {key: deepcopy(doc[key]) for key in wanted if key in doc} if wanted else deepcopy(doc)
    if projection.get("_id", 1) == 0:
        out.pop("_id", None)
    return out


class FakeCollection:
    """Collection en mémoire ; `unique` porte les clés d'un index unique COMPOSITE."""

    def __init__(self, documents=(), unique=()):
        self.documents = [deepcopy(doc) for doc in documents]
        self.unique = tuple(tuple(fields) for fields in unique)

    async def find_one(self, query, projection=None):
        for doc in self.documents:
            if _matches(doc, query):
                return _project(doc, projection)
        return None

    async def insert_one(self, document):
        for fields in self.unique:
            if any(all(doc.get(f) == document.get(f) for f in fields) for doc in self.documents):
                raise DuplicateKeyError(f"E11000 duplicate key {fields}")
        self.documents.append(deepcopy(document))

    async def update_one(self, selector, update):
        for doc in self.documents:
            if not _matches(doc, selector):
                continue
            before = deepcopy(doc)
            for path, value in (update.get("$set") or {}).items():
                _set(doc, path, deepcopy(value))
            for path, value in (update.get("$push") or {}).items():
                _set(doc, path, (doc.get(path) or []) + [deepcopy(value)])
            for path, value in (update.get("$addToSet") or {}).items():
                current = _get(doc, path)
                target = current if isinstance(current, list) else []
                values = value["$each"] if isinstance(value, dict) and "$each" in value else [value]
                for item in values:
                    if item not in target:
                        target.append(deepcopy(item))
                _set(doc, path, target)
            return type("R", (), {"modified_count": 0 if doc == before else 1, "matched_count": 1})()
        return type("R", (), {"modified_count": 0, "matched_count": 0})()


class FakeDb:
    def __init__(self, *, orders=(), products=(), games=()):
        self.orders = FakeCollection(orders)
        self.products = FakeCollection(products)
        self.games = FakeCollection(games)
        # Index unique réel de `core/db.py` : (provider, provider_order_id, status).
        self.provider_webhook_events = FakeCollection(unique=(("provider", "provider_order_id",
                                                              "status"),))
        self.fzr_webhook_events = FakeCollection(unique=(("event_id",),))


# --------------------------------------------------------------------------- décor

def run(coro):
    return asyncio.run(coro)


def loose(world):
    """Client qui rend la réponse au lieu de relancer l'exception serveur (test des 5xx)."""
    return TestClient(world.app, raise_server_exceptions=False)


def signature(raw: bytes, timestamp: str) -> str:
    return hmac.new(SECRET.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()


def body(**data) -> bytes:
    payload = {"success": True, "event": "order.successful",
               "data": {"orderid": PARTNER_ID, "status": "successful", **data}}
    return json.dumps(payload).encode()


class World:
    def __init__(self, db):
        self.db = db
        self.audit = []

    @property
    def order(self):
        db = fzr_fulfillment.db
        return db.orders.documents[0] if db.orders.documents else None

    def actions(self):
        return [entry["action"] for entry in self.audit]

    def post(self, client, raw: bytes, *, timestamp=None, sig=None, secret_from=None):
        stamp = timestamp if timestamp is not None else str(int(time.time()))
        return client.post(PATH, content=raw, headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": stamp,
            "X-Webhook-Signature": sig if sig is not None else signature(raw, stamp),
        })


@pytest.fixture
def client(monkeypatch):
    """Client de test adossé à un faux db ; aucun réseau, aucune base réelle."""
    def build(orders=(), products=(PRODUCT,), games=(ALUU_GAME,)):
        db = FakeDb(orders=orders, products=products, games=games)
        world = World(db)

        async def fake_audit(action, actor, target=None, meta=None):
            world.audit.append({"action": action, "actor": actor, "target": target, "meta": meta})

        monkeypatch.setattr(core_db, "db", db)
        monkeypatch.setattr(fzr_fulfillment, "db", db)
        monkeypatch.setattr(fzr_fulfillment, "audit", fake_audit)
        monkeypatch.setattr(providers, "_INSTANCES", {})
        monkeypatch.setattr(providers, "_PROVIDER_CACHE", {})
        monkeypatch.setenv("ALUU_WEBHOOK_SECRET", SECRET)
        monkeypatch.setenv("ALUU_API_KEY", "aluu_dummy_key_for_tests")

        app = FastAPI()
        app.include_router(aluu_router.router, prefix="/api")
        world.app = app
        world.client = TestClient(app)
        return world

    return build


# --------------------------------------------------------------------------- 1. signature

def test_valid_signature_marks_the_unit_delivered(client):
    """Webhook signé `successful` : statut appliqué, commande livrée, trace d'audit."""
    w = client(orders=[order_doc()])

    response = w.post(w.client, body())

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert w.order["fazercards"]["provider_status"] == "successful"
    assert w.order["status"] == "delivered"
    entry = [e for e in w.audit if e["action"] == "fzr.webhook_status"][0]
    assert entry["actor"] == "aluu"
    assert entry["meta"]["provider_order_id"] == PARTNER_ID


def test_invalid_signature_is_rejected_and_changes_nothing(client):
    w = client(orders=[order_doc()])

    response = w.post(w.client, body(), sig="0" * 64)

    assert response.status_code == 401
    assert w.order["fazercards"]["provider_status"] == "pending"
    assert w.db.provider_webhook_events.documents == []
    assert w.audit == []


def test_stale_timestamp_is_rejected(client):
    """Fenêtre de 5 min (doc) : un horodatage plus ancien est refusé même bien signé."""
    w = client(orders=[order_doc()])
    stale = str(int(time.time()) - 301)

    response = w.post(w.client, body(), timestamp=stale)

    assert response.status_code == 401
    assert w.order["fazercards"]["provider_status"] == "pending"


def test_missing_webhook_secret_is_503_not_401(client, monkeypatch):
    """Secret absent (revue RV-001) : 503 « non configuré », jamais un 401 ni une 500."""
    w = client(orders=[order_doc()])
    monkeypatch.delenv("ALUU_WEBHOOK_SECRET", raising=False)

    response = w.post(w.client, body())

    assert response.status_code == 503
    assert w.order["fazercards"]["provider_status"] == "pending"
    assert w.db.provider_webhook_events.documents == []


# --------------------------------------------------------------------------- 2. dédup

def test_identical_delivery_is_deduplicated(client):
    """Rejeu du même triplet : acquitté, aucun second effet, une seule trace."""
    w = client(orders=[order_doc()])

    first = w.post(w.client, body())
    second = w.post(w.client, body())

    assert first.status_code == 200 and first.json() == {"ok": True}
    assert second.status_code == 200 and second.json() == {"ok": True, "duplicate": True}
    assert len([e for e in w.audit if e["action"] == "fzr.webhook_status"]) == 1
    assert len(w.db.provider_webhook_events.documents) == 1


def test_a_mongo_failure_on_the_dedup_insertion_is_not_a_duplicate(client):
    """Erreur Mongo ≠ doublon (revue RV-001) : réponse non 2xx pour qu'ALUU réessaie."""
    w = client(orders=[order_doc()])

    async def unavailable(_document):
        raise RuntimeError("mongo indisponible")

    w.db.provider_webhook_events.insert_one = unavailable

    response = w.post(loose(w), body())

    assert response.status_code >= 500          # jamais un `duplicate: true` menteur


def test_an_application_failure_does_not_consume_the_dedup(client):
    """La dédup n'est écrite qu'APRÈS l'application : un échec laisse le rejeu utile."""
    w = client(orders=[order_doc()])
    real_update = w.db.orders.update_one
    calls = {"n": 0}

    async def failing_once(selector, update):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("écriture impossible")
        return await real_update(selector, update)

    w.db.orders.update_one = failing_once

    failed = w.post(loose(w), body())

    assert failed.status_code >= 500
    assert w.db.provider_webhook_events.documents == []     # dédup non consommée
    assert w.order["fazercards"]["provider_status"] == "pending"

    replay = w.post(w.client, body())

    assert replay.status_code == 200 and replay.json() == {"ok": True}
    assert w.order["fazercards"]["provider_status"] == "successful"
    assert len(w.db.provider_webhook_events.documents) == 1


def test_two_concurrent_deliveries_apply_once_and_audit_once(client):
    """Course réelle : les deux livraisons passent le pré-contrôle, une seule applique sa trace."""
    w = client(orders=[order_doc()])

    async def always_absent(*_args, **_kwargs):
        return None

    w.db.provider_webhook_events.find_one = always_absent

    async def both():
        return await asyncio.gather(
            fzr_fulfillment.apply_provider_event(
                provider_name="aluu", provider_order_id=PARTNER_ID,
                status="successful", event="order.successful"),
            fzr_fulfillment.apply_provider_event(
                provider_name="aluu", provider_order_id=PARTNER_ID,
                status="successful", event="order.successful"))

    outcomes = run(both())

    assert sorted(bool(o.get("duplicate")) for o in outcomes) == [False, True]
    assert w.order["status"] == "delivered"                 # état final correct
    assert len([e for e in w.audit if e["action"] == "fzr.webhook_status"]) == 1
    assert len(w.db.provider_webhook_events.documents) == 1


# --------------------------------------------------------------------------- 3. statuts

def test_error_status_is_a_final_failure(client):
    w = client(orders=[order_doc()])

    response = w.post(w.client, body(status="error", event="order.failed"))

    assert response.status_code == 200
    assert w.order["fazercards"]["provider_status"] == "error"
    assert w.order["status"] == "paid"           # jamais livré
    assert "fzr.provider_failed" in w.actions()


def test_cancelled_status_is_a_final_failure(client):
    w = client(orders=[order_doc()])

    response = w.post(w.client, body(status="cancelled"))

    assert response.status_code == 200
    assert w.order["fazercards"]["provider_status"] == "cancelled"
    assert w.order["status"] == "paid"
    assert "fzr.provider_failed" in w.actions()


def test_a_final_status_is_never_overwritten(client):
    """Monotonie : après `successful`, un `cancelled` tardif ne « dé-livre » pas l'unité."""
    w = client(orders=[order_doc()])
    w.post(w.client, body())

    late = w.post(w.client, body(status="cancelled"))

    assert late.status_code == 200
    assert late.json() == {"ok": True, "ignored": True}
    assert w.order["fazercards"]["provider_status"] == "successful"
    assert w.order["status"] == "delivered"
    stale = [e for e in w.audit if e["action"] == "fzr.webhook_stale"][0]
    assert stale["meta"]["kept_status"] == "successful"
    assert stale["meta"]["ignored_status"] == "cancelled"


# --------------------------------------------------------------------------- 4. commande inconnue

def test_unknown_order_is_acknowledged_without_retry(client, caplog):
    """Commande inconnue (revue RV-001) : 2xx, aucune dédup écrite, warning masqué."""
    w = client(orders=[])
    caplog.set_level(logging.WARNING, logger="mgs.fzr")

    response = w.post(w.client, body())

    assert response.status_code == 200
    assert response.json() == {"ok": True, "ignored": True}
    assert w.db.provider_webhook_events.documents == []      # le rejeu reste possible
    assert PARTNER_ID not in caplog.text                     # jamais l'identifiant complet
    assert "MGS-…" in caplog.text


def test_unknown_provider_order_id_on_a_known_order_is_ignored(client):
    w = client(orders=[order_doc()])

    response = w.post(w.client, body(orderid="inconnu"))

    assert response.json() == {"ok": True, "ignored": True}
    assert w.order["fazercards"]["provider_status"] == "pending"


# --------------------------------------------------------------------------- 5. octets bruts

def test_signature_covers_the_raw_bytes_received(client):
    """Deux corps qui DÉSÉRIALISENT à l'identique mais diffèrent par leurs octets.

    La signature du corps compact est refusée pour le corps espacé : la route signe bien les
    octets reçus, pas une re-sérialisation du JSON.
    """
    w = client(orders=[order_doc()])
    spaces = json.dumps({"success": True, "event": "order.successful",
                         "data": {"orderid": PARTNER_ID, "status": "successful"}}).encode()
    compact = json.dumps({"success": True, "event": "order.successful",
                          "data": {"orderid": PARTNER_ID, "status": "successful"}},
                         separators=(",", ":")).encode()
    assert json.loads(spaces) == json.loads(compact) and spaces != compact

    stamp = str(int(time.time()))
    rejected = w.post(w.client, spaces, timestamp=stamp, sig=signature(compact, stamp))
    assert rejected.status_code == 401
    assert w.order["fazercards"]["provider_status"] == "pending"

    accepted = w.post(w.client, spaces, timestamp=stamp, sig=signature(spaces, stamp))
    assert accepted.status_code == 200
    assert w.order["fazercards"]["provider_status"] == "successful"


# --------------------------------------------------------------------------- 6. barrière fournisseur

def test_aluu_webhook_never_updates_a_fazercards_unit(client):
    """Même identifiant, unité FazerCards : la barrière `provider == "aluu"` la protège."""
    fc_order = order_doc(provider="fazercards", status="submitted",
                         provider_order_id=PARTNER_ID, aluu_order_id=None,
                         provider_status="processing")
    fc_order["provider_order_ids"] = [PARTNER_ID]
    w = client(orders=[fc_order])

    response = w.post(w.client, body())

    assert response.status_code == 200
    assert response.json() == {"ok": True, "ignored": True}
    assert w.order["fazercards"]["provider_status"] == "processing"
    assert "fzr.webhook_status" not in w.actions()
