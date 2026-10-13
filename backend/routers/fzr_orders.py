"""FazerCards Phase 3 — endpoints admin fulfillment, réglage auto, alertes prix, mapping produit, webhook."""
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core.audit import audit
from core.db import db
from core.games import (DEFAULT_GAME_ID, VALIDATION_POLICIES, VALIDATION_REQUIRED, game_readiness,
                        validation_category_of, validation_policy_of)
from core.security import require_admin, require_permission, require_super_admin
from services import fazercards, fzr_fulfillment, fzr_mapping, providers

router = APIRouter(tags=["fazercards-fulfillment"])
logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FzrAutoIn(BaseModel):
    fzr_auto: bool


class ComponentIn(BaseModel):
    offer_id: str
    quantity: int = Field(ge=1, le=50)


class MappingIn(BaseModel):
    mode: str = Field(default="direct", pattern=r"^(direct|composite)$")
    category_id: str
    offer_id: str | None = None
    components: list[ComponentIn] | None = None
    confirmed: bool = True


class CategoryAssignmentIn(BaseModel):
    category_ids: list[str] = Field(default_factory=list, max_length=500)


class GameValidationIn(BaseModel):
    """Configuration de VALIDATION d'un jeu — indépendante de ses catégories de vente."""

    validation_category: str | None = Field(default=None, max_length=120)
    validation_policy: str = Field(pattern=r"^(required|optional|not_required)$")




# ---------- Réglage global manuel / automatique (kill switch) ----------
@router.get("/admin/fazercards/settings", dependencies=[Depends(require_admin)])
async def fzr_settings():
    return {"fzr_auto": await fzr_fulfillment.auto_enabled(),
            "webhook_configured": bool(os.environ.get("FAZERCARDS_WEBHOOK_SECRET"))}


@router.patch("/admin/fazercards/settings")
async def fzr_update_settings(body: FzrAutoIn, admin=Depends(require_super_admin)):
    await db.settings.update_one({"key": "store"}, {"$set": {"fzr_auto": body.fzr_auto, "updated_at": _now()}}, upsert=True)
    await audit("fzr.auto_changed", admin["user_id"], None, {"fzr_auto": body.fzr_auto})
    return {"fzr_auto": body.fzr_auto}


# ---------- Mapping produit MGS ↔ offre(s) FazerCards (direct ou composé, tous types) ----------
@router.get("/admin/fazercards/provider-categories", dependencies=[Depends(require_permission("catalog.manage"))])
async def fzr_provider_categories(refresh: bool = False):
    """Toutes les catégories réelles FazerCards, utilisées pour les affectations administrateur."""
    if refresh:
        fazercards.clear_caches()
    categories = await fazercards._topup_categories()
    assignments = {}
    configured_games = set()
    async for g in db.games.find({}, {"_id": 0, "id": 1, "name": 1, "fazercards_categories_configured": 1,
                                      "fazercards_categories": 1}):
        if g.get("fazercards_categories_configured") is True:
            configured_games.add(g["id"])
            for category_id in g.get("fazercards_categories") or []:
                assignments[category_id] = {"game_id": g["id"], "game_name": g.get("name") or g["id"],
                                            "explicit": True}
    # Reserve categories already recognized by legacy game rules until an administrator saves
    # an explicit selection for that game. This prevents a new game stealing PUBG/Free Fire offers.
    for category in categories:
        category_id = category.get("category_id") or ""
        haystack = f"{category_id} {category.get('name') or ''}".lower()
        if category_id in assignments:
            continue
        for legacy_game_id, matchers in fazercards.GAME_MATCHERS.items():
            if legacy_game_id in configured_games:
                continue
            if any(token in haystack for token in matchers):
                assignments[category_id] = {"game_id": legacy_game_id, "game_name": legacy_game_id,
                                            "explicit": False}
                break
    return {"categories": [
        {"category_id": c.get("category_id"), "name": c.get("name"), "note": c.get("note"),
         "assigned_to": assignments.get(c.get("category_id"))}
        for c in categories if c.get("category_id")
    ]}


@router.put("/admin/fazercards/games/{game_id}/categories")
async def fzr_assign_game_categories(
    game_id: str, body: CategoryAssignmentIn, admin=Depends(require_permission("catalog.manage"))
):
    """Save the administrator's explicit FazerCards category selection for one game."""
    game = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "name": 1})
    if not game:
        raise HTTPException(status_code=404, detail="Jeu introuvable.")

    selected = list(dict.fromkeys(body.category_ids))
    live_categories = await fazercards._topup_categories()
    live_ids = {c.get("category_id") for c in live_categories if c.get("category_id")}
    unknown = [category_id for category_id in selected if category_id not in live_ids]
    if unknown:
        raise HTTPException(status_code=409, detail="Certaines catégories ne sont plus disponibles chez FazerCards. Actualisez le catalogue fournisseur.")

    conflicts = []
    # Do not let an explicit custom-game assignment steal categories currently used by the
    # implicit legacy matching rules for another game, unless that game has saved explicit rules.
    for category in live_categories:
        category_id = category.get("category_id")
        if category_id not in selected:
            continue
        haystack = f"{category_id or ''} {category.get('name') or ''}".lower()
        for legacy_game_id, matchers in fazercards.GAME_MATCHERS.items():
            if legacy_game_id == game_id:
                continue
            legacy = await db.games.find_one({"id": legacy_game_id},
                                             {"_id": 0, "fazercards_categories_configured": 1})
            if legacy and legacy.get("fazercards_categories_configured") is True:
                continue
            if any(token in haystack for token in matchers):
                conflicts.append({"category_id": category_id, "game_id": legacy_game_id,
                                  "game_name": legacy_game_id})

    if selected:
        async for other in db.games.find(
            {"id": {"$ne": game_id}, "fazercards_categories_configured": True,
             "fazercards_categories": {"$in": selected}},
            {"_id": 0, "id": 1, "name": 1, "fazercards_categories": 1},
        ):
            for category_id in set(other.get("fazercards_categories") or []).intersection(selected):
                conflicts.append({"category_id": category_id, "game_id": other["id"],
                                  "game_name": other.get("name") or other["id"]})
    if conflicts:
        labels = ", ".join(f"{item['category_id']} ({item['game_name']})" for item in conflicts)
        raise HTTPException(status_code=409, detail=f"Catégorie(s) déjà affectée(s) à un autre jeu : {labels}.")

    await db.games.update_one(
        {"id": game_id},
        {"$set": {"fazercards_categories": selected, "fazercards_categories_configured": True,
                  "updated_at": _now()}},
    )
    fazercards.clear_caches()
    await audit("fzr.game_categories_set", admin["user_id"], game_id,
                {"category_ids": selected, "count": len(selected)})
    return {"game_id": game_id, "category_ids": selected, "count": len(selected)}


# ---------- Validation d'identité : liste fournisseur SÉPARÉE + politique par jeu ----------
@router.get("/admin/fazercards/validate-categories",
            dependencies=[Depends(require_permission("catalog.manage"))])
async def fzr_validate_categories(refresh: bool = False):
    """Cibles de VALIDATION du fournisseur (`GET /topups/validate-id`) et configuration par jeu.

    Liste VOLONTAIREMENT séparée des catégories de vente : les identifiants peuvent différer.
    C'est ici qu'un administrateur associe explicitement la cible de validation d'un jeu — jamais
    déduite du nom, du slug interne ou des catégories de vente.
    """
    if refresh:
        fazercards.clear_caches()
    targets = await fazercards._validate_id_categories()
    games = {}
    async for g in db.games.find({}, {"_id": 0, "id": 1, "name": 1, "fazercards_validation_category": 1,
                                      "validation_policy": 1}):
        games[g["id"]] = {"name": g.get("name") or g["id"],
                          "validation_category": validation_category_of(g),
                          "validation_policy": validation_policy_of(g)}
    return {"targets": [{"category_id": t.get("category_id"), "name": t.get("name"),
                         "fields": [f.get("key") for f in (t.get("fields") or []) if f.get("key")]}
                        for t in targets if t.get("category_id")],
            "games": games, "policies": list(VALIDATION_POLICIES)}


@router.put("/admin/fazercards/games/{game_id}/validation")
async def fzr_set_game_validation(game_id: str, body: GameValidationIn,
                                  admin=Depends(require_permission("catalog.manage"))):
    """Enregistre la politique de validation d'un jeu et sa cible chez le fournisseur.

    Fail-closed : une politique « required » exige une cible réellement présente dans la liste de
    validation ; aucune cible n'est inventée ni reprise des catégories de vente.
    """
    game = await db.games.find_one({"id": game_id}, {"_id": 0, "id": 1, "name": 1})
    if not game:
        raise HTTPException(status_code=404, detail="Jeu introuvable.")
    category = (body.validation_category or "").strip() or None
    if category:
        live = {t.get("category_id") for t in await fazercards._validate_id_categories()}
        if category not in live:
            raise HTTPException(status_code=409,
                                detail="Cette cible de validation est absente de la liste FazerCards : actualisez la liste puis réessayez.")
    if body.validation_policy == VALIDATION_REQUIRED and not category and game_id != DEFAULT_GAME_ID:
        raise HTTPException(status_code=409,
                            detail="Politique « required » : associez d'abord une cible de validation à ce jeu.")
    await db.games.update_one({"id": game_id}, {"$set": {
        "fazercards_validation_category": category,
        "validation_policy": body.validation_policy,
        "updated_at": _now()}})
    fazercards.clear_caches()
    await audit("fzr.game_validation_set", admin["user_id"], game_id,
                {"validation_category": category, "validation_policy": body.validation_policy})
    return {"game_id": game_id, "validation_category": category,
            "validation_policy": body.validation_policy,
            "readiness": await game_readiness(await db.games.find_one({"id": game_id}, {"_id": 0}) or {"id": game_id})}


@router.get("/admin/fazercards/catalog", dependencies=[Depends(require_permission("catalog.manage"))])
async def fzr_game_catalog(game: str = DEFAULT_GAME_ID):
    """Categories/offers available for mapping for the selected game, using admin assignments."""
    if not await db.games.find_one({"id": game}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Jeu introuvable.")
    return {"game": game, "categories": await fazercards.catalog_for_game(game)}


@router.get("/admin/fazercards/mappings", dependencies=[Depends(require_admin)])
async def fzr_mappings(game: str | None = None):
    """Mappings produits ↔ offres fournisseur. `?game=` restreint à un jeu (GAME_PROVIDER / game_id).

    Le filtre passe par `game_product_query` : PUBG inclut les produits historiques sans `game_id`
    (compatibilité Phase 1), tout autre jeu ne voit QUE ses propres produits — jamais ceux d'un autre jeu.
    """
    query = fzr_mapping.game_product_query(game)
    products = await db.products.find(query, {"_id": 0, "id": 1, "slug": 1, "name": 1, "type": 1, "price": 1,
                                              "uc_amount": 1, "duration_months": 1, "active": 1, "game_id": 1,
                                              "requires_mapping": 1, "fazercards_mapping": 1}) \
        .sort("sort_order", 1).to_list(500)
    for p in products:
        mapping = p.get("fazercards_mapping")
        p["mapping_status"] = fzr_mapping.mapping_status(mapping)
        p["fulfillable"] = fzr_mapping.fulfillable(mapping)
        p["supplier_cost_usd"] = fzr_mapping.supplier_cost_usd(mapping, p.get("game_id"))
    return {"products": products, "game": game}


@router.patch("/admin/fazercards/products/{product_id}/mapping")
async def fzr_set_mapping(product_id: str, body: MappingIn, admin=Depends(require_permission("catalog.manage"))):
    product = await db.products.find_one({"id": product_id}, PUBLIC)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    mapping = await fzr_mapping.build_mapping(product, body)
    await db.products.update_one({"id": product_id}, {"$set": {"fazercards_mapping": mapping}})
    await audit("fzr.mapping_set", admin["user_id"], product_id,
                {"slug": product["slug"], "mode": mapping["mode"], "category_id": mapping["category_id"],
                 "offer_id": mapping.get("offer_id"),
                 "components": [{"offer_id": c["offer_id"], "quantity": c["quantity"]} for c in mapping.get("components", [])],
                 "confirmed": mapping["confirmed"]})
    return {"product_id": product_id, "fazercards_mapping": mapping,
            "mapping_status": fzr_mapping.mapping_status(mapping), "fulfillable": fzr_mapping.fulfillable(mapping),
            "supplier_cost_usd": fzr_mapping.supplier_cost_usd(mapping)}


@router.delete("/admin/fazercards/products/{product_id}/mapping")
async def fzr_unset_mapping(product_id: str, admin=Depends(require_permission("catalog.manage"))):
    res = await db.products.update_one({"id": product_id}, {"$unset": {"fazercards_mapping": ""}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    await audit("fzr.mapping_unset", admin["user_id"], product_id, {})
    return {"ok": True}


@router.get("/admin/fazercards/coverage", dependencies=[Depends(require_admin)])
async def fzr_coverage(game: str | None = None):
    """Couverture live : chaque offre fournisseur avec son état — utilisée par MGS ou « disponible, non activée ».

    `?game=` restreint le catalogue ET les références `used_by` à ce jeu : une offre utilisée
    par un produit d'un autre jeu n'apparaît jamais comme « utilisée » ici (pas de référence croisée).
    """
    categories = await fazercards.catalog_for_game(game)
    used = {}
    async for p in db.products.find({"fazercards_mapping": {"$exists": True}, **fzr_mapping.game_product_query(game)},
                                    {"_id": 0, "name": 1, "slug": 1, "fazercards_mapping": 1}):
        m = p["fazercards_mapping"]
        refs = [m["offer_id"]] if m.get("mode", "direct") == "direct" else [c["offer_id"] for c in m.get("components", [])]
        for oid in refs:
            used.setdefault((m["category_id"], oid), []).append({"name": p["name"], "slug": p["slug"]})
    offers = []
    for cat in categories:
        for o in cat["offers"]:
            offers.append({"category_id": cat["category_id"], "offer_id": o["offer_id"], "name": o["name"],
                           "price_usd": o["price_usd"], "kind": fzr_mapping.classify_offer(o),
                           "used_by": used.get((cat["category_id"], o["offer_id"]), [])})
    return {"offers": offers}


# ---------- Audit générique des mappings UC (direct / composition exacte / manquant) ----------
@router.get("/admin/fazercards/uc-audit", dependencies=[Depends(require_admin)])
async def fzr_uc_audit(game: str | None = None):
    """Audit LECTURE SEULE : chaque produit UC MGS confronté au catalogue FazerCards live du jeu.

    Sans `game`, l'appel historique reste limité à PUBG Mobile (jamais toutes les catégories
    fournisseur) : un audit ne doit jamais mélanger les jeux.
    """
    game = game or DEFAULT_GAME_ID
    catalog = await fazercards.catalog_for_game(game)
    if not catalog:
        # Jeu sans catégorie fournisseur : rien à auditer, on le signale explicitement.
        return {"rows": [], "game": game, "catalog_unavailable": True}
    return {"rows": await fzr_mapping.audit_uc_products(catalog, game), "game": game}


@router.post("/admin/fazercards/uc-audit/apply")
async def fzr_uc_audit_apply(game: str | None = None, admin=Depends(require_permission("catalog.manage"))):
    """Applique la règle générale : SKU exact → direct, somme exacte → composition, sinon mapping manquant.

    Sans `game`, l'appel historique reste limité à PUBG Mobile. Un jeu explicite ne modifie
    jamais les produits d'un autre jeu.
    """
    game = game or DEFAULT_GAME_ID
    catalog = await fazercards.catalog_for_game(game)
    if not catalog:
        raise HTTPException(status_code=409,
                            detail="Catalogue fournisseur indisponible pour ce jeu : aucune donnée commerciale à appliquer.")
    result = await fzr_mapping.apply_uc_audit(catalog, admin["user_id"], game)
    await audit("fzr.uc_audit_apply", admin["user_id"], None,
                {"fixed": result["fixed_count"], "removed": result["removed_count"], "game": game})
    return result


# ---------- Fulfillment fournisseur ----------
@router.get("/admin/orders/{order_id}/fazercards/preflight", dependencies=[Depends(require_permission("orders.manage"))])
async def fzr_preflight(order_id: str):
    return await fzr_fulfillment.preflight(order_id)


@router.post("/admin/orders/{order_id}/fazercards/fulfill")
async def fzr_fulfill(order_id: str, admin=Depends(require_permission("orders.manage"))):
    return await fzr_fulfillment.fulfill_order(order_id, f"admin:{admin['user_id']}")


@router.post("/admin/orders/{order_id}/fazercards/refresh-status")
async def fzr_refresh_status(order_id: str, admin=Depends(require_permission("orders.manage"))):
    return await fzr_fulfillment.refresh_status(order_id, f"admin:{admin['user_id']}")


@router.get("/admin/fazercards/recoverable", dependencies=[Depends(require_permission("orders.manage"))])
async def fzr_recoverable():
    """Commandes payées dont une unité de livraison a un sort fournisseur INDÉTERMINÉ.

    Aucune relance automatique : l'administrateur décide, et la réconciliation rejoue la MÊME
    Idempotency-Key (jamais de nouvelle clé, donc pas de double livraison).
    """
    out = []
    async for o in db.orders.find({"status": "paid"}, PUBLIC):
        units = fzr_fulfillment.recoverable_units(o)
        if units:
            out.append({"order_id": o["id"], "order_number": o["order_number"], "game_id": o.get("game_id"),
                        "units": [{"path": p, "status": r["status"], "idempotency_key": r["idempotency_key"],
                                   "updated_at": r.get("updated_at"), "last_error": r.get("last_error")}
                                  for p, r in units]})
    return out


@router.post("/admin/orders/{order_id}/fazercards/reconcile")
async def fzr_reconcile(order_id: str, admin=Depends(require_permission("orders.manage"))):
    return await fzr_fulfillment.reconcile_order(order_id, f"admin:{admin['user_id']}")


# ---------- Alerte prix fournisseur ----------
@router.post("/admin/fazercards/catalog/refresh")
async def fzr_catalog_refresh(game: str = DEFAULT_GAME_ID, admin=Depends(require_permission("catalog.manage"))):
    fazercards.clear_caches()
    categories = await fazercards.catalog_for_game(game)
    checked, changes = 0, []
    for cat in categories:
        for offer in cat["offers"]:
            checked += 1
            key = {"category_id": cat["category_id"], "offer_id": offer["offer_id"]}
            prev = await db.fzr_offer_prices.find_one(key, PUBLIC)
            if prev and prev.get("price_usd") != offer["price_usd"]:
                product = await db.products.find_one(
                    {"fazercards_mapping.category_id": key["category_id"],
                     "$or": [{"fazercards_mapping.offer_id": key["offer_id"]},
                             {"fazercards_mapping.components.offer_id": key["offer_id"]}]},
                    {"_id": 0, "name": 1, "price": 1, "slug": 1})
                try:
                    up = float(offer["price_usd"]) > float(prev["price_usd"])
                except (TypeError, ValueError):
                    up = None
                alert = {"id": str(uuid.uuid4()), **key, "offer_name": offer["name"],
                         "old_price_usd": prev["price_usd"], "new_price_usd": offer["price_usd"],
                         "direction": "up" if up else "down" if up is not None else None,
                         "mgs_product": product, "detected_at": _now(), "acknowledged": False}
                await db.fzr_price_alerts.insert_one(dict(alert))
                changes.append(alert)
                await audit("fzr.price_change", admin["user_id"], offer["offer_id"],
                            {"old": prev["price_usd"], "new": offer["price_usd"], "category_id": key["category_id"]})
            await db.fzr_offer_prices.update_one(key, {"$set": {**key, "name": offer["name"],
                                                                "price_usd": offer["price_usd"], "updated_at": _now()}}, upsert=True)
    return {"checked": checked, "changes": changes}


@router.get("/admin/fazercards/price-alerts", dependencies=[Depends(require_admin)])
async def fzr_price_alerts(limit: int = 100):
    alerts = await db.fzr_price_alerts.find({}, PUBLIC).sort("detected_at", -1).to_list(min(limit, 500))
    unack = await db.fzr_price_alerts.count_documents({"acknowledged": False})
    return {"alerts": alerts, "unacknowledged": unack}


@router.patch("/admin/fazercards/price-alerts/{alert_id}/ack")
async def fzr_ack_alert(alert_id: str, admin=Depends(require_admin)):
    res = await db.fzr_price_alerts.update_one({"id": alert_id}, {"$set": {"acknowledged": True, "ack_by": admin["user_id"], "ack_at": _now()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alerte introuvable")
    return {"ok": True}


# ---------- Webhook FazerCards (signature + parsing encapsulés dans l'adapter Provider) ----------
def verify_fzr_signature(raw: bytes, signature: str | None) -> bool:
    """Signature HMAC-SHA256 sur le RAW BODY — déléguée à l'adapter FazerCards."""
    return providers.get_provider("pubg-mobile").verify_webhook_signature(raw, signature)


@router.post("/fazercards/webhook")
async def fzr_webhook(request: Request):
    raw = await request.body()
    if not verify_fzr_signature(raw, request.headers.get("X-Webhook-Signature")):
        logger.warning("FazerCards webhook rejected: invalid signature")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    return await fzr_fulfillment.apply_webhook_event(event)
