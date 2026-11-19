"""PL-006-T09A-V1 — script de marge par lot, avec transport bouchonné.

Aucun appel réseau, aucune clé réelle, aucune base : `httpx.MockTransport` répond à la place du
fournisseur. On vérifie les garde-fous (blanc par défaut, `--rate` obligatoire, clé absente =
arrêt, `absent` sans exception, au plus 3 GET, clé jamais affichée) et le calcul de la marge.
"""
import asyncio
import importlib.util
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "shop2topup_margin.py"
_spec = importlib.util.spec_from_file_location("shop2topup_margin", SCRIPT_PATH)
margin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(margin)

from services.providers.shop2topup_adapter import Shop2TopupProvider  # noqa: E402


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FakeProvider:
    """Rend un catalogue fixe ; note s'il a été appelé et combien de fois."""

    def __init__(self, prices=None, error=None):
        self.prices = prices or {}
        self.error = error
        self.calls = 0

    async def get_offers(self, category_id, fresh=False):
        self.calls += 1
        if self.error:
            raise self.error
        return {"category_id": str(category_id), "name": "PUBG Mobile",
                "offers": [{"offer_id": sku, "name": f"offre {sku}", "price": price}
                           for sku, price in self.prices.items()],
                "fields": [{"key": "player_id"}]}


def lines_of(code, lines):
    return code, "\n".join(lines)


def line_for(output: str, lot: str) -> str:
    return next(line for line in output.splitlines() if line.startswith(lot))


def test_prix_mgs_relus_dans_seed():
    prices = margin.mgs_prices()

    assert {uc: prices[uc] for uc in (60, 325, 660, 1800, 3850, 16200)} == {
        60: 5000, 325: 21000, 660: 41000, 1800: 100000, 3850: 202000, 16200: 793000}
    assert prices[30] == 3000  # `core/seed.py:9` — la source est bien lue, pas recopiée


def test_essai_a_blanc_par_defaut_sans_reseau_ni_cle(monkeypatch):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)
    provider = FakeProvider()
    lines = []

    code, output = lines_of(run(margin.run(rate=Decimal(4500), provider=provider,
                                           out=lines.append)), lines)

    assert code == 0
    assert "ESSAI À BLANC" in output and "FICTIFS" in output
    assert provider.calls == 0
    for sku in ("13", "14", "15", "16", "17", "19"):
        assert f" {sku} " in output
    assert "lots en perte :" in output


def test_live_sans_cle_arrete_avant_tout_appel(monkeypatch):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)
    provider = FakeProvider({"13": "0.85"})
    lines = []

    code, output = lines_of(run(margin.run(rate=Decimal(4500), live=True, provider=provider,
                                           out=lines.append)), lines)

    assert code == 2
    assert "absente : arrêt AVANT tout appel" in output
    assert provider.calls == 0


def test_live_marge_cout_statut_et_sku_absent(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", "sentinelle-cle")
    provider = FakeProvider({"13": "0.85", "14": "4.4"})
    lines = []

    code, output = lines_of(run(margin.run(rate=Decimal(4500), live=True, provider=provider,
                                           out=lines.append)), lines)

    assert code == 0
    assert provider.calls == 1
    small = line_for(output, "60 UC")
    assert "3 825" in small and "1 175" in small and "23.5" in small and "OK" in small
    assert "5.7" in line_for(output, "325 UC")
    absent = line_for(output, "660 UC")
    assert "absent" in absent and "PERTE" not in absent and "OK" not in absent
    assert "lots en perte : 0 / 6 (4 absent(s))" in output


def test_prix_illisible_traite_comme_absent(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", "sentinelle-cle")
    lines = []

    code, output = lines_of(run(margin.run(rate=Decimal(4500), live=True,
                                           provider=FakeProvider({"13": "n/a"}),
                                           out=lines.append)), lines)

    assert code == 0
    assert "absent" in line_for(output, "60 UC")  # aucun zéro inventé


def test_frais_d_achat_augmentent_le_cout(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", "sentinelle-cle")
    lines = []

    code, output = lines_of(run(margin.run(rate=Decimal(4500), fee_pct=Decimal(10), live=True,
                                           provider=FakeProvider({"13": "0.85"}),
                                           out=lines.append)), lines)

    assert code == 0
    # 0,85 × 4 500 × 1,10 = 4 207,5 → 4 208 Ar ; marge 5 000 − 4 208 = 792 Ar (15,8 %).
    small = line_for(output, "60 UC")
    assert "4 208" in small and "792" in small and "15.8" in small


def test_live_au_plus_trois_get_et_cle_jamais_affichee(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", "sentinelle-cle")
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.headers.get("authorization")))
        if request.url.path.endswith("/catalog/subcategories"):
            return httpx.Response(200, json={"success": True, "data": [
                {"item_id": 13, "name": "60 UC", "price": "0.85"}]})
        return httpx.Response(200, json={"success": True, "data": [
            {"field_name": "player_id", "data_type": "text", "placeholder": "Enter player ID"}]})

    provider = Shop2TopupProvider(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    lines = []

    code, output = lines_of(run(margin.run(rate=Decimal(4500), live=True, provider=provider,
                                           out=lines.append)), lines)

    assert code == 0
    assert len(seen) <= margin.GET_MAX
    assert {method for method, _path, _auth in seen} == {"GET"}
    assert any(path.endswith("/catalog/subcategories") for _m, path, _a in seen)
    assert all(auth == "Bearer sentinelle-cle" for _m, _p, auth in seen)
    assert "sentinelle-cle" not in output
    assert "SHOP2TOPUP_API_KEY=***" in output


def test_rate_obligatoire_et_taux_positif(monkeypatch, capsys):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)

    with pytest.raises(SystemExit):
        margin.main([])

    assert margin.main(["--rate", "0"]) == 2
    assert "taux invalide" in capsys.readouterr().out
