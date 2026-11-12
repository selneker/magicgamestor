"""PL-ORDER-PROOF-1 — route interne des tâches planifiées de commandes/preuves.

Appelée par cron-job.org (pas par le navigateur), protégée par le même en-tête `X-Cron-Token`
que les relances PL-NOTIF-4. Réponse réduite à des compteurs : aucune donnée de commande, aucun
écho du jeton. PL-STOCK-1 y branche l'expiration des états fournisseur périmés et PL-STOCK-2 le
relevé de la liste des offres : aucune route cron supplémentaire à configurer côté hébergeur.
"""
import logging

from fastapi import APIRouter, Request

from core.cron import require_cron_token
from services import order_maintenance

router = APIRouter(prefix="/internal/orders", tags=["internal-orders"])
logger = logging.getLogger("mgs.internal_orders")


@router.post("/run")
async def run(request: Request):
    require_cron_token(request)
    try:
        return await order_maintenance.run_all()
    except Exception as exc:  # la réponse du cron reste stable même en cas de panne inattendue
        logger.warning("Tâches commandes/preuves impossible (%s)", type(exc).__name__)
        return {"expiry_warned": 0, "expired": 0, "released_crypto": 0, "purged_orders": 0,
                "purged_blobs": 0, "storage_alerts": 0, "stock_expired": 0, "stock_restored": 0,
                "offers_checked": 0, "offers_absent": 0, "offers_marked": 0, "offers_suspect": 0}
