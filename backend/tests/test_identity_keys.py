"""PL-003-BE-7 — clé d'identité (`game_id` + `identity_key`), verrous et migration idempotente.

Aucun Mongo réel n'est disponible dans cet environnement (pas de `mongod`/`mongosh`/docker) :
les collections sont simulées par `FakeCollection`, qui reproduit ce dont le code dépend —
index uniques (insertion identique = `DuplicateKeyError`), backfill additif, ordre des opérations.
Les règles testées ici sont celles de la production ; elles restent à rejouer sur une base réelle
avant la mise en ligne (cf. rapport BE-7, « Non vérifié »).
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core import identity_keys as ik
from core.games import DEFAULT_GAME_ID, check_identity_payload
from routers import evo as evo_mod
from routers import orders as orders_mod
from services.fzr_fulfillment import _unit_identity

PUBG = DEFAULT_GAME_ID
FREE_FIRE = "free-fire"
ML = "mobile-legends"


def run(coro):
    return asyncio.run(coro)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _in(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


# --------------------------------------------------------------------------- #
# Faux Mongo (suffisant pour le code testé)
# --------------------------------------------------------------------------- #
_MISSING = object()


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in expected):
                return False
            continue
        value = doc.get(key, _MISSING)
        if isinstance(expected, dict) and expected and all(k.startswith("$") for k in expected):
            if "$exists" in expected:
                if (value is not _MISSING) != expected["$exists"]:
                    return False
            if "$in" in expected:
                if (None if value is _MISSING else value) not in expected["$in"]:
                    return False
            continue
        if (None if value is _MISSING else value) != expected:
            return False
    return True


def _project(doc: dict, projection: dict | None) -> dict:
    if not projection:
        return dict(doc)
    out = {k: doc[k] for k, keep in projection.items() if keep and k in doc}
    if projection.get("_id", 1) and "_id" in doc:
        out["_id"] = doc["_id"]
    return out


class FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    """Collection en mémoire : index uniques réellement appliqués, appels journalisés."""

    def __init__(self, calls: list[str] | None = None):
        self.docs: list[dict] = []
        self.indexes: dict[str, dict] = {}
        self.calls: list[str] = calls if calls is not None else []

    # ---- index ----
    @staticmethod
    def _keys(keys) -> list[tuple[str, int]]:
        return [(keys, 1)] if isinstance(keys, str) else [tuple(k) for k in keys]

    async def create_index(self, keys, unique: bool = False, name: str | None = None, **kwargs):
        key_list = self._keys(keys)
        name = name or "_".join(f"{k}_{d}" for k, d in key_list)
        if name in self.indexes and self.indexes[name]["key"] == key_list:
            return name
        if unique:
            seen = set()
            for doc in self.docs:
                values = tuple(doc.get(k) for k, _ in key_list)
                if values in seen:
                    raise DuplicateKeyError("E11000 duplicate key error")
                seen.add(values)
        self.indexes[name] = {"key": key_list, "unique": unique}
        self.calls.append(f"create_index:{name}")
        return name

    async def index_information(self):
        return {name: {"key": list(info["key"]), "unique": info["unique"]}
                for name, info in self.indexes.items()}

    async def drop_index(self, name: str):
        self.calls.append(f"drop_index:{name}")
        self.indexes.pop(name)

    def names(self) -> dict:
        return {name: tuple(info["key"]) for name, info in
                run(self.index_information()).items()}

    # ---- données ----
    async def insert_one(self, doc: dict):
        doc = dict(doc)
        doc.setdefault("_id", uuid.uuid4().hex)
        for info in self.indexes.values():
            if not info["unique"]:
                continue
            values = tuple(doc.get(k) for k, _ in info["key"])
            for other in self.docs:
                if tuple(other.get(k) for k, _ in info["key"]) == values:
                    raise DuplicateKeyError("E11000 duplicate key error")
        self.docs.append(doc)

    async def find_one(self, query: dict, projection: dict | None = None):
        for doc in self.docs:
            if _matches(doc, query):
                return _project(doc, projection)
        return None

    def find(self, query: dict | None = None, projection: dict | None = None):
        return FakeCursor([_project(d, projection) for d in self.docs if _matches(d, query or {})])

    async def update_one(self, query: dict, update: dict):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set") or {})
                return

    async def delete_one(self, query: dict):
        for i, doc in enumerate(self.docs):
            if _matches(doc, query):
                self.docs.pop(i)
                return

    async def delete_many(self, query: dict):
        self.docs = [d for d in self.docs if not _matches(d, query)]

    async def count_documents(self, query: dict) -> int:
        return sum(1 for d in self.docs if _matches(d, query))


@pytest.fixture
def fake_db(monkeypatch):
    """Remplace `db` dans les modules qui manipulent les verrous (aucun appel Mongo réel)."""
    journal: list[str] = []  # journal CHRONOLOGIQUE partagé : prouve l'ordre des opérations
    fake = SimpleNamespace(orders=FakeCollection(journal),
                           subscription_locks=FakeCollection(journal),
                           evo_locks=FakeCollection(journal), journal=journal)
    monkeypatch.setattr(orders_mod, "db", fake)
    monkeypatch.setattr(evo_mod, "db", fake)
    monkeypatch.setattr(ik, "db", fake)
    return fake


async def _legacy_indexes(collection, keys):
    await collection.create_index([tuple(k) for k in keys], unique=True)


def _seed(collection, **fields) -> None:
    """Document ancien : Mongo en ajoute toujours un `_id`."""
    collection.docs.append({"_id": uuid.uuid4().hex, **fields})


def make_order(order_id: str | None = None, *, game_id: str = PUBG, fields: dict | None = None,
               pubg_id: str = "52328390220", status: str = "pending_payment",
               with_identity_key: bool = True) -> dict:
    order = {
        "id": order_id or str(uuid.uuid4()), "order_number": "MGS-TEST01", "pubg_id": pubg_id,
        "game_id": game_id, "status": status, "created_at": _now(),
        "identity_snapshot": {"source": "checkout", "game_id": game_id,
                              "fields": fields or {"player_id": pubg_id}, "validated": False},
    }
    if with_identity_key:
        order["identity_key"] = ik.identity_key(order["identity_snapshot"]["fields"])
    return order


# --------------------------------------------------------------------------- #
# 1. Clé d'identité
# --------------------------------------------------------------------------- #
def test_pubg_identity_key_equals_pubg_id():
    """Rétrocompatibilité : pour une valeur déjà propre, la clé EST le `pubg_id`."""
    for pubg_id in ("52328390220", "123456789", "1234567890123"):
        assert ik.identity_key({"player_id": pubg_id}) == pubg_id


def test_mobile_legends_identity_key_joins_declared_fields():
    assert ik.identity_key({"player_id": "12345678", "zone_id": "2214"}) == "12345678|2214"


@pytest.mark.parametrize("raw,expected", [
    ("  Nom#Tag  ", "nom#tag"),                    # espaces de bord + casse
    ("Nom   #Tag", "nom #tag"),                    # espaces internes réduits
    ("１２３45678", "12345678"),                     # NFKC (chiffres pleine largeur)
    ("0002214", "2214"),                           # zéros initiaux (valeur numérique)
    ("2214", "2214"),
    ("  ", ""),                                    # vide -> ignoré
])
def test_normalization(raw, expected):
    assert ik.normalize_identity_value(raw) == expected


def test_normalization_is_idempotent():
    for value in ("  Nom#Tag  ", "0002214", "１２３45678", "12345678|2214"):
        once = ik.normalize_identity_value(value)
        assert ik.normalize_identity_value(once) == once


def test_empty_values_are_ignored_never_invented():
    assert ik.identity_key({"player_id": "12345678", "zone_id": ""}) == "12345678"
    assert ik.identity_key({"player_id": "12345678", "zone_id": None}) == "12345678"
    assert ik.identity_key({}) == ""
    assert ik.identity_key(None) == ""


def test_zone_a_is_not_zone_b_but_same_pair_is_same_key():
    a = ik.identity_key({"player_id": "12345678", "zone_id": "2214"})
    b = ik.identity_key({"player_id": "12345678", "zone_id": "2215"})
    a_bis = ik.identity_key({"player_id": " 12345678 ", "zone_id": "0002214"})
    assert a != b and a == a_bis


def test_declared_order_is_the_one_produced_by_the_domain():
    """`identity_key` suit l'ordre du dictionnaire : le domaine le produit dans l'ordre DÉCLARÉ."""
    spec = [{"key": "player_id", "label": "ID", "primary": True},
            {"key": "zone_id", "label": "Zone", "primary": False}]
    clean, primary = check_identity_payload(spec, {"zone_id": "2214", "player_id": "12345678"})
    assert list(clean) == ["player_id", "zone_id"]      # ordre de la spécification, pas de la saisie
    assert primary == "12345678"
    assert ik.identity_key(clean) == "12345678|2214"


def test_order_identity_key_prefers_stored_value_then_snapshot_then_pubg_id():
    order = make_order(game_id=ML, fields={"player_id": "12345678", "zone_id": "2214"},
                       pubg_id="12345678")
    assert ik.order_identity_key(order) == "12345678|2214"
    assert ik.order_game_id(order) == ML
    legacy = {"pubg_id": "52328390220"}
    assert ik.order_identity_key(legacy) == "52328390220"
    assert ik.order_game_id(legacy) == PUBG


# --------------------------------------------------------------------------- #
# 2. Verrous : création / lecture
# --------------------------------------------------------------------------- #
async def _with_new_indexes(fake_db):
    """État d'après migration : index uniques (game_id, identity_key, …) en place."""
    await fake_db.subscription_locks.create_index(ik.SUBSCRIPTION_LOCK_KEYS, unique=True,
                                                 name=ik.SUBSCRIPTION_LOCK_INDEX)
    await fake_db.evo_locks.create_index(ik.EVO_LOCK_KEYS, unique=True, name=ik.EVO_LOCK_INDEX)


def test_duplicate_subscription_refused_for_same_identity(fake_db):
    run(_with_new_indexes(fake_db))
    first = make_order()
    run(fake_db.orders.insert_one(first))
    run(orders_mod.reserve_subscription(first["pubg_id"], "prime", first, 1))

    second = make_order()
    run(fake_db.orders.insert_one(second))
    with pytest.raises(HTTPException) as exc:
        run(orders_mod.reserve_subscription(second["pubg_id"], "prime", second, 1))
    assert exc.value.status_code == 409
    assert len(fake_db.subscription_locks.docs) == 1


def test_same_number_in_another_game_is_not_a_duplicate(fake_db):
    """Avant BE-7, l'index (pubg_id, type) refusait ce second achat : plus maintenant."""
    run(_with_new_indexes(fake_db))
    pubg_order = make_order(game_id=PUBG, fields={"player_id": "123456789"}, pubg_id="123456789")
    ff_order = make_order(game_id=FREE_FIRE, fields={"player_id": "123456789"}, pubg_id="123456789")
    run(fake_db.orders.insert_one(pubg_order))
    run(fake_db.orders.insert_one(ff_order))

    run(orders_mod.reserve_subscription(pubg_order["pubg_id"], "prime", pubg_order, 1))
    run(orders_mod.reserve_subscription(ff_order["pubg_id"], "prime", ff_order, 1))
    assert len(fake_db.subscription_locks.docs) == 2

    with pytest.raises(HTTPException):
        run(orders_mod.reserve_subscription(ff_order["pubg_id"], "prime", ff_order, 1))


def test_other_zone_is_another_identity(fake_db):
    run(_with_new_indexes(fake_db))
    zone_a = make_order(game_id=ML, fields={"player_id": "12345678", "zone_id": "2214"},
                        pubg_id="12345678")
    zone_b = make_order(game_id=ML, fields={"player_id": "12345678", "zone_id": "2215"},
                        pubg_id="12345678")
    run(fake_db.orders.insert_one(zone_a))
    run(fake_db.orders.insert_one(zone_b))

    run(orders_mod.reserve_subscription(zone_a["pubg_id"], "prime", zone_a, 1))
    run(orders_mod.reserve_subscription(zone_b["pubg_id"], "prime", zone_b, 1))
    assert len(fake_db.subscription_locks.docs) == 2

    with pytest.raises(HTTPException):
        run(orders_mod.reserve_subscription(zone_a["pubg_id"], "prime", zone_a, 1))


def test_stale_lock_is_replaced(fake_db):
    run(_with_new_indexes(fake_db))
    cancelled = make_order(status="cancelled")
    run(fake_db.orders.insert_one(cancelled))
    run(orders_mod.reserve_subscription(cancelled["pubg_id"], "prime_plus", cancelled, 1))

    fresh = make_order()
    run(fake_db.orders.insert_one(fresh))
    run(orders_mod.reserve_subscription(fresh["pubg_id"], "prime_plus", fresh, 1))
    assert [d["order_id"] for d in fake_db.subscription_locks.docs] == [fresh["id"]]


def test_legacy_lock_still_blocks_before_migration(fake_db):
    """Fenêtre sans migration (IDENTITY_KEY_MIGRATION=off) : le verrou historique reste honoré."""
    run(_legacy_indexes(fake_db.subscription_locks, ik.LEGACY_SUBSCRIPTION_LOCK_KEYS))
    holder = make_order()
    run(fake_db.orders.insert_one(holder))
    run(fake_db.subscription_locks.insert_one({"pubg_id": holder["pubg_id"], "type": "prime",
                                               "order_id": holder["id"], "expires_at": _in(20),
                                               "created_at": _now()}))
    second = make_order()
    run(fake_db.orders.insert_one(second))
    with pytest.raises(HTTPException) as exc:
        run(orders_mod.reserve_subscription(second["pubg_id"], "prime", second, 1))
    assert exc.value.status_code == 409
    assert "Prime" in exc.value.detail  # message métier, pas « Réessayez dans un instant »


def test_active_subscriptions_ignores_other_games(fake_db):
    holder = make_order()
    other = make_order(game_id=FREE_FIRE)
    run(fake_db.orders.insert_one(holder))
    run(fake_db.orders.insert_one(other))
    run(fake_db.subscription_locks.insert_one({"game_id": PUBG, "identity_key": holder["identity_key"],
                                               "pubg_id": holder["pubg_id"], "type": "prime",
                                               "order_id": holder["id"], "expires_at": _in(20),
                                               "created_at": _now()}))
    run(fake_db.subscription_locks.insert_one({"game_id": FREE_FIRE, "identity_key": other["identity_key"],
                                               "pubg_id": other["pubg_id"], "type": "prime_plus",
                                               "order_id": other["id"], "expires_at": _in(20),
                                               "created_at": _now()}))
    active = run(orders_mod.active_subscriptions(holder["pubg_id"]))
    assert set(active) == {"prime"}


EVO_PRODUCT = {"id": "p1", "slug": "pack-evolutif", "name": "Pack évolutif", "type": "evo",
               "evo_limit": "lifetime", "active": True}


def test_evo_duplicate_refused_and_other_period_accepted(fake_db, monkeypatch):
    run(_with_new_indexes(fake_db))
    monkeypatch.setattr(evo_mod, "evo_period", _lifetime)

    first = make_order()
    run(fake_db.orders.insert_one(first))
    run(evo_mod.reserve_evo(first, EVO_PRODUCT))

    same = make_order()
    run(fake_db.orders.insert_one(same))
    with pytest.raises(HTTPException) as exc:
        run(evo_mod.reserve_evo(same, EVO_PRODUCT))
    assert exc.value.status_code == 409

    async def week_period(product):
        return "week:2026-W44", None
    monkeypatch.setattr(evo_mod, "evo_period", week_period)
    run(evo_mod.reserve_evo(same, EVO_PRODUCT))       # autre période = autre verrou
    assert len(fake_db.evo_locks.docs) == 2


def test_evo_other_game_same_number_is_not_a_duplicate(fake_db, monkeypatch):
    run(_with_new_indexes(fake_db))
    monkeypatch.setattr(evo_mod, "evo_period", _lifetime)
    pubg_order = make_order(fields={"player_id": "123456789"}, pubg_id="123456789")
    ff_order = make_order(game_id=FREE_FIRE, fields={"player_id": "123456789"}, pubg_id="123456789")
    run(fake_db.orders.insert_one(pubg_order))
    run(fake_db.orders.insert_one(ff_order))
    run(evo_mod.reserve_evo(pubg_order, EVO_PRODUCT))
    run(evo_mod.reserve_evo(ff_order, EVO_PRODUCT))
    assert len(fake_db.evo_locks.docs) == 2


async def _lifetime(product):
    return "lifetime", None


# --------------------------------------------------------------------------- #
# 3. Migration idempotente
# --------------------------------------------------------------------------- #
def _seed_legacy(fake_db, *, with_game_id: bool):
    order = {"id": "ord-1", "pubg_id": "12345678", "pseudo": "Kapotue",
             "identity_snapshot": {"fields": {"player_id": "12345678", "zone_id": "2214"}}}
    if with_game_id:
        order["game_id"] = ML
    _seed(fake_db.orders, **order)
    _seed(fake_db.subscription_locks, pubg_id="12345678", type="prime", order_id="ord-1",
          expires_at=_in(20), created_at=_now())
    _seed(fake_db.evo_locks, pubg_id="12345678", offer_slug="pack", period_key="lifetime",
          order_id="ord-1", created_at=_now())
    run(_legacy_indexes(fake_db.subscription_locks, ik.LEGACY_SUBSCRIPTION_LOCK_KEYS))
    run(_legacy_indexes(fake_db.evo_locks, ik.LEGACY_EVO_LOCK_KEYS))


def test_migration_backfills_orders_and_locks(fake_db):
    _seed_legacy(fake_db, with_game_id=True)
    summary = run(ik.migrate_identity_keys())

    order = fake_db.orders.docs[0]
    assert order["game_id"] == ML                    # jeu existant conservé
    assert order["identity_key"] == "12345678|2214"  # champs déclarés joints
    assert order["pubg_id"] == "12345678"            # colonne historique intacte
    assert fake_db.subscription_locks.docs[0]["identity_key"] == "12345678"
    assert fake_db.subscription_locks.docs[0]["game_id"] == PUBG
    assert fake_db.evo_locks.docs[0]["identity_key"] == "12345678"
    assert summary["complete"] is True and summary["new_indexes"] is True
    assert summary["backfilled"] == {"orders": 1, "subscription_locks": 1, "evo_locks": 1}


def test_migration_defaults_missing_game_id_to_pubg_mobile(fake_db):
    _seed_legacy(fake_db, with_game_id=False)
    run(ik.migrate_identity_keys())
    assert fake_db.orders.docs[0]["game_id"] == PUBG
    assert fake_db.orders.docs[0]["identity_key"] == "12345678|2214"


def test_migration_creates_new_indexes_before_dropping_legacy_ones(fake_db):
    _seed_legacy(fake_db, with_game_id=True)
    run(ik.migrate_identity_keys())
    names = fake_db.subscription_locks.names()
    assert ik.SUBSCRIPTION_LOCK_INDEX in names and "pubg_id_1_type_1" not in names
    assert ik.EVO_LOCK_INDEX in fake_db.evo_locks.names()

    calls = fake_db.journal
    first_drop = next((i for i, c in enumerate(calls) if c.startswith("drop_index")), None)
    last_create = max(i for i, c in enumerate(calls) if c.startswith("create_index"))
    assert first_drop is not None and first_drop > last_create  # anciens supprimés EN DERNIER


def test_migration_is_idempotent(fake_db):
    _seed_legacy(fake_db, with_game_id=True)
    run(ik.migrate_identity_keys())
    snapshot = [dict(d) for coll in (fake_db.orders, fake_db.subscription_locks, fake_db.evo_locks)
                for d in coll.docs]
    second = run(ik.migrate_identity_keys())
    assert second["backfilled"] == {"orders": 0, "subscription_locks": 0, "evo_locks": 0}
    assert second["legacy_indexes_dropped"] == []
    assert second["complete"] is True
    assert [dict(d) for coll in (fake_db.orders, fake_db.subscription_locks, fake_db.evo_locks)
            for d in coll.docs] == snapshot


def test_migration_stops_before_dropping_when_duplicates_block(fake_db):
    """Deux commandes legacy du même numéro dans deux jeux -> doublon pour le nouvel index."""
    # L'index historique existait AVANT ces documents (il autorise le même numéro dans deux jeux).
    run(_legacy_indexes(fake_db.subscription_locks, ik.LEGACY_SUBSCRIPTION_LOCK_KEYS))
    run(_legacy_indexes(fake_db.evo_locks, ik.LEGACY_EVO_LOCK_KEYS))
    _seed(fake_db.subscription_locks, pubg_id="123456789", type="prime", order_id="a", expires_at=_in(20))
    _seed(fake_db.subscription_locks, pubg_id="123456789", type="prime", order_id="b", expires_at=_in(20))
    _seed(fake_db.evo_locks, pubg_id="123456789", type="prime", offer_slug="x", period_key="lifetime")

    summary = run(ik.migrate_identity_keys())
    assert summary["complete"] is False
    assert summary["reason"] == "index_creation_failed"
    names = fake_db.subscription_locks.names()
    assert "pubg_id_1_type_1" in names          # ancien index CONSERVÉ : protection intacte
    assert ik.SUBSCRIPTION_LOCK_INDEX not in names


def test_migration_can_be_disabled(fake_db, monkeypatch):
    monkeypatch.setenv(ik.IDENTITY_KEY_MIGRATION_ENV, "off")
    _seed_legacy(fake_db, with_game_id=True)
    before = [dict(d) for d in fake_db.orders.docs]
    summary = run(ik.migrate_identity_keys())
    assert summary["enabled"] is False and summary["complete"] is False
    assert fake_db.orders.docs == before
    assert "pubg_id_1_type_1" in fake_db.subscription_locks.names()


@pytest.mark.parametrize("value,enabled", [("on", True), ("", True), ("off", False),
                                           ("OFF", False), ("0", False), ("false", False)])
def test_migration_flag_parsing(monkeypatch, value, enabled):
    monkeypatch.setenv(ik.IDENTITY_KEY_MIGRATION_ENV, value)
    assert ik.migration_enabled() is enabled


def test_ensure_lock_indexes_never_recreates_legacy_after_migration(fake_db):
    _seed_legacy(fake_db, with_game_id=True)
    run(ik.migrate_identity_keys())
    run(ik.ensure_lock_indexes())
    names = fake_db.subscription_locks.names()
    assert ik.SUBSCRIPTION_LOCK_INDEX in names
    assert "pubg_id_1_type_1" not in names       # sinon l'unicité par pubg_id seul reviendrait


def test_ensure_lock_indexes_keeps_protection_before_migration(fake_db):
    run(ik.ensure_lock_indexes())
    assert "pubg_id_1_type_1" in fake_db.subscription_locks.names()
    assert "pubg_id_1_offer_slug_1_period_key_1" in fake_db.evo_locks.names()


def test_migration_logs_contain_no_identifier(fake_db, caplog):
    """Aucun ID ni pseudo dans les journaux — y compris quand un doublon fait échouer l'index."""
    run(_legacy_indexes(fake_db.subscription_locks, ik.LEGACY_SUBSCRIPTION_LOCK_KEYS))
    _seed(fake_db.subscription_locks, pubg_id="987654321", type="prime", order_id="a", expires_at=_in(20))
    _seed(fake_db.subscription_locks, pubg_id="987654321", type="prime", order_id="b", expires_at=_in(20))
    _seed(fake_db.orders, id="c", pubg_id="987654321", pseudo="Kapotue",
          identity_snapshot={"fields": {"player_id": "987654321"}})
    with caplog.at_level("DEBUG", logger="mgs.identity"):
        run(ik.migrate_identity_keys())
    text = "\n".join(record.getMessage() for record in caplog.records)
    assert "987654321" not in text
    assert "Kapotue" not in text
    assert "identity_key" in text          # la migration parle d'elle-même, pas des joueurs


# --------------------------------------------------------------------------- #
# 4. Contrat fournisseur inchangé
# --------------------------------------------------------------------------- #
def test_idempotency_keys_are_independent_of_the_identity():
    """L'`Idempotency-Key` envoyée à FazerCards ne dépend que du numéro de commande et des index."""
    assert _unit_identity("MGS-ABC123", 0, None) == ("fazercards", "MGS-ABC123-1")
    assert _unit_identity("MGS-ABC123", 1, None) == ("fazercards_lines.1", "MGS-ABC123-L2-1")
    assert _unit_identity("MGS-ABC123", 0, 1) == ("fazercards_components.0.1", "MGS-ABC123-L1-C2")
    assert _unit_identity("MGS-ABC123", 1, 0, 2) == ("fazercards_reps.1.2.0", "MGS-ABC123-L2-U3-C1")
    # Deux identités différentes, même numéro de commande : mêmes clés (aucune dépendance à l'ID).
    assert _unit_identity("MGS-ABC123", 0, None) == _unit_identity("MGS-ABC123", 0, None)
