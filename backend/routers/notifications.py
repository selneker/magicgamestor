"""Visibilité et test réel des alertes admin (PL-NOTIF-1, PL-NOTIF-5).

Même protection que les autres routes admin (`require_admin`). Aucune valeur secrète n'est renvoyée :
seulement deux booléens de configuration, un compteur d'abonnements et les 20 dernières lignes du
journal. Ni le jeton Telegram ni l'identifiant de conversation ne sortent d'ici.
"""
from fastapi import APIRouter, Depends

from core.db import db
from core.security import require_admin
from services import notifications, push, telegram

router = APIRouter(prefix="/admin/notifications", tags=["admin-notifications"])

# Champs du journal exposés : jamais de charge utile, de nom ni d'identifiant de joueur.
ALERT_FIELDS = {"_id": 1, "created_at": 1, "event": 1, "channel": 1, "status": 1, "reason": 1}


@router.get("/status")
async def status(user=Depends(require_admin)):
    admin_ids = await push.admin_user_ids()
    return {
        "vapid_configured": push.configured(),
        "telegram_configured": telegram.configured(),
        "push_subscriptions": await db.push_subscriptions.count_documents({"user_id": {"$in": list(admin_ids)}}),
        "alerts": await db.alert_log.find({}, ALERT_FIELDS).sort("created_at", -1).limit(20).to_list(20),
    }


@router.post("/test")
async def test(user=Depends(require_admin)):
    """Envoie une alerte `test` par le chemin des vraies alertes et renvoie le résultat par canal."""
    return await notifications.notify_admin(event="test", title="Magic Game Store",
                                            body="Test des notifications admin.",
                                            url="/admin/commandes", include_channels=True)
