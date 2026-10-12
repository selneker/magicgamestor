"""Contrat d'identité joueur GÉNÉRIQUE multi-jeux (finalisation Admin/config).

Couvre, sans jamais contacter un vrai fournisseur ni toucher la production :
- la définition ADMIN des champs d'identité par jeu (`identity_fields`) : validation stricte,
  clés dynamiques (aucune hypothèse `player_id`), un seul champ primaire ;
- le contrat PUBG Mobile INCHANGÉ : sans déclaration explicite, il garde son identifiant
  numérique de 9 à 13 chiffres et son code de statut historique ;
- la règle FAIL-CLOSED : un jeu sans champs d'identité déclarés (ou sans catalogue livrable)
  ne peut ni être activé publiquement, ni déclencher une commande ;
- la non-fuite de la configuration fournisseur (`fazercards_categories`) sur les réponses
  publiques, tout en exposant `identity_fields` (contrat de saisie du checkout).

Tests unitaires : fonctions pures de core.games (aucune I/O).
Tests d'API : backend live (BACKEND_TEST_URL, défaut http://localhost:8001) + Mongo local.
"""
import os
import time
import uuid

import pytest
import requests
from fastapi import HTTPException

from test_fzr_phase3 import db, run  # noqa: F401 — réutilise loop + helpers Phase 3
from core.games import (DEFAULT_IDENTITY_FIELDS, check_identity_payload, identity_spec,
                        normalize_identity_fields)

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
SUPER_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@magicgame.store")
SUPER_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "AdminLocal2026!")
PUBG = "pubg-mobile"

# Déclaration d'un jeu « dynamique » : zone_id + player_id. Aucune clé n'est imposée par le domaine.
DYNAMIC_FIELDS = [
    {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$", "primary": True},
    {"key": "zone_id", "label": "Zone", "pattern": r"^[0-9]{1,5}$", "required": True},
]


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin():
    return {"Authorization": f"Bearer {_login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)}"}


# --------------------------------------------------------------------------- #
# 1. Définition ADMIN des champs d'identité (fonctions pures — aucune I/O)
# --------------------------------------------------------------------------- #

def test_normalize_identity_fields_accepts_dynamic_keys_and_sets_one_primary():
    clean = normalize_identity_fields([
        {"key": "server", "label": "Serveur"},
        {"key": "player_id", "label": "Player ID"},
    ])
    assert [f["key"] for f in clean] == ["server", "player_id"]
    assert [f["primary"] for f in clean] == [True, False], "exactement un champ primaire"
    assert all(f["required"] is True for f in clean)


def test_normalize_identity_fields_rejects_invalid_definitions():
    for bad in (
        [{"key": "Player ID", "label": "x"}],          # espace/majuscule
        [{"key": "player_id", "label": ""}],            # libellé manquant
        [{"key": "a", "label": "x"}, {"key": "a", "label": "y"}],   # clé dupliquée
        [{"key": "a", "label": "x", "pattern": "(["}],  # motif invalide
        [{"key": "a", "label": "x", "min_length": 9, "max_length": 2}],  # bornes incohérentes
        "not-a-list",
    ):
        with pytest.raises(HTTPException):
            normalize_identity_fields(bad)


def test_normalize_identity_fields_keeps_pattern_and_lengths():
    clean = normalize_identity_fields(
        [{"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,12}$",
          "min_length": 6, "max_length": 12}])
    assert clean[0]["pattern"] == r"^[0-9]{6,12}$"
    assert (clean[0]["min_length"], clean[0]["max_length"]) == (6, 12)


# --------------------------------------------------------------------------- #
# 2. Spécification effective : déclaration admin, sinon contrat PUBG historique
# --------------------------------------------------------------------------- #

def test_identity_spec_uses_declared_fields_when_present():
    assert identity_spec({"id": "custom", "identity_fields": DYNAMIC_FIELDS}) == DYNAMIC_FIELDS


def test_identity_spec_falls_back_to_legacy_pubg_contract():
    """PUBG Mobile, sans déclaration, conserve EXACTEMENT son identifiant historique."""
    spec = identity_spec({"id": PUBG})
    assert spec == DEFAULT_IDENTITY_FIELDS[PUBG]
    assert spec[0]["key"] == "player_id" and spec[0]["pattern"] == r"^[0-9]{9,13}$"
    # Un jeu inconnu sans déclaration n'a AUCUN contrat : rien n'est deviné.
    assert identity_spec({"id": "unknown-game"}) == []
    assert identity_spec(None) == []


# --------------------------------------------------------------------------- #
# 3. Validation d'une saisie contre le contrat du jeu (générique + PUBG)
# --------------------------------------------------------------------------- #

def test_check_identity_payload_accepts_generic_multi_field_input():
    checked = check_identity_payload(DYNAMIC_FIELDS, {"player_id": "123456", "zone_id": "2214"})
    assert checked is not None
    fields, primary = checked
    assert fields == {"player_id": "123456", "zone_id": "2214"}
    assert primary == "123456", "la valeur primaire alimente la colonne legacy `pubg_id`"


def test_check_identity_payload_rejects_unknown_missing_or_malformed_fields():
    assert check_identity_payload(DYNAMIC_FIELDS, {"player_id": "123456"}) is None          # zone_id manquant
    assert check_identity_payload(DYNAMIC_FIELDS, {"player_id": "123456", "zone_id": "22",
                                                   "uid": "x"}) is None                     # clé inconnue
    assert check_identity_payload(DYNAMIC_FIELDS, {"player_id": "12ab56", "zone_id": "2214"}) is None
    assert check_identity_payload(DYNAMIC_FIELDS, {}) is None
    assert check_identity_payload([], {"player_id": "123456"}) is None                       # jeu sans contrat


def test_check_identity_payload_keeps_pubg_contract_unchanged():
    spec = identity_spec({"id": PUBG})
    assert check_identity_payload(spec, {"player_id": "5123456789"}) == ({"player_id": "5123456789"}, "5123456789")
    assert check_identity_payload(spec, {"player_id": "51234567"}) is None      # 8 chiffres
    assert check_identity_payload(spec, {"player_id": "51234abcde"}) is None    # non numérique


# --------------------------------------------------------------------------- #
# 4. Fail-closed : un jeu non configuré ne déclenche aucune commande
# --------------------------------------------------------------------------- #

def test_non_pubg_order_is_refused_without_identity_contract(admin):
    """Un jeu sans champs d'identité déclarés refuse la commande (409 explicite), jamais un repli PUBG."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-noid-{tag}"
    pid = f"qa-noid-prod-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA No Identity", "active": False, "sort_order": 95})
    assert created.status_code == 201, created.text
    # Catalogue vendable sans mapping obligatoire : la SEULE raison de refus doit être l'identité.
    run(db.products.insert_one({
        "id": pid, "slug": gid, "type": "uc", "uc_amount": 60, "name": "QA NoId 60",
        "price": 5000, "active": True, "game_id": gid, "requires_mapping": False,
        "created_at": "2026-01-01T00:00:00+00:00"}))
    try:
        # Activation publique refusée : le parcours de commande n'est pas configuré.
        attempt = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA No Identity", "active": True, "sort_order": 95})
        assert attempt.status_code == 409, attempt.text
        assert "checkout" in attempt.json()["detail"].lower()
        assert gid not in [g["id"] for g in requests.get(f"{API}/games", timeout=15).json()]
    finally:
        run(db.products.delete_many({"id": pid}))
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA No Identity", "active": False, "sort_order": 95})


def test_pubg_malformed_player_id_keeps_historical_422():
    """Non-régression PUBG : l'identifiant mal formé reste refusé en 422 (avant tout traitement)."""
    products = requests.get(f"{API}/products", params={"type": "uc"}, timeout=15).json()
    pid = next(p["id"] for p in products if p.get("purchasable", True))
    for bad in ("51234567", "51234abcde"):
        r = requests.post(f"{API}/orders", json={
            "pubg_id": bad, "pseudo": "Ghost", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "mvola", "payment_phone": "0341234567"}, timeout=15)
        assert r.status_code == 422, f"{bad} → {r.status_code} {r.text}"


# --------------------------------------------------------------------------- #
# 5. Jeu dynamique entièrement configuré : activation, catalogue, commande générique
# --------------------------------------------------------------------------- #

def test_configured_dynamic_game_can_be_sold_with_generic_identity(admin):
    """Jeu à champs DYNAMIQUES : activate → catalogue visible → commande acceptée avec `identity_fields`."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-dyn-{tag}"
    pid = f"qa-dyn-prod-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Dynamic Game", "active": False, "sort_order": 94,
        "currency_label": "Diamants", "identity_fields": DYNAMIC_FIELDS})
    assert created.status_code == 201, created.text
    assert created.json()["currency_label"] == "Diamants"
    # La définition est bien persistée et renvoyée telle quelle (champs dynamiques).
    assert [f["key"] for f in created.json()["identity_fields"]] == ["player_id", "zone_id"]
    run(db.products.insert_one({
        "id": pid, "slug": gid, "type": "uc", "uc_amount": 60, "name": f"QA Dyn 60 {tag}",
        "price": 5000, "active": True, "game_id": gid, "requires_mapping": False,
        "created_at": "2026-01-01T00:00:00+00:00"}))
    try:
        # Activation désormais autorisée : identité déclarée + catalogue livrable.
        activated = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Dynamic Game", "active": True, "sort_order": 94,
            "currency_label": "Diamants", "identity_fields": DYNAMIC_FIELDS})
        assert activated.status_code == 200, activated.text
        assert activated.json()["active"] is True
        # Le contrat de saisie est exposé publiquement (le checkout en a besoin)…
        public_game = requests.get(f"{API}/games/{gid}", timeout=15)
        assert public_game.status_code == 200
        assert [f["key"] for f in public_game.json()["identity_fields"]] == ["player_id", "zone_id"]
        # …mais AUCUNE configuration fournisseur n'est divulguée.
        assert "fazercards_categories" not in public_game.json()
        assert "fazercards_categories_configured" not in public_game.json()
        # Le produit du jeu est visible dans la boutique du jeu, isolé du catalogue PUBG.
        dyn_products = requests.get(f"{API}/products", params={"game": gid}, timeout=15).json()
        assert [p["id"] for p in dyn_products] == [pid]
        assert all(p["game_id"] == gid for p in dyn_products)
        # Commande GÉNÉRIQUE : la saisie arrive via `identity_fields`, sans supposer `pubg_id`.
        order = requests.post(f"{API}/orders", json={
            "game_id": gid,
            "pubg_id": "123456", "identity_fields": {"player_id": "123456", "zone_id": "2214"},
            "pseudo": "PlayerDyn", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "manual", "manual_reference": "QA-DYN-1"}, timeout=15)
        assert order.status_code == 201, order.text
        stored = run(db.orders.find_one({"id": order.json()["id"]}, {"_id": 0}))
        assert stored["game_id"] == gid
        assert stored["identity_snapshot"]["fields"] == {"player_id": "123456", "zone_id": "2214"}
        assert stored["pubg_id"] == "123456", "la colonne legacy porte la valeur primaire"
        # Une identité non conforme au contrat du jeu est refusée (aucune valeur devinée).
        bad = requests.post(f"{API}/orders", json={
            "game_id": gid,
            "pubg_id": "123456", "identity_fields": {"player_id": "123456"},
            "pseudo": "PlayerDyn", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "manual", "manual_reference": "QA-DYN-2"}, timeout=15)
        assert bad.status_code == 422, bad.text
    finally:
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Dynamic Game", "active": False, "sort_order": 94})
        run(db.orders.delete_many({"game_id": gid}))
        run(db.products.delete_many({"id": pid}))


def test_unready_game_products_never_leak_into_the_public_catalog(admin):
    """Un jeu non prêt à la vente n'expose aucun produit dans le catalogue public global."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-leak-{tag}"
    pid = f"qa-leak-prod-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Leak Game", "active": False, "sort_order": 93})
    assert created.status_code == 201, created.text
    run(db.products.insert_one({
        "id": pid, "slug": gid, "type": "uc", "uc_amount": 60, "name": f"QA Leak 60 {tag}",
        "price": 5000, "active": True, "game_id": gid, "requires_mapping": False,
        "created_at": "2026-01-01T00:00:00+00:00"}))
    try:
        public_ids = {p["id"] for p in requests.get(f"{API}/products", timeout=15).json()}
        assert pid not in public_ids, "un produit d'un jeu non configuré a fuité dans la boutique"
        # ...et une commande pour ce jeu reste impossible.
        refused = requests.post(f"{API}/orders", json={
            "game_id": gid,
            "pubg_id": "123456", "identity_fields": {"player_id": "123456", "zone_id": "2214"},
            "pseudo": "PlayerLeak", "items": [{"product_id": pid, "quantity": 1}],
            "payment_method": "manual", "manual_reference": "QA-LEAK-1"}, timeout=15)
        assert refused.status_code in (400, 409, 422), refused.text
        assert refused.status_code != 201, "un jeu non configuré a pu déclencher une commande"
    finally:
        run(db.products.delete_many({"id": pid}))
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Leak Game", "active": False, "sort_order": 93})


def test_identity_fields_survive_a_plain_edit(admin):
    """Un simple changement de nom ne doit JAMAIS effacer le contrat d'identité du jeu."""
    tag = uuid.uuid4().hex[:6]
    gid = f"qa-keep-{tag}"
    created = requests.post(f"{API}/admin/games", headers=admin, timeout=15, json={
        "id": gid, "name": "QA Keep", "active": False, "sort_order": 92,
        "identity_fields": DYNAMIC_FIELDS})
    assert created.status_code == 201, created.text
    try:
        updated = requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Keep v2", "active": False, "sort_order": 92})
        assert updated.status_code == 200, updated.text
        assert [f["key"] for f in updated.json()["identity_fields"]] == ["player_id", "zone_id"]
    finally:
        requests.put(f"{API}/admin/games/{gid}", headers=admin, timeout=15, json={
            "id": gid, "name": "QA Keep", "active": False, "sort_order": 92})
