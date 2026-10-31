"""Protection du quota Neferbyte — cache, compteur et plafond (PL-003-BE-5).

Tests 100 % hors réseau (transport httpx simulé) et hors Mongo (collection de quota en mémoire,
horloge simulée). On vérifie :

- le cache ne mémorise QUE les `ok`, avec une clé hachée, et expire après le TTL ;
- le compteur incrémente une fois par tentative HTTP réelle, nouvel essai compris, par jour UTC ;
- plafond atteint ou « daily limit » du fournisseur : aucun appel, résultat `provider_unavailable` ;
- cache en panne = appel direct compté ; compteur en panne = appel bloqué (fail-closed) ;
- Free Fire et PUBG Mobile (FazerCards) ne passent jamais par le garde.
"""
import asyncio
import logging
from types import SimpleNamespace

import httpx
import pytest
from pymongo.errors import DuplicateKeyError

from services import neferbyte, neferbyte_guard as guard
from services.providers import NeferbyteProvider, resolve_identity_provider

KEY = "0123456789abcdef0123456789abcdef"
GAME_ID = "1958604115"
OTHER_ID = "1958604116"
NICKNAME = "PlayerOne"
REAL_ASYNC_CLIENT = httpx.AsyncClient  # capturé avant tout monkeypatch


def run(coro):
    return asyncio.run(coro)


def ok_body(username: str = NICKNAME) -> dict:
    return {"success": True, "data": {"game": "G", "userId": GAME_ID, "username": username}}


def error_body(message: str) -> dict:
    return {"error": True, "msg": message}


def mock_http(monkeypatch, handler):
    """Transport httpx simulé : aucun paquet ne quitte la machine."""
    monkeypatch.setattr(neferbyte.httpx, "AsyncClient",
                        lambda **kwargs: REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)))


# --------------------------------------------------------------------------- #
# Doubles : collection de quota en mémoire
# --------------------------------------------------------------------------- #
class FakeQuotaCollection:
    """`neferbyte_quota` en mémoire : mêmes sémantiques que les appels utilisés par le garde."""

    def __init__(self, *, race_once: bool = False, failing: bool = False) -> None:
        self.docs: dict[str, dict] = {}
        self.writes = 0
        self.updates = 0
        self.race_once = race_once          # simule une course sur l'insertion du jour
        self.failing = failing              # simule une base indisponible

    # ---- helpers ----
    @staticmethod
    def _matches(doc: dict | None, query: dict) -> bool:
        if doc is None:
            return False
        for key, expected in query.items():
            value = doc.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and value == expected["$ne"]:
                    return False
                if "$lt" in expected and not (isinstance(value, int) and value < expected["$lt"]):
                    return False
                continue
            if value != expected:
                return False
        return True

    @staticmethod
    def _apply(doc: dict, update: dict) -> None:
        for key, value in (update.get("$inc") or {}).items():
            doc[key] = int(doc.get(key) or 0) + value
        for key, value in (update.get("$set") or {}).items():
            doc[key] = value
        for key, value in (update.get("$max") or {}).items():
            doc[key] = max(int(doc.get(key) or 0), value)

    # ---- API Mongo utilisée par le garde ----
    async def find_one(self, query, projection=None):
        if self.failing:
            raise RuntimeError("mongo down")
        return dict(self.docs[query["_id"]]) if query.get("_id") in self.docs else None

    async def find_one_and_update(self, query, update, upsert=False, return_document=None, **kwargs):
        if self.failing:
            raise RuntimeError("mongo down")
        self.writes += 1
        existing = self.docs.get(query["_id"])
        if not self._matches(existing, query):
            if not upsert:
                return None
            if existing is not None or self.race_once:
                self.race_once = False
                # Le document du jour vient d'être créé par un autre processus.
                self.docs.setdefault(query["_id"], {"_id": query["_id"], "attempts": 1})
                raise DuplicateKeyError("E11000 duplicate key error")
            existing = {"_id": query["_id"]}
            self.docs[query["_id"]] = existing
        self._apply(existing, update)
        return dict(existing)

    async def update_one(self, query, update, upsert=False, **kwargs):
        if self.failing:
            raise RuntimeError("mongo down")
        self.updates += 1
        doc = self.docs.get(query["_id"])
        if doc is None:
            if not upsert:
                return SimpleNamespace(modified_count=0)
            doc = {"_id": query["_id"]}
            self.docs[query["_id"]] = doc
        self._apply(doc, update)
        return SimpleNamespace(modified_count=1)

    def attempts(self, date: str) -> int:
        return int(self.docs.get(date, {}).get("attempts") or 0)


@pytest.fixture
def quota(monkeypatch):
    collection = FakeQuotaCollection()
    monkeypatch.setattr(guard, "db", {guard.QUOTA_COLLECTION: collection})
    return collection


@pytest.fixture(autouse=True)
def guard_env(monkeypatch, quota):
    """Environnement neutre + délais d'attente neutralisés + état du garde remis à zéro."""
    monkeypatch.setenv("NEFERBYTE_API_KEY", KEY)
    monkeypatch.delenv(guard.CACHE_TTL_ENV, raising=False)
    monkeypatch.delenv(guard.DAILY_LIMIT_ENV, raising=False)
    monkeypatch.delenv(guard.CACHE_SECRET_ENV, raising=False)
    monkeypatch.delenv("NEFERBYTE_TIMEOUT_S", raising=False)

    async def fake_sleep(seconds: float) -> None:
        return None

    monkeypatch.setattr(neferbyte, "_sleep", fake_sleep)
    guard.reset_state()
    yield
    guard.reset_state()


def today() -> str:
    return guard._today()


def handler_counting(result_factory):
    """Handler httpx qui compte les requêtes et renvoie une réponse programmée."""
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return result_factory(len(seen))

    return handler, seen


# --------------------------------------------------------------------------- #
# 1. Cache des succès uniquement
# --------------------------------------------------------------------------- #
def test_two_identical_validations_within_ttl_make_one_http_call(monkeypatch):
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    first = run(guard.verify_identity("free-fire", GAME_ID))
    second = run(guard.verify_identity("free-fire", GAME_ID))

    assert first.status == second.status == neferbyte.OK
    assert first.player_name == second.player_name == NICKNAME
    assert len(seen) == 1                       # un seul appel HTTP
    assert len(guard._cache) == 1
    assert run(guard.quota_snapshot())["attempts"] == 1


def test_cache_expires_after_the_ttl(monkeypatch):
    now = {"t": 1_000.0}
    monkeypatch.setattr(guard, "_clock", lambda: now["t"])
    monkeypatch.setenv(guard.CACHE_TTL_ENV, "600")
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    run(guard.verify_identity("free-fire", GAME_ID))
    now["t"] += 599                             # dans le TTL
    run(guard.verify_identity("free-fire", GAME_ID))
    assert len(seen) == 1

    now["t"] += 2                               # TTL dépassé
    run(guard.verify_identity("free-fire", GAME_ID))
    assert len(seen) == 2


def test_cache_can_be_disabled(monkeypatch):
    monkeypatch.setenv(guard.CACHE_TTL_ENV, "0")
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    run(guard.verify_identity("free-fire", GAME_ID))
    run(guard.verify_identity("free-fire", GAME_ID))

    assert len(seen) == 2 and len(guard._cache) == 0


@pytest.mark.parametrize("message, status, reason", [
    ("The ID field must contain only numbers.", neferbyte.INVALID_ID, "invalid_entry"),
    ("You have reached your daily limit today.", neferbyte.PROVIDER_UNAVAILABLE, "quota"),
    ("Under maintenance.", neferbyte.PROVIDER_UNAVAILABLE, "maintenance"),
])
def test_non_ok_results_are_never_cached(monkeypatch, message, status, reason):
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "100")   # « daily limit » n'est pas le plafond local
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=error_body(message)))
    mock_http(monkeypatch, handler)

    first = run(guard.verify_identity("free-fire", GAME_ID))
    if status == neferbyte.PROVIDER_UNAVAILABLE and reason == "quota":
        guard.reset_state()                     # le jour est clos : on repart d'un état neuf
        second = run(guard.verify_identity("free-fire", GAME_ID))
        assert second.status == neferbyte.PROVIDER_UNAVAILABLE
        return
    second = run(guard.verify_identity("free-fire", GAME_ID))

    assert (first.status, first.reason) == (status, reason)
    assert second.status == status
    assert len(seen) == 2                       # aucun des deux n'a été servi par le cache
    assert len(guard._cache) == 0


def test_ok_is_never_returned_without_a_real_provider_success(monkeypatch):
    """Un `ok` en cache vient toujours d'une réponse réelle : un échec ne valide jamais."""
    handler, seen = handler_counting(
        lambda n: httpx.Response(200, json=ok_body() if n == 1 else error_body("Under maintenance.")))
    mock_http(monkeypatch, handler)

    assert run(guard.verify_identity("free-fire", GAME_ID)).status == neferbyte.OK
    # L'entrée en cache reste servie (elle est réelle), mais sans nouvelle validation inventée.
    cached = run(guard.verify_identity("free-fire", GAME_ID))
    assert cached.status == neferbyte.OK and len(seen) == 1


def test_cached_result_is_not_shared_with_the_caller(monkeypatch):
    """Modifier un résultat reçu ne change pas la réponse suivante : le cache est copié."""
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    first = run(guard.verify_identity("free-fire", GAME_ID))
    assert first.status == neferbyte.OK
    first.player_name = "Mutated"
    first.region = "mutated"
    first.status = neferbyte.INVALID_ID
    first.raw["username"] = "Mutated"

    second = run(guard.verify_identity("free-fire", GAME_ID))
    assert second.status == neferbyte.OK and second.player_name == NICKNAME
    assert second.region is None and second.raw["username"] == NICKNAME
    assert second is not first
    assert len(seen) == 1

    # Deux lectures du cache ne rendent pas non plus le même objet.
    third = run(guard.verify_identity("free-fire", GAME_ID))
    assert third is not second and third.status == neferbyte.OK
    assert len(seen) == 1


# --------------------------------------------------------------------------- #
# 2. Clé de cache hachée, aucune fuite
# --------------------------------------------------------------------------- #
def test_cache_key_is_hashed_and_never_contains_the_id():
    key = guard.cache_key("free-fire", GAME_ID, None)

    assert len(key) == 64 and all(c in "0123456789abcdef" for c in key)
    assert GAME_ID not in key and NICKNAME not in key
    assert key == guard.cache_key("free-fire", GAME_ID, None)          # stable
    assert key != guard.cache_key("free-fire", OTHER_ID, None)         # sensible à l'ID
    assert key != guard.cache_key("mobile-legends", GAME_ID, "1")      # sensible au slug/serveur


def test_cache_key_uses_a_server_side_secret(monkeypatch):
    first = guard.cache_key("free-fire", GAME_ID, None)
    monkeypatch.setenv(guard.CACHE_SECRET_ENV, "another-server-secret")
    assert guard.cache_key("free-fire", GAME_ID, None) != first


def test_logs_never_contain_id_nickname_or_cache_key(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    key = guard.cache_key("free-fire", GAME_ID, None)

    mock_http(monkeypatch, lambda request: httpx.Response(200, json=ok_body()))
    run(guard.verify_identity("free-fire", GAME_ID))
    run(guard.verify_identity("free-fire", GAME_ID))          # touche le cache

    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "1")
    guard.reset_state()
    mock_http(monkeypatch, lambda request: httpx.Response(200, json=error_body(
        "You have reached your daily limit today.")))
    run(guard.verify_identity("free-fire", OTHER_ID))         # plafond + épuisement
    run(guard.verify_identity("free-fire", OTHER_ID))         # refus, sans appel

    text = caplog.text
    assert GAME_ID not in text and OTHER_ID not in text
    assert NICKNAME not in text and KEY not in text and key not in text


# --------------------------------------------------------------------------- #
# 3. Compteur de quota
# --------------------------------------------------------------------------- #
def test_every_http_attempt_is_counted_including_the_retry(monkeypatch, quota):
    """Erreur serveur puis succès : deux requêtes HTTP, deux incréments."""
    handler, seen = handler_counting(
        lambda n: httpx.Response(503, json=error_body("upstream")) if n == 1
        else httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    result = run(guard.verify_identity("free-fire", GAME_ID))

    assert result.status == neferbyte.OK
    assert len(seen) == 2
    assert quota.attempts(today()) == 2


def test_counter_is_reset_on_the_next_utc_day(monkeypatch, quota):
    days = iter(["2026-10-30", "2026-10-30", "2026-10-31"])
    monkeypatch.setattr(guard, "_today", lambda: next(days, "2026-10-31"))
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    run(guard.verify_identity("free-fire", GAME_ID))
    run(guard.verify_identity("free-fire", OTHER_ID))
    run(guard.verify_identity("free-fire", "1958604117"))

    assert len(seen) == 3
    assert quota.attempts("2026-10-30") == 2     # deux appels le 30
    assert quota.attempts("2026-10-31") == 1     # remise à zéro le 31
    assert run(guard.quota_snapshot())["attempts"] == 1


def test_quota_document_holds_no_identity(monkeypatch, quota):
    handler, _ = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    run(guard.verify_identity("free-fire", GAME_ID))

    doc = quota.docs[today()]
    assert set(doc) <= {"_id", "attempts", "exhausted"}
    assert GAME_ID not in repr(doc) and NICKNAME not in repr(doc)


def test_concurrent_attempts_never_exceed_the_cap(monkeypatch, quota):
    """Le plafond est porté par le filtre `$lt` : dix réservations simultanées, trois au plus."""
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "3")

    async def ten_reservations() -> list[bool]:
        return await asyncio.gather(*[guard._reserve_attempt() for _ in range(10)])

    allowed = run(ten_reservations())

    assert sum(allowed) == 3
    assert quota.attempts(today()) == 3


# --------------------------------------------------------------------------- #
# 4. Plafond
# --------------------------------------------------------------------------- #
def test_cap_blocks_every_following_call_without_any_http_call(monkeypatch, quota):
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "2")
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    assert run(guard.verify_identity("free-fire", GAME_ID)).status == neferbyte.OK
    assert run(guard.verify_identity("free-fire", OTHER_ID)).status == neferbyte.OK

    blocked = run(guard.verify_identity("free-fire", "1958604117"))
    assert blocked.status == neferbyte.PROVIDER_UNAVAILABLE and blocked.reason == "quota_guard"
    assert len(seen) == 2                       # aucun appel de plus
    assert quota.attempts(today()) == 2


def test_cap_wins_over_a_cached_success(monkeypatch, quota):
    """Plafond atteint = `provider_unavailable`, même pour une identité déjà en cache."""
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "1")
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    assert run(guard.verify_identity("free-fire", GAME_ID)).status == neferbyte.OK
    assert len(guard._cache) == 1

    again = run(guard.verify_identity("free-fire", GAME_ID))
    assert again.status == neferbyte.PROVIDER_UNAVAILABLE
    assert len(seen) == 1


def test_provider_daily_limit_marks_the_day_exhausted(monkeypatch, quota):
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "50")
    handler, seen = handler_counting(
        lambda n: httpx.Response(200, json=error_body("You have reached your daily limit today.")))
    mock_http(monkeypatch, handler)

    first = run(guard.verify_identity("free-fire", GAME_ID))
    assert first.status == neferbyte.PROVIDER_UNAVAILABLE and first.reason == "quota"
    assert quota.docs[today()]["exhausted"] is True

    second = run(guard.verify_identity("free-fire", OTHER_ID))
    assert second.status == neferbyte.PROVIDER_UNAVAILABLE and second.reason == "quota_guard"
    assert len(seen) == 1                       # le second appel n'a même pas été tenté


def test_http_429_without_a_daily_limit_indication_does_not_close_the_day(monkeypatch, quota):
    """Un 429 de débit momentané reste compté et ne coupe pas Neferbyte jusqu'à 00:00 UTC."""
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "50")
    handler, seen = handler_counting(lambda n: httpx.Response(429, json=error_body("Too many requests")))
    mock_http(monkeypatch, handler)

    first = run(guard.verify_identity("free-fire", GAME_ID))
    assert first.status == neferbyte.PROVIDER_UNAVAILABLE and first.reason == "rate_limited"
    assert quota.docs[today()].get("exhausted") is not True
    assert guard._blocked() is False

    # La journée reste ouverte : l'appel suivant repart réellement chez le fournisseur.
    second = run(guard.verify_identity("free-fire", OTHER_ID))
    assert second.status == neferbyte.PROVIDER_UNAVAILABLE and second.reason == "rate_limited"
    assert len(seen) == 2
    assert quota.attempts(today()) == 2        # chaque tentative reste comptée


def test_http_429_with_a_daily_limit_message_closes_the_day(monkeypatch, quota):
    """Le 429 qui annonce le quota journalier ferme bien la journée."""
    handler, seen = handler_counting(lambda n: httpx.Response(
        429, json=error_body("You have reached your daily limit today.")))
    mock_http(monkeypatch, handler)

    assert run(guard.verify_identity("free-fire", GAME_ID)).reason == "quota"
    assert quota.docs[today()]["exhausted"] is True
    assert run(guard.verify_identity("free-fire", OTHER_ID)).reason == "quota_guard"
    assert len(seen) == 1


def test_eighty_percent_warning_is_logged_once(monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "5")
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    for player in (GAME_ID, OTHER_ID, "1958604117", "1958604118"):
        run(guard.verify_identity("free-fire", player))

    hits = [line for line in caplog.messages if "80 %" in line]
    assert len(hits) == 1 and "4/5" in hits[0]
    assert len(seen) == 4


def test_no_cap_still_counts_and_warns(monkeypatch, caplog, quota):
    caplog.set_level(logging.WARNING)
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    run(guard.verify_identity("free-fire", GAME_ID))
    run(guard.verify_identity("free-fire", OTHER_ID))

    assert len(seen) == 2 and quota.attempts(today()) == 2
    warnings = [line for line in caplog.messages if guard.DAILY_LIMIT_ENV in line]
    assert len(warnings) == 1                   # avertissement unique, pas un par appel


# --------------------------------------------------------------------------- #
# 5. Pannes
# --------------------------------------------------------------------------- #
def test_cache_failure_falls_back_to_a_direct_counted_call(monkeypatch, quota):
    class BrokenCache:
        def get(self, key):
            raise RuntimeError("cache down")

        def put(self, key, check):
            raise RuntimeError("cache down")

        def clear(self):
            raise RuntimeError("cache down")

    monkeypatch.setattr(guard, "_cache", BrokenCache())
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    assert run(guard.verify_identity("free-fire", GAME_ID)).status == neferbyte.OK
    assert run(guard.verify_identity("free-fire", GAME_ID)).status == neferbyte.OK
    assert len(seen) == 2 and quota.attempts(today()) == 2


def test_attempt_hook_is_called_before_every_http_request(monkeypatch):
    """Le point d'accroche de `services.neferbyte` précède chaque requête, retry compris."""
    attempts: list[int] = []

    async def hook() -> bool:
        attempts.append(1)
        return True

    calls: list[httpx.Request] = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, json=error_body("upstream"))
        return httpx.Response(200, json=ok_body())

    mock_http(monkeypatch, handler)
    token = neferbyte.set_attempt_hook(hook)
    try:
        result = run(neferbyte.verify_identity("free-fire", GAME_ID))
    finally:
        neferbyte.reset_attempt_hook(token)

    assert result.status == neferbyte.OK
    assert len(attempts) == len(calls) == 2


def test_attempt_hook_refusal_prevents_the_request(monkeypatch):
    async def refuse() -> bool:
        return False

    mock_http(monkeypatch, lambda request: pytest.fail("aucune requête ne doit partir"))
    token = neferbyte.set_attempt_hook(refuse)
    try:
        result = run(neferbyte.verify_identity("free-fire", GAME_ID))
    finally:
        neferbyte.reset_attempt_hook(token)

    assert result.status == neferbyte.PROVIDER_UNAVAILABLE and result.reason == "quota_guard"


def test_counter_failure_blocks_the_call_fail_closed(monkeypatch):
    collection = FakeQuotaCollection(failing=True)
    monkeypatch.setattr(guard, "db", {guard.QUOTA_COLLECTION: collection})
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    result = run(guard.verify_identity("free-fire", GAME_ID))

    assert result.status == neferbyte.PROVIDER_UNAVAILABLE and result.reason == "quota_guard"
    assert len(seen) == 0                       # aucun appel non compté


def test_duplicate_key_race_does_not_close_the_day(monkeypatch):
    """Course sur l'insertion du document du jour : l'appel reste compté, pas bloqué."""
    collection = FakeQuotaCollection(race_once=True)
    monkeypatch.setattr(guard, "db", {guard.QUOTA_COLLECTION: collection})
    monkeypatch.setenv(guard.DAILY_LIMIT_ENV, "10")
    handler, seen = handler_counting(lambda n: httpx.Response(200, json=ok_body()))
    mock_http(monkeypatch, handler)

    assert run(guard.verify_identity("free-fire", GAME_ID)).status == neferbyte.OK
    assert len(seen) == 1
    assert guard._blocked() is False
    assert collection.attempts(today()) == 2    # 1 par le « concurrent », 1 par notre tentative


# --------------------------------------------------------------------------- #
# 6. Configuration
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("raw, expected", [
    (None, guard.DEFAULT_CACHE_TTL_S),
    ("", guard.DEFAULT_CACHE_TTL_S),
    ("abc", guard.DEFAULT_CACHE_TTL_S),
    ("30", 30.0),
    ("0", 0.0),                                 # cache désactivé
    ("-5", 0.0),
])
def test_cache_ttl_parsing(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv(guard.CACHE_TTL_ENV, raising=False)
    else:
        monkeypatch.setenv(guard.CACHE_TTL_ENV, raw)
    assert guard.cache_ttl_s() == expected


@pytest.mark.parametrize("raw, expected", [
    (None, None),                               # non défini : pas de plafond
    ("", None),
    ("abc", None),
    ("0", None),                                # une valeur absurde ne coupe pas la vérification
    ("-3", None),
    ("25", 25),
    (" 40 ", 40),
])
def test_daily_limit_parsing(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv(guard.DAILY_LIMIT_ENV, raising=False)
    else:
        monkeypatch.setenv(guard.DAILY_LIMIT_ENV, raw)
    assert guard.daily_limit() == expected


def test_missing_key_creates_no_quota_document(monkeypatch, quota):
    monkeypatch.delenv("NEFERBYTE_API_KEY")
    mock_http(monkeypatch, lambda request: pytest.fail("aucun appel réseau"))

    result = run(guard.verify_identity("free-fire", GAME_ID))

    assert result.status == neferbyte.PROVIDER_UNAVAILABLE and result.reason == "not_configured"
    assert quota.docs == {} and quota.writes == 0


# --------------------------------------------------------------------------- #
# 7. FazerCards (Free Fire, PUBG Mobile) : aucun passage par le garde
# --------------------------------------------------------------------------- #
FREE_FIRE_FIELDS = [{"key": "player_id", "label": "Player ID", "required": True, "primary": True}]
FREE_FIRE_NEFERBYTE = {"id": "free-fire", "identity_fields": FREE_FIRE_FIELDS,
                       "identity_verifier": {"provider": "neferbyte", "slug": "free-fire",
                                             "id_field": "player_id"}}


@pytest.mark.parametrize("game", [{"id": "pubg-mobile"}, {"id": "free-fire"}])
def test_fazercards_games_never_touch_the_guard(monkeypatch, game):
    used: list[tuple] = []

    async def spy(slug, player_id, server=None):  # pragma: no cover - ne doit jamais être atteint
        used.append((slug, player_id, server))
        return neferbyte.IdentityCheck(status=neferbyte.OK)

    monkeypatch.setattr(guard, "verify_identity", spy)
    provider = resolve_identity_provider(game)

    assert not isinstance(provider, NeferbyteProvider)
    assert used == []
    assert len(guard._cache) == 0 and guard._blocked() is False


def test_neferbyte_provider_goes_through_the_guard(monkeypatch):
    used: list[tuple] = []

    async def spy(slug, player_id, server=None):
        used.append((slug, player_id, server))
        return neferbyte.IdentityCheck(status=neferbyte.OK, player_name=NICKNAME)

    monkeypatch.setattr(guard, "verify_identity", spy)
    provider = resolve_identity_provider(FREE_FIRE_NEFERBYTE)

    result = run(provider.validate_identity("free-fire", {"player_id": GAME_ID}))

    assert result.valid is True and result.player_name == NICKNAME
    assert used == [("free-fire", GAME_ID, None)]
