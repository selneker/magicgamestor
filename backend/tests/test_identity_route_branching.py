"""Branchement des 3 points de validation d'identité sur `resolve_identity_provider` — PL-003-BE-4.

Couvre, sans backend lancé, sans Mongo et sans appel réseau :

- **État de référence** (`test_ref_*`) : Free Fire et PUBG Mobile n'ont AUCUN
  `identity_verifier`, donc leurs réponses (succès, invalide, 429, 502, 504, 503) doivent rester
  strictement identiques à celles capturées avant la modification. Ces tests passent à
  l'identique avant et après BE-4 : c'est la preuve de non-régression du contrat HTTP.
- **Jeu vérifié par Neferbyte** : `verify_identity` simulé, même forme de réponse ;
  `ok` -> `valid: true`, `invalid_id` -> `valid: false`, indisponibilité -> mapping existant
  (`provider_unavailable` / `unsupported_game`), jamais `valid: true`.
- **Isolation des fournisseurs** : FazerCards n'est jamais sollicité pour un jeu configuré sur
  Neferbyte, et Neferbyte jamais pour un jeu qui n'en a pas.
- **Préflight** : un vérificateur indisponible ou incohérent ne laisse partir AUCUNE unité.

Le routeur est monté dans une application FastAPI en mémoire ; la projection Mongo est simulée en
respectant les exclusions demandées (un champ absent de la projection n'est pas lisible par la
route : c'est ce qui garantit que le bon champ est bien chargé).
"""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import fazercards as fzr_router
from services import fazercards as fzr_client
from services import fzr_fulfillment, neferbyte
from services.providers import neferbyte_adapter
from services.providers.base import IdentityProvider, IdentityValidation

FREE_FIRE = "free-fire"
PUBG = "pubg-mobile"
ML = "mobile-legends"

FF_ID = "1958604115"
PUBG_ID = "52328390220"
ML_ID, ML_ZONE = "12345678", "2214"

FF_FIELDS = [{"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
              "min_length": 6, "max_length": 12, "required": True, "primary": True}]
ML_FIELDS = [
    {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
     "min_length": 6, "max_length": 12, "required": True, "primary": True},
    {"key": "zone_id", "label": "Zone", "pattern": r"^[0-9]{1,5}$",
     "min_length": 1, "max_length": 5, "required": True},
]

# Documents jeux tels que l'admin les enregistre (aucun `identity_verifier` : FazerCards).
FF_GAME = {"id": FREE_FIRE, "identity_fields": FF_FIELDS}
PUBG_GAME = {"id": PUBG}  # jeu legacy : aucun champ déclaré -> contrat par défaut `player_id`
ML_GAME = {"id": ML, "identity_fields": ML_FIELDS}
# Mêmes documents, une fois le vérificateur Neferbyte configuré en base par l'admin.
FF_NEFERBYTE = {**FF_GAME, "identity_verifier": {"provider": "neferbyte", "slug": "free-fire",
                                                 "id_field": "player_id"}}
PUBG_NEFERBYTE = {**PUBG_GAME, "identity_verifier": {"provider": "neferbyte",
                                                     "slug": "pubgm-global",
                                                     "id_field": "player_id"}}
ML_NEFERBYTE = {**ML_GAME, "identity_verifier": {"provider": "neferbyte", "slug": ML,
                                                 "id_field": "player_id",
                                                 "server_field": "zone_id"}}

RATE_LIMIT_DETAIL = "Trop de requêtes. Réessayez dans quelques minutes."
FZR_TIMEOUT_DETAIL = "La vérification a expiré. Réessayez."
FZR_UNAVAILABLE_DETAIL = "Service de vérification momentanément indisponible. Réessayez plus tard."
FZR_UNSUPPORTED_DETAIL = "La validation d'identité n'est pas disponible pour ce jeu chez le fournisseur."
NO_TARGET_DETAIL = "Identité joueur invalide chez le fournisseur — commande non envoyée."
NO_TARGET_PUBG_DETAIL = "ID PUBG Mobile invalide chez le fournisseur — commande non envoyée."


def run(coro):
    return asyncio.run(coro)


class FakeProvider(IdentityProvider):
    """Vérificateur simulé : enregistre ses appels et renvoie/élève ce qui est programmé.

    Il implémente `IdentityProvider` : c'est le contrat minimal exigé d'un vérificateur
    (dont FazerCards, qui reste le défaut quand le jeu n'a pas de `identity_verifier`).
    """

    name = "fazercards"

    def __init__(self, result=None, exc: Exception | None = None):
        self.result = result or IdentityValidation(valid=True, player_name="PlayerOne", region="ID")
        self.exc = exc
        self.calls: list[tuple] = []

    async def validate_identity(self, game_id, fields):
        self.calls.append((game_id, dict(fields or {})))
        if self.exc:
            raise self.exc
        return self.result


def _project(doc: dict, projection: dict | None) -> dict:
    """Applique une projection Mongo d'exclusions (`{champ: 0}`) ; `_id` toujours exclu en test."""
    return {k: v for k, v in doc.items() if (projection or {}).get(k, 1) != 0 and k != "_id"}


@pytest.fixture
def rate_limit(monkeypatch):
    """Par défaut la limitation de débit ne déclenche pas ; le test peut la forcer."""
    state: dict = {"exc": None}

    def fake_check(*_args, **_kwargs):
        if state["exc"]:
            raise state["exc"]
        return None

    monkeypatch.setattr(fzr_router, "check", fake_check)
    return state


def make_client(monkeypatch, games: dict, fazercards_provider=None,
                neferbyte_result=None, neferbyte_calls: list | None = None):
    """Application FastAPI en mémoire : routeur réel, base et fournisseurs simulés."""

    async def fake_find_one(query, projection=None):
        doc = games.get(query.get("id"))
        return _project(doc, projection) if doc else None

    monkeypatch.setattr(fzr_router.db, "games", SimpleNamespace(find_one=fake_find_one))

    fzr_calls: list = []

    def fake_get_provider(game_id=None):
        fzr_calls.append(game_id)
        return fazercards_provider

    monkeypatch.setattr(fzr_router.providers, "get_provider", fake_get_provider)

    calls = neferbyte_calls if neferbyte_calls is not None else []

    async def fake_verify(slug, player_id, server=None):
        calls.append((slug, player_id, server))
        return neferbyte_result

    monkeypatch.setattr(neferbyte, "verify_identity", fake_verify)

    app = FastAPI()
    app.include_router(fzr_router.router)
    return TestClient(app), fzr_calls, calls


def post_identity(client: TestClient, game_id: str, fields: dict):
    return client.post("/fazercards/validate-id", json={"game_id": game_id, "fields": fields})


# --------------------------------------------------------------------------- #
# 1. ÉTAT DE RÉFÉRENCE — Free Fire / PUBG Mobile sans `identity_verifier` (FazerCards)
#    Ces tests ont été écrits et exécutés AVANT la modification (PL-003-BE-4).
# --------------------------------------------------------------------------- #
def test_ref_free_fire_success(monkeypatch, rate_limit):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="FFPlayer", region="SG"))
    client, fzr_calls, nef_calls = make_client(monkeypatch, {FREE_FIRE: FF_GAME}, provider)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "FFPlayer", "region": "SG",
                        "game_id": FREE_FIRE}
    assert provider.calls == [(FREE_FIRE, {"player_id": FF_ID})]
    assert nef_calls == []
    # FazerCards est sollicité une fois (instance par défaut de `get_provider()`, BE-3) :
    # seule la réponse compte pour le contrat, l'argument interne peut être `None` (défaut).
    assert len(fzr_calls) == 1


def test_ref_free_fire_invalid_id(monkeypatch, rate_limit):
    provider = FakeProvider(IdentityValidation(valid=False))
    client, _fzr, _nef = make_client(monkeypatch, {FREE_FIRE: FF_GAME}, provider)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "Identifiant joueur invalide pour ce jeu.",
                        "code": "invalid_id", "game_id": FREE_FIRE}


def test_ref_pubg_success_generic_route(monkeypatch, rate_limit):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="Kapotue", region="ID"))
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    r = post_identity(client, PUBG, {"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "Kapotue", "region": "ID", "game_id": PUBG}
    assert provider.calls == [(PUBG, {"player_id": PUBG_ID})]


def test_ref_pubg_invalid_id_generic_route(monkeypatch, rate_limit):
    provider = FakeProvider(IdentityValidation(valid=False))
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    r = post_identity(client, PUBG, {"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "ID PUBG Mobile invalide",
                        "code": "invalid_id", "game_id": PUBG}


def test_ref_malformed_payload_never_reaches_provider(monkeypatch, rate_limit):
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {FREE_FIRE: FF_GAME}, provider)

    r = post_identity(client, FREE_FIRE, {"player_id": "12"})  # trop court pour le pattern du jeu

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "Format d'identifiant invalide pour ce jeu.",
                        "code": "invalid_id", "game_id": FREE_FIRE}
    assert provider.calls == []


@pytest.mark.parametrize("exc, status_code, code, detail", [
    (HTTPException(status_code=429, detail=RATE_LIMIT_DETAIL), 429, "rate_limited", RATE_LIMIT_DETAIL),
    (fzr_client.IdentityValidationHTTPException(status_code=502, detail=FZR_UNAVAILABLE_DETAIL,
                                                code="provider_unavailable"),
     502, "provider_unavailable", FZR_UNAVAILABLE_DETAIL),
    (fzr_client.IdentityValidationHTTPException(status_code=504, detail=FZR_TIMEOUT_DETAIL,
                                                code="provider_unavailable"),
     504, "provider_unavailable", FZR_TIMEOUT_DETAIL),
    (fzr_client.IdentityValidationHTTPException(status_code=503, detail=FZR_UNSUPPORTED_DETAIL,
                                                code="unsupported_game"),
     503, "unsupported_game", FZR_UNSUPPORTED_DETAIL),
])
def test_ref_free_fire_error_bodies(monkeypatch, rate_limit, exc, status_code, code, detail):
    client, _fzr, _nef = make_client(monkeypatch, {FREE_FIRE: FF_GAME},
                                    FakeProvider(exc=exc))
    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == status_code
    assert r.json() == {"detail": detail, "code": code, "game_id": FREE_FIRE}


def test_ref_free_fire_rate_limit_happens_before_provider(monkeypatch, rate_limit):
    rate_limit["exc"] = HTTPException(status_code=429, detail=RATE_LIMIT_DETAIL)
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {FREE_FIRE: FF_GAME}, provider)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 429
    assert r.json() == {"detail": RATE_LIMIT_DETAIL, "code": "rate_limited", "game_id": FREE_FIRE}
    assert provider.calls == []


def test_ref_unknown_game_is_404(monkeypatch, rate_limit):
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {}, provider)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 404
    assert r.json() == {"detail": "Game not found", "code": "unsupported_game",
                        "game_id": FREE_FIRE}
    assert provider.calls == []


def test_ref_pubg_legacy_route_success(monkeypatch, rate_limit):
    provider = FakeProvider(IdentityValidation(valid=True, player_name="Kapotue", region="ID"))
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "Kapotue", "region": "ID"}
    assert provider.calls == [(PUBG, {"player_id": PUBG_ID})]


def test_ref_pubg_legacy_route_invalid_id(monkeypatch, rate_limit):
    provider = FakeProvider(IdentityValidation(valid=False))
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "ID PUBG Mobile invalide"}


@pytest.mark.parametrize("exc, status_code, detail", [
    (HTTPException(status_code=429, detail=RATE_LIMIT_DETAIL), 429, RATE_LIMIT_DETAIL),
    (fzr_client.IdentityValidationHTTPException(status_code=502, detail=FZR_UNAVAILABLE_DETAIL,
                                                code="provider_unavailable"),
     502, FZR_UNAVAILABLE_DETAIL),
    (fzr_client.IdentityValidationHTTPException(status_code=504, detail=FZR_TIMEOUT_DETAIL,
                                                code="provider_unavailable"),
     504, FZR_TIMEOUT_DETAIL),
    (fzr_client.IdentityValidationHTTPException(status_code=503, detail=FZR_UNSUPPORTED_DETAIL,
                                                code="unsupported_game"),
     503, FZR_UNSUPPORTED_DETAIL),
])
def test_ref_pubg_legacy_route_error_bodies(monkeypatch, rate_limit, exc, status_code, detail):
    """La route legacy n'a jamais renvoyé `code`/`game_id` : contrat conservé tel quel."""
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, FakeProvider(exc=exc))

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == status_code
    assert r.json() == {"detail": detail}


def test_ref_pubg_legacy_route_rejects_malformed_id(monkeypatch, rate_limit):
    provider = FakeProvider()
    client, _fzr, _nef = make_client(monkeypatch, {PUBG: PUBG_GAME}, provider)

    for bad in ("12", "abcd", "12345678901234"):
        r = client.post("/fazercards/pubg/validate-id", json={"player_id": bad})
        assert r.status_code == 422
    assert provider.calls == []


# --------------------------------------------------------------------------- #
# 2. Jeu configuré sur Neferbyte — même contrat, autre vérificateur
# --------------------------------------------------------------------------- #
def _ok(player_name="FFPlayer", region=None):
    return neferbyte.IdentityCheck(status=neferbyte.OK, player_name=player_name, region=region)


def test_neferbyte_ok_is_valid_true_same_shape(monkeypatch, rate_limit):
    fzr = FakeProvider()
    client, fzr_calls, nef_calls = make_client(
        monkeypatch, {FREE_FIRE: FF_NEFERBYTE}, fzr, neferbyte_result=_ok("FFPlayer", "SG"))

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "FFPlayer", "region": "SG",
                        "game_id": FREE_FIRE}
    assert nef_calls == [("free-fire", FF_ID, None)]
    # FazerCards n'est jamais sollicité pour la validation d'un jeu vérifié par Neferbyte.
    assert fzr.calls == [] and fzr_calls == []


def test_neferbyte_invalid_id_is_valid_false(monkeypatch, rate_limit):
    client, _fzr, nef_calls = make_client(
        monkeypatch, {FREE_FIRE: FF_NEFERBYTE}, FakeProvider(),
        neferbyte_result=neferbyte.IdentityCheck(status=neferbyte.INVALID_ID, reason="not_found"))

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": False, "message": "Identifiant joueur invalide pour ce jeu.",
                        "code": "invalid_id", "game_id": FREE_FIRE}
    assert len(nef_calls) == 1


def test_neferbyte_two_field_game_forwards_zone(monkeypatch, rate_limit):
    client, _fzr, nef_calls = make_client(
        monkeypatch, {ML: ML_NEFERBYTE}, FakeProvider(), neferbyte_result=_ok("MLPlayer", "ID"))

    r = post_identity(client, ML, {"player_id": ML_ID, "zone_id": ML_ZONE})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "MLPlayer", "region": "ID", "game_id": ML}
    assert nef_calls == [(ML, ML_ID, ML_ZONE)]


@pytest.mark.parametrize("check, status_code, code, detail", [
    (neferbyte.IdentityCheck(status=neferbyte.PROVIDER_UNAVAILABLE, reason="quota"),
     503, "provider_unavailable", neferbyte_adapter.PROVIDER_ERROR),
    (neferbyte.IdentityCheck(status=neferbyte.TIMEOUT, reason="timeout"),
     504, "provider_unavailable", neferbyte_adapter.TIMEOUT_DETAIL),
    (neferbyte.IdentityCheck(status=neferbyte.CONFIG_ERROR, reason="bad_slug"),
     503, "unsupported_game", neferbyte_adapter.UNSUPPORTED_GAME_DETAIL),
])
def test_neferbyte_unavailability_never_validates(monkeypatch, rate_limit, check,
                                                  status_code, code, detail):
    client, _fzr, _nef = make_client(monkeypatch, {FREE_FIRE: FF_NEFERBYTE}, FakeProvider(),
                                     neferbyte_result=check)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == status_code
    assert r.json() == {"detail": detail, "code": code, "game_id": FREE_FIRE}
    assert r.json().get("valid") is not True


def test_neferbyte_incoherent_config_in_db_is_unsupported_game_without_call(monkeypatch, rate_limit):
    """Config modifiée à la main en base : 503 explicite, AUCUN appel fournisseur."""
    broken = {**FF_GAME, "identity_verifier": {"provider": "neferbyte", "slug": "mobile-legend",
                                               "id_field": "player_id"}}
    fzr = FakeProvider()
    client, fzr_calls, nef_calls = make_client(monkeypatch, {FREE_FIRE: broken}, fzr)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.status_code == 503
    assert r.json() == {"detail": neferbyte_adapter.UNSUPPORTED_GAME_DETAIL,
                        "code": "unsupported_game", "game_id": FREE_FIRE}
    assert nef_calls == [] and fzr.calls == [] and fzr_calls == []


def test_neferbyte_rollback_to_fazercards_by_nulling_the_field(monkeypatch, rate_limit):
    rolled_back = {**FF_GAME, "identity_verifier": None}
    fzr = FakeProvider(IdentityValidation(valid=True, player_name="FFPlayer", region="SG"))
    client, fzr_calls, nef_calls = make_client(monkeypatch, {FREE_FIRE: rolled_back}, fzr)

    r = post_identity(client, FREE_FIRE, {"player_id": FF_ID})

    assert r.json() == {"valid": True, "player_name": "FFPlayer", "region": "SG",
                        "game_id": FREE_FIRE}
    assert fzr_calls == [None] and nef_calls == []


def test_pubg_legacy_route_uses_configured_verifier(monkeypatch, rate_limit):
    """La route legacy résout le jeu PUBG Mobile en base (même garde de format, même réponse)."""
    fzr = FakeProvider()
    client, fzr_calls, nef_calls = make_client(
        monkeypatch, {PUBG: PUBG_NEFERBYTE}, fzr, neferbyte_result=_ok("Kapotue", "ID"))

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "Kapotue", "region": "ID"}
    assert nef_calls == [("pubgm-global", PUBG_ID, None)]
    assert fzr.calls == [] and fzr_calls == []


def test_pubg_legacy_route_unavailable_keeps_its_error_contract(monkeypatch, rate_limit):
    client, _fzr, _nef = make_client(
        monkeypatch, {PUBG: PUBG_NEFERBYTE}, FakeProvider(),
        neferbyte_result=neferbyte.IdentityCheck(status=neferbyte.PROVIDER_UNAVAILABLE))

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 503
    assert r.json() == {"detail": neferbyte_adapter.PROVIDER_ERROR}


def test_pubg_legacy_route_incoherent_config_is_unsupported_game(monkeypatch, rate_limit):
    """Config modifiée à la main en base : 503, aucun appel fournisseur, contrat legacy conservé."""
    broken = {**PUBG_GAME, "identity_verifier": {"provider": "neferbyte", "slug": "free-fire",
                                                 "id_field": "player_id",
                                                 "server_field": "zone_id"}}
    fzr = FakeProvider()
    client, fzr_calls, nef_calls = make_client(monkeypatch, {PUBG: broken}, fzr)

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 503
    assert r.json() == {"detail": neferbyte_adapter.UNSUPPORTED_GAME_DETAIL}
    assert nef_calls == [] and fzr.calls == [] and fzr_calls == []


def test_pubg_legacy_route_without_game_document_keeps_fazercards(monkeypatch, rate_limit):
    """Document jeu absent : comportement historique (FazerCards), jamais un 404 inventé."""
    fzr = FakeProvider(IdentityValidation(valid=True, player_name="Kapotue", region="ID"))
    client, fzr_calls, nef_calls = make_client(monkeypatch, {}, fzr)

    r = client.post("/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "Kapotue", "region": "ID"}
    assert fzr_calls == [None] and nef_calls == []


def test_real_app_wiring_legacy_route(monkeypatch, rate_limit):
    """Câblage réel (`server.app`, préfixe /api) sur la route legacy."""
    provider = FakeProvider(IdentityValidation(valid=True, player_name="Kapotue", region="ID"))

    async def fake_find_one(query, projection=None):
        return _project(PUBG_GAME, projection) if query.get("id") == PUBG else None

    monkeypatch.setattr(fzr_router.db, "games", SimpleNamespace(find_one=fake_find_one))
    monkeypatch.setattr(fzr_router.providers, "get_provider", lambda game_id=None: provider)

    import server as server_module

    client = TestClient(server_module.app)
    r = client.post("/api/fazercards/pubg/validate-id", json={"player_id": PUBG_ID})

    assert r.status_code == 200
    assert r.json() == {"valid": True, "player_name": "Kapotue", "region": "ID"}


# --------------------------------------------------------------------------- #
# 3. Préflight d'expédition — un vérificateur indisponible ne laisse rien partir
# --------------------------------------------------------------------------- #
UNIT = {"line_index": 0, "component_index": None, "quantity_index": 0, "path": "fazercards",
        "idempotency_key": "MGS-TEST-1", "category_id": "ff_cat", "offer_id": "ff_offer",
        "product": "100 Diamants", "component_name": None}


def _order(game_id: str) -> dict:
    return {"id": "order-1", "order_number": "MGS-TEST", "status": "paid", "game_id": game_id,
            "pubg_id": FF_ID, "identity_snapshot": {"fields": {"player_id": FF_ID}},
            "items": [{"product_id": "p1", "name": "100 Diamants", "quantity": 1}],
            "total": 5000}


@pytest.fixture
def preflight_env(monkeypatch):
    """Préflight isolé : commande et jeux simulés, unité factice, envoi et offres espionnés."""
    state: dict = {"game": None, "sent": [], "fzr_calls": [], "fzr_exc": None}

    async def fake_order_find_one(query, projection=None):
        if query.get("id") != "order-1":
            return None
        game_id = (state["game"] or {}).get("id") or FREE_FIRE
        return _order(game_id)

    async def fake_game_find_one(query, projection=None):
        doc = state["game"]
        return _project(doc, projection) if doc and query.get("id") == doc.get("id") else None

    async def fake_all_units(_order_doc):
        return [dict(UNIT)], []

    async def fake_fulfill_unit(order, line, actor):
        state["sent"].append((order["id"], line["offer_id"]))
        return {}

    async def fake_offers_for_game(game_id, category_id):
        return {"category_id": category_id,
                "offers": [{"offer_id": UNIT["offer_id"], "name": UNIT["product"],
                            "price_usd": "0.5000"}],
                "fields": [{"key": "player_id"}]}

    def fake_get_provider(game_id=None):
        state["fzr_calls"].append(game_id)
        return FakeProvider(exc=state["fzr_exc"])

    async def boom(*_a, **_k):  # pragma: no cover - ne doit jamais être atteint
        raise AssertionError("aucune commande fournisseur ne doit partir")

    monkeypatch.setattr(fzr_fulfillment, "db", SimpleNamespace(
        orders=SimpleNamespace(find_one=fake_order_find_one),
        games=SimpleNamespace(find_one=fake_game_find_one)))
    monkeypatch.setattr(fzr_fulfillment, "_all_units", fake_all_units)
    monkeypatch.setattr(fzr_fulfillment, "_fulfill_unit", fake_fulfill_unit)
    monkeypatch.setattr(fzr_fulfillment.fzr_mapping, "offers_for_game", fake_offers_for_game)
    monkeypatch.setattr(fzr_fulfillment.providers, "get_provider", fake_get_provider)
    monkeypatch.setattr(fzr_client, "create_topup_order", boom)
    return state


def set_verifier(state, game: dict):
    state["game"] = game


def test_preflight_neferbyte_unavailable_blocks_and_sends_nothing(monkeypatch, preflight_env):
    state = preflight_env
    set_verifier(state, FF_NEFERBYTE)
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(
        neferbyte.IdentityCheck(status=neferbyte.PROVIDER_UNAVAILABLE, reason="quota")))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 503
    assert exc.value.code == "provider_unavailable"
    assert state["sent"] == []


def test_preflight_neferbyte_timeout_blocks_and_sends_nothing(monkeypatch, preflight_env):
    state = preflight_env
    set_verifier(state, FF_NEFERBYTE)
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(
        neferbyte.IdentityCheck(status=neferbyte.TIMEOUT)))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 504 and exc.value.code == "provider_unavailable"
    assert state["sent"] == []


def test_preflight_neferbyte_invalid_identity_keeps_neutral_message(monkeypatch, preflight_env):
    state = preflight_env
    set_verifier(state, FF_NEFERBYTE)
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(
        neferbyte.IdentityCheck(status=neferbyte.INVALID_ID, reason="not_found")))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 409
    assert exc.value.detail == NO_TARGET_DETAIL
    assert state["sent"] == []


def test_preflight_pubg_invalid_identity_keeps_legacy_message(monkeypatch, preflight_env):
    state = preflight_env
    set_verifier(state, PUBG_NEFERBYTE)
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(
        neferbyte.IdentityCheck(status=neferbyte.INVALID_ID, reason="not_found")))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 409
    assert exc.value.detail == NO_TARGET_PUBG_DETAIL
    assert state["sent"] == []


def test_preflight_neferbyte_incoherent_config_blocks_without_call(monkeypatch, preflight_env):
    state = preflight_env
    broken = {**FF_GAME, "identity_verifier": {"provider": "neferbyte", "slug": "mobile-legend",
                                               "id_field": "player_id"}}
    calls: list = []
    set_verifier(state, broken)
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(None, calls))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 503 and exc.value.code == "unsupported_game"
    assert calls == [] and state["sent"] == []


def test_preflight_without_verifier_keeps_fazercards_behaviour(monkeypatch, preflight_env):
    state = preflight_env
    state["game"] = {**FF_GAME, "fazercards_validation_category": "ff_cat"}
    state["fzr_exc"] = fzr_client.IdentityValidationHTTPException(
        status_code=502, detail=FZR_UNAVAILABLE_DETAIL, code="provider_unavailable")
    nef_calls: list = []
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(None, nef_calls))

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order("order-1", "admin-1"))

    assert exc.value.status_code == 502
    assert exc.value.detail == FZR_UNAVAILABLE_DETAIL
    assert nef_calls == [] and state["sent"] == []


def test_preflight_neferbyte_ok_builds_report_with_verified_name(monkeypatch, preflight_env):
    """Cas nominal : le vérificateur passe, le rapport porte le pseudo vérifié, rien n'est envoyé."""
    state = preflight_env
    set_verifier(state, FF_NEFERBYTE)
    received: list = []
    monkeypatch.setattr(neferbyte, "verify_identity", _verify_returning(
        neferbyte.IdentityCheck(status=neferbyte.OK, player_name="FFPlayer"), received))

    report = run(fzr_fulfillment.preflight("order-1"))

    assert received == [("free-fire", FF_ID, None)]
    assert report["player_name"] == "FFPlayer" and report["ready_count"] == 1
    assert state["sent"] == []  # preflight ne commande jamais


def _verify_returning(result, calls: list | None = None):
    calls = calls if calls is not None else []

    async def fake_verify(slug, player_id, server=None):
        calls.append((slug, player_id, server))
        return result

    return fake_verify
