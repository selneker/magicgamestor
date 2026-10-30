"""PL-003-BE-8 — contrôle des champs exigés par l'offre et trace de la vérification.

Aucun appel réseau : FazerCards est simulé par `httpx.MockTransport` (mêmes helpers que
`test_fzr_phase3`). Les commandes de test sont créées dans la base de test locale
(`monkeypatch` inactive le mode automatique), jamais en production.

Ce que ces tests verrouillent :

1. une commande valide garde exactement le même envoi qu'avant BE-8, et reçoit en plus une trace
   de vérification (`identity_snapshot.verification` : fournisseur, pseudo, horodatage) ;
2. TOUTES les clés exigées par l'offre FazerCards sont contrôlées : une clé absente ou vide
   renvoie 409 avant l'envoi, sans identifiant ni pseudo dans le message ;
3. aucune trace n'est écrite si la validation n'a pas réussi (identité invalide, fournisseur
   indisponible, timeout) et rien n'est envoyé ;
4. les champs transmis à FazerCards sont exactement ceux qui viennent d'être validés ;
5. un client ne peut pas faire passer une identité pour « vérifiée » (aucun champ de ce type
   n'est accepté par les modèles d'entrée).
"""
import json
import uuid

import httpx
import pytest
from fastapi import HTTPException

from core.games import DEFAULT_GAME_ID
from routers.orders import OrderIn, _identity_snapshot
from services import fazercards, fzr_fulfillment
from test_fzr_phase3 import (OFFERS, VALIDATE_LIST, VALIDATE_OK, cleanup_test_artifacts,  # noqa: F401
                             db, make_mapped_product, make_order, mock_transport, run)

PSEUDO = "Kapotue"
PUBG_ID = "52328390220"
TWO_FIELDS = {"ok": True, "kind": "topup", "category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)",
              "offers": [{"offer_id": "uc_60", "name": "60 UC", "price_usd": "0.8800"}],
              "fields": [{"key": "player_id", "label": "Player ID", "type": "text"},
                         {"key": "zone_id", "label": "Zone ID", "type": "text"}]}


@pytest.fixture(autouse=True)
def fake_env(monkeypatch):
    """Client FazerCards configuré (aucun secret réel) et caches vides à chaque test."""
    asyncio = __import__("asyncio")
    from test_fzr_phase3 import _LOOP

    asyncio.set_event_loop(_LOOP)  # motor résout la boucle à la création des coroutines
    fazercards._catalog_cache.clear()
    fazercards._discovery_cache["data"] = None
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_for_tests")
    yield
    fazercards._catalog_cache.clear()
    fazercards._discovery_cache["data"] = None


def handler_factory(*, offers=OFFERS, validate=VALIDATE_OK, orders: list | None = None,
                    validations: list | None = None, validate_response=None):
    """FazerCards simulé : enregistre les champs VALIDÉS et les champs ENVOYÉS."""
    provider_id = f"ord-{uuid.uuid4().int % 10**8}"

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json=VALIDATE_LIST)
        if path.endswith("/topups/validate-id"):
            if validations is not None:
                validations.append(json.loads(req.content))
            if validate_response is not None:
                return validate_response
            return httpx.Response(200, json=validate)
        if path.endswith("/topups/offers"):
            return httpx.Response(200, json=offers)
        if path.endswith("/topups/order"):
            if orders is not None:
                orders.append({"Idempotency-Key": req.headers.get("Idempotency-Key"),
                               "body": json.loads(req.content)})
            return httpx.Response(200, json={"ok": True, "order": {"id": provider_id,
                                                                   "kind": "topup",
                                                                   "status": "processing"}})
        if "/orders/" in path:
            return httpx.Response(200, json={"ok": True, "order": {"id": provider_id, "status": "completed"}})
        return httpx.Response(404, json={"ok": False, "error": "not found"})

    return handler


def paid_order(**overrides):
    pid = make_mapped_product()
    order = make_order(status="paid", product_id=pid)
    snapshot = {"source": "checkout", "game_id": DEFAULT_GAME_ID,
                "fields": {"player_id": PUBG_ID}, "player_name": PSEUDO, "validated": False}
    updates = {"pseudo": PSEUDO, "identity_snapshot": snapshot, **overrides}
    run(db.orders.update_one({"id": order["id"]}, {"$set": updates}))
    return run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))


def verification(order: dict):
    return ((order or {}).get("identity_snapshot") or {}).get("verification")


# --------------------------------------------------------------------------- #
# 1. Référence : commande valide (même envoi qu'avant, trace en plus)
# --------------------------------------------------------------------------- #
def test_valid_order_payload_is_unchanged_and_verification_is_recorded(monkeypatch):
    orders, validations = [], []
    mock_transport(monkeypatch, handler_factory(orders=orders, validations=validations))
    order = paid_order()

    run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    # Envoi IDENTIQUE à la référence : mêmes champs, même clé d'idempotence.
    assert len(orders) == 1
    assert orders[0]["body"]["fields"] == {"player_id": PUBG_ID}
    assert orders[0]["Idempotency-Key"] == f"{order['order_number']}-1"

    # Trace : fournisseur qui a réellement validé + pseudo validé + horodatage.
    trace = verification(run(db.orders.find_one({"id": order["id"]}, {"_id": 0})))
    assert trace["provider"] == "fazercards"
    assert trace["player_name"] == PSEUDO
    assert trace["validated_at"]

    # Le snapshot d'origine n'est pas réécrit (champs identiques, `validated` inchangé).
    stored = run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))["identity_snapshot"]
    assert stored["fields"] == {"player_id": PUBG_ID}


def test_sent_fields_are_exactly_the_fields_validated_by_preflight(monkeypatch):
    """Les champs envoyés à FazerCards sont ceux que le préflight vient de faire valider."""
    orders, validations = [], []
    order = paid_order(identity_snapshot={"source": "checkout", "game_id": DEFAULT_GAME_ID,
                                          "fields": {"player_id": PUBG_ID, "zone_id": "2214"},
                                          "player_name": PSEUDO, "validated": False})
    mock_transport(monkeypatch, handler_factory(orders=orders, validations=validations,
                                               offers=TWO_FIELDS))

    run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    assert len(validations) == 1 and len(orders) == 1
    assert validations[0]["fields"] == {"player_id": PUBG_ID, "zone_id": "2214"}
    assert orders[0]["body"]["fields"] == validations[0]["fields"]


# --------------------------------------------------------------------------- #
# 2. Toutes les clés exigées par l'offre sont contrôlées
# --------------------------------------------------------------------------- #
def test_missing_required_field_is_refused_before_any_send(monkeypatch):
    orders, validations = [], []
    mock_transport(monkeypatch, handler_factory(orders=orders, validations=validations,
                                               offers=TWO_FIELDS))
    order = paid_order()

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    assert exc.value.status_code == 409
    assert "zone_id" in exc.value.detail           # la clé exacte manquante est nommée
    assert PUBG_ID not in exc.value.detail         # aucun identifiant dans le message
    assert PSEUDO not in exc.value.detail          # aucun pseudo dans le message
    assert orders == []                            # rien n'est parti chez FazerCards
    assert verification(run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))) is None


def test_empty_required_field_is_treated_as_missing(monkeypatch):
    """Une clé présente mais vide n'est pas une valeur validée : refus, rien n'est envoyé."""
    orders = []
    mock_transport(monkeypatch, handler_factory(orders=orders, offers=TWO_FIELDS))
    order = paid_order(identity_snapshot={"source": "checkout", "game_id": DEFAULT_GAME_ID,
                                          "fields": {"player_id": PUBG_ID, "zone_id": "   "},
                                          "player_name": PSEUDO, "validated": False})

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    assert exc.value.status_code == 409 and "zone_id" in exc.value.detail
    assert orders == []


# --------------------------------------------------------------------------- #
# 3. Aucune trace sans validation réussie, et rien n'est envoyé
# --------------------------------------------------------------------------- #
def test_invalid_identity_writes_no_trace_and_sends_nothing(monkeypatch):
    orders = []
    mock_transport(monkeypatch, handler_factory(orders=orders, validate={"ok": True, "valid": False}))
    order = paid_order()

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    assert exc.value.status_code == 409
    assert orders == []
    assert verification(run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))) is None


def test_provider_unavailable_writes_no_trace_and_sends_nothing(monkeypatch):
    orders = []
    mock_transport(monkeypatch, handler_factory(
        orders=orders, validate_response=httpx.Response(502, json={"ok": False, "error": "down"})))
    order = paid_order()

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    assert exc.value.status_code in (502, 503)
    assert orders == []
    assert verification(run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))) is None


def test_provider_timeout_writes_no_trace_and_sends_nothing(monkeypatch):
    orders = []
    mock_transport(monkeypatch, handler_factory(
        orders=orders, validate_response=httpx.Response(504, json={"ok": False, "error": "timeout"})))
    order = paid_order()

    with pytest.raises(HTTPException) as exc:
        run(fzr_fulfillment.fulfill_order(order["id"], "test"))

    assert exc.value.status_code in (502, 503, 504)
    assert orders == []
    assert verification(run(db.orders.find_one({"id": order["id"]}, {"_id": 0}))) is None


# --------------------------------------------------------------------------- #
# 4. Un client ne peut pas fournir une identité « déjà vérifiée »
# --------------------------------------------------------------------------- #
def _order_payload(**extra):
    return {"pubg_id": PUBG_ID, "pseudo": PSEUDO, "payment_method": "manual",
            "items": [{"product_id": str(uuid.uuid4()), "quantity": 1}], **extra}


def test_order_model_ignores_client_supplied_snapshot_or_validated_flag():
    """`identity_snapshot` / `validated` ne font pas partie du contrat d'entrée : jamais repris."""
    body = OrderIn(**_order_payload(identity_snapshot={"validated": True, "fields": {"player_id": "1"}},
                                    validated=True, identity_key="forged"))
    dumped = body.model_dump()
    assert "identity_snapshot" not in dumped and "validated" not in dumped
    assert "identity_key" not in dumped


def test_saved_identity_model_ignores_validated_flag():
    from routers.games import IdentityIn, IdentityUpdate

    created = IdentityIn(game_id=DEFAULT_GAME_ID, fields={"player_id": PUBG_ID}, validated=True,
                         validated_at="2020-01-01T00:00:00+00:00")
    patched = IdentityUpdate(fields={"player_id": PUBG_ID}, validated=True)
    assert "validated" not in created.model_dump() and "validated_at" not in created.model_dump()
    assert "validated" not in patched.model_dump()


def test_checkout_snapshot_is_never_marked_validated(monkeypatch):
    """La commande naît avec `validated: False` : seule la vérification serveur fait foi."""
    from types import SimpleNamespace

    from routers import orders as orders_mod

    async def fake_game_find_one(query, projection=None):
        return {"id": DEFAULT_GAME_ID}

    monkeypatch.setattr(orders_mod, "db", SimpleNamespace(
        games=SimpleNamespace(find_one=fake_game_find_one),
        game_identities=SimpleNamespace(find_one=fake_game_find_one)))
    body = OrderIn(**_order_payload(identity_fields=None))

    snapshot = run(orders_mod._identity_snapshot(body, None))

    assert snapshot["source"] == "checkout"
    assert snapshot["fields"] == {"player_id": PUBG_ID}
    assert snapshot["validated"] is False
    assert "verification" not in snapshot


def test_identity_snapshot_helper_copies_declared_fields_only():
    """Contrôle direct : `_identity_snapshot` ne recopie que les champs déclarés du jeu."""
    from types import SimpleNamespace

    from routers import orders as orders_mod

    async def fake_game_find_one(query, projection=None):
        return {"id": "free-fire",
                "identity_fields": [{"key": "player_id", "label": "ID", "primary": True}]}

    saved = {"id": "ident-1", "game_id": "free-fire", "fields": {"player_id": "123456789"},
             "label": "Main", "player_name": "FF", "validated": False}

    async def fake_ident_find_one(query, projection=None):
        return saved if query.get("id") == "ident-1" else None

    orders_mod_db = SimpleNamespace(games=SimpleNamespace(find_one=fake_game_find_one),
                                    game_identities=SimpleNamespace(find_one=fake_ident_find_one))
    import routers.orders as mod
    original = mod.db
    mod.db = orders_mod_db
    try:
        body = OrderIn(**_order_payload(pubg_id="123456789", identity_id="ident-1",
                                        game_id="free-fire", identity_fields={"player_id": "123456789"}))
        snapshot = run(mod._identity_snapshot(body, {"user_id": "u1"}))
    finally:
        mod.db = original
    assert snapshot["source"] == "identity"
    assert snapshot["fields"] == {"player_id": "123456789"}
    assert snapshot["validated"] is False


# --------------------------------------------------------------------------- #
# 5. Journaux : aucun identifiant ni pseudo
# --------------------------------------------------------------------------- #
def test_failed_verification_logs_no_identifier(monkeypatch, caplog):
    mock_transport(monkeypatch, handler_factory(validate={"ok": True, "valid": False}))
    order = paid_order()
    with caplog.at_level("DEBUG"):
        with pytest.raises(HTTPException):
            run(fzr_fulfillment.fulfill_order(order["id"], "test"))
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert PUBG_ID not in text
    assert PSEUDO not in text
