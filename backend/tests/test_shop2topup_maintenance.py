"""PL-006-T08C-V1 — réconciliation Shop2Topup dans la maintenance et application des statuts.

Aucune base réelle, aucun réseau : la collection `orders` et la collection de dédoublonnage sont
des doubles en mémoire, et l'adaptateur est remplacé par un double quand il interrogerait le
fournisseur. Les fonctions réutilisées de `fzr_fulfillment` (signal de remboursement et bascule
`paid → delivered`) sont remplacées par des espions : on vérifie qu'elles sont APPELÉES, pas leur
implémentation, qui a déjà ses propres tests.
"""
import asyncio
from types import SimpleNamespace

import pytest

from services import fzr_fulfillment, order_maintenance
from services.providers import shop2topup_adapter
from services.providers.base import OrderStatus, ProviderOrder


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs
        self.limit_value = None

    def limit(self, value):
        self.limit_value = value
        return self

    async def to_list(self, value):
        return list(self.docs)


class FakeOrders:
    def __init__(self, docs):
        self.docs = docs
        self.updates = []
        self.find_one_filter = None

    def find(self, query, projection):
        self.find_query = query
        return FakeCursor(self.docs)

    async def find_one(self, query, projection):
        self.find_one_filter = query
        return self.docs[0] if self.docs else None

    async def update_one(self, query, update):
        self.updates.append((query, update))
        return SimpleNamespace(modified_count=1)


class FakeEvents:
    def __init__(self):
        self.docs = []
        self.fail = False

    async def insert_one(self, doc):
        if self.fail:
            raise RuntimeError("duplicate")
        self.docs.append(doc)
        return SimpleNamespace(inserted_id=doc.get("event_id"))


class FakeProvider:
    name = "shop2topup"

    def __init__(self, report=None, error=None):
        self.report = report or {"requested": 0, "checked": {}, "not_found": [],
                                 "starved": [], "batches": 0}
        self.error = error
        self.units = None
        self.called = False

    async def reconcile(self, units, **kwargs):
        self.called = True
        self.units = list(units)
        if self.error:
            raise self.error
        return self.report

    def normalize_status(self, raw_status):
        return shop2topup_adapter.normalize_status(raw_status)


@pytest.fixture(autouse=True)
def spies(monkeypatch):
    """Les fonctions existantes de `fzr_fulfillment` sont observées, jamais exécutées."""
    calls = {"sync": [], "refund": []}

    async def sync(order_id, actor):
        calls["sync"].append((order_id, actor))

    async def refund(order, line_index, record, raw, source, actor):
        calls["refund"].append((line_index, source, actor))

    monkeypatch.setattr(fzr_fulfillment, "_sync_mgs_status", sync)
    monkeypatch.setattr(fzr_fulfillment, "_signal_refund", refund)
    return calls


def order_with_units():
    return {
        "id": "order-1", "game_id": "pubg-mobile", "status": "paid",
        "fazercards": {"provider": "shop2topup", "provider_order_id": "s2t-1",
                       "status": "submitted", "created_at": "2026-11-19T10:00:00+00:00",
                       "line_index": 0, "offer_id": "13"},
        "fazercards_lines": {
            "1": {"provider": "fazercards", "provider_order_id": "fz-2",
                  "status": "submitted", "created_at": "2026-11-19T11:00:00+00:00"},
        },
    }


# --------------------------------------------------------------------------- #
# Lecture des unités
# --------------------------------------------------------------------------- #
def test_stored_units_couvre_les_quatre_formes():
    order = {
        "fazercards": {"provider_order_id": "a"},
        "fazercards_lines": {"1": {"provider_order_id": "b"}},
        "fazercards_components": {"2": {"0": {"provider_order_id": "c"},
                                        "1": {"provider_order_id": "d"}}},
        "fazercards_reps": {"3": {
            "1": {"provider": "shop2topup", "provider_order_id": "e"},
            "2": {"0": {"provider_order_id": "f"},
                  "1": {"provider_order_id": "g"}},
        }},
    }

    units = order_maintenance.stored_units(order)

    assert [unit["path"] for unit in units] == [
        "fazercards",
        "fazercards_lines.1",
        "fazercards_components.2.0",
        "fazercards_components.2.1",
        "fazercards_reps.3.1",
        "fazercards_reps.3.2.0",
        "fazercards_reps.3.2.1",
    ]
    assert units[4]["quantity_index"] == 1 and units[4]["component_index"] is None
    assert units[5]["quantity_index"] == 2 and units[5]["component_index"] == 0


def test_shop2topup_units_ignore_les_unites_legacy_et_fazercards():
    order = order_with_units()
    order["fazercards_lines"]["2"] = {"provider": "shop2topup", "provider_order_id": None}

    units = order_maintenance.shop2topup_units(order)

    assert [unit["path"] for unit in units] == ["fazercards"]


# --------------------------------------------------------------------------- #
# Réconciliation
# --------------------------------------------------------------------------- #
def test_sans_unite_shop2topup_aucun_appel_et_aucun_effet(monkeypatch, spies):
    orders = FakeOrders([{"id": "legacy", "status": "paid",
                          "fazercards": {"provider": "fazercards", "provider_order_id": "fz-1"}}])
    monkeypatch.setattr(order_maintenance, "db", SimpleNamespace(orders=orders))
    provider = FakeProvider()

    result = run(order_maintenance.reconcile_shop2topup_units(provider=provider))

    assert provider.called is False
    assert result["shop2topup_units"] == 0 and result["updated"] == 0
    assert orders.updates == [] and spies["sync"] == []


def test_seules_les_unites_shop2topup_sont_interrogees_et_mises_a_jour(monkeypatch, spies):
    order = order_with_units()
    orders = FakeOrders([order])
    monkeypatch.setattr(order_maintenance, "db", SimpleNamespace(orders=orders))
    provider = FakeProvider(report={
        "requested": 1,
        "checked": {"s2t-1": ProviderOrder(id="s2t-1", status="completed",
                                           normalized_status=OrderStatus.COMPLETED)},
        "not_found": [], "starved": [], "batches": 1,
    })

    result = run(order_maintenance.reconcile_shop2topup_units(provider=provider))

    assert [unit["provider_order_id"] for unit in provider.units] == ["s2t-1"]
    assert result == {"shop2topup_units": 1, "batches": 1, "updated": 1,
                      "not_found": 0, "starved": 0}
    assert orders.updates[0][1]["$set"]["fazercards.provider_status"] == "completed"
    assert spies["sync"] == [("order-1", "maintenance:shop2topup")]
    assert spies["refund"] == []


def test_statut_refund_declenche_le_chemin_de_remboursement_existant(monkeypatch, spies):
    order = order_with_units()
    orders = FakeOrders([order])
    monkeypatch.setattr(order_maintenance, "db", SimpleNamespace(orders=orders))
    provider = FakeProvider(report={
        "requested": 1,
        "checked": {"s2t-1": ProviderOrder(id="s2t-1", status="refunded",
                                           normalized_status=OrderStatus.REFUND, raw={"x": 1})},
        "not_found": [], "starved": [], "batches": 1,
    })

    run(order_maintenance.reconcile_shop2topup_units(provider=provider))

    assert spies["refund"] == [(0, "reconcile", "maintenance:shop2topup")]
    assert spies["sync"] == [("order-1", "maintenance:shop2topup")]


def test_une_erreur_fournisseur_est_journalisee_jamais_propagee(monkeypatch, spies):
    orders = FakeOrders([order_with_units()])
    monkeypatch.setattr(order_maintenance, "db", SimpleNamespace(orders=orders))
    provider = FakeProvider(error=RuntimeError("fournisseur indisponible"))

    result = run(order_maintenance.reconcile_shop2topup_units(provider=provider))

    assert result == {"shop2topup_units": 1, "batches": 0, "updated": 0,
                      "not_found": 0, "starved": 0}
    assert orders.updates == [] and spies["sync"] == []


# --------------------------------------------------------------------------- #
# Webhook : même chemin d'écriture, dédoublonné
# --------------------------------------------------------------------------- #
def _webhook_db(monkeypatch):
    orders = FakeOrders([order_with_units()])
    events = FakeEvents()
    monkeypatch.setattr(order_maintenance, "db",
                        SimpleNamespace(orders=orders, fzr_webhook_events=events))
    return orders, events


def test_evenement_webhook_applique_le_statut_par_le_meme_chemin(monkeypatch, spies):
    orders, events = _webhook_db(monkeypatch)

    result = run(order_maintenance.apply_shop2topup_event({
        "event": "order.status_changed",
        "data": {"order_id": "s2t-1", "status": "completed"},
    }))

    assert result == {"ok": True}
    assert events.docs[0]["event_id"] == "shop2topup:s2t-1:order.status_changed:completed"
    assert events.docs[0]["provider"] == "shop2topup"
    assert orders.updates[0][1]["$set"]["fazercards.provider_status"] == "completed"
    assert spies["sync"] == [("order-1", "webhook:shop2topup")]


def test_evenement_webhook_dedoublonne_sans_seconde_ecriture(monkeypatch, spies):
    orders, events = _webhook_db(monkeypatch)
    payload = {"event_id": "evt-1", "event": "order.status_changed",
               "data": {"order_id": "s2t-1", "status": "completed"}}

    first = run(order_maintenance.apply_shop2topup_event(payload))
    events.fail = True
    second = run(order_maintenance.apply_shop2topup_event(payload))

    assert first == {"ok": True}
    assert second == {"ok": True, "duplicate": True}
    assert len(orders.updates) == 1


def test_evenement_sans_commande_est_ignore_sans_lever(monkeypatch, spies):
    orders, events = _webhook_db(monkeypatch)
    orders.docs = []

    result = run(order_maintenance.apply_shop2topup_event({
        "event": "order.status_changed",
        "data": {"order_id": "inconnue", "status": "completed"},
    }))

    assert result == {"ok": True, "ignored": True}
    assert orders.updates == []


def test_evenement_sans_statut_ne_touche_aucune_unite(monkeypatch, spies):
    orders, events = _webhook_db(monkeypatch)

    result = run(order_maintenance.apply_shop2topup_event({
        "event": "webhook.test", "data": {"order_id": "s2t-1"},
    }))

    assert result == {"ok": True}
    assert orders.updates == [] and spies["sync"] == []
