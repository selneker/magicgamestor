"""PL-SEC-HARDEN-1 E — recherche d'abonnement publique limitée par IP."""
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest


def _run(coro):
    return asyncio.run(coro)


class FakeRequest:
    headers: dict = {}
    client = SimpleNamespace(host="203.0.113.7")


class TestSubscriptionLookupRateLimit:
    def test_public_lookup_is_rate_limited_per_ip(self, monkeypatch):
        from fastapi import HTTPException
        from core import ratelimit
        from routers import orders
        monkeypatch.setattr(ratelimit, "_hits", ratelimit.defaultdict(ratelimit.deque))
        calls = []

        async def fake_active(pubg_id):
            calls.append(pubg_id)
            return {}

        limit = ratelimit.setting("ORDER_SUBS_PER_HOUR_PER_IP", 60)
        with patch.object(orders, "active_subscriptions", fake_active):
            for _ in range(limit):
                _run(orders.subscription_status(FakeRequest(), "123456789"))
            with pytest.raises(HTTPException) as exc:
                _run(orders.subscription_status(FakeRequest(), "123456789"))
        assert exc.value.status_code == 429
        assert len(calls) == limit
