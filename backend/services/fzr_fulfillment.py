"""FazerCards Phase 3 — commande fournisseur réelle. Une offre, une commande, idempotence stricte."""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from services import fazercards

logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}
RETRYABLE = ("submit_timeout", "error")
PROVIDER_TO_MGS_DELIVERED = ("completed",)
PROVIDER_ALERT = ("failed", "refunded", "cancelled")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def auto_enabled() -> bool:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "fzr_auto": 1})
    return bool(doc and doc.get("fzr_auto"))


async def mapped_item(order: dict):
    """Éligible ssi exactement 1 article, quantité 1, produit lié à une offre FazerCards (pas de multi-SKU)."""
    items = order.get("items") or []
    if len(items) != 1 or items[0].get("quantity") != 1:
        return None
    product = await db.products.find_one({"id": items[0]["product_id"]}, {"_id": 0, "fazercards_mapping": 1})
    mapping = (product or {}).get("fazercards_mapping")
    if not mapping or not mapping.get("category_id") or not mapping.get("offer_id"):
        return None
    return items[0], mapping


async def preflight(order_id: str) -> dict:
    """Rapport pré-commande (§18) : toutes les vérifications, AUCUNE commande créée."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    existing = order.get("fazercards")
    if existing and existing.get("provider_order_id"):
        raise HTTPException(status_code=409, detail=f"Déjà envoyée au fournisseur ({existing['provider_order_id']}).")
    if order["status"] != "paid":
        raise HTTPException(status_code=409, detail="Paiement non confirmé : la commande doit être au statut « payée ».")
    eligible = await mapped_item(order)
    if not eligible:
        raise HTTPException(status_code=409, detail="Commande non éligible : un seul article (qté 1) lié à une offre FazerCards est requis.")
    item, mapping = eligible
    validation = await fazercards.validate_pubg_id(order["pubg_id"])  # 502/504 si service indisponible
    if not validation["valid"]:
        raise HTTPException(status_code=409, detail="ID PUBG Mobile invalide chez le fournisseur — commande non envoyée.")
    offers = await fazercards.pubg_offers_fresh(mapping["category_id"])
    offer = next((o for o in offers["offers"] if o["offer_id"] == mapping["offer_id"]), None)
    if not offer:
        raise HTTPException(status_code=409, detail="Offre indisponible chez le fournisseur (retirée du catalogue).")
    field_keys = [f["key"] for f in offers["fields"] if f.get("key")]
    field_key = "player_id" if "player_id" in field_keys else (field_keys[0] if field_keys else "player_id")
    idem = existing["idempotency_key"] if existing else f"{order['order_number']}-1"
    return {
        "order_number": order["order_number"], "product": item["name"], "provider": "fazercards",
        "category_id": mapping["category_id"], "offer_id": mapping["offer_id"], "offer_name": offer["name"],
        "price_usd": offer["price_usd"], "player_id": order["pubg_id"],
        "player_name": validation.get("player_name"), "field_key": field_key,
        "idempotency_key": idem, "retry": bool(existing), "mgs_total": order["total"],
    }


async def fulfill_order(order_id: str, actor: str) -> dict:
    """Toutes les vérifications puis POST /topups/order. Retry réutilise la même Idempotency-Key."""
    report = await preflight(order_id)
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    record = {
        "provider": "fazercards", "status": "creating", "provider_order_id": None, "provider_status": None,
        "category_id": report["category_id"], "offer_id": report["offer_id"], "offer_name": report["offer_name"],
        "player_id": report["player_id"], "player_name_at_validation": report["player_name"],
        "supplier_price_usd_at_order": report["price_usd"], "idempotency_key": report["idempotency_key"],
        "requested_by": actor, "last_error": None,
        "created_at": (order.get("fazercards") or {}).get("created_at") or _now(), "updated_at": _now(),
    }
    if order.get("fazercards"):
        claim = await db.orders.update_one(
            {"id": order_id, "fazercards.provider_order_id": None, "fazercards.status": {"$in": list(RETRYABLE)}},
            {"$set": {"fazercards": record, "updated_at": _now()}})
    else:
        claim = await db.orders.update_one(
            {"id": order_id, "status": "paid", "fazercards": {"$exists": False}},
            {"$set": {"fazercards": record, "updated_at": _now()}})
    if claim.modified_count != 1:
        raise HTTPException(status_code=409, detail="Un envoi fournisseur est déjà en cours pour cette commande.")
    try:
        provider_order = await fazercards.create_topup_order(
            report["category_id"], report["offer_id"],
            {report["field_key"]: report["player_id"]}, report["idempotency_key"])
    except fazercards.ProviderTimeout:
        await _update_record(order_id, {"status": "submit_timeout", "last_error": "timeout après soumission"})
        await audit("fzr.order_timeout", actor, order_id, {"idempotency_key": report["idempotency_key"]})
        raise HTTPException(status_code=504, detail="La requête fournisseur a expiré. Réessayez : la même clé d'idempotence sera réutilisée (aucun double top-up).")
    except fazercards.ProviderOrderError as exc:
        await _update_record(order_id, {"status": "error", "last_error": exc.error})
        await audit("fzr.order_error", actor, order_id, {"error": exc.error, "code": exc.code, "http": exc.status_code})
        raise HTTPException(status_code=409 if exc.status_code < 500 else 502,
                            detail=f"Commande fournisseur refusée : {exc.error}")
    provider_status = str(provider_order.get("status") or "processing")
    await _update_record(order_id, {"status": "submitted", "provider_order_id": provider_order["id"],
                                    "provider_status": provider_status})
    await audit("fzr.order_created", actor, order_id, {
        "provider_order_id": provider_order["id"], "offer_id": report["offer_id"],
        "supplier_price_usd": report["price_usd"], "idempotency_key": report["idempotency_key"]})
    await _sync_mgs_status(order_id, provider_status, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return updated["fazercards"]


async def _update_record(order_id: str, fields: dict):
    await db.orders.update_one({"id": order_id}, {"$set": {
        **{f"fazercards.{k}": v for k, v in fields.items()}, "fazercards.updated_at": _now(), "updated_at": _now()}})


async def refresh_status(order_id: str, actor: str) -> dict:
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order or not (order.get("fazercards") or {}).get("provider_order_id"):
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    provider = await fazercards.get_provider_order(order["fazercards"]["provider_order_id"])
    provider_status = str(provider.get("status") or order["fazercards"].get("provider_status") or "processing")
    await _update_record(order_id, {"provider_status": provider_status})
    await _sync_mgs_status(order_id, provider_status, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return updated["fazercards"]


async def _sync_mgs_status(order_id: str, provider_status: str, actor: str):
    """Réutilise le lifecycle MGS existant : completed fournisseur ⇒ paid → delivered."""
    if provider_status in PROVIDER_TO_MGS_DELIVERED:
        res = await db.orders.update_one(
            {"id": order_id, "status": "paid"},
            {"$set": {"status": "delivered", "updated_at": _now()},
             "$push": {"history": {"status": "delivered", "at": _now()}}})
        if res.modified_count:
            await audit("order.status_change", actor, order_id, {"from": "paid", "to": "delivered", "note": "FazerCards completed"})
    elif provider_status in PROVIDER_ALERT:
        await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status})


async def auto_fulfill(order: dict):
    """Mode automatique (kill switch admin). Ne bloque jamais la confirmation de paiement."""
    try:
        if not await auto_enabled() or not await mapped_item(order):
            return
        await fulfill_order(order["id"], "auto")
        logger.info("fzr auto fulfillment submitted for %s", order["order_number"])
    except HTTPException as exc:
        logger.warning("fzr auto fulfillment refused for %s: %s", order.get("order_number"), exc.detail)
        await audit("fzr.auto_fulfill_refused", "auto", order.get("id"), {"detail": str(exc.detail)[:200]})
    except Exception as exc:
        logger.warning("fzr auto fulfillment error for %s (%s)", order.get("order_number"), type(exc).__name__)


async def apply_webhook_event(event: dict) -> dict:
    """order.created / order.status_changed → synchronise le statut MGS. Dédupliqué par event_id."""
    data = event.get("data") or {}
    provider_order_id = data.get("order_id")
    if not provider_order_id:
        return {"ok": True, "ignored": True}
    try:
        await db.fzr_webhook_events.insert_one({
            "event_id": event.get("event_id") or str(uuid.uuid4()), "event": event.get("event"),
            "provider_order_id": provider_order_id, "status": data.get("status"), "created_at": _now()})
    except Exception:
        return {"ok": True, "duplicate": True}
    order = await db.orders.find_one({"fazercards.provider_order_id": provider_order_id}, PUBLIC)
    if not order:
        return {"ok": True, "ignored": True}
    if event.get("event") == "order.status_changed" and data.get("status"):
        provider_status = str(data["status"])
        await _update_record(order["id"], {"provider_status": provider_status})
        await _sync_mgs_status(order["id"], provider_status, "webhook:fazercards")
        await audit("fzr.webhook_status", "fazercards", order["id"],
                    {"provider_order_id": provider_order_id, "status": provider_status,
                     "previous_status": data.get("previous_status")})
    return {"ok": True}
