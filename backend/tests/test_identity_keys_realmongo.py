"""PL-003-BE-7-VERIFY1 — migration et index de BE-7 sur un VRAI MongoDB (base jetable).

Ce module ne remplace pas `tests/test_identity_keys.py` (qui simule Mongo) : il rejoue les mêmes
règles contre un serveur réel, dans une base JETABLE créée pour l'occasion.

Garde-fous :

- `MONGO_URL` doit pointer vers un serveur LOCAL (`localhost` / `127.0.0.1` / `::1`) ; sinon le
  module refuse de tourner (saut explicite, aucun test exécuté) ;
- la base de travail est nommée `mgs_verify_<suffixe aléatoire>` ; aucune autre base n'est lue,
  écrite ni supprimée ; la base jetable est supprimée dans un `finally`, même en cas d'échec ;
- documents synthétiques uniquement (identifiants fictifs en 999…/888…), aucun appel FazerCards
  ni Neferbyte.

Sans MongoDB local, tout le module est sauté proprement : il reste exclu de la suite par défaut
sur une machine sans serveur.

Pour la mesure indicative (~10 000 documents par collection), lancer avec `MGS_VERIFY_PERF=1`.
"""
import asyncio
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import pytest

# Une seule boucle, créée AVANT le client motor : le client y est explicitement rattaché.
_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)

MONGO_URL = os.environ.get("MONGO_URL", "")
THROWAWAY_PREFIX = "mgs_verify_"
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FREE_FIRE = "free-fire"
ML = "mobile-legends"

# Identifiants FICTIFS (aucune donnée réelle de joueur).
PUBG_A = "999000111"
PUBG_B = "999000222"
PUBG_C = "999000333"
ML_ID = "88800011"
ML_ZONE = "7654"

NOW = datetime.now(timezone.utc).isoformat()
FUTURE = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


# --------------------------------------------------------------------------- #
# Garde-fous et skip propre (imports lourds APRÈS les gardes : le saut reste rapide)
# --------------------------------------------------------------------------- #
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "[::1]")


def _nodes(url: str) -> list[tuple[str, int]]:
    """(hôte, port) de chaque nœud d'une URL `mongodb://…` (identifiants retirés)."""
    if not url.startswith("mongodb://"):
        return []
    netloc = urlsplit(url).netloc
    nodes: list[tuple[str, int]] = []
    for raw in netloc.split(","):
        node = raw.rsplit("@", 1)[-1]          # user:pass@hôte:port
        host, _, port = node.rpartition(":")
        if not host:                            # pas de port explicite
            host, port = node, "27017"
        try:
            nodes.append((host, int(port)))
        except ValueError:
            return []
    return nodes


def _local_only(url: str) -> bool:
    """Vrai si l'URL Mongo ne désigne QUE des hôtes locaux (sinon : refus de tourner)."""
    nodes = _nodes(url)
    return bool(nodes) and all(host in LOCAL_HOSTS for host, _ in nodes)


def _port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _reachable(url: str) -> bool:
    return all(_port_open(host, port) for host, port in _nodes(url))


def _throwaway_name() -> str:
    name = THROWAWAY_PREFIX + secrets.token_hex(4)
    if not name.startswith(THROWAWAY_PREFIX):
        raise RuntimeError("nom de base jetable invalide : préfixe mgs_verify_ exigé")
    return name


if not _local_only(MONGO_URL):
    pytest.skip(f"refus : MONGO_URL n'est pas local ({MONGO_URL!r}) — aucune base distante touchée",
                allow_module_level=True)
if not _reachable(MONGO_URL):
    pytest.skip("aucun MongoDB local joignable — vérification réelle non exécutée",
                allow_module_level=True)

from pymongo.errors import DuplicateKeyError  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from core import db as db_module  # noqa: E402
from core import identity_keys as ik  # noqa: E402
from core.games import DEFAULT_GAME_ID  # noqa: E402
from routers import evo as evo_mod  # noqa: E402
from routers import orders as orders_mod  # noqa: E402


def run(coro):
    asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)



# --------------------------------------------------------------------------- #
# Base jetable
# --------------------------------------------------------------------------- #
class Sandbox:
    def __init__(self, client, database, name: str):
        self.client = client
        self.db = database
        self.name = name


@pytest.fixture
def sandbox(monkeypatch):
    """Base jetable + `db` redirigé dans tous les modules qui le détiennent."""
    name = _throwaway_name()
    client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=2000, io_loop=_LOOP)
    database = client[name]
    for module in (ik, orders_mod, evo_mod, db_module):
        monkeypatch.setattr(module, "db", database)
    run(database.command("ping"))
    try:
        yield Sandbox(client, database, name)
    finally:
        run(client.drop_database(name))
        remaining = run(client.list_database_names())
        client.close()
        # Même en cas d'échec du test : la base jetable doit avoir disparu.
        assert name not in remaining, f"base jetable toujours présente : {name}"
        print(f"[verify] base jetable supprimée : {name} "
              f"(mgs_verify_* restantes : {[n for n in remaining if n.startswith(THROWAWAY_PREFIX)]})")


async def _all(collection) -> list[dict]:
    return [doc async for doc in collection.find({}).sort("_id", 1)]


async def _index_keys(collection) -> dict[str, tuple]:
    info = await collection.index_information()
    return {name: tuple(tuple(k) for k in doc.get("key") or []) for name, doc in info.items()}


async def _index_unique(collection) -> dict[str, bool]:
    info = await collection.index_information()
    return {name: bool(doc.get("unique")) for name, doc in info.items()}


# --------------------------------------------------------------------------- #
# État « ancien » : index historiques + documents d'avant migration
# --------------------------------------------------------------------------- #
ORDERS = [
    # Commande PUBG Mobile historique : ni game_id ni identity_key.
    {"id": "ord-legacy-pubg", "order_number": "MGS-V00001", "pubg_id": PUBG_A, "status": "paid"},
    # Commande multi-jeux avec instantané d'identité à deux champs, déjà game_id.
    {"id": "ord-legacy-ml", "order_number": "MGS-V00002", "pubg_id": ML_ID, "status": "paid",
     "game_id": ML, "identity_snapshot": {"fields": {"player_id": ML_ID, "zone_id": ML_ZONE}}},
    # Identifiant numérique à zéros initiaux : la clé est normalisée, la valeur stockée intacte.
    {"id": "ord-legacy-ff", "order_number": "MGS-V00003", "pubg_id": "000" + PUBG_C, "status": "paid",
     "game_id": FREE_FIRE, "identity_snapshot": {"fields": {"player_id": "000" + PUBG_C}}},
    # Commande DÉJÀ migrée : la migration ne doit rien y toucher.
    {"id": "ord-done", "order_number": "MGS-V00004", "pubg_id": PUBG_B, "status": "paid",
     "game_id": DEFAULT_GAME_ID, "identity_key": PUBG_B},
]

SUBSCRIPTION_LOCKS = [
    # Verrou historique : game_id et identity_key absents.
    {"pubg_id": PUBG_A, "type": "prime", "order_id": "ord-legacy-pubg",
     "expires_at": FUTURE, "created_at": NOW},
    # Verrou déjà migré.
    {"game_id": FREE_FIRE, "identity_key": PUBG_C, "pubg_id": PUBG_C, "type": "prime",
     "order_id": "ord-legacy-ff", "expires_at": FUTURE, "created_at": NOW},
]

EVO_LOCKS = [
    {"pubg_id": PUBG_A, "offer_slug": "pack-verify", "period_key": "lifetime",
     "order_id": "ord-legacy-pubg", "created_at": NOW},
    {"game_id": ML, "identity_key": f"{ML_ID}|{ML_ZONE}", "pubg_id": ML_ID,
     "offer_slug": "pack-verify", "period_key": "week:2026-W44",
     "order_id": "ord-legacy-ml", "created_at": NOW},
]


async def build_old_state(database, *, custom_evo_name: str | None = None,
                         with_documents: bool = True) -> dict:
    """Crée les index HISTORIQUES puis les documents anciens. Retourne les noms d'index réels."""
    await database.subscription_locks.create_index([("pubg_id", 1), ("type", 1)], unique=True)
    evo_kwargs = {"unique": True}
    if custom_evo_name:
        evo_kwargs["name"] = custom_evo_name
    await database.evo_locks.create_index(
        [("pubg_id", 1), ("offer_slug", 1), ("period_key", 1)], **evo_kwargs)
    if with_documents:
        await database.orders.insert_many([dict(d) for d in ORDERS])
        await database.subscription_locks.insert_many([dict(d) for d in SUBSCRIPTION_LOCKS])
        await database.evo_locks.insert_many([dict(d) for d in EVO_LOCKS])
    return {
        "subscription": await _index_keys(database.subscription_locks),
        "evo": await _index_keys(database.evo_locks),
    }


def legacy_names(before: dict) -> tuple[str, str]:
    """Noms RÉELS des deux index historiques tels que Mongo les a générés."""
    def _find(keys: dict, expected) -> str:
        for name, got in keys.items():
            if got == tuple(tuple(k) for k in expected):
                return name
        raise AssertionError(f"index historique introuvable : {expected} dans {list(keys)}")

    return (_find(before["subscription"], ik.LEGACY_SUBSCRIPTION_LOCK_KEYS),
            _find(before["evo"], ik.LEGACY_EVO_LOCK_KEYS))


def _doc(collection, doc_id: str) -> dict:
    doc = run(collection.find_one({"id": doc_id}, {"_id": 0}))
    assert doc is not None, f"document absent : {doc_id}"
    return doc


# --------------------------------------------------------------------------- #
# 1-3. Migration réelle, backfill, index, second passage, résumé sans identifiant
# --------------------------------------------------------------------------- #
def test_real_migration_backfills_documents_and_rotates_indexes(sandbox):
    before = run(build_old_state(sandbox.db))
    old_sub, old_evo = legacy_names(before)
    # Le nom par défaut généré par Mongo pour (pubg_id, type) est bien `pubg_id_1_type_1`.
    assert old_sub == "pubg_id_1_type_1", before["subscription"]
    print(f"[verify] index historiques relevés : {old_sub!r}, {old_evo!r}")

    summary = run(ik.migrate_identity_keys())
    assert summary["complete"] is True, summary
    assert summary["enabled"] is True
    assert summary["backfilled"] == {"orders": 3, "subscription_locks": 1, "evo_locks": 1}, summary
    assert set(summary["legacy_indexes_dropped"]) == {old_sub, old_evo}, summary

    # --- documents complétés, sans réécriture des valeurs existantes ---
    pubg = _doc(sandbox.db.orders, "ord-legacy-pubg")
    assert pubg["game_id"] == DEFAULT_GAME_ID and pubg["identity_key"] == PUBG_A
    assert pubg["identity_key"] == pubg["pubg_id"]          # PUBG : clé == colonne historique
    assert pubg["order_number"] == "MGS-V00001"             # aucun autre champ réécrit

    ml = _doc(sandbox.db.orders, "ord-legacy-ml")
    assert ml["identity_key"] == f"{ML_ID}|{ML_ZONE}"       # ordre déclaré des champs conservé
    assert ml["identity_snapshot"]["fields"] == {"player_id": ML_ID, "zone_id": ML_ZONE}

    ff = _doc(sandbox.db.orders, "ord-legacy-ff")
    assert ff["pubg_id"] == "000" + PUBG_C                  # valeur stockée intacte
    assert ff["identity_key"] == PUBG_C                     # clé normalisée (zéros initiaux)

    done = _doc(sandbox.db.orders, "ord-done")
    assert done["identity_key"] == PUBG_B and done["game_id"] == DEFAULT_GAME_ID

    lock = run(sandbox.db.subscription_locks.find_one({"order_id": "ord-legacy-pubg"}, {"_id": 0}))
    assert lock["game_id"] == DEFAULT_GAME_ID and lock["identity_key"] == PUBG_A
    evo_lock = run(sandbox.db.evo_locks.find_one({"order_id": "ord-legacy-pubg"}, {"_id": 0}))
    assert evo_lock["game_id"] == DEFAULT_GAME_ID and evo_lock["identity_key"] == PUBG_A

    # --- index : les nouveaux existent, les anciens ont disparu ---
    sub_keys = run(_index_keys(sandbox.db.subscription_locks))
    sub_unique = run(_index_unique(sandbox.db.subscription_locks))
    evo_keys = run(_index_keys(sandbox.db.evo_locks))
    evo_unique = run(_index_unique(sandbox.db.evo_locks))
    assert sub_keys[ik.SUBSCRIPTION_LOCK_INDEX] == tuple(tuple(k) for k in ik.SUBSCRIPTION_LOCK_KEYS)
    assert evo_keys[ik.EVO_LOCK_INDEX] == tuple(tuple(k) for k in ik.EVO_LOCK_KEYS)
    assert sub_unique[ik.SUBSCRIPTION_LOCK_INDEX] and evo_unique[ik.EVO_LOCK_INDEX]
    assert old_sub not in sub_keys and old_evo not in evo_keys
    assert (("pubg_id", 1), ("type", 1)) not in sub_keys.values()
    assert tuple(tuple(k) for k in ik.LEGACY_EVO_LOCK_KEYS) not in evo_keys.values()
    print(f"[verify] index après migration : {sorted(sub_keys)} | {sorted(evo_keys)}")

    # --- résumé : aucune identité ---
    text = json.dumps(summary, ensure_ascii=False)
    for identifier in (PUBG_A, PUBG_B, PUBG_C, ML_ID, ML_ZONE):
        assert identifier not in text, summary

    # --- second passage : rien ne change (documents ET index) ---
    docs_after_first = {name: run(_all(getattr(sandbox.db, name))) for name in ik.IDENTITY_COLLECTIONS}
    indexes_after_first = {
        "subscription": run(_index_keys(sandbox.db.subscription_locks)),
        "evo": run(_index_keys(sandbox.db.evo_locks)),
    }
    second = run(ik.migrate_identity_keys())
    assert second["complete"] is True
    assert second["backfilled"] == {"orders": 0, "subscription_locks": 0, "evo_locks": 0}, second
    assert second["legacy_indexes_dropped"] == []
    docs_after_second = {name: run(_all(getattr(sandbox.db, name))) for name in ik.IDENTITY_COLLECTIONS}
    assert docs_after_second == docs_after_first
    assert run(_index_keys(sandbox.db.subscription_locks)) == indexes_after_first["subscription"]
    assert run(_index_keys(sandbox.db.evo_locks)) == indexes_after_first["evo"]


def test_migration_matches_legacy_indexes_by_keys_not_by_assumed_name(sandbox):
    """Un index historique renommé est quand même supprimé : appariement par CLÉS."""
    before = run(build_old_state(sandbox.db, custom_evo_name="legacy_evo_custom_name"))
    assert "legacy_evo_custom_name" in before["evo"]
    old_sub, _ = legacy_names(before)

    summary = run(ik.migrate_identity_keys())

    assert "legacy_evo_custom_name" in summary["legacy_indexes_dropped"], summary
    assert "legacy_evo_custom_name" not in run(_index_keys(sandbox.db.evo_locks))
    assert old_sub not in run(_index_keys(sandbox.db.subscription_locks))


def test_cli_entrypoint_runs_the_same_migration(sandbox):
    """`python -m core.identity_keys` sur la base jetable : même migration, même résumé."""
    run(build_old_state(sandbox.db))

    env = {k: v for k, v in os.environ.items() if k not in ("IDENTITY_KEY_MIGRATION",)}
    env["MONGO_URL"] = MONGO_URL
    env["DB_NAME"] = sandbox.name
    env["PYTHONPATH"] = BACKEND_DIR
    proc = subprocess.run([sys.executable, "-m", "core.identity_keys"], cwd=BACKEND_DIR, env=env,
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
    summary = json.loads(proc.stdout)

    assert summary["complete"] is True and summary["enabled"] is True, summary
    assert summary["backfilled"] == {"orders": 3, "subscription_locks": 1, "evo_locks": 1}, summary
    assert ik.SUBSCRIPTION_LOCK_INDEX in run(_index_keys(sandbox.db.subscription_locks))
    assert ik.EVO_LOCK_INDEX in run(_index_keys(sandbox.db.evo_locks))
    # Le résumé imprimé ne contient aucune identité.
    for identifier in (PUBG_A, PUBG_B, PUBG_C, ML_ID, ML_ZONE):
        assert identifier not in proc.stdout, proc.stdout


def test_backfill_uses_one_write_command_per_batch_on_real_mongo(sandbox, monkeypatch):
    """Compteur d'allers-retours RÉEL : 1 commande `bulk_write` par lot, pas une par document."""
    total = 1_200
    run(build_old_state(sandbox.db, with_documents=False))
    run(sandbox.db.orders.insert_many([
        {"id": f"bulk-ord-{i}", "pubg_id": f"{700000000 + i}", "status": "paid",
         "identity_snapshot": {"fields": {"player_id": f"{700000000 + i}"}}}
        for i in range(total)]))

    sent: list[int] = []
    collection_cls = type(sandbox.db.orders)
    real_bulk_write = collection_cls.bulk_write

    async def counting_bulk_write(collection, operations, ordered: bool = True, **kwargs):
        # Motor crée une nouvelle instance de collection à chaque `db.orders` : on compte au
        # niveau de la classe, et seulement pour la collection `orders`.
        if collection.name == "orders":
            sent.append(len(operations))
        return await real_bulk_write(collection, operations, ordered=ordered, **kwargs)

    monkeypatch.setattr(collection_cls, "bulk_write", counting_bulk_write)
    monkeypatch.setenv(ik.IDENTITY_KEY_BACKFILL_BATCH_ENV, "500")

    summary = run(ik.migrate_identity_keys())

    assert sent == [500, 500, 200], sent                  # 3 commandes pour 1200 documents
    assert summary["backfilled"]["orders"] == total       # documents réellement modifiés
    assert summary["complete"] is True


# --------------------------------------------------------------------------- #
# 4. Unicité RÉELLE après migration
# --------------------------------------------------------------------------- #
def test_unique_indexes_really_reject_duplicates_after_migration(sandbox):
    run(build_old_state(sandbox.db, with_documents=False))
    assert run(ik.migrate_identity_keys())["complete"] is True

    base_lock = {"game_id": DEFAULT_GAME_ID, "identity_key": PUBG_A, "pubg_id": PUBG_A,
                 "type": "prime_plus", "order_id": "ord-x", "expires_at": FUTURE, "created_at": NOW}
    run(sandbox.db.subscription_locks.insert_one(dict(base_lock)))
    with pytest.raises(DuplicateKeyError):
        run(sandbox.db.subscription_locks.insert_one(dict(base_lock)))
    # Même numéro dans un AUTRE jeu : identité distincte, accepté.
    run(sandbox.db.subscription_locks.insert_one({**base_lock, "game_id": FREE_FIRE}))

    base_evo = {"game_id": ML, "identity_key": f"{ML_ID}|{ML_ZONE}", "pubg_id": ML_ID,
                "offer_slug": "pack-unicity", "period_key": "lifetime",
                "order_id": "ord-y", "created_at": NOW}
    run(sandbox.db.evo_locks.insert_one(dict(base_evo)))
    with pytest.raises(DuplicateKeyError):
        run(sandbox.db.evo_locks.insert_one(dict(base_evo)))
    # Même joueur, AUTRE zone : identité distincte, accepté.
    run(sandbox.db.evo_locks.insert_one({**base_evo, "identity_key": f"{ML_ID}|9999"}))
    # Même identité, AUTRE jeu : accepté.
    run(sandbox.db.evo_locks.insert_one({**base_evo, "game_id": FREE_FIRE}))


def _holder(order_id: str, game_id: str = DEFAULT_GAME_ID, key: str = PUBG_A,
            fields: dict | None = None) -> dict:
    """Commande minimale (titulaire du verrou) + document `orders` correspondant."""
    order = {"id": order_id, "created_at": NOW, "game_id": game_id, "identity_key": key,
             "pubg_id": key.split("|")[0],
             "identity_snapshot": {"fields": fields or {"player_id": key.split("|")[0]}}}
    run(sandbox_orders_insert(order))
    return order


def sandbox_orders_insert(order: dict):
    return orders_mod.db.orders.insert_one({"id": order["id"], "status": "paid",
                                            "order_number": f"MGS-{order['id']}"})


def test_reserve_subscription_uses_the_real_unique_index(sandbox):
    run(build_old_state(sandbox.db, with_documents=False))
    assert run(ik.migrate_identity_keys())["complete"] is True

    first = _holder("ord-sub-1")
    run(orders_mod.reserve_subscription(PUBG_A, "prime", first, 1))       # accepté

    with pytest.raises(orders_mod.HTTPException) as blocked:
        run(orders_mod.reserve_subscription(PUBG_A, "prime", _holder("ord-sub-2"), 1))
    assert blocked.value.status_code == 409

    # Même numéro dans un autre jeu : accepté (aucune collision entre jeux).
    run(orders_mod.reserve_subscription(PUBG_A, "prime",
                                        _holder("ord-sub-3", game_id=FREE_FIRE), 1))
    # Mobile Legends, autre zone : accepté.
    run(orders_mod.reserve_subscription(ML_ID, "prime",
                                        _holder("ord-sub-4", game_id=ML, key=f"{ML_ID}|{ML_ZONE}",
                                                fields={"player_id": ML_ID, "zone_id": ML_ZONE}), 1))
    # Même identité ML (même zone) : refusé.
    with pytest.raises(orders_mod.HTTPException) as blocked_ml:
        run(orders_mod.reserve_subscription(ML_ID, "prime",
                                            _holder("ord-sub-5", game_id=ML, key=f"{ML_ID}|{ML_ZONE}",
                                                    fields={"player_id": ML_ID, "zone_id": ML_ZONE}), 1))
    assert blocked_ml.value.status_code == 409


def test_reserve_evo_uses_the_real_unique_index(sandbox):
    run(build_old_state(sandbox.db, with_documents=False))
    assert run(ik.migrate_identity_keys())["complete"] is True
    product = {"slug": "pack-verify", "name": "Pack Vérif", "evo_limit": "lifetime"}

    first = _holder("ord-evo-1")
    assert run(evo_mod.reserve_evo(first, product)) == ("lifetime", None)

    with pytest.raises(evo_mod.HTTPException) as blocked:
        run(evo_mod.reserve_evo(_holder("ord-evo-2"), product))
    assert blocked.value.status_code == 409

    # Autre jeu, même numéro : accepté.
    assert run(evo_mod.reserve_evo(_holder("ord-evo-3", game_id=FREE_FIRE), product)) == ("lifetime", None)
    # Mobile Legends, autre zone : accepté, puis refusé sur la même zone.
    ml_zone_a = _holder("ord-evo-4", game_id=ML, key=f"{ML_ID}|{ML_ZONE}",
                        fields={"player_id": ML_ID, "zone_id": ML_ZONE})
    assert run(evo_mod.reserve_evo(ml_zone_a, product)) == ("lifetime", None)
    ml_zone_b = _holder("ord-evo-5", game_id=ML, key=f"{ML_ID}|9999",
                        fields={"player_id": ML_ID, "zone_id": "9999"})
    assert run(evo_mod.reserve_evo(ml_zone_b, product)) == ("lifetime", None)
    with pytest.raises(evo_mod.HTTPException) as blocked_ml:
        run(evo_mod.reserve_evo(_holder("ord-evo-6", game_id=ML, key=f"{ML_ID}|{ML_ZONE}",
                                        fields={"player_id": ML_ID, "zone_id": ML_ZONE}), product))
    assert blocked_ml.value.status_code == 409


# --------------------------------------------------------------------------- #
# 5. Échec contrôlé : doublons sous la nouvelle clé
# --------------------------------------------------------------------------- #
def test_duplicate_under_new_key_stops_migration_and_keeps_legacy_indexes(sandbox):
    before = run(build_old_state(sandbox.db))
    old_sub, old_evo = legacy_names(before)

    # Deux verrous qui violent la NOUVELLE clé, mais pas l'ancienne (pubg_id différent).
    run(sandbox.db.subscription_locks.insert_many([
        {"game_id": DEFAULT_GAME_ID, "identity_key": "777000555", "pubg_id": "777000555",
         "type": "prime", "order_id": "ord-dup-1", "expires_at": FUTURE, "created_at": NOW},
        {"game_id": DEFAULT_GAME_ID, "identity_key": "777000555", "pubg_id": "0777000555",
         "type": "prime", "order_id": "ord-dup-2", "expires_at": FUTURE, "created_at": NOW},
    ]))

    summary = run(ik.migrate_identity_keys())

    assert summary["complete"] is False
    assert summary["reason"] == "index_creation_failed", summary
    assert summary["new_indexes"] is False
    assert summary["legacy_indexes_dropped"] == []
    # Les anciens index protègent toujours ; le nouveau n'existe pas.
    assert old_sub in run(_index_keys(sandbox.db.subscription_locks))
    assert old_evo in run(_index_keys(sandbox.db.evo_locks))
    assert ik.SUBSCRIPTION_LOCK_INDEX not in run(_index_keys(sandbox.db.subscription_locks))
    assert ik.EVO_LOCK_INDEX not in run(_index_keys(sandbox.db.evo_locks))
    # Le message d'échec ne contient aucune identité.
    for identifier in ("777000555", "0777000555", PUBG_A):
        assert identifier not in json.dumps(summary, ensure_ascii=False)

    # L'application démarre quand même : `ensure_indexes()` aller-retour sans lever.
    run(db_module.ensure_indexes())
    assert old_sub in run(_index_keys(sandbox.db.subscription_locks))
    assert ik.SUBSCRIPTION_LOCK_INDEX not in run(_index_keys(sandbox.db.subscription_locks))


def test_migration_disabled_changes_nothing_and_ensure_recreates_legacy_index(sandbox, monkeypatch):
    before = run(build_old_state(sandbox.db))
    old_sub, old_evo = legacy_names(before)
    docs_before = {name: run(_all(getattr(sandbox.db, name))) for name in ik.IDENTITY_COLLECTIONS}
    indexes_before = {"subscription": run(_index_keys(sandbox.db.subscription_locks)),
                      "evo": run(_index_keys(sandbox.db.evo_locks))}

    monkeypatch.setenv(ik.IDENTITY_KEY_MIGRATION_ENV, "off")
    summary = run(ik.migrate_identity_keys())

    assert summary == {"enabled": False, "backfilled": {}, "new_indexes": False,
                       "legacy_indexes_dropped": [], "complete": False, "reason": None}, summary
    assert {name: run(_all(getattr(sandbox.db, name))) for name in ik.IDENTITY_COLLECTIONS} == docs_before
    assert run(_index_keys(sandbox.db.subscription_locks)) == indexes_before["subscription"]
    assert run(_index_keys(sandbox.db.evo_locks)) == indexes_before["evo"]

    # Index historique manquant : `ensure_lock_indexes` le recrée (jamais sans protection).
    run(sandbox.db.subscription_locks.drop_index(old_sub))
    assert old_sub not in run(_index_keys(sandbox.db.subscription_locks))
    run(ik.ensure_lock_indexes())
    keys = run(_index_keys(sandbox.db.subscription_locks))
    unique = run(_index_unique(sandbox.db.subscription_locks))
    recreated = [name for name, got in keys.items()
                 if got == tuple(tuple(k) for k in ik.LEGACY_SUBSCRIPTION_LOCK_KEYS)]
    assert recreated and unique[recreated[0]] is True, keys
    # Et toujours AUCUN nouvel index tant que la migration est désactivée.
    assert ik.SUBSCRIPTION_LOCK_INDEX not in keys


# --------------------------------------------------------------------------- #
# 8. Durée indicative sur ~10 000 documents par collection
# --------------------------------------------------------------------------- #
@pytest.mark.skipif(not os.environ.get("MGS_VERIFY_PERF"),
                    reason="mesure indicative : lancer avec MGS_VERIFY_PERF=1")
def test_migration_duration_on_ten_thousand_documents_per_collection(sandbox):
    total = 10_000
    run(sandbox.db.subscription_locks.create_index([("pubg_id", 1), ("type", 1)], unique=True))
    run(sandbox.db.evo_locks.create_index([("pubg_id", 1), ("offer_slug", 1), ("period_key", 1)],
                                          unique=True))

    def chunks(collection: str, factory):
        for start in range(0, total, 1_000):
            docs = [factory(i) for i in range(start, start + 1_000)]
            run(getattr(sandbox.db, collection).insert_many(docs))

    chunks("orders", lambda i: {"id": f"perf-ord-{i}", "pubg_id": f"9{i:08d}", "status": "paid",
                                "identity_snapshot": {"fields": {"player_id": f"9{i:08d}"}}})
    chunks("subscription_locks", lambda i: {"pubg_id": f"9{i:08d}", "type": "prime",
                                            "order_id": f"perf-ord-{i}",
                                            "expires_at": FUTURE, "created_at": NOW})
    chunks("evo_locks", lambda i: {"pubg_id": f"9{i:08d}", "offer_slug": "pack-verify",
                                   "period_key": "lifetime", "order_id": f"perf-ord-{i}",
                                   "created_at": NOW})

    started = time.perf_counter()
    summary = run(ik.migrate_identity_keys())
    elapsed = time.perf_counter() - started

    assert summary["complete"] is True, summary
    assert summary["backfilled"] == {"orders": total, "subscription_locks": total,
                                     "evo_locks": total}, summary
    print(f"[verify] migration de {total} documents x 3 collections : {elapsed:.2f} s")
