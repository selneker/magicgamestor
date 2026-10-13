"""Vérifie la décomposition par unité (quantity > 1) + unicité des clés d'idempotency. Aucun appel fournisseur."""
import asyncio, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
os.chdir(Path(__file__).resolve().parent.parent / "backend")
import sys; sys.path.insert(0, os.getcwd())

from core.db import db
from services import fzr_fulfillment as F


async def main():
    expected = {"MGS-TEST01": 2, "MGS-TEST04": 4, "MGS-TEST05": 3, "MGS-TEST06": 1}
    ok = True
    for num, exp in expected.items():
        order = await db.orders.find_one({"order_number": num}, {"_id": 0})
        if not order:
            print(f"{num}: MISSING"); ok = False; continue
        units, skipped = await F._all_units(order)
        keys = [u["idempotency_key"] for u in units]
        uniq = len(set(keys)) == len(keys)
        elig = await F.eligible_lines(order)
        status = "OK" if (len(units) == exp and uniq and len(elig) == exp and not skipped) else "FAIL"
        if status == "FAIL":
            ok = False
        print(f"{num}: units={len(units)} (exp {exp}) eligible={len(elig)} uniq_keys={uniq} skipped={len(skipped)} -> {status}")
        print("   keys:", keys)
    print("\nRESULT:", "ALL OK" if ok else "FAILURES")


asyncio.run(main())
