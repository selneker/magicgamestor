"""PL-STOCK-1 — disponibilité fournisseur : règle d'achat, marquage, retour automatique, garde 409.

Aucune base Mongo, aucun appel réseau : les collections sont de petits fakes en mémoire et les
alertes/l'audit sont des `AsyncMock`. Le fournisseur n'est jamais joint (le module testé ne fait
aucun I/O réseau) ; `pytest-asyncio` n'est pas une dépendance du dépôt, donc chaque test asynchrone
passe par `_run`, comme les autres suites.
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import notifications, stock  # noqa: E402
from services.providers.errors import (ProviderInsufficientBalanceError,  # noqa: E402
                                       ProviderOrderError, ProviderTimeout)

DAY = timedelta(days=1)
# Horodatage « frais » fixé au chargement du module : indépendant de l'heure d'exécution.
FRESH = datetime.now(timezone.utc).isoformat()


def _run(coro):
    """Exécute une coroutine dans une boucle dédiée (aucune boucle globale partagée)."""
    return asyncio.new_event_loop().run_until_complete(coro)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


# --------------------------------------------------------------------------- #
# Fakes Mongo (produits)
# --------------------------------------------------------------------------- #
def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, part) for part in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict):
            for op, operand in expected.items():
                if op == "$ne" and value == operand:
                    return False
                if op == "$in" and value not in operand:
                    return False
                if op == "$lt" and not (value is not None and value < operand):
                    return False
                if op == "$gte" and not (value is not None and value >= operand):
                    return False
                if op == "$exists" and (key in doc) != bool(operand):
                    return False
        elif value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self._docs = [dict(d) for d in docs]

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeProducts:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def _filtered(self, query):
        return [d for d in self.docs if _matches(d, query)]

    async def find_one(self, query, projection=None):
        found = self._filtered(query)
        return dict(found[0]) if found else None

    def find(self, query, projection=None):
        return _Cursor(self._filtered(query))

    async def update_one(self, query, update):
        found = self._filtered(query)
        if not found:
            return SimpleNamespace(modified_count=0)
        found[0].update(update.get("$set") or {})
        return SimpleNamespace(modified_count=1)


@pytest.fixture
def products_db():
    return FakeProducts()


@pytest.fixture
def patched_stock(products_db):
    """Branche `stock.db` sur le fake et remplace alertes + audit par des espions."""
    unavailable = AsyncMock(return_value=None)
    restored = AsyncMock(return_value=None)
    audit = AsyncMock(return_value=None)
    with patch.object(stock, "db", SimpleNamespace(products=products_db)), \
         patch.object(notifications, "notify_stock_unavailable", unavailable), \
         patch.object(notifications, "notify_stock_restored", restored), \
         patch.object(stock, "audit", audit):
        yield SimpleNamespace(products=products_db, unavailable=unavailable,
                              restored=restored, audit=audit)


# --------------------------------------------------------------------------- #
# E — règle unique `purchasable`
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("product,expected", [
    ({}, True),
    ({"supplier_available": None}, True),
    ({"supplier_available": True}, True),
    ({"supplier_available": False}, True),  # état non daté : inexploitable, donc inconnu
    ({"supplier_available": False, "supplier_checked_at": FRESH}, False),
    ({"supplier_available": False, "supplier_checked_at": FRESH, "manual_unavailable": False}, False),
    ({"manual_unavailable": True}, False),
    ({"manual_unavailable": True, "supplier_available": True}, False),
    ({"requires_mapping": True}, False),  # mapping manquant : garde historique conservée
    ({"requires_mapping": True, "fazercards_mapping": {"category_id": "c", "offer_id": "o"}}, True),
])
def test_purchasable_combinations(product, expected):
    assert stock.purchasable(product) is expected


def test_unavailable_reason_priority_and_mapping():
    assert stock.unavailable_reason({}) is None
    assert stock.unavailable_reason(
        {"supplier_available": False, "supplier_checked_at": FRESH}) == "supplier_out_of_stock"
    assert stock.unavailable_reason({"manual_unavailable": True}) == "admin"
    # Les deux motifs : le forçage admin est prioritaire.
    assert stock.unavailable_reason(
        {"manual_unavailable": True, "supplier_available": False,
         "supplier_checked_at": FRESH}) == "admin"
    # Un mapping manquant n'entre pas dans cet enum (il garde son message existant).
    assert stock.unavailable_reason({"requires_mapping": True}) is None


def test_supplier_state_expires_after_stale_minutes(monkeypatch):
    monkeypatch.delenv("STOCK_STALE_MINUTES", raising=False)
    now = _now()
    fresh = {"supplier_available": False, "supplier_checked_at": _iso(now - timedelta(minutes=59))}
    stale = {"supplier_available": False, "supplier_checked_at": _iso(now - timedelta(minutes=61))}
    undated = {"supplier_available": False}
    assert stock.supplier_state(fresh, now) is False
    assert stock.supplier_state(stale, now) is None
    assert stock.supplier_state(undated, now) is None
    assert stock.purchasable(stale, now) is True
    assert stock.unavailable_reason(stale, now) is None


def test_stale_minutes_bounds_and_default(monkeypatch):
    monkeypatch.delenv("STOCK_STALE_MINUTES", raising=False)
    assert stock.stale_minutes() == 60
    monkeypatch.setenv("STOCK_STALE_MINUTES", "0")
    assert stock.stale_minutes() == 1
    monkeypatch.setenv("STOCK_STALE_MINUTES", "999999")
    assert stock.stale_minutes() == stock.MAX_STALE_MINUTES
    monkeypatch.setenv("STOCK_STALE_MINUTES", "n'importe quoi")
    assert stock.stale_minutes() == 60


def test_sync_enabled_default_and_off(monkeypatch):
    monkeypatch.delenv("STOCK_SYNC_ENABLED", raising=False)
    assert stock.sync_enabled() is True
    for value in ("1", "true", "YES", "on"):
        monkeypatch.setenv("STOCK_SYNC_ENABLED", value)
        assert stock.sync_enabled() is True
    for value in ("0", "false", "no", "off"):
        monkeypatch.setenv("STOCK_SYNC_ENABLED", value)
        assert stock.sync_enabled() is False


# --------------------------------------------------------------------------- #
# C — classification conservatrice et marquage immédiat
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("exc,expected", [
    (ProviderOrderError(409, "Out of stock", "out_of_stock"), True),
    (ProviderOrderError(409, "Produit indisponible : rupture de stock"), True),
    (ProviderOrderError(409, "No stock for this offer"), True),
    (ProviderOrderError(409, "SOLD_OUT", "sold_out"), True),
    (ProviderInsufficientBalanceError(402, "Insufficient balance", "insufficient_balance"), False),
    (ProviderOrderError(500, "Erreur fournisseur inattendue."), False),
    (ProviderOrderError(502, "Fournisseur injoignable."), False),
    (ProviderOrderError(409, "Service momentanément indisponible."), False),
    (ProviderTimeout(), False),
])
def test_is_out_of_stock_error(exc, expected):
    assert stock.is_out_of_stock_error(exc) is expected


def test_mark_unavailable_is_immediate_and_notified_once(patched_stock, monkeypatch):
    monkeypatch.delenv("STOCK_SYNC_ENABLED", raising=False)
    patched_stock.products.docs = [{"id": "p1", "name": "60 UC"}]
    assert _run(stock.mark_supplier_unavailable({"id": "p1", "name": "60 UC"}, actor="auto")) is True
    doc = patched_stock.products.docs[0]
    assert doc["supplier_available"] is False
    assert doc["supplier_checked_at"]
    assert stock.purchasable(doc) is False
    patched_stock.unavailable.assert_awaited_once_with("60 UC", "p1")
    assert patched_stock.audit.await_args.args[0] == "product.supplier_unavailable"

    # Deuxième unité / deuxième commande : aucune nouvelle écriture, aucune alerte.
    assert _run(stock.mark_supplier_unavailable({"id": "p1", "name": "60 UC"}, actor="auto")) is False
    patched_stock.unavailable.assert_awaited_once()


def test_mark_disabled_by_setting(patched_stock, monkeypatch):
    monkeypatch.setenv("STOCK_SYNC_ENABLED", "false")
    patched_stock.products.docs = [{"id": "p1", "name": "60 UC"}]
    assert _run(stock.mark_supplier_unavailable({"id": "p1", "name": "60 UC"})) is False
    assert "supplier_available" not in patched_stock.products.docs[0]
    patched_stock.unavailable.assert_not_awaited()


def test_mark_without_product_id_is_a_noop(patched_stock):
    assert _run(stock.mark_supplier_unavailable({"name": "orphan"})) is False
    patched_stock.unavailable.assert_not_awaited()


def test_mark_never_raises_on_db_failure():
    class Broken:
        async def update_one(self, *args, **kwargs):
            raise RuntimeError("mongo down")

    with patch.object(stock, "db", SimpleNamespace(products=Broken())):
        assert _run(stock.mark_supplier_unavailable({"id": "p1", "name": "x"})) is False


# --------------------------------------------------------------------------- #
# D — forçage admin
# --------------------------------------------------------------------------- #
def test_manual_unavailable_set_and_clear_keep_supplier_state(patched_stock):
    patched_stock.products.docs = [{"id": "p1", "name": "60 UC", "supplier_available": True,
                                    "supplier_checked_at": _iso(_now())}]
    doc = _run(stock.set_manual_unavailable("p1", True, actor="adm1"))
    assert doc["manual_unavailable"] is True
    assert doc["supplier_available"] is True  # jamais touché par le forçage
    assert stock.purchasable(doc) is False
    assert stock.unavailable_reason(doc) == "admin"

    doc = _run(stock.set_manual_unavailable("p1", False, actor="adm1"))
    assert doc["manual_unavailable"] is False
    assert doc["supplier_available"] is True
    assert stock.purchasable(doc) is True
    actions = [call.args[0] for call in patched_stock.audit.await_args_list]
    assert actions == ["product.availability_set", "product.availability_set"]


def test_manual_unavailable_unknown_product(patched_stock):
    assert _run(stock.set_manual_unavailable("nope", True, actor="adm1")) is None


def test_manual_flag_does_not_expire(monkeypatch):
    monkeypatch.delenv("STOCK_STALE_MINUTES", raising=False)
    old = {"manual_unavailable": True, "supplier_available": False,
           "supplier_checked_at": _iso(_now() - 3 * DAY)}
    assert stock.supplier_state(old) is None  # l'état fournisseur est périmé…
    assert stock.purchasable(old) is False    # …mais le forçage admin reste actif


# --------------------------------------------------------------------------- #
# B/H — expiration des états périmés et retour automatique
# --------------------------------------------------------------------------- #
def test_expire_restores_only_stale_and_notifies_once(patched_stock, monkeypatch):
    monkeypatch.delenv("STOCK_STALE_MINUTES", raising=False)
    now = _now()
    patched_stock.products.docs = [
        {"id": "old-out", "name": "Vieux", "supplier_available": False,
         "supplier_checked_at": _iso(now - timedelta(minutes=90))},
        {"id": "fresh-out", "name": "Frais", "supplier_available": False,
         "supplier_checked_at": _iso(now - timedelta(minutes=5))},
        {"id": "old-in", "name": "Dispo", "supplier_available": True,
         "supplier_checked_at": _iso(now - timedelta(minutes=90))},
    ]
    result = _run(stock.expire_stale_states(now))
    assert result == {"stock_expired": 2, "stock_restored": 1}
    docs = {d["id"]: d for d in patched_stock.products.docs}
    assert docs["old-out"]["supplier_available"] is None
    assert stock.purchasable(docs["old-out"]) is True
    assert docs["fresh-out"]["supplier_available"] is False  # pas encore périmé
    assert docs["old-in"]["supplier_available"] is None      # disponible → inconnu, sans alerte
    patched_stock.restored.assert_awaited_once_with("Vieux", "old-out")

    # Idempotence : une seconde passe ne rebascule rien et n'alerte plus.
    patched_stock.restored.reset_mock()
    assert _run(stock.expire_stale_states(now)) == {"stock_expired": 0, "stock_restored": 0}
    patched_stock.restored.assert_not_awaited()


def test_expire_skips_notification_when_admin_forced(patched_stock):
    now = _now()
    patched_stock.products.docs = [
        {"id": "forced", "name": "Forcé", "supplier_available": False, "manual_unavailable": True,
         "supplier_checked_at": _iso(now - timedelta(minutes=90))},
    ]
    assert _run(stock.expire_stale_states(now)) == {"stock_expired": 1, "stock_restored": 0}
    patched_stock.restored.assert_not_awaited()
    assert patched_stock.products.docs[0]["supplier_available"] is None


def test_stale_outage_does_not_flip_whole_catalog(monkeypatch):
    """B : aucune panne ne marque le catalogue ; seul un constat explicite écrit `False`."""
    monkeypatch.delenv("STOCK_STALE_MINUTES", raising=False)
    catalog = [{"id": f"p{i}", "supplier_available": None} for i in range(5)]
    assert all(stock.purchasable(p) for p in catalog)


def test_run_all_branches_stock_expiry(monkeypatch):
    from services import order_maintenance

    calls = {}

    def fake(name, result):
        async def func(now=None):
            calls[name] = True
            return result
        return func

    for attr in ("warn_expiring_orders", "expire_due_orders", "purge_expired_orders",
                 "purge_order_proofs"):
        monkeypatch.setattr(order_maintenance, attr, fake(attr, {}))
    monkeypatch.setattr(order_maintenance.proofs, "check_storage_warnings", fake("storage", {}))
    monkeypatch.setattr(order_maintenance.stock, "expire_stale_states",
                        fake("stock", {"stock_expired": 1, "stock_restored": 1}))
    result = _run(order_maintenance.run_all(_now()))
    assert calls.get("stock") is True
    assert result["stock_expired"] == 1 and result["stock_restored"] == 1


# --------------------------------------------------------------------------- #
# G — exposition : public vs admin
# --------------------------------------------------------------------------- #
def test_public_view_hides_supplier_fields_and_admin_view_exposes_them():
    from routers.products import _public

    product = {"id": "p1", "slug": "p1", "name": "60 UC", "price": 1000, "type": "uc",
               "active": True, "supplier_available": False, "supplier_checked_at": FRESH,
               "manual_unavailable": False,
               "fazercards_mapping": {"category_id": "c", "offer_id": "o"}}
    public = _public(product)
    assert public["purchasable"] is False
    assert public["unavailable_reason"] == "supplier_out_of_stock"
    for field in ("supplier_available", "supplier_checked_at", "manual_unavailable",
                  "fazercards_mapping"):
        assert field not in public

    admin = _public(product, admin=True)
    assert admin["supplier_available"] is False
    assert admin["supplier_checked_at"] == FRESH
    assert admin["manual_unavailable"] is False
    assert admin["purchasable"] is False


def test_public_payload_never_names_the_supplier():
    from routers.products import _public

    text = repr(_public({"id": "p1", "slug": "p1", "name": "60 UC", "price": 1, "type": "uc",
                         "supplier_available": False,
                         "supplier_checked_at": _iso(_now())})).lower()
    for forbidden in ("fazercards", "fzr", "supplier_available"):
        assert forbidden not in text


# --------------------------------------------------------------------------- #
# F — garde 409 à la création de commande, sans aucune écriture
# --------------------------------------------------------------------------- #
class _OrdersStore:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class _OrderProducts:
    def __init__(self, product):
        self.product = product

    def find(self, query, projection=None):
        return _OrderCursor([self.product])


class _OrderCursor:
    def __init__(self, docs):
        self._docs = [dict(d) for d in docs]

    async def to_list(self, limit=None):
        return self._docs


class _Games:
    async def find_one(self, query, projection=None):
        return {"id": "pubg-mobile"}


class _OrderDB:
    def __init__(self, product):
        self.products = _OrderProducts(product)
        self.orders = _OrdersStore()
        self.games = _Games()


def _request():
    from starlette.requests import Request
    return Request({"type": "http", "method": "POST", "path": "/api/orders", "headers": [],
                    "client": ("127.0.0.1", 1234)})


def _create_order(orders_router, product):
    from services import captcha, fees

    fake_db = _OrderDB(product)
    body = orders_router.OrderIn(pubg_id="51234567890", pseudo="Testeur",
                                 items=[orders_router.OrderItemIn(product_id="p1", quantity=1)],
                                 payment_method="manual", manual_reference="REF-1")

    async def identity(*args, **kwargs):
        return {"source": "checkout", "game_id": "pubg-mobile",
                "fields": {"player_id": "51234567890"}, "player_name": "Testeur",
                "validated": False, "captured_at": "2026-01-01T00:00:00Z"}

    async def ready(*args, **kwargs):
        return True, ""

    async def no_captcha(*args, **kwargs):
        return None

    with patch.object(orders_router, "db", fake_db), \
         patch.object(captcha, "require", no_captcha), \
         patch.object(orders_router, "game_sale_path_ready", ready), \
         patch.object(orders_router, "_identity_snapshot", identity), \
         patch.object(orders_router.ratelimit, "client_ip", lambda request: "127.0.0.1"), \
         patch.object(orders_router.ratelimit, "check", lambda *a, **k: None), \
         patch.object(orders_router.ratelimit, "setting", lambda *a, **k: 100), \
         patch.object(fees, "calculate_payment_fee", AsyncMock(return_value=0)):
        response = _run(orders_router.create_order(body, orders_router.BackgroundTasks(),
                                                   _request(), user=None))
    raw = getattr(response, "body", None)
    return fake_db, (json.loads(raw) if raw else response)


def _product(**extra):
    return {"id": "p1", "slug": "p1", "name": "60 UC", "type": "uc", "price": 1000,
            "active": True, "game_id": "pubg-mobile", "requires_mapping": False, **extra}


def test_create_order_refuses_unavailable_product():
    from routers import orders as orders_router

    fake_db, payload = _create_order(
        orders_router, _product(supplier_available=False, supplier_checked_at=_iso(_now())))
    assert payload["code"] == "product_unavailable"
    assert payload["product_ids"] == ["p1"]
    assert isinstance(payload["detail"], str) and payload["detail"]
    assert fake_db.orders.docs == []  # aucune commande créée


def test_create_order_refuses_manually_disabled_product():
    from routers import orders as orders_router

    fake_db, payload = _create_order(orders_router, _product(manual_unavailable=True))
    assert set(payload) == {"detail", "code", "product_ids"}
    assert payload["code"] == "product_unavailable"
    assert fake_db.orders.docs == []


def test_create_order_still_works_when_available():
    from routers import orders as orders_router

    fake_db, order = _create_order(
        orders_router, _product(supplier_available=True, supplier_checked_at=_iso(_now())))
    assert order["items"][0]["product_id"] == "p1"
    assert len(fake_db.orders.docs) == 1  # commande normale inchangée


# --------------------------------------------------------------------------- #
# H — alertes branchées sur les bons canaux
# --------------------------------------------------------------------------- #
def test_stock_events_registered_for_retry_and_telegram():
    assert "stock_unavailable" in notifications.RETRY_ALERTS
    assert "stock_restored" in notifications.RETRY_ALERTS
    assert "stock_unavailable" in notifications.telegram.DEFAULT_EVENTS
    assert "stock_restored" in notifications.telegram.DEFAULT_EVENTS


# --------------------------------------------------------------------------- #
# A — route interne : le balayage de stock passe par le jeton cron existant
# --------------------------------------------------------------------------- #
def test_internal_stock_sweep_requires_the_cron_token(monkeypatch):
    from fastapi import HTTPException
    from starlette.requests import Request

    from core.cron import require_cron_token

    def request(headers):
        raw = [(name.lower().encode(), value.encode()) for name, value in headers.items()]
        return Request({"type": "http", "method": "POST", "path": "/api/internal/orders/run",
                        "headers": raw, "client": ("127.0.0.1", 1)})

    monkeypatch.setenv("CRON_TOKEN", "secret-stock")
    require_cron_token(request({"X-Cron-Token": "secret-stock"}))  # accepté
    with pytest.raises(HTTPException) as wrong:
        require_cron_token(request({"X-Cron-Token": "nope"}))
    assert wrong.value.status_code == 401
    monkeypatch.delenv("CRON_TOKEN", raising=False)
    with pytest.raises(HTTPException) as disabled:
        require_cron_token(request({}))
    assert disabled.value.status_code == 503
