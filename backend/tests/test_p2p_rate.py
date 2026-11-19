"""PL-006-T09C-V1 — filtres du carnet P2P.Army, stockage et alertes, sans réseau ni Mongo réels.

La forme des réponses simulées vient de la documentation officielle
(`https://p2p.army/en/p2p-api/docs`, § « P2P Ads (Standard) ») : `{"status": 1, "ads": [{"price",
"min_fiat", "max_fiat", "payment_methods", "user_id", "adv_id", "user_rate", "user_orders", …}]}`.
`httpx.MockTransport` répond, `db.settings` est un petit faux en mémoire, `notify_admin` est un
`AsyncMock` : rien ne sort de la machine.
"""
import asyncio
import copy
import itertools
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import p2p_rate_dump  # noqa: E402
from services import notifications, p2p_rate, telegram  # noqa: E402

KEY = "sentinelle-p2p-000"
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)
_SEQ = itertools.count(1)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FakeSettings:
    """Applique les `$set` à chemins pointés, comme le document `store` réel."""

    def __init__(self, doc=None):
        self.doc = copy.deepcopy(dict(doc or {}))
        self.writes = []
        self.projections = []

    async def find_one(self, query, projection=None):
        self.projections.append(projection)
        return dict(self.doc) if self.doc else None

    async def update_one(self, query, update, upsert=False):
        self.writes.append(update.get("$set") or {})
        for path, value in (update.get("$set") or {}).items():
            node = self.doc
            parts = path.split(".")
            for part in parts[:-1]:
                node = node.setdefault(part, {})
            node[parts[-1]] = value
        return SimpleNamespace(modified_count=1)


class FakeProvider:
    """Catalogue Shop2Topup fixe (prix revendeur par SKU)."""

    def __init__(self, prices=None):
        self.prices = prices or {}
        self.calls = 0

    async def get_offers(self, category_id, fresh=False):
        self.calls += 1
        return {"category_id": str(category_id), "name": "PUBG Mobile",
                "offers": [{"offer_id": sku, "name": f"offre {sku}", "price": price}
                           for sku, price in self.prices.items()], "fields": []}


def _ad(price, *, user=None, name=None, adv=None, method="mvola", low="100000",
        high="500000", rate=100, orders=200):
    """Une annonce conforme au schéma `P2PAd` ; vendeur et annonce uniques par défaut."""
    number = next(_SEQ)
    return {"side": "BUY", "price": str(price), "min_fiat": low, "max_fiat": high,
            "payment_methods": [method], "user_id": user or f"u{number}",
            "user_name": name or f"n{number}", "adv_id": adv or f"a{number}",
            "user_rate": rate, "user_orders": orders, "is_merchant": 1, "text": ""}


def _handler(ads=None, status=200):
    calls = []

    def handler(request):
        calls.append(request)
        if status >= 400:
            return httpx.Response(status, json={"status": 0})
        return httpx.Response(200, json={"status": 1, "ads": ads or []})

    return handler, calls


def _saved(minutes_ago=120, rate=4500, **extra):
    return {"rate": rate,
            "fetched_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
            "source": "p2p_army:binance:BUY:mvola+orange", "n_ads": 6,
            "market": "binance", "side": "BUY", **extra}


def _sync(ads=None, status=200, saved=None, now=NOW, provider=None, key=KEY):
    handler, calls = _handler(ads, status)
    fake = FakeSettings({"key": "store", "p2p_rate": saved} if saved is not None else {})
    notify = AsyncMock()

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch.object(p2p_rate, "db", SimpleNamespace(settings=fake)), \
                    patch.object(p2p_rate.notifications, "notify_admin", notify):
                return await p2p_rate.sync_rate(now=now, client=client, provider=provider)

    if key is None:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    else:
        os.environ[p2p_rate.KEY_ENV] = key
    try:
        counters = _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    return SimpleNamespace(counters=counters, calls=calls, notify=notify, settings=fake)


def _events(result) -> list[str]:
    return [call.kwargs["event"] for call in result.notify.await_args_list]


def _reasons(ads) -> list:
    return [reason for _ad_row, _price, reason in p2p_rate.screen(ads)]


# --------------------------------------------------------------------------- #
# Filtres du carnet
# --------------------------------------------------------------------------- #
def test_filtre_methode_par_defaut_puis_surcharge(monkeypatch):
    ads = [_ad("4000", method="mvola"), _ad("4100", method="orange_money"),
           _ad("4200", method="airtel_money"), _ad("4300", method="bank")]

    assert _reasons(ads) == [None, None, "method", "method"]

    monkeypatch.setenv(p2p_rate.METHODS_ENV, "airtel")
    assert _reasons(ads) == ["method", "method", None, "method"]


def test_capacite_ecarte_les_annonces_trop_petites_ou_trop_grandes(monkeypatch):
    from decimal import Decimal
    assert p2p_rate.ref_amount() == Decimal("100000")  # dépôts habituels 10–45 $
    assert _reasons([_ad("4000")]) == [None]
    assert _reasons([_ad("4000", high="90000")]) == ["capacity"]
    assert _reasons([_ad("4000", low="150000")]) == ["capacity"]

    monkeypatch.setenv(p2p_rate.REF_ENV, "50000")
    assert _reasons([_ad("4000")]) == ["capacity"]
    assert _reasons([_ad("4000", low="40000", high="60000")]) == [None]


def test_qualite_exige_taux_et_nombre_d_ordres():
    assert _reasons([_ad("4000", rate=80)]) == ["quality"]
    assert _reasons([_ad("4000", orders=20)]) == ["quality"]
    assert _reasons([_ad("4000", rate=None)]) == ["quality"]
    assert _reasons([_ad("4000", rate=90, orders=50)]) == [None]


def test_seuils_de_qualite_reglables_et_valeur_illisible_au_defaut(monkeypatch):
    ads = [_ad("4000", rate=95, orders=60)]
    assert _reasons(ads) == [None]

    monkeypatch.setenv(p2p_rate.COMPLETION_ENV, "96")
    assert _reasons(ads) == ["quality"]
    monkeypatch.setenv(p2p_rate.COMPLETION_ENV, "90")

    monkeypatch.setenv(p2p_rate.ORDERS_ENV, "61")
    assert _reasons(ads) == ["quality"]
    monkeypatch.setenv(p2p_rate.ORDERS_ENV, "beaucoup")
    assert _reasons(ads) == [None]


def test_une_annonce_par_vendeur_la_moins_chere_gardee():
    ads = [_ad("4000", user="meme"), _ad("3900", user="meme"),
           _ad("4100"), _ad("4200")]
    rows = p2p_rate.screen(ads)

    assert [reason for _ad_row, _price, reason in rows] == ["duplicate", None, None, None]
    assert [price for _ad_row, price, reason in rows if reason is None] == [3900, 4100, 4200]


def test_prix_illisible_compte_a_part():
    ads = [_ad("4000"), {"price": "n/a", "min_fiat": "1", "max_fiat": "9",
                         "payment_methods": ["mvola"], "user_id": "x"},
           {"min_fiat": "1", "max_fiat": "9", "payment_methods": ["mvola"], "user_id": "y"}]
    assert _reasons(ads) == [None, "price", "price"]


def test_compteurs_par_raison_et_restriction_toujours_a_zero():
    rows = p2p_rate.screen([_ad("4000"), _ad("4100", method="bank"),
                            _ad("4200", high="1000"), _ad("4300", rate=10),
                            _ad("4400", user="meme"), _ad("4500", user="meme")])
    tally = p2p_rate.counts(rows)

    assert set(tally) == {"method", "capacity", "restricted", "quality", "duplicate", "price"}
    assert tally["method"] == 1 and tally["capacity"] == 1 and tally["quality"] == 1
    assert tally["duplicate"] == 1 and tally["restricted"] == 0 and tally["price"] == 0


# --------------------------------------------------------------------------- #
# Relevé P2P.Army
# --------------------------------------------------------------------------- #
def test_releve_lit_le_carnet_buy_et_la_mediane_des_cinq_meilleures():
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, calls = _handler([_ad("4000"), _ad("4100"), _ad("4200"),
                               _ad("4300"), _ad("4400"), _ad("4500")])
    try:
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await p2p_rate.fetch_rate(client=client)
        info = _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    request = calls[0]
    assert request.method == "POST"
    assert request.url.path == "/v1/api/get_p2p_order_book"
    assert request.headers["X-APIKEY"] == KEY
    body = request.read().decode()
    assert '"side":"BUY"' in body and '"market":"binance"' in body
    assert '"fiat":"MGA"' in body and '"asset":"USDT"' in body and '"limit":15' in body
    assert info["side"] == "BUY" and info["rate"] == 4200.0 and info["n_ads"] == 6
    assert info["source"].endswith("BUY:mvola+orange")
    assert info["n_rejected"]["method"] == 0


def test_methode_inutilisable_ecartee_sans_repli_sur_toutes_les_methodes():
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, _calls = _handler([_ad("4000"), _ad("4100"),
                                _ad("4200", method="bank"), _ad("4300", method="bank")])
    try:
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await p2p_rate.fetch_rate(client=client)
        with pytest.raises(p2p_rate.RateRefused) as raised:
            _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    assert raised.value.reason == "not_enough_ads"


def test_moins_de_trois_annonces_releve_refuse():
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, _calls = _handler([_ad("4000"), _ad("4100")])
    try:
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await p2p_rate.fetch_rate(client=client)
        with pytest.raises(p2p_rate.RateRefused) as raised:
            _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    assert raised.value.reason == "not_enough_ads"


@pytest.mark.parametrize("value", ["900", "21000"])
def test_taux_hors_plage_refuse(value):
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, _calls = _handler([_ad(value), _ad(value), _ad(value)])
    try:
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await p2p_rate.fetch_rate(client=client)
        with pytest.raises(p2p_rate.RateRefused) as raised:
            _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    assert raised.value.reason == "out_of_range"


def test_cle_absente_aucune_requete():
    os.environ.pop(p2p_rate.KEY_ENV, None)
    handler, calls = _handler([_ad("4000")])
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await p2p_rate.fetch_rate(client=client)
    with pytest.raises(p2p_rate.RateRefused) as raised:
        _run(go())
    assert raised.value.reason == "api_key_missing"
    assert calls == []


# --------------------------------------------------------------------------- #
# Diagnostic
# --------------------------------------------------------------------------- #
def test_diagnostic_montre_le_motif_et_tronque_les_identites():
    ads = [_ad("4000", adv="abcdefghij", user="VendeurLong", name="VendeurLong"),
           _ad("4100", method="bank", adv="zzzzzz", user="Autre", name="Autre")]
    shown = p2p_rate_dump.lines(ads)

    assert "retenue" in shown[0] and "method" in shown[1]
    assert "abcdef" in shown[0] and "abcdefghij" not in shown[0]
    assert "Ven" in shown[0] and "VendeurLong" not in shown[0]
    assert "price" in p2p_rate_dump.key_names(ads)
    assert "4000" not in p2p_rate_dump.key_names(ads)


# --------------------------------------------------------------------------- #
# Synchro dans la maintenance
# --------------------------------------------------------------------------- #
def test_sans_cle_le_passage_est_inerte():
    result = _sync(saved=_saved(), key=None)

    assert result.counters == {"p2p_rate": "disabled"}
    assert result.calls == [] and result.notify.await_args_list == []


def test_taux_de_moins_de_30_minutes_aucun_appel():
    result = _sync(saved=_saved(minutes_ago=10), ads=[_ad("4000")])

    assert result.counters == {"p2p_rate": "fresh"}
    assert result.calls == []


def test_releve_reussi_stocke_sans_toucher_binance():
    settings_doc = {"key": "store", "binance": {"rate_ar_per_usdt": 4500},
                    "p2p_rate": _saved(minutes_ago=31, stale_alerted=True)}
    handler, calls = _handler([_ad("4200"), _ad("4200"), _ad("4200")])
    fake = FakeSettings(settings_doc)
    notify = AsyncMock()
    os.environ[p2p_rate.KEY_ENV] = KEY

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch.object(p2p_rate, "db", SimpleNamespace(settings=fake)), \
                    patch.object(p2p_rate.notifications, "notify_admin", notify):
                return await p2p_rate.sync_rate(now=NOW, client=client,
                                               provider=FakeProvider({"13": "0.5"}))
    try:
        counters = _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)

    assert counters == {"p2p_rate": "fetched"} and len(calls) == 1
    assert fake.doc["p2p_rate"]["rate"] == 4200.0
    assert fake.doc["p2p_rate"]["fetched_at"] == NOW.isoformat()
    assert fake.doc["p2p_rate"]["n_ads"] == 3
    assert fake.doc["p2p_rate"]["n_rejected"]["restricted"] == 0
    assert fake.doc["binance"] == {"rate_ar_per_usdt": 4500}
    assert all("binance" not in (projection or {}) for projection in fake.projections)
    assert all(set(write) <= {f"p2p_rate.{field}" for field in
                              ("rate", "fetched_at", "source", "n_ads", "n_rejected",
                               "market", "side", "last_attempt_at", "stale_alerted",
                               "margin_alerted")}
               for write in fake.writes)
    assert _events(SimpleNamespace(notify=notify)) == ["p2p_rate_recovered"]


def test_ecart_de_plus_de_15_pourcent_refuse_et_ancien_taux_conserve():
    result = _sync(ads=[_ad("5500"), _ad("5500"), _ad("5500")],
                   saved=_saved(minutes_ago=40))

    assert result.counters == {"p2p_rate": "refused"}
    assert result.settings.doc["p2p_rate"]["rate"] == 4500
    assert result.notify.await_args_list == []


def test_taux_perime_alerte_une_fois_puis_retour_a_la_normale():
    first = _sync(status=500, saved=_saved(minutes_ago=120))
    second = _sync(status=500, saved=first.settings.doc["p2p_rate"],
                   now=NOW + timedelta(minutes=31))
    third = _sync(ads=[_ad("4600"), _ad("4600"), _ad("4600")],
                  saved=second.settings.doc["p2p_rate"], now=NOW + timedelta(minutes=62),
                  provider=FakeProvider({}))

    assert first.counters == {"p2p_rate": "error"}
    assert _events(first) == ["p2p_rate_stale"]
    assert second.settings.doc["p2p_rate"]["stale_alerted"] is True
    assert _events(second) == []  # un seul envoi par épisode
    assert third.counters == {"p2p_rate": "fetched"}
    assert third.settings.doc["p2p_rate"]["stale_alerted"] is False
    assert _events(third) == ["p2p_rate_recovered"]


def test_marge_sous_le_seuil_alertee_une_fois_par_lot_et_par_episode():
    ads = [_ad("4500"), _ad("4500"), _ad("4500")]
    loss = FakeProvider({"16": "23.5"})
    safe = FakeProvider({"16": "20"})
    saved = _saved(minutes_ago=120)

    first = _sync(ads=ads, saved=saved, provider=loss)
    again = _sync(ads=ads, saved=first.settings.doc["p2p_rate"],
                  now=NOW + timedelta(minutes=31), provider=loss)
    recovered = _sync(ads=ads, saved=again.settings.doc["p2p_rate"],
                      now=NOW + timedelta(minutes=62), provider=safe)
    second_episode = _sync(ads=ads, saved=recovered.settings.doc["p2p_rate"],
                           now=NOW + timedelta(minutes=93), provider=loss)

    assert _events(first) == ["margin_below_threshold"]
    assert "1800 UC" in first.notify.await_args.kwargs["body"]
    assert first.settings.doc["p2p_rate"]["margin_alerted"] == ["16"]
    assert _events(again) == []
    assert recovered.settings.doc["p2p_rate"]["margin_alerted"] == []
    assert _events(second_episode) == ["margin_below_threshold"]


def test_base_illisible_ne_leve_pas():
    class Broken:
        async def find_one(self, query, projection=None):
            raise RuntimeError("base absente")

    os.environ[p2p_rate.KEY_ENV] = KEY
    notify = AsyncMock()
    try:
        with patch.object(p2p_rate, "db", SimpleNamespace(settings=Broken())), \
                patch.object(p2p_rate.notifications, "notify_admin", notify):
            counters = _run(p2p_rate.sync_rate(now=NOW))
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)

    assert counters == {"p2p_rate": "store_error"}


def test_les_trois_evenements_sont_actives_sur_telegram():
    assert {"p2p_rate_stale", "p2p_rate_recovered",
            "margin_below_threshold"} <= telegram.DEFAULT_EVENTS
    assert notifications.telegram is telegram
