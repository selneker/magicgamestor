"""Lot 4 bis — garde-fou `tests/conftest.py` : aucun test Mongo hors base de test.

Ces tests sont PURS (aucun accès Mongo) et vérifient le garde-fou lui-même : nom de base
accepté, refus immédiat de toute collection, installation au démarrage de session.
"""
import types

import pytest

import conftest
import core.db as core_db


# --------------------------------------------------------------------------- noms acceptés

@pytest.mark.parametrize("name", ["mgs_test", "MGS_TEST", "test", "mgs_test_2", "mgs-lot4-test"])
def test_a_database_name_containing_test_is_accepted(name):
    assert conftest.db_name_allows_tests(name) is True


@pytest.mark.parametrize("name", ["mgs", "mgs_prod", "production", "mgs_dev", "", None, "tes t"])
def test_any_other_database_name_is_refused(name):
    assert conftest.db_name_allows_tests(name) is False


# --------------------------------------------------------------------------- refus total

def test_every_collection_access_is_refused_before_any_query():
    guard = conftest.ForbiddenDatabase("mgs_prod")
    for access in ("orders", "games", "products", "fzr_webhook_events", "command", "client"):
        with pytest.raises(conftest.TestDatabaseRequired):
            getattr(guard, access)
    with pytest.raises(conftest.TestDatabaseRequired):
        guard["orders"]


def test_the_refusal_names_the_variable_the_value_and_the_fix():
    guard = conftest.ForbiddenDatabase("mgs_prod")
    with pytest.raises(conftest.TestDatabaseRequired) as exc:
        guard.orders.delete_many({})
    message = str(exc.value)
    assert "DB_NAME" in message
    assert "'mgs_prod'" in message
    assert "mgs_test" in message


def test_a_write_attempt_is_refused_by_the_same_message():
    """Un `delete_many` n'atteint jamais la collection : le refus est levé à l'accès `orders`."""
    guard = conftest.ForbiddenDatabase("mgs_dev")
    with pytest.raises(conftest.TestDatabaseRequired) as exc:
        guard.orders.delete_many({"id": "x"})
    assert "'mgs_dev'" in str(exc.value)


# --------------------------------------------------------------------------- démarrage de session

def test_configure_installs_the_guard_for_a_non_test_database(monkeypatch):
    original = core_db.db
    try:
        monkeypatch.setenv("DB_NAME", "mgs_production")
        conftest.pytest_configure(types.SimpleNamespace())
        assert isinstance(core_db.db, conftest.ForbiddenDatabase)
        with pytest.raises(conftest.TestDatabaseRequired):
            core_db.db.orders
    finally:
        core_db.db = original


def test_configure_leaves_a_test_database_untouched(monkeypatch):
    original = core_db.db
    try:
        monkeypatch.setenv("DB_NAME", "mgs_test")
        conftest.pytest_configure(types.SimpleNamespace())
        assert core_db.db is original
    finally:
        core_db.db = original


def test_configure_without_any_database_name_installs_the_guard(monkeypatch):
    original = core_db.db
    try:
        monkeypatch.delenv("DB_NAME", raising=False)
        conftest.pytest_configure(types.SimpleNamespace())
        assert isinstance(core_db.db, conftest.ForbiddenDatabase)
    finally:
        core_db.db = original
