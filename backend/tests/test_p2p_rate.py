"""PL-006-T09B-V1 — taux P2P.Army, stockage et alertes de marge, sans réseau ni Mongo réels.

La forme des réponses simulées vient de la documentation officielle
(`https://p2p.army/en/p2p-api/docs`, § « P2P Prices ») : `{"status": 1, "prices": [{"payment_method",
"prices_BUY": [...], "prices_SELL": [...]}]}`. `httpx.MockTransport` répond, `db.settings` est un
petit faux en mémoire, `notify_admin` est un `AsyncMock` : rien ne sort de la machine.
"""
import asyncio
import copy
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import notifications, p2p_rate, telegram  # noqa: E402

KEY = "sentinelle-p2p-000"
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)


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


def _entry(method, *prices):
    return {"payment_method": method, "prices_BUY": list(prices), "prices_SELL": []}


def _handler(rows=None, status=200):
    calls = []

    def handler(request):
        calls.append(request)
        if status >= 400:
            return httpx.Response(status, json={"status": 0})
        return httpx.Response(200, json={"status": 1, "prices": rows or []})

    return handler, calls


def _saved(minutes_ago=120, rate=4500, **extra):
    return {"rate": rate,
            "fetched_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
            "source": "p2p_army:binance:BUY:all", "n_ads": 6,
            "market": "binance", "side": "BUY", **extra}


def _sync(rows=None, status=200, saved=None, now=NOW, provider=None, key=KEY):
    handler, calls = _handler(rows, status)
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


# --------------------------------------------------------------------------- #
# Relevé P2P.Army
# --------------------------------------------------------------------------- #
def test_releve_utilise_la_section_buy_et_la_mediane_des_cinq_meilleures():
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, calls = _handler([
        _entry("mvola", "4100", "4000", "4200", "4300", "4400", "4500"),
        _entry("orange_money"), _entry("airtel_money")])
    try:
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await p2p_rate.fetch_rate(client=client)
        info = _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    request = calls[0]
    assert request.method == "POST"
    assert request.url.path == "/v1/api/get_p2p_prices"
    assert request.headers["X-APIKEY"] == KEY
    body = request.read().decode()
    assert '"market":"binance"' in body and '"fiat":"MGA"' in body
    assert '"asset":"USDT"' in body
    assert info["side"] == "BUY" and info["rate"] == 4200.0 and info["n_ads"] == 6
    assert info["source"].endswith("BUY:mvola+orange+airtel")


def test_filtre_operateur_insuffisant_retombe_sur_toutes_les_methodes():
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, _calls = _handler([_entry("mvola", "4000"),
                                _entry("bank", "4100", "4200", "4300")])
    try:
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await p2p_rate.fetch_rate(client=client)
        info = _run(go())
    finally:
        os.environ.pop(p2p_rate.KEY_ENV, None)
    assert info["n_ads"] == 4 and info["source"].endswith(":all")


def test_moins_de_trois_annonces_releve_refuse():
    os.environ[p2p_rate.KEY_ENV] = KEY
    handler, _calls = _handler([_entry("mvola", "4000", "4100")])
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
    handler, _calls = _handler([_entry("mvola", value, value, value)])
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
    handler, calls = _handler([_entry("mvola", "4000", "4100", "4200")])
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await p2p_rate.fetch_rate(client=client)
    with pytest.raises(p2p_rate.RateRefused) as raised:
        _run(go())
    assert raised.value.reason == "api_key_missing"
    assert calls == []


# --------------------------------------------------------------------------- #
# Synchro dans la maintenance
# --------------------------------------------------------------------------- #
def test_sans_cle_le_passage_est_inerte():
    result = _sync(saved=_saved(), key=None)

    assert result.counters == {"p2p_rate": "disabled"}
    assert result.calls == [] and result.notify.await_args_list == []


def test_taux_de_moins_de_30_minutes_aucun_appel():
    result = _sync(saved=_saved(minutes_ago=10), rows=[_entry("mvola", "4000")])

    assert result.counters == {"p2p_rate": "fresh"}
    assert result.calls == []


def test_releve_reussi_stocke_sans_toucher_binance():
    settings_doc = {"key": "store", "binance": {"rate_ar_per_usdt": 4500},
                    "p2p_rate": _saved(minutes_ago=31, stale_alerted=True)}
    handler, calls = _handler([_entry("mvola", "4200", "4200", "4200")])
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
    assert fake.doc["binance"] == {"rate_ar_per_usdt": 4500}
    assert all("binance" not in (projection or {}) for projection in fake.projections)
    assert all(set(write) <= {f"p2p_rate.{field}" for field in
                              ("rate", "fetched_at", "source", "n_ads", "market", "side",
                               "last_attempt_at", "stale_alerted", "margin_alerted")}
               for write in fake.writes)
    assert _events(SimpleNamespace(notify=notify)) == ["p2p_rate_recovered"]


def test_ecart_de_plus_de_15_pourcent_refuse_et_ancien_taux_conserve():
    result = _sync(rows=[_entry("mvola", "5500", "5500", "5500")], saved=_saved(minutes_ago=40))

    assert result.counters == {"p2p_rate": "refused"}
    assert result.settings.doc["p2p_rate"]["rate"] == 4500
    assert result.notify.await_args_list == []


def test_taux_perime_alerte_une_fois_puis_retour_a_la_normale():
    first = _sync(status=500, saved=_saved(minutes_ago=120))
    second = _sync(status=500, saved=first.settings.doc["p2p_rate"],
                   now=NOW + timedelta(minutes=31))
    third = _sync(rows=[_entry("mvola", "4600", "4600", "4600")],
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
    raw = [{"payment_method": "mvola", "prices_BUY": ["4500", "4500", "4500"],
            "prices_SELL": []}]
    loss = FakeProvider({"16": "23.5"})
    safe = FakeProvider({"16": "20"})
    saved = _saved(minutes_ago=120)

    first = _sync(rows=raw, saved=saved, provider=loss)
    again = _sync(rows=raw, saved=first.settings.doc["p2p_rate"],
                  now=NOW + timedelta(minutes=31), provider=loss)
    recovered = _sync(rows=raw, saved=again.settings.doc["p2p_rate"],
                      now=NOW + timedelta(minutes=62), provider=safe)
    second_episode = _sync(rows=raw, saved=recovered.settings.doc["p2p_rate"],
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
