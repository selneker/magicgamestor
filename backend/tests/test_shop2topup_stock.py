"""PL-006-T02 — tests du lecteur de stock Shop2Topup.

Aucun de ces tests ne fait d'appel réseau : les pages réelles sont figées dans
`tests/fixtures/shop2topup/` (voir le README du dossier), et les appels HTTP sont
simulés par un client bouchon.

Deux fixtures sont des relevés **réels** du 2026-11-18 (PUBG Mobile, Free Fire
MENA). Elles disent ce que le fournisseur publie vraiment ; les fixtures
synthétiques couvrent les cas que la page réelle n'exerce pas.
"""
import asyncio
import sys
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import shop2topup_stock as s2t  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "shop2topup"


def run(coro):
    """Exécute une coroutine dans une boucle dédiée (aucune boucle globale partagée).

    Même motif que `test_stock_availability._run` : `asyncio.run()` efface la boucle
    courante, ce qui perturbe les autres modules d'un même worker xdist (`-n 2`).
    """
    return asyncio.new_event_loop().run_until_complete(coro)


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# Lecture des fixtures réelles
# --------------------------------------------------------------------------- #

def test_fixture_pubg_reelle():
    """La page PUBG du 18/11 publie 34 offres, dont une seule en rupture (sku 12 = 10 UC)."""
    states, unknown = s2t.parse_html(fixture("pubg-mobile.html"))

    assert len(states) == 34
    assert sum(1 for v in states.values() if v) == 33
    assert [sku for sku, v in states.items() if v is False] == ["12"]
    assert states["12"] is False
    assert states["13"] is True          # 60 UC
    assert states["19"] is True          # 12 000 + 4 200 = 16 200 UC
    assert unknown == {}


def test_fixture_free_fire_mena_reelle():
    """Une sous-page régionale est lisible de la même façon : 21 offres, toutes disponibles."""
    states, unknown = s2t.parse_html(fixture("free-fire-mena-direct-topup.html"))

    assert len(states) == 21
    assert all(v is True for v in states.values())
    assert unknown == {}


# --------------------------------------------------------------------------- #
# Ce qui conclut, et ce qui ne conclut pas
# --------------------------------------------------------------------------- #

def test_seuls_instock_et_outofstock_concluent():
    """Toute autre valeur, ou une valeur absente, ne conclut RIEN — c'est la règle 1."""
    states, unknown = s2t.parse_html(fixture("odd-availability.html"))

    assert states == {"-1": True, "-2": False, "-7": True, "-9": False}

    # SoldOut, LimitedAvailability, PreOrder, availability absente, liste contradictoire :
    # aucun de ces SKU ne doit apparaître, ni en True ni en False.
    for sku in ("-3", "-4", "-5", "-6", "-8"):
        assert sku not in states

    # La valeur est comptée pour repérer un changement de vocabulaire du fournisseur.
    assert unknown["https://schema.org/SoldOut"] == 1
    assert unknown["https://schema.org/LimitedAvailability"] == 1
    assert unknown["https://schema.org/PreOrder"] == 1
    assert unknown["<absente>"] == 1


def test_liste_d_une_seule_valeur_conclut():
    html = """<script type="application/ld+json">
    {"@type": "Product", "offers": [
      {"sku": "1", "availability": ["https://schema.org/OutOfStock"]}]}
    </script>"""
    states, _ = s2t.parse_html(html)
    assert states == {"1": False}


def test_availability_sans_prefixe_schema_est_acceptee():
    """Le vocabulaire peut arriver nu (`InStock`) : c'est la même information."""
    html = """<script type="application/ld+json">
    {"@type": "Product", "offers": [
      {"sku": "1", "availability": "InStock"},
      {"sku": "2", "availability": "OutOfStock"}]}
    </script>"""
    states, _ = s2t.parse_html(html)
    assert states == {"1": True, "2": False}


def test_sku_vide_ou_absent_est_ignore():
    html = """<script type="application/ld+json">
    {"@type": "Product", "offers": [
      {"sku": "", "availability": "https://schema.org/InStock"},
      {"sku": "   ", "availability": "https://schema.org/InStock"},
      {"availability": "https://schema.org/InStock"},
      {"sku": 42, "availability": "https://schema.org/InStock"},
      {"sku": " ok ", "availability": "https://schema.org/InStock"}]}
    </script>"""
    states, _ = s2t.parse_html(html)
    assert states == {"ok": True}


# --------------------------------------------------------------------------- #
# Robustesse de la lecture
# --------------------------------------------------------------------------- #

def test_page_sans_jsonld_ne_leve_rien_et_ne_conclut_rien():
    """Le cas A4 du plan : page anti-bot ou structure changée. Aucune exception, aucun SKU."""
    states, unknown = s2t.parse_html(fixture("no-jsonld.html"))
    assert states == {}
    assert unknown == {}


def test_bloc_json_invalide_est_ignore_et_les_suivants_sont_lus():
    """Un bloc annexe tronqué ne doit pas condamner la page entière."""
    states, _ = s2t.parse_html(fixture("odd-availability.html"))
    assert "-1" in states and "-2" in states


def test_html_quelconque_ne_leve_jamais():
    for junk in ("", "<<<>>>", "\x00\x01\x02", "<script>", "<script type='application/ld+json'>{"):
        states, unknown = s2t.parse_html(junk)
        assert states == {}
        assert unknown == {}


def test_doublon_dans_une_page_dernier_gagne_et_c_est_journalise(caplog):
    html = """<script type="application/ld+json">
    {"@type": "Product", "offers": [
      {"sku": "9", "availability": "https://schema.org/InStock"},
      {"sku": "9", "availability": "https://schema.org/OutOfStock"}]}
    </script>"""
    states, _ = s2t.parse_html(html)
    assert states == {"9": False}
    assert any("deux états contradictoires" in r.getMessage() for r in caplog.records)


# --------------------------------------------------------------------------- #
# Construction d'URL
# --------------------------------------------------------------------------- #

def test_page_url():
    assert s2t.page_url("pubg-mobile") == "https://shop2topup.com/en/shop/pubg-mobile"
    assert s2t.page_url("free-fire/mena-direct-topup") == \
        "https://shop2topup.com/en/shop/free-fire/mena-direct-topup"
    assert s2t.page_url("/pubg-mobile/") == "https://shop2topup.com/en/shop/pubg-mobile"


# --------------------------------------------------------------------------- #
# `fetch_stock` — réseau simulé
# --------------------------------------------------------------------------- #

class _Response:
    def __init__(self, text: str = "", status_code: int = 200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=httpx.Request("GET", "https://shop2topup.com/"),
                response=httpx.Response(self.status_code),
            )


class _StubClient:
    """Client httpx minimal : rend une réponse par URL, ou lève l'exception fournie."""

    def __init__(self, pages: dict[str, object]):
        self.pages = pages
        self.calls: list[tuple[str, dict]] = []
        self.closed = False

    async def get(self, url: str, headers=None):
        self.calls.append((url, dict(headers or {})))
        value = self.pages.get(url)
        if isinstance(value, Exception):
            raise value
        if value is None:
            return _Response("", status_code=404)
        return value

    async def aclose(self) -> None:
        self.closed = True


PUBG_URL = s2t.page_url("pubg-mobile")
FF_URL = s2t.page_url("free-fire/mena-direct-topup")


def test_fetch_stock_lit_les_pages_et_fusionne():
    client = _StubClient({
        PUBG_URL: _Response(fixture("pubg-mobile.html")),
        FF_URL: _Response(fixture("free-fire-mena-direct-topup.html")),
    })

    reading = run(s2t.fetch_stock(["pubg-mobile", "free-fire/mena-direct-topup"], client=client))

    assert reading.pages_ok == 2
    assert reading.pages_failed == 0
    assert len(reading.states) == 34 + 21      # les SKU des deux pages sont disjoints
    assert reading.states["12"] is False
    assert reading.conclusive is True


def test_fetch_stock_utilise_un_user_agent_identifiable():
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})
    run(s2t.fetch_stock(["pubg-mobile"], client=client))
    assert s2t.USER_AGENT == "MagicGameStore-stock/1.0"
    assert client.calls[0][1]["User-Agent"] == s2t.USER_AGENT


def test_fetch_stock_compte_une_page_en_echec_sans_propager_l_exception():
    """Une panne réseau sur une page ne doit pas faire tomber les autres."""
    client = _StubClient({
        PUBG_URL: httpx.ConnectTimeout("timeout"),
        FF_URL: _Response(fixture("free-fire-mena-direct-topup.html")),
    })

    reading = run(s2t.fetch_stock(["pubg-mobile", "free-fire/mena-direct-topup"], client=client))

    assert reading.pages_ok == 1
    assert reading.pages_failed == 1
    assert len(reading.states) == 21


def test_fetch_stock_page_sans_jsonld_compte_comme_echec():
    """Zéro SKU conclu n'est PAS un succès : sinon la panne resterait invisible."""
    client = _StubClient({PUBG_URL: _Response(fixture("no-jsonld.html"))})

    reading = run(s2t.fetch_stock(["pubg-mobile"], client=client))

    assert reading.pages_ok == 0
    assert reading.pages_failed == 1
    assert reading.states == {}
    assert reading.conclusive is False


def test_fetch_stock_http_403_compte_comme_echec():
    client = _StubClient({PUBG_URL: _Response("blocked", status_code=403)})

    reading = run(s2t.fetch_stock(["pubg-mobile"], client=client))

    assert reading.pages_ok == 0
    assert reading.pages_failed == 1


def test_fetch_stock_budget_epuise_ne_lit_rien(monkeypatch):
    """Le budget est une garde réelle : à 0 s, aucune page n'est demandée."""
    monkeypatch.setattr(s2t, "TOTAL_BUDGET_S", 0.0)
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})

    reading = run(s2t.fetch_stock(["pubg-mobile", "free-fire/mena-direct-topup"], client=client))

    assert client.calls == []
    assert reading.pages_ok == 0
    assert reading.pages_failed == 2
    assert reading.states == {}


def test_fetch_stock_liste_vide_ne_fait_aucun_appel():
    client = _StubClient({})
    reading = run(s2t.fetch_stock([], client=client))
    assert client.calls == []
    assert reading.pages_ok == 0 and reading.pages_failed == 0


def test_fetch_stock_dedoublonne_les_slugs_vides():
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})
    reading = run(s2t.fetch_stock([" pubg-mobile ", "", "   "], client=client))
    assert len(client.calls) == 1
    assert reading.pages_ok == 1


def test_fetch_stock_conflit_entre_deux_pages_dernier_gagne_et_c_est_journalise(caplog):
    """Le dernier relevé réussi gagne, mais jamais en silence."""
    page_a = """<script type="application/ld+json">
    {"@type": "Product", "offers": [{"sku": "7", "availability": "https://schema.org/InStock"}]}
    </script>"""
    page_b = """<script type="application/ld+json">
    {"@type": "Product", "offers": [{"sku": "7", "availability": "https://schema.org/OutOfStock"}]}
    </script>"""
    client = _StubClient({
        s2t.page_url("a"): _Response(page_a),
        s2t.page_url("b"): _Response(page_b),
    })

    reading = run(s2t.fetch_stock(["a", "b"], client=client))

    assert reading.states == {"7": False}
    assert any("le dernier relevé est retenu" in r.getMessage() for r in caplog.records)


# --------------------------------------------------------------------------- #
# T02c — les quatre défauts relevés en relecture
# --------------------------------------------------------------------------- #

def test_fetch_stock_dedoublonne_les_slugs_identiques():
    """`"a", "a"` ne doit pas lancer deux requêtes : un relevé est une photo, pas une liste."""
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})

    reading = run(s2t.fetch_stock(["pubg-mobile", " pubg-mobile ", "pubg-mobile"], client=client))

    assert len(client.calls) == 1
    assert reading.pages_ok == 1
    assert len(reading.states) == 34


def test_fetch_stock_ignore_un_identifiant_qui_n_est_pas_une_chaine(caplog):
    """Un `None` ou un entier ne lève pas : il est ignoré, journalisé et compté en échec."""
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})

    reading = run(s2t.fetch_stock([None, 42, "pubg-mobile"], client=client))

    assert len(client.calls) == 1
    assert reading.pages_ok == 1
    assert reading.pages_failed == 2
    assert any("page ignorée" in r.getMessage() for r in caplog.records)

    # Aucun slug exploitable : les entrées invalides restent comptées, aucune requête.
    only_invalid = run(s2t.fetch_stock([None], client=client))
    assert only_invalid.pages_failed == 1
    assert only_invalid.states == {}
    assert len(client.calls) == 1


def test_fetch_stock_sans_argument_lit_les_pages_declarees():
    """La liste par défaut est la constante du module, pas une liste vide ni une invention."""
    assert s2t.KNOWN_PAGES == ("pubg-mobile", "free-fire/mena-direct-topup")
    client = _StubClient({
        PUBG_URL: _Response(fixture("pubg-mobile.html")),
        FF_URL: _Response(fixture("free-fire-mena-direct-topup.html")),
    })

    reading = run(s2t.fetch_stock(client=client))

    assert [url for url, _ in client.calls] == [s2t.page_url(known) for known in s2t.KNOWN_PAGES]
    assert reading.pages_ok == 2
    assert reading.pages_failed == 0
    assert len(reading.states) == 34 + 21


def test_fetch_stock_ne_leve_pas_si_la_fermeture_du_client_echoue(monkeypatch):
    """Le relevé déjà effectué est renvoyé même quand `aclose()` échoue."""
    class _BrokenClose(_StubClient):
        async def aclose(self) -> None:
            raise RuntimeError("close failed")

    client = _BrokenClose({PUBG_URL: _Response(fixture("pubg-mobile.html"))})
    # Client créé par le module (donc refermé par lui) : c'est le seul chemin qui ferme.
    monkeypatch.setattr(s2t.httpx, "AsyncClient", lambda **kwargs: client)

    reading = run(s2t.fetch_stock(["pubg-mobile"]))

    assert reading.pages_ok == 1
    assert len(reading.states) == 34


# --------------------------------------------------------------------------- #
# T06 — trois entrées qui ne doivent jamais produire de requête en trop
# --------------------------------------------------------------------------- #

def test_fetch_stock_accepte_une_chaine_nue_comme_une_page():
    """`fetch_stock("pubg-mobile")` lit UNE page, jamais les caractères de la chaîne."""
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})

    reading = run(s2t.fetch_stock("pubg-mobile", client=client))

    assert [url for url, _ in client.calls] == [PUBG_URL]
    assert reading.pages_ok == 1
    assert reading.pages_failed == 0
    assert len(reading.states) == 34


def test_fetch_stock_compte_un_slug_vide_en_echec(caplog):
    """Un slug vide est un échec de lecture, jamais un « rien à lire » silencieux."""
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})

    reading = run(s2t.fetch_stock(["", "   ", "/", "pubg-mobile"], client=client))

    assert len(client.calls) == 1
    assert reading.pages_ok == 1
    assert reading.pages_failed == 3
    assert any("identifiant vide" in r.getMessage() for r in caplog.records)


def test_fetch_stock_traite_la_barre_finale_comme_la_meme_page():
    """`pubg-mobile` et `pubg-mobile/` désignent la même page : une seule requête."""
    client = _StubClient({PUBG_URL: _Response(fixture("pubg-mobile.html"))})

    reading = run(s2t.fetch_stock(["pubg-mobile", "pubg-mobile/"], client=client))

    assert len(client.calls) == 1
    assert reading.pages_ok == 1
    assert len(reading.states) == 34
