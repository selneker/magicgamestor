"""PL-006-T07/T08 — tests de l'adaptateur Shop2Topup (catalogue, identité, erreurs, commande,
webhook, budget de requêtes).

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


# --------------------------------------------------------------------------- #
# Bascule et reprise d'une commande déjà connue (T08)
# --------------------------------------------------------------------------- #
def test_pubg_mobile_est_servi_par_shop2topup():
    """Bascule déclarative : PUBG passe à Shop2Topup, sans toucher au domaine."""
    assert providers.GAME_PROVIDER["pubg-mobile"] == "shop2topup"
    assert providers.get_provider("pubg-mobile").name == "shop2topup"


def test_une_commande_deja_connue_est_relue_et_non_renvoyee():
    seen = []

    def handler(request):
        if request.url.path.endswith("/orders/create"):
            seen.append("create")
            return _json({"success": False,
                          "error": {"code": "DUPLICATE_ORDER", "message": "déjà"}}, 409)
        seen.append("read")
        return _json({"success": True, "order": {"order_id": "cmd", "status": "completed"}})

    order = _run(_provider(handler).create_order("2", "13", {"player_id": "99"}, "cmd-42-unite-0"))

    # Une seule création tentée, puis une lecture : jamais une seconde commande.
    assert seen == ["create", "read"]
    assert order.normalized_status == OrderStatus.COMPLETED


def test_commande_deja_connue_mais_illisible_reste_reessayable():
    """Statut illisible ⇒ indisponibilité, pas un échec : la ligne reste en attente, même clé au retry."""

    def handler(request):
        if request.url.path.endswith("/orders/create"):
            return _json({"success": False, "error": {"code": "DUPLICATE_ORDER"}}, 409)
        return _json({"success": False, "error": {"code": "INTERNAL_ERROR"}}, 500)

    with pytest.raises(ProviderUnavailableError) as exc:
        _run(_provider(handler).create_order("2", "13", {"player_id": "99"}, "cmd-42-unite-0"))

    assert exc.value.status_code == 502


# --------------------------------------------------------------------------- #
# Budget de requêtes (T08) — limite dure, jamais une attente
# --------------------------------------------------------------------------- #
class _Clock:
    """Horloge figée : la fenêtre glissante se teste sans dormir."""

    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now


def _catch_alerts(monkeypatch):
    alerts = []

    async def fake_notify(**kwargs):
        alerts.append(kwargs)
        return {"status": "sent"}

    monkeypatch.setattr(adapter.notifications, "notify_admin", fake_notify)
    return alerts


def test_budget_de_statut_est_une_limite_par_commande(monkeypatch):
    calls = []
    alerts = _catch_alerts(monkeypatch)
    provider = _provider(lambda request: calls.append(request) or _json(
        {"success": True, "order": {"order_id": "cmd-a", "status": "completed"}}))
    provider._status_budgets["cmd-a"] = adapter.RequestBudget(3, clock=_Clock())

    for _ in range(3):
        _run(provider.get_order("cmd-a"))

    with pytest.raises(ProviderUnavailableError) as exc:
        _run(provider.get_order("cmd-a"))

    assert exc.value.code == "rate_budget_exceeded"
    assert len(calls) == 3  # la 4e requête n'est jamais partie
    assert len(alerts) == 1  # une seule alerte pour tout l'épisode de saturation
    assert alerts[0]["event"] == "shop2topup_budget_exceeded"

    # Une autre commande a son propre compteur : elle n'est pas punie par celle-ci.
    _run(provider.get_order("cmd-b"))
    assert len(calls) == 4


def test_budget_de_lot_est_une_limite_dure(monkeypatch):
    calls = []
    _catch_alerts(monkeypatch)

    def handler(request):
        calls.append(json.loads(request.content)[adapter.BATCH_REQUEST_KEY])
        ids = calls[-1]
        return _json({"success": True,
                      "orders": [{"order_id": value, "status": "pending"} for value in ids]})

    provider = _provider(handler)
    provider._budgets["status_batch"] = adapter.RequestBudget(2, clock=_Clock())
    units = [{"provider_order_id": f"cmd-{index}",
              "created_at": f"2026-03-01T00:{index // 60:02d}:{index % 60:02d}+00:00"}
             for index in range(150)]

    report = _run(provider.reconcile(units))

    assert len(calls) == 2          # 2 lots autorisés, le 3e n'est pas envoyé
    assert len(report["starved"]) == 50
    assert len(report["checked"]) == 100
    assert report["starved"][0] == "cmd-100"  # la plus ancienne des affamées


def test_un_lot_est_decoupe_a_cinquante():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content)[adapter.BATCH_REQUEST_KEY])
        return _json({"success": True,
                      "orders": [{"order_id": value, "status": "pending"} for value in calls[-1]]})

    batch = _run(_provider(handler).get_orders([f"cmd-{index}" for index in range(100)]))

    assert [len(chunk) for chunk in calls] == [50, 50]
    assert batch.requested == 100
    assert len(batch.orders) == 100


def test_un_troisieme_lot_est_refuse_par_le_budget(monkeypatch):
    """120 identifiants = 3 lots ; le budget n'en autorise que 2 par 60 s, et il ne dort pas."""
    calls = []
    alerts = _catch_alerts(monkeypatch)

    def handler(request):
        calls.append(json.loads(request.content)[adapter.BATCH_REQUEST_KEY])
        return _json({"success": True,
                      "orders": [{"order_id": value, "status": "pending"} for value in calls[-1]]})

    with pytest.raises(ProviderUnavailableError) as exc:
        _run(_provider(handler).get_orders([f"cmd-{index}" for index in range(120)]))

    assert exc.value.code == "rate_budget_exceeded"
    assert [len(chunk) for chunk in calls] == [50, 50]  # le 3e lot n'est jamais parti
    assert len(alerts) == 1                             # une seule alerte par épisode


def test_reconciliation_commence_par_les_plus_anciennes(monkeypatch):
    calls = []
    _catch_alerts(monkeypatch)

    def handler(request):
        calls.append(json.loads(request.content)[adapter.BATCH_REQUEST_KEY])
        return _json({"success": True,
                      "orders": [{"order_id": value, "status": "completed"} for value in calls[-1]]})

    units = [
        {"provider_order_id": "recente", "created_at": "2026-03-10T10:00:00Z"},
        {"provider_order_id": "sans-date"},
        {"provider_order_id": "ancienne", "created_at": "2026-03-01T10:00:00Z"},
        {"provider_order_id": ""},  # rien à interroger : écartée, pas affamée
    ]

    report = _run(_provider(handler).reconcile(units))

    assert calls == [["sans-date", "ancienne", "recente"]]
    assert report["requested"] == 3
    assert set(report["checked"]) == {"sans-date", "ancienne", "recente"}
    assert report["starved"] == []


def test_reconciliation_rend_les_commandes_inconnues_du_fournisseur(monkeypatch):
    _catch_alerts(monkeypatch)

    def handler(request):
        ids = json.loads(request.content)[adapter.BATCH_REQUEST_KEY]
        return _json({"success": True,
                      "orders": [{"order_id": ids[0], "status": "completed"}],
                      "not_found": ids[1:]})

    report = _run(_provider(handler).reconcile([
        {"provider_order_id": "connue", "created_at": "2026-03-01T10:00:00Z"},
        {"provider_order_id": "disparue", "created_at": "2026-03-02T10:00:00Z"},
    ]))

    assert list(report["checked"]) == ["connue"]
    assert report["not_found"] == ["disparue"]
    assert report["starved"] == []

