"""Vérification serveur Cloudflare Turnstile.

`TURNSTILE_SECRET_KEY` absente ou vide → vérification sautée **hors production**
(dev/local, avant que la clé n'existe). Sur Render, la même absence REFUSE la
commande et écrit un log ERROR : une production ne doit jamais accepter une
commande sans vérification. `TURNSTILE_ENABLED` (défaut « true » quand la clé
existe) reste l'interrupteur volontaire du propriétaire.
"""
import logging
import os

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("mgs.captcha")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TIMEOUT_S = 5
_TRUE = ("1", "true", "yes", "on")
_FALSE = ("0", "false", "no", "off")

CAPTCHA_DETAIL = "Vérification anti-robot requise."
CAPTCHA_CODE = "captcha_required"


class CaptchaRequired(HTTPException):
    """400 dédié : le corps porte `code`, pour que le frontend distingue le CAPTCHA d'un autre 400."""

    def __init__(self) -> None:
        super().__init__(status_code=400, detail=CAPTCHA_DETAIL)


async def captcha_required_handler(_: Request, exc: CaptchaRequired) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": exc.detail, "code": CAPTCHA_CODE})


def _secret() -> str:
    return (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()


def _on_render() -> bool:
    """Vrai sur l'hôte de production : Render exporte `RENDER=true` (build et exécution)."""
    value = (os.environ.get("RENDER") or "").strip().lower()
    return bool(value) and value not in _FALSE


def enabled() -> bool:
    if not _secret():
        return False
    return (os.environ.get("TURNSTILE_ENABLED") or "true").strip().lower() in _TRUE


async def verify_turnstile(token: str | None, remote_ip: str | None = None) -> bool:
    """True si le jeton est valide (ou si la vérification est volontairement coupée). Ne lève jamais.

    Clé secrète absente : refus explicite si `RENDER` est défini (fail-closed, log ERROR),
    saut uniquement hors production (dev/local).
    """
    if not _secret():
        if _on_render():
            logger.error(
                "TURNSTILE_SECRET_KEY absente alors que RENDER est défini : "
                "vérification impossible, commande refusée (fail-closed)."
            )
            return False
        return True
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
    """Lève un 400 générique (code `captcha_required`) si le jeton est absent ou invalide."""
    if not await verify_turnstile(token, remote_ip):
        raise CaptchaRequired()
