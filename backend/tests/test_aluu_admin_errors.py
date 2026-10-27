"""Lot 5 — erreurs fournisseur des routes admin `preflight` / `fulfill` : jamais un 500.

Tests PURS : aucun Mongo, aucun réseau, aucune authentification. On appelle la fonction de
route directement (la dépendance `require_permission` est déjà exercée par FastAPI, elle n'est
pas le sujet ici) et on inspecte la réponse produite.

Contrat vérifié (identique à `routers/fazercards.py`) :
`{ "detail": <message neutre>, "code": <code stable>, "game_id": <jeu ou null> }`.
"""
import asyncio
import json
from types import SimpleNamespace

from routers import fzr_orders
from services.providers import errors as perr


def run(coro):
    return asyncio.run(coro)


def payload(response) -> dict:
    return json.loads(response.body)


class FakeOrders:
    """Le minimum de `db.orders` : une lecture par `id` pour retrouver `game_id`."""

    def __init__(self, documents=(), *, fail=False):
        self.documents = list(documents)
        self.fail = fail

    async def find_one(self, query, projection=None):
        if self.fail:
            raise RuntimeError("base indisponible")
        for doc in self.documents:
            if doc.get("id") == query.get("id"):
                if projection:
                    return {k: v for k, v in doc.items() if projection.get(k, 1)}
                return dict(doc)
        return None


def use_db(monkeypatch, *documents, fail=False):
    monkeypatch.setattr(fzr_orders, "db",
                        SimpleNamespace(orders=FakeOrders(documents, fail=fail)))


def test_preflight_provider_error_returns_the_additive_contract(monkeypatch):
    """`unsupported_game` en 503 : `detail` neutre, `code` stable, `game_id` renseigné."""
    use_db(monkeypatch, {"id": "ord-1", "game_id": "example-game"})

    async def boom(order_id):
        raise perr.ProviderUnavailableError(
            "Jeu configuré ALUU mais configuration incomplète.", status_code=503,
            code="unsupported_game")

    monkeypatch.setattr(fzr_orders.fzr_fulfillment, "preflight", boom)

    response = run(fzr_orders.fzr_preflight("ord-1"))

    assert response.status_code == 503
    assert payload(response) == {
        "detail": "Jeu configuré ALUU mais configuration incomplète.",
        "code": "unsupported_game",
        "game_id": "example-game",
    }


def test_fulfill_provider_error_never_500_and_falls_back_without_a_code(monkeypatch):
    """Timeout sans code nommé : 504, `provider_unavailable` par défaut, `game_id` null si la
    lecture de la commande échoue — la réponse reste un contrat, pas une exception."""
    use_db(monkeypatch, fail=True)

    async def boom(order_id, actor):
        raise perr.ProviderTimeout()

    monkeypatch.setattr(fzr_orders.fzr_fulfillment, "fulfill_order", boom)

    response = run(fzr_orders.fzr_fulfill("ord-1", {"user_id": "admin-1"}))

    assert response.status_code == 504
    assert payload(response) == {
        "detail": "timeout après soumission",
        "code": "provider_unavailable",
        "game_id": None,
    }
