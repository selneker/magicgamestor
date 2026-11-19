"""PL-006-T08C-V1 — webhook Shop2Topup.

Routeur DÉDIÉ, et non un ajout à `routers/fzr_orders.py` : tous les autres endpoints de ce
module sont des routes admin FazerCards, alors qu'un événement Shop2Topup est un événement
fournisseur générique. Les séparer rend la frontière lisible (T16 nomme déjà le fournisseur
explicitement) et évite de rouvrir un module de 369 lignes pour y ajouter une route étrangère.

Ce qui est CERTAIN (RAPPORT-SHOP2TOPUP-API.md § 7) : la signature est un HMAC-SHA256 du **corps
brut**, poussé vers une URL HTTPS déclarée. Ce qui n'y est PAS documenté — donc marqué
« À CONFIRMER » ici et dans les points ouverts du rapport — :
- le nom de l'en-tête de signature (`X-Shop2Topup-Signature` ci-dessous) ;
- le préfixe `sha256=` du format de signature (imposé par l'adaptateur existant) ;
- la forme exacte du corps (`event`, `data.order_id`, `data.status`), celle que lit déjà
  `parse_webhook_event()`.
Une correction après le premier événement réel ne touche que `SIGNATURE_HEADER` ici et, pour le
format, `verify_webhook_signature()` dans `services/providers/shop2topup_adapter.py`.
"""
import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request

from services import order_maintenance, providers
from services.providers.shop2topup_adapter import WEBHOOK_SECRET_ENV

router = APIRouter(tags=["shop2topup"])
logger = logging.getLogger("mgs.shop2topup")

# À CONFIRMER : nom d'en-tête absent du rapport. C'est celui qu'annonce l'adaptateur existant.
SIGNATURE_HEADER = "X-Shop2Topup-Signature"


@router.post("/shop2topup/webhook")
async def shop2topup_webhook(request: Request):
    """Vérifie la signature sur le RAW BODY, puis applique l'événement.

    - `503` si `SHOP2TOPUP_WEBHOOK_SECRET` est absent : le webhook n'est pas configuré, et
      accepter un corps non signé serait pire qu'une indisponibilité.
    - `401` si la signature est absente ou fausse (comparaison en temps constant, déléguée à
      l'adaptateur) ; aucun corps n'est journalisé, il peut contenir un identifiant joueur.
    - `400` si le corps n'est pas un objet JSON.
    - `200` ensuite, y compris pour un doublon ou un événement ignoré (même contrat que FazerCards).
    """
    raw = await request.body()
    if not (os.environ.get(WEBHOOK_SECRET_ENV) or "").strip():
        logger.warning("webhook Shop2Topup refusé : secret non configuré")
        raise HTTPException(status_code=503, detail="Webhook non configuré")
    provider = providers.get_provider(None, "shop2topup")
    if not provider.verify_webhook_signature(raw, request.headers.get(SIGNATURE_HEADER)):
        logger.warning("webhook Shop2Topup refusé : signature invalide")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    return await order_maintenance.apply_shop2topup_event(payload)
