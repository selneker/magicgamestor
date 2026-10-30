"""Résolution du fournisseur d'identité par jeu (`identity_verifier`) — PL-003-BE-3.

Tests 100 % hors réseau et hors Mongo :
- un jeu sans `identity_verifier` (dont Free Fire et PUBG Mobile) reste sur FazerCards ;
- une config Neferbyte valide rend un `NeferbyteProvider` (identité seule, sans méthode de commande) ;
- toute config incohérente échoue en 503 `unsupported_game` AVANT tout appel fournisseur ;
- les 5 résultats typés de `services.neferbyte` sont traduits vers le contrat existant
  (`valid: true/false` ou la signalisation FazerCards `provider_unavailable` / `unsupported_game`) ;
- `identity_verifier` n'apparaît pas dans la projection publique des jeux ;
- la validation à l'écriture (routes admin) rejette en 400 et enregistre une config normalisée.
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import neferbyte
from services.providers import (GAME_PROVIDER, IdentityProvider, IdentityVerifierError,
                                NeferbyteProvider, Provider, TopupProvider, get_provider,
                                normalize_identity_verifier, resolve_identity_provider)

ML = "mobile-legends"
FREE_FIRE = "free-fire"
PUBG = "pubg-mobile"

ML_FIELDS = [
    {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
     "min_length": 6, "max_length": 12, "required": True, "primary": True},
    {"key": "zone_id", "label": "Zone", "pattern": r"^[0-9]{1,5}$",
     "min_length": 1, "max_length": 5, "required": True},
]
FREE_FIRE_FIELDS = [
    {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
     "min_length": 6, "max_length": 12, "required": True, "primary": True},
]
ML_VERIFIER = {"provider": "neferbyte", "slug": "mobile-legends",
               "id_field": "player_id", "server_field": "zone_id"}
FREE_FIRE_VERIFIER = {"provider": "neferbyte", "slug": "free-fire", "id_field": "player_id"}

ML_GAME = {"id": ML, "identity_fields": ML_FIELDS, "identity_verifier": ML_VERIFIER}
FREE_FIRE_GAME = {"id": FREE_FIRE, "identity_fields": FREE_FIRE_FIELDS}
FREE_FIRE_NEFERBYTE = {"id": FREE_FIRE, "identity_fields": FREE_FIRE_FIELDS,
                       "identity_verifier": FREE_FIRE_VERIFIER}
# PUBG Mobile n'a jamais déclaré ses champs : son contrat par défaut s'applique (`player_id`).
PUBG_GAME = {"id": PUBG}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def verify_calls(monkeypatch):
    """Remplace l'appel Neferbyte : enregistre les arguments, renvoie le résultat programmé."""
    calls: list[tuple] = []
    state: dict = {"result": None}

    async def fake_verify(slug, player_id, server=None):
        calls.append((slug, player_id, server))
        return state["result"]

    def forbidden(*_a, **_k):  # pragma: no cover - ne doit jamais être atteint
        raise AssertionError("aucun appel réseau ne doit être émis")

    monkeypatch.setattr(neferbyte, "verify_identity", fake_verify)
    state["forbidden"] = forbidden
    return calls, state


def detail_of(exc_info) -> str:
    return str(exc_info.value.detail)


# --------------------------------------------------------------------------- #
# 1. Défaut = FazerCards (aucun jeu ne change de comportement)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("game", [
    {"id": "some-game"},
    FREE_FIRE_GAME,
    PUBG_GAME,
    {"id": ML, "identity_fields": ML_FIELDS, "identity_verifier": None},
    {"id": ML, "identity_fields": ML_FIELDS, "identity_verifier": {"provider": "fazercards"}},
    {"id": ML, "identity_fields": ML_FIELDS, "identity_verifier": {"provider": "FazerCards"}},
])
def test_games_without_neferbyte_config_resolve_to_fazercards(game):
    provider = resolve_identity_provider(game)
    assert isinstance(provider, Provider)
    assert provider.name == "fazercards"
    assert isinstance(provider, IdentityProvider)


def test_resolution_without_game_document_defaults_to_fazercards():
    assert resolve_identity_provider(None).name == "fazercards"


def test_topup_resolution_is_unchanged():
    # `get_provider()` reste le résolveur de TOP-UP : aucune table modifiée par BE-3.
    assert GAME_PROVIDER == {"pubg-mobile": "fazercards", "free-fire": "fazercards"}
    assert get_provider("pubg-mobile").name == "fazercards"
    assert get_provider("future-game").name == "fazercards"


# --------------------------------------------------------------------------- #
# 2. Config Neferbyte valide -> NeferbyteProvider (identité seule)
# --------------------------------------------------------------------------- #
def test_valid_neferbyte_config_resolves_to_identity_only_provider():
    provider = resolve_identity_provider(ML_GAME)
    assert isinstance(provider, NeferbyteProvider)
    assert isinstance(provider, IdentityProvider)
    assert not isinstance(provider, TopupProvider)
    assert not hasattr(provider, "create_order")
    assert (provider.slug, provider.id_field, provider.server_field) == (ML, "player_id", "zone_id")


def test_rollback_by_removing_or_nulling_the_field():
    game = dict(ML_GAME)
    assert isinstance(resolve_identity_provider(game), NeferbyteProvider)
    game.pop("identity_verifier")
    assert resolve_identity_provider(game).name == "fazercards"
    game["identity_verifier"] = None
    assert resolve_identity_provider(game).name == "fazercards"


# --------------------------------------------------------------------------- #
# 3. Config incohérente -> 503 unsupported_game, sans aucun appel
# --------------------------------------------------------------------------- #
INCOHERENT = [
    ("neferbyte", "objet JSON"),
    ({"provider": "autre-fournisseur"}, "inconnu"),
    ({"slug": "free-fire", "id_field": "player_id"}, "provider"),
    ({"provider": "neferbyte", "slug": "mobile-legend", "id_field": "player_id",
      "server_field": "zone_id"}, "slug Neferbyte inconnu"),
    ({"provider": "neferbyte", "slug": "Mobile-Legends", "id_field": "player_id",
      "server_field": "zone_id"}, "slug Neferbyte inconnu"),
    ({"provider": "neferbyte", "slug": ML, "server_field": "zone_id"}, "id_field"),
    ({"provider": "neferbyte", "slug": ML, "id_field": "nickname",
      "server_field": "zone_id"}, "n'est pas un champ"),
    ({"provider": "neferbyte", "slug": ML, "id_field": "player_id"}, "server_field"),
    ({"provider": "neferbyte", "slug": ML, "id_field": "player_id",
      "server_field": "player_id"}, "différent"),
    ({"provider": "neferbyte", "slug": ML, "id_field": "player_id",
      "server_field": "server"}, "n'est pas un champ"),
    ({"provider": "neferbyte", "slug": FREE_FIRE, "id_field": "player_id",
      "server_field": "zone_id"}, "ne prend pas de second segment"),
]


@pytest.mark.parametrize("verifier, expected", INCOHERENT)
def test_incoherent_config_is_unsupported_game_without_call(verifier, expected, verify_calls):
    calls, _state = verify_calls
    game = {"id": ML, "identity_fields": ML_FIELDS, "identity_verifier": verifier}
    with pytest.raises(HTTPException) as exc:
        resolve_identity_provider(game)
    assert exc.value.status_code == 503
    assert exc.value.code == "unsupported_game"
    assert "configur" in detail_of(exc).lower()
    assert calls == []


def test_game_without_declared_identity_fields_cannot_use_neferbyte():
    game = {"id": "brand-new-game",
            "identity_verifier": {"provider": "neferbyte", "slug": FREE_FIRE,
                                  "id_field": "player_id"}}
    with pytest.raises(HTTPException) as exc:
        resolve_identity_provider(game)
    assert exc.value.code == "unsupported_game"


# --------------------------------------------------------------------------- #
# 4. Traduction des 5 résultats typés de `verify_identity`
# --------------------------------------------------------------------------- #
def test_ok_is_valid_with_nickname_and_region(verify_calls):
    calls, state = verify_calls
    state["result"] = neferbyte.IdentityCheck(status=neferbyte.OK, player_name="PlayerOne",
                                              region="15748", raw={"username": "PlayerOne"})
    provider = resolve_identity_provider(ML_GAME)
    result = run(provider.validate_identity(ML, {"player_id": "1393323764", "zone_id": "15748"}))

    assert result.valid is True
    assert result.player_name == "PlayerOne" and result.region == "15748"
    assert calls == [(ML, "1393323764", "15748")]  # valeurs transmises telles quelles


def test_id_only_game_sends_no_server_segment(verify_calls):
    calls, state = verify_calls
    state["result"] = neferbyte.IdentityCheck(status=neferbyte.OK, player_name="PlayerOne")
    provider = resolve_identity_provider(FREE_FIRE_NEFERBYTE)
    result = run(provider.validate_identity(FREE_FIRE, {"player_id": "1958604115"}))

    assert result.valid is True and result.region is None
    assert calls == [(FREE_FIRE, "1958604115", None)]


def test_invalid_id_is_valid_false(verify_calls):
    _calls, state = verify_calls
    state["result"] = neferbyte.IdentityCheck(status=neferbyte.INVALID_ID, reason="not_found")
    provider = resolve_identity_provider(FREE_FIRE_NEFERBYTE)
    result = run(provider.validate_identity(FREE_FIRE, {"player_id": "999999"}))
    assert result.valid is False and result.player_name is None


@pytest.mark.parametrize("status, status_code, code", [
    (neferbyte.PROVIDER_UNAVAILABLE, 503, "provider_unavailable"),
    (neferbyte.TIMEOUT, 504, "provider_unavailable"),
    (neferbyte.CONFIG_ERROR, 503, "unsupported_game"),
    ("unexpected_status", 503, "provider_unavailable"),  # fail-closed
])
def test_unavailability_is_never_validated(verify_calls, status, status_code, code):
    _calls, state = verify_calls
    state["result"] = neferbyte.IdentityCheck(status=status, reason="test")
    provider = resolve_identity_provider(FREE_FIRE_NEFERBYTE)
    with pytest.raises(HTTPException) as exc:
        run(provider.validate_identity(FREE_FIRE, {"player_id": "1958604115"}))
    assert exc.value.status_code == status_code
    assert exc.value.code == code


def test_provider_does_not_invent_a_missing_player_id(verify_calls):
    calls, state = verify_calls
    state["result"] = neferbyte.IdentityCheck(status=neferbyte.CONFIG_ERROR, reason="missing_id")
    provider = resolve_identity_provider(FREE_FIRE_NEFERBYTE)
    with pytest.raises(HTTPException):
        run(provider.validate_identity(FREE_FIRE, {"zone_id": "1"}))
    assert calls == [(FREE_FIRE, None, None)]


# --------------------------------------------------------------------------- #
# 5. Visibilité : configuration admin jamais publique
# --------------------------------------------------------------------------- #
def _project(doc: dict, projection: dict) -> dict:
    return {k: v for k, v in doc.items() if projection.get(k, 1) != 0}


def test_identity_verifier_is_excluded_from_public_game_payload():
    from routers.games import PUBLIC, PUBLIC_GAME, _effective

    doc = {"id": ML, "identity_fields": ML_FIELDS, "identity_verifier": ML_VERIFIER,
           "fazercards_categories": ["x"]}
    public = _effective(_project(doc, PUBLIC_GAME))
    assert "identity_verifier" not in public
    assert "fazercards_categories" not in public
    assert public["identity_fields"] == ML_FIELDS  # le contrat de saisie reste public

    # La route admin utilise la projection complète : la configuration y reste visible.
    assert "identity_verifier" in _project(doc, PUBLIC)


# --------------------------------------------------------------------------- #
# 6. Validation à l'écriture (routes admin) — rejet 400, config normalisée
# --------------------------------------------------------------------------- #
class FakeGames:
    """Collection `games` minimale en mémoire (aucun Mongo)."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                doc.update(update.get("$set") or {})


@pytest.fixture
def admin_route(monkeypatch):
    from routers import games as games_router

    audits: list[tuple] = []

    async def fake_audit(action, user_id, target, meta):
        audits.append((action, target, meta))

    games = FakeGames()
    monkeypatch.setattr(games_router, "db", SimpleNamespace(games=games))
    monkeypatch.setattr(games_router, "audit", fake_audit)
    return games_router, games, audits


def test_admin_create_game_rejects_incoherent_verifier(admin_route):
    router, games, audits = admin_route
    body = router.GameIn(id="new-game", name="New game", active=False,
                         identity_fields=[{"key": "player_id", "label": "Player ID"}],
                         identity_verifier={"provider": "neferbyte", "slug": "mobile-legend",
                                            "id_field": "player_id"})
    with pytest.raises(HTTPException) as exc:
        run(router.create_game(body, user={"user_id": "admin-1"}))
    assert exc.value.status_code == 400
    assert "slug Neferbyte inconnu" in detail_of(exc)
    assert games.docs == [] and audits == []


def test_admin_create_game_stores_normalized_neferbyte_config(admin_route):
    router, games, _audits = admin_route
    body = router.GameIn(id="new-game", name="New game", active=False,
                         identity_fields=[{"key": "player_id", "label": "Player ID"},
                                          {"key": "zone_id", "label": "Zone"}],
                         identity_verifier={"provider": "Neferbyte", "slug": ML,
                                            "id_field": "player_id", "server_field": "zone_id"})
    doc = run(router.create_game(body, user={"user_id": "admin-1"}))
    assert doc["identity_verifier"] == ML_VERIFIER
    assert games.docs[0]["identity_verifier"] == ML_VERIFIER


def test_admin_update_keeps_verifier_when_field_is_absent(admin_route):
    router, games, audits = admin_route
    games.docs.append({"id": ML, "name": "Mobile Legends", "active": False,
                       "identity_fields": ML_FIELDS, "identity_verifier": ML_VERIFIER})
    body = router.GameIn(id=ML, name="Mobile Legends", active=False)
    doc = run(router.update_game(ML, body, user={"user_id": "admin-1"}))
    assert doc["identity_verifier"] == ML_VERIFIER
    assert audits[-1][2]["identity_provider"] == "neferbyte"


def test_admin_update_null_rolls_back_to_fazercards(admin_route):
    router, games, audits = admin_route
    games.docs.append({"id": ML, "name": "Mobile Legends", "active": False,
                       "identity_fields": ML_FIELDS, "identity_verifier": ML_VERIFIER})
    body = router.GameIn(id=ML, name="Mobile Legends", active=False, identity_verifier=None)
    doc = run(router.update_game(ML, body, user={"user_id": "admin-1"}))
    assert doc["identity_verifier"] is None
    assert audits[-1][2]["identity_provider"] is None


def test_admin_update_rejects_incoherent_verifier(admin_route):
    router, games, _audits = admin_route
    games.docs.append({"id": ML, "name": "Mobile Legends", "active": False,
                       "identity_fields": ML_FIELDS})
    body = router.GameIn(id=ML, name="Mobile Legends", active=False,
                         identity_verifier={"provider": "neferbyte", "slug": ML,
                                            "id_field": "player_id"})  # server_field manquant
    with pytest.raises(HTTPException) as exc:
        run(router.update_game(ML, body, user={"user_id": "admin-1"}))
    assert exc.value.status_code == 400
    assert games.docs[0].get("identity_verifier") is None  # rien n'a été écrit


# --------------------------------------------------------------------------- #
# 7. Fonction de validation partagée (contrat direct)
# --------------------------------------------------------------------------- #
def test_normalizer_accepts_valid_config_and_rollback_values():
    assert normalize_identity_verifier(None, ML, ML_FIELDS) is None
    assert normalize_identity_verifier({"provider": "fazercards"}, ML, ML_FIELDS) == {
        "provider": "fazercards"}
    assert normalize_identity_verifier(ML_VERIFIER, ML, ML_FIELDS) == ML_VERIFIER


def test_normalizer_applies_legacy_default_identity_fields():
    # PUBG Mobile sans déclaration explicite : son contrat par défaut (`player_id`) s'applique.
    config = normalize_identity_verifier(
        {"provider": "neferbyte", "slug": "pubgm-global", "id_field": "player_id"}, PUBG, [])
    assert config == {"provider": "neferbyte", "slug": "pubgm-global",
                      "id_field": "player_id", "server_field": None}


@pytest.mark.parametrize("verifier, expected", INCOHERENT)
def test_normalizer_raises_explicit_error(verifier, expected):
    with pytest.raises(IdentityVerifierError) as exc:
        normalize_identity_verifier(verifier, ML, ML_FIELDS)
    assert expected in str(exc.value)
