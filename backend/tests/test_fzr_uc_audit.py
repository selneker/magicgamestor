"""Audit générique des mappings UC — direct / composition exacte / manquant (règle générale, pas de cas 120 hardcodé)."""
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from test_fzr_phase3 import db, run  # noqa: F401 — réutilise loop + helpers Phase 3
from services import fzr_mapping  # noqa: E402

# Catalogue fournisseur simulé : offres UC réelles (SKU exacts uniquement). Rien n'est hardcodé côté produit.
UC_OFFERS = [("uc_60", "60 UC", "0.8800"), ("uc_325", "325 UC", "4.3000"), ("uc_660", "660 UC", "8.4000"),
             ("uc_1800", "1800 UC", "20.0000"), ("uc_3850", "3850 UC", "40.0000"), ("uc_8100", "8100 UC", "80.0000")]
CATALOG = [{"category_id": "pubg_mobile_auto", "name": "PUBG Mobile (Auto)",
            "offers": [{"offer_id": oid, "name": name, "price_usd": price} for oid, name, price in UC_OFFERS],
            "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}]


def _mock_offers(monkeypatch):
    async def fake_fresh(category_id):
        return {"category_id": "pubg_mobile_auto", "fields": [{"key": "player_id"}],
                "offers": [{"offer_id": oid, "name": name, "price_usd": price} for oid, name, price in UC_OFFERS]}
    monkeypatch.setattr(fzr_mapping.fazercards, "pubg_offers_fresh", fake_fresh)


class TestResolveDirect:
    @pytest.mark.parametrize("target,offer_id", [(60, "uc_60"), (325, "uc_325"), (660, "uc_660"),
                                                 (1800, "uc_1800"), (3850, "uc_3850")])
    def test_exact_sku_is_direct(self, target, offer_id):
        r = fzr_mapping.resolve_uc_mapping(target, CATALOG)
        assert r["mode"] == "direct" and r["offer"]["offer_id"] == offer_id


class TestResolveComposite:
    @pytest.mark.parametrize("target,expected", [
        (120, [("uc_60", 2)]),
        (180, [("uc_60", 3)]),
        (720, [("uc_660", 1), ("uc_60", 1)]),
        (985, [("uc_660", 1), ("uc_325", 1)]),
        (1320, [("uc_660", 2)]),
        (16200, [("uc_8100", 2)]),
    ])
    def test_exact_sum_is_composite(self, target, expected):
        r = fzr_mapping.resolve_uc_mapping(target, CATALOG)
        assert r["mode"] == "composite"
        assert [(c["offer_id"], c["quantity"]) for c in r["components"]] == expected
        assert sum(c["uc_amount"] * c["quantity"] for c in r["components"]) == target  # somme EXACTE


class TestResolveMissing:
    @pytest.mark.parametrize("target", [30, 90, 415])
    def test_no_exact_sum_is_missing(self, target):
        assert fzr_mapping.resolve_uc_mapping(target, CATALOG) is None  # jamais une quantité approchée


class TestNoHardcodedOfferIds:
    def test_resolution_only_uses_catalog_offers(self):
        catalog_ids = {o[0] for o in UC_OFFERS}
        for target in [120, 180, 720, 985, 1320, 16200]:
            r = fzr_mapping.resolve_uc_mapping(target, CATALOG)
            assert all(c["offer_id"] in catalog_ids for c in r["components"])
        # Sans offre 8100 dans le catalogue, 16200 se résout SANS inventer uc_8100 (9×1800 = 16200).
        reduced = [{**CATALOG[0], "offers": CATALOG[0]["offers"][:-1]}]
        r = fzr_mapping.resolve_uc_mapping(16200, reduced)
        assert r is None or all(c["offer_id"] != "uc_8100" for c in r.get("components", []))
        # Catalogue trop pauvre (seulement 325) → aucune somme exacte pour 120 → manquant, pas de faux mapping.
        only_325 = [{**CATALOG[0], "offers": [{"offer_id": "uc_325", "name": "325 UC", "price_usd": "4.3"}]}]
        assert fzr_mapping.resolve_uc_mapping(120, only_325) is None


class TestDirectMappingGuard:
    """Cause racine : un produit UC ne peut plus être lié EN DIRECT à une offre de quantité différente."""

    def test_direct_120_to_60_offer_rejected(self, monkeypatch):
        _mock_offers(monkeypatch)
        body = SimpleNamespace(mode="direct", category_id="pubg_mobile_auto", offer_id="uc_60",
                               components=None, confirmed=True)
        with pytest.raises(HTTPException) as e:
            run(fzr_mapping.build_mapping({"type": "uc", "uc_amount": 120, "name": "120 UC"}, body))
        assert e.value.status_code == 409 and "120 UC" in e.value.detail

    def test_direct_60_to_60_offer_accepted(self, monkeypatch):
        _mock_offers(monkeypatch)
        body = SimpleNamespace(mode="direct", category_id="pubg_mobile_auto", offer_id="uc_60",
                               components=None, confirmed=True)
        m = run(fzr_mapping.build_mapping({"type": "uc", "uc_amount": 60, "name": "60 UC"}, body))
        assert m["mode"] == "direct" and m["offer_id"] == "uc_60"


class TestAuditApply:
    def test_apply_corrects_false_120_to_composition(self):
        pid = str(uuid.uuid4())
        slug = f"test-uc-audit-{pid[:8]}"
        run(db.products.insert_one({
            "id": pid, "slug": slug, "type": "uc", "name": "120 UC", "uc_amount": 120, "active": True,
            "fazercards_mapping": {"mode": "direct", "category_id": "pubg_mobile_auto", "offer_id": "uc_60",
                                   "offer_name": "60 UC", "price_usd_at_link": "0.8800", "confirmed": True}}))
        try:
            run(fzr_mapping.apply_uc_audit(CATALOG, "test"))
            p = run(db.products.find_one({"id": pid}, {"_id": 0}))
            m = p["fazercards_mapping"]
            assert m["mode"] == "composite" and m["total_uc"] == 120
            assert sum(c["uc_amount"] * c["quantity"] for c in m["components"]) == 120
        finally:
            run(db.products.delete_one({"id": pid}))

    def test_apply_preserves_correct_direct_and_flags_missing(self):
        pid_ok, pid_missing = str(uuid.uuid4()), str(uuid.uuid4())
        run(db.products.insert_one({
            "id": pid_ok, "slug": f"test-uc-audit-{pid_ok[:8]}", "type": "uc", "name": "60 UC", "uc_amount": 60,
            "active": True, "fazercards_mapping": {"mode": "direct", "category_id": "pubg_mobile_auto",
                                                   "offer_id": "uc_60", "offer_name": "60 UC",
                                                   "price_usd_at_link": "0.8800", "confirmed": True}}))
        run(db.products.insert_one({
            "id": pid_missing, "slug": f"test-uc-audit-{pid_missing[:8]}", "type": "uc", "name": "30 UC",
            "uc_amount": 30, "active": True}))
        try:
            rows = run(fzr_mapping.audit_uc_products(CATALOG))
            by_id = {r["product_id"]: r for r in rows}
            assert by_id[pid_ok]["action"] == "ok"
            assert by_id[pid_missing]["resolved_mode"] == "missing"
            assert by_id[pid_missing]["action"] == "already_missing"
            # l'offre correcte n'est pas touchée
            run(fzr_mapping.apply_uc_audit(CATALOG, "test"))
            p = run(db.products.find_one({"id": pid_ok}, {"_id": 0}))
            assert p["fazercards_mapping"]["offer_id"] == "uc_60"
        finally:
            run(db.products.delete_many({"id": {"$in": [pid_ok, pid_missing]}}))

    def test_audit_output_has_no_secret(self):
        rows = run(fzr_mapping.audit_uc_products(CATALOG))
        import json
        text = json.dumps(rows).lower()
        assert "fc_" not in text and "x-api-key" not in text and "fzr.cards" not in text
