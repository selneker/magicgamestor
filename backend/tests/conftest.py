"""Configuration pytest partagée : chemin `backend/`, `.env` local, et GARDE-FOU base de test.

GARDE-FOU : une session qui touche Mongo doit tourner sur une base dont le NOM contient « test ».
Si `DB_NAME` ne le contient pas, `core.db.db` est remplacé par un objet qui LÈVE dès le premier
accès : aucune lecture, aucune écriture, aucun `delete_many` ne peut atteindre la base
configurée. Le contrôle a lieu à la configuration de la session, donc avant toute collecte et
avant le premier accès Mongo.

Les tests purement logiques (faux db en mémoire, aucun Mongo) ne sont pas concernés : ils
n'accèdent jamais à `core.db.db` et continuent de tourner normalement.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

TEST_DB_MARKER = "test"


def db_name_allows_tests(name: str | None) -> bool:
    """Vrai uniquement pour un nom de base contenant « test » (insensible à la casse)."""
    return TEST_DB_MARKER in str(name or "").strip().lower()


class TestDatabaseRequired(RuntimeError):
    """Le test a tenté d'utiliser Mongo alors que `DB_NAME` n'est pas une base de test."""


class ForbiddenDatabase:
    """Substitut de `core.db.db` : tout accès à une collection lève `TestDatabaseRequired`.

    Aucune connexion n'est ouverte et aucune requête n'est construite : le refus est total,
    y compris pour une lecture (`find_one`) ou un `drop()`.
    """

    def __init__(self, name: str | None):
        self._name = name

    def _refuse(self, attribute: str):
        raise TestDatabaseRequired(
            f"DB_NAME={self._name!r} ne contient pas « {TEST_DB_MARKER} » : tests Mongo refusés "
            f"(accès `{attribute}` bloqué avant toute lecture ou écriture). "
            f"Exportez une base dédiée, par exemple `export DB_NAME=mgs_test`, puis relancez.")

    def __getattr__(self, attribute: str):
        self._refuse(attribute)

    def __getitem__(self, attribute: str):
        self._refuse(str(attribute))

    def __repr__(self) -> str:
        return f"<ForbiddenDatabase DB_NAME={self._name!r}>"


def pytest_configure(config):
    """Installe le garde-fou avant la collecte, et l'annonce une fois dans le terminal."""
    name = os.environ.get("DB_NAME")
    if db_name_allows_tests(name):
        return
    try:
        import core.db as core_db
    except Exception:  # MONGO_URL absent : les tests Mongo échoueront d'eux-mêmes à l'import
        return
    core_db.db = ForbiddenDatabase(name)
    pluginmanager = getattr(config, "pluginmanager", None)
    reporter = pluginmanager.getplugin("terminalreporter") if pluginmanager is not None else None
    message = (f"ATTENTION : DB_NAME={name!r} ne contient pas « {TEST_DB_MARKER} ». "
               "Tout accès Mongo est refusé (aucune écriture possible). "
               "Pour lancer les tests Mongo : export DB_NAME=mgs_test")
    if reporter is not None:
        reporter.write_line(message, yellow=True)
    else:
        print(message, file=sys.stderr)
