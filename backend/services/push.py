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
        webpush(subscription_info={"endpoint": subscription.endpoint, "keys": subscription.keys},
                data=json.dumps(payload, ensure_ascii=False), vapid_private_key=vapid,
                vapid_claims={"sub": os.environ["VAPID_SUBJECT"]}, ttl=86400, timeout=10,
                requests_session=session)


async def send_push(subscription, payload):
    try:
        await asyncio.to_thread(_send, subscription, payload)
        return "sent"
    except WebPushException as exc:
        code = getattr(exc.response, "status_code", None)
        if code in (404, 410):
            await db.push_subscriptions.delete_one({"_id": subscription.id, "updated_at": subscription.updated_at})
            return "expired"
        logger.warning("Push failed (status=%s)", code)
    except Exception as exc:
        # Exceptions may contain endpoint tokens: log their type only.
        logger.warning("Push failed (%s)", type(exc).__name__)
    return "failed"


async def _dispatch_to_admins(payload):
    try:
        async for doc in db.push_subscriptions.find({}):
            subscription = PushSubscription.from_mongo(doc)
            if await db.users.find_one({"user_id": subscription.user_id, "role": "admin"}, {"_id": 1}):
                await send_push(subscription, payload)
            else:
                await db.push_subscriptions.delete_one({"_id": subscription.id})
    except Exception as exc:
        logger.warning("Push dispatch failed (%s)", type(exc).__name__)


async def notify_new_order(order):
    if not configured():
        return
    payload = {"title": "Magic Game Store", "body": f"Nouvelle commande {order['order_number']}\n{order['total']:,} Ar".replace(",", " "),
               "orderId": order["id"], "url": f"/admin/commandes?order={order['id']}"}
    await _dispatch_to_admins(payload)


async def notify_new_message(conversation_id, sender_name, text):
    if not configured():
        return
    preview = text if len(text) <= 80 else text[:77] + "…"
    payload = {"title": "Magic Game Store", "body": f"Nouveau message de {sender_name}\n{preview}",
               "tag": f"chat-{conversation_id}", "url": "/admin/messages"}
    await _dispatch_to_admins(payload)
