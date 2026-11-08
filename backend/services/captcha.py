"""Vérification serveur Cloudflare Turnstile.

`TURNSTILE_SECRET_KEY` absente ou vide → vérification sautée : le site reste utilisable
avant que la clé ne soit créée. `TURNSTILE_ENABLED` (défaut « true » quand la clé existe)
permet de couper la vérification sans retirer la clé.
"""
import logging
import os

import httpx
from fastapi import HTTPException

logger = logging.getLogger("mgs.captcha")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TIMEOUT_S = 5
_TRUE = ("1", "true", "yes", "on")


def enabled() -> bool:
    if not (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip():
        return False
    return (os.environ.get("TURNSTILE_ENABLED") or "true").strip().lower() in _TRUE


async def verify_turnstile(token: str | None, remote_ip: str | None = None) -> bool:
    """True si le jeton est valide (ou si la vérification est désactivée). Ne lève jamais."""
    if not enabled():
        return True
    if not token:
        return False
    data = {"secret": os.environ["TURNSTILE_SECRET_KEY"], "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            response = await client.post(SITEVERIFY_URL, data=data)
        return response.status_code == 200 and bool(response.json().get("success"))
    except Exception as exc:  # réseau, timeout, JSON invalide : refus sans casser la requête
        logger.warning("Turnstile verification failed (%s)", type(exc).__name__)
        return False


async def require(token: str | None, remote_ip: str | None = None):
    """Lève un 400 générique si la vérification est active et que le jeton est absent/invalide."""
    if not await verify_turnstile(token, remote_ip):
        raise HTTPException(status_code=400, detail="Vérification anti-robot requise.")
