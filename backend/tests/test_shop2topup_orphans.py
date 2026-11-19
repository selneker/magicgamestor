"""PL-006-T04B-V1 — rapprochement des produits PUBG hors lots UC, sans réseau ni base.

La fixture est la page publique du 18/11/2026. Aucun appel fournisseur : `--live` reçoit un
transport bouchonné (`FakeProvider`). On vérifie le rapprochement par nom et durée, les
certitudes, les offres sans produit MGS, et les garde-fous de l'essai à blanc.
"""
import asyncio
import importlib.util
from decimal import Decimal
from pathlib import Path



SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "shop2topup_orphans.py"
_spec = importlib.util.spec_from_file_location("shop2topup_orphans", SCRIPT_PATH)
orphans = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(orphans)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FakeProvider:
    """Rend un catalogue fixe ; note s'il a été appelé et combien de fois."""

    def __init__(self, prices=None):
        self.prices = prices or {}
        self.calls = 0

    async def get_offers(self, category_id, fresh=False):
        self.calls += 1
        return {"category_id": str(category_id), "name": "PUBG Mobile",
                "offers": [{"offer_id": sku, "name": f"offre {sku}", "price": price}
                           for sku, price in self.prices.items()],
                "fields": [{"key": "player_id"}]}


def _rows():
    return orphans.build_rows(orphans.scoped_offers(orphans.fixture_offers()))


def _row(rows, product):
    return next(row for row in rows if row["product"] == product)


# --------------------------------------------------------------------------- #
# Lecture des sources
# --------------------------------------------------------------------------- #
def test_fixture_lue_avec_skus_noms_et_prix_publics():
    offers = {offer["sku"]: offer for offer in orphans.fixture_offers()}

    assert len(offers) == 34  # 11 lots UC + 17 offres hors UC + 6 WOW Coins
    assert offers["18820"]["name"] == "Direct Topup — Prime (1 Month)"
    assert offers["18820"]["price_usd"] == "0.92"
    assert offers["18828"]["name"].endswith("Upgradable Firearm Materials Pack")
    assert offers["18831"]["price_usd"] == "2.77"


def test_douze_produits_mgs_relus_dans_seed():
    products = orphans.mgs_products()

    assert len(products) == 12
    prices = {product["slug"]: product["mgs"] for product in products}
    assert prices == {
        "prime-1m": 6000, "prime-3m": 17000, "prime-6m": 28000, "prime-12m": 50000,
        "prime-plus-1m": 41000, "prime-plus-3m": 188000, "prime-plus-6m": 229000,
        "prime-plus-12m": 448000, "evo-fragments-materiaux": 17000,
        "evo-premier-achat": 5800, "evo-embleme-mythique": 20500,
        "evo-fragments-mythique": 24000,
    }


def test_scope_ecarte_les_lots_uc_et_les_wow_coins():
    skus = {offer["sku"] for offer in orphans.scoped_offers(orphans.fixture_offers())}

    assert "12" not in skus and "22" not in skus  # lots UC que MGS ne vend pas
    assert "32637" not in skus  # 60 WOW Coins : autre monnaie, hors périmètre
    assert {"18815", "18820", "18831"} <= skus


# --------------------------------------------------------------------------- #
# Rapprochement
# --------------------------------------------------------------------------- #
def test_abonnements_rapproches_par_nom_et_duree():
    rows = _rows()

    assert _row(rows, "Prime 1 mois")["skus"] == ["18820"]
    assert _row(rows, "Prime 12 mois")["skus"] == ["18821"]
    assert _row(rows, "Prime+ 1 mois")["skus"] == ["18824"]
    assert _row(rows, "Prime+ 12 mois")["skus"] == ["18825"]
    assert all(row["certainty"] == orphans.CERTAIN for row in rows[:8])


def test_l_ordre_des_offres_ne_change_pas_le_resultat():
    offers = orphans.fixture_offers()
    forward = orphans.build_rows(orphans.scoped_offers(offers))
    backward = orphans.build_rows(orphans.scoped_offers(list(reversed(offers))))

    assert forward == backward


def test_pack_evolutif_jamais_certain_et_sans_equivalent_signale():
    rows = _rows()

    fragments = _row(rows, "Fragments matériaux")
    assert fragments["skus"] == ["18828"] and fragments["certainty"] == orphans.TO_VALIDATE
    assert "contenu" in fragments["note"]

    premier = _row(rows, "Premier achat")
    assert premier["skus"] == ["18818"] and premier["certainty"] == orphans.TO_VALIDATE

    embleme = _row(rows, "Emblème mythique")
    assert set(embleme["skus"]) == {"18819", "18831"}
    assert embleme["certainty"] == orphans.TO_VALIDATE and "2 candidats" in embleme["note"]

    mythique = _row(rows, "Fragments mythique")
    assert mythique["skus"] == [] and mythique["certainty"] == orphans.NO_MATCH


def test_offres_sans_produit_mgs():
    offers = orphans.fixture_offers()
    rows = orphans.build_rows(orphans.scoped_offers(offers))
    found = {offer["sku"] for offer in orphans.orphan_offers(orphans.scoped_offers(offers), rows)}

    assert found == {"18815", "18816", "18817", "18829", "18830"}


# --------------------------------------------------------------------------- #
# Garde-fous d'exécution
# --------------------------------------------------------------------------- #
def test_essai_a_blanc_par_defaut_sans_reseau_ni_cle(monkeypatch):
    monkeypatch.delenv(orphans.KEY_ENV, raising=False)
    provider = FakeProvider({"18820": "0.92"})
    lines = []
    code = run(orphans.run(provider=provider, out=lines.append))
    output = "\n".join(lines)

    assert code == 0
    assert "ESSAI À BLANC" in output and "prix PUBLICS" in output
    assert "aucun appel fournisseur" in output
    assert provider.calls == 0
    assert "certaine" in output and "sans équivalent" in output
    assert "produits MGS : 12" in output


def test_live_sans_rate_refuse_avant_tout_appel(monkeypatch):
    monkeypatch.setenv(orphans.KEY_ENV, "s2t_dummy_for_tests")
    provider = FakeProvider()
    lines = []
    code = run(orphans.run(live=True, rate=None, provider=provider, out=lines.append))

    assert code == 2
    assert "--live exige --rate" in "\n".join(lines)
    assert provider.calls == 0


def test_live_sans_cle_arrete_avant_tout_appel(monkeypatch):
    monkeypatch.delenv(orphans.KEY_ENV, raising=False)
    provider = FakeProvider()
    lines = []
    code = run(orphans.run(live=True, rate=Decimal(4500), provider=provider, out=lines.append))

    assert code == 2
    assert "absente : arrêt AVANT tout appel" in "\n".join(lines)
    assert provider.calls == 0


def test_live_calcule_la_marge_au_taux_et_reste_sous_trois_get(monkeypatch):
    monkeypatch.setenv(orphans.KEY_ENV, "s2t_dummy_for_tests")
    provider = FakeProvider({"18820": "0.92"})
    lines = []
    code = run(orphans.run(live=True, rate=Decimal(4500), provider=provider, out=lines.append))
    output = "\n".join(lines)

    assert code == 0
    assert provider.calls == 1  # un seul appel de catalogue (2 GET internes, plafond 3)
    assert "RELEVÉ RÉEL" in output
    assert "1 860" in output  # 6 000 − (0,92 × 4 500) = 1 860 Ar
    assert "31.0" in output  # marge % du prix MGS


def test_fixture_illisible_ne_leve_pas():
    lines = []
    code = run(orphans.run(fixture="/tmp/opencode/absent-orphans.html", out=lines.append))

    assert code == 2
    assert "fixture illisible" in "\n".join(lines)


def test_aucun_produit_ni_mapping_ecrit_par_le_script():
    """Le script ne référence aucune écriture : ni `db.`, ni `update_`, ni `insert_`."""
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    for forbidden in ("db.products", "db.settings", "update_one", "insert_one", "delete_one",
                      "supplier_mapping.", "$set"):
        assert forbidden not in source, forbidden
