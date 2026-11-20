"""T09 — bascule contrôlée du catalogue : aucun Mongo réel, aucun réseau.

La collection `products` est un faux en mémoire construit à partir de `core.seed.build_products()`
(14 lots UC + 8 Prime) et des 4 packs évolutifs que `seed_products` insère séparément, avec le
`supplier_mapping` des 6 lots du manifeste tel que le pose T04. Les prix, la visibilité (`active`)
et le badge sont comparés avant/après.
"""
import asyncio
import copy
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import games  # noqa: E402
from core.seed import EVO_PACKS, build_products  # noqa: E402
from core.shop2topup_mapping import SHOP2TOPUP_MANIFEST  # noqa: E402
from services import shop2topup_cutover as cutover  # noqa: E402
from services import telegram  # noqa: E402
from services.shop2topup_map import mapping_value  # noqa: E402

NOW = datetime(2026, 11, 19, 15, 0, tzinfo=timezone.utc)
ORDER = {"id": "order-1", "status": "paid", "items": [{"slug": "60-uc", "unit_price": 5000}]}


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, length=None):
        return copy.deepcopy(self.docs)

    def __aiter__(self):
        self._iter = iter(copy.deepcopy(self.docs))
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    """Égalité simple sur les champs du filtre ; `$set`/`$unset` à plat."""

    def __init__(self, docs=None):
        self.docs = copy.deepcopy(list(docs or []))
        self.writes = []
        self.queries = []  # parallèle à `writes` : le filtre de chaque mise à jour
        self.finds = 0

    @staticmethod
    def _match(doc, query):
        return all(doc.get(key) == value for key, value in (query or {}).items())

    def find(self, query=None, projection=None):
        self.finds += 1
        return FakeCursor([dict(d) for d in self.docs if self._match(d, query)])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if self._match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def update_one(self, query, update, upsert=False):
        self.writes.append(copy.deepcopy(update))
        self.queries.append(copy.deepcopy(query))
        target = next((d for d in self.docs if self._match(d, query)), None)
        if target is None:
            if not upsert:
                return SimpleNamespace(matched_count=0, modified_count=0)
            target = {"key": (query or {}).get("key")}
            self.docs.append(target)
        for path, value in (update.get("$set") or {}).items():
            target[path] = copy.deepcopy(value)
        for path in (update.get("$unset") or {}):
            target.pop(path, None)
        return SimpleNamespace(matched_count=1, modified_count=1)


def _products():
    """État réel attendu après T04 : 14 lots UC (6 mappés), 8 Prime et 4 packs évolutifs."""
    docs = build_products()
    # `core/seed.py:99-105` : les packs évolutifs sont insérés par `seed_products`, pas par
    # `build_products`. Ils n'ont pas de `requires_mapping` et sont actifs.
    for i, (slug, name, name_en, desc_fr, desc_en, price, limit) in enumerate(EVO_PACKS):
        docs.append({
            "id": f"evo-{i}", "slug": slug, "type": "evo", "name": name, "name_en": name_en,
            "uc_amount": None, "duration_months": None, "price": price, "old_price": None,
            "popular": False, "badge": None, "evo_limit": limit,
            "description_fr": desc_fr, "description_en": desc_en,
            "active": True, "sort_order": 200 + i, "game_id": "pubg-mobile",
        })
    manifest = {row["product_slug"]: row for row in SHOP2TOPUP_MANIFEST}
    for doc in docs:
        row = manifest.get(doc["slug"])
        if row:
            doc["supplier_mapping"] = {"shop2topup": mapping_value(row)}
        if doc["slug"] == "prime-1m":
            doc["fazercards_mapping"] = {"category_id": "12", "offer_id": "999"}  # orphelin FazerCards
    return docs


def _by_slug(collection):
    return {doc["slug"]: doc for doc in collection.docs}


def _call(mode_value, products=None, settings=None, moment=NOW, env=None):
    fake_db = SimpleNamespace(products=FakeCollection(products if products is not None else _products()),
                              settings=FakeCollection(settings),
                              orders=FakeCollection([ORDER]))
    notify = AsyncMock()

    async def go():
        with patch.object(cutover, "db", fake_db), \
                patch.object(cutover.notifications, "notify_admin", notify):
            return await cutover.run(mode_value, moment)

    if env is None:
        os.environ.pop(cutover.MODE_ENV, None)
    else:
        os.environ[cutover.MODE_ENV] = env
    try:
        counters = _run(go())
    finally:
        os.environ.pop(cutover.MODE_ENV, None)
    return SimpleNamespace(counters=counters, db=fake_db, notify=notify)


def _events(result):
    return [call.kwargs["event"] for call in result.notify.await_args_list]


def _report_of(result):
    """Le rapport publié dans `settings.cutover_report` (le doc `cutover` peut le précéder)."""
    return next(doc["report"] for doc in result.db.settings.docs
                if doc.get("key") == "cutover_report")


def _writes_by_slug(result, products):
    """Champs `$set` de chaque écriture produit, indexés par slug."""
    by_id = {doc.get("id"): doc.get("slug") for doc in products}
    return {by_id.get(query.get("id")): update.get("$set", {})
            for query, update in zip(result.db.products.queries, result.db.products.writes)}


# --------------------------------------------------------------------------- #
# Valeurs de la variable
# --------------------------------------------------------------------------- #
def test_absente_ou_off_ne_lit_meme_pas_la_base():
    absent = _call(None)
    off = _call(None, env="OFF")

    assert absent.counters == off.counters == {"cutover": "off"}
    assert absent.db.products.finds == 0 and absent.db.products.writes == []
    assert absent.db.settings.writes == [] and off.db.products.writes == []


def test_valeur_inconnue_ne_fait_rien():
    result = _call(None, env="basculer")

    assert result.counters == {"cutover": "unknown"}
    assert result.db.products.writes == [] and result.notify.await_args_list == []


# --------------------------------------------------------------------------- #
# dry-run
# --------------------------------------------------------------------------- #
def test_dry_run_ecrit_le_rapport_et_aucun_produit():
    result = _call("dry-run")

    assert result.counters == {"cutover": "dry-run"}
    assert result.db.products.writes == []
    report = result.db.settings.docs[0]
    assert report["key"] == "cutover_report" and report["report"]["mode"] == "dry-run"
    assert report["report"]["ok"] is True
    assert len(report["report"]["lots"]) == 14
    assert result.notify.await_args_list == []


def test_le_rapport_liste_les_orphelins_avec_leur_fournisseur():
    report = _call("dry-run").db.settings.docs[0]["report"]
    orphans = {row["slug"]: row for row in report["orphans"]}

    assert "prime-1m" in orphans and orphans["prime-1m"]["supplier"] == "fazercards"
    assert orphans["prime-3m"]["supplier"] == "aucun"
    assert all(row.get("uc") is None for row in report["orphans"])


# --------------------------------------------------------------------------- #
# apply
# --------------------------------------------------------------------------- #
def test_apply_modifie_exactement_les_lots_prevoirs_et_rien_d_autre():
    before = _products()
    result = _call("apply", products=before)
    docs = _by_slug(result.db.products)
    was = {doc["slug"]: doc for doc in before}

    assert result.counters == {"cutover": "applied"}
    prices = {"60-uc": 5000, "325-uc": 22000, "660-uc": 44000,
              "1800-uc": 109000, "3850-uc": 217000, "16200-uc": 871000}
    for slug, price in prices.items():
        assert docs[slug]["price"] == price
    for slug in ("60-uc", "325-uc", "660-uc", "1800-uc", "3850-uc", "16200-uc"):
        assert docs[slug]["active"] is True
        assert docs[slug]["old_price"] == was[slug]["old_price"]  # prix barré conservé
    for uc in (30, 90, 120, 180, 415, 720, 985, 1320):
        assert docs[f"{uc}-uc"]["active"] is False
    for uc in (30, 1320):
        assert docs[f"{uc}-uc"]["popular"] is False and docs[f"{uc}-uc"]["badge"] is None
    for uc in (325, 660):
        assert docs[f"{uc}-uc"]["popular"] is True and docs[f"{uc}-uc"]["badge"] == "popular"
    assert docs["60-uc"] == was["60-uc"]  # ni prix, ni badge : aucune écriture
    assert not any(write.get("$set", {}).get("price") == 5000
                   for write in result.db.products.writes)

    state = result.db.settings.docs[0]
    assert state["key"] == "cutover" and state["applied_at"] == NOW.isoformat()
    assert len(state["snapshot"]) == 26  # 14 lots UC + 12 produits hors lots UC
    assert _events(result) == ["catalogue_cutover_applied"]


def test_apply_refuse_si_les_lots_sans_mapping_ne_sont_pas_les_huit():
    extra = _products() + [{"id": "x", "slug": "10-uc", "uc_amount": 10, "type": "uc",
                            "game_id": "pubg-mobile", "active": True, "price": 1200,
                            "popular": False, "badge": None}]
    result = _call("apply", products=extra)

    assert result.counters == {"cutover": "blocked"}
    assert result.db.products.writes == []
    assert result.notify.await_args_list == []
    report = result.db.settings.docs[0]["report"]
    assert report["ok"] is False and report["writes"] == []
    assert any("10" in error for error in report["errors"])


def test_apply_refuse_si_un_lot_du_manifeste_n_est_pas_mappe():
    products = _products()
    for doc in products:
        if doc["slug"] == "660-uc":
            doc.pop("supplier_mapping", None)
    result = _call("apply", products=products)

    assert result.counters == {"cutover": "blocked"} and result.db.products.writes == []


def test_apply_rejoue_est_refuse():
    first = _call("apply")
    writes = len(first.db.products.writes)
    second = _call("apply", products=first.db.products.docs,
                   settings=first.db.settings.docs)

    assert second.counters == {"cutover": "already_applied"}
    assert len(second.db.products.writes) == 0 and writes > 0


# --------------------------------------------------------------------------- #
# Produits hors lots UC (T04B) : masqués, jamais repricés
# --------------------------------------------------------------------------- #
def test_apply_masque_les_douze_produits_hors_lots_uc_sans_toucher_au_reste():
    before = _products()
    result = _call("apply", products=before)
    docs = _by_slug(result.db.products)
    was = {doc["slug"]: doc for doc in before}

    assert len(cutover.ORPHAN_SLUGS) == 12
    for slug in cutover.ORPHAN_SLUGS:
        assert docs[slug]["active"] is False
        assert docs[slug]["price"] == was[slug]["price"]
        assert docs[slug]["popular"] == was[slug]["popular"]
        assert docs[slug]["badge"] == was[slug]["badge"]
        assert docs[slug]["old_price"] == was[slug]["old_price"]
        assert docs[slug]["name"] == was[slug]["name"]

    writes = _writes_by_slug(result, before)
    hidden = {slug: fields for slug, fields in writes.items() if slug in cutover.ORPHAN_SLUGS}
    assert len(hidden) == 12
    assert all(fields == {"active": False} for fields in hidden.values())


def test_produit_hors_lot_absent_ou_deja_inactif_n_est_pas_une_erreur():
    products = [doc for doc in _products() if doc["slug"] != "evo-fragments-mythique"]
    for doc in products:
        if doc["slug"] == "prime-6m":
            doc["active"] = False

    result = _call("apply", products=products)
    report = _report_of(result)
    rows = {row["slug"]: row for row in report["products"]}

    assert result.counters == {"cutover": "applied"}
    assert report["ok"] is True and report["errors"] == []
    assert rows["evo-fragments-mythique"]["note"] == "absent de la base"
    assert rows["prime-6m"]["note"] == "déjà masqué"
    assert not {"prime-6m", "evo-fragments-mythique"} & set(_writes_by_slug(result, products))


def test_produit_actif_inconnu_bloque_apply_sans_ecriture():
    extra = {"id": "x", "slug": "royal-pass-a19", "type": "pass", "game_id": "pubg-mobile",
             "uc_amount": None, "active": True, "price": 12000, "popular": False, "badge": None}
    result = _call("apply", products=_products() + [extra])
    report = _report_of(result)

    assert result.counters == {"cutover": "blocked"}
    assert result.db.products.writes == [] and result.notify.await_args_list == []
    assert report["mode"] == "apply-blocked" and report["writes"] == []
    assert any("royal-pass-a19" in error for error in report["errors"])
    assert "royal-pass-a19" in {row["slug"] for row in report["products"]}


def test_pack_evo_inactif_avec_requires_mapping_n_est_pas_touche():
    inactive = {"id": "new-1", "slug": "evo-weekly-deal-1", "type": "evo",
                "game_id": "pubg-mobile", "uc_amount": None, "active": False,
                "requires_mapping": True, "price": 5900, "popular": False, "badge": None}
    products = _products() + [inactive]
    result = _call("apply", products=products)

    assert result.counters == {"cutover": "applied"}
    assert "evo-weekly-deal-1" not in _writes_by_slug(result, products)
    assert _by_slug(result.db.products)["evo-weekly-deal-1"] == inactive


def test_free_fire_et_les_autres_jeux_ne_sont_jamais_touches():
    other = {"id": "ff-1", "slug": "free-fire-prime-1m", "type": "prime",
             "game_id": "free-fire", "uc_amount": None, "active": True, "price": 9000,
             "popular": False, "badge": None}
    products = _products() + [other]
    result = _call("apply", products=products)
    table = _report_of(result)["products"]

    assert result.counters == {"cutover": "applied"}
    assert _by_slug(result.db.products)["free-fire-prime-1m"] == other
    assert "free-fire-prime-1m" not in _writes_by_slug(result, products)
    assert "free-fire-prime-1m" not in {row["slug"] for row in table}


def test_dry_run_publie_le_tableau_complet_sans_rien_ecrire():
    result = _call("dry-run")
    report = _report_of(result)
    rows = {row["slug"]: row for row in report["products"]}

    assert result.db.products.writes == []
    assert len(report["products"]) == 26
    assert rows["325-uc"]["action"] == "prix"
    assert rows["325-uc"]["price_before"] == 21000 and rows["325-uc"]["price_after"] == 22000
    assert rows["660-uc"]["action"] == "prix"
    assert rows["30-uc"]["action"] == "masqué, badge"
    assert rows["1320-uc"]["action"] == "masqué, badge"
    assert rows["90-uc"]["action"] == "masqué"
    assert rows["prime-1m"]["action"] == "masqué"
    assert rows["prime-1m"]["active_before"] is True and rows["prime-1m"]["active_after"] is False
    assert rows["60-uc"]["action"] == "inchangé"
    assert rows["60-uc"]["price_after"] == 5000


# --------------------------------------------------------------------------- #
# rollback et robustesse
# --------------------------------------------------------------------------- #
def test_rollback_restaure_a_l_identique_puis_autorise_un_nouvel_apply():
    before = _products()
    applied = _call("apply", products=copy.deepcopy(before))
    rolled = _call("rollback", products=applied.db.products.docs,
                   settings=applied.db.settings.docs)

    assert rolled.counters == {"cutover": "rolled_back", "restored": 26}
    assert rolled.db.products.docs == before
    state = rolled.db.settings.docs[0]
    assert "snapshot" not in state and state["rolled_back_at"] == NOW.isoformat()
    assert _events(rolled) == ["catalogue_cutover_rolled_back"]

    again = _call("apply", products=rolled.db.products.docs, settings=rolled.db.settings.docs)
    assert again.counters == {"cutover": "applied"}


def test_rollback_sans_snapshot_ne_fait_rien():
    result = _call("rollback")

    assert result.counters == {"cutover": "nothing_to_roll_back"}
    assert result.db.products.writes == [] and result.notify.await_args_list == []


def test_erreur_base_ne_leve_pas():
    class Broken(FakeCollection):
        def find(self, query=None, projection=None):
            raise RuntimeError("base absente")

    fake_db = SimpleNamespace(products=Broken(_products()), settings=FakeCollection(),
                              orders=FakeCollection([ORDER]))
    notify = AsyncMock()

    async def go():
        with patch.object(cutover, "db", fake_db), \
                patch.object(cutover.notifications, "notify_admin", notify):
            return await cutover.run("apply", NOW)

    assert _run(go()) == {"cutover": "error"}
    assert notify.await_args_list == []


def test_apply_interrompu_remet_les_lots_deja_ecrits_a_l_etat_d_avant():
    before = _products()

    class Interrupted(FakeCollection):
        def __init__(self, docs):
            super().__init__(docs)
            self.product_updates = 0

        async def update_one(self, query, update, upsert=False):
            if "id" in (query or {}):
                self.product_updates += 1
                if self.product_updates == 4:
                    raise RuntimeError("connexion perdue")
            return await super().update_one(query, update, upsert)

    products = Interrupted(before)
    fake_db = SimpleNamespace(products=products, settings=FakeCollection(),
                              orders=FakeCollection([ORDER]))
    notify = AsyncMock()

    async def go():
        with patch.object(cutover, "db", fake_db), \
                patch.object(cutover.notifications, "notify_admin", notify):
            return await cutover.run("apply", NOW)

    assert _run(go()) == {"cutover": "error"}
    assert _by_slug(products) == {doc["slug"]: doc for doc in before}
    state = fake_db.settings.docs[0]
    assert "applied_at" not in state and state["snapshot"]
    assert notify.await_args_list == []


def test_les_commandes_deja_creees_ne_sont_pas_touchees():
    result = _call("apply")

    assert result.db.orders.docs == [ORDER] and result.db.orders.writes == []


def test_les_six_lots_mappes_restent_vendables_apres_apply():
    result = _call("apply")
    fake_db = result.db
    with patch.object(games, "db", fake_db):
        assert _run(games.game_has_sellable_catalog("pubg-mobile")) is True


def test_les_evenements_de_bascule_sont_actives_sur_telegram():
    assert {"catalogue_cutover_applied", "catalogue_cutover_rolled_back"} <= telegram.DEFAULT_EVENTS
