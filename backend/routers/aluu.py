"""Routes publiques du fournisseur ALUU — webhook top-up (lot 5).

La route est PUBLIQUE (aucun cookie, aucun admin) : l'authenticité vient uniquement de la
signature HMAC calculée par ALUU sur les OCTETS BRUTS reçus. Rien d'autre n'est ouvert ici ;
les routes de configuration et de mapping arrivent au lot 6.

Références documentaires (doc ALUU) :
- « Webhooks & signatures » → « Top-up webhooks » : `X-Webhook-Timestamp` +
  `X-Webhook-Signature`, `hex(HMAC_SHA256(secret, timestamp + "." + raw_body))`, fenêtre 5 min ;
- « data.orderid is your partner_orderid » : l'identifiant de l'unité MGS, jamais la
  `reference` interne du fournisseur ;
- « Respond with any 2xx within 10 seconds. Do not rely on redelivery » : aucun retry, aucun
  polling, et une commande inconnue est acquittée.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from core.security import require_permission
from services import fzr_fulfillment, providers

router = APIRouter(tags=["aluu"])
logger = logging.getLogger("mgs.aluu.webhook")

WEBHOOK_PROVIDER = "aluu"
TIMESTAMP_HEADER = "X-Webhook-Timestamp"
SIGNATURE_HEADER = "X-Webhook-Signature"


@router.post("/aluu/webhook")
async def aluu_webhook(request: Request):
    """Réception d'un webhook top-up ALUU.

    BARRIÈRE 1 : la route est dédiée à ALUU et transmet `provider_name="aluu"` au domaine.
    BARRIÈRE 2 : la recherche d'unité filtre sur le fournisseur ENREGISTRÉ sur l'unité (voir
    `fzr_fulfillment.apply_provider_event`) : un identifiant identique porté par une unité
    FazerCards ne peut pas être mis à jour par ce webhook.

    Le corps n'est jamais re-sérialisé : `request.body()` rend les octets exacts reçus, et
    c'est sur eux que porte la signature.
    """
    raw = await request.body()
    provider = providers.get_provider_by_name(WEBHOOK_PROVIDER)
    if not provider.verify_webhook_signature(
            raw, request.headers.get(SIGNATURE_HEADER), request.headers.get(TIMESTAMP_HEADER)):
        # Aucune valeur d'en-tête n'est journalisée : elle est non fiable et non nécessaire.
        logger.warning("ALUU webhook rejected: invalid or stale signature")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    event = provider.parse_webhook_event(payload)
    return await fzr_fulfillment.apply_provider_event(
        provider_name=WEBHOOK_PROVIDER,
        provider_order_id=event.provider_order_id,
        status=event.status,
        event=event.event,
    )


# --------------------------------------------------------------------------- réconciliation admin

@router.get("/admin/aluu/units", dependencies=[Depends(require_permission("orders.manage"))])
async def aluu_non_final_units(game: str | None = None, limit: int = 100):
    """Unités ALUU non finales (réconciliation manuelle).

    LECTURE SEULE : aucun appel fournisseur, aucun polling, aucun retry, aucune écriture.
    Le rafraîchissement d'une unité reste une action admin explicite sur la commande.
    """
    return await fzr_fulfillment.non_final_units(game, limit)
