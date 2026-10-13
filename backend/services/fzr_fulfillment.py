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
import os
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from core.games import DEFAULT_GAME_ID
from services import fazercards, fzr_mapping, identity_gate, providers
from services.providers.base import OrderStatus

logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}
RETRYABLE = ("submit_timeout", "error")
PROVIDER_ALERT_NORMALIZED = (OrderStatus.FAILED, OrderStatus.REFUND)
# Statuts d'une unité dont le SORT fournisseur est inconnu : jamais rejoués automatiquement.
NEEDS_RECONCILIATION = "needs_reconciliation"
STALE_STATUSES = ("creating", "reconciling")
STALE_RETRY_REASON = ("Relance automatique refusée : la validité de la clé d'idempotence du "
                      "fournisseur n'est plus garantie. Utilisez la réconciliation administrateur "
                      "(elle rejoue la MÊME clé, sans jamais en générer de nouvelle).")
RECONCILE_REASON = ("Unité au sort fournisseur INCONNU (envoi interrompu) : aucune relance "
                    "automatique, utilisez la réconciliation administrateur.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _identity_fields(order: dict) -> dict:
    """Champs d'identité transmis au provider, pilotés par la donnée (jamais hardcodés PUBG).
    Priorité au snapshot d'identité (fields dynamiques) ; repli legacy sur pubg_id."""
    snapshot = order.get("identity_snapshot") or {}
    fields = {k: v for k, v in (snapshot.get("fields") or {}).items() if v}
    if not fields and order.get("pubg_id"):
        fields = {"player_id": order["pubg_id"]}
    return fields


def _line_path(idx: int) -> str:
    return "fazercards" if idx == 0 else f"fazercards_lines.{idx}"


def _unit_identity(order_number: str, line_index: int, component_index, quantity_index: int = 0):
    """(path Mongo, Idempotency-Key) d'une unité de fulfillment.
    quantity_index 0 = shape/clé LEGACY (rétrocompat totale). Les répétitions (quantity>1) sont stockées
    sous `fazercards_reps` — champ neuf, aucun impact sur les records/clés existants."""
    on, idx, cidx, q = order_number, line_index, component_index, quantity_index
    if q == 0:
        if cidx is None:
            return _line_path(idx), (f"{on}-1" if idx == 0 else f"{on}-L{idx + 1}-1")
        return f"fazercards_components.{idx}.{cidx}", f"{on}-L{idx + 1}-C{cidx + 1}"
    if cidx is None:
        return f"fazercards_reps.{idx}.{q}", f"{on}-L{idx + 1}-U{q + 1}"
    return f"fazercards_reps.{idx}.{q}.{cidx}", f"{on}-L{idx + 1}-U{q + 1}-C{cidx + 1}"


def line_record(order: dict, idx: int) -> dict | None:
    if idx == 0:
        return order.get("fazercards")
    return (order.get("fazercards_lines") or {}).get(str(idx))


def unit_record(order: dict, unit: dict) -> dict | None:
    idx, cidx, q = unit["line_index"], unit["component_index"], unit.get("quantity_index", 0)
    if q == 0:
        if cidx is None:
            return line_record(order, idx)
        comps = (order.get("fazercards_components") or {}).get(str(idx)) or {}
        return comps.get(str(cidx))
    node = ((order.get("fazercards_reps") or {}).get(str(idx)) or {}).get(str(q))
    if cidx is None:
        return node
    return (node or {}).get(str(cidx))


def auto_retry_max_age_s() -> int:
    """Âge maximal d'une relance AUTOMATIQUE (clé d'idempotence encore supposée valable).

    Au-delà, la commande n'est plus jamais renvoyée automatiquement : elle passe en réconciliation
    administrateur, car rejouer une clé dont la validité n'est pas assurée risquerait une DOUBLE
    livraison. Aucune durée n'étant documentée par le fournisseur, cette borne est volontairement
    courte et configurable (`FZR_AUTO_RETRY_MAX_AGE_S`).
    """
    try:
        return int(os.environ.get("FZR_AUTO_RETRY_MAX_AGE_S", "900"))
    except ValueError:
        return 900


def stale_creating_s() -> int:
    """Délai après lequel une unité restée en `creating` est considérée comme interrompue."""
    try:
        return int(os.environ.get("FZR_CREATING_STALE_SECONDS", "600"))
    except ValueError:
        return 600


def _age_s(record: dict) -> float:
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(record.get("updated_at"))).total_seconds()
    except (TypeError, ValueError):
        return float("inf")


def retry_too_old(record: dict | None) -> bool:
    """Vrai quand une unité retryable est trop ancienne pour une relance automatique sûre."""
    if not record or record.get("status") not in RETRYABLE:
        return False
    return _age_s(record) > auto_retry_max_age_s()


def _sendable(record: dict | None) -> bool:
    """Unité envoyable : aucun record, ou record retryable sans provider_order_id."""
    if not record:
        return True
    return not record.get("provider_order_id") and record.get("status") in RETRYABLE


async def auto_enabled() -> bool:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "fzr_auto": 1})
    return bool(doc and doc.get("fzr_auto"))


async def _units_for_line(order: dict, idx: int, item: dict) -> tuple[list, dict | None]:
    """Retourne (units, skip). qty = item.quantity : la structure fournisseur d'UNE unité produit
    (directe → 1 ; composée → N composants) est répétée qty fois → N×qty unités indépendantes.
    Le panier / prix / ligne client ne changent JAMAIS ; la composition n'est pas modifiée."""
    product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0, "fazercards_mapping": 1})
    mapping = (product or {}).get("fazercards_mapping")
    if not fzr_mapping.mapping_ok(mapping):
        reason = {
            "missing": "⚠ Mapping fournisseur manquant : liez ce produit à une offre FazerCards dans Admin → Fournisseur.",
            "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance avant tout envoi.",
        }.get(fzr_mapping.mapping_status(mapping), "Mapping fournisseur invalide.")
        return [], {"index": idx, "product": item.get("name"), "reason": reason}
    on = order["order_number"]
    qty = max(1, int(item.get("quantity", 1) or 1))
    if mapping.get("mode", "direct") == "direct":
        base = [{"component_index": None, "offer_id": mapping["offer_id"], "component_name": None}]
    else:
        base, u = [], 0
        for comp in mapping.get("components") or []:
            for _ in range(int(comp.get("quantity", 1))):
                base.append({"component_index": u, "offer_id": comp["offer_id"], "component_name": comp.get("offer_name")})
                u += 1
    units = []
    for q in range(qty):
        for b in base:
            path, key = _unit_identity(on, idx, b["component_index"], q)
            units.append({"line_index": idx, "component_index": b["component_index"], "quantity_index": q,
                          "path": path, "idempotency_key": key,
                          "category_id": mapping["category_id"], "offer_id": b["offer_id"],
                          "product": item["name"], "component_name": b["component_name"]})
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
    """Unités réellement envoyables en mode AUTOMATIQUE.

    Exclut les unités trop anciennes : une relance automatique tardive de la même clé
    d'idempotence n'est pas sûre (validité non garantie) — elle devient une réconciliation
    administrateur explicite.
    """
    units, _ = await _all_units(order)
    out = []
    for unit in units:
        record = unit_record(order, unit)
        if _sendable(record) and not (record and retry_too_old(record)):
            out.append(unit)
    return out


async def preflight(order_id: str) -> dict:
    """Rapport pré-commande : toutes les vérifications par unité, AUCUNE commande créée."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    units, skipped = await _all_units(order)
    records = [unit_record(order, u) for u in units]
    sent_ids = [r["provider_order_id"] for r in records if r and r.get("provider_order_id")]
    pending = []
    for u, r in zip(units, records):
        if not _sendable(r):
            if r and (r.get("status") == NEEDS_RECONCILIATION
                      or (r.get("status") in STALE_STATUSES and _age_s(r) >= stale_creating_s())):
                skipped.append({"index": u["line_index"], "product": u["product"],
                                "reason": RECONCILE_REASON})
            continue
        if r and retry_too_old(r):
            # Clé d'idempotence possiblement expirée : aucune relance automatique (double
            # livraison évitée), la ligne passe en réconciliation administrateur.
            skipped.append({"index": u["line_index"], "product": u["product"], "reason": STALE_RETRY_REASON})
            continue
        pending.append(u)
    single = _is_legacy_single(order, units)
    if units and not pending and sent_ids:
        raise HTTPException(status_code=409, detail=f"Déjà envoyée au fournisseur ({', '.join(sent_ids)}).")
    if order["status"] != "paid":
        raise HTTPException(status_code=409, detail="Paiement non confirmé : la commande doit être au statut « payée ».")
    if not pending:
        detail = skipped[0]["reason"] if single and skipped else \
            "Aucune ligne éligible : " + "; ".join(f"{s['product']} — {s['reason']}" for s in skipped)
        raise HTTPException(status_code=409, detail=detail or "Aucune ligne éligible.")
    # PORTE D'IDENTITÉ : même politique que la création de commande. Un identifiant refusé ou une
    # validation requise mais absente des cibles fournisseur bloque l'envoi ; une absence NORMALE
    # de prise en charge n'est autorisée que si l'administration l'a explicitement permis ; une
    # erreur technique remonte en 502/503/504 (jamais « c'est bon »).
    gate = await _validation_gate(order)
    offers_by_cat, lines = {}, []
    for u in pending:
        cat = u["category_id"]
        if cat not in offers_by_cat:
            # Offres live de la catégorie, en vérifiant qu'elle appartient bien au jeu de la commande
            # (aucun mélange entre catalogues de jeux). FAIL-CLOSED : un jeu inconnu échoue
            # explicitement (409) — jamais d'accès au catalogue fournisseur complet. Seul le chemin
            # de compatibilité PUBG historique (game_id absent) conserve le comportement d'origine.
            offers_by_cat[cat] = await fzr_mapping.offers_for_game(order.get("game_id"), cat)
        offers = offers_by_cat[cat]
        offer = next((o for o in offers["offers"] if o["offer_id"] == u["offer_id"]), None)
        if not offer:
            reason = "Offre indisponible chez le fournisseur (retirée du catalogue)."
            if single:
                raise HTTPException(status_code=409, detail=reason)
            skipped.append({"index": u["line_index"], "product": u["product"], "reason": reason})
            continue
        # Cohérence région du compte ↔ catégorie régionale du fournisseur (si les deux sont
        # connues) : livrer une recharge régionale sur un compte d'une autre région est perdu.
        conflict = identity_gate.region_blocked(gate.region, {"category_id": u["category_id"],
                                                              "category_name": offers.get("name")})
        if conflict:
            raise HTTPException(status_code=409, detail=identity_gate.region_mismatch_detail(conflict))
        field_keys = [f["key"] for f in offers["fields"] if f.get("key")]
        # Payload EXACT : les clés DÉCLARÉES par le jeu qui existent côté fournisseur. Si le
        # fournisseur n'attend qu'un champ et qu'aucune clé ne correspond, la valeur primaire du
        # jeu y est portée. Aucune clé inventée, aucune valeur substituée entre deux champs.
        provider_fields = _provider_fields(_identity_fields(order), field_keys, order.get("pubg_id"))
        if not provider_fields:
            reason = ("Les champs d'identité déclarés pour ce jeu ne correspondent à aucun champ "
                      "attendu par le fournisseur : corrigez-les dans Admin -> Jeux.")
            if single:
                raise HTTPException(status_code=409, detail=reason)
            skipped.append({"index": u["line_index"], "product": u["product"], "reason": reason})
            continue
        field_key = next(iter(provider_fields))
        record = unit_record(order, u)
        lines.append({
            "index": u["line_index"], "component_index": u["component_index"], "quantity_index": u["quantity_index"], "path": u["path"],
            "product": u["product"], "component_name": u["component_name"], "category_id": u["category_id"],
            "offer_id": u["offer_id"], "offer_name": offer["name"], "price_usd": offer["price_usd"],
            "field_key": field_key, "provider_fields": provider_fields,
            "idempotency_key": u["idempotency_key"], "retry": bool(record),
        })
    if not lines:
        raise HTTPException(status_code=409, detail=skipped[-1]["reason"] if skipped else "Aucune ligne éligible.")
    report = {
        "order_number": order["order_number"], "provider": "fazercards", "player_id": order["pubg_id"],
        "identity_fields": _identity_fields(order),
        "player_name": gate.player_name, "mgs_total": order["total"],
        "validation": {"status": gate.status, "policy": gate.policy, "validated": gate.validated,
                       "reason": gate.reason, "region": gate.region},
        # Trace explicite : la livraison se fait SANS vérification lorsque telle est la politique
        # du jeu ou lorsque le fournisseur ne la propose pas (jamais présenté comme vérifié).
        "validation_skipped": None if gate.validated else gate.status,
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
    q = line.get("quantity_index", 0)
    unit = {"line_index": idx, "component_index": cidx, "quantity_index": q}
    existing = unit_record(order, unit)
    record = {
        "provider": "fazercards", "status": "creating", "provider_order_id": None, "provider_status": None,
        "line_index": idx, "component_index": cidx, "quantity_index": q, "product_name": line["product"],
        "component_name": line.get("component_name"),
        "category_id": line["category_id"], "offer_id": line["offer_id"], "offer_name": line["offer_name"],
        "player_id": order["pubg_id"], "identity_snapshot": _identity_fields(order),
        "provider_fields": line.get("provider_fields"),
        "player_name_at_validation": line.get("player_name") or None,
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
    provider = providers.get_provider(order.get("game_id"))
    # Payload EXACT validé par le préflight (clés déclarées par le jeu ⇄ clés du fournisseur).
    fields_payload = (line.get("provider_fields") or _identity_fields(order)
                      or {line["field_key"]: order["pubg_id"]})
    try:
        provider_order = await provider.create_order(
            line["category_id"], line["offer_id"], fields_payload, line["idempotency_key"])
    except providers.ProviderTimeout:
        await _update_record(order_id, path, {"status": "submit_timeout", "last_error": "timeout après soumission"})
        await audit("fzr.order_timeout", actor, order_id, {"idempotency_key": line["idempotency_key"], "line": idx, "component": cidx})
        raise HTTPException(status_code=504, detail="La requête fournisseur a expiré. Réessayez : la même clé d'idempotence sera réutilisée (aucun double top-up).")
    except providers.ProviderOrderError as exc:
        await _update_record(order_id, path, {"status": "error", "last_error": exc.error})
        await audit("fzr.order_error", actor, order_id, {"error": exc.error, "code": exc.code, "http": exc.status_code, "line": idx, "component": cidx})
        raise HTTPException(status_code=409 if exc.status_code < 500 else 502,
                            detail=f"Commande fournisseur refusée : {exc.error}")
    provider_status = provider_order.status
    await _update_record(order_id, path, {"status": "submitted", "provider_order_id": provider_order.id,
                                          "provider_status": provider_status})
    await db.orders.update_one({"id": order_id}, {"$addToSet": {"fazercards_provider_ids": provider_order.id}})
    await audit("fzr.order_created", actor, order_id, {
        "provider_order_id": provider_order.id, "offer_id": line["offer_id"], "line": idx, "component": cidx,
        "supplier_price_usd": line["price_usd"], "idempotency_key": line["idempotency_key"]})
    if provider.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
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
    prov = providers.get_provider(order.get("game_id"))
    for u, rec in targets:
        provider_order = await prov.get_order(rec["provider_order_id"])
        provider_status = provider_order.status or rec.get("provider_status") or "processing"
        await _update_record(order_id, u["path"], {"provider_status": provider_status})
        if prov.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
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
    prov = providers.get_provider(order.get("game_id"))
    records = [unit_record(order, u) for u in units]
    if not all(r and prov.normalize_status(r.get("provider_status")) == OrderStatus.COMPLETED for r in records):
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
        prov = providers.get_provider(order.get("game_id"))
        await _update_record(order["id"], target["path"], {"provider_status": provider_status})
        if prov.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
            await audit("fzr.provider_failed", "webhook:fazercards", order["id"], {"provider_status": provider_status, "line": target["line_index"], "component": target["component_index"]})
        await _sync_mgs_status(order["id"], "webhook:fazercards")
        await audit("fzr.webhook_status", "fazercards", order["id"],
                    {"provider_order_id": provider_order_id, "status": provider_status,
                     "previous_status": data.get("previous_status"), "line": target["line_index"], "component": target["component_index"]})
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Porte d'identité à la livraison + payload fournisseur exact.
# --------------------------------------------------------------------------- #
async def _validation_gate(order: dict):
    """Applique la politique de validation du jeu de la commande (voir services.identity_gate).

    Lève une HTTPException si la validation DEMANDÉE n'est pas acquise ou si le fournisseur est
    techniquement indisponible. Ne retourne jamais un verdict positif sans confirmation réelle.
    """
    game_id = order.get("game_id") or DEFAULT_GAME_ID
    game = await db.games.find_one({"id": game_id}, dict(identity_gate.GAME_PROJECTION)) or {"id": game_id}
    return await identity_gate.gate_identity(game_id, _identity_fields(order),
                                             stage=identity_gate.STAGE_DELIVERY, game=game)


def _provider_fields(declared: dict, provider_keys: list, fallback_value: str | None) -> dict:
    """Champs `fields` réellement transmis au fournisseur.

    - seules les clés DÉCLARÉES par le jeu qui existent côté fournisseur sont envoyées ;
    - si le fournisseur n'attend qu'UN champ et qu'aucune clé déclarée ne correspond, la valeur
      primaire du jeu y est portée (jamais une valeur inventée ni celle d'un autre champ) ;
    - sinon le dictionnaire est vide : l'appelant DOIT refuser la ligne (fail-closed).
    """
    declared = {k: v for k, v in (declared or {}).items() if v}
    payload = {k: v for k, v in declared.items() if k in provider_keys}
    if payload:
        return payload
    if declared and len(provider_keys) == 1:
        return {provider_keys[0]: fallback_value or next(iter(declared.values()))}
    return {}


# --------------------------------------------------------------------------- #
# Récupération administrateur des unités dont le SORT fournisseur est inconnu.
# FazerCards documente qu'un rejeu de POST /topups/order avec la MÊME Idempotency-Key renvoie la
# commande d'origine : c'est le SEUL moyen de lever le doute. La récupération ne génère donc
# jamais de nouvelle clé et n'est jamais automatique.
# --------------------------------------------------------------------------- #
RECORD_ROOTS = ("fazercards", "fazercards_lines", "fazercards_components", "fazercards_reps")


def _records(order: dict):
    """Parcourt tous les records d'unités de livraison d'une commande (chemins Mongo inclus)."""

    def walk(node, path):
        if isinstance(node, dict):
            if "idempotency_key" in node and "status" in node:
                yield path, node
                return
            for key, value in node.items():
                yield from walk(value, f"{path}.{key}")

    for root in RECORD_ROOTS:
        yield from walk(order.get(root), root)


def recoverable_units(order: dict) -> list:
    """Unités dont le résultat fournisseur est INDÉTERMINÉ : claim en vol périmé ou à réconcilier."""
    out = []
    for path, record in _records(order):
        if record.get("provider_order_id"):
            continue
        if record.get("status") == NEEDS_RECONCILIATION:
            out.append((path, record))
        elif record.get("status") in STALE_STATUSES and _age_s(record) >= stale_creating_s():
            out.append((path, record))
    return out


async def reconcile_order(order_id: str, actor: str) -> dict:
    """Rejoue la MÊME Idempotency-Key pour chaque unité indéterminée (jamais de nouvelle clé)."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    provider = providers.get_provider(order.get("game_id"))
    results = []
    for path, rec in recoverable_units(order):
        key = rec["idempotency_key"]
        # Claim atomique sur l'état observé : deux réconciliations concurrentes ne peuvent pas
        # rejouer la même unité.
        claim = await db.orders.update_one(
            {"id": order_id, f"{path}.provider_order_id": None, f"{path}.status": rec["status"],
             f"{path}.updated_at": rec.get("updated_at")},
            {"$set": {f"{path}.status": "reconciling", f"{path}.updated_at": _now(), "updated_at": _now()}})
        if claim.modified_count != 1:
            results.append({"path": path, "ok": False, "status": "busy"})
            continue
        await audit("fzr.reconcile_started", actor, order_id,
                    {"idempotency_key": key, "path": path, "previous_status": rec["status"]})
        fields = rec.get("identity_snapshot") or _identity_fields(order)
        try:
            provider_order = await provider.create_order(rec["category_id"], rec["offer_id"], fields, key)
        except providers.ProviderTimeout:
            await _update_record(order_id, path, {"status": NEEDS_RECONCILIATION,
                                                  "last_error": "reconciliation timeout"})
            await audit("fzr.reconcile_unknown", actor, order_id,
                        {"idempotency_key": key, "path": path, "reason": "timeout"})
            results.append({"path": path, "ok": False, "status": NEEDS_RECONCILIATION})
            continue
        except providers.ProviderOrderError as exc:
            # Sort toujours indéterminé : on garde le drapeau, jamais de renvoi automatique.
            await _update_record(order_id, path, {"status": NEEDS_RECONCILIATION, "last_error": exc.error})
            await audit("fzr.reconcile_unknown", actor, order_id,
                        {"idempotency_key": key, "path": path, "reason": exc.error, "http": exc.status_code})
            results.append({"path": path, "ok": False, "status": NEEDS_RECONCILIATION, "error": exc.error})
            continue
        await _update_record(order_id, path, {"status": "submitted", "provider_order_id": provider_order.id,
                                              "provider_status": provider_order.status, "last_error": None,
                                              "reconciled_at": _now()})
        await db.orders.update_one({"id": order_id},
                                   {"$addToSet": {"fazercards_provider_ids": provider_order.id}})
        await audit("fzr.reconciled", actor, order_id,
                    {"idempotency_key": key, "path": path, "provider_order_id": provider_order.id})
        if provider.normalize_status(provider_order.status) in PROVIDER_ALERT_NORMALIZED:
            await audit("fzr.provider_failed", actor, order_id,
                        {"provider_status": provider_order.status, "path": path})
        results.append({"path": path, "ok": True, "status": "submitted",
                        "provider_order_id": provider_order.id})
    await _sync_mgs_status(order_id, actor)
    return {"order_number": order["order_number"], "results": results}
