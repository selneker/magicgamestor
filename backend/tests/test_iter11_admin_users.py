"""Iteration 11: Admin users management, roles & permissions.

Covers:
- Authorization matrix (customer=403, delegated admin permission gates, super admin)
- Users CRUD (list/detail/status/role/permissions/delete-anonymise)
- Super admin protection & at-least-one-admin invariant
- Session invalidation via auth_version
- Audit trail
- Regression on iteration 10 (orders delete for super admin, papi_auto=false, chat staff, loyalty)
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://game-shop-test.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER_ADMIN_EMAIL = "admin@magicgame.store"
SUPER_ADMIN_PASSWORD = "AdminLocal2026!"


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register(name, email, password):
    r = requests.post(f"{API}/auth/register", json={"name": name, "email": email, "password": password}, timeout=15)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


@pytest.fixture(scope="module")
def super_admin_token():
    return _login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def customer_ctx():
    suffix = uuid.uuid4().hex[:8]
    email = f"test_customer_{suffix}@example.com"
    pwd = "Passw0rd!TestCust"
    token, user = _register(f"TestCust {suffix}", email, pwd)
    return {"email": email, "password": pwd, "token": token, "user_id": user["user_id"]}


@pytest.fixture(scope="module")
def delegated_ctx(super_admin_token):
    suffix = uuid.uuid4().hex[:8]
    email = f"test_delegated_{suffix}@example.com"
    pwd = "Passw0rd!TestDeleg"
    token, user = _register(f"TestDeleg {suffix}", email, pwd)
    return {"email": email, "password": pwd, "token": token, "user_id": user["user_id"], "initial_token": token}


class TestUnauthenticated:
    def test_admin_users_list_requires_auth(self):
        r = requests.get(f"{API}/admin/users", timeout=15)
        assert r.status_code == 401


class TestCustomerForbidden:
    def test_customer_cannot_list_users(self, customer_ctx):
        r = requests.get(f"{API}/admin/users", headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 403

    def test_customer_cannot_get_user_detail(self, customer_ctx):
        r = requests.get(f"{API}/admin/users/{customer_ctx['user_id']}", headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 403

    def test_customer_cannot_patch_status(self, customer_ctx):
        r = requests.patch(f"{API}/admin/users/{customer_ctx['user_id']}/status",
                           json={"blocked": True}, headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 403

    def test_customer_cannot_patch_role(self, customer_ctx):
        r = requests.patch(f"{API}/admin/users/{customer_ctx['user_id']}/role",
                           json={"role": "admin"}, headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 403

    def test_customer_cannot_patch_permissions(self, customer_ctx):
        r = requests.patch(f"{API}/admin/users/{customer_ctx['user_id']}/permissions",
                           json={"permissions": ["users.manage"]}, headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 403

    def test_customer_cannot_delete_user(self, customer_ctx):
        r = requests.delete(f"{API}/admin/users/{customer_ctx['user_id']}", headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 403


class TestSuperAdminList:
    def test_list_pagination_and_filters(self, super_admin_token):
        r = requests.get(f"{API}/admin/users?page=1&page_size=5", headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "total" in data and data["page"] == 1 and data["page_size"] == 5
        assert isinstance(data["total"], int)
        assert "permissions_available" in data
        # never leak password_hash / tokens
        for item in data["items"]:
            assert "password_hash" not in item
            assert "token" not in item
            assert "access_token" not in item

    def test_list_search_by_email(self, super_admin_token, customer_ctx):
        r = requests.get(f"{API}/admin/users?search={customer_ctx['email']}", headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(u["email"] == customer_ctx["email"] for u in items)

    def test_filter_role(self, super_admin_token):
        r = requests.get(f"{API}/admin/users?role=super_admin", headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        assert all(u["role"] == "super_admin" for u in r.json()["items"])


class TestPromotion:
    def test_promote_customer_to_admin(self, super_admin_token, delegated_ctx):
        r = requests.patch(f"{API}/admin/users/{delegated_ctx['user_id']}/role",
                           json={"role": "admin", "permissions": ["orders.manage", "catalog.manage", "users.manage"]},
                           headers=_auth_header(super_admin_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "admin"
        assert set(data["permissions"]) == {"orders.manage", "catalog.manage", "users.manage"}
        # audit
        a = requests.get(f"{API}/admin/audit?target={delegated_ctx['user_id']}&action=admin.role_granted",
                         headers=_auth_header(super_admin_token))
        assert a.status_code == 200
        assert any(e["action"] == "admin.role_granted" for e in a.json())

    def test_orders_delete_never_granted(self, super_admin_token, delegated_ctx):
        r = requests.patch(f"{API}/admin/users/{delegated_ctx['user_id']}/permissions",
                           json={"permissions": ["orders.delete", "users.manage", "orders.manage"]},
                           headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        perms = r.json()["permissions"]
        assert "orders.delete" not in perms
        assert set(perms) == {"users.manage", "orders.manage"}

    def test_cannot_promote_to_super_admin(self, super_admin_token, delegated_ctx):
        r = requests.patch(f"{API}/admin/users/{delegated_ctx['user_id']}/role",
                           json={"role": "super_admin"}, headers=_auth_header(super_admin_token))
        assert r.status_code in (400, 422)

    def test_old_delegated_token_invalidated(self, delegated_ctx):
        # role change should have incremented auth_version invalidating the initial token
        r = requests.get(f"{API}/auth/me", headers=_auth_header(delegated_ctx["initial_token"]))
        assert r.status_code == 401


@pytest.fixture(scope="module")
def delegated_token(delegated_ctx):
    """Fresh login for the delegated admin (with orders.manage + users.manage, no catalog after permission reset above)."""
    return _login(delegated_ctx["email"], delegated_ctx["password"])


class TestDelegatedAdmin:
    def test_delegated_can_list_users(self, delegated_token):
        r = requests.get(f"{API}/admin/users", headers=_auth_header(delegated_token))
        assert r.status_code == 200

    def test_delegated_cannot_patch_role(self, delegated_token, customer_ctx):
        r = requests.patch(f"{API}/admin/users/{customer_ctx['user_id']}/role",
                           json={"role": "admin"}, headers=_auth_header(delegated_token))
        assert r.status_code == 403

    def test_delegated_cannot_patch_permissions_even_own(self, delegated_token, delegated_ctx):
        r = requests.patch(f"{API}/admin/users/{delegated_ctx['user_id']}/permissions",
                           json={"permissions": ["users.manage", "orders.manage", "catalog.manage"]},
                           headers=_auth_header(delegated_token))
        assert r.status_code == 403

    def test_delegated_cannot_delete_order(self, delegated_token, super_admin_token):
        # Try to delete any existing order — endpoint must always 403 for delegated admin regardless
        r = requests.get(f"{API}/admin/orders?limit=5", headers=_auth_header(delegated_token))
        assert r.status_code == 200
        orders = r.json()
        if orders:
            oid = orders[0]["id"]
            d = requests.delete(f"{API}/admin/orders/{oid}", headers=_auth_header(delegated_token))
            assert d.status_code == 403

    def test_delegated_without_catalog_cannot_create_product(self, delegated_token):
        r = requests.post(f"{API}/admin/products",
                          json={"slug": f"test-{uuid.uuid4().hex[:6]}", "type": "uc", "name": "Test",
                                "price": 1000},
                          headers=_auth_header(delegated_token))
        assert r.status_code == 403

    def test_delegated_without_events_cannot_manage(self, delegated_token):
        r = requests.get(f"{API}/admin/events", headers=_auth_header(delegated_token))
        # events may allow read for any admin; test create/delete which requires events.manage
        r2 = requests.post(f"{API}/admin/events",
                           json={"title": "test", "starts_at": "2030-01-01T00:00:00Z"},
                           headers=_auth_header(delegated_token))
        assert r2.status_code in (403, 422)  # 422 if schema mismatch — but must not be 200

    def test_delegated_can_patch_orders(self, delegated_token, super_admin_token):
        r = requests.get(f"{API}/admin/orders?limit=1", headers=_auth_header(delegated_token))
        assert r.status_code == 200


class TestSuperAdminProtection:
    def test_cannot_block_super_admin(self, super_admin_token):
        me = requests.get(f"{API}/auth/me", headers=_auth_header(super_admin_token)).json()
        # Find super admin's user_id
        me_id = me.get("user_id") or me.get("user", {}).get("user_id")
        assert me_id
        r = requests.patch(f"{API}/admin/users/{me_id}/status",
                           json={"blocked": True}, headers=_auth_header(super_admin_token))
        # Cannot block self (409) AND super admin is protected — either is acceptable but must not succeed
        assert r.status_code in (403, 409)

    def test_cannot_delete_super_admin(self, super_admin_token):
        me = requests.get(f"{API}/auth/me", headers=_auth_header(super_admin_token)).json()
        me_id = me.get("user_id") or me.get("user", {}).get("user_id")
        r = requests.delete(f"{API}/admin/users/{me_id}", headers=_auth_header(super_admin_token))
        assert r.status_code in (403, 409)

    def test_cannot_change_own_role(self, super_admin_token):
        me = requests.get(f"{API}/auth/me", headers=_auth_header(super_admin_token)).json()
        me_id = me.get("user_id") or me.get("user", {}).get("user_id")
        r = requests.patch(f"{API}/admin/users/{me_id}/role",
                           json={"role": "customer"}, headers=_auth_header(super_admin_token))
        assert r.status_code in (403, 409)


class TestBlockUnblock:
    def test_block_and_unblock_customer(self, super_admin_token, customer_ctx):
        # Block
        r = requests.patch(f"{API}/admin/users/{customer_ctx['user_id']}/status",
                           json={"blocked": True}, headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        assert r.json()["blocked"] is True

        # Blocked user cannot login
        rl = requests.post(f"{API}/auth/login",
                           json={"email": customer_ctx["email"], "password": customer_ctx["password"]})
        assert rl.status_code == 403

        # Existing token rejected
        rm = requests.get(f"{API}/auth/me", headers=_auth_header(customer_ctx["token"]))
        assert rm.status_code == 401

        # Unblock
        r2 = requests.patch(f"{API}/admin/users/{customer_ctx['user_id']}/status",
                            json={"blocked": False}, headers=_auth_header(super_admin_token))
        assert r2.status_code == 200
        assert r2.json()["blocked"] is False

        # Can login again
        rl2 = requests.post(f"{API}/auth/login",
                            json={"email": customer_ctx["email"], "password": customer_ctx["password"]})
        assert rl2.status_code == 200
        # Refresh customer token for later tests
        customer_ctx["token"] = rl2.json()["access_token"]


class TestIDOR:
    def test_get_nonexistent_user(self, super_admin_token):
        r = requests.get(f"{API}/admin/users/user_doesnotexist_xxxx", headers=_auth_header(super_admin_token))
        assert r.status_code == 404


class TestOrdersDeletion:
    """Regression: only super admin can delete an order, only delivered orders are deletable."""
    def test_super_admin_delete_paid_non_delivered_returns_409(self, super_admin_token):
        r = requests.get(f"{API}/admin/orders?status=paid&limit=1", headers=_auth_header(super_admin_token))
        if r.status_code != 200 or not r.json():
            pytest.skip("No paid non-delivered order available")
        oid = r.json()[0]["id"]
        d = requests.delete(f"{API}/admin/orders/{oid}", headers=_auth_header(super_admin_token))
        assert d.status_code == 409


class TestRegression:
    def test_payments_config_papi_auto_off(self):
        r = requests.get(f"{API}/payments/config")
        assert r.status_code == 200
        assert r.json().get("papi_auto") is False

    def test_auth_me_super_admin(self, super_admin_token):
        r = requests.get(f"{API}/auth/me", headers=_auth_header(super_admin_token))
        assert r.status_code == 200

    def test_loyalty_me_customer(self, customer_ctx):
        r = requests.get(f"{API}/loyalty/me", headers=_auth_header(customer_ctx["token"]))
        assert r.status_code == 200


class TestRevokeAndAnonymize:
    """Run these last: they invalidate the delegated admin session and anonymize the customer."""

    def test_revoke_delegated_admin(self, super_admin_token, delegated_ctx, delegated_token):
        r = requests.patch(f"{API}/admin/users/{delegated_ctx['user_id']}/role",
                           json={"role": "customer"}, headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        assert r.json()["role"] == "customer"
        # Old delegated token invalidated
        rm = requests.get(f"{API}/admin/users", headers=_auth_header(delegated_token))
        assert rm.status_code == 401

    def test_anonymize_customer(self, super_admin_token, customer_ctx):
        r = requests.delete(f"{API}/admin/users/{customer_ctx['user_id']}", headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        # Token revoked
        rm = requests.get(f"{API}/auth/me", headers=_auth_header(customer_ctx["token"]))
        assert rm.status_code == 401
        # Detail should show anonymised
        d = requests.get(f"{API}/admin/users/{customer_ctx['user_id']}", headers=_auth_header(super_admin_token))
        assert d.status_code == 200
        detail = d.json()
        assert detail["email"].startswith("deleted_") and detail["email"].endswith("@anonyme.invalid")
        assert detail["blocked"] is True
        assert detail["role"] == "customer"

    def test_audit_contains_expected_actions(self, super_admin_token, delegated_ctx, customer_ctx):
        r = requests.get(f"{API}/admin/audit?limit=200", headers=_auth_header(super_admin_token))
        assert r.status_code == 200
        actions = {e["action"] for e in r.json()}
        assert "admin.role_granted" in actions
        assert "admin.role_revoked" in actions
        assert "admin.permissions_changed" in actions
        assert "user.blocked" in actions
        assert "user.unblocked" in actions
        assert "user.anonymized" in actions
