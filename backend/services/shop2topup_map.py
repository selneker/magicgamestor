"""T04 — rattachement du manifeste Shop2Topup aux produits (champ `supplier_mapping`).

N'écrit QUE `supplier_mapping["shop2topup"]` (A1) : `fazercards_mapping` n'est jamais lu en
écriture, aucune autre clé fournisseur n'est créée, aucun produit n'est créé (A3). Le backfill
est idempotent : un produit déjà à jour n'est pas réécrit, donc deux démarrages ne produisent
ni doublon ni écriture inutile.
"""
import logging

from core.db import db
from core.games import DEFAULT_GAME_ID
from core.shop2topup_mapping import (SHOP2TOPUP_KEY, SHOP2TOPUP_MANIFEST, SHOP2TOPUP_MODE)

logger = logging.getLogger("mgs.shop2topup_map")

PROJECTION = {"_id": 0, "slug": 1, "game_id": 1, "supplier_mapping": 1}


def mapping_value(row: dict) -> dict:
    """Valeur écrite sous `supplier_mapping.shop2topup` pour une ligne du manifeste."""
    return {"sku": row["sku"], "uc_total": row["uc_total"], "mode": SHOP2TOPUP_MODE}


async def attach_shop2topup_mapping() -> dict:
    """Applique le manifeste aux produits existants. Retourne des compteurs, ne lève jamais.

    Un lot sans produit correspondant est seulement compté : A3 interdit de le créer.
    """
    result = {"attached": 0, "unchanged": 0, "missing": [], "mismatched": []}
    for row in SHOP2TOPUP_MANIFEST:
        slug = row["product_slug"]
        try:
            product = await db.products.find_one({"slug": slug}, PROJECTION)
            if not product:
                result["missing"].append(slug)
                continue
            if (product.get("game_id") or DEFAULT_GAME_ID) != row["game_id"]:
                result["mismatched"].append(slug)
                continue
            value = mapping_value(row)
            if (product.get("supplier_mapping") or {}).get(SHOP2TOPUP_KEY) == value:
                result["unchanged"] += 1
                continue
            await db.products.update_one(
                {"slug": slug}, {"$set": {f"supplier_mapping.{SHOP2TOPUP_KEY}": value}})
            result["attached"] += 1
        except Exception as exc:  # type: ignore[attr-defined]
            # Un backfill ne doit pas empêcher le démarrage : le lot sera retenté au suivant.
            logger.warning("Rattachement Shop2Topup impossible pour %s (%s)", slug, type(exc).__name__)
    if result["missing"] or result["mismatched"]:
        logger.warning("Manifeste Shop2Topup: %s lot(s) sans produit, %s jeu différent",
                       len(result["missing"]), len(result["mismatched"]))
    return result
