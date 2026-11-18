"""T04 — manifeste Shop2Topup et rattachement `supplier_mapping["shop2topup"]`.

Aucune base Mongo, aucun appel réseau : la collection est un fake en mémoire, comme dans
`test_stock_availability.py`. `pytest-asyncio` n'est pas une dépendance du dépôt : chaque test
asynchrone passe par `_run`.
"""
import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.shop2topup_mapping import (SHOP2TOPUP_MANIFEST,  # noqa: E402
                                     SHOP2TOPUP_MODE, parse_uc_total)
from services import shop2topup_map  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FakeProducts:
    """`find_one` par slug + `update_one` qui comprend `supplier_mapping.shop2topup`."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self.writes = 0
        self.fail_write = False

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if doc.get("slug") == query.get("slug"):
                return dict(doc)
        return None

    async def update_one(self, query, update):
        if self.fail_write:
            raise RuntimeError("écriture refusée")
        for doc in self.docs:
            if doc.get("slug") != query.get("slug"):
                continue
            for path, value in (update.get("$set") or {}).items():
                if path == "supplier_mapping.shop2topup":
                    doc.setdefault("supplier_mapping", {})["shop2topup"] = value
                else:
                    doc[path] = value
            self.writes += 1
            return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


def _product(row: dict, **extra) -> dict:
    return {"id": f"id-{row['product_slug']}", "slug": row["product_slug"],
            "game_id": row["game_id"], **extra}


def _attach(collection: FakeProducts) -> dict:
    with patch.object(shop2topup_map, "db", SimpleNamespace(products=collection)):
        return _run(shop2topup_map.attach_shop2topup_mapping())


def test_manifest_is_the_six_proposed_couples():
    assert len(SHOP2TOPUP_MANIFEST) == 6
    assert [row["sku"] for row in SHOP2TOPUP_MANIFEST] == ["13", "14", "15", "16", "17", "19"]
    assert [row["product_slug"] for row in SHOP2TOPUP_MANIFEST] == [
        "60-uc", "325-uc", "660-uc", "1800-uc", "3850-uc", "16200-uc"]
    assert {row["game_id"] for row in SHOP2TOPUP_MANIFEST} == {"pubg-mobile"}
    assert SHOP2TOPUP_MODE == "direct"


def test_manifest_totals_follow_the_reading_rule():
    for row in SHOP2TOPUP_MANIFEST:
        assert parse_uc_total(row["name_seen"]) == row["uc_total"], row["name_seen"]
    # Somme, pas premier nombre.
    assert parse_uc_total("Direct Topup — 300 + 25 UC") == 325
    # Unité obligatoire : « WOW Coins » n'est jamais un lot UC, même à total égal.
    assert parse_uc_total("Direct Topup — 60 WOW Coins") is None
    assert parse_uc_total("Direct Topup — 660 WOW Coins") is None


def test_attach_writes_only_the_shop2topup_key():
    row = SHOP2TOPUP_MANIFEST[0]
    stored_fzr = {"mode": "direct", "offer_id": "fzr-1"}
    collection = FakeProducts([_product(row, fazercards_mapping=stored_fzr,
                                        supplier_mapping={"g2bulk": {"sku": "g-1"}})])

    result = _attach(collection)

    doc = collection.docs[0]
    assert result["attached"] == 1 and result["unchanged"] == 0
    assert doc["supplier_mapping"]["shop2topup"] == {
        "sku": row["sku"], "uc_total": row["uc_total"], "mode": "direct"}
    assert doc["supplier_mapping"]["g2bulk"] == {"sku": "g-1"}  # aucune autre clé créée/écrasée
    assert doc["fazercards_mapping"] == stored_fzr  # jamais modifié


def test_attach_is_idempotent():
    collection = FakeProducts([_product(row) for row in SHOP2TOPUP_MANIFEST])

    first = _attach(collection)
    writes_after_first = collection.writes
    second = _attach(collection)

    assert first["attached"] == 6 and first["unchanged"] == 0
    assert collection.writes == writes_after_first == 6
    assert second["attached"] == 0 and second["unchanged"] == 6
    assert collection.writes == 6  # deux démarrages ⇒ aucune écriture inutile


def test_product_outside_manifest_is_never_touched():
    collection = FakeProducts([_product(row) for row in SHOP2TOPUP_MANIFEST] + [
        {"id": "id-90", "slug": "90-uc", "game_id": "pubg-mobile"}])

    _attach(collection)

    untouched = next(doc for doc in collection.docs if doc["slug"] == "90-uc")
    assert "supplier_mapping" not in untouched


def test_missing_product_is_counted_never_created():
    collection = FakeProducts([_product(row) for row in SHOP2TOPUP_MANIFEST[:2]])

    result = _attach(collection)

    assert result["attached"] == 2
    assert len(result["missing"]) == 4
    assert len(collection.docs) == 2  # A3 : aucun produit créé


def test_game_mismatch_is_skipped():
    row = SHOP2TOPUP_MANIFEST[0]
    collection = FakeProducts([_product(row, game_id="free-fire")])

    result = _attach(collection)

    assert result["mismatched"] == [row["product_slug"]]
    assert collection.writes == 0
    assert "supplier_mapping" not in collection.docs[0]


def test_write_failure_does_not_raise_and_keeps_going():
    collection = FakeProducts([_product(row) for row in SHOP2TOPUP_MANIFEST])
    collection.fail_write = True

    result = _attach(collection)  # ne lève pas

    assert result["attached"] == 0
    assert collection.writes == 0
