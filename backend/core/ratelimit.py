"""In-memory sliding-window rate limiter (single-instance). Limits are env-configurable."""
import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    # Behind Render's proxy the trusted client address is the LAST hop appended to X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def setting(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _trusted_ips() -> set[str]:
    return {ip.strip() for ip in os.environ.get("RATE_LIMIT_TRUSTED_IPS", "").split(",") if ip.strip()}


def check(key: str, limit: int, window_s: int, detail: str = "Trop de requêtes. Réessayez dans quelques minutes."):
    if limit <= 0 or (":ip:" in key and key.rsplit(":ip:", 1)[1] in _trusted_ips()):
        return
    now = time.time()
    bucket = _hits[key]
    while bucket and bucket[0] <= now - window_s:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail=detail)
    bucket.append(now)


def reset():
    _hits.clear()
