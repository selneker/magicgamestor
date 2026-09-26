"""FazerCards Phase 3 — commande fournisseur réelle, par LIGNE de commande MGS.
Rétrocompat : la ligne 0 garde le record historique `order.fazercards` et la clé `{order_number}-1` ;
les lignes suivantes utilisent `order.fazercards_lines.{idx}` et `{order_number}-L{idx+1}-1`.
Une commande MGS = N lignes = jusqu'à N commandes FazerCards indépendantes."""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from services import fazercards, fzr_mapping

logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}
RETRYABLE = ("submit_timeout", "error")
PROVIDER_TO_MGS_DELIVERED = ("completed",)
PROVIDER_ALERT = ("failed", "refunded", "cancelled")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _line_path(idx: int) -> str:
    return "fazercards" if idx == 0 else f"fazercards_lines.{idx}"


def line_record(order: dict, idx: int) -> dict | None:
    if idx == 0:
        return order.get("fazercards")
    return (order.get("fazercards_lines") or {}).get(str(idx))


def _idem_key(order: dict, idx: int) -> str:
    return f"{order['order_number']}-1" if idx == 0 else f"{order['order_number']}-L{idx + 1}-1"


def _sendable(record: dict | None) -> bool:
    """Ligne envoyable : aucun record, ou record retryable sans provider_order_id."""
    if not record:
        return True
    return not record.get("provider_order_id") and record.get("status") in RETRYABLE


async def auto_enabled() -> bool:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "fzr_auto": 1})
    return bool(doc and doc.get("fzr_auto"))


async def _line_states(order: dict) -> tuple[list, list]:
    """(eligible, skipped) — eligible: [(idx, item, mapping)], skipped: [{index, product, reason}]."""
    eligible, skipped = [], []
    for idx, item in enumerate(order.get("items") or []):
        record = line_record(order, idx)
        if not _sendable(record):
            continue  # déjà envoyée / en cours : ni éligible ni "skipped"
        if item.get("quantity") != 1:
            skipped.append({"index": idx, "product": item.get("name"),
                            "reason": "Quantité > 1 : envoi fournisseur non pris en charge pour cette ligne."})
            continue
        product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0, "fazercards_mapping": 1})
        mapping = (product or {}).get("fazercards_mapping")
        if fzr_mapping.fulfillable(mapping):
            eligible.append((idx, item, mapping))
        else:
            status = fzr_mapping.mapping_status(mapping)
            reason = {
                "missing": "⚠ Mapping fournisseur manquant : liez ce produit à une offre FazerCards dans Admin → Fournisseur.",
                "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance avant tout envoi.",
                "composite": "Mapping composé : l'envoi multi-commandes fournisseur n'est pas encore activé.",
            }.get(status, "Mapping fournisseur invalide.")
            skipped.append({"index": idx, "product": item.get("name"), "reason": reason})
    return eligible, skipped


async def eligible_lines(order: dict) -> list:
    return (await _line_states(order))[0]


async def preflight(order_id: str) -> dict:
    """Rapport pré-commande : toutes les vérifications pour chaque ligne, AUCUNE commande créée."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    items = order.get("items") or []
    single = len(items) == 1
    records = [line_record(order, i) for i in range(len(items))]
    sent_ids = [r["provider_order_id"] for r in records if r and r.get("provider_order_id")]
    if items and all(not _sendable(r) for r in records):
        raise HTTPException(status_code=409, detail=f"Déjà envoyée au fournisseur ({', '.join(sent_ids) or 'en cours'}).")
    if order["status"] != "paid":
        raise HTTPException(status_code=409, detail="Paiement non confirmé : la commande doit être au statut « payée ».")
    eligible, skipped = await _line_states(order)
    if not eligible:
        detail = skipped[0]["reason"] if single and skipped else \
            "Aucune ligne éligible : " + "; ".join(f"{s['product']} — {s['reason']}" for s in skipped)
        raise HTTPException(status_code=409, detail=detail or "Aucune ligne éligible.")
    validation = await fazercards.validate_pubg_id(order["pubg_id"])  # 502/504 si service indisponible
    if not validation["valid"]:
        raise HTTPException(status_code=409, detail="ID PUBG Mobile invalide chez le fournisseur — commande non envoyée.")
    offers_by_cat, lines = {}, []
    for idx, item, mapping in eligible:
        cat = mapping["category_id"]
        if cat not in offers_by_cat:
            offers_by_cat[cat] = await fazercards.pubg_offers_fresh(cat)
        offers = offers_by_cat[cat]
        offer = next((o for o in offers["offers"] if o["offer_id"] == mapping["offer_id"]), None)
        if not offer:
            reason = "Offre indisponible chez le fournisseur (retirée du catalogue)."
            if single:
                raise HTTPException(status_code=409, detail=reason)
            skipped.append({"index": idx, "product": item["name"], "reason": reason})
            continue
        field_keys = [f["key"] for f in offers["fields"] if f.get("key")]
        field_key = "player_id" if "player_id" in field_keys else (field_keys[0] if field_keys else "player_id")
        record = line_record(order, idx)
        lines.append({
            "index": idx, "product": item["name"], "category_id": mapping["category_id"],
            "offer_id": mapping["offer_id"], "offer_name": offer["name"], "price_usd": offer["price_usd"],
            "field_key": field_key, "idempotency_key": record["idempotency_key"] if record else _idem_key(order, idx),
            "retry": bool(record),
        })
    if not lines:
        raise HTTPException(status_code=409, detail=skipped[-1]["reason"] if skipped else "Aucune ligne éligible.")
    report = {
        "order_number": order["order_number"], "provider": "fazercards", "player_id": order["pubg_id"],
        "player_name": validation.get("player_name"), "mgs_total": order["total"],
        "lines": lines, "skipped": skipped, "ready_count": len(lines),
    }
    if single:  # compat mono-ligne : champs historiques au premier niveau
        report.update({k: lines[0][k] for k in
                       ("product", "category_id", "offer_id", "offer_name", "price_usd", "field_key", "idempotency_key", "retry")})
    return report


async def _fulfill_line(order: dict, line: dict, actor: str) -> dict:
    """Claim atomique + POST /topups/order pour UNE ligne. Retry réutilise la même Idempotency-Key."""
    order_id, idx, path = order["id"], line["index"], _line_path(line["index"])
    existing = line_record(order, idx)
    record = {
        "provider": "fazercards", "status": "creating", "provider_order_id": None, "provider_status": None,
        "line_index": idx, "product_name": line["product"],
        "category_id": line["category_id"], "offer_id": line["offer_id"], "offer_name": line["offer_name"],
        "player_id": order["pubg_id"], "player_name_at_validation": line.get("player_name") or None,
        "supplier_price_usd_at_order": line["price_usd"], "idempotency_key": line["idempotency_key"],
        "requested_by": actor, "last_error": None,
        "created_at": (existing or {}).get("created_at") or _now(), "updated_at": _now(),
    }
    if existing:
        claim = await db.orders.update_one(
            {"id": order_id, f"{path}.provider_order_id": None, f"{path}.status": {"$in": list(RETRYABLE)}},
            {"$set": {path: record, "updated_at": _now()}})
    else:
        claim = await db.orders.update_one(
            {"id": order_id, "status": "paid", path: {"$exists": False}},
            {"$set": {path: record, "updated_at": _now()}})
    if claim.modified_count != 1:
        raise HTTPException(status_code=409, detail="Un envoi fournisseur est déjà en cours pour cette ligne.")
    try:
        provider_order = await fazercards.create_topup_order(
            line["category_id"], line["offer_id"], {line["field_key"]: order["pubg_id"]}, line["idempotency_key"])
    except fazercards.ProviderTimeout:
        await _update_record(order_id, idx, {"status": "submit_timeout", "last_error": "timeout après soumission"})
        await audit("fzr.order_timeout", actor, order_id, {"idempotency_key": line["idempotency_key"], "line": idx})
        raise HTTPException(status_code=504, detail="La requête fournisseur a expiré. Réessayez : la même clé d'idempotence sera réutilisée (aucun double top-up).")
    except fazercards.ProviderOrderError as exc:
        await _update_record(order_id, idx, {"status": "error", "last_error": exc.error})
        await audit("fzr.order_error", actor, order_id, {"error": exc.error, "code": exc.code, "http": exc.status_code, "line": idx})
        raise HTTPException(status_code=409 if exc.status_code < 500 else 502,
                            detail=f"Commande fournisseur refusée : {exc.error}")
    provider_status = str(provider_order.get("status") or "processing")
    await _update_record(order_id, idx, {"status": "submitted", "provider_order_id": provider_order["id"],
                                         "provider_status": provider_status})
    await db.orders.update_one({"id": order_id}, {"$addToSet": {"fazercards_provider_ids": provider_order["id"]}})
    await audit("fzr.order_created", actor, order_id, {
        "provider_order_id": provider_order["id"], "offer_id": line["offer_id"], "line": idx,
        "supplier_price_usd": line["price_usd"], "idempotency_key": line["idempotency_key"]})
    if provider_status in PROVIDER_ALERT:
        await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": idx})
    await _sync_mgs_status(order_id, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return line_record(updated, idx)


async def fulfill_order(order_id: str, actor: str) -> dict:
    """Envoie séquentiellement toutes les lignes éligibles. Mono-ligne : comportement historique inchangé."""
    report = await preflight(order_id)
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    single = len(order.get("items") or []) == 1
    results = []
    for line in report["lines"]:
        line = {**line, "player_name": report.get("player_name")}
        try:
            record = await _fulfill_line(order, line, actor)
            results.append({"index": line["index"], "product": line["product"], "ok": True, "fazercards": record})
        except HTTPException as exc:
            if single:
                raise
            results.append({"index": line["index"], "product": line["product"], "ok": False,
                            "error": str(exc.detail), "status_code": exc.status_code})
    if single:
        updated = await db.orders.find_one({"id": order_id}, PUBLIC)
        return updated["fazercards"]
    return {"order_number": report["order_number"], "results": results, "skipped": report["skipped"]}


async def _update_record(order_id: str, idx: int, fields: dict):
    path = _line_path(idx)
    await db.orders.update_one({"id": order_id}, {"$set": {
        **{f"{path}.{k}": v for k, v in fields.items()}, f"{path}.updated_at": _now(), "updated_at": _now()}})


async def refresh_status(order_id: str, actor: str) -> dict:
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    items = order.get("items") or []
    targets = [(i, line_record(order, i)) for i in range(len(items))
               if line_record(order, i) and line_record(order, i).get("provider_order_id")]
    if not targets:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    for idx, rec in targets:
        provider = await fazercards.get_provider_order(rec["provider_order_id"])
        provider_status = str(provider.get("status") or rec.get("provider_status") or "processing")
        await _update_record(order_id, idx, {"provider_status": provider_status})
        if provider_status in PROVIDER_ALERT:
            await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": idx})
    await _sync_mgs_status(order_id, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    if len(items) == 1:
        return updated["fazercards"]
    return {"lines": [{"index": idx, "fazercards": line_record(updated, idx)} for idx, _ in targets]}


async def _sync_mgs_status(order_id: str, actor: str):
    """paid → delivered UNIQUEMENT quand TOUTES les lignes de la commande sont completed fournisseur."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order or order.get("status") != "paid":
        return
    items = order.get("items") or []
    records = [line_record(order, i) for i in range(len(items))]
    if not records or not all(r and r.get("provider_status") in PROVIDER_TO_MGS_DELIVERED for r in records):
        return
    res = await db.orders.update_one(
        {"id": order_id, "status": "paid"},
        {"$set": {"status": "delivered", "updated_at": _now()},
         "$push": {"history": {"status": "delivered", "at": _now()}}})
    if res.modified_count:
        await audit("order.status_change", actor, order_id, {"from": "paid", "to": "delivered", "note": "FazerCards completed"})


async def auto_fulfill(order: dict):
    """Mode automatique (kill switch admin). Ne bloque jamais la confirmation de paiement."""
    try:
        if not await auto_enabled() or not await eligible_lines(order):
            return
        await fulfill_order(order["id"], "auto")
        logger.info("fzr auto fulfillment submitted for %s", order["order_number"])
    except HTTPException as exc:
        logger.warning("fzr auto fulfillment refused for %s: %s", order.get("order_number"), exc.detail)
        await audit("fzr.auto_fulfill_refused", "auto", order.get("id"), {"detail": str(exc.detail)[:200]})
    except Exception as exc:
        logger.warning("fzr auto fulfillment error for %s (%s)", order.get("order_number"), type(exc).__name__)


async def apply_webhook_event(event: dict) -> dict:
    """order.created / order.status_changed → synchronise la ligne concernée. Dédupliqué par event_id."""
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
    order = await db.orders.find_one({"$or": [{"fazercards.provider_order_id": provider_order_id},
                                              {"fazercards_provider_ids": provider_order_id}]}, PUBLIC)
    if not order:
        return {"ok": True, "ignored": True}
    idx = next((i for i in range(len(order.get("items") or []))
                if (line_record(order, i) or {}).get("provider_order_id") == provider_order_id), None)
    if idx is None:
        return {"ok": True, "ignored": True}
    if event.get("event") == "order.status_changed" and data.get("status"):
        provider_status = str(data["status"])
        await _update_record(order["id"], idx, {"provider_status": provider_status})
        if provider_status in PROVIDER_ALERT:
            await audit("fzr.provider_failed", "webhook:fazercards", order["id"], {"provider_status": provider_status, "line": idx})
        await _sync_mgs_status(order["id"], "webhook:fazercards")
        await audit("fzr.webhook_status", "fazercards", order["id"],
                    {"provider_order_id": provider_order_id, "status": provider_status,
                     "previous_status": data.get("previous_status"), "line": idx})
    return {"ok": True}
