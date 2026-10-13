"""Sécurité du contrat de validation FazerCards et des commandes (correctifs ciblés).

100 % UNITAIRE : aucun MongoDB, aucun réseau réel, aucune clé fournisseur, aucune commande
ni recharge. httpx est mocké quand la découverte fournisseur est nécessaire ; la porte d'identité
reçoit un provider factice. Couvre :
1. jeu avec validation prise en charge → validation obligatoire respectée ;
2. identifiant invalide → aucun paiement autorisé ;
3. jeu sans validation prise en charge → autorisé SEULEMENT si explicitement configuré ;
4. erreur technique jamais confondue avec une absence normale de prise en charge ;
5. catégorie de vente ≠ identifiant de validation → correspondance correcte ;
6. jeu/produit sans livraison valide → vente bloquée ;
7. région incompatible → commande bloquée ;
8. unité `creating` interrompue → récupération sûre, sans relance dangereuse ;
9. PUBG Mobile historique → comportement inchangé ;
10. panier multi-jeux interdit + contrat de webhook inchangé.
"""
import asyncio
import os
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
# `core.db` lit MONGO_URL à l'import : aucune connexion n'est ouverte par ces tests unitaires.
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017/")
os.environ.setdefault("DB_NAME", "mgs_unit_tests")

from core.games import (DEFAULT_GAME_ID, VALIDATION_NOT_REQUIRED, VALIDATION_OPTIONAL,  # noqa: E402
                        product_deliverable, validation_policy_of)
from services import fazercards, identity_gate  # noqa: E402
from services.providers.base import IdentityValidation  # noqa: E402
from services.providers.errors import ProviderTimeout, ProviderUnavailableError  # noqa: E402
from services.providers.fazercards_adapter import FazerCardsProvider  # noqa: E402
from services import fzr_fulfillment  # noqa: E402

FREE_FIRE = "free-fire"
CODM = "call-of-duty-mobile"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _isolated_provider_env(monkeypatch):
    """Clé FACTICE (jamais un secret réel) + caches vidés : aucun appel réseau sortant."""
    monkeypatch.setenv("FAZERCARDS_API_KEY", "fc_dummy_unit_test_key")
    fazercards.clear_caches()
    yield
    fazercards.clear_caches()


def mock_transport(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(**kwargs):
        return real(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(fazercards.httpx, "AsyncClient", factory)


def validate_id_handler(items):
    def handler(req):
        if req.url.path.endswith("/topups/validate-id") and req.method == "GET":
            return httpx.Response(200, json={"ok": True, "items": items})
        raise AssertionError(f"appel fournisseur inattendu: {req.method} {req.url.path}")
    return handler


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items() if k != "_id"):
                return dict(doc)
        return None


class FakeDB:
    def __init__(self, games):
        self.games = FakeCollection(games)


class FakeProvider:
    """Provider factice : aucune requête réseau, aucun secret."""

    def __init__(self, *, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    async def validate_identity(self, game_id, fields):
        self.calls.append((game_id, dict(fields or {})))
        if self.error:
            raise self.error
        return self.result


def game_doc(game_id, *, policy=None, validation_category=None, sales_categories=None,
             configured=True):
    doc = {"id": game_id, "fazercards_categories_configured": configured}
    if policy:
        doc["validation_policy"] = policy
    if validation_category:
        doc["fazercards_validation_category"] = validation_category
    if sales_categories is not None:
        doc["fazercards_categories"] = sales_categories
    return doc


def mapping(category_id="pubg_mobile_auto", offer_id="uc_60", confirmed=True):
    return {"mode": "direct", "category_id": category_id, "offer_id": offer_id, "confirmed": confirmed}


# --------------------------------------------------------------------------- #
# 1. Jeu avec validation prise en charge → validation obligatoire respectée
# --------------------------------------------------------------------------- #
def test_supported_game_requires_successful_validation():
    provider = FakeProvider(result=IdentityValidation(valid=True, player_name="Kapotue", region="MG",
                                                      status="valid"))
    gate = run(identity_gate.gate_identity(FREE_FIRE, {"player_id": "123456789"},
                                           provider=provider, game=game_doc(FREE_FIRE)))
    assert gate.status == "valid" and gate.validated is True
    assert gate.policy == "required"  # défaut sûr
    snapshot = identity_gate.snapshot_validation(gate)
    assert snapshot["validated"] is True and snapshot["provider_checked"] is True
    assert snapshot["validation_status"] == "valid"
    assert identity_gate.payment_blocked_reason({"identity_snapshot": snapshot}) is None


# --------------------------------------------------------------------------- #
# 2. Identifiant invalide → aucun paiement autorisé
# --------------------------------------------------------------------------- #
def test_invalid_identifier_blocks_order_and_payment():
    provider = FakeProvider(result=IdentityValidation(valid=False, status="invalid"))
    with pytest.raises(HTTPException) as exc:
        run(identity_gate.gate_identity(CODM, {"player_id": "1" * 19},
                                        provider=provider, game=game_doc(CODM),
                                        stage=identity_gate.STAGE_ORDER))
    assert exc.value.status_code == 422
    for status in ("invalid", "unsupported_pending", "pending"):
        blocked = identity_gate.payment_blocked_reason({"identity_snapshot": {"validation_status": status}})
        assert blocked == identity_gate.PAYMENT_NOT_VALIDATED_DETAIL
    assert identity_gate.payment_blocked_reason({"identity_snapshot": {"validation_status": "valid"}}) is None


# --------------------------------------------------------------------------- #
# 3. Jeu sans validation prise en charge → autorisé UNIQUEMENT si explicite
# --------------------------------------------------------------------------- #
def test_unsupported_validation_requires_explicit_authorization():
    unsupported = IdentityValidation(valid=False, status="unsupported", reason="no_validation_target_configured")

    required_provider = FakeProvider(result=unsupported)
    with pytest.raises(HTTPException) as exc:
        run(identity_gate.gate_identity(CODM, {"player_id": "1" * 19}, provider=required_provider,
                                        game=game_doc(CODM)))
    assert exc.value.status_code == 409
    assert exc.value.detail == identity_gate.REQUIRED_UNSUPPORTED_DETAIL

    optional_provider = FakeProvider(result=unsupported)
    gate = run(identity_gate.gate_identity(CODM, {"player_id": "1" * 19}, provider=optional_provider,
                                           game=game_doc(CODM, policy=VALIDATION_OPTIONAL)))
    assert gate.status == "unsupported" and gate.validated is False
    snapshot = identity_gate.snapshot_validation(gate)
    assert snapshot["validated"] is False          # on ne prétend JAMAIS avoir vérifié
    assert snapshot["validation_status"] == "unsupported"
    assert snapshot["provider_checked"] is False
    assert identity_gate.payment_blocked_reason({"identity_snapshot": snapshot}) is None

    not_required_provider = FakeProvider(result=IdentityValidation(valid=True))
    gate2 = run(identity_gate.gate_identity(CODM, {"player_id": "1" * 19}, provider=not_required_provider,
                                            game=game_doc(CODM, policy=VALIDATION_NOT_REQUIRED)))
    assert gate2.status == "not_required" and gate2.validated is False
    assert not_required_provider.calls == []       # aucun appel fournisseur


# --------------------------------------------------------------------------- #
# 4. Erreur technique ≠ absence normale de prise en charge
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("error", [ProviderUnavailableError("boom", status_code=502),
                                   ProviderTimeout(),
                                   ProviderUnavailableError("auth", status_code=403)])
def test_technical_error_never_looks_like_unsupported(error):
    provider = FakeProvider(error=error)
    with pytest.raises(HTTPException) as exc:
        run(identity_gate.gate_identity(FREE_FIRE, {"player_id": "1"}, provider=provider,
                                        game=game_doc(FREE_FIRE)))
    assert exc.value.status_code >= 500
    assert fazercards.NOT_SUPPORTED_DETAIL not in str(exc.value.detail)
    assert exc.value.detail == identity_gate.UNAVAILABLE_DETAIL


def test_service_returns_unsupported_without_any_provider_call(monkeypatch):
    """Aucune cible configurée → `unsupported` SANS appel réseau (et jamais un faux succès)."""
    monkeypatch.setattr(fazercards, "db", FakeDB([game_doc(FREE_FIRE)]))
    mock_transport(monkeypatch, validate_id_handler([]))
    out = run(fazercards.validate_identity({"player_id": "1"}, FREE_FIRE))
    assert out["status"] == "unsupported" and out["valid"] is False


# --------------------------------------------------------------------------- #
# 5. Catégorie de vente ≠ identifiant de validation
# --------------------------------------------------------------------------- #
def test_sales_categories_are_never_used_as_validation_target(monkeypatch):
    """Configurer des catégories de VENTE ne crée jamais une cible de validation."""
    monkeypatch.setattr(fazercards, "db", FakeDB([
        game_doc(CODM, sales_categories=["codm_activision_ca"]),
    ]))
    mock_transport(monkeypatch, validate_id_handler([
        {"category_id": "codm_validation_ca", "name": "COD Mobile (validation)",
         "fields": [{"key": "player_id"}]},
    ]))
    target = run(fazercards.resolve_validation_target(CODM))
    assert target.supported is False
    assert target.reason == "no_validation_target_configured"


def test_explicit_validation_mapping_is_used_even_when_ids_differ(monkeypatch):
    monkeypatch.setattr(fazercards, "db", FakeDB([
        game_doc(CODM, validation_category="codm_validation_ca",
                 sales_categories=["codm_activision_ca", "codm_activision_kz"]),
    ]))
    mock_transport(monkeypatch, validate_id_handler([
        {"category_id": "codm_validation_ca", "name": "COD Mobile",
         "fields": [{"key": "player_id"}, {"key": "zone_id"}]},
    ]))
    target = run(fazercards.resolve_validation_target(CODM))
    assert target.supported is True
    assert target.category_id == "codm_validation_ca"      # la LISTE DE VALIDATION, pas la vente
    assert target.field_key == "player_id"
    assert target.reason == "admin_mapping"


def test_absent_validation_target_is_reported_not_guessed(monkeypatch):
    monkeypatch.setattr(fazercards, "db", FakeDB([
        game_doc(CODM, validation_category="codm_inexistant"),
    ]))
    mock_transport(monkeypatch, validate_id_handler([
        {"category_id": "codm_validation_ca", "name": "COD Mobile", "fields": [{"key": "player_id"}]},
    ]))
    target = run(fazercards.resolve_validation_target(CODM))
    assert target.supported is False and target.reason == "validation_target_not_offered"


# --------------------------------------------------------------------------- #
# 6. Produit sans chemin de livraison → vente bloquée (règle unique)
# --------------------------------------------------------------------------- #
def test_deliverability_rule_is_shared_and_fail_closed():
    ff = game_doc(FREE_FIRE, sales_categories=["ff_cat"])
    pubg = {"id": DEFAULT_GAME_ID}
    assert product_deliverable({"requires_mapping": False}, ff) is False            # non-PUBG sans mapping
    assert product_deliverable({"requires_mapping": False}, pubg) is True           # chemin manuel PUBG
    assert product_deliverable({"fazercards_mapping": mapping("ff_cat")}, ff) is True
    assert product_deliverable({"fazercards_mapping": mapping("pubg_mobile_auto")}, ff) is False
    assert product_deliverable({"fazercards_mapping": mapping(confirmed=False)}, ff) is False
    assert product_deliverable({"requires_mapping": True}, ff) is False


def test_cart_rejects_products_from_another_game():
    products = {"a": {"game_id": FREE_FIRE}, "b": {"game_id": DEFAULT_GAME_ID}}
    assert identity_gate.products_all_belong_to_game(products, FREE_FIRE) is False
    assert identity_gate.products_all_belong_to_game({"a": {"game_id": FREE_FIRE}}, FREE_FIRE) is True
    # Produit historique sans game_id → PUBG Mobile uniquement.
    assert identity_gate.products_all_belong_to_game({"a": {}}, DEFAULT_GAME_ID) is True
    assert identity_gate.products_all_belong_to_game({"a": {}}, FREE_FIRE) is False


# --------------------------------------------------------------------------- #
# 7. Région incompatible → commande bloquée
# --------------------------------------------------------------------------- #
def test_region_mismatch_blocks_fulfillment_and_order():
    conflict = identity_gate.region_blocked("IN", {"category_id": "codm_activision_ca"})
    assert conflict == ("IN", "CA")
    assert "incompatible" in identity_gate.region_mismatch_detail(conflict).lower()
    assert identity_gate.region_blocked("CA", {"category_id": "codm_activision_ca"}) is None
    assert identity_gate.region_blocked("EU", {"category_id": "codm_activision_de"}) is None
    assert identity_gate.region_blocked(None, {"category_id": "codm_activision_ca"}) is None
    assert identity_gate.region_blocked("MG", {"category_id": "pubgm_uc"}) is None


# --------------------------------------------------------------------------- #
# 8. Unité `creating` interrompue : récupération sûre, sans relance dangereuse
# --------------------------------------------------------------------------- #
def _record(status, updated_at_seconds_ago, key="MGS-ABC-1"):
    from datetime import datetime, timedelta, timezone
    return {"status": status, "provider_order_id": None, "idempotency_key": key,
            "updated_at": (datetime.now(timezone.utc) - timedelta(seconds=updated_at_seconds_ago)).isoformat(),
            "category_id": "ff_cat", "offer_id": "uc_60", "identity_snapshot": {"player_id": "1"}}


def test_interrupted_creating_unit_is_recoverable_and_never_auto_retried():
    order = {"id": "o1", "order_number": "MGS-ABC", "fazercards": _record("creating", 3600)}
    units = fzr_fulfillment.recoverable_units(order)
    assert len(units) == 1 and units[0][1]["idempotency_key"] == "MGS-ABC-1"
    # `creating` n'est pas retryable automatiquement (seuls submit_timeout/error le sont).
    assert fzr_fulfillment._sendable(order["fazercards"]) is False
    # Une unité retryable trop ancienne n'est plus relancée automatiquement (clé non fiable).
    old_error = _record("error", fzr_fulfillment.auto_retry_max_age_s() + 60)
    fresh_error = _record("error", 5)
    assert fzr_fulfillment.retry_too_old(old_error) is True
    assert fzr_fulfillment.retry_too_old(fresh_error) is False
    assert not (fzr_fulfillment._sendable(old_error) and not fzr_fulfillment.retry_too_old(old_error))
    assert fzr_fulfillment._sendable(fresh_error) and not fzr_fulfillment.retry_too_old(fresh_error)


def test_reconciling_unit_stays_flagged_until_admin_action():
    order = {"id": "o2", "order_number": "MGS-DEF",
             "fazercards": _record("needs_reconciliation", 10_000, key="MGS-DEF-1")}
    paths = [p for p, _ in fzr_fulfillment.recoverable_units(order)]
    assert paths == ["fazercards"]


def test_provider_fields_never_send_unknown_keys_or_invented_values():
    assert fzr_fulfillment._provider_fields({"player_id": "1", "zone_id": "22"},
                                            ["player_id", "zone_id"], None) == {"player_id": "1", "zone_id": "22"}
    # Le fournisseur n'attend qu'un champ : la valeur primaire du jeu y est portée.
    assert fzr_fulfillment._provider_fields({"uid": "777"}, ["player_id"], "777") == {"player_id": "777"}
    # Aucune correspondance et plusieurs champs attendus → aucun envoi approximatif (fail-closed).
    assert fzr_fulfillment._provider_fields({"uid": "777"}, ["player_id", "zone_id"], None) == {}


# --------------------------------------------------------------------------- #
# 9. PUBG Mobile historique : comportement inchangé
# --------------------------------------------------------------------------- #
def test_pubg_legacy_validation_discovery_unchanged(monkeypatch):
    mock_transport(monkeypatch, validate_id_handler([
        {"category_id": "pubg_mobile", "name": "PUBG Mobile", "fields": [{"key": "player_id"}]},
    ]))
    target = run(fazercards.resolve_validation_target("pubg-mobile"))
    assert (target.supported, target.category_id, target.field_key) == (True, "pubg_mobile", "player_id")
    assert target.reason == "pubg_legacy"
    assert run(fazercards.validation_target(None)) == ("pubg_mobile", "player_id")


def test_pubg_orders_created_before_this_fix_are_not_blocked():
    """Commande legacy : snapshot sans `validation_status` → paiement toujours autorisé."""
    legacy = {"game_id": DEFAULT_GAME_ID, "pubg_id": "52328390220",
              "identity_snapshot": {"legacy": True, "fields": {"player_id": "52328390220"}}}
    assert identity_gate.payment_blocked_reason(legacy) is None
    assert identity_gate.payment_blocked_reason(None) is None


def test_pubg_keeps_its_historical_messages_and_default_policy():
    assert validation_policy_of({"id": DEFAULT_GAME_ID}) == "required"
    assert validation_policy_of({"validation_policy": "nonsense"}) == "required"
    assert "PUBG" in identity_gate.invalid_detail(DEFAULT_GAME_ID)
    assert "PUBG" not in identity_gate.invalid_detail(FREE_FIRE)


# --------------------------------------------------------------------------- #
# 10. Panier mono-jeux + contrat de webhook inchangé
# --------------------------------------------------------------------------- #
def test_fazercards_webhook_contract_unchanged(monkeypatch):
    import hashlib
    import hmac
    secret = "ci-webhook"
    monkeypatch.setenv("FAZERCARDS_WEBHOOK_SECRET", secret)
    provider = FazerCardsProvider()
    body = b'{"event":"order.status_changed","event_id":"evt-1","data":{"order_id":"ord-1","status":"completed"}}'
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert provider.verify_webhook_signature(body, signature) is True
    assert provider.verify_webhook_signature(body, "sha256=deadbeef") is False
    assert provider.verify_webhook_signature(body, None) is False
    event = provider.parse_webhook_event({"event": "order.status_changed", "event_id": "evt-1",
                                          "data": {"order_id": "ord-1", "status": "completed",
                                                   "previous_status": "processing"}})
    assert event.event_id == "evt-1" and event.provider_order_id == "ord-1"
    assert provider.normalize_status("completed") == "completed"
    assert provider.normalize_status("unknown-status") == "processing"
