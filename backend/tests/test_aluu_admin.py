"""Lot 6 — routes d'administration du fournisseur ALUU et écran de couverture.

Deux familles de preuves :

- **conformité au contrat** (`contracts/aluu-admin/`, hors dépôt) : la réponse RÉELLE du code
  est comparée à chaque fichier d'exemple — clés, ordre des clés et types — pour que le contrat
  ne dérive pas en silence. Ces tests sont ignorés si le dossier est absent
  (`MGS_CONTRACT_DIR` pour le déplacer) ;
- **règles métier** : permissions, ordre des validations, catalogue live indisponible (rien
  n'est écrit), ambiguïté en état de ligne, apply qui recalcule l'aperçu, `fazercards_mapping`
  jamais touché, projection publique inchangée.

Tests PURS : faux Mongo en mémoire (`test_aluu_fulfillment.FakeDb`), aucun réseau. Le catalogue
et les packs ALUU sont remplacés ; le reste de la chaîne est réel.
"""
import asyncio
import json
import os
import re
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from core import security
from routers import aluu_admin, fzr_orders
from services import aluu, aluu_mapping, providers
from services.providers import errors as perr
from services.providers.aluu_adapter import allowed_check_params

from test_aluu_fulfillment import FakeDb

CONTRACT_DIR = Path(os.environ.get(
    "MGS_CONTRACT_DIR", "/home/selneker/Projects/GameStore/contracts/aluu-admin"))
requires_contract = pytest.mark.skipif(
    not (CONTRACT_DIR / "screen-provider.json").exists(),
    reason=f"contrat absent ({CONTRACT_DIR}) — exportez MGS_CONTRACT_DIR pour le tester")

GAME = "example_game"
OTHER_GAME = "example_game_2"
CODE = "example_game"

SUPER = {"user_id": "admin-1", "role": "super_admin", "permissions": []}
MANAGER = {"user_id": "admin-2", "role": "admin", "permissions": ["catalog.manage"]}
READER = {"user_id": "admin-3", "role": "admin", "permissions": ["orders.manage"]}

CATALOGUE = [{"game_code": GAME, "name": "Example Game"},
             {"game_code": OTHER_GAME, "name": "Example Game 2"}]

# Deux packs de quantité 200 trouvés par leur NOM : l'appariement doit être ambigu.
PACKS = [
    {"offer_id": "100", "name": "Example Pack 0001", "price_usd": "0.0000"},
    {"offer_id": "pack-a", "name": "200 Diamonds", "price_usd": "0.0000"},
    {"offer_id": "pack-b", "name": "200 Diamonds Bonus", "price_usd": "0.0000"},
]

IDENTITY_FIELDS = [{"key": "player_id", "label": "Player ID", "required": True, "primary": True}]


def game_doc(**overrides):
    doc = {"id": GAME, "name": "Example Game", "active": True,
           "identity_fields": deepcopy(IDENTITY_FIELDS),
           "provider": "aluu", "aluu_game_code": CODE,
           "aluu_check_endpoint": "game-check",
           "aluu_identity_map": {"player_id": "characterId"}}
    doc.update(overrides)
    return doc


def bare_game(**overrides):
    """Jeu FazerCards SANS aucune configuration ALUU : état d'avant `put_config`."""
    doc = {"id": GAME, "name": "Example Game", "active": True,
           "identity_fields": deepcopy(IDENTITY_FIELDS), "provider": "fazercards"}
    doc.update(overrides)
    return doc


def product(product_id, amount, **fields):
    return {"id": product_id, "slug": product_id, "name": f"Example Pack {product_id}",
            "uc_amount": amount, "price": 5000, "type": "currency", "active": True,
            "requires_mapping": True, "game_id": GAME, **fields}


def aluu_mapping_doc(denom, *, confirmed=True, game_code=CODE, name=None):
    return {"game_code": game_code, "denom": denom, "confirmed": confirmed,
            "offer_name": name or f"Pack {denom}", "price_usd_at_link": "0.0000"}


# Les 4 états courants du contrat, dans l'ordre de l'exemple : mapped, unconfirmed, stale, missing.
CONTRACT_PRODUCTS = [
    product("PRODUCT-0001", 100, aluu_mapping=aluu_mapping_doc("100")),
    product("PRODUCT-0002", 200, aluu_mapping=aluu_mapping_doc(
        "pack-a", confirmed=False, name="Example Pack 0002")),
    product("PRODUCT-0003", 300, aluu_mapping=aluu_mapping_doc(
        "300", name="Example Pack 0003")),
    product("PRODUCT-0004", 400),
]


def run(coro):
    return asyncio.run(coro)


def body_of(response):
    """Corps JSON d'une réponse de route, qu'elle soit un `dict` ou un `JSONResponse`."""
    if isinstance(response, JSONResponse):
        return json.loads(response.body)
    return response


def status_of(response):
    return response.status_code if isinstance(response, JSONResponse) else 200


class World:
    """Monde de test APPELABLE : `world(games=[...])` installe le faux db et remet les
    compteurs à zéro, puis le test lit `world.game`, `world.audit`, `world.db`…"""

    def __init__(self, monkeypatch):
        self._monkeypatch = monkeypatch
        self.db = None
        self.audit = []
        self.catalogue_calls = 0
        self.pack_calls = []
        self.invalidations = []

    def __call__(self, *, games=(), products=(), catalogue=None, packs=None,
                 catalogue_error=None, packs_error=None):
        doc = FakeDb(games=games, products=products)
        self.db = doc
        self.audit = []
        self.catalogue_calls = 0
        self.pack_calls = []
        self.invalidations = []

        async def fake_catalogue():
            self.catalogue_calls += 1
            if catalogue_error is not None:
                raise catalogue_error
            return deepcopy(CATALOGUE if catalogue is None else catalogue)

        async def fake_packs(game_code):
            self.pack_calls.append(game_code)
            if packs_error is not None:
                raise packs_error
            return deepcopy(PACKS if packs is None else packs)

        async def fake_audit(action, actor, target=None, meta=None):
            self.audit.append({"action": action, "actor": actor, "target": target, "meta": meta})

        def fake_invalidate(game_id=None):
            self.invalidations.append(game_id)

        self._monkeypatch.setattr(aluu_admin, "db", doc)
        self._monkeypatch.setattr(aluu_mapping, "db", doc)
        self._monkeypatch.setattr(fzr_orders, "db", doc)
        self._monkeypatch.setattr(aluu, "games", fake_catalogue)
        self._monkeypatch.setattr(aluu_mapping, "live_packs", fake_packs)
        self._monkeypatch.setattr(aluu_admin, "audit", fake_audit)
        self._monkeypatch.setattr(aluu_mapping, "audit", fake_audit)
        self._monkeypatch.setattr(providers, "invalidate_provider_cache", fake_invalidate)
        self._monkeypatch.setattr(providers, "_PROVIDER_CACHE", {})
        return self

    @property
    def game(self):
        return self.db.games.documents[0]

    def actions(self):
        return [entry["action"] for entry in self.audit]


@pytest.fixture
def world(monkeypatch):
    """Faux Mongo + catalogue et packs ALUU remplacés. Tout le reste est réel."""
    return World(monkeypatch)


# --------------------------------------------------------------------------- contrat : écrans

def _assert_contract(example, actual, path="screen"):
    """Clés, ORDRE des clés et types identiques, récursivement.

    Les VALEURS ne sont pas comparées : l'exemple est fictif. Ce qui ne doit jamais dériver,
    c'est la forme de la charge utile.
    """
    assert type(actual) is type(example), \
        f"{path}: {type(actual).__name__} au lieu de {type(example).__name__}"
    if isinstance(example, dict):
        assert list(actual) == list(example), \
            f"{path}: clés {list(actual)} au lieu de {list(example)}"
        for key in example:
            _assert_contract(example[key], actual[key], f"{path}.{key}")
    elif isinstance(example, list):
        assert len(actual) == len(example), \
            f"{path}: {len(actual)} éléments au lieu de {len(example)}"
        for index, (expected_item, actual_item) in enumerate(zip(example, actual)):
            _assert_contract(expected_item, actual_item, f"{path}[{index}]")


@requires_contract
def test_provider_screen_matches_the_contract_example(world, monkeypatch):
    # L'exemple du contrat est le cas « base publique absente » : on fixe l'environnement,
    # sinon une variable exportée sur la machine changerait le type de `connection[].value`.
    for name in ("BACKEND_PUBLIC_URL", "RENDER_EXTERNAL_URL"):
        monkeypatch.delenv(name, raising=False)
    undeclared = {key: value for key, value in game_doc().items() if key != "provider"}
    world(games=[undeclared])

    response = body_of(run(aluu_admin.get_provider_screen(GAME, MANAGER)))

    example = json.loads((CONTRACT_DIR / "screen-provider.json").read_text())
    _assert_contract(example, response)


@requires_contract
def test_mapping_screen_matches_the_contract_example(world):
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS))

    response = body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))

    example = json.loads((CONTRACT_DIR / "screen-mapping.json").read_text())
    _assert_contract(example, response)


# Vocabulaire FERMÉ des formats de colonne (contrat § 2). En ajouter un est un changement de
# contrat, pas un détail d'implémentation : l'écran doit savoir le rendre.
COLUMN_FORMATS = {"text", "label_key", "money", "state", "pack", "checkbox"}


def _tables(screen):
    return [block for block in screen["blocks"] if block.get("kind") == "table"]


def test_every_table_column_of_both_screens_declares_a_known_format(world):
    """Sans `format`, l'écran devrait deviner le rendu d'une cellule : refusé par le contrat."""
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS))

    screens = (body_of(run(aluu_admin.get_provider_screen(GAME, MANAGER))),
               body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER))))

    columns = [column for screen in screens for table in _tables(screen)
               for column in table["columns"]]
    assert columns, "aucune colonne trouvée : le motif des tableaux a changé"
    assert [column["key"] for column in columns if "format" not in column] == []
    assert {column["format"] for column in columns} <= COLUMN_FORMATS


def test_no_screen_exposes_row_actions_any_more(world):
    """Les actions de ligne sont remplacées par la case à cocher de l'aperçu (contrat § 5)."""
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS))

    for screen in (body_of(run(aluu_admin.get_provider_screen(GAME, MANAGER))),
                   body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))):
        assert [block for block in screen["blocks"] if "row_actions" in block] == []


def test_the_preview_opens_with_the_selection_checkbox(world):
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS))

    screen = body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))

    assert _table(screen, "preview")["columns"][0] == {
        "key": "selected", "label_key": "admin.aluu_mapping.column.selected",
        "format": "checkbox"}


def test_each_identity_row_offers_only_the_parameters_its_endpoint_accepts(world):
    """`allowed_params` est la liste FERMÉE que l'écran peut proposer, celle de l'adapter."""
    world(games=[game_doc(aluu_identity_map={"player_id": "nope"})])

    screen = body_of(run(aluu_admin.get_provider_screen(GAME, MANAGER)))
    row = _table(screen, "identity_fields")["rows"][0]

    assert row["state"] == "missing"
    assert row["allowed_params"] == sorted(allowed_check_params("game-check"))


# ------------------------------------------------------- URL de webhook (calculée serveur, § 3.5)

def _provider_screen_with(world, monkeypatch, **env):
    """Écran fournisseur rendu avec EXACTEMENT les variables d'environnement demandées."""
    for name in ("BACKEND_PUBLIC_URL", "RENDER_EXTERNAL_URL"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    world(games=[game_doc()])
    return body_of(run(aluu_admin.get_provider_screen(GAME, MANAGER)))


def _webhook_row(screen):
    return next(row for row in _table(screen, "connection")["rows"]
                if row["key"] == "webhook_url")


def test_the_webhook_url_is_computed_from_the_public_base_url(world, monkeypatch):
    row = _webhook_row(_provider_screen_with(
        world, monkeypatch, BACKEND_PUBLIC_URL="https://api.magicgame.store"))

    assert row["value"] == "https://api.magicgame.store/api/aluu/webhook"
    assert row["configured"] is True
    assert row["state"] == "mapped"
    assert row["value_key"] == "admin.provider.connection.configured"


def test_a_trailing_slash_never_doubles_the_webhook_path(world, monkeypatch):
    row = _webhook_row(_provider_screen_with(
        world, monkeypatch, BACKEND_PUBLIC_URL="https://api.magicgame.store/"))

    assert row["value"] == "https://api.magicgame.store/api/aluu/webhook"


def test_the_render_url_is_used_when_no_public_base_url_is_set(world, monkeypatch):
    row = _webhook_row(_provider_screen_with(
        world, monkeypatch, RENDER_EXTERNAL_URL="https://mgs.onrender.com"))

    assert row["value"] == "https://mgs.onrender.com/api/aluu/webhook"
    assert row["configured"] is True


def test_without_any_public_base_url_the_webhook_row_says_not_configured(world, monkeypatch):
    row = _webhook_row(_provider_screen_with(world, monkeypatch))

    assert row == {"key": "webhook_url",
                   "label_key": "admin.provider.connection.webhook_url",
                   "value_key": "admin.provider.connection.not_configured",
                   "value": None, "configured": False, "state": "missing"}


def test_the_webhook_url_is_never_an_input_of_the_screen(world, monkeypatch):
    """Elle est calculée par le serveur : aucun bloc de saisie ne la porte."""
    screen = _provider_screen_with(
        world, monkeypatch, BACKEND_PUBLIC_URL="https://api.magicgame.store")

    inputs = [block.get("key") for block in screen["blocks"]
              if block.get("kind") in ("select", "input", "toggle", "checkbox")]
    assert "webhook_url" not in inputs


@requires_contract
def test_every_error_the_admin_router_returns_is_documented():
    """Chaque `_error(...)` du routeur doit exister dans `errors.json` avec le même HTTP."""
    source = Path(aluu_admin.__file__).read_text()
    raised = {(int(status), code) for status, code in
              re.findall(r"_error\(\s*(\d{3})\s*,\s*\"([a-z_]+)\"", source)}
    assert raised, "aucun code détecté : le motif de `_error` a changé"

    documented = {(entry["http"], entry["code"]): entry
                  for entry in json.loads((CONTRACT_DIR / "errors.json").read_text())["codes"]}
    unknown = sorted(raised - set(documented))
    assert unknown == [], f"codes non documentés : {unknown}"


@requires_contract
def test_every_label_key_used_by_the_contract_exists_in_both_languages():
    i18n = json.loads((CONTRACT_DIR / "i18n-keys.json").read_text())
    keys = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key.endswith("_key") and isinstance(value, str):
                    keys.add(value)
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for name in ("screen-provider.json", "screen-mapping.json"):
        walk(json.loads((CONTRACT_DIR / name).read_text()))
    for entry in json.loads((CONTRACT_DIR / "errors.json").read_text())["codes"]:
        keys.add(entry["label_key"])

    assert sorted(key for key in keys if key not in i18n["fr"]) == []
    assert sorted(key for key in keys if key not in i18n["en"]) == []
    assert set(i18n["fr"]) == set(i18n["en"]), "parité FR/EN rompue"


@requires_contract
def test_every_label_key_returned_by_the_code_exists_in_both_languages():
    """Les clés que le CODE renvoie (et pas seulement celles des exemples) doivent exister.

    `t()` retombe sur la clé elle-même : une clé absente s'afficherait `admin.provider.foo`.
    """
    source = Path(aluu_admin.__file__).read_text()
    used = set(re.findall(r'"((?:admin|common|errors)\.[A-Za-z0-9_.]+)"', source))
    assert len(used) > 20, "aucune clé détectée : le motif des `label_key` a changé"

    i18n = json.loads((CONTRACT_DIR / "i18n-keys.json").read_text())
    assert sorted(key for key in used if key not in i18n["fr"]) == []
    assert sorted(key for key in used if key not in i18n["en"]) == []


# --------------------------------------------------------------------------- permissions

def _client(monkeypatch, user):
    async def current_user(request):
        if user is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    monkeypatch.setattr(security, "get_current_user", current_user)
    app = FastAPI()
    app.include_router(aluu_admin.router)
    return TestClient(app)


def test_a_delegated_admin_without_catalog_manage_cannot_read_or_write(world, monkeypatch):
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS))

    with _client(monkeypatch, READER) as client:
        assert client.get(f"/admin/games/{GAME}/provider").status_code == 403
        assert client.get(f"/admin/games/{GAME}/aluu-mapping").status_code == 403
        assert client.post(f"/admin/games/{GAME}/aluu-mapping/preview").status_code == 403
        assert client.post(f"/admin/games/{GAME}/aluu-mapping/apply",
                           json={"apply": []}).status_code == 403
        assert client.put(f"/admin/games/{GAME}/provider/config",
                          json={"aluu_game_code": CODE,
                                "aluu_check_endpoint": "game-check",
                                "aluu_identity_map": {"player_id": "characterId"}}
                          ).status_code == 403


def test_an_anonymous_caller_is_rejected(world, monkeypatch):
    world(games=[game_doc()])

    with _client(monkeypatch, None) as client:
        assert client.get(f"/admin/games/{GAME}/provider").status_code == 401


def test_a_delegated_admin_can_read_but_cannot_switch_the_provider(world, monkeypatch):
    world(games=[game_doc(provider="fazercards")])

    with _client(monkeypatch, MANAGER) as client:
        assert client.get(f"/admin/games/{GAME}/provider").status_code == 200
        refused = client.put(f"/admin/games/{GAME}/provider", json={"provider": "aluu"})
        assert refused.status_code == 403

    assert world.game["provider"] == "fazercards"


def test_switching_the_provider_is_reserved_to_the_super_admin(world, monkeypatch):
    world(games=[game_doc(provider="fazercards")])

    with _client(monkeypatch, SUPER) as client:
        assert client.put(f"/admin/games/{GAME}/provider",
                          json={"provider": "aluu"}).status_code == 200

    assert world.game["provider"] == "aluu"
    assert "aluu.provider_changed" in world.actions()


# --------------------------------------------------------------------------- validation du code

def _config(code=CODE, endpoint="game-check", identity=None):
    return aluu_admin.ProviderConfigIn(
        aluu_game_code=code, aluu_check_endpoint=endpoint,
        aluu_identity_map={"player_id": "characterId"} if identity is None else identity)


def test_an_invalid_game_code_is_refused_before_any_catalogue_call(world):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(GAME, _config(code="pas de code"), MANAGER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_game_code"
    assert world.catalogue_calls == 0          # l'ordre du contrat est respecté
    assert world.game.get("aluu_game_code") is None


def test_an_unknown_game_code_is_refused_against_the_live_catalogue(world):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(GAME, _config(code="inconnu"), MANAGER))

    assert status_of(response) == 409
    assert body_of(response)["code"] == "game_code_not_in_catalog"
    assert world.game.get("aluu_game_code") is None


def test_the_catalogue_is_checked_before_the_endpoint(world):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(code="inconnu", endpoint="nope"), MANAGER))

    assert body_of(response)["code"] == "game_code_not_in_catalog"


def test_an_unknown_endpoint_is_refused(world):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(endpoint="nope"), MANAGER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_check_endpoint"
    assert world.game.get("aluu_check_endpoint") is None


@pytest.mark.parametrize("identity", [
    {},                                                        # vide
    {"player_id": "serverid"},                                 # hors liste blanche
    {"": "characterId"},                                       # clé vide
    {"player_id": ""},                                         # paramètre vide
])
def test_an_invalid_identity_map_is_refused(world, identity):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(identity=identity), MANAGER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_identity_map"
    assert world.game.get("aluu_identity_map") is None


def test_a_valid_configuration_is_written_and_audited(world):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(GAME, _config(), MANAGER))

    assert status_of(response) == 200
    assert world.game["aluu_game_code"] == CODE
    assert world.game["aluu_check_endpoint"] == "game-check"
    assert world.game["aluu_identity_map"] == {"player_id": "characterId"}
    assert world.game["provider"] == "fazercards"     # put_config n'active JAMAIS ALUU
    assert world.invalidations == [GAME]
    assert world.actions() == ["aluu.provider_config_saved"]


def test_a_null_identity_entry_unbinds_the_field_without_writing_it(world):
    """`null` = champ délié : la clé est OMISE de la table écrite (contrat § 3.1)."""
    world(games=[bare_game(identity_fields=[
        {"key": "player_id", "label": "Player ID", "required": True, "primary": True},
        {"key": "server", "label": "Server", "required": False}])])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(identity={"player_id": "characterId", "server": None}), MANAGER))

    assert status_of(response) == 200
    assert world.game["aluu_identity_map"] == {"player_id": "characterId"}


def test_an_identity_map_that_is_empty_once_nulls_are_omitted_is_refused(world):
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(identity={"player_id": None}), MANAGER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_identity_map"
    assert world.game.get("aluu_identity_map") is None
    assert world.audit == []


def test_an_identity_key_the_game_does_not_declare_is_refused(world):
    """Clé absente des champs d'identité du jeu : le mapping ne serait relié à rien (BE-007)."""
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(identity={"playerid": "characterId"}), MANAGER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_identity_map"
    assert "aluu_identity_map" not in world.game
    assert world.audit == []
    assert world.invalidations == []


def test_a_mix_of_declared_and_unknown_identity_keys_writes_nothing(world):
    """Une seule clé inconnue suffit : aucune écriture partielle, aucun audit, aucun cache vidé."""
    world(games=[bare_game()])

    response = run(aluu_admin.put_provider_config(
        GAME, _config(identity={"player_id": "characterId", "playerid": "characterId"}),
        MANAGER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_identity_map"
    assert "aluu_identity_map" not in world.game
    assert world.audit == []
    assert world.invalidations == []


def test_an_unavailable_catalogue_writes_nothing(world):
    """Règle : catalogue live indisponible ⇒ rien n'est écrit, même pour un code valide."""
    world(games=[bare_game()],
          catalogue_error=perr.ProviderUnavailableError("Catalogue ALUU indisponible.",
                                                        status_code=502))

    response = run(aluu_admin.put_provider_config(GAME, _config(), MANAGER))

    assert status_of(response) == 502     # statut unique du code, cf. errors.json
    assert body_of(response)["code"] == "provider_unavailable"
    assert "aluu_game_code" not in world.game
    assert world.audit == []
    assert world.invalidations == []


# --------------------------------------------------------------------------- bascule de fournisseur

def test_switching_to_aluu_validates_the_saved_configuration(world):
    world(games=[game_doc(provider="fazercards")])

    response = run(aluu_admin.put_game_provider(
        GAME, aluu_admin.ProviderSwitchIn(provider="aluu"), SUPER))

    assert status_of(response) == 200
    assert world.game["provider"] == "aluu"
    assert world.invalidations == [GAME]
    assert world.actions() == ["aluu.provider_changed"]


def test_switching_to_aluu_without_any_configuration_is_refused(world):
    """Configuration absente = conflit d'ÉTAT (409), pas une indisponibilité (503).

    `unsupported_game` reste réservé aux autres usages : un code = un statut (contrat § 3.2).
    """
    world(games=[{"id": GAME, "name": "Example Game"}])

    response = run(aluu_admin.put_game_provider(
        GAME, aluu_admin.ProviderSwitchIn(provider="aluu"), SUPER))

    assert status_of(response) == 409
    assert body_of(response)["code"] == "config_incomplete"
    assert "provider" not in world.game
    assert world.catalogue_calls == 0        # refus AVANT tout appel fournisseur
    assert world.audit == []


def test_switching_to_aluu_with_a_partially_saved_configuration_is_refused(world):
    """La config doit être COMPLÈTE (`aluu_config_ok`), pas seulement présente par morceaux."""
    world(games=[game_doc(provider="fazercards", aluu_identity_map={})])

    response = run(aluu_admin.put_game_provider(
        GAME, aluu_admin.ProviderSwitchIn(provider="aluu"), SUPER))

    assert status_of(response) == 409
    assert body_of(response)["code"] == "config_incomplete"
    assert world.game["provider"] == "fazercards"
    assert world.catalogue_calls == 0
    assert world.invalidations == []


def test_switching_back_to_fazercards_keeps_every_aluu_field(world):
    """Aucun `$unset` : une unité ALUU en vol doit rester reprenable après le retour."""
    world(games=[game_doc(provider="aluu")])

    response = run(aluu_admin.put_game_provider(
        GAME, aluu_admin.ProviderSwitchIn(provider="fazercards"), SUPER))

    assert status_of(response) == 200
    assert world.game["provider"] == "fazercards"
    assert world.game["aluu_game_code"] == CODE
    assert world.game["aluu_identity_map"] == {"player_id": "characterId"}


def test_an_unknown_provider_value_is_refused(world):
    world(games=[game_doc()])

    response = run(aluu_admin.put_game_provider(
        GAME, aluu_admin.ProviderSwitchIn(provider="autre"), SUPER))

    assert status_of(response) == 400
    assert body_of(response)["code"] == "invalid_payload"


def test_an_unknown_game_is_a_game_not_found(world):
    world(games=[game_doc()])

    response = run(aluu_admin.get_provider_screen("absent", MANAGER))

    assert status_of(response) == 404
    assert body_of(response)["code"] == "game_not_found"
    assert body_of(response)["game_id"] == "absent"


# --------------------------------------------------------------------------- écran de mapping

def _table(screen, key):
    """Bloc `table` de clé donnée — la clé `preview` désigne AUSSI un bouton : on filtre le kind."""
    return next(block for block in screen["blocks"]
                if block.get("kind") == "table" and block.get("key") == key)


def test_the_mapping_screen_shows_the_truth_of_aluu_mapping(world):
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS))

    screen = body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))
    rows = {row["product_id"]: row for row in _table(screen, "products")["rows"]}

    assert rows["PRODUCT-0001"]["state"] == "mapped"
    assert rows["PRODUCT-0001"]["match"]["denom"] == "100"
    assert rows["PRODUCT-0002"]["state"] == "unconfirmed"
    assert rows["PRODUCT-0003"]["state"] == "stale"
    assert rows["PRODUCT-0003"]["match"] is None
    assert rows["PRODUCT-0004"]["state"] == "missing"


def test_a_fazercards_mapping_is_never_shown_as_an_aluu_mapping(world):
    world(games=[game_doc()], products=[
        product("p-legacy", 100, fazercards_mapping={"mode": "direct", "category_id": "ff",
                                                     "offer_id": "100", "confirmed": True})])

    screen = body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))

    assert _table(screen, "products")["rows"][0]["state"] == "missing"


def test_an_unavailable_catalogue_still_renders_the_screen(world):
    world(games=[game_doc()], products=deepcopy(CONTRACT_PRODUCTS),
          packs_error=perr.ProviderUnavailableError("indisponible", status_code=502))

    screen = body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))

    assert len(_table(screen, "products")["rows"]) == 4   # la vérité locale reste affichée
    assert _table(screen, "preview")["rows"] == []        # jamais une proposition inventée


# --------------------------------------------------------------------------- aperçu

def test_preview_proposes_the_aluu_pack_itself_not_the_product_name(world):
    """`match` décrit toujours le PACK ALUU : nom et prix viennent du catalogue fournisseur."""
    world(games=[game_doc()], products=[
        product("p-100", 100, aluu_mapping=aluu_mapping_doc("100"))])

    screen = body_of(run(aluu_admin.get_mapping_screen(GAME, MANAGER)))
    row = _table(screen, "preview")["rows"][0]

    assert row["state"] == "proposed" and row["selected"] is True
    assert row["match"] == {"denom": "100", "offer_name": "Example Pack 0001",
                            "price_usd": "0.0000"}


def test_an_ambiguous_product_is_a_row_state_not_an_error(world):
    world(games=[game_doc()], products=[
        product("p-200", 200, aluu_mapping=aluu_mapping_doc("pack-a"))])

    response = run(aluu_admin.preview_mapping(GAME, MANAGER))

    assert status_of(response) == 200
    row = body_of(response)["rows"][0]
    assert row["state"] == "ambiguous"
    assert row["matched_by"] is None and row["match"] is None
    assert [candidate["denom"] for candidate in row["candidates"]] == ["pack-a", "pack-b"]


def test_preview_refuses_an_incomplete_aluu_configuration(world):
    world(games=[game_doc(aluu_check_endpoint=None)])

    response = run(aluu_admin.preview_mapping(GAME, MANAGER))

    assert status_of(response) == 503
    assert body_of(response)["code"] == "unsupported_game"


def test_preview_refuses_an_unavailable_catalogue(world):
    world(games=[game_doc()],
          packs_error=perr.ProviderUnavailableError("indisponible", status_code=502))

    response = run(aluu_admin.preview_mapping(GAME, MANAGER))

    assert status_of(response) == 502
    assert body_of(response)["code"] == "provider_unavailable"


# --------------------------------------------------------------------------- apply

def _apply(*lines):
    return aluu_admin.MappingApplyIn(
        apply=[aluu_admin.MappingLineIn(product_id=pid, denom=denom) for pid, denom in lines])


def test_apply_writes_aluu_mapping_and_never_fazercards_mapping(world):
    legacy = {"mode": "direct", "category_id": "ff", "offer_id": "100", "confirmed": True}
    world(games=[game_doc()], products=[
        product("p-100", 100, fazercards_mapping=deepcopy(legacy))])

    response = run(aluu_admin.apply_mapping(GAME, _apply(("p-100", "100")), MANAGER))

    assert status_of(response) == 200
    assert body_of(response)["written_count"] == 1
    stored = world.db.products.documents[0]
    assert stored["aluu_mapping"]["denom"] == "100"
    assert stored["aluu_mapping"]["confirmed"] is True
    assert stored["fazercards_mapping"] == legacy       # intact, jamais réinterprété
    assert world.actions() == ["aluu.mapping_applied"]


def test_apply_recomputes_the_preview_and_refuses_a_diverging_denom(world):
    world(games=[game_doc()], products=[product("p-100", 100)])

    response = run(aluu_admin.apply_mapping(GAME, _apply(("p-100", "999")), MANAGER))

    assert status_of(response) == 409
    assert body_of(response)["code"] == "mapping_stale"
    assert "aluu_mapping" not in world.db.products.documents[0]
    assert world.audit == []


def test_apply_refuses_a_pack_that_disappeared_since_the_screen(world):
    """L'aperçu est RECALCULÉ : un pack retiré du catalogue rend la ligne non applicable."""
    world(games=[game_doc()], products=[product("p-100", 100)])
    fresh_screen = body_of(run(aluu_admin.preview_mapping(GAME, MANAGER)))
    assert fresh_screen["rows"][0]["state"] == "proposed"

    world.pack_calls.clear()
    response = run(aluu_admin.apply_mapping(GAME, _apply(("p-100", "100")), MANAGER))

    assert world.pack_calls == [CODE]               # le catalogue a bien été relu
    assert status_of(response) == 200

    # Le pack disparaît entre l'écran et l'apply : la même sélection doit échouer.
    world(games=[game_doc()], products=[product("p-100", 100)], packs=PACKS[1:])
    response = run(aluu_admin.apply_mapping(GAME, _apply(("p-100", "100")), MANAGER))
    assert status_of(response) == 409
    assert body_of(response)["code"] == "mapping_stale"


def test_apply_refuses_an_ambiguous_selection(world):
    world(games=[game_doc()], products=[product("p-200", 200)])

    response = run(aluu_admin.apply_mapping(GAME, _apply(("p-200", "pack-a")), MANAGER))

    assert status_of(response) == 409
    assert body_of(response)["code"] == "mapping_stale"
    assert "aluu_mapping" not in world.db.products.documents[0]


def test_apply_refuses_a_product_outside_the_preview(world):
    world(games=[game_doc()], products=[product("p-100", 100)])

    response = run(aluu_admin.apply_mapping(GAME, _apply(("inconnu", "100")), MANAGER))

    assert status_of(response) == 404
    assert body_of(response)["code"] == "mapping_not_found"
    assert "aluu_mapping" not in world.db.products.documents[0]


def test_apply_writes_nothing_when_the_catalogue_is_unavailable(world):
    world(games=[game_doc()], products=[product("p-100", 100)],
          packs_error=perr.ProviderUnavailableError("indisponible", status_code=502))

    response = run(aluu_admin.apply_mapping(GAME, _apply(("p-100", "100")), MANAGER))

    assert status_of(response) == 502
    assert "aluu_mapping" not in world.db.products.documents[0]
    assert world.audit == []


def test_apply_is_atomic_across_the_whole_selection(world):
    world(games=[game_doc()], products=[product("p-100", 100), product("p-200", 200)])

    response = run(aluu_admin.apply_mapping(
        GAME, _apply(("p-100", "100"), ("p-200", "pack-a")), MANAGER))

    assert status_of(response) == 409
    for stored in world.db.products.documents:
        assert "aluu_mapping" not in stored          # la ligne valide n'est pas écrite non plus


# --------------------------------------------------------------------------- couverture

def test_the_coverage_screen_of_an_aluu_game_shows_aluu_offers(world):
    world(games=[game_doc()], products=[
        product("p-100", 100, aluu_mapping=aluu_mapping_doc("100")),
        product("p-legacy", 200, fazercards_mapping={"mode": "direct", "category_id": "ff",
                                                     "offer_id": "pack-a", "confirmed": True})])

    coverage = run(fzr_orders.fzr_coverage(GAME))

    assert coverage["provider"] == "aluu"
    assert coverage["catalog_unavailable"] is False
    offers = {offer["offer_id"]: offer for offer in coverage["offers"]}
    assert set(offers) == {"100", "pack-a", "pack-b"}
    assert offers["100"]["used_by"] == [{"name": "Example Pack p-100", "slug": "p-100"}]
    assert offers["pack-a"]["used_by"] == []       # le mapping FazerCards ne compte jamais
    assert offers["100"]["category_id"] == CODE


def test_the_coverage_screen_of_an_aluu_game_without_catalogue_says_so(world):
    world(games=[game_doc()],
          packs_error=perr.ProviderUnavailableError("indisponible", status_code=502))

    coverage = run(fzr_orders.fzr_coverage(GAME))

    assert coverage == {"offers": [], "provider": "aluu", "catalog_unavailable": True}


def test_the_coverage_screen_of_an_aluu_game_without_code_never_calls_fazercards(world, monkeypatch):
    world(games=[game_doc(aluu_game_code=None)])

    def forbidden(*_args, **_kwargs):
        raise AssertionError("un jeu ALUU ne doit jamais lire le catalogue FazerCards")

    monkeypatch.setattr(fzr_orders.fazercards, "catalog_for_game", forbidden)

    coverage = run(fzr_orders.fzr_coverage(GAME))

    assert coverage == {"offers": [], "provider": "aluu", "catalog_unavailable": True}


def test_the_coverage_screen_of_a_fazercards_game_is_unchanged(world, monkeypatch):
    world(games=[{"id": "pubg-mobile", "name": "PUBG Mobile"}])

    async def catalog_for_game(_game):
        return [{"category_id": "uc", "offers": [
            {"offer_id": "60", "name": "60 UC", "price_usd": "0.88"}]}]

    monkeypatch.setattr(fzr_orders.fazercards, "catalog_for_game", catalog_for_game)

    coverage = run(fzr_orders.fzr_coverage("pubg-mobile"))

    assert coverage["provider"] == "fazercards"
    assert coverage["catalog_unavailable"] is False
    assert [offer["offer_id"] for offer in coverage["offers"]] == ["60"]
