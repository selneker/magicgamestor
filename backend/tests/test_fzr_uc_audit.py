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


# ---------- Audit d'un autre jeu : règles du jeu + isolation stricte ----------
# Catalogue Free Fire simulé : quantités lisibles au nombre autonome unique (jamais « UC »).
FF_OFFERS = [("ff_30", "30 Diamants", "0.5000"), ("ff_70", "70 Diamants", "1.1000")]
FF_CATALOG = [{"category_id": "ff_cat_1", "name": "Free Fire",
               "offers": [{"offer_id": oid, "name": name, "price_usd": price} for oid, name, price in FF_OFFERS],
               "fields": [{"key": "player_id", "label": "Player ID", "type": "text"}]}]
FF = "free-fire"


class TestAuditGameIsolation:
    """L'audit et son application sont strictement isolés par jeu et lisent les quantités avec
    les règles du jeu audité (ici Free Fire : « 30 Diamants »), jamais celles de PUBG."""

    def test_audit_reads_only_the_audited_game(self):
        tag = uuid.uuid4().hex[:8]
        ff_generic, ff_uc = f"qa-iso-{tag}-g", f"qa-iso-{tag}-f"
        pubg_id, legacy_id = f"qa-iso-{tag}-p", f"qa-iso-{tag}-l"
        run(db.products.insert_many([
            {"id": ff_generic, "slug": ff_generic, "type": "diamonds", "name": "100 Diamants",
             "uc_amount": 100, "active": True, "game_id": FF},  # type de monnaie non « uc » : audité
            {"id": ff_uc, "slug": ff_uc, "type": "uc", "name": "30 Diamants",
             "uc_amount": 30, "active": True, "game_id": FF},
            {"id": pubg_id, "slug": pubg_id, "type": "uc", "name": "60 UC",
             "uc_amount": 60, "active": True, "game_id": "pubg-mobile"},
            {"id": legacy_id, "slug": legacy_id, "type": "uc", "name": "60 UC legacy",
             "uc_amount": 60, "active": True},
        ]))
        try:
            rows = {r["product_id"]: r for r in run(fzr_mapping.audit_uc_products(FF_CATALOG, FF))}
            assert ff_generic in rows and ff_uc in rows
            assert pubg_id not in rows and legacy_id not in rows  # isolation stricte
            assert rows[ff_generic]["resolved_mode"] == "composite"  # 30 + 70 = 100, somme exacte
            assert set(rows[ff_generic]["resolved_summary"].split(" + ")) == {"1×30 Diamants", "1×70 Diamants"}
            assert rows[ff_uc]["resolved_mode"] == "direct"
            assert rows[ff_uc]["resolved_summary"] == "30 Diamants"
            # L'audit PUBG reste PUBG + legacy historique : jamais les produits d'un autre jeu.
            pubg_rows = {r["product_id"]: r for r in run(fzr_mapping.audit_uc_products(CATALOG, "pubg-mobile"))}
            assert pubg_id in pubg_rows and legacy_id in pubg_rows
            assert ff_generic not in pubg_rows and ff_uc not in pubg_rows
        finally:
            run(db.products.delete_many({"id": {"$in": [ff_generic, ff_uc, pubg_id, legacy_id]}}))

    def test_apply_fixes_free_fire_mapping_with_ff_rules(self):
        """Cause racine : l'application relit le catalogue avec le jeu audité ; sans cela les
        offres Free Fire (« 30 Diamants ») restent illisibles et aucun correctif n'est calculable."""
        pid = f"qa-iso-fix-{uuid.uuid4().hex[:8]}"
        run(db.products.insert_one({
            "id": pid, "slug": pid, "type": "diamonds", "name": "100 Diamants", "uc_amount": 100,
            "active": True, "game_id": FF, "requires_mapping": True,
            "fazercards_mapping": {"mode": "direct", "category_id": "ff_cat_1", "offer_id": "ff_30",
                                   "offer_name": "30 Diamants", "price_usd_at_link": "0.5000", "confirmed": True}}))
        try:
            result = run(fzr_mapping.apply_uc_audit(FF_CATALOG, "test", FF))
            assert pid in {r["product_id"] for r in result["fixed"]}
            m = run(db.products.find_one({"id": pid}, {"_id": 0, "fazercards_mapping": 1}))["fazercards_mapping"]
            assert m["mode"] == "composite" and m["total_uc"] == 100
            assert sum(c["uc_amount"] * c["quantity"] for c in m["components"]) == 100
            assert {c["offer_id"] for c in m["components"]} == {"ff_30", "ff_70"}
            assert all(c["offer_name"].endswith("Diamants") for c in m["components"])
        finally:
            run(db.products.delete_one({"id": pid}))

    def test_apply_never_touches_another_game(self):
        tag = uuid.uuid4().hex[:8]
        ff_id, pubg_id = f"qa-iso-{tag}-f", f"qa-iso-{tag}-p"
        pubg_mapping = {"mode": "direct", "category_id": "pubg_mobile_auto", "offer_id": "uc_60",
                        "offer_name": "60 UC", "price_usd_at_link": "0.8800", "confirmed": True}
        run(db.products.insert_many([
            {"id": ff_id, "slug": ff_id, "type": "uc", "name": "100 Diamants", "uc_amount": 100,
             "active": True, "game_id": FF, "fazercards_mapping": None},
            {"id": pubg_id, "slug": pubg_id, "type": "uc", "name": "120 UC", "uc_amount": 120,
             "active": True, "game_id": "pubg-mobile", "fazercards_mapping": dict(pubg_mapping)},
        ]))
        try:
            result = run(fzr_mapping.apply_uc_audit(FF_CATALOG, "test", FF))
            touched = {r["product_id"] for r in result["fixed"]} | {r["product_id"] for r in result["removed"]}
            assert ff_id in touched and pubg_id not in touched  # seuls les produits du jeu audité
            stored = run(db.products.find_one({"id": pubg_id}, {"_id": 0, "fazercards_mapping": 1}))
            assert stored["fazercards_mapping"] == pubg_mapping  # PUBG strictement intact
        finally:
            run(db.products.delete_many({"id": {"$in": [ff_id, pubg_id]}}))


def _mock_offers_with_pack(monkeypatch):
    """Offres PUBG + une offre spéciale sans quantité lisible (comme aujourd'hui)."""
    offers = [{"offer_id": oid, "name": name, "price_usd": price} for oid, name, price in UC_OFFERS]
    offers.append({"offer_id": "first_purchase_pack", "name": "First Purchase Pack", "price_usd": "0.5000"})

    async def fake_fresh(category_id):
        return {"category_id": "pubg_mobile_auto", "fields": [{"key": "player_id"}], "offers": offers}
    monkeypatch.setattr(fzr_mapping.fazercards, "pubg_offers_fresh", fake_fresh)


def _body(mode, **kw):
    defaults = {"category_id": "pubg_mobile_auto", "offer_id": None, "components": None, "confirmed": True}
    return SimpleNamespace(mode=mode, **{**defaults, **kw})


class TestCurrencyLabel:
    """Libellé monnaie : PUBG = « UC » au caractère près, autres jeux = monnaie du jeu. Zéro requête DB."""

    def test_pubg_always_uc(self):
        assert fzr_mapping.get_currency_label({"type": "uc"}, "pubg-mobile") == "UC"
        assert fzr_mapping.get_currency_label({"type": "prime"}, "pubg-mobile") == "UC"
        assert fzr_mapping.get_currency_label({"type": "evo"}, None) == "UC"
        # Même si un game_data traîne, PUBG reste PUBG.
        assert fzr_mapping.get_currency_label({"type": "prime"}, "pubg-mobile",
                                              {"currency_label": "Diamants"}) == "UC"

    def test_other_game_uses_loaded_currency_label(self):
        game = {"currency_label": "Diamants", "product_types": [{"key": "diamonds", "label": "Diamants FF"}]}
        assert fzr_mapping.get_currency_label({"type": "diamonds"}, "free-fire", game) == "Diamants"

    def test_other_game_falls_back_to_type_label_then_units(self):
        declared = {"product_types": [{"key": "diamonds", "label": "Diamants FF"}]}
        assert fzr_mapping.get_currency_label({"type": "diamonds"}, "free-fire", declared) == "Diamants FF"
        assert fzr_mapping.get_currency_label({"type": "coins"}, "free-fire", declared) == "unités"
        # Jeu non chargé par l'appelant : aucun accès DB ici, repli neutre.
        assert fzr_mapping.get_currency_label({"type": "diamonds"}, "free-fire", None) == "unités"

    def test_label_is_never_the_raw_type_key(self):
        assert fzr_mapping.get_currency_label({"type": "diamonds"}, "free-fire", {}) != "diamonds"


class TestPubgMessagesUnchanged:
    """Régression PUBG : chaque message reste identique au caractère près."""

    def test_direct_mismatch_message(self, monkeypatch):
        _mock_offers(monkeypatch)
        with pytest.raises(HTTPException) as e:
            run(fzr_mapping.build_mapping({"type": "uc", "uc_amount": 120, "name": "120 UC"},
                                          _body("direct", offer_id="uc_60")))
        assert e.value.status_code == 409
        assert e.value.detail == ("Mapping direct invalide : « 60 UC » = 60 UC ≠ 120 UC attendus. "
                                  "Utilisez l'offre exacte ou une composition dont la somme vaut exactement 120 UC.")

    @pytest.mark.parametrize("type_key", ["prime", "prime_plus", "evo"])
    def test_subscription_composition_refusal_message(self, monkeypatch, type_key):
        _mock_offers(monkeypatch)
        with pytest.raises(HTTPException) as e:
            run(fzr_mapping.build_mapping({"type": type_key, "uc_amount": 0, "name": "Prime"},
                                          _body("composite", components=[SimpleNamespace(offer_id="uc_60", quantity=1)])))
        assert e.value.status_code == 409
        assert e.value.detail == ("La composition n'est autorisée que pour les produits UC. "
                                  "Prime / Prime Plus / Pack évolutif : mapping direct uniquement.")

    def test_unreadable_component_message(self, monkeypatch):
        _mock_offers_with_pack(monkeypatch)
        with pytest.raises(HTTPException) as e:
            run(fzr_mapping.build_mapping(
                {"type": "uc", "uc_amount": 120, "name": "120 UC"},
                _body("composite", components=[SimpleNamespace(offer_id="first_purchase_pack", quantity=1)])))
        assert e.value.status_code == 409
        assert e.value.detail == "« First Purchase Pack » n'est pas une offre UC : composition refusée."

    def test_wrong_sum_message(self, monkeypatch):
        _mock_offers(monkeypatch)
        with pytest.raises(HTTPException) as e:
            run(fzr_mapping.build_mapping({"type": "uc", "uc_amount": 120, "name": "120 UC"},
                                          _body("composite", components=[SimpleNamespace(offer_id="uc_60", quantity=1)])))
        assert e.value.status_code == 409
        assert e.value.detail == ("Composition invalide : 60 UC ≠ 120 UC attendus. "
                                  "La somme des composants doit être exactement égale au produit vendu.")

    def test_valid_composite_document(self, monkeypatch):
        _mock_offers(monkeypatch)
        m = run(fzr_mapping.build_mapping({"type": "uc", "uc_amount": 120, "name": "120 UC"},
                                          _body("composite", components=[SimpleNamespace(offer_id="uc_60", quantity=2)])))
        assert set(m) == {"category_id", "confirmed", "linked_at", "mode", "components",
                          "total_uc", "total_price_usd_at_link"}
        assert {k: v for k, v in m.items() if k != "linked_at"} == {
            "category_id": "pubg_mobile_auto", "confirmed": True, "mode": "composite",
            "components": [{"offer_id": "uc_60", "offer_name": "60 UC", "quantity": 2,
                            "uc_amount": 60, "price_usd_at_link": "0.8800"}],
            "total_uc": 120, "total_price_usd_at_link": 1.76}

    def test_valid_direct_document(self, monkeypatch):
        _mock_offers(monkeypatch)
        m = run(fzr_mapping.build_mapping({"type": "uc", "uc_amount": 60, "name": "60 UC"},
                                          _body("direct", offer_id="uc_60")))
        assert {k: v for k, v in m.items() if k != "linked_at"} == {
            "category_id": "pubg_mobile_auto", "confirmed": True, "mode": "direct",
            "offer_id": "uc_60", "offer_name": "60 UC", "price_usd_at_link": "0.8800"}


class TestIsCurrencyProduct:
    """Un seul critère pour tous les jeux : quantité > 0 et type hors prime / prime_plus / evo."""

    @pytest.mark.parametrize("product,expected", [
        ({"type": "uc", "uc_amount": 60}, True),
        ({"type": "diamonds", "uc_amount": 100}, True),   # autre jeu, type non réservé
        ({"type": "cp", "uc_amount": 400}, True),
        ({"uc_amount": 100}, True),                       # type absent = non réservé
        ({"type": "prime", "uc_amount": 60}, False),
        ({"type": "prime_plus", "uc_amount": 60}, False),
        ({"type": "evo", "uc_amount": 170}, False),       # le type réservé prime sur la quantité
        ({"type": "uc", "uc_amount": 0}, False),
        ({"type": "uc"}, False),
        ({"type": "uc", "uc_amount": -5}, False),
    ])
    def test_semantics(self, product, expected):
        assert fzr_mapping.is_currency_product(product) is expected


class TestQuantityReading:
    """Lecture de la quantité d'une offre. PUBG : comportement historique au bit près.
    Autres jeux : un seul nombre AUTONOME dans le nom → lu ; zéro, plusieurs, ou chiffres
    inclus dans un mot (MP40) → refus (None), jamais une quantité devinée."""

    @pytest.mark.parametrize("offer,expected", [
        ({"offer_id": "x", "name": "60 UC"}, 60),
        ({"offer_id": "x", "name": "8 100 UC"}, 8100),      # espaces historiques
        ({"offer_id": "x", "name": "60UC"}, 60),            # collage historique
        ({"offer_id": "60_uc", "name": ""}, 60),            # offer_id historique
        ({"offer_id": "x", "name": "1,000 UC"}, None),      # virgule : jamais lue (inchangé)
        ({"offer_id": "x", "name": "First Purchase Pack"}, None),
    ])
    def test_pubg_unchanged(self, offer, expected):
        assert fzr_mapping.uc_amount_of(offer, "pubg-mobile") == expected
        assert fzr_mapping.uc_amount_of(offer) == expected
        assert fzr_mapping.uc_amount_of(offer, None) == expected

    @pytest.mark.parametrize("offer,expected", [
        # Free Fire (fixtures) : un seul nombre autonome → lu
        ({"offer_id": "ff_30", "name": "30 Diamants"}, 30),
        ({"offer_id": "ff_70", "name": "70 Diamants"}, 70),
        ({"offer_id": "ff_1000", "name": "1000 Diamants"}, 1000),
        # CODM (fixtures) : un seul nombre autonome → lu
        ({"offer_id": "cp_80", "name": "80 CP"}, 80),
        ({"offer_id": "cp_400", "name": "400 CP"}, 400),
        # Aucun nombre, plusieurs nombres, séparateur de milliers ou chiffres dans un mot → refus
        ({"offer_id": "ff_ambig", "name": "Diamonds Pack"}, None),
        ({"offer_id": "ff_two", "name": "20 30 Diamonds"}, None),
        ({"offer_id": "ff_bonus", "name": "500+50 Diamants"}, None),
        ({"offer_id": "ff_spaced", "name": "1 000 Diamants"}, None),
        ({"offer_id": "cp_pass", "name": "Battle Pass"}, None),
        ({"offer_id": "cp_weapon", "name": "MP40 Bundle"}, None),
        ({"offer_id": "cp_two", "name": "40 80 CP"}, None),
    ])
    def test_other_games_standalone_number_only(self, offer, expected):
        assert fzr_mapping.uc_amount_of(offer, "free-fire") == expected
