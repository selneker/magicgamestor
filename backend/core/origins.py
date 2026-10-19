"""Origines autorisées et vérification anti-CSRF, partagées par CORS et les routes auth.

Politique :
- liste d'origines exactes (aucun wildcard) : CORS_ORIGINS + FRONTEND_URL, plus la paire
  apex/www du site uniquement (jamais www.api.* ni un autre sous-domaine) ;
- une requête qui porte un Origin/Referer doit venir d'une origine autorisée ;
- sans Origin/Referer, on s'appuie sur Sec-Fetch-Site quand le navigateur l'envoie : une
  requête cross-site est refusée, same-origin/none est acceptée ;
- sans aucun de ces en-têtes (curl, tests, intégrations serveur), la requête est acceptée :
  ces clients ne sont pas exposés au CSRF navigateur et le backend doit rester utilisable
  hors navigateur.
"""
import os
import secrets
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

DEFAULT_ORIGIN = "http://localhost:3000"


def _normalize(origin: str) -> str:
    return origin.strip().rstrip("/")


def _www_variant(origin: str) -> str | None:
    """Retourne la variante apex↔www d'une origine de site, sans élargir aux sous-domaines."""
    parts = urlsplit(origin)
    host = parts.hostname or ""
    if not parts.scheme or not host:
        return None
    if host.startswith("www."):
        host = host[4:]
    elif host.count(".") == 1:
        host = f"www.{host}"
    else:
        return None
    netloc = f"{host}:{parts.port}" if parts.port else host
    return f"{parts.scheme}://{netloc}"


def allowed_origins() -> set[str]:
    origins: set[str] = set()
    for raw in os.environ.get("CORS_ORIGINS", "").split(","):
        origin = _normalize(raw)
        if origin and origin != "*":
            origins.add(origin)
    frontend = _normalize(os.environ.get("FRONTEND_URL") or "")
    if frontend:
        origins.add(frontend)
    for origin in list(origins):
        variant = _www_variant(origin)
        if variant:
            origins.add(variant)
    return origins or {DEFAULT_ORIGIN}


def request_origin(request: Request) -> str | None:
    origin = (request.headers.get("origin") or "").strip()
    if origin:
        return origin.rstrip("/")
    referer = (request.headers.get("referer") or "").strip()
    if referer:
        parts = urlsplit(referer)
        if parts.scheme and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}"
    return None


def require_trusted_origin(request: Request) -> None:
    origin = request_origin(request)
    if origin:
        if origin not in allowed_origins():
            raise HTTPException(status_code=403, detail="Origine non autorisée.")
        return
    site = (request.headers.get("sec-fetch-site") or "").strip().lower()
    if site and site not in ("same-origin", "none"):
        raise HTTPException(status_code=403, detail="Requête cross-site refusée.")


def oauth_state_matches(cookie_state: str | None, query_state: str | None) -> bool:
    """Le state OAuth doit correspondre au cookie déposé dans CE navigateur (login CSRF)."""
    if not cookie_state or not query_state:
        return False
    return secrets.compare_digest(cookie_state, query_state)
