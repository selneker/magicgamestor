"""PL-006-T07 — tests de l'adaptateur Shop2Topup (catalogue, identité, erreurs).

Aucun appel réseau : `httpx.MockTransport` répond à la place du fournisseur, et aucune clé réelle
n'est utilisée (les valeurs ci-dessous sont des sentinelles). `pytest-asyncio` n'est pas une
dépendance du dépôt : chaque test asynchrone passe par `_run`, comme les autres suites.
"""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import uuid

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import providers, stock  # noqa: E402
from services.providers import shop2topup_adapter as adapter  # noqa: E402
from services.providers.base import OrderStatus  # noqa: E402
from services.providers.errors import (ProviderInsufficientBalanceError,  # noqa: E402
                                       ProviderOrderError, ProviderUnavailableError,
                                       ProviderValidationError)

KEY = "sentinelle-cle.sentinelle-secret"
WEBHOOK_SECRET = "sentinelle-webhook"


def _run(coro):
    """Boucle dédiée (même motif que `test_stock_availability._run`)."""
    return asyncio.new_event_loop().run_until_complete(coro)


def _provider(handler, *args, **kwargs) -> adapter.Shop2TopupProvider:
    """Adaptateur branché sur un transport bouchonné (aucune socket, aucun DNS)."""
    return adapter.Shop2TopupProvider(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), *args, **kwargs)


def _json(payload: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=payload)


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    """Clé de test posée dans l'environnement : jamais un fichier, jamais une vraie clé."""
    monkeypatch.setenv("SHOP2TOPUP_API_KEY", KEY)


# --------------------------------------------------------------------------- #
# Résolution et contrat
# --------------------------------------------------------------------------- #
def test_enregistrement_explicite_dans_get_provider(monkeypatch):
    monkeypatch.setitem(providers.GAME_PROVIDER, "jeu-de-test-s2t", "shop2topup")

    provider = providers.get_provider("jeu-de-test-s2t")

    assert isinstance(provider, adapter.Shop2TopupProvider)
    assert provider.name == "shop2topup"
    assert provider is providers.get_provider("jeu-de-test-s2t")  # instance réutilisée


def test_fournisseur_inconnu_echoue_au_lieu_de_servir_fazercards(monkeypatch):
    """Le repli silencieux a disparu : un nom inconnu est une erreur de configuration."""
    monkeypatch.setitem(providers.GAME_PROVIDER, "jeu-inconnu-s2t", "fournisseur-qui-nexiste-pas")

    with pytest.raises(ProviderUnavailableError) as exc:
        providers.get_provider("jeu-inconnu-s2t")

    assert exc.value.code == "unknown_provider"


@pytest.mark.parametrize("raw,expected", [
    ("pending", OrderStatus.PROCESSING),
    ("completed", OrderStatus.COMPLETED),
    ("refunded", OrderStatus.REFUND),
    # Partiellement livré : aucun statut MGS ne le représente, on ne décide rien à l'aveugle.
    ("partial", OrderStatus.PROCESSING),
    ("PENDING", OrderStatus.PROCESSING),
    ("statut-invente", OrderStatus.PROCESSING),
    (None, OrderStatus.PROCESSING),
])
def test_normalisation_des_statuts(raw, expected):
    assert adapter.normalize_status(raw) == expected
    assert adapter.Shop2TopupProvider().normalize_status(raw) == expected


@pytest.mark.parametrize("code", ["OUT_OF_STOCK", "INSUFFICIENT_STOCK", "PRODUCT_UNAVAILABLE"])
def test_les_codes_de_rupture_shop2topup_sont_reconnus_par_le_stock(code):
    """`stock.is_out_of_stock_error` doit reconnaître les trois codes, sans casser FazerCards."""
    assert stock.is_out_of_stock_error(ProviderOrderError(400, "refus", code)) is True


def test_prix_et_solde_ne_sont_jamais_une_rupture():
    assert stock.is_out_of_stock_error(
        ProviderOrderError(409, "prix en cours de rafraîchissement", "PRICING_UPDATING")) is False
    assert stock.is_out_of_stock_error(
        ProviderInsufficientBalanceError(400, "solde insuffisant", "INSUFFICIENT_BALANCE")) is False


# --------------------------------------------------------------------------- #
# Enveloppe et erreurs
# --------------------------------------------------------------------------- #
def test_la_charge_utile_est_lue_sous_data_comme_documentee():
    seen = {}

    def handler(request):
        seen["authorization"] = request.headers.get("Authorization")
        return _json({"success": True, "data": [{"id": 2, "name": "PUBG Mobile"}]})

    categories = _run(_provider(handler).get_categories())

    assert categories == [{"category_id": "2", "name": "PUBG Mobile", "note": None}]
    assert seen["authorization"] == f"Bearer {KEY}"
    assert KEY not in str(categories)


def test_la_charge_utile_est_lue_sous_la_cle_documentee(monkeypatch):
    def handler(request):
        return _json({"success": True, "categories": [{"id": 4, "name": "Free Fire"}]})

    assert _run(_provider(handler).get_categories()) == [
        {"category_id": "4", "name": "Free Fire", "note": None}]


@pytest.mark.parametrize("status,body,expected", [
    (400, {"success": False, "error": {"code": "OUT_OF_STOCK", "message": "rupture"}},
     ProviderOrderError),
    (409, {"success": False, "code": "PRODUCT_UNAVAILABLE", "msg": "indisponible"},
     ProviderOrderError),
    (400, {"success": False, "error": {"code": "INSUFFICIENT_BALANCE", "message": "solde"}},
     ProviderInsufficientBalanceError),
    (403, {"success": False, "error": {"code": "IP_NOT_ALLOWED", "message": "ip"}},
     ProviderUnavailableError),
    (429, {"success": False, "error": {"code": "RATE_LIMIT_EXCEEDED", "message": "trop"}},
     ProviderUnavailableError),
    (500, {"success": False, "error": {"code": "INTERNAL_ERROR", "message": "panne"}},
     ProviderUnavailableError),
])
def test_les_erreurs_fournisseur_sont_traduites_vers_les_classes_existantes(status, body, expected):
    provider = _provider(lambda request: _json(body, status))

    with pytest.raises(expected) as exc:
        _run(provider.get_order("commande-1"))

    if expected is ProviderOrderError:
        assert exc.value.status_code == status
    assert exc.value.code == (body.get("error", {}).get("code") or body.get("code"))


def test_cle_absente_n_envoie_aucune_requete(monkeypatch):
    monkeypatch.delenv("SHOP2TOPUP_API_KEY", raising=False)
    calls = []

    provider = _provider(lambda request: calls.append(request) or _json({}))

    with pytest.raises(ProviderUnavailableError) as exc:
        _run(provider.get_categories())

    assert exc.value.code == "not_configured"
    assert calls == []
    assert adapter.configured() is False


def test_aucun_message_d_erreur_ne_contient_la_cle():
    provider = _provider(lambda request: _json(
        {"success": False, "error": {"code": "INVALID_API_KEY", "message": "clé refusée"}}, 401))

    with pytest.raises(ProviderUnavailableError) as exc:
        _run(provider.get_categories())

    assert KEY not in str(exc.value)


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #
def test_get_offers_expose_offres_et_champs_exiges():
    def handler(request):
        if request.url.path.endswith("/requirements"):
            return _json({"success": True, "requirements": [
                {"field_name": "player_id", "data_type": "text", "placeholder": "Enter player ID"}]})
        assert request.url.params["categoryId"] == "2"
        return _json({"success": True, "subcategories": [
            {"item_id": 13, "name": "60 UC", "category_name": "PUBG Mobile Direct Topup",
             "price": "0.990000", "product_type": "topup"}]})

    offers = _run(_provider(handler).get_offers("2"))

    assert offers["category_id"] == "2"
    assert offers["name"] == "PUBG Mobile Direct Topup"
    assert offers["offers"] == [{"offer_id": "13", "name": "60 UC", "price": "0.990000",
                                 "product_type": "topup"}]
    assert offers["fields"] == [{"key": "player_id", "label": "Enter player ID", "type": "text"}]


# --------------------------------------------------------------------------- #
# Identité
# --------------------------------------------------------------------------- #
def test_identite_sans_offre_n_appelle_pas_le_reseau():
    calls = []
    provider = _provider(lambda request: calls.append(request) or _json({}))

    with pytest.raises(ProviderValidationError) as exc:
        _run(provider.validate_identity("pubg-mobile", {"player_id": "123456789"}))

    assert exc.value.code == "missing_offer"
    assert calls == []


def test_identite_valide_rend_le_pseudo_et_la_region():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return _json({"success": True, "player": {
            "player_id": "123456789", "player_name": "ProGamer99", "region": "Asia"}})

    validation = _run(_provider(handler).validate_identity(
        "pubg-mobile", {"player_id": "123456789", "offer_id": "13"}))

    assert validation.valid is True
    assert validation.player_name == "ProGamer99"
    assert validation.region == "Asia"
    assert seen["body"] == {"player_id": "123456789", "sub_category_id": 13}


def test_identite_inconnue_donne_une_validation_invalide():
    provider = _provider(lambda request: _json(
        {"success": False, "error": {"code": "PLAYER_NOT_FOUND", "message": "inconnu"}}, 400))

    assert _run(provider.validate_identity(
        "pubg-mobile", {"player_id": "0", "offer_id": "13"})).valid is False


# --------------------------------------------------------------------------- #
# Commande (surface T08 : la clé d'idempotence devient l'order_id)
# --------------------------------------------------------------------------- #
def test_la_meme_cle_d_idempotence_donne_le_meme_order_id():
    bodies = []

    def handler(request):
        payload = json.loads(request.content)
        bodies.append(payload)
        return _json({"success": True, "order": {
            "order_id": payload["order_id"], "status": "pending"}})

    provider = _provider(handler)
    first = _run(provider.create_order("2", "13", {"player_id": "99"}, "cmd-42-unite-0"))
    second = _run(provider.create_order("2", "13", {"player_id": "99"}, "cmd-42-unite-0"))

    assert first.id == second.id
    assert uuid.UUID(first.id)  # un vrai UUID, exigé par l'API
    assert bodies[0] == bodies[1]
    assert bodies[0]["sub_category_id"] == 13
    assert bodies[0]["quantity"] == 1
    assert bodies[0]["requirements"] == {"player_id": "99"}
    assert "expected_unit_price" not in bodies[0]  # T09 l'ajoutera, rien n'est inventé ici
    assert first.normalized_status == OrderStatus.PROCESSING


def test_creation_refusee_sans_cle_ou_sans_offre():
    provider = _provider(lambda request: pytest.fail("aucune requête ne doit partir"))

    with pytest.raises(ProviderOrderError) as missing_key:
        _run(provider.create_order("2", "13", {}, "  "))
    assert missing_key.value.code == "missing_idempotency_key"

    with pytest.raises(ProviderOrderError) as missing_offer:
        _run(provider.create_order("2", "", {}, "cmd-1"))
    assert missing_offer.value.code == "missing_offer"


# --------------------------------------------------------------------------- #
# Webhook
# --------------------------------------------------------------------------- #
def test_signature_webhook_verifiee_sur_le_corps_brut(monkeypatch):
    monkeypatch.setenv("SHOP2TOPUP_WEBHOOK_SECRET", WEBHOOK_SECRET)
    raw = b'{"event":"order.completed","data":{"order_id":"abc"}}'
    signature = "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    provider = adapter.Shop2TopupProvider()

    assert provider.verify_webhook_signature(raw, signature) is True
    # Un seul octet de différence suffit : le corps brut est la seule entrée valable.
    assert provider.verify_webhook_signature(raw + b" ", signature) is False
    assert provider.verify_webhook_signature(raw, "sha256=" + "0" * 64) is False
    assert provider.verify_webhook_signature(raw, None) is False

    monkeypatch.delenv("SHOP2TOPUP_WEBHOOK_SECRET")
    assert provider.verify_webhook_signature(raw, signature) is False


def test_webhook_normalise_event_commande_et_statut():
    event = adapter.Shop2TopupProvider().parse_webhook_event({
        "event": "order.completed",
        "timestamp": "2026-03-11T14:30:00.000Z",
        "data": {"order_id": "01912345-6789-7abc-8def-0123456789ab", "status": "completed"},
    })

    assert event.event == "order.completed"
    assert event.provider_order_id == "01912345-6789-7abc-8def-0123456789ab"
    assert event.status == "completed"
    assert event.event_id is None  # la livraison n'en porte pas : idempotence sur order_id+status
    assert event.raw["timestamp"] == "2026-03-11T14:30:00.000Z"
