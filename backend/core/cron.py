"""Jeton partagé des tâches planifiées (cron-job.org).

Une seule règle pour toutes les routes internes : `CRON_TOKEN` absent ⇒ route désactivée (503),
jeton comparé en temps constant, jamais renvoyé ni journalisé.
"""
import hmac
import os

from fastapi import HTTPException, Request


def token() -> str:
    return os.environ.get("CRON_TOKEN", "").strip()


def require_cron_token(request: Request) -> None:
    expected = token()
    if not expected:
        raise HTTPException(status_code=503, detail="Tâches planifiées désactivées.")
    supplied = request.headers.get("x-cron-token") or ""
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
