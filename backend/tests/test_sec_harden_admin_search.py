"""PL-SEC-HARDEN-1 C — recherche admin : métacaractères regex et longueur."""
import asyncio
import re
from types import SimpleNamespace
from unittest.mock import patch


def _run(coro):
    return asyncio.run(coro)


class _EmptyCursor:
    def sort(self, *args, **kwargs):
        return self

    def skip(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def __aiter__(self):
        self._it = iter([])
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class FakeUsers:
    def __init__(self):
        self.query = None

    async def count_documents(self, query):
        self.query = query
        return 0

    def find(self, query, projection):
        self.query = query
        return _EmptyCursor()


class TestAdminSearchReDoS:
    def test_regex_metacharacters_are_escaped(self):
        from routers import admin_users
        fake = FakeUsers()
        with patch.object(admin_users, "db", SimpleNamespace(users=fake)):
            _run(admin_users.list_users(admin={}, search="a.*(b)+", page=1, page_size=20))
        assert fake.query["$or"][0]["name"]["$regex"] == re.escape("a.*(b)+")

    def test_search_term_is_capped_at_100_characters(self):
        import inspect
        from routers import admin_users
        default = inspect.signature(admin_users.list_users).parameters["search"].default
        assert any(getattr(m, "max_length", None) == 100 for m in default.metadata)
