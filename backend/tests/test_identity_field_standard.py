"""PL-003-BE-11 — norme des champs d'identité : texte de 1 à 60 caractères, pour tous les jeux.

Décision de Selneker (2026-10-31) : les champs d'identité (ID joueur, zone/serveur) sont des
champs TEXTE de 1 à 60 caractères, sans motif imposé. Un jeu peut déclarer plus strict (motif,
longueurs) ; il ne peut jamais dépasser ce plafond, à l'écriture (400) comme à la lecture (60).

Couvert ici :

- la valeur par défaut et le plafond (fonctions pures) ;
- les deux routes de validation (historique PUBG + générique) : un ID alphanumérique et un ID de
  60 caractères passent, 61 caractères sont refusés SANS appel fournisseur ;
- les ID numériques existants (9 à 13 chiffres) : mêmes verdicts et MÊME `identity_key` ;
- les clés d'ID alphanumériques (§D), y compris la conséquence de la casse ;
- le script de mise à la norme des documents `games` (§C), sur une collection simulée ;
- Neferbyte (§E) : valeur alphanumérique fail-closed et URL correctement encodée.

Aucun réseau réel, aucun Mongo réel : base et fournisseurs simulés, identifiants fictifs.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from core import identity_keys as ik
from core.games import (DEFAULT_IDENTITY_FIELDS, IDENTITY_FIELD_MAX_LENGTH, check_identity_payload,
                        identity_spec, normalize_identity_fields)
from scripts import set_identity_field_standard as standard
from services import neferbyte, neferbyte_guard
from services.providers.neferbyte_adapter import NeferbyteProvider
from test_identity_route_branching import (  # noqa: F401  (fixtures partagées)
    FakeProvider, PUBG, PUBG_GAME, make_client, rate_limit, run)

STANDARD = IDENTITY_FIELD_MAX_LENGTH
ALPHANUMERIC = "1112223bb45"


def legacy_identity_key(fields: dict | None) -> str:
    """ANCIENNE règle (avant BE-11) : normalisation puis jointure, aucune autre borne."""
    values = [ik.normalize_identity_value(v) for v in (fields or {}).values() if str(v or "").strip()]
    return "|".join(values)


# --------------------------------------------------------------------------- #
# A. Norme par défaut et plafond
# --------------------------------------------------------------------------- #
def test_la_valeur_par_defaut_est_un_texte_de_1_a_60_sans_motif():
    spec = DEFAULT_IDENTITY_FIELDS[PUBG]
    assert len(spec) == 1
    field = spec[0]
    assert (field["key"], field["pattern"], field["min_length"], field["max_length"]) == (
        "player_id", None, 1, STANDARD)


def test_l_ecriture_admin_dun_jeu_applique_la_norme_par_defaut():
    clean = normalize_identity_fields([{"key": "player_id", "label": "Player ID"}])
    assert (clean[0]["min_length"], clean[0]["max_length"], clean[0]["pattern"]) == (1, STANDARD, None)


def test_l_ecriture_admin_refuse_un_plafond_superieur_a_60():
    for bad in (61, 64, 200):
        with pytest.raises(HTTPException) as exc:
            normalize_identity_fields([{"key": "player_id", "label": "x", "max_length": bad}])
        assert exc.value.status_code == 400
    # Un jeu peut rester PLUS STRICT, et 60 est accepté.
    strict = normalize_identity_fields([{"key": "player_id", "label": "x", "min_length": 9,
                                         "max_length": 13, "pattern": r"^[0-9]{9,13}$"}])
    assert (strict[0]["min_length"], strict[0]["max_length"]) == (9, 13)
    assert normalize_identity_fields([{"key": "p", "label": "x", "max_length": STANDARD}])[0][
        "max_length"] == STANDARD
    with pytest.raises(HTTPException):     # min > max reste refusé
        normalize_identity_fields([{"key": "p", "label": "x", "min_length": 9, "max_length": 2}])


def test_la_lecture_ramene_un_plafond_herite_a_60():
    """Une configuration écrite avant BE-11 (64, ou davantage) est plafonnée à la lecture."""
    stored = [{"key": "player_id", "label": "x", "pattern": None, "min_length": 1, "max_length": 64}]
    spec = identity_spec({"id": "legacy", "identity_fields": stored})
    assert spec[0]["max_length"] == STANDARD
    assert stored[0]["max_length"] == 64, "le document n'est pas modifié par la lecture"
    # Plafond très large : même ramené à 60, donc 61 caractères restent refusés.
    wide = [{"key": "player_id", "label": "x", "max_length": 200}]
    assert identity_spec({"id": "legacy", "identity_fields": wide})[0]["max_length"] == STANDARD
    assert check_identity_payload(wide, {"player_id": "1" * 61}) is None
    assert check_identity_payload(wide, {"player_id": "1" * 60}) is not None
    # Sans changement, l'objet d'origine est renvoyé (aucune copie inutile).
    untouched = [{"key": "player_id", "label": "x", "min_length": 1, "max_length": 60}]
    assert identity_spec({"id": "ok", "identity_fields": untouched})[0] is untouched[0]


def test_la_saisie_accepte_60_caracteres_et_refuse_61():
    spec = identity_spec({"id": PUBG})
    assert check_identity_payload(spec, {"player_id": "1" * 60}) is not None
    assert check_identity_payload(spec, {"player_id": ALPHANUMERIC}) is not None
    assert check_identity_payload(spec, {"player_id": "1" * 61}) is None
    assert check_identity_payload(spec, {"player_id": "   "}) is None


# --------------------------------------------------------------------------- #
# B. Routes de validation (aucun appel fournisseur hors norme)
# --------------------------------------------------------------------------- #
def test_la_route_historique_pubg_accepte_un_id_alphanumerique(monkeypatch, rate_limit):
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    for good in (ALPHANUMERIC, "1" * 60, "  " + ALPHANUMERIC + "  "):
        r = client.post("/fazercards/pubg/validate-id", json={"player_id": good})
        assert r.status_code == 200, r.text
        assert r.json() == {"valid": True, "player_name": "PlayerOne", "region": "ID"}
    assert [call[0] for call in provider.calls] == [PUBG] * 3
    assert provider.calls[0][1] == {"player_id": ALPHANUMERIC}   # trim appliqué, valeur intacte
    assert provider.calls[-1][1] == {"player_id": ALPHANUMERIC}


def test_la_route_historique_refuse_61_caracteres_sans_appel(monkeypatch, rate_limit):
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": "1" * 61})

    assert r.status_code == 422
    assert provider.calls == []


def test_la_route_generique_accepte_la_norme_et_refuse_au_dela(monkeypatch, rate_limit):
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    ok = client.post("/fazercards/validate-id",
                     json={"game_id": PUBG, "fields": {"player_id": ALPHANUMERIC}})
    assert ok.status_code == 200 and ok.json()["valid"] is True
    assert provider.calls == [(PUBG, {"player_id": ALPHANUMERIC})]

    too_long = client.post("/fazercards/validate-id",
                           json={"game_id": PUBG, "fields": {"player_id": "1" * 61}})
    data = too_long.json()
    assert too_long.status_code == 200
    assert data == {"valid": False, "message": "Format d'identifiant invalide pour ce jeu.",
                    "code": "invalid_id", "game_id": PUBG}
    assert provider.calls == [(PUBG, {"player_id": ALPHANUMERIC})], "aucun appel hors norme"


def test_la_route_generique_refuse_une_valeur_hors_norme_meme_sans_contrat_de_jeu(monkeypatch,
                                                                                  rate_limit):
    """Jeu sans champ déclaré : la valeur > 60 ne part pas non plus (plafond global)."""
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {"custom": {"id": "custom"}}, provider)

    r = client.post("/fazercards/validate-id",
                    json={"game_id": "custom", "fields": {"uid": "x" * 61}})

    assert r.status_code == 200 and r.json()["valid"] is False
    assert r.json()["code"] == "invalid_id"
    assert provider.calls == []


# --------------------------------------------------------------------------- #
# C. Script de mise à la norme des documents `games`
# --------------------------------------------------------------------------- #
class FakeGames:
    """Collection `games` simulée : `find` asynchrone, `update_one` filtré sur l'état lu."""

    def __init__(self, docs: list[dict]):
        self.docs = docs
        self.updates: list[tuple] = []

    async def find(self, query, projection=None):
        for doc in self.docs:
            yield doc

    async def update_one(self, query, update):
        self.updates.append((query, update))
        for doc in self.docs:
            if doc["_id"] == query["_id"] and doc.get("identity_fields") == query.get(
                    "identity_fields"):
                doc.update(update["$set"])
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


def _games_doc() -> dict:
    return {"_id": "g1", "id": "jeu-demo", "identity_fields": [
        {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{9,13}$",
         "min_length": 9, "max_length": 13, "required": True, "primary": True},
        {"key": "zone_id", "label": "Zone", "pattern": r"^[A-Z]{2}$",
         "min_length": 2, "max_length": 2, "required": True, "primary": False},
    ]}


def test_le_script_necrit_rien_par_defaut():
    games = FakeGames([_games_doc()])
    lines: list[str] = []

    summary = run(standard.run(SimpleNamespace(games=games), out=lines.append))

    assert games.updates == [] and games.docs[0]["identity_fields"][0]["max_length"] == 13
    assert summary["modified"] == 0 and summary["changed"] == 1
    assert any("player_id" in line and "max_length 13 -> 60" in line for line in lines)
    assert any("zone_id" in line and "max_length 2 -> 60" in line for line in lines)
    assert any(line.startswith("audit:") for line in lines)


def test_le_script_applique_la_norme_sans_toucher_au_reste():
    games = FakeGames([_games_doc()])

    summary = run(standard.run(SimpleNamespace(games=games), apply=True, out=lambda *_: None))

    fields = games.docs[0]["identity_fields"]
    assert summary["modified"] == 1
    assert [f["max_length"] for f in fields] == [60, 60]
    # Motif NON numérique conservé, min_length/required/label/primary intacts.
    assert fields[0]["pattern"] == r"^[0-9]{9,13}$"
    assert fields[1]["pattern"] == r"^[A-Z]{2}$"
    assert (fields[0]["min_length"], fields[0]["required"], fields[0]["primary"]) == (9, True, True)
    assert fields[0]["label"] == "Player ID"


def test_le_script_retire_les_motifs_numeriques_sur_option():
    games = FakeGames([_games_doc()])

    run(standard.run(SimpleNamespace(games=games), apply=True, drop_numeric_patterns=True, out=lambda *_: None))

    fields = games.docs[0]["identity_fields"]
    assert fields[0]["pattern"] is None            # ^[0-9]{9,13}$ retiré
    assert fields[1]["pattern"] == r"^[A-Z]{2}$"   # motif non numérique conservé
    assert fields[0]["min_length"] == 9            # min_length jamais touché


def test_le_script_est_idempotent_et_ne_modifie_aucun_autre_champ():
    doc = _games_doc()
    doc["name"] = "Jeu démo"
    games = FakeGames([doc])

    run(standard.run(SimpleNamespace(games=games), apply=True, drop_numeric_patterns=True, out=lambda *_: None))
    snapshot = repr(doc["identity_fields"])
    second = run(standard.run(SimpleNamespace(games=games), apply=True, drop_numeric_patterns=True, out=lambda *_: None))

    assert second["changed"] == 0 and second["modified"] == 0
    assert repr(doc["identity_fields"]) == snapshot
    assert doc["name"] == "Jeu démo"


@pytest.mark.parametrize("pattern,expected", [
    (r"^[0-9]{9,13}$", True),
    (r"^\d{2,5}$", True),
    (r"^[0-9]+$", True),
    (r"^[A-Z]{2}$", False),
    (r"^[0-9]{1,5}[a-z]$", False),
    (r"^[0-9]{3}$", False),
    (None, False),
])
def test_seuls_les_motifs_purement_numeriques_sont_reconnus(pattern, expected):
    assert standard.is_numeric_only_pattern(pattern) is expected


def test_le_script_refuse_de_tourner_sans_mongo_url(monkeypatch, capsys):
    monkeypatch.delenv("MONGO_URL", raising=False)

    code = standard.main([])

    assert code == 2
    assert "MONGO_URL" in capsys.readouterr().err


def test_le_script_n_affiche_ni_url_ni_donnee_joueur():
    doc = _games_doc()
    doc["last_player_id"] = ALPHANUMERIC        # donnée joueur : ne doit jamais être affichée
    games = FakeGames([doc])
    lines: list[str] = []

    run(standard.run(SimpleNamespace(games=games), apply=True, out=lines.append))

    text = "\n".join(lines)
    assert ALPHANUMERIC not in text and "mongodb://" not in text
    assert "jeu-demo" in text


# --------------------------------------------------------------------------- #
# D. Clés d'identité : numériques inchangées, alphanumériques normalisées
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("player_id", ["52328390220", "123456789", "1234567890123",
                                       "000123456789"])
def test_un_id_numerique_valide_garde_exactement_sa_cle(player_id):
    key = ik.identity_key({"player_id": player_id})
    assert key == legacy_identity_key({"player_id": player_id})
    assert key == ik.normalize_identity_value(player_id)
    if player_id == "52328390220":                 # PUBG : identity_key == pubg_id
        assert key == player_id


@pytest.mark.parametrize("player_id,expected", [
    (ALPHANUMERIC, "1112223bb45"),      # lettres : aucune suppression de zéro
    ("ABc123", "abc123"),               # minuscules
    ("00ab12", "00ab12"),               # zéros initiaux CONSERVÉS (valeur non numérique)
    ("  Abc 123  ", "abc 123"),         # trim + espaces internes réduits
])
def test_un_id_alphanumerique_est_normalise_sans_perte_de_zeros(player_id, expected):
    assert ik.identity_key({"player_id": player_id}) == expected
    assert ik.identity_key({"player_id": player_id}) == legacy_identity_key({"player_id": player_id})


def test_deux_ids_ne_differant_que_par_la_casse_donnent_la_meme_cle():
    """Conséquence DOCUMENTÉE : refus de doublon possible à tort, jamais d'acceptation à tort."""
    assert ik.identity_key({"player_id": "ABc123"}) == ik.identity_key({"player_id": "abc123"})
    assert ik.identity_key({"player_id": "AbC123"}) != ik.identity_key({"player_id": "abc124"})
    # Et un ID alphanumérique ne collisionne pas avec sa partie numérique.
    assert ik.identity_key({"player_id": "1112223"}) != ik.identity_key({"player_id": ALPHANUMERIC})


# --------------------------------------------------------------------------- #
# E. Neferbyte : alphanumérique fail-closed, URL encodée
# --------------------------------------------------------------------------- #
REAL_ASYNC_CLIENT = httpx.AsyncClient


def test_neferbyte_refuse_un_id_alphanumerique_sur_un_endpoint_numerique(monkeypatch):
    calls: list = []

    async def must_not_be_called(*args, **kwargs):  # pragma: no cover - échec si appelé
        calls.append(args)
        raise AssertionError("Neferbyte ne doit pas être appelé pour un ID non numérique")

    monkeypatch.setattr(neferbyte, "verify_identity", must_not_be_called)
    provider = NeferbyteProvider(slug="free-fire", id_field="player_id")

    result = run(provider.validate_identity("free-fire", {"player_id": ALPHANUMERIC}))

    assert result.valid is False and calls == []
    # Un ID numérique, lui, part normalement (vérifié ailleurs) : ici on fixe seulement le refus.
    assert neferbyte.game_spec("free-fire").id_kind == "numeric"


def test_neferbyte_encode_une_valeur_contenant_des_lettres(monkeypatch):
    """Endpoint texte (Valorant) : l'URL est percent-encodée, rien n'est tronqué."""
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"success": True, "data": {"username": "PlayerOne"}})

    monkeypatch.setenv("NEFERBYTE_API_KEY", "0123456789abcdef0123456789abcdef")
    monkeypatch.setenv("NEFERBYTE_API_BASE", "https://api.neferbyte.com")
    monkeypatch.setattr(neferbyte.httpx, "AsyncClient", lambda **kwargs: REAL_ASYNC_CLIENT(
        transport=httpx.MockTransport(handler)))

    result = run(neferbyte.verify_identity("valorant", "Abc 12#3", "tag/1"))

    assert result.status == neferbyte.OK
    assert str(captured[0].url) == (
        "https://api.neferbyte.com/game-id-checker/valorant/Abc%2012%233/tag%2F1")


def test_neferbyte_rejette_un_id_lettre_selon_son_message_documente(monkeypatch):
    """Même si l'appel partait, le refus documenté reste `invalid_id` — jamais `valid: true`."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": True,
                                         "msg": "The ID field must contain only numbers."})

    monkeypatch.setenv("NEFERBYTE_API_KEY", "0123456789abcdef0123456789abcdef")
    monkeypatch.setattr(neferbyte.httpx, "AsyncClient", lambda **kwargs: REAL_ASYNC_CLIENT(
        transport=httpx.MockTransport(handler)))

    result = run(neferbyte.verify_identity("free-fire", ALPHANUMERIC))

    assert result.status == neferbyte.INVALID_ID
    assert result.ok is False


def test_l_adapter_neferbyte_ne_valide_jamais_un_id_alphanumerique(monkeypatch):
    async def _raise_if_called(*_args, **_kwargs):  # pragma: no cover - échec si appelé
        raise AssertionError("aucun appel au fournisseur attendu")

    monkeypatch.setattr(neferbyte_guard, "verify_identity", _raise_if_called)

    provider = NeferbyteProvider(slug="free-fire", id_field="player_id")
    result = run(provider.validate_identity("free-fire", {"player_id": "abc123"}))

    assert result.valid is False and result.player_name is None
