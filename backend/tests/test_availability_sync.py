"""PL-006-T06 — tests de la synchro disponibilité (Checkpoint A).

Aucune base Mongo, aucun appel réseau : le catalogue et le journal de santé sont de petits fakes
en mémoire, le relevé est simulé, et les deux fonctions d'écriture de `services.stock` sont des
`AsyncMock` (elles ont leurs propres tests dans `test_stock_availability.py`). C'est ce qui permet
de prouver la règle la plus importante du module : **un relevé sans conclusion n'écrit rien**.

`pytest-asyncio` n'est pas une dépendance du dépôt : chaque test asynchrone passe par `_run`.
"""
import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import availability_sync, shop2topup_stock, stock  # noqa: E402


def _run(coro):
    """Boucle dédiée (même motif que `test_stock_availability._run`)."""
    return asyncio.new_event_loop().run_until_complete(coro)


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        self._iter = iter(self.docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeProducts:
    """Ne rend que les produits réellement rattachés au fournisseur."""

    def __init__(self, docs=None):
        self.docs = [dict(doc) for doc in (docs or [])]

    def find(self, query, projection=None):
        return _Cursor([doc for doc in self.docs
                        if "shop2topup" in (doc.get("supplier_mapping") or {})])


class FakeHealth:
    def __init__(self):
        self.doc = None
        self.writes = 0

    async def find_one(self, query):
        return dict(self.doc) if self.doc else None

    async def update_one(self, query, update, upsert=False):
        self.doc = {**(self.doc or {}), **(update.get("$set") or {})}
        self.writes += 1
        return SimpleNamespace(modified_count=1)


def _product(sku: str, slug: str = "lot") -> dict:
    return {"id": f"id-{sku}", "name": f"Lot {sku}", "slug": slug,
            "supplier_mapping": {"shop2topup": {"sku": sku, "uc_total": 60, "mode": "direct"}}}


def _reading(states=None, pages_ok=1, pages_failed=0) -> shop2topup_stock.StockReading:
    return shop2topup_stock.StockReading(states=states or {}, pages_ok=pages_ok,
                                         pages_failed=pages_failed)


SIX_SKUS = ("13", "14", "15", "16", "17", "19")


def _sync(reading, products, *, health=None, out_result=True, in_result=True,
          sync_enabled=True):
    """Un passage avec tout ce qui touche l'extérieur simulé."""
    mark_out = AsyncMock(return_value=out_result)
    mark_in = AsyncMock(return_value=in_result)
    notify = AsyncMock()
    fetch = AsyncMock(return_value=reading)
    fake_db = SimpleNamespace(products=FakeProducts(products),
                              stock_sync_health=health or FakeHealth())
    with patch.object(availability_sync, "db", fake_db), \
            patch.object(availability_sync.shop2topup_stock, "fetch_stock", fetch), \
            patch.object(stock, "mark_supplier_unavailable", mark_out), \
            patch.object(stock, "mark_supplier_available", mark_in), \
            patch.object(availability_sync.notifications, "notify_admin", notify), \
            patch.object(stock, "sync_enabled", lambda: sync_enabled):
        counters = _run(availability_sync.run_once())
    return SimpleNamespace(counters=counters, mark_out=mark_out, mark_in=mark_in,
                           notify=notify, fetch=fetch, db=fake_db)


def test_les_compteurs_retournes_sont_ceux_du_plan():
    result = _sync(_reading({sku: True for sku in SIX_SKUS}),
                   [_product(sku) for sku in SIX_SKUS])

    assert set(result.counters) == {"checked", "marked_out", "marked_in", "skipped",
                                    "pages_ok", "pages_failed"}
    assert result.counters["checked"] == 6


def test_out_of_stock_marque_en_rupture_confirmee():
    """`OutOfStock` lu ⇒ rupture marquée avec la source qui n'expire jamais (T05)."""
    result = _sync(_reading({"13": False, "14": True}), [_product("13"), _product("14")])

    assert result.counters["marked_out"] == 1
    assert result.counters["marked_in"] == 1
    marked = result.mark_out.await_args
    assert marked.args[0]["sku"] == "13"
    assert marked.kwargs["source"] == stock.CONFIRMED_STOCK_SOURCE


def test_in_stock_leve_la_rupture():
    result = _sync(_reading({"13": True}), [_product("13")])

    assert result.counters["marked_in"] == 1
    assert result.mark_in.await_args.args[0]["sku"] == "13"
    assert result.counters["marked_out"] == 0


def test_sku_absent_du_releve_n_ecrit_rien():
    """Un SKU non publié n'est ni disponible ni en rupture : aucune fonction d'écriture."""
    result = _sync(_reading({"13": True, "14": False}), [_product("13"), _product("14"),
                                                         _product("19")])

    assert result.counters["skipped"] == 1
    called = [call.args[0]["sku"] for call in result.mark_out.await_args_list]
    called += [call.args[0]["sku"] for call in result.mark_in.await_args_list]
    assert "19" not in called


def test_page_illisible_et_aucun_sku_conclu_n_ecrit_rien():
    """Relevé vide (aucune page lue) : strictement aucune écriture, même sur un produit connu."""
    result = _sync(_reading({}, pages_ok=0, pages_failed=1), [_product("13")])

    result.mark_out.assert_not_awaited()
    result.mark_in.assert_not_awaited()
    assert result.counters == {"checked": 0, "marked_out": 0, "marked_in": 0, "skipped": 0,
                               "pages_ok": 0, "pages_failed": 1}


def test_releve_suspect_est_ignore():
    """Moins de la moitié des SKU attendus couverts ⇒ rien n'est appliqué."""
    result = _sync(_reading({"13": False}), [_product(sku) for sku in SIX_SKUS])

    result.mark_out.assert_not_awaited()
    result.mark_in.assert_not_awaited()
    assert result.counters["checked"] == 0


def test_moitie_des_sku_couverts_suffit():
    """Le seuil du plan est « moins de la moitié » : exactement la moitié est appliquée."""
    result = _sync(_reading({"13": False, "14": True, "15": True}),
                   [_product(sku) for sku in SIX_SKUS])

    assert result.counters["marked_out"] == 1
    assert result.counters["marked_in"] == 2
    assert result.counters["skipped"] == 3


def test_une_page_en_echec_ne_bloque_pas_les_sku_lus():
    """Les 6 SKU PUBG couverts malgré la page Free Fire en échec : ils sont appliqués."""
    result = _sync(_reading({"13": False}, pages_ok=1, pages_failed=1), [_product("13")])

    assert result.counters["pages_failed"] == 1
    assert result.counters["marked_out"] == 1


def test_sans_produit_rattache_aucune_requete():
    result = _sync(_reading({"13": False}), [])

    result.fetch.assert_not_awaited()
    result.mark_out.assert_not_awaited()


def test_produit_sans_rattachement_est_ignore():
    others = [{"id": "id-90", "name": "90 UC", "slug": "90-uc"}]
    result = _sync(_reading({"90": False}), others)

    result.fetch.assert_not_awaited()
    result.mark_out.assert_not_awaited()


def test_flag_desactive_rend_le_passage_inerte():
    """`STOCK_SYNC_ENABLED=false` : ni lecture, ni écriture, ni alerte."""
    result = _sync(_reading({"13": False}), [_product("13")], sync_enabled=False)

    result.fetch.assert_not_awaited()
    result.mark_out.assert_not_awaited()
    result.mark_in.assert_not_awaited()
    assert result.db.stock_sync_health.writes == 0


def test_deux_passages_ne_se_chevauchent_pas():
    """Un passage déjà en cours fait ignorer le suivant : une seule lecture."""
    fetch = AsyncMock(return_value=_reading({"13": False}))
    products = FakeProducts([_product("13")])

    async def scenario():
        async with availability_sync._run_lock:
            return await availability_sync.run_once()

    with patch.object(availability_sync, "db", SimpleNamespace(
            products=products, stock_sync_health=FakeHealth())), \
            patch.object(availability_sync.shop2topup_stock, "fetch_stock", fetch), \
            patch.object(stock, "sync_enabled", lambda: True):
        counters = _run(scenario())

    fetch.assert_not_awaited()
    assert counters["checked"] == 0


# --------------------------------------------------------------------------- #
# Santé du relevé : une alerte par épisode, un retour par rétablissement
# --------------------------------------------------------------------------- #

def test_trois_echecs_de_suite_alertent_une_seule_fois():
    health = FakeHealth()
    for _ in range(3):
        result = _sync(_reading({}, pages_ok=0, pages_failed=1), [_product("13")], health=health)

    assert result.notify.await_count == 1
    assert result.notify.await_args.kwargs["event"] == "stock_sync_unhealthy"
    assert health.doc["failed_streak"] == 3
    assert health.doc["alerted"] is True

    # Quatrième passage en échec : plus de répétition.
    again = _sync(_reading({}, pages_ok=0, pages_failed=1), [_product("13")], health=health)
    again.notify.assert_not_awaited()


def test_alerte_apres_deux_echecs_seulement_n_a_pas_lieu():
    health = FakeHealth()
    for _ in range(2):
        result = _sync(_reading({}, pages_ok=0, pages_failed=1), [_product("13")], health=health)

    result.notify.assert_not_awaited()
    assert health.doc["alerted"] is False


def test_retour_a_la_normale_signale_une_seule_fois():
    health = FakeHealth()
    for _ in range(3):
        _sync(_reading({}, pages_ok=0, pages_failed=1), [_product("13")], health=health)

    recovered = _sync(_reading({"13": True}, pages_ok=1), [_product("13")], health=health)

    assert recovered.notify.await_count == 1
    assert recovered.notify.await_args.kwargs["event"] == "stock_sync_recovered"
    assert health.doc["failed_streak"] == 0
    assert health.doc["alerted"] is False

    stable = _sync(_reading({"13": True}, pages_ok=1), [_product("13")], health=health)
    stable.notify.assert_not_awaited()


def test_une_alerte_ne_nomme_jamais_le_fournisseur():
    health = FakeHealth()
    for _ in range(3):
        result = _sync(_reading({}, pages_ok=0, pages_failed=1), [_product("13")], health=health)

    payload = result.notify.await_args.kwargs
    for text in (payload["title"], payload["body"]):
        assert "shop2topup" not in text.lower()
        assert "shop2topup" not in payload["url"].lower()
