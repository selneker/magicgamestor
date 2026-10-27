"""PARTIE 2 — la configuration FOURNISSEUR d'un jeu n'est jamais exposée publiquement.

Un document `games` peut porter `provider`, `aluu_game_code`, `aluu_check_endpoint` et
`aluu_identity_map` : ces quatre champs décrivent l'infrastructure (quel fournisseur, quel code
jeu, quel endpoint de vérification, quelle table d'identité). Ils restent ADMIN.

Tests PURS : aucun Mongo, aucun réseau. La collection `games` est un double qui applique
réellement les projections d'EXCLUSION de `PUBLIC_GAME` (le point faible des autres faux db du
dépôt, qui ignorent la projection et masqueraient justement une fuite).
"""
from copy import deepcopy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.security import get_current_user
from routers import games as games_router

GAME_ID = "free-fire"
IDENTITY_FIELDS = [
    {"key": "player_id", "label": "Player ID", "pattern": r"^[0-9]{6,13}$",
     "min_length": 6, "max_length": 13, "required": True, "primary": True},
]

# Document réel d'un jeu basculé sur ALUU : les quatre champs sensibles sont présents.
ALUU_GAME_DOC = {
    "id": GAME_ID, "slug": GAME_ID, "name": "Free Fire", "active": True, "sort_order": 0,
    "currency_label": "Diamants", "description": "", "description_en": None,
    "icon_url": None, "identity_fields": IDENTITY_FIELDS, "product_types": [],
    "provider": "aluu",
    "aluu_game_code": "ff",
    "aluu_check_endpoint": "game-check",
    "aluu_identity_map": {"player_id": "characterId"},
    "fazercards_categories": ["free_fire"],
    "fazercards_categories_configured": True,
    "fazercards_validation_category": "free_fire_id",
}

FORBIDDEN = ("provider", "aluu_game_code", "aluu_check_endpoint", "aluu_identity_map")


# --------------------------------------------------------------------------- faux Mongo

class FakeCursor:
    def __init__(self, documents):
        self._documents = documents

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, length=None):
        return list(self._documents)


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        value = doc.get(key)
        if isinstance(expected, dict) and "$in" in expected:
            if value not in expected["$in"]:
                return False
        elif value != expected:
            return False
    return True


def _project(doc: dict, projection: dict | None) -> dict:
    """Projection Mongo d'EXCLUSION (`{champ: 0}`) — le seul type utilisé par PUBLIC_GAME."""
    out = deepcopy(doc)
    for key, flag in (projection or {}).items():
        if flag == 0:
            out.pop(key, None)
    return out


class FakeCollection:
    def __init__(self, documents=()):
        self.documents = [deepcopy(doc) for doc in documents]

    def find(self, query, projection=None):
        return FakeCursor([_project(doc, projection) for doc in self.documents
                           if _matches(doc, query)])

    async def find_one(self, query, projection=None):
        for doc in self.documents:
            if _matches(doc, query):
                return _project(doc, projection)
        return None

    async def insert_one(self, document):
        self.documents.append(deepcopy(document))
        return document

    async def count_documents(self, _query):
        return len(self.documents)


class FakeDb:
    def __init__(self, games=()):
        self.games = FakeCollection(games)
        self.game_identities = FakeCollection([])


@pytest.fixture
def api(monkeypatch):
    """Application réelle du routeur `games`, montée sous `/api` comme dans `server.py`."""
    fake = FakeDb([ALUU_GAME_DOC])
    monkeypatch.setattr(games_router, "db", fake)

    async def public_ids():
        return {GAME_ID}

    monkeypatch.setattr(games_router, "public_game_ids", public_ids)

    app = FastAPI()
    app.include_router(games_router.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "user-1"}
    with TestClient(app) as client:
        yield client, fake


def _assert_no_provider_config(payload: dict, *, where: str) -> None:
    leaked = [key for key in FORBIDDEN if key in payload]
    assert leaked == [], f"{where} expose {leaked}"


# --------------------------------------------------------------------------- routes publiques

def test_list_games_never_exposes_the_provider_configuration(api):
    client, fake = api
    assert fake.games.documents[0]["aluu_identity_map"]  # le document porte bien les champs

    response = client.get("/api/games")

    assert response.status_code == 200
    body = response.json()
    assert [game["id"] for game in body] == [GAME_ID]
    for game in body:
        _assert_no_provider_config(game, where="GET /api/games")
    # Le contrat de saisie du checkout reste public, inchangé.
    assert [f["key"] for f in body[0]["identity_fields"]] == ["player_id"]


def test_get_game_never_exposes_the_provider_configuration(api):
    client, _ = api

    response = client.get(f"/api/games/{GAME_ID}")

    assert response.status_code == 200
    _assert_no_provider_config(response.json(), where=f"GET /api/games/{GAME_ID}")
    assert response.json()["name"] == "Free Fire"


def test_public_identity_creation_returns_no_provider_configuration(api):
    """Route publique voisine : la réponse est l'identité, jamais un document `games`."""
    client, fake = api

    response = client.post("/api/me/game-identities",
                           json={"game_id": GAME_ID, "fields": {"player_id": "123456789"}})

    assert response.status_code == 201
    _assert_no_provider_config(response.json(), where="POST /api/me/game-identities")
    assert response.json()["fields"] == {"player_id": "123456789"}
    assert len(fake.game_identities.documents) == 1


def test_projection_is_an_exclusion_projection(api):
    """Garde-fou de la mesure : la projection publique EXCLUT, elle ne sélectionne pas."""
    client, _ = api
    game = client.get(f"/api/games/{GAME_ID}").json()

    assert "name" in game and "identity_fields" in game and "slug" in game
