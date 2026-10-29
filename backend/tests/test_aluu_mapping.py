"""Lot 4 — `services.aluu_mapping` : appariement exact, aperçu lecture seule, apply explicite.

Tests PURS : aucune base Mongo, aucun réseau. La collection `products` est remplacée par un
double en mémoire et `core.audit` par un enregistreur.
"""
import asyncio

import pytest

from services import aluu_mapping

GAME = "mobile-legends"
CODE = "mlbb"


def run(coro):
    return asyncio.run(coro)


class FakeCursor:
    def __init__(self, documents):
        self._documents = documents

    async def to_list(self, _limit):
        return list(self._documents)


def _matches(document: dict, query: dict) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(document, part) for part in expected):
                return False
            continue
        value = document.get(key)
        if isinstance(expected, dict):
            if "$gt" in expected and not (value is not None and value > expected["$gt"]):
                return False
            if "$nin" in expected and value in expected["$nin"]:
                return False
            continue
        if value != expected:
            return False
    return True


class FakeProducts:
    """Double minimal de `db.products` : `find(...).to_list()` et `update_one($set)`."""

    def __init__(self, documents):
        self.documents = [dict(item) for item in documents]
        self.queries = []
        self.updates = []

    def find(self, query, projection=None):
        self.queries.append(query)
        return FakeCursor([doc for doc in self.documents if _matches(doc, query)])

    async def update_one(self, selector, update):
        self.updates.append((selector, update))
        for doc in self.documents:
            if doc.get("id") == selector.get("id"):
                doc.update(update.get("$set") or {})
        return None


@pytest.fixture
def audit_calls(monkeypatch):
    calls = []

    async def fake_audit(action, actor, target=None, meta=None):
        calls.append({"action": action, "actor": actor, "target": target, "meta": meta})

    monkeypatch.setattr(aluu_mapping, "audit", fake_audit)
    return calls


PRODUCTS = [
    {"id": "p-60", "slug": "mlbb-60", "name": "60 Diamants", "uc_amount": 60, "price": 5000,
     "requires_mapping": True, "game_id": GAME},
    {"id": "p-86", "slug": "mlbb-86", "name": "86 Diamants", "uc_amount": 86, "price": 7000,
     "requires_mapping": True, "game_id": GAME},
    {"id": "p-prime", "slug": "mlbb-prime", "name": "Prime", "uc_amount": None, "price": 9000,
     "requires_mapping": True, "game_id": GAME},
]

PACKS = [
    {"offer_id": "60", "name": "60 Diamonds", "price_usd": 0.83},
    {"offer_id": "66", "name": "60 Diamonds + 6 Bonus", "price_usd": 0.9},
    {"offer_id": "86", "name": "86 Diamonds", "price_usd": 1.2},
]


# --------------------------------------------------------------------------- quantité d'un pack

@pytest.mark.parametrize("offer,expected", [
    ({"offer_id": "66", "name": "60 UC + 6 UC Bonus"}, (66, "denom")),
    ({"offer_id": "86", "name": "86 Diamonds"}, (86, "denom")),
    ({"offer_id": "pack-a", "name": "86 Diamonds"}, (86, "name")),
    ({"offer_id": "pack-a", "name": "86 Diamonds + 6 Bonus"}, (None, None)),
    ({"offer_id": "pack-a", "name": "500+50 Diamonds"}, (None, None)),
    ({"offer_id": "pack-a", "name": "1 000 Diamonds"}, (None, None)),
    ({"offer_id": "pack-a", "name": "MP40 Bundle"}, (None, None)),
    ({"offer_id": "", "name": ""}, (None, None)),
    ({"offer_id": "0", "name": "Gratuit"}, (None, None)),
])
def test_amount_of_only_reads_a_denom_or_one_autonomous_number(offer, expected):
    assert aluu_mapping.amount_of(offer) == expected


# --------------------------------------------------------------------------- appariement

def test_match_products_pairs_exact_quantity_and_exposes_matched_by():
    result = aluu_mapping.match_products(PRODUCTS, PACKS, CODE)

    by_id = {item["product_id"]: item for item in result["items"]}
    assert by_id["p-60"]["match"] == aluu_mapping.EXACT
    assert by_id["p-60"]["denom"] == "60"
    assert by_id["p-60"]["matched_by"] == "denom"
    assert by_id["p-86"]["matched_by"] == "denom"
    assert result["summary"] == {"exact": 2, "ambiguous": 0, "missing": 0, "already_linked": 0}


def test_match_products_falls_back_to_the_name_and_says_so():
    packs = [{"offer_id": "pack-a", "name": "86 Diamonds", "price_usd": 1.2}]

    item = aluu_mapping.match_products(PRODUCTS, packs, CODE)["items"][1]

    assert item["product_id"] == "p-86"
    assert item["matched_by"] == "name"
    assert item["denom"] == "pack-a"


def test_two_packs_with_the_same_quantity_are_ambiguous_and_never_exact():
    packs = [{"offer_id": "86", "name": "86 Diamonds", "price_usd": 1.2},
             {"offer_id": "86", "name": "86 Diamonds Promo", "price_usd": 1.1}]

    result = aluu_mapping.match_products(PRODUCTS, packs, CODE)
    item = [i for i in result["items"] if i["product_id"] == "p-86"][0]

    assert item["match"] == aluu_mapping.AMBIGUOUS
    assert item["denom"] is None
    assert set(item["candidates"]) == {"86"}
    assert result["summary"]["ambiguous"] == 1


def test_two_name_matches_for_the_same_quantity_are_ambiguous():
    packs = [{"offer_id": "pack-a", "name": "86 Diamonds", "price_usd": 1.2},
             {"offer_id": "pack-b", "name": "86 Diamonds Promo", "price_usd": 1.1}]

    item = [i for i in aluu_mapping.match_products(PRODUCTS, packs, CODE)["items"]
            if i["product_id"] == "p-86"][0]

    assert item["match"] == aluu_mapping.AMBIGUOUS
    assert set(item["candidates"]) == {"pack-a", "pack-b"}


def test_a_numeric_denom_wins_over_a_name_match_for_the_same_quantity():
    packs = [{"offer_id": "86", "name": "Pack A", "price_usd": 1.2},
             {"offer_id": "promo", "name": "86 Diamonds", "price_usd": 1.1}]

    item = [i for i in aluu_mapping.match_products(PRODUCTS, packs, CODE)["items"]
            if i["product_id"] == "p-86"][0]

    assert item["match"] == aluu_mapping.EXACT
    assert item["denom"] == "86"
    assert item["matched_by"] == "denom"


def test_products_without_quantity_are_not_appariable():
    """Prime / pack évolutif : aucune quantité, donc aucun appariement exact possible."""
    result = aluu_mapping.match_products(PRODUCTS, PACKS, CODE)

    assert "p-prime" not in {item["product_id"] for item in result["items"]}


def test_missing_pack_is_reported_with_a_reason():
    result = aluu_mapping.match_products(PRODUCTS, PACKS[:1], CODE)
    item = [i for i in result["items"] if i["product_id"] == "p-86"][0]

    assert item["match"] == aluu_mapping.MISSING
    assert "86" in item["reason"]
    assert result["unmatched"] == [{"product_id": "p-86", "name": "86 Diamants", "uc_amount": 86,
                                    "match": "missing", "reason": item["reason"]}]


# --------------------------------------------------------------------------- aperçu

def test_preview_reads_only_and_never_writes():
    products = FakeProducts(PRODUCTS)

    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))

    assert products.updates == []
    assert doc["game_id"] == GAME
    assert doc["aluu_game_code"] == CODE
    assert doc["summary"]["exact"] == 2


def test_preview_filters_out_prime_and_evo_products():
    products = FakeProducts(PRODUCTS + [
        {"id": "p-evo", "slug": "mlbb-evo", "name": "Pack évolutif", "uc_amount": 720,
         "price": 50000, "requires_mapping": True, "game_id": GAME, "type": "evo"}])

    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))

    assert "p-evo" not in {item["product_id"] for item in doc["items"]}


def test_preview_scopes_the_query_to_the_game():
    products = FakeProducts(PRODUCTS)

    run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))

    assert products.queries[0]["game_id"] == GAME


# --------------------------------------------------------------------------- apply

def test_apply_writes_only_the_selected_ids_and_never_fazercards_mapping(audit_calls):
    products = FakeProducts(PRODUCTS)
    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))

    result = run(aluu_mapping.apply(doc, ["p-60"], actor="admin:1", collection=products))

    assert result["written_count"] == 1
    written = [u for u in products.updates if u[0] == {"id": "p-60"}]
    assert len(written) == 1
    assert set(written[0][1]) == {"$set"}
    mapping = written[0][1]["$set"]["aluu_mapping"]
    assert mapping == {"game_code": CODE, "denom": "60", "offer_name": "60 Diamonds",
                      "price_usd_at_link": 0.83, "confirmed": True, "source": "admin_apply",
                      "linked_at": mapping["linked_at"], "linked_by": "admin:1"}
    assert "fazercards_mapping" not in str(products.updates)
    assert [c["action"] for c in audit_calls] == ["aluu.mapping_applied"]
    assert audit_calls[0]["target"] == "p-60"


def test_apply_without_selection_writes_nothing(audit_calls):
    products = FakeProducts(PRODUCTS)
    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))

    result = run(aluu_mapping.apply(doc, [], collection=products))

    assert products.updates == []
    assert audit_calls == []
    assert result == {"written": [], "unchanged": [], "skipped": [],
                      "written_count": 0, "unchanged_count": 0, "skipped_count": 0}


def test_apply_refuses_an_ambiguous_or_missing_match(audit_calls):
    products = FakeProducts(PRODUCTS)
    packs = [{"offer_id": "pack-a", "name": "86 Diamonds", "price_usd": 1.2},
             {"offer_id": "pack-b", "name": "86 Diamonds Promo", "price_usd": 1.1}]
    doc = run(aluu_mapping.preview(GAME, CODE, packs, collection=products))

    result = run(aluu_mapping.apply(doc, ["p-86"], collection=products))

    assert result["written_count"] == 0
    assert result["skipped_count"] == 1
    assert "plusieurs packs" in result["skipped"][0]["reason"]
    assert products.updates == []
    assert audit_calls == []


def test_apply_skips_an_id_outside_the_preview(audit_calls):
    products = FakeProducts(PRODUCTS)
    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))

    result = run(aluu_mapping.apply(doc, ["inconnu"], collection=products))

    assert result["skipped"] == [{"product_id": "inconnu", "reason": "produit hors aperçu"}]
    assert products.updates == []


def test_apply_is_idempotent_for_an_already_linked_product(audit_calls):
    products = FakeProducts(PRODUCTS)
    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))
    run(aluu_mapping.apply(doc, ["p-60"], collection=products))
    audit_calls.clear()

    fresh = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))
    result = run(aluu_mapping.apply(fresh, ["p-60"], collection=products))

    assert result["written_count"] == 0
    assert result["unchanged_count"] == 1
    assert len(products.updates) == 1        # une seule écriture, la première
    assert audit_calls == []


def test_apply_relinks_a_product_mapped_to_another_pack(audit_calls):
    products = FakeProducts([{**PRODUCTS[0],
                              "aluu_mapping": {"game_code": CODE, "denom": "66", "confirmed": True}}])
    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))
    assert doc["items"][0]["current"] == "relink"

    result = run(aluu_mapping.apply(doc, ["p-60"], collection=products))

    assert result["written_count"] == 1
    assert products.documents[0]["aluu_mapping"]["denom"] == "60"


def test_apply_without_game_code_writes_nothing(audit_calls):
    products = FakeProducts(PRODUCTS)
    doc = run(aluu_mapping.preview(GAME, CODE, PACKS, collection=products))
    doc["aluu_game_code"] = ""

    result = run(aluu_mapping.apply(doc, ["p-60"], collection=products))

    assert result["skipped_count"] == 1
    assert products.updates == []


# --------------------------------------------------------------------------- mapping utilisable

@pytest.mark.parametrize("mapping,valid", [
    ({"game_code": CODE, "denom": "60", "confirmed": True}, True),
    ({"game_code": CODE, "denom": "60"}, True),
    ({"game_code": CODE, "denom": "60", "confirmed": False}, False),
    ({"game_code": "", "denom": "60"}, False),
    ({"game_code": CODE}, False),
    (None, False),
])
def test_mapping_ok_aluu(mapping, valid):
    assert aluu_mapping.mapping_ok_aluu(mapping) is valid


@pytest.mark.parametrize("mapping,state", [
    (None, "missing"),
    ({"game_code": CODE, "denom": "60", "confirmed": True}, "ok"),
    ({"game_code": CODE, "denom": "60"}, "ok"),
    ({"game_code": CODE, "denom": "66", "confirmed": True}, "relink"),
    ({"game_code": "other", "denom": "60", "confirmed": True}, "relink"),
    ({"game_code": CODE, "denom": "60", "confirmed": False}, "relink"),
])
def test_current_state(mapping, state):
    assert aluu_mapping.current_state(mapping, CODE, "60") == state
