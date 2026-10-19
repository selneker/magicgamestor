"""Durcissement auth : CSRF/origines, état OAuth lié au navigateur, révocation d'access token.

Tests d'intégration contre le backend local (BACKEND_TEST_URL) et, pour le test OAuth qui
vérifie la consommation de l'état, contre la base isolée indiquée par BACKEND_TEST_DB_NAME.
Aucune base de production n'est utilisée.
"""
import os
import random
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
TEST_DB = os.environ.get("BACKEND_TEST_DB_NAME")
GOOGLE_CONFIGURED = bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _set_cookies(resp):
    """{nom: header Set-Cookie brut} — requests masque les doublons, on lit les en-têtes bruts."""
    return {h.split("=", 1)[0]: h for h in resp.raw.headers.getlist("Set-Cookie")}


def _value(header):
    return header.split(";", 1)[0].split("=", 1)[1]


def _register():
    email = f"qa_hard_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    password = "Secret123!"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "name": "Hardening QA"}, headers=_ip())
    assert r.status_code == 200, r.text
    cookies = _set_cookies(r)
    return {"email": email, "password": password, "user_id": r.json()["user"]["user_id"],
            "access": _value(cookies["access_token"]), "refresh": _value(cookies["refresh_token"])}


def _login(email, password, headers=None):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password},
                         headers={**_ip(), **(headers or {})})


class TestCsrfOriginPolicy:
    def test_register_rejects_untrusted_origin(self):
        email = f"qa_csrf_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
        r = requests.post(f"{API}/auth/register",
                          json={"email": email, "password": "Secret123!", "name": "CSRF QA"},
                          headers={**_ip(), "Origin": "https://evil.example"})
        assert r.status_code == 403
        assert "access_token" not in r.headers.get("set-cookie", "")

    def test_login_rejects_untrusted_origin(self):
        u = _register()
        r = _login(u["email"], u["password"], headers={"Origin": "https://evil.example"})
        assert r.status_code == 403
        assert "access_token" not in r.headers.get("set-cookie", "")

    def test_login_rejects_cross_site_fetch_metadata_without_origin(self):
        u = _register()
        r = _login(u["email"], u["password"], headers={"Sec-Fetch-Site": "cross-site"})
        assert r.status_code == 403

    def test_login_allows_trusted_origin(self):
        u = _register()
        r = _login(u["email"], u["password"], headers={"Origin": "https://magicgame.store"})
        assert r.status_code == 200, r.text

    def test_login_allows_non_browser_client_without_origin(self):
        """Les clients non-navigateur (curl, tests, intégrations) restent acceptés : pas de CSRF possible sans navigateur."""
        u = _register()
        assert _login(u["email"], u["password"]).status_code == 200

    def test_login_checks_referer_when_origin_is_missing(self):
        u = _register()
        assert _login(u["email"], u["password"],
                      headers={"Referer": "https://magicgame.store/compte"}).status_code == 200
        assert _login(u["email"], u["password"],
                      headers={"Referer": "https://evil.example/page"}).status_code == 403

    def test_login_allows_same_origin_fetch_metadata_without_origin(self):
        u = _register()
        assert _login(u["email"], u["password"], headers={"Sec-Fetch-Site": "same-origin"}).status_code == 200

    def test_logout_with_untrusted_origin_does_not_revoke(self):
        u = _register()
        r = requests.post(f"{API}/auth/logout",
                          headers={**_ip(), "Origin": "https://evil.example",
                                   "Cookie": f"access_token={u['access']}; refresh_token={u['refresh']}"})
        assert r.status_code == 403
        refreshed = requests.post(f"{API}/auth/refresh",
                                  headers={**_ip(), "Cookie": f"refresh_token={u['refresh']}"})
        assert refreshed.status_code == 200

    def test_refresh_rejects_untrusted_origin_and_keeps_session(self):
        u = _register()
        r = requests.post(f"{API}/auth/refresh",
                          headers={**_ip(), "Origin": "https://evil.example",
                                   "Cookie": f"refresh_token={u['refresh']}"})
        assert r.status_code == 403
        assert "access_token" not in r.headers.get("set-cookie", "")
        assert requests.post(f"{API}/auth/refresh",
                             headers={**_ip(), "Cookie": f"refresh_token={u['refresh']}"}).status_code == 200

    def test_change_password_rejects_untrusted_origin(self):
        u = _register()
        r = requests.post(f"{API}/auth/change-password",
                          json={"current_password": u["password"], "new_password": "NewSecret456!"},
                          headers={**_ip(), "Origin": "https://evil.example",
                                   "Cookie": f"access_token={u['access']}; refresh_token={u['refresh']}"})
        assert r.status_code == 403
        assert _login(u["email"], u["password"]).status_code == 200  # ancien mot de passe inchangé


class TestOriginAllowlist:
    def test_allowed_origins_are_exact_and_include_apex_www(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "https://magicgame.store,https://api.magicgame.store")
        monkeypatch.setenv("FRONTEND_URL", "https://magicgame.store")
        from core.origins import allowed_origins

        origins = allowed_origins()
        assert "https://magicgame.store" in origins
        assert "https://www.magicgame.store" in origins
        assert "https://api.magicgame.store" in origins
        assert "https://www.api.magicgame.store" not in origins  # pas de wildcard de sous-domaine
        assert "https://evil.example" not in origins
        assert "null" not in origins

    def test_allowed_origins_default_to_local_dev(self, monkeypatch):
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        monkeypatch.delenv("FRONTEND_URL", raising=False)
        from core.origins import allowed_origins

        assert allowed_origins() == {"http://localhost:3000"}

    def test_oauth_state_must_match_the_browser_cookie(self):
        from core.origins import oauth_state_matches

        assert oauth_state_matches("state-abc", "state-abc")
        assert not oauth_state_matches(None, "state-abc")
        assert not oauth_state_matches("state-abc", None)
        assert not oauth_state_matches("state-abc", "state-def")


class TestGoogleStateBinding:
    @pytest.mark.skipif(not GOOGLE_CONFIGURED, reason="Google OAuth non configuré pour ce serveur de test")
    def test_google_start_sets_httponly_state_cookie(self):
        r = requests.get(f"{API}/auth/google/start", params={"return_to": "/compte"},
                         headers=_ip(), allow_redirects=False)
        assert r.status_code == 302, r.text
        assert r.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        state = parse_qs(urlsplit(r.headers["location"]).query)["state"][0]
        headers = _set_cookies(r)
        assert "oauth_state" in headers
        cookie = headers["oauth_state"]
        assert _value(cookie) == state
        assert "Max-Age=600" in cookie
        assert "HttpOnly" in cookie and "Secure" in cookie
        assert "Path=/api/auth/google" in cookie
        domain = (_env.get("COOKIE_DOMAIN") or "").strip()
        assert f"SameSite={'lax' if domain else 'none'}" in cookie
        if domain:
            assert f"Domain={domain}" in cookie

    @pytest.mark.skipif(not TEST_DB, reason="BACKEND_TEST_DB_NAME non défini : base isolée requise")
    def test_google_callback_rejects_state_without_browser_cookie(self):
        """Un state valide mais sans cookie oauth_state ne doit pas être consommé ni échangé chez Google."""
        mongo = MongoClient(_env["MONGO_URL"])[TEST_DB]
        state = f"qa_state_{uuid.uuid4().hex}"
        mongo.oauth_states.insert_one({"state": state, "nonce": "qa-nonce", "return_to": "/compte",
                                       "created_at": datetime.now(timezone.utc)})
        try:
            r = requests.get(f"{API}/auth/google/callback",
                             params={"state": state, "code": "fake-code"},
                             headers=_ip(), allow_redirects=False)
            assert r.status_code == 302, r.text
            assert "error=google" in r.headers["location"]
            assert mongo.oauth_states.find_one({"state": state}) is not None
        finally:
            mongo.oauth_states.delete_one({"state": state})
