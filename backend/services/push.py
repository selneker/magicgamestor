"""Standard VAPID push; no dependency on an external notification SaaS."""
import asyncio
import json
import logging
import os
from urllib.parse import urlsplit

import requests
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

from core.db import db
from core.security import ADMIN_ROLES
from models.messaging import PushSubscription

logger = logging.getLogger("mgs.push")

# Render provides VAPID_PRIVATE_KEY; older deployments used VAPID_PRIVATE_KEY_PEM. Accept both.
DEFAULT_ENDPOINT_HOSTS = ("*.push.services.mozilla.com,*.notify.windows.com,fcm.googleapis.com,"
                          "updates.push.services.mozilla.com,web.push.apple.com,*.push.apple.com,"
                          "android.googleapis.com")


def private_key() -> str:
    return (os.environ.get("VAPID_PRIVATE_KEY_PEM") or os.environ.get("VAPID_PRIVATE_KEY") or "").strip()


def endpoint_hosts() -> str:
    return (os.environ.get("PUSH_ENDPOINT_HOSTS") or DEFAULT_ENDPOINT_HOSTS).strip()


def _env_number(name: str, default, cast):
    try:
        return cast(os.environ.get(name, default))
    except ValueError:
        return cast(default)


def ttl_seconds() -> int:
    """Durée de vie côté service Push : un téléphone verrouillé doit recevoir l'alerte plus tard."""
    return max(0, _env_number("PUSH_TTL_S", 86400, int))


def urgency() -> str:
    return (os.environ.get("PUSH_URGENCY") or "high").strip() or "high"


def timeout_seconds() -> float:
    """Délai maximal d'un envoi : une alerte ne doit jamais bloquer le serveur."""
    return max(1.0, _env_number("PUSH_TIMEOUT_S", 10, float))


def configured():
    return bool(private_key() and os.environ.get("VAPID_PUBLIC_KEY") and os.environ.get("VAPID_SUBJECT"))


def _vapid():
    key = private_key().replace("\\n", "\n")
    if "BEGIN" in key:
        return Vapid.from_pem(key.encode())
    return Vapid.from_raw(key.encode())


def validate_endpoint(value):
    url = urlsplit(value)
    host = (url.hostname or "").lower()
    allowed = [h.strip().lower() for h in endpoint_hosts().split(",") if h.strip()]
    if (url.scheme != "https" or not url.path or url.username or url.password or url.query or url.fragment
            or url.port not in (None, 443) or not any(host == h or (h.startswith("*.") and host.endswith(h[1:])) for h in allowed)):
        raise ValueError("Endpoint Push non autorisé.")
    return value


class NoRedirectSession(requests.Session):
    def request(self, *args, **kwargs):
        kwargs["allow_redirects"] = False
        return super().request(*args, **kwargs)


def _send(subscription, payload):
    validate_endpoint(subscription.endpoint)
    vapid = _vapid()
    with NoRedirectSession() as session:
        # `urgency` n'a pas de paramètre dédié dans pywebpush 2.5.0 (vérifié) : il part en en-tête,
        # transmis tel quel au POST par WebPusher.send.
        webpush(subscription_info={"endpoint": subscription.endpoint, "keys": subscription.keys},
                data=json.dumps(payload, ensure_ascii=False), vapid_private_key=vapid,
                vapid_claims={"sub": os.environ["VAPID_SUBJECT"]}, ttl=ttl_seconds(),
                timeout=timeout_seconds(), headers={"urgency": urgency()}, requests_session=session)


def _reason(out: dict | None, code: str) -> None:
    if out is not None:
        out["code"] = code


async def send_push(subscription, payload, reason: dict | None = None):
    try:
        await asyncio.to_thread(_send, subscription, payload)
        return "sent"
    except WebPushException as exc:
        code = getattr(exc.response, "status_code", None)
        if code in (404, 410):
            await db.push_subscriptions.delete_one({"_id": subscription.id, "updated_at": subscription.updated_at})
            _reason(reason, "subscription_gone")
            return "expired"
        _reason(reason, "send_error")
        logger.warning("Push failed (status=%s)", code)
    except Exception as exc:
        # Exceptions may contain endpoint tokens: log their type only.
        _reason(reason, "timeout" if isinstance(exc, (TimeoutError, requests.Timeout)) else "send_error")
        logger.warning("Push failed (%s)", type(exc).__name__)
    return "failed"


async def admin_user_ids() -> set[str]:
    """Détenteurs d'un rôle admin, en une seule requête (même règle que `require_admin`)."""
    return {doc["user_id"] async for doc in db.users.find(
        {"role": {"$in": list(ADMIN_ROLES)}}, {"_id": 0, "user_id": 1})}


async def dispatch_to_users(user_ids, payload) -> dict:
    """Envoie à tous les abonnements des utilisateurs donnés (PL-ORDER-CLIENT-1).

    Réutilise la collection `push_subscriptions` et `send_push` : aucun nouveau système
    d'abonnement. Un identifiant absent (commande invitée) ne cible rien. Un abonnement mort
    (404/410) est supprimé par `send_push`, exactement comme pour les admins.
    """
    counts = {"targeted": 0, "sent": 0, "expired": 0, "failed": 0, "ignored": 0, "reasons": []}
    wanted = [str(user_id) for user_id in (user_ids or []) if user_id]
    if not wanted:
        return counts
    async for doc in db.push_subscriptions.find({"user_id": {"$in": wanted}}):
        subscription = PushSubscription.from_mongo(doc)
        counts["targeted"] += 1
        reason = {}
        result = await send_push(subscription, payload, reason)
        counts["expired" if result == "expired" else "sent" if result == "sent" else "failed"] += 1
        if result != "sent" and reason.get("code"):
            counts["reasons"].append(reason["code"])
    return counts


async def dispatch_to_admins(payload) -> dict:
    """Envoie à tous les abonnements des comptes admin ; retourne les compteurs et les raisons.

    Un abonnement dont le détenteur n'est pas admin est ignoré, jamais supprimé : seul le service
    Push (404/410) ou une désinscription explicite retire un abonnement.
    Une erreur d'abonnement ou de transport est comptée, jamais masquée : le journal d'alertes
    la rend visible. Les exceptions de la base remontent à l'appelant (`services.notifications`).
    """
    counts = {"targeted": 0, "sent": 0, "expired": 0, "failed": 0, "ignored": 0, "reasons": []}
    admins = await admin_user_ids()
    async for doc in db.push_subscriptions.find({}):
        subscription = PushSubscription.from_mongo(doc)
        if subscription.user_id not in admins:
            counts["ignored"] += 1
            continue
        counts["targeted"] += 1
        reason = {}
        result = await send_push(subscription, payload, reason)
        counts["expired" if result == "expired" else "sent" if result == "sent" else "failed"] += 1
        if result != "sent" and reason.get("code"):
            counts["reasons"].append(reason["code"])
    return counts
