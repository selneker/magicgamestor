"""FazerCards Phase 3/4 — commande fournisseur par UNITÉ de fulfillment.

Une commande MGS = N lignes. Chaque ligne produit possède un mapping fournisseur :
- DIRECT  → 1 unité de fulfillment (1 commande fournisseur).
- COMPOSÉ → décomposition INTERNE en plusieurs unités (720 UC → 660 + 60), chacune = 1 commande
  indépendante utilisant l'offre DIRECTE correspondante. Le panier / prix / ligne client ne changent JAMAIS.

Chaque unité a son propre provider_order_id et sa propre Idempotency-Key STABLE :
- ligne directe idx 0  → record `order.fazercards`,                    clé `{order}-1`      (rétrocompat)
- ligne directe idx>0  → record `order.fazercards_lines.{idx}`,        clé `{order}-L{idx+1}-1`
- composant (idx, u)   → record `order.fazercards_components.{idx}.{u}`, clé `{order}-L{idx+1}-C{u+1}`

FOURNISSEUR : il est résolu une seule fois par opération (`providers.provider_for_game`) et
**enregistré sur chaque unité au moment de sa création** (`record["provider"]`). Ensuite, le
rafraîchissement, le webhook et la synchronisation de statut lisent CE champ — jamais la
configuration courante du jeu — pour qu'une bascule de fournisseur ne réoriente jamais une
commande en vol. Aucun repli, aucun retry et aucune création ne changent de fournisseur.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from core.games import DEFAULT_GAME_ID
from services import aluu_mapping, fazercards, fzr_mapping, providers
from services.providers.base import OrderStatus

logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}
RETRYABLE = ("submit_timeout", "error")
PROVIDER_ALERT_NORMALIZED = (OrderStatus.FAILED, OrderStatus.REFUND)
MISSING_IDENTITY_DETAIL = "Champ d'identité requis manquant."


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


def _sendable(record: dict | None) -> bool:
    """Unité envoyable : aucun record, ou record retryable sans provider_order_id."""
    if not record:
        return True
    return not record.get("provider_order_id") and record.get("status") in RETRYABLE


def _record_provider(record: dict | None) -> str:
    """Fournisseur ENREGISTRÉ sur l'unité. Absent = record historique FazerCards.

    Jamais `provider_for_game` ici : une unité garde le fournisseur qui l'a créée, même si le
    jeu a été basculé depuis. Un nom inconnu fera échouer `get_provider_by_name` (fail-closed).
    """
    return str((record or {}).get("provider") or "").strip().lower() or "fazercards"


def _mapping_state(mapping: dict | None, *, is_aluu: bool) -> str:
    """État d'un mapping pour le fournisseur du jeu : `missing` | `unconfirmed` | `invalid` | `ok`."""
    if not mapping:
        return "missing"
    if mapping.get("confirmed") is False:
        return "unconfirmed"
    usable = aluu_mapping.mapping_ok_aluu(mapping) if is_aluu else fzr_mapping.mapping_ok(mapping)
    return "ok" if usable else "invalid"


def _missing_mapping_reason(state: str, *, is_aluu: bool) -> str:
    if is_aluu:
        return {
            "missing": "⚠ Mapping fournisseur manquant : liez ce produit à un pack ALUU depuis "
                       "l'écran ALUU (aperçu puis application explicite).",
            "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance "
                           "avant tout envoi.",
        }.get(state, "Mapping fournisseur invalide.")
    return {
        "missing": "⚠ Mapping fournisseur manquant : liez ce produit à une offre FazerCards dans Admin → Fournisseur.",
        "unconfirmed": "⚠ Mapping fournisseur « à confirmer » : confirmez la correspondance avant tout envoi.",
    }.get(state, "Mapping fournisseur invalide.")


def _unit_matches(record: dict | None, provider_order_id: str) -> bool:
    """Identifiant fournisseur d'une unité : `provider_order_id`, historique ou liste ALUU."""
    if not record:
        return False
    if record.get("provider_order_id") == provider_order_id:
        return True
    if record.get("aluu_order_id") == provider_order_id:
        return True
    return provider_order_id in (record.get("provider_order_ids") or [])


async def auto_enabled() -> bool:
    doc = await db.settings.find_one({"key": "store"}, {"_id": 0, "fzr_auto": 1})
    return bool(doc and doc.get("fzr_auto"))


async def _units_for_line(order: dict, idx: int, item: dict, *, is_aluu: bool) -> tuple[list, dict | None]:
    """Retourne (units, skip). qty = item.quantity : la structure fournisseur d'UNE unité produit
    (directe → 1 ; composée → N composants) est répétée qty fois → N×qty unités indépendantes.
    Le panier / prix / ligne client ne changent JAMAIS ; la composition n'est pas modifiée.

    Le champ de mapping lu dépend du FOURNISSEUR du jeu : `aluu_mapping` pour un jeu ALUU,
    `fazercards_mapping` sinon (comportement historique, au bit près).
    """
    field = "aluu_mapping" if is_aluu else "fazercards_mapping"
    product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0, field: 1})
    mapping = (product or {}).get(field)
    state = _mapping_state(mapping, is_aluu=is_aluu)
    if state != "ok":
        return [], {"index": idx, "product": item.get("name"),
                    "reason": _missing_mapping_reason(state, is_aluu=is_aluu)}
    on = order["order_number"]
    qty = max(1, int(item.get("quantity", 1) or 1))
    if is_aluu:
        # Le mapping ALUU est toujours direct : `denom` et `game_code`, jamais de composition.
        base = [{"component_index": None, "offer_id": mapping["denom"], "component_name": None}]
    elif mapping.get("mode", "direct") == "direct":
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
                          "category_id": mapping["game_code"] if is_aluu else mapping["category_id"],
                          "offer_id": b["offer_id"],
                          "product": item["name"], "component_name": b["component_name"]})
    return units, None


async def _all_units(order: dict, *, provider=None) -> tuple[list, list]:
    provider = provider or await _order_provider(order)
    is_aluu = provider.name == "aluu"
    units, skipped = [], []
    for idx, item in enumerate(order.get("items") or []):
        line_units, skip = await _units_for_line(order, idx, item, is_aluu=is_aluu)
        units += line_units
        if skip:
            skipped.append(skip)
    return units, skipped


def _recorded_provider(order: dict) -> str | None:
    """Premier fournisseur enregistré sur une unité de la commande (`None` = aucune unité créée)."""
    def walk(node):
        if isinstance(node, dict):
            if str(node.get("provider") or "").strip():
                return str(node["provider"]).strip().lower()
            for value in node.values():
                found = walk(value)
                if found:
                    return found
        return None

    return walk({key: order.get(key) for key in
                 ("fazercards", "fazercards_lines", "fazercards_components", "fazercards_reps")})


async def _order_provider(order: dict, provider=None):
    """Fournisseur d'une commande DÉJÀ envoyée : celui de ses unités, jamais la config courante.

    Tant qu'aucune unité n'existe, la résolution par jeu s'applique (c'est la création qui va
    enregistrer le fournisseur). Une fois une unité créée, relire le mapping sous un autre
    fournisseur ferait perdre la trace des unités en vol.
    """
    recorded = _recorded_provider(order)
    if recorded:
        return providers.get_provider_by_name(recorded)
    return provider or await providers.provider_for_game(order.get("game_id"))


def _is_legacy_single(order: dict, units: list) -> bool:
    """Commande mono-ligne DIRECTE → shape de retour historique (record au premier niveau)."""
    return len(order.get("items") or []) == 1 and len(units) == 1 and units[0]["component_index"] is None


async def eligible_lines(order: dict) -> list:
    units, _ = await _all_units(order)
    return [u for u in units if _sendable(unit_record(order, u))]


async def preflight(order_id: str, *, provider=None) -> dict:
    """Rapport pré-commande : toutes les vérifications par unité, AUCUNE commande créée.

    Le FOURNISSEUR est résolu une seule fois (`provider_for_game`) et utilisé pour la validation
    d'identité, le catalogue et la vérification des champs requis : c'est exactement celui que la
    création de commande utilisera ensuite (`fulfill_order` passe la même instance).
    """
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    provider = provider or await providers.provider_for_game(order.get("game_id"))
    units, skipped = await _all_units(order, provider=provider)
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
    validation = await provider.validate_identity(
        order.get("game_id"), _identity_fields(order))  # 502/504 si service indisponible
    if not validation.valid:
        # Message neutre par jeu : PUBG Mobile conserve son libellé historique, tout autre jeu
        # reçoit un message générique (aucune hypothèse PUBG pour un jeu dynamique).
        if (order.get("game_id") or DEFAULT_GAME_ID) == DEFAULT_GAME_ID:
            detail = "ID PUBG Mobile invalide chez le fournisseur — commande non envoyée."
        else:
            detail = "Identité joueur invalide chez le fournisseur — commande non envoyée."
        raise HTTPException(status_code=409, detail=detail)
    offers_by_cat, lines = {}, []
    for u in pending:
        cat = u["category_id"]
        if cat not in offers_by_cat:
            # Offres live de la catégorie, en vérifiant qu'elle appartient bien au jeu de la commande
            # (aucun mélange entre catalogues de jeux). FAIL-CLOSED : un jeu inconnu échoue
            # explicitement (409) — jamais d'accès au catalogue fournisseur complet. Seul le chemin
            # de compatibilité PUBG historique (game_id absent) conserve le comportement d'origine.
            offers_by_cat[cat] = await fzr_mapping.offers_for_game(order.get("game_id"), cat,
                                                                  provider=provider)
        offers = offers_by_cat[cat]
        offer = next((o for o in offers["offers"] if o["offer_id"] == u["offer_id"]), None)
        if not offer:
            reason = "Offre indisponible chez le fournisseur (retirée du catalogue)."
            if single:
                raise HTTPException(status_code=409, detail=reason)
            skipped.append({"index": u["line_index"], "product": u["product"], "reason": reason})
            continue
        if provider.name == "aluu":
            # Un pack ALUU qui exige `serverid` (ou `charname`) ne doit JAMAIS partir avec une
            # identité incomplète : refus explicite avant tout envoi, libellé existant.
            required = [f["key"] for f in offers.get("fields") or [] if f.get("key")]
            missing = await provider.missing_order_fields(order.get("game_id"), _identity_fields(order), required)
            if missing:
                if single:
                    raise HTTPException(status_code=409, detail=MISSING_IDENTITY_DETAIL)
                skipped.append({"index": u["line_index"], "product": u["product"],
                                "reason": MISSING_IDENTITY_DETAIL})
                continue
        field_keys = [f["key"] for f in offers["fields"] if f.get("key")]
        declared = list((_identity_fields(order) or {}).keys())
        # Clé de champ effectivement envoyée : on utilise le champ DÉCLARÉ par le jeu s'il correspond
        # à ce qu'attend le fournisseur. Aucune hypothèse `player_id` universelle.
        matched = [k for k in declared if k in field_keys]
        field_key = matched[0] if matched else (field_keys[0] if field_keys else (declared[0] if declared else "player_id"))
        record = unit_record(order, u)
        lines.append({
            "index": u["line_index"], "component_index": u["component_index"], "quantity_index": u["quantity_index"], "path": u["path"],
            "product": u["product"], "component_name": u["component_name"], "category_id": u["category_id"],
            "offer_id": u["offer_id"], "offer_name": offer["name"], "price_usd": offer["price_usd"],
            "field_key": field_key, "idempotency_key": u["idempotency_key"], "retry": bool(record),
        })
    if not lines:
        raise HTTPException(status_code=409, detail=skipped[-1]["reason"] if skipped else "Aucune ligne éligible.")
    report = {
        "order_number": order["order_number"], "provider": provider.name, "player_id": order["pubg_id"],
        "identity_fields": _identity_fields(order),
        "player_name": validation.player_name, "mgs_total": order["total"],
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


async def _fulfill_unit(order: dict, line: dict, actor: str, provider) -> dict:
    """Claim atomique + création fournisseur pour UNE unité. Retry réutilise la même Idempotency-Key.

    `provider` est le fournisseur résolu pour CETTE opération : il est enregistré sur l'unité et
    utilisé pour l'appel. Aucun autre fournisseur n'est consulté, même en cas d'erreur.
    """
    order_id, idx, cidx, path = order["id"], line["index"], line["component_index"], line["path"]
    q = line.get("quantity_index", 0)
    unit = {"line_index": idx, "component_index": cidx, "quantity_index": q}
    existing = unit_record(order, unit)
    record = {
        "provider": provider.name, "status": "creating", "provider_order_id": None, "provider_status": None,
        "line_index": idx, "component_index": cidx, "quantity_index": q, "product_name": line["product"],
        "component_name": line.get("component_name"),
        "category_id": line["category_id"], "offer_id": line["offer_id"], "offer_name": line["offer_name"],
        "player_id": order["pubg_id"], "identity_snapshot": _identity_fields(order),
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
    fields_payload = _identity_fields(order) or {line["field_key"]: order["pubg_id"]}
    try:
        provider_order = await provider.create_order(
            line["category_id"], line["offer_id"], fields_payload, line["idempotency_key"])
    except providers.ProviderTimeout:
        await _update_record(order_id, path, {"status": "submit_timeout", "last_error": "timeout après soumission"})
        await audit("fzr.order_timeout", actor, order_id, {"idempotency_key": line["idempotency_key"], "line": idx, "component": cidx})
        raise HTTPException(status_code=504, detail="La requête fournisseur a expiré. Réessayez : la même clé d'idempotence sera réutilisée (aucun double top-up).")
    except providers.ProviderOrderError as exc:
        # Refus APRÈS paiement (dont 402 solde insuffisant) : état explicite « action manuelle
        # requise » + audit. `status` reste `error` pour conserver le renvoi manuel du frontend.
        manual_action = ("insufficient_balance"
                         if isinstance(exc, providers.ProviderInsufficientBalanceError)
                         else "provider_refused")
        await _update_record(order_id, path, {
            "status": "error", "last_error": exc.error,
            "manual_action_required": True, "manual_action": manual_action,
            "manual_action_at": _now()})
        await audit("fzr.order_error", actor, order_id, {"error": exc.error, "code": exc.code, "http": exc.status_code, "line": idx, "component": cidx})
        await audit("fzr.manual_action_required", actor, order_id,
                    {"manual_action": manual_action, "code": exc.code, "http": exc.status_code,
                     "provider": provider.name, "line": idx, "component": cidx})
        raise HTTPException(status_code=409 if exc.status_code < 500 else 502,
                            detail=f"Commande fournisseur refusée : {exc.error}")
    provider_status = provider_order.status
    fields_sent = {"status": "submitted", "provider_order_id": provider_order.id,
                   "provider_status": provider_status}
    identifiers: list[str] = []
    if provider.name == "aluu":
        # `provider_order.id` EST le `partner_orderid` envoyé ; ALUU renvoie aussi son `orderid`
        # et sa `reference`. On stocke les trois tels quels (aucune valeur inventée).
        raw = provider_order.raw if isinstance(provider_order.raw, dict) else {}
        aluu_order_id = str(raw.get("orderid") or "").strip() or None
        fields_sent["partner_order_id"] = provider_order.id
        fields_sent["aluu_order_id"] = aluu_order_id
        fields_sent["provider_reference"] = str(raw.get("reference") or "").strip() or None
        identifiers = [value for value in (provider_order.id, aluu_order_id) if value]
    await _update_record(order_id, path, fields_sent)
    if provider.name == "aluu":
        if identifiers:
            await db.orders.update_one({"id": order_id}, {"$addToSet": {"provider_order_ids": {"$each": identifiers}}})
    else:
        await db.orders.update_one({"id": order_id}, {"$addToSet": {"fazercards_provider_ids": provider_order.id}})
    await audit("fzr.order_created", actor, order_id, {
        "provider_order_id": provider_order.id, "offer_id": line["offer_id"], "line": idx, "component": cidx,
        "supplier_price_usd": line["price_usd"], "idempotency_key": line["idempotency_key"],
        "provider": provider.name})
    if provider.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
        await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": idx, "component": cidx})
    await _sync_mgs_status(order_id, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    return unit_record(updated, unit)


async def fulfill_order(order_id: str, actor: str) -> dict:
    """Envoie séquentiellement toutes les unités éligibles. Mono-ligne directe : comportement historique inchangé."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    # FOURNISSEUR résolu UNE fois : préflight et création utilisent la même instance.
    provider = await providers.provider_for_game(order.get("game_id"))
    report = await preflight(order_id, provider=provider)
    all_units, _ = await _all_units(order, provider=provider)
    legacy_single = _is_legacy_single(order, all_units)
    results = []
    for line in report["lines"]:
        line = {**line, "player_name": report.get("player_name")}
        try:
            record = await _fulfill_unit(order, line, actor, provider)
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
    targets = [(u, r) for u, r in targets if r and r.get("provider_order_id")
               and not r.get("polling_stopped")]
    if not targets:
        raise HTTPException(status_code=404, detail="Aucune commande fournisseur pour cette commande.")
    instances: dict = {}
    failures: list[dict] = []
    for u, rec in targets:
        # FOURNISSEUR DE L'UNITÉ (enregistré à sa création), jamais la configuration du jeu.
        name = _record_provider(rec)
        prov = instances.get(name)
        if prov is None:
            prov = instances[name] = providers.get_provider_by_name(name)
        try:
            provider_order = await prov.get_order(rec["provider_order_id"])
        except providers.ProviderError as exc:
            if exc.status_code == 410:
                # ALUU demande d'arrêter d'interroger cet identifiant : statut conservé.
                await _update_record(order_id, u["path"], {"polling_stopped": True,
                                                           "last_error": exc.message})
            await audit("fzr.refresh_error", actor, order_id,
                        {"provider": name, "provider_order_id": rec["provider_order_id"],
                         "code": exc.code, "http": exc.status_code,
                         "line": u["line_index"], "component": u["component_index"]})
            failures.append({"line": u["line_index"], "component": u["component_index"],
                             "provider": name, "status_code": exc.status_code,
                             "code": exc.code, "error": exc.message})
            continue
        provider_status = provider_order.status or rec.get("provider_status") or "processing"
        await _update_record(order_id, u["path"], {"provider_status": provider_status})
        if prov.normalize_status(provider_status) in PROVIDER_ALERT_NORMALIZED:
            await audit("fzr.provider_failed", actor, order_id, {"provider_status": provider_status, "line": u["line_index"], "component": u["component_index"]})
    if failures and len(failures) == len(targets):
        # Aucune unité n'a pu être rafraîchie : erreur explicite, jamais un statut périmé muet.
        raise HTTPException(status_code=502,
                            detail=f"Rafraîchissement impossible pour {len(targets)} unité(s) : {failures[0]['error']}")
    await _sync_mgs_status(order_id, actor)
    updated = await db.orders.find_one({"id": order_id}, PUBLIC)
    if _is_legacy_single(updated, units):
        return updated["fazercards"]
    result = {"lines": [{"index": u["line_index"], "component_index": u["component_index"],
                         "fazercards": unit_record(updated, u)} for u, _ in targets]}
    if failures:
        result["errors"] = failures
    return result


async def _sync_mgs_status(order_id: str, actor: str):
    """paid → delivered UNIQUEMENT quand TOUTES les unités (composants inclus) sont completed fournisseur."""
    order = await db.orders.find_one({"id": order_id}, PUBLIC)
    if not order or order.get("status") != "paid":
        return
    units, skipped = await _all_units(order)
    if not units or skipped:
        return
    instances: dict = {}

    def completed(record: dict) -> bool:
        name = _record_provider(record)
        prov = instances.get(name)
        if prov is None:
            try:
                prov = instances[name] = providers.get_provider_by_name(name)
            except providers.ProviderError:
                return False  # fournisseur inconnu : jamais considéré comme livré
        return prov.normalize_status(record.get("provider_status")) == OrderStatus.COMPLETED

    records = [unit_record(order, u) for u in units]
    if not all(r and completed(r) for r in records):
        return
    res = await db.orders.update_one(
        {"id": order_id, "status": "paid"},
        {"$set": {"status": "delivered", "updated_at": _now()},
         "$push": {"history": {"status": "delivered", "at": _now()}}})
    if res.modified_count:
        # Note d'audit neutre : la commande peut avoir été livrée par n'importe quel fournisseur.
        note = f"{_recorded_provider(order) or 'fazercards'} completed"
        await audit("order.status_change", actor, order_id, {"from": "paid", "to": "delivered", "note": note})


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


async def _apply_status_event(order: dict, unit: dict, provider_name: str, status: str,
                              actor: str) -> None:
    """Applique un statut fournisseur à UNE unité (webhook ou rafraîchissement).

    Partagé avec le webhook ALUU (Lot 5) : le fournisseur vient du RECORD de l'unité, jamais de
    la configuration courante du jeu.
    """
    prov = providers.get_provider_by_name(provider_name)
    await _update_record(order["id"], unit["path"], {"provider_status": status})
    if prov.normalize_status(status) in PROVIDER_ALERT_NORMALIZED:
        await audit("fzr.provider_failed", actor, order["id"],
                    {"provider_status": status, "line": unit["line_index"],
                     "component": unit["component_index"]})
    await _sync_mgs_status(order["id"], actor)


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
                                              {"fazercards_provider_ids": provider_order_id},
                                              {"provider_order_ids": provider_order_id},
                                              {"aluu_order_id": provider_order_id}]}, PUBLIC)
    if not order:
        return {"ok": True, "ignored": True}
    units, _ = await _all_units(order)
    target = next((u for u in units if _unit_matches(unit_record(order, u), provider_order_id)), None)
    if target is None:
        return {"ok": True, "ignored": True}
    if event.get("event") == "order.status_changed" and data.get("status"):
        provider_status = str(data["status"])
        provider_name = _record_provider(unit_record(order, target))
        await _apply_status_event(order, target, provider_name, provider_status, "webhook:fazercards")
        await audit("fzr.webhook_status", provider_name, order["id"],
                    {"provider_order_id": provider_order_id, "status": provider_status,
                     "previous_status": data.get("previous_status"), "line": target["line_index"], "component": target["component_index"]})
    return {"ok": True}
