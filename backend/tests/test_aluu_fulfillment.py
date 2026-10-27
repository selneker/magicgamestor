"""Lot 4 — fulfillment fournisseur par unité : ALUU de bout en bout, faux db en mémoire.

Tests PURS : aucune Mongo, aucun réseau. `core.db.db` est remplacé par un double en mémoire, et
les quatre appels HTTP de `services.aluu` (`name_check`, `products`, `create_order`, `get_order`)
sont remplacés. Tout le RESTE de la chaîne est RÉEL : `providers.provider_for_game`, `AluuProvider`,
`fzr_mapping.offers_for_game`, `fzr_fulfillment`.

But explicite : prouver qu'aucune commande ALUU ne peut être vendue si `provider_for_game`,
le préflight et la création de commande ne résolvent pas le MÊME fournisseur — et qu'une unité
créée garde son fournisseur même si le jeu est basculé ensuite.
"""
import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core import db as core_db
from services import aluu, fzr_fulfillment, fzr_mapping, providers
from services.providers import errors as perr
from services.providers.base import IdentityValidation, ProviderOrder
from services.providers.fazercards_adapter import FazerCardsProvider

GAME_ID = "free-fire"
PLAYER_ID = "51234567890"
ZONE_ID = "1234"
SECOND_GAME_ID = "free-fire-zone"

ALUU_GAME = {
    "id": GAME_ID, "provider": "aluu", "aluu_game_code": "ff",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
}
# Jeu ALUU dont l'identité porte aussi le serveur (paramètre `/create` = `serverid`).
ALUU_ZONE_GAME = {
    "id": SECOND_GAME_ID, "provider": "aluu", "aluu_game_code": "ffz",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId", "zone_id": "server_code"},
}
# Document sans `provider` = jeu historique FazerCards.
FAZER_GAME = {"id": GAME_ID}

ALUU_MAPPING = {"game_code": "ff", "denom": "60", "confirmed": True}
ALUU_MAPPING_120 = {"game_code": "ff", "denom": "120", "confirmed": True}
FC_MAPPING = {"mode": "direct", "category_id": "free_fire", "offer_id": "60", "confirmed": True}

PACKS = [{"denom": "60", "name": "60 Diamonds", "price_usd": 0.83,
          "requires_server_id": False, "requires_char_name": False},
         {"denom": "120", "name": "120 Diamonds", "price_usd": 1.60,
          "requires_server_id": False, "requires_char_name": False}]

# Packs qui exigent `serverid` : le préflight doit refuser une identité qui ne le porte pas.
PACKS_WITH_SERVER = [{"denom": "60", "name": "60 Diamonds", "price_usd": 0.83,
                      "requires_server_id": True, "requires_char_name": False}]


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- faux Mongo

class FakeDuplicate(Exception):
    """Violation d'index unique (dédup webhook)."""


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
        child = node.get(part)
        if not isinstance(child, dict):
            child = {}
            node[part] = child
        node = child
    node[parts[-1]] = value


def _matches(doc, query) -> bool:
    """Sous-ensemble de la sémantique Mongo réellement utilisée par le fulfillment."""
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
            if "$in" in expected:
                if value is _MISSING or value not in expected["$in"]:
                    return False
                continue
            raise AssertionError(f"opérateur de requête non géré : {expected}")
        if expected is None:  # Mongo : `{champ: None}` matche aussi l'absence du champ
            if value is not _MISSING and value is not None:
                return False
            continue
        if value is _MISSING:
            return False
        if isinstance(value, list):  # Mongo : `{tableau: valeur}` = appartenance
            if expected not in value:
                return False
            continue
        if value != expected:
            return False
    return True


def _project(doc, projection):
    """Projection d'inclusion minimale (`{"_id": 0}` = document complet sans `_id`)."""
    if not projection:
        return deepcopy(doc)
    wanted = [key for key, flag in projection.items() if flag and key != "_id"]
    if wanted:
        out = {key: deepcopy(doc[key]) for key in wanted if key in doc}
    else:
        out = deepcopy(doc)
    if projection.get("_id", 1) == 0:
        out.pop("_id", None)
    elif "_id" in doc:
        out["_id"] = doc["_id"]
    return out


class FakeCursor:
    def __init__(self, documents):
        self._documents = documents

    def sort(self, *_args, **_kwargs):
        return self

    def __aiter__(self):
        self._iterator = iter(self._documents)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration

    async def to_list(self, length=None):
        return list(self._documents)


class FakeCollection:
    def __init__(self, documents=(), unique=()):
        self.documents = [deepcopy(doc) for doc in documents]
        self.unique = tuple(unique)

    async def find_one(self, query, projection=None):
        for doc in self.documents:
            if _matches(doc, query):
                return _project(doc, projection)
        return None

    def find(self, query, projection=None):
        return FakeCursor([_project(doc, projection) for doc in self.documents
                           if _matches(doc, query)])

    async def update_one(self, selector, update):
        for doc in self.documents:
            if not _matches(doc, selector):
                continue
            before = deepcopy(doc)
            self._apply(doc, update)
            return SimpleNamespace(modified_count=0 if doc == before else 1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def insert_one(self, document):
        for field in self.unique:
            if any(doc.get(field) == document.get(field) for doc in self.documents):
                raise FakeDuplicate(field)
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    @staticmethod
    def _apply(doc, update) -> None:
        for path, value in (update.get("$set") or {}).items():
            _set(doc, path, deepcopy(value))
        for path, value in (update.get("$push") or {}).items():
            current = _get(doc, path)
            target = current if isinstance(current, list) else []
            target.append(deepcopy(value))
            _set(doc, path, target)
        for path, value in (update.get("$addToSet") or {}).items():
            current = _get(doc, path)
            target = current if isinstance(current, list) else []
            values = value["$each"] if isinstance(value, dict) and "$each" in value else [value]
            for item in values:
                if item not in target:
                    target.append(deepcopy(item))
            _set(doc, path, target)


class FakeDb:
    def __init__(self, *, orders=(), products=(), games=()):
        self.orders = FakeCollection(orders)
        self.products = FakeCollection(products)
        self.games = FakeCollection(games)
        # Index unique (provider, provider_order_id, status, provider_updated_at) → ici `event_id`.
        self.fzr_webhook_events = FakeCollection(unique=("event_id",))


# --------------------------------------------------------------------------- décor

def make_order(*, items=None, game_id=GAME_ID, identity=None, **overrides):
    order = {
        "id": "ord-1", "order_number": "MGS-1", "status": "paid", "game_id": game_id,
        "pubg_id": PLAYER_ID,
        "identity_snapshot": {"fields": identity if identity is not None else {"player_id": PLAYER_ID}},
        "total": 5000, "history": [],
        "items": items if items is not None else [item("p-60", "60 Diamants")],
    }
    order.update(overrides)
    return order


def item(product_id, name, quantity=1):
    return {"product_id": product_id, "slug": f"slug-{product_id}", "name": name,
            "type": "diamond", "unit_price": 5000, "quantity": quantity,
            "line_total": 5000 * quantity}


def product(product_id="p-60", *, game_id=GAME_ID, uc_amount=60, **mapping):
    return {"id": product_id, "game_id": game_id, "name": f"{uc_amount} Diamants",
            "uc_amount": uc_amount, "price": 5000, "active": True,
            "requires_mapping": True, **mapping}


class World:
    def __init__(self, db):
        self.db = db
        self.audit = []
        self.aluu = SimpleNamespace(name_checks=[], product_calls=[], created=[], status_calls=[])
        self.fazercards_calls = []

    @property
    def order(self):
        return run(self.db.orders.find_one({"id": "ord-1"}))

    def actions(self):
        return [entry["action"] for entry in self.audit]


@pytest.fixture
def world(monkeypatch):
    """Installe le faux db et remplace UNIQUEMENT les appels HTTP de `services.aluu`."""
    def build(*, orders, products, games=None, packs=None, create=None, order_status=None):
        doc = FakeDb(orders=orders, products=products,
                     games=[ALUU_GAME] if games is None else games)
        w = World(doc)

        async def fake_name_check(endpoint, params):
            w.aluu.name_checks.append({"endpoint": endpoint, **params})
            return {"valid": True, "player_name": "Joueur Test"}

        async def fake_products(game_code):
            w.aluu.product_calls.append(game_code)
            return [dict(pack) for pack in (packs if packs is not None else PACKS)]

        async def fake_create_order(**kwargs):
            w.aluu.created.append(kwargs)
            if create is not None:
                return create(**kwargs)
            rank = len(w.aluu.created)
            return {"orderid": f"ALUU-{rank}", "status": "pending", "reference": f"REF-{rank}"}

        async def fake_get_order(partner_orderid):
            w.aluu.status_calls.append(partner_orderid)
            if order_status is not None:
                return order_status(partner_orderid)
            return {"orderid": "ALUU-1", "status": "successful"}

        async def fake_audit(action, actor, target=None, meta=None):
            w.audit.append({"action": action, "actor": actor, "target": target, "meta": meta})

        monkeypatch.setattr(core_db, "db", doc)
        monkeypatch.setattr(fzr_fulfillment, "db", doc)
        monkeypatch.setattr(fzr_mapping, "db", doc)
        monkeypatch.setattr(providers, "_PROVIDER_CACHE", {})
        monkeypatch.setattr(providers, "_INSTANCES", {})
        monkeypatch.setattr(aluu, "name_check", fake_name_check)
        monkeypatch.setattr(aluu, "products", fake_products)
        monkeypatch.setattr(aluu, "create_order", fake_create_order)
        monkeypatch.setattr(aluu, "get_order", fake_get_order)
        monkeypatch.setattr(fzr_fulfillment, "audit", fake_audit)
        return w

    return build


def forbid_fazercards(monkeypatch, world):
    """FazerCards devient interdit : tout appel est une preuve de résolution incohérente."""
    def trap(*_args, **_kwargs):
        world.fazercards_calls.append("touched")
        raise AssertionError("FazerCards ne doit jamais être sollicité pour un jeu ALUU")

    real_by_name = providers.get_provider_by_name

    def guarded(name, **kwargs):
        if str(name or "").strip().lower() == "fazercards":
            trap()
        return real_by_name(name, **kwargs)

    monkeypatch.setattr(providers, "get_provider", trap)
    monkeypatch.setattr(providers, "get_provider_by_name", guarded)


def count_resolutions(monkeypatch):
    """Enregistre chaque résolution par jeu (preuve qu'une seule instance sert tout l'envoi)."""
    calls = []
    real_for_game = providers.provider_for_game

    async def counting(game_id, *, games=None):
        provider = await real_for_game(game_id, games=games)
        calls.append((game_id, provider.name))
        return provider

    monkeypatch.setattr(providers, "provider_for_game", counting)
    return calls


def switch_game(world, document):
    """Bascule le document `games` (config admin) et vide le cache de résolution."""
    world.db.games.documents[:] = [dict(document)]
    providers.invalidate_provider_cache()


def patch_fazercards(monkeypatch, provider):
    """Remplace FazerCards par un double sans HTTP (aucun réseau, aucune catégorie inventée)."""
    real_by_name = providers.get_provider_by_name

    def by_name(name, **kwargs):
        if str(name or "").strip().lower() == "fazercards":
            return provider
        return real_by_name(name, **kwargs)

    async def fake_categories(game_id):
        return [{"category_id": "free_fire", "name": "Free Fire"}]

    async def fake_offers(category_id):
        return {"category_id": category_id,
                "offers": [{"offer_id": "60", "name": "60 UC", "price_usd": 0.9}],
                "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}

    monkeypatch.setattr(providers, "get_provider", lambda *_a, **_k: provider)
    monkeypatch.setattr(providers, "get_provider_by_name", by_name)
    monkeypatch.setattr(fzr_mapping.fazercards, "game_categories", fake_categories)
    monkeypatch.setattr(fzr_mapping.fazercards, "pubg_offers_fresh", fake_offers)


# --------------------------------------------------------------------------- helpers purs

@pytest.mark.parametrize("record,target,expected", [
    ({"provider_order_id": "partner-1"}, "partner-1", True),
    ({"aluu_order_id": "aluu-1"}, "aluu-1", True),
    ({"provider_order_ids": ["partner-1", "aluu-1"]}, "aluu-1", True),
    ({"provider_order_id": "partner-1"}, "aluu-1", False),
    (None, "partner-1", False),
])
def test_unit_matches_reads_every_recorded_identifier(record, target, expected):
    assert fzr_fulfillment._unit_matches(record, target) is expected


def test_record_provider_defaults_to_fazercards_and_never_guesses():
    assert fzr_fulfillment._record_provider(None) == "fazercards"
    assert fzr_fulfillment._record_provider({}) == "fazercards"
    assert fzr_fulfillment._record_provider({"provider": "ALUU"}) == "aluu"


# --------------------------------------------------------------------------- bout en bout

def test_aluu_order_is_fulfilled_end_to_end_with_aluu_only(world, monkeypatch):
    """Le test exigé : préflight ET création résolvent le même fournisseur, une seule fois."""
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)])
    forbid_fazercards(monkeypatch, w)
    resolutions = count_resolutions(monkeypatch)

    record = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert resolutions == [(GAME_ID, "aluu")]      # une seule résolution pour tout l'envoi
    assert w.fazercards_calls == []
    assert w.aluu.name_checks[0]["endpoint"] == "game-check"
    assert w.aluu.created[0]["game_code"] == "ff"
    assert w.aluu.created[0]["denom"] == "60"
    assert w.aluu.created[0]["user_id"] == PLAYER_ID
    assert w.aluu.created[0]["partner_orderid"] == "MGS-1-1"
    assert w.aluu.created[0]["server_id"] is None
    # Unités : fournisseur enregistré + les deux identifiants ALUU conservés.
    assert record["provider"] == "aluu"
    assert record["partner_order_id"] == "MGS-1-1"
    assert record["aluu_order_id"] == "ALUU-1"
    assert record["provider_reference"] == "REF-1"
    assert record["status"] == "submitted"
    stored = w.order
    assert stored["provider_order_ids"] == ["MGS-1-1", "ALUU-1"]
    assert "fazercards_provider_ids" not in stored
    assert stored["fazercards"]["provider"] == "aluu"
    assert "fzr.order_created" in w.actions()


def test_aluu_game_without_aluu_mapping_is_refused_before_any_provider_call(world, monkeypatch):
    """Un mapping FazerCards ne rend JAMAIS un jeu ALUU vendable (fail-closed)."""
    w = world(orders=[make_order()],
              products=[product(fazercards_mapping=FC_MAPPING)])
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.preflight("ord-1"))

    assert exc.value.status_code == 409
    assert "ALUU" in exc.value.detail
    assert w.aluu.name_checks == [] and w.aluu.created == []
    assert w.fazercards_calls == []


def test_serverid_required_by_the_pack_but_absent_refuses_before_sending(world, monkeypatch):
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)],
              packs=PACKS_WITH_SERVER)
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert exc.value.status_code == 409
    assert exc.value.detail == fzr_fulfillment.MISSING_IDENTITY_DETAIL
    assert w.aluu.created == []                     # rien n'est parti chez le fournisseur
    assert "fazercards" not in w.order              # aucune unité enregistrée


def test_serverid_required_and_provided_is_sent(world, monkeypatch):
    w = world(orders=[make_order(game_id=SECOND_GAME_ID,
                                 identity={"player_id": PLAYER_ID, "zone_id": ZONE_ID})],
              products=[product(game_id=SECOND_GAME_ID,
                                aluu_mapping={"game_code": "ffz", "denom": "60", "confirmed": True})],
              games=[ALUU_ZONE_GAME], packs=PACKS_WITH_SERVER)
    forbid_fazercards(monkeypatch, w)

    record = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert w.aluu.created[0]["server_id"] == ZONE_ID
    assert record["provider"] == "aluu"


def test_multi_line_aluu_order_creates_one_provider_order_per_line(world, monkeypatch):
    w = world(orders=[make_order(items=[item("p-60", "60 Diamants"),
                                        item("p-120", "120 Diamants")])],
              products=[product(aluu_mapping=ALUU_MAPPING),
                        product("p-120", uc_amount=120, aluu_mapping=ALUU_MAPPING_120)])
    forbid_fazercards(monkeypatch, w)

    result = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert [c["partner_orderid"] for c in w.aluu.created] == ["MGS-1-1", "MGS-1-L2-1"]
    assert [c["denom"] for c in w.aluu.created] == ["60", "120"]
    assert all(entry["ok"] for entry in result["results"])
    stored = w.order
    assert stored["fazercards"]["provider"] == "aluu"
    assert stored["fazercards_lines"]["1"]["provider"] == "aluu"
    assert len(stored["provider_order_ids"]) == 4


def test_insufficient_balance_after_payment_requires_a_manual_action(world, monkeypatch):
    """402 : refus APRÈS paiement → action manuelle explicite, `status` reste `error`."""
    def create(**_kwargs):
        raise perr.ProviderInsufficientBalanceError(
            402, "Solde fournisseur insuffisant.", "ALUU_TEST_ONLY_INSUFFICIENT")

    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)],
              create=create)
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert exc.value.status_code == 409
    record = w.order["fazercards"]
    assert record["status"] == "error"                    # bouton de renvoi préservé
    assert record["manual_action_required"] is True
    assert record["manual_action"] == "insufficient_balance"
    assert record["provider"] == "aluu"
    assert record["provider_order_id"] is None
    assert fzr_fulfillment._sendable(record) is True      # renvoi manuel toujours possible
    assert "fzr.manual_action_required" in w.actions()
    manual = [e for e in w.audit if e["action"] == "fzr.manual_action_required"][0]
    assert manual["meta"]["provider"] == "aluu"
    assert manual["meta"]["manual_action"] == "insufficient_balance"


def test_provider_refusal_is_also_a_manual_action(world, monkeypatch):
    def create(**_kwargs):
        raise perr.ProviderOrderError(409, "Commande refusée.", "order_rejected")

    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)],
              create=create)
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException):
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    record = w.order["fazercards"]
    assert record["manual_action"] == "provider_refused"
    assert record["manual_action_required"] is True
    assert record["status"] == "error"


# --------------------------------------------------------------------------- rafraîchissement

def test_refresh_uses_the_unit_provider_even_after_a_game_switch(world, monkeypatch):
    """Unité créée en ALUU : le basculement du jeu ne doit JAMAIS la réorienter."""
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)])
    forbid_fazercards(monkeypatch, w)
    run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    # Bascule simulée : le document `games` ne déclare plus ALUU.
    w.db.games.documents[:] = [dict(FAZER_GAME)]
    providers.invalidate_provider_cache()

    record = run(fzr_fulfillment.refresh_status("ord-1", "admin:1"))

    assert w.aluu.status_calls == ["MGS-1-1"]
    assert w.fazercards_calls == []
    assert record["provider_status"] == "successful"
    assert record["provider"] == "aluu"
    assert w.order["status"] == "delivered"


def test_refresh_marks_aluu_410_as_polling_stopped(world, monkeypatch):
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)],
              order_status=lambda _id: (_ for _ in ()).throw(
                  perr.ProviderError("Arrêt demandé.", status_code=410,
                                     code="polling_stopped")))
    forbid_fazercards(monkeypatch, w)
    run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.refresh_status("ord-1", "admin:1"))

    assert exc.value.status_code == 502
    assert w.order["fazercards"]["polling_stopped"] is True
    assert "fzr.refresh_error" in w.actions()
    # Plus aucune interrogation de cet identifiant.
    with pytest.raises(HTTPException) as second:
        run(fzr_fulfillment.refresh_status("ord-1", "admin:1"))
    assert second.value.status_code == 404


# --------------------------------------------------------------------------- webhook

def test_webhook_matches_the_aluu_order_id_and_dedups(world, monkeypatch):
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)])
    forbid_fazercards(monkeypatch, w)
    run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    event = {"event": "order.status_changed", "event_id": "evt-1",
             "data": {"order_id": "ALUU-1", "status": "successful", "previous_status": "pending"}}
    assert run(fzr_fulfillment.apply_webhook_event(dict(event))) == {"ok": True}

    stored = w.order
    assert stored["fazercards"]["provider_status"] == "successful"
    assert stored["status"] == "delivered"
    status_audit = [e for e in w.audit if e["action"] == "fzr.webhook_status"][0]
    assert status_audit["actor"] == "aluu"
    assert status_audit["meta"]["provider_order_id"] == "ALUU-1"

    # Rejeu du même événement : dédupliqué, aucun nouvel effet.
    assert run(fzr_fulfillment.apply_webhook_event(dict(event))) == {"ok": True, "duplicate": True}
    assert len([e for e in w.audit if e["action"] == "fzr.webhook_status"]) == 1


def test_webhook_ignores_an_unknown_provider_order(world, monkeypatch):
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)])
    forbid_fazercards(monkeypatch, w)
    run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    event = {"event": "order.status_changed", "event_id": "evt-2",
             "data": {"order_id": "inconnu", "status": "successful"}}

    assert run(fzr_fulfillment.apply_webhook_event(event)) == {"ok": True, "ignored": True}
    assert w.order["fazercards"]["provider_status"] == "pending"


# --------------------------------------------------------------------------- non-régression FC

class FakeFazercardsProvider(FazerCardsProvider):
    """FazerCards sans HTTP : seul le contrat de livraison historique est exercé ici."""

    def __init__(self):
        self.created = []
        self.status_calls = []

    async def validate_identity(self, game_id, fields):
        return IdentityValidation(valid=True, player_name="Joueur FC", region=None, raw={})

    async def get_offers(self, category_id, fresh=False):
        return {"category_id": category_id,
                "offers": [{"offer_id": "60", "name": "60 UC", "price_usd": 0.9}],
                "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}

    async def create_order(self, category_id, offer_id, fields, idempotency_key):
        self.created.append({"category_id": category_id, "offer_id": offer_id,
                             "key": idempotency_key, "fields": dict(fields)})
        return ProviderOrder(id=f"FC-{len(self.created)}", status="processing",
                             normalized_status=self.normalize_status("processing"), raw={})

    async def get_order(self, provider_order_id):
        self.status_calls.append(provider_order_id)
        return ProviderOrder(id=provider_order_id, status="completed",
                             normalized_status=self.normalize_status("completed"), raw={})


class TimeoutOnceFazercardsProvider(FakeFazercardsProvider):
    """FazerCards dont la PREMIÈRE création expire : le retry doit réutiliser la même clé."""

    def __init__(self):
        super().__init__()
        self.timeouts = 0

    async def create_order(self, category_id, offer_id, fields, idempotency_key):
        if self.timeouts == 0:
            self.timeouts += 1
            raise perr.ProviderTimeout()
        return await super().create_order(category_id, offer_id, fields, idempotency_key)


def test_fazercards_order_keeps_its_historical_shape(world, monkeypatch):
    """Jeu sans `provider` : le chemin FazerCards ne reçoit AUCUN champ ALUU."""
    provider = FakeFazercardsProvider()
    w = world(orders=[make_order()], products=[product(fazercards_mapping=FC_MAPPING)],
              games=[dict(FAZER_GAME)])
    real_by_name = providers.get_provider_by_name

    def by_name(name, **kwargs):
        if str(name or "").strip().lower() == "fazercards":
            return provider
        return real_by_name(name, **kwargs)

    async def fake_categories(game_id):
        return [{"category_id": "free_fire", "name": "Free Fire"}]

    async def fake_offers(category_id):
        return {"category_id": category_id,
                "offers": [{"offer_id": "60", "name": "60 UC", "price_usd": 0.9}],
                "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}

    monkeypatch.setattr(providers, "get_provider", lambda *_a, **_k: provider)
    monkeypatch.setattr(providers, "get_provider_by_name", by_name)
    monkeypatch.setattr(fzr_mapping.fazercards, "game_categories", fake_categories)
    monkeypatch.setattr(fzr_mapping.fazercards, "pubg_offers_fresh", fake_offers)

    record = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert provider.created[0]["category_id"] == "free_fire"
    assert record["provider"] == "fazercards"
    assert "aluu_order_id" not in record and "partner_order_id" not in record
    stored = w.order
    assert stored["fazercards_provider_ids"] == ["FC-1"]
    assert "provider_order_ids" not in stored
    assert w.aluu.created == [] and w.aluu.name_checks == []

    run(fzr_fulfillment.refresh_status("ord-1", "admin:1"))
    assert provider.status_calls == ["FC-1"]
    assert w.order["status"] == "delivered"


# ===================================================================== partie 1 : fournisseur PAR UNITÉ
#
# Ces tests fixent la règle : une unité qui a déjà un record garde SON fournisseur et SA cible,
# quelle que soit la configuration actuelle du jeu ; une unité sans record suit la config actuelle.
# Le piège `forbid_fazercards` lève si FazerCards est seulement INSTANCIÉ.

MIXED_PACKS = [{"denom": "60", "name": "60 Diamonds", "price_usd": 0.83,
                "requires_server_id": False, "requires_char_name": False},
               {"denom": "120", "name": "120 Diamonds", "price_usd": 1.60,
                "requires_server_id": True, "requires_char_name": False}]

# Jeu rebasculé sur FazerCards MAIS dont la configuration ALUU est encore là (rollback admin).
FAZER_GAME_WITH_ALUU_RESIDUE = {**ALUU_GAME, "provider": "fazercards"}


def test_retry_after_a_switch_to_fazercards_stays_aluu(world, monkeypatch):
    """BLOQUANT : la reprise ne relit pas la config actuelle et ne réoriente jamais vers FazerCards."""
    attempts = []

    def create(**kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:
            raise perr.ProviderTimeout()
        return {"orderid": "ALUU-2", "status": "pending", "reference": "REF-2"}

    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)], create=create)

    with pytest.raises(HTTPException) as first:
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))
    assert first.value.status_code == 504
    assert w.order["fazercards"]["status"] == "submit_timeout"
    assert w.order["fazercards"]["provider"] == "aluu"
    assert len(attempts) == 1

    # Bascule réelle : le jeu est désormais FazerCards (champs ALUU résiduels conservés).
    switch_game(w, FAZER_GAME_WITH_ALUU_RESIDUE)
    assert run(providers.provider_for_game(GAME_ID)).name == "fazercards"
    # FazerCards devient interdit : le moindre contact serait une preuve de réorientation.
    forbid_fazercards(monkeypatch, w)
    resolutions = count_resolutions(monkeypatch)

    record = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert resolutions == []                       # la config actuelle n'est même pas lue
    assert w.fazercards_calls == []                # le piège n'a pas été effleuré
    assert [a["partner_orderid"] for a in attempts] == ["MGS-1-1", "MGS-1-1"]
    assert [a["game_code"] for a in attempts] == ["ff", "ff"]
    assert record["provider"] == "aluu"
    assert record["partner_order_id"] == "MGS-1-1"
    assert record["aluu_order_id"] == "ALUU-2"
    assert w.order["fazercards"]["status"] == "submitted"


def test_retry_after_a_switch_to_aluu_stays_fazercards(world, monkeypatch):
    """L'inverse : une unité FazerCards ne part JAMAIS chez ALUU après la bascule."""
    provider = TimeoutOnceFazercardsProvider()
    w = world(orders=[make_order()], products=[product(fazercards_mapping=FC_MAPPING)],
              games=[dict(FAZER_GAME)])
    patch_fazercards(monkeypatch, provider)

    with pytest.raises(HTTPException) as first:
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))
    assert first.value.status_code == 504
    assert w.order["fazercards"]["provider"] == "fazercards"
    assert w.order["fazercards"]["status"] == "submit_timeout"

    switch_game(w, ALUU_GAME)
    assert run(providers.provider_for_game(GAME_ID)).name == "aluu"

    record = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert w.aluu.created == [] and w.aluu.name_checks == []
    assert [c["key"] for c in provider.created] == ["MGS-1-1"]     # même Idempotency-Key
    assert record["provider"] == "fazercards"
    assert record["provider_order_id"] == "FC-1"
    assert "aluu_order_id" not in record


def test_retry_keeps_the_aluu_target_when_the_mapping_changed_under_it(world, monkeypatch):
    """La CIBLE enregistrée (catégorie + offre) fait foi, pas le mapping courant du produit."""
    attempts = []

    def create(**kwargs):
        attempts.append(kwargs)
        raise perr.ProviderTimeout()

    order = make_order()
    order["fazercards"] = {"provider": "aluu", "status": "submit_timeout", "provider_order_id": None,
                           "category_id": "ff", "offer_id": "60", "offer_name": "60 Diamonds",
                           "product_name": "60 Diamants", "idempotency_key": "MGS-1-1",
                           "created_at": "2026-10-01T00:00:00+00:00"}
    w = world(orders=[order],
              products=[product(aluu_mapping=ALUU_MAPPING_120)],  # mapping changé depuis
              create=create)
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException):
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert [a["denom"] for a in attempts] == ["60"]
    assert w.order["fazercards"]["created_at"] == "2026-10-01T00:00:00+00:00"


def test_mixed_order_routes_the_new_unit_to_the_current_provider(world, monkeypatch):
    """Unité 1 déjà créée en ALUU, unité 2 pas encore créée → unité 2 suit la config actuelle."""
    provider = FakeFazercardsProvider()
    w = world(orders=[make_order(items=[item("p-60", "60 Diamants"),
                                        item("p-120", "120 Diamants")])],
              products=[product(aluu_mapping=ALUU_MAPPING),
                        product("p-120", uc_amount=120, fazercards_mapping=FC_MAPPING)],
              games=[dict(ALUU_GAME)])
    patch_fazercards(monkeypatch, provider)

    first = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert provider.created == []                          # rien chez FazerCards tant qu'ALUU
    assert [c["partner_orderid"] for c in w.aluu.created] == ["MGS-1-1"]
    assert [entry["ok"] for entry in first["results"]] == [True]
    assert "fazercards_lines" not in w.order

    switch_game(w, dict(FAZER_GAME))
    assert run(providers.provider_for_game(GAME_ID)).name == "fazercards"

    second = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert [c["key"] for c in provider.created] == ["MGS-1-L2-1"]   # seule l'unité neuve
    assert len(w.aluu.created) == 1
    assert [entry["ok"] for entry in second["results"]] == [True]
    stored = w.order
    assert stored["fazercards"]["provider"] == "aluu"
    assert stored["fazercards_lines"]["1"]["provider"] == "fazercards"


def test_claim_never_erases_recorded_identifiers_or_the_manual_action(world, monkeypatch):
    """Le claim de reprise FUSIONNE : aucun identifiant, aucune action manuelle n'est perdue."""
    order = make_order(provider_order_ids=["MGS-1-1", "ALUU-OLD"])
    order["fazercards"] = {
        "provider": "aluu", "status": "submit_timeout", "provider_order_id": None,
        "category_id": "ff", "offer_id": "60", "idempotency_key": "MGS-1-1",
        "partner_order_id": "MGS-1-1", "aluu_order_id": "ALUU-OLD",
        "manual_action_required": True, "manual_action": "provider_refused",
        "created_at": "2026-10-01T00:00:00+00:00",
    }

    def create(**_kwargs):
        raise perr.ProviderTimeout()

    w = world(orders=[order], products=[product(aluu_mapping=ALUU_MAPPING)], create=create)
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException):
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    record = w.order["fazercards"]
    assert record["provider"] == "aluu"
    assert record["aluu_order_id"] == "ALUU-OLD"
    assert record["manual_action"] == "provider_refused"
    assert record["manual_action_required"] is True
    assert record["created_at"] == "2026-10-01T00:00:00+00:00"
    assert w.order["provider_order_ids"] == ["MGS-1-1", "ALUU-OLD"]
    assert w.aluu.created[0]["partner_orderid"] == "MGS-1-1"


def test_aluu_retry_without_any_aluu_configuration_fails_closed(world, monkeypatch):
    """Champs ALUU effacés : la reprise échoue explicitement, elle ne bascule pas sur FazerCards."""
    attempts = []

    def create(**kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:
            raise perr.ProviderTimeout()
        return {"orderid": "ALUU-2", "status": "pending", "reference": "REF-2"}

    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)], create=create)
    with pytest.raises(HTTPException):
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    switch_game(w, {"id": GAME_ID})          # plus aucune trace de configuration ALUU
    assert run(providers.provider_for_game(GAME_ID)).name == "fazercards"
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(perr.ProviderError) as exc:
        run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"
    assert w.fazercards_calls == []
    assert len(attempts) == 1                                  # aucun second envoi
    assert w.order["fazercards"]["provider"] == "aluu"          # jamais réorientée
    assert w.order["fazercards"]["status"] == "submit_timeout"  # rien n'a été écrasé


# --------------------------------------------------------------------- champs requis PAR OFFRE

def test_preflight_checks_the_chosen_offer_fields_not_the_game_aggregate(world, monkeypatch):
    """Un pack sans `serverid` passe même si un AUTRE pack du jeu l'exige."""
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)],
              packs=MIXED_PACKS)
    forbid_fazercards(monkeypatch, w)

    report = run(fzr_fulfillment.preflight("ord-1"))
    assert [line["offer_id"] for line in report["lines"]] == ["60"]
    assert report["skipped"] == []

    record = run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))
    assert record["provider"] == "aluu"
    assert w.aluu.created[0]["server_id"] is None


def test_preflight_refuses_when_the_chosen_offer_needs_serverid(world, monkeypatch):
    """Le pack choisi exige `serverid` : refus AVANT tout envoi (identité incomplète)."""
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING_120)],
              packs=MIXED_PACKS)
    forbid_fazercards(monkeypatch, w)

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.preflight("ord-1"))

    assert exc.value.status_code == 409
    assert exc.value.detail == fzr_fulfillment.MISSING_IDENTITY_DETAIL
    assert w.aluu.created == []


def test_get_offers_exposes_required_fields_per_offer(world, monkeypatch):
    """`get_offers` publie les exigences PAR OFFRE, l'agrégat restant disponible."""
    world(orders=[], products=[], packs=MIXED_PACKS)
    result = run(providers.get_provider_by_name("aluu").get_offers("ff"))
    by_id = {offer["offer_id"]: offer for offer in result["offers"]}

    assert [f["key"] for f in by_id["60"]["fields"]] == ["userid"]
    assert by_id["60"]["requires_server_id"] is False
    assert by_id["60"]["requires_char_name"] is False
    assert [f["key"] for f in by_id["120"]["fields"]] == ["userid", "serverid"]
    assert by_id["120"]["requires_server_id"] is True
    assert [f["key"] for f in result["fields"]] == ["userid", "serverid"]   # agrégat conservé


# --------------------------------------------------------------------- webhook filtré par fournisseur

def test_fazercards_webhook_never_updates_an_aluu_unit(world, monkeypatch):
    """L'identifiant est propre au fournisseur : la route FC ne touche aucune unité ALUU."""
    w = world(orders=[make_order()], products=[product(aluu_mapping=ALUU_MAPPING)])
    forbid_fazercards(monkeypatch, w)
    run(fzr_fulfillment.fulfill_order("ord-1", "admin:1"))

    event = {"event": "order.status_changed", "event_id": "evt-3",
             "data": {"order_id": "MGS-1-1", "status": "cancelled"}}

    assert run(fzr_fulfillment.apply_webhook_event(dict(event), provider_name="fazercards")) == \
        {"ok": True, "ignored": True}
    assert w.order["fazercards"]["provider_status"] == "pending"

    assert run(fzr_fulfillment.apply_webhook_event({**event, "event_id": "evt-4"},
                                                  provider_name="aluu")) == {"ok": True}
    assert w.order["fazercards"]["provider_status"] == "cancelled"
    assert [e for e in w.audit if e["action"] == "fzr.webhook_status"][0]["actor"] == "aluu"
