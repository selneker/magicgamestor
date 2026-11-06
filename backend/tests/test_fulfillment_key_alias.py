"""PL-003-HF-1 — correspondance `zone_id` (jeu) → `server_id` (offre FazerCards) au préflight.

Contexte : une offre Mobile Legends déclare `fields: [{key: player_id}, {key: server_id}]`, tandis
que le jeu déclare ses champs `player_id` + `zone_id`. Avant ce correctif, le préflight refusait la
livraison (409 « Champ « server_id » manquant pour ce jeu ») alors que la zone était bien saisie,
et le payload aurait porté `zone_id` au lieu de `server_id`.

Ce que ces tests verrouillent :

- un champ est transmis sous la clé EXIGÉE par l'offre, avec la valeur validée (aucune invention) ;
- une zone réellement absente ou vide reste refusée (409) : fail-closed inchangé ;
- PUBG / Free Fire / une offre dont les clés correspondent déjà : payload IDENTIQUE à avant ;
- la clé d'idempotence n'est jamais recalculée (aucun double envoi) ;
- aucun identifiant ni pseudo dans les messages d'erreur.

Aucun réseau, aucun Mongo : fournisseur et base simulés (SimpleNamespace), identifiants fictifs.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import fzr_fulfillment
from services.providers.base import IdentityValidation

ML = "mobile-legends"
PUBG = "pubg-mobile"
PLAYER_ID = "1393323764"     # valeur de test, jamais un compte réel
ZONE_ID = "15748"
PSEUDO = "PlayerOne"


def run(coro):
    return asyncio.run(coro)


def options(required: list[str]) -> dict:
    """Réponse `GET /topups/offers` réduite aux clés exigées."""
    return {"category_id": "cat", "offers": [{"offer_id": "offer-1", "name": "100 Diamants",
                                              "price_usd": "1.0000"}],
            "fields": [{"key": k} for k in required]}


# --------------------------------------------------------------------------- #
# 1. Fonctions pures : nommage des champs
# --------------------------------------------------------------------------- #
def test_server_id_recoit_la_valeur_de_zone_id():
    payload = fzr_fulfillment._provider_identity_fields(
        ["player_id", "server_id"], {"player_id": PLAYER_ID, "zone_id": ZONE_ID})

    assert payload == {"player_id": PLAYER_ID, "server_id": ZONE_ID}
    assert "zone_id" not in payload, "la valeur ne part pas sous deux noms"


def test_la_cle_exacte_est_prioritaire_sur_l_alias():
    payload = fzr_fulfillment._provider_identity_fields(
        ["server_id"], {"zone_id": ZONE_ID, "server_id": "999"})

    assert payload == {"server_id": "999"}


def test_les_cles_non_reclamees_par_l_offre_sont_conservees():
    payload = fzr_fulfillment._provider_identity_fields(
        ["player_id"], {"player_id": PLAYER_ID, "zone_id": ZONE_ID})

    assert payload == {"player_id": PLAYER_ID, "zone_id": ZONE_ID}


def test_pubg_et_les_joueurs_a_un_seul_champ_sont_inchanges():
    """Aucune régression : clé exigée == clé du jeu -> payload identique à l'ancien."""
    fields = {"player_id": PLAYER_ID}
    assert fzr_fulfillment._provider_identity_fields(["player_id"], fields) == fields


def test_sans_cle_exigee_le_payload_est_inchange():
    fields = {"player_id": PLAYER_ID, "zone_id": ZONE_ID}
    assert fzr_fulfillment._provider_identity_fields([], fields) == fields


def test_une_cle_inconnue_reste_manquante_aucune_valeur_inventee():
    fields = {"player_id": PLAYER_ID, "zone_id": ZONE_ID}
    assert fzr_fulfillment._missing_required_field_keys(["player_id", "other_id"], fields) == [
        "other_id"]
    assert fzr_fulfillment._provider_identity_fields(["other_id"], fields) == fields


@pytest.mark.parametrize("zone", [None, "", "   "])
def test_zone_absente_ou_vide_reste_manquante(zone):
    fields = {"player_id": PLAYER_ID}
    if zone is not None:
        fields["zone_id"] = zone

    assert fzr_fulfillment._missing_required_field_keys(["player_id", "server_id"], fields) == [
        "server_id"]


def test_server_est_aussi_accepte_comme_alias():
    payload = fzr_fulfillment._provider_identity_fields(
        ["server_id"], {"player_id": PLAYER_ID, "server": ZONE_ID})

    assert payload == {"player_id": PLAYER_ID, "server_id": ZONE_ID}


# --------------------------------------------------------------------------- #
# 2. Préflight complet (base simulée, aucun réseau)
# --------------------------------------------------------------------------- #
class FakeOrders:
    """Collection `orders` minimale : lecture de la commande + écritures acceptées."""

    def __init__(self, order: dict):
        self.order = order
        self.updates: list[tuple] = []

    async def find_one(self, query, projection=None):
        return self.order

    async def update_one(self, query, update):
        self.updates.append((query, update))
        for key, value in (update.get("$set") or {}).items():
            if "." in key:
                head, _, tail = key.partition(".")
                self.order.setdefault(head, {})[tail] = value
            else:
                self.order[key] = value
        return SimpleNamespace(modified_count=1)


class FakeDb:
    def __init__(self, order: dict, game: dict, product: dict):
        self.orders = FakeOrders(order)
        self._game, self._product = game, product

    class _Collection:
        def __init__(self, doc):
            self.doc = doc

        async def find_one(self, query, projection=None):
            return self.doc

    @property
    def games(self):
        return self._Collection(self._game)

    @property
    def products(self):
        return self._Collection(self._product)


class FakeIdentity:
    name = "fazercards"

    def __init__(self):
        self.calls: list[dict] = []

    async def validate_identity(self, game_id, fields):
        self.calls.append(dict(fields))
        return IdentityValidation(valid=True, player_name=PSEUDO)


def make_order(fields: dict, *, sent: bool = False) -> dict:
    order = {
        "id": "ord-1", "order_number": "MGS-TEST-1", "status": "paid", "game_id": ML,
        "pubg_id": (fields or {}).get("player_id"), "total": 1000,
        "identity_snapshot": {"source": "checkout", "game_id": ML, "fields": fields},
        "items": [{"product_id": "prod-1", "name": "100 Diamants", "quantity": 1}],
    }
    if sent:
        order["fazercards"] = {"provider_order_id": "fzr-1", "status": "submitted"}
    return order


MAPPING = {"mode": "direct", "category_id": "mlbb", "offer_id": "offer-1", "confirmed": True}
GAME = {"id": ML, "identity_fields": [{"key": "player_id", "primary": True},
                                      {"key": "zone_id", "required": True}]}


def install(monkeypatch, order: dict, required: list[str]):
    db = FakeDb(order, GAME, {"id": "prod-1", "fazercards_mapping": MAPPING})
    identity = FakeIdentity()

    async def offers_for_game(game_id, category_id):
        return options(required)

    async def no_trace(*_args, **_kwargs):
        return None

    monkeypatch.setattr(fzr_fulfillment, "db", db)
    monkeypatch.setattr(fzr_fulfillment.providers, "resolve_identity_provider",
                        lambda _game: identity)
    monkeypatch.setattr(fzr_fulfillment.fzr_mapping, "offers_for_game", offers_for_game)
    monkeypatch.setattr(fzr_fulfillment, "_record_verification", no_trace)
    return db, identity


def test_preflight_transmet_la_zone_sous_server_id(monkeypatch):
    order = make_order({"player_id": PLAYER_ID, "zone_id": ZONE_ID})
    db, identity = install(monkeypatch, order, ["player_id", "server_id"])

    report = run(fzr_fulfillment.preflight("ord-1"))

    assert report["lines"][0]["identity_fields"] == {"player_id": PLAYER_ID,
                                                     "server_id": ZONE_ID}
    assert report["field_key"] == "player_id"
    # La VÉRIFICATION d'identité, elle, garde les clés du jeu (validate-id inchangé).
    assert identity.calls == [{"player_id": PLAYER_ID, "zone_id": ZONE_ID}]
    assert db.orders.updates == []   # preflight n'écrit aucune commande (hors trace, neutralisée)


def test_preflight_refuse_une_zone_reellement_absente(monkeypatch):
    order = make_order({"player_id": PLAYER_ID})
    db, identity = install(monkeypatch, order, ["player_id", "server_id"])

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.preflight("ord-1"))

    assert exc.value.status_code == 409
    assert "server_id" in exc.value.detail
    assert PLAYER_ID not in exc.value.detail and PSEUDO not in exc.value.detail


def test_preflight_ne_renomme_rien_pour_une_offre_deja_conforme(monkeypatch):
    order = make_order({"player_id": PLAYER_ID})
    db, identity = install(monkeypatch, order, ["player_id"])

    report = run(fzr_fulfillment.preflight("ord-1"))

    assert report["lines"][0]["identity_fields"] == {"player_id": PLAYER_ID}


def test_une_commande_deja_envoyee_n_est_pas_renvoyee(monkeypatch):
    order = make_order({"player_id": PLAYER_ID, "zone_id": ZONE_ID}, sent=True)
    db, identity = install(monkeypatch, order, ["player_id", "server_id"])

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.preflight("ord-1"))

    assert exc.value.status_code == 409 and "Déjà envoyée" in exc.value.detail
    assert identity.calls == []


# --------------------------------------------------------------------------- #
# 3. Envoi simulé : le payload porte `server_id`, la clé d'idempotence ne change pas
# --------------------------------------------------------------------------- #
def test_l_envoi_utilise_le_payload_du_preflight_et_la_meme_cle(monkeypatch):
    order = make_order({"player_id": PLAYER_ID, "zone_id": ZONE_ID})
    db, _identity = install(monkeypatch, order, ["player_id", "server_id"])
    sent: list[dict] = []

    class FakeProvider:
        name = "fazercards"

        async def create_order(self, category_id, offer_id, fields, idempotency_key):
            sent.append({"category_id": category_id, "offer_id": offer_id, "fields": fields,
                         "key": idempotency_key})
            return SimpleNamespace(id="fzr-1", status="processing")

        def normalize_status(self, status):
            return status

    async def no_sync(*_args, **_kwargs):
        return None

    monkeypatch.setattr(fzr_fulfillment.providers, "get_provider", lambda _game_id: FakeProvider())
    monkeypatch.setattr(fzr_fulfillment, "_sync_mgs_status", no_sync)
    monkeypatch.setattr(fzr_fulfillment, "audit", lambda *a, **k: _noop())

    report = run(fzr_fulfillment.preflight("ord-1"))
    run(fzr_fulfillment._fulfill_unit(order, {**report["lines"][0], "player_name": PSEUDO},
                                      "test"))

    assert len(sent) == 1
    assert sent[0]["fields"] == {"player_id": PLAYER_ID, "server_id": ZONE_ID}
    assert sent[0]["key"] == "MGS-TEST-1-1"          # clé historique inchangée
    assert "zone_id" not in sent[0]["fields"]


async def _noop():
    return None
