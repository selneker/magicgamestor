"""Route interne de relance des commandes payées non traitées (PL-NOTIF-4).

Appelée par un service externe (cron-job.org), pas par le navigateur : authentification par jeton
d'en-tête comparé en temps constant. Sans `CRON_TOKEN`, la route est désactivée (503) et ne peut
jamais s'ouvrir par accident. Réponse réduite à des compteurs, aucun écho du jeton, aucun détail
sur les commandes.
"""
import logging

from fastapi import APIRouter, Request

from core.cron import require_cron_token
from services import reminders

router = APIRouter(prefix="/internal/reminders", tags=["internal-reminders"])
logger = logging.getLogger("mgs.reminders")


@router.post("/run")
async def run(request: Request):
    require_cron_token(request)
    try:
        return await reminders.run_once()
    except Exception as exc:  # la réponse du cron doit rester stable même en cas de panne
        logger.warning("Relance des commandes impossible (%s)", type(exc).__name__)
        return {"checked": 0, "reminded": 0, "skipped": 0}
