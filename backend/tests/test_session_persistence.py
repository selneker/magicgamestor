"""Session persistante 30 jours : cookies, restauration via /auth/refresh, révocation serveur.

Couvre l'objectif « Rester connecté » : cookies HttpOnly/Secure, remember=False (cookie de
session), restauration après fermeture du navigateur (access expiré → /auth/refresh → /auth/me),
révocation par logout et par changement de mot de passe, isolation entre deux utilisateurs.
"""
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt as pyjwt
import requests
from dotenv import dotenv_values

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
SECRET = _env["JWT_SECRET"]


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _set_cookies(resp):
    """{nom: header Set-Cookie brut} — requests masque les doublons, on lit les en-têtes bruts."""
    return {h.split("=", 1)[0]: h for h in resp.raw.headers.getlist("Set-Cookie")}


def _value(header):
    return header.split(";", 1)[0].split("=", 1)[1]


def _register():
    email = f"qa_session_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    body = {"email": email, "password": "Secret123!", "name": "Session QA"}
    r = requests.post(f"{API}/auth/register", json=body, headers=_ip())
    assert r.status_code == 200, r.text
    provisions = _set_cookies(r)
    return {"email": email, "password": body["password"], "user_id": r.json()["user"]["user_id"],
            "access": _value(provisions["access_token"]), "refresh": _value(provisions["refresh_token"])}


def _login(email, password, remember=True):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password, "remember": remember}, headers=_ip())


def _refresh(refresh_value=None, raw_cookie=None):
    cookie = raw_cookie if raw_cookie is not None else f"refresh_token={refresh_value}"
    return requests.post(f"{API}/auth/refresh", headers={**_ip(), "Cookie": cookie})


def _me(access_value=None):
    headers = _ip()
    if access_value:
        headers["Cookie"] = f"access_token={access_value}"
    return requests.get(f"{API}/auth/me", headers=headers)


class TestPersistentCookies:
    def test_login_issues_30_day_httponly_refresh_cookie(self):
        u = _register()
        r = _login(u["email"], u["password"])
        assert r.status_code == 200, r.text
        headers = _set_cookies(r)
        refresh_header, access_header = headers["refresh_token"], headers["access_token"]
        assert "Max-Age=2592000" in refresh_header                       # 30 jours
        assert "HttpOnly" in refresh_header and "Secure" in refresh_header and "Path=/" in refresh_header
        domain = (_env.get("COOKIE_DOMAIN") or "").strip()
        assert f"SameSite={'lax' if domain else 'none'}" in refresh_header
        if domain:
            assert f"Domain={domain}" in refresh_header
        payload = pyjwt.decode(_value(refresh_header), options={"verify_signature": False})
        assert payload["type"] == "refresh" and payload.get("jti")
        remaining = datetime.fromtimestamp(payload["exp"], tz=timezone.utc) - datetime.now(timezone.utc)
        assert timedelta(days=29) < remaining <= timedelta(days=30)
        assert "Max-Age=900" in access_header                            # access 15 min

    def test_remember_false_issues_browser_session_cookie(self):
        u = _register()
        r = _login(u["email"], u["password"], remember=False)
        assert r.status_code == 200
        header = _set_cookies(r)["refresh_token"]
        assert "HttpOnly" in header and "Secure" in header
        assert "Max-Age" not in header and "Expires" not in header        # cookie de session (fermé avec le navigateur)

    def test_refresh_preserves_remember_false_preference(self):
        """Un renouvellement ne doit pas transformer un cookie de session en session de 30 jours."""
        u = _register()
        login = _login(u["email"], u["password"], remember=False)
        assert login.status_code == 200, login.text
        login_cookies = _set_cookies(login)
        refresh_payload = pyjwt.decode(_value(login_cookies["refresh_token"]), options={"verify_signature": False})
        assert refresh_payload.get("remember") is False

        r = _refresh(_value(login_cookies["refresh_token"]))
        assert r.status_code == 200, r.text
        access_header = _set_cookies(r)["access_token"]
        assert "Max-Age" not in access_header and "Expires" not in access_header
        assert _me(_value(access_header)).status_code == 200

    def test_change_password_preserves_remember_false_preference(self):
        """Le changement de mot de passe réémet les cookies sans rendre la session persistante."""
        u = _register()
        login = _login(u["email"], u["password"], remember=False)
        assert login.status_code == 200, login.text
        login_cookies = _set_cookies(login)
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": u["password"], "new_password": "NewSecret456!"},
            headers={**_ip(), "Cookie": f"access_token={_value(login_cookies['access_token'])}; "
                                        f"refresh_token={_value(login_cookies['refresh_token'])}"},
        )
        assert r.status_code == 200, r.text
        headers = _set_cookies(r)
        for name in ("access_token", "refresh_token"):
            assert "Max-Age" not in headers[name] and "Expires" not in headers[name]
        payload = pyjwt.decode(_value(headers["refresh_token"]), options={"verify_signature": False})
        assert payload.get("remember") is False
        assert _refresh(_value(headers["refresh_token"])).status_code == 200


class TestRestoreAndRefresh:
    def test_refresh_after_access_expiry_restores_session(self):
        """Fermeture du navigateur : seul le refresh cookie (30 j) survit, l'access (15 min) a disparu."""
        u = _register()
        assert _me(u["access"]).status_code == 200
        assert _me().status_code == 401                                  # sans aucun cookie : déconnecté
        r = _refresh(u["refresh"])
        assert r.status_code == 200, r.text
        access = _value(_set_cookies(r)["access_token"])
        me = _me(access)
        assert me.status_code == 200 and me.json()["user_id"] == u["user_id"]

    def test_refresh_is_rejected_without_cookie(self):
        assert _refresh(raw_cookie="").status_code == 401

    def test_legacy_refresh_token_without_jti_still_valid(self):
        """Déploiement : les tokens émis AVANT le registre (sans jti) restent valides jusqu'à expiration."""
        u = _register()
        legacy = pyjwt.encode({"sub": u["user_id"], "type": "refresh", "v": 0,
                               "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, SECRET, algorithm="HS256")
        assert _refresh(legacy).status_code == 200

    def test_refresh_rejects_unknown_jti(self):
        u = _register()
        forged = pyjwt.encode({"sub": u["user_id"], "type": "refresh", "v": 0, "jti": "deadbeef" * 4,
                               "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, SECRET, algorithm="HS256")
        assert _refresh(forged).status_code == 401                       # jti absent du registre → révoqué


class TestRevocation:
    def test_logout_revokes_refresh_server_side(self):
        u = _register()
        r = requests.post(f"{API}/auth/logout",
                          headers={**_ip(), "Cookie": f"access_token={u['access']}; refresh_token={u['refresh']}"})
        assert r.status_code == 200
        assert _refresh(u["refresh"]).status_code == 401                 # la session ne peut plus produire d'access token

    def test_logout_revokes_access_token_immediately(self):
        """L'access token de CETTE session ne doit plus être accepté après le logout (pas 15 min de sursis)."""
        u = _register()
        assert _me(u["access"]).status_code == 200
        r = requests.post(f"{API}/auth/logout",
                          headers={**_ip(), "Cookie": f"access_token={u['access']}; refresh_token={u['refresh']}"})
        assert r.status_code == 200, r.text
        assert _me(u["access"]).status_code == 401

    def test_logout_with_bearer_revokes_access_token(self):
        """Un client API peut révoquer sa session en présentant son access token en Bearer."""
        u = _register()
        r = requests.post(f"{API}/auth/logout",
                          headers={**_ip(), "Authorization": f"Bearer {u['access']}"})
        assert r.status_code == 200, r.text
        assert _me(u["access"]).status_code == 401

    def test_logout_only_revokes_the_current_device(self):
        """Le logout d'un appareil ne doit pas invalider l'access token d'un autre appareil du même compte."""
        u = _register()
        second_login = _login(u["email"], u["password"])
        assert second_login.status_code == 200, second_login.text
        second = _set_cookies(second_login)
        second_access = _value(second["access_token"])
        assert _me(second_access).status_code == 200

        r = requests.post(f"{API}/auth/logout",
                          headers={**_ip(), "Cookie": f"access_token={u['access']}; refresh_token={u['refresh']}"})
        assert r.status_code == 200, r.text
        assert _me(u["access"]).status_code == 401
        assert _me(second_access).status_code == 200
        assert _refresh(_value(second["refresh_token"])).status_code == 200

    def test_legacy_access_token_without_sid_is_still_accepted(self):
        """Compatibilité déploiement : un access token émis avant le champ `sid` reste valide ≤ 15 min."""
        u = _register()
        legacy = pyjwt.encode({"sub": u["user_id"], "type": "access", "v": 0,
                               "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, SECRET, algorithm="HS256")
        assert _me(legacy).status_code == 200

    def test_password_change_revokes_other_sessions(self):
        u = _register()
        r = requests.post(f"{API}/auth/change-password",
                          json={"current_password": u["password"], "new_password": "NewSecret456!"},
                          headers={**_ip(), "Cookie": f"access_token={u['access']}"})
        assert r.status_code == 200, r.text
        assert _refresh(u["refresh"]).status_code == 401                 # ancien refresh révoqué
        fresh = _value(_set_cookies(r)["refresh_token"])                 # l'appareil courant reste connecté
        assert _refresh(fresh).status_code == 200

    def test_two_users_never_share_a_session(self):
        a, b = _register(), _register()
        ra, rb = _refresh(a["refresh"]), _refresh(b["refresh"])
        assert ra.status_code == rb.status_code == 200
        assert _me(_value(_set_cookies(ra)["access_token"])).json()["user_id"] == a["user_id"]
        assert _me(_value(_set_cookies(rb)["access_token"])).json()["user_id"] == b["user_id"]
        assert a["refresh"] != b["refresh"] and a["access"] != b["access"]
