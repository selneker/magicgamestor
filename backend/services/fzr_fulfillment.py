"""FazerCards Phase 3/4 — commande fournisseur par UNITÉ de fulfillment.

Une commande MGS = N lignes. Chaque ligne produit possède un mapping fournisseur :
- DIRECT  → 1 unité de fulfillment (1 commande FazerCards).
- COMPOSÉ → décomposition INTERNE en plusieurs unités (720 UC → 660 + 60), chacune = 1 commande FazerCards
  indépendante utilisant l'offre DIRECTE correspondante. Le panier / prix / ligne client ne changent JAMAIS.

Chaque unité a son propre provider_order_id et sa propre Idempotency-Key STABLE :
- ligne directe idx 0  → record `order.fazercards`,                    clé `{order}-1`      (rétrocompat)
- ligne directe idx>0  → record `order.fazercards_lines.{idx}`,        clé `{order}-L{idx+1}-1`
- composant (idx, u)   → record `order.fazercards_components.{idx}.{u}`, clé `{order}-L{idx+1}-C{u+1}`
"""
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


def _unit_path(line_index: int, component_index) -> str:
    if component_index is None:
        return _line_path(line_index)
    return f"fazercards_components.{line_index}.{component_index}"


def line_record(order: dict, idx: int) -> dict | None:
    if idx == 0:
        return order.get("fazercards")
    return (order.get("fazercards_lines") or {}).get(str(idx))


def unit_record(order: dict, unit: dict) -> dict | None:
    if unit["component_index"] is None:
        return line_record(order, unit["line_index"])
    comps = (order.get("fazercards_components") or {}).get(str(unit["line_index"])) or {}
    return comps.get(str(unit["component_index"]))


def _sendable(record: dict | None) -> bool:
    """Unité envoyable : aucun record, ou record retryable sans provider_order_id."""
    if not record:
        return True
    return not record.get("provider_order_id") and record.get("status") in RETRYABLE


async def auto_enabled() -> bool:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "fzr_auto": 1})
    return bool(doc and doc.get("fzr_auto"))


async def _units_for_line(order: dict, idx: int, item: dict) -> tuple[list, dict | None]:
    """Retourne (units, skip). Une ligne directe → 1 unité ; une ligne composée → N unités (décomposition interne)."""
    if item.get("quantity") != 1:
        return [], {"index": idx, "product": item.get("name"),
                    "reason": "Quantité > 1 : envoi fournisseur non pris en charge pour cette ligne."}
    product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0, "fazercards_mapping": 1})
    mapping = (product or {}).get("fazercards_mapping")
    if not fzr_mapping.mapping_ok(mapping):
        reason = {
            "missing": "⚠ Mapping fournisseur manquant : liez ce produit à une offre FazerCards dans Admin → Fournisseur.",
            "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance avant tout envoi.",
        }.get(fzr_mapping.mapping_status(mapping), "Mapping fournisseur invalide.")
        return [], {"index": idx, "product": item.get("name"), "reason": reason}
    on = order["order_number"]
    if mapping.get("mode", "direct") == "direct":
        return [{"line_index": idx, "component_index": None, "path": _line_path(idx),
                 "idempotency_key": f"{on}-1" if idx == 0 else f"{on}-L{idx + 1}-1",
                 "category_id": mapping["category_id"], "offer_id": mapping["offer_id"],
                 "product": item["name"], "component_name": None}], None
    # COMPOSÉ : expansion interne des composants (quantité incluse) en unités de fulfillment indépendantes.
    units, u = [], 0
    for comp in mapping.get("components") or []:
        for _ in range(int(comp.get("quantity", 1))):
            units.append({"line_index": idx, "component_index": u, "path": _unit_path(idx, u),
                          "idempotency_key": f"{on}-L{idx + 1}-C{u + 1}",
                          "category_id": mapping["category_id"], "offer_id": comp["offer_id"],
                          "product": item["name"], "component_name": comp.get("offer_name")})
            u += 1
    return units, None


async def _all_units(order: dict) -> tuple[list, list]:
    units, skipped = [], []
    for idx, item in enumerate(order.get("items") or []):
        line_units, skip = await _units_for_line(order, idx, item)
        units += line_units
        if skip:
            skipped.append(skip)
    return units, skipped


def _is_legacy_single(order: dict, units: list) -> bool:
    """Commande mono-ligne DIRECTE → shape de retour historique (record au premier niveau)."""
    return len(order.get("items") or []) == 1 and len(units) == 1 and units[0]["component_index"] is None


async def eligible_lines(order: dict) -> list:
    units, _ = await _all_units(order)
    return [u for u in units if _sendable(unit_record(order, u))]


async def preflight(order_id: str) -> dict:
    """Rapport pré-commande : toutes les vérifications par unité, AUCUNE commande créée."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    units, skipped = await _all_units(order)
    records = [unit_record(order, u) for u in units]
    sent_ids = [r["provider_order_id"] for r in records if r and r.get("provider_order_id")]
    pending = [u for u, r in zip(units, records) if _sendable(r)]
    single = _is_legacy_single(order, units)
    if units and not pending:
        raise HTTPException(status_code=409, detail=f"Déjà envoyée au fournisseur ({', '.join(sent_ids) or 'en cours'}).")
    if order["status"] != "paid":
        raise HTTPException(status_code=409, detail="Paiement non confirmé : la commande doit être au statut « payée ».")
    if not pending:
        detail = skipped[0]["reason"] if single and skipped else \
            "Aucune ligne éligible : " + "; ".join(f"{s['product']} — {s['reason']}" for s in skipped)
        raise HTTPException(status_code=409, detail=detail or "Aucune ligne éligible.")
    validation = await fazercards.validate_pubg_id(order["pubg_id"])  # 502/504 si service indisponible
    if not validation["valid"]:
        raise HTTPException(status_code=409, detail="ID PUBG Mobile invalide chez le fournisseur — commande non envoyée.")
    offers_by_cat, lines = {}, []
    for u in pending:
        cat = u["category_id"]
        if cat not in offers_by_cat:
            offers_by_cat[cat] = await fazercards.pubg_offers_fresh(cat)
        offers = offers_by_cat[cat]
        offer = next((o for o in offers["offers"] if o["offer_id"] == u["offer_id"]), None)
        if not offer:
            reason = "Offre indisponible chez le fournisseur (retirée du catalogue)."
            if single:
                raise HTTPException(status_code=409, detail=reason)
            skipped.append({"index": u["line_index"], "product": u["product"], "reason": reason})
            continue
        field_keys = [f["key"] for f in offers["fields"] if f.get("key")]
        field_key = "player_id" if "player_id" in field_keys else (field_keys[0] if field_keys else "player_id")
        record = unit_record(order, u)
        lines.append({
            "index": u["line_index"], "component_index": u["component_index"], "path": u["path"],
            "product": u["product"], "component_name": u["component_name"], "category_id": u["category_id"],
            "offer_id": u["offer_id"], "offer_name": offer["name"], "price_usd": offer["price_usd"],
            "field_key": field_key, "idempotency_key": u["idempotency_key"], "retry": bool(record),
        })
    if not lines:
        raise HTTPException(status_code=409, detail=skipped[-1]["reason"] if skipped else "Aucune ligne éligible.")
    report = {
        "order_number": order["order_number"], "provider": "fazercards", "player_id": order["pubg_id"],
        "player_name": validation.get("player_name"), "mgs_total": order["total"],
        "lines": lines, "skipped": skipped, "ready_count": len(lines),
    }
    if single:  # compat mono-ligne directe : champs historiques au premier niveau
        report.update({k: lines[0][k] for k in
                       ("product", "category_id", "offer_id", "offer_name", "price_usd", "field_key", "idempotency_key", "retry")})
    return report


async def _update_record(order_id: str, path, fields: dict):
    """path : chemin dotted (str) OU index de ligne (int, rétrocompat)."""
    if isinstance(path, int):
        path = _line_path(path)
    await db.orders.update_one({"id": order_id}, {"$set": {
        **{f"{path}.{k}": v for k, v in fields.items()}, f"{path}.updated_at": _now(), "updated_at": _now()}})


async def _fulfill_unit(order: dict, line: dict, actor: str) -> dict:
    """Claim atomique + POST /topups/order pour UNE unité. Retry réutilise la même Idempotency-Key."""
    order_id, idx, cidx, path = order["id"], line["index"], line["component_index"], line["path"]
    unit = {"line_index": idx, "component_index": cidx}
    existing = unit_record(order, unit)
    record = {
        "provider": "fazercards", "status": "creating", "provider_order_id": None, "provider_status": None,
        "line_index": idx, "component_index": cidx, "product_name": line["product"],
        "component_name": line.get("component_name"),
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
        raise HTTPException(status_code=409, detail="Un envoi fournisseur est déjà en cours pour cette unité.")
    try:
        provider_order = await fazercards.create_topup_order(
            line["category_id"], line["offer_id"], {line["field_key"]: order["pubg_id"]}, line["idempotency_key"])
    except fazercards.ProviderTimeout:
        await _update_record(order_id, path, {"status": "submit_timeout", "last_error": "timeout après soumission"})
        await audit("fzr.order_timeout", actor, order_id, {"idempotency_key": line["idempotency_key"], "line": idx, "component": cidx})
        raise HTTPException(status_code=504, detail="La requête fournisseur a expiré. Réessayez : la même clé d'idempotence sera réutilisée (aucun double top-up).")
    except fazercards.ProviderOrderError as exc:
        await _update_record(order_id, path, {"status": "error", "last_error": exc.error})
        await audit("fzr.order_error", actor, order_id, {"error": exc.error, "code": exc.code, "http": exc.status_code, "line": idx, "component": cidx})
        raise HTTPException(status_code=409 if exc.status_code < 500 else 502,
                            detail=f"Commande fournisseur refusée : {exc.error}")
    provider_status = str(provider_order.get("status") or "processing")
    await _update_record(order_id, path, {"status": "submitted", "provider_order_id": provider_order["id"],
                                          "provider_status": provider_status})
    await db.orders.update_one({"id": order_id}, {"$addToSet": {"fazercards_provider_ids": provider_order["id"]}})
    await audit("fzr.order_created", actor, order_id, {
        "provider_order_id": provider_order["id"], "offer_id": line["offer_id"], "line": idx, "component": cidx,
        "supplier_price_usd": line["price_usd"], "idempotency_key": line["idempotency_key"]})
    if provider_status in PROVIDER_ALERT:
        await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": idx, "component": cidx})
    await _sync_mgs_status(order_id, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return unit_record(updated, unit)


async def fulfill_order(order_id: str, actor: str) -> dict:
    """Envoie séquentiellement toutes les unités éligibles. Mono-ligne directe : comportement historique inchangé."""
    report = await preflight(order_id)
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    all_units, _ = await _all_units(order)
    legacy_single = _is_legacy_single(order, all_units)
    results = []
    for line in report["lines"]:
        line = {**line, "player_name": report.get("player_name")}
        try:
            record = await _fulfill_unit(order, line, actor)
            results.append({"index": line["index"], "component_index": line["component_index"],
                            "product": line["product"], "component_name": line.get("component_name"),
                            "ok": True, "fazercards": record})
        except HTTPException as exc:
            if legacy_single:
                raise
            results.append({"index": line["index"], "component_index": line["component_index"],
                            "product": line["product"], "component_name": line.get("component_name"),
                            "ok": False, "error": str(exc.detail), "status_code": exc.status_code})
    if legacy_single:
        updated = await db.orders.find_one({"id": order_id}, PUBLIC)
        return updated["fazercards"]
    return {"order_number": report["order_number"], "results": results, "skipped": report["skipped"]}


async def refresh_status(order_id: str, actor: str) -> dict:
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    units, _ = await _all_units(order)
    targets = [(u, unit_record(order, u)) for u in units]
    targets = [(u, r) for u, r in targets if r and r.get("provider_order_id")]
    if not targets:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    for u, rec in targets:
        provider = await fazercards.get_provider_order(rec["provider_order_id"])
        provider_status = str(provider.get("status") or rec.get("provider_status") or "processing")
        await _update_record(order_id, u["path"], {"provider_status": provider_status})
        if provider_status in PROVIDER_ALERT:
            await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": u["line_index"], "component": u["component_index"]})
    await _sync_mgs_status(order_id, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    if _is_legacy_single(updated, units):
        return updated["fazercards"]
    return {"lines": [{"index": u["line_index"], "component_index": u["component_index"],
                       "fazercards": unit_record(updated, u)} for u, _ in targets]}


async def _sync_mgs_status(order_id: str, actor: str):
    """paid → delivered UNIQUEMENT quand TOUTES les unités (composants inclus) sont completed fournisseur."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order or order.get("status") != "paid":
        return
    units, skipped = await _all_units(order)
    if not units or skipped:
        return
    records = [unit_record(order, u) for u in units]
    if not all(r and r.get("provider_status") in PROVIDER_TO_MGS_DELIVERED for r in records):
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
    """order.created / order.status_changed → synchronise l'unité concernée. Dédupliqué par event_id."""
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
    units, _ = await _all_units(order)
    target = next((u for u in units if (unit_record(order, u) or {}).get("provider_order_id") == provider_order_id), None)
    if target is None:
        return {"ok": True, "ignored": True}
    if event.get("event") == "order.status_changed" and data.get("status"):
        provider_status = str(data["status"])
        await _update_record(order["id"], target["path"], {"provider_status": provider_status})
        if provider_status in PROVIDER_ALERT:
            await audit("fzr.provider_failed", "webhook:fazercards", order["id"], {"provider_status": provider_status, "line": target["line_index"], "component": target["component_index"]})
        await _sync_mgs_status(order["id"], "webhook:fazercards")
        await audit("fzr.webhook_status", "fazercards", order["id"],
                    {"provider_order_id": provider_order_id, "status": provider_status,
                     "previous_status": data.get("previous_status"), "line": target["line_index"], "component": target["component_index"]})
    return {"ok": True}
