"""SEC-FIND-FIX — injection de formules dans l'export CSV admin.

Les cellules contrôlées par un client (pseudo, référence manuelle, ...) ne doivent
jamais commencer par `=`, `+`, `-` ou `@` dans le CSV : Excel/LibreOffice les
interpréterait comme des formules. Un préfixe apostrophe neutralise la formule
tout en conservant la valeur lisible.
"""
import csv
import io
import os
import random
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
_env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
mongo = MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]

DANGEROUS = ("=1+1", "+1+1", "-1-1", "@SUM(A1:A2)")


def _ip():
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _staff():
    """Compte staff de test créé localement (aucun identifiant réel utilisé)."""
    email = f"qa_sec_export_{int(time.time())}_{uuid.uuid4().hex[:6]}@test.mg"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "Sec Export"},
                      headers=_ip())
    assert r.status_code == 200, r.text
    user_id = r.json()["user"]["user_id"]
    mongo.users.update_one({"user_id": user_id}, {"$set": {"role": "super_admin"}})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _product():
    product_id = str(uuid.uuid4())
    mongo.products.insert_one({
        "id": product_id, "slug": f"sec-export-{uuid.uuid4().hex[:8]}", "type": "uc",
        "name": "Sec Export", "price": 1000, "old_price": None, "popular": False,
        "badge": None, "uc_amount": 60, "duration_months": None,
        "description_fr": "", "description_en": "", "active": True, "sort_order": 999,
        "game_id": "pubg-mobile", "requires_mapping": False, "created_at": _iso(),
    })
    return product_id


def _order(product_id, pseudo):
    body = {"pubg_id": "5123456789", "pseudo": pseudo,
            "items": [{"product_id": product_id, "quantity": 1}],
            "payment_method": "manual", "manual_reference": "@SUM(A1:A2)"}
    r = requests.post(f"{API}/orders", json=body, headers=_ip())
    assert r.status_code == 201, r.text
    return r.json()


def _export(headers):
    r = requests.get(f"{API}/admin/export", headers={**_ip(), **headers})
    assert r.status_code == 200, r.text
    return list(csv.reader(io.StringIO(r.text)))


class TestCsvFormulaInjection:
    def test_dangerous_cells_are_neutralized(self):
        staff = _staff()
        product_id = _product()
        orders = [_order(product_id, pseudo) for pseudo in DANGEROUS]
        rows = _export(staff)
        header = rows[0]
        pseudo_column = header.index("pseudo")
        reference_column = header.index("manual_reference")
        by_number = {row[0]: row for row in rows[1:]}

        for order, pseudo in zip(orders, DANGEROUS):
            row = by_number[order["order_number"]]
            assert row[pseudo_column] == "'" + pseudo
            assert row[reference_column] == "'@SUM(A1:A2)"
            # La valeur d'origine reste lisible après l'apostrophe de neutralisation.
            assert row[pseudo_column].lstrip("'") == pseudo

    def test_regular_values_are_exported_unchanged(self):
        staff = _staff()
        product_id = _product()
        order = _order(product_id, "Joueur Normal")
        rows = _export(staff)
        row = next(r for r in rows[1:] if r[0] == order["order_number"])
        assert row[rows[0].index("pseudo")] == "Joueur Normal"
