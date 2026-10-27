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
from core.games import DEFAULT_GAME_ID, game_provider
from core.security import require_admin, require_permission, require_super_admin
from services import fazercards, fzr_fulfillment, fzr_mapping, providers

router = APIRouter(tags=["fazercards-fulfillment"])
logger = logging.getLogger("mgs.fzr")
PUBLIC = {"_id": 0}
# Champs nécessaires pour connaître le fournisseur d'un jeu (aucun champ d'identité joueur).
GAME_PROVIDER_PROJECTION = {"_id": 0, "id": 1, "provider": 1, "aluu_game_code": 1,
                            "aluu_check_endpoint": 1, "aluu_identity_map": 1}


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


async def _game_providers(game_ids: set[str]) -> dict[str, str]:
    """Fournisseur de chaque jeu, lu sur le document `games`. Aucune exception possible : l'écran
    admin doit s'afficher même si la configuration d'un jeu est invalide.

    Document absent ou champ `provider` absent = FazerCards, exactement comme la résolution
    réelle (`game_provider` ne bascule que sur `"aluu"` exact).
    """
    ids = sorted({gid for gid in game_ids if gid})
    if not ids:
        return {}
    found: dict[str, str] = {}
    async for doc in db.games.find({"id": {"$in": ids}}, GAME_PROVIDER_PROJECTION):
        found[doc["id"]] = game_provider(doc)
    return found


def _provider_of(providers_by_id: dict[str, str], product: dict) -> str:
    return providers_by_id.get(product.get("game_id") or "", "fazercards")


async def _annotate_mappings(products: list[dict]) -> list[dict]:
    """Ajoute `mapping_status` / `fulfillable` / `supplier_cost_usd` lus sur le champ du
    FOURNISSEUR du jeu : `fazercards_mapping` (inchangé) ou `aluu_mapping`."""
    providers_by_id = await _game_providers({p.get("game_id") for p in products})
    for p in products:
        p.update(fzr_mapping.mapping_view(p, _provider_of(providers_by_id, p)))
    return products




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
        fazercards._catalog_cache.clear()
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
    fazercards._catalog_cache.clear()
    await audit("fzr.game_categories_set", admin["user_id"], game_id,
                {"category_ids": selected, "count": len(selected)})
    return {"game_id": game_id, "category_ids": selected, "count": len(selected)}


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
    # Liste COMPLÈTE du jeu : un plafond silencieux masquerait des produits dans l'admin, qui ne
    # pourraient alors jamais être mappés/composés (l'audit `audit_uc_products` itère déjà sans plafond).
    products = [p async for p in db.products.find(query, {"_id": 0, "id": 1, "slug": 1, "name": 1, "type": 1,
                                                          "price": 1, "uc_amount": 1, "duration_months": 1,
                                                          "active": 1, "game_id": 1, "requires_mapping": 1,
                                                          "fazercards_mapping": 1, "aluu_mapping": 1}).sort("sort_order", 1)]
    await _annotate_mappings(products)
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
    view = fzr_mapping.mapping_view(
        {**product, "fazercards_mapping": mapping},
        _provider_of(await _game_providers({product.get("game_id")}), product))
    return {"product_id": product_id, "fazercards_mapping": mapping, **view}


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
                           "price_usd": o["price_usd"], "kind": fzr_mapping.classify_offer(o, game),
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


# ---------- Alerte prix fournisseur ----------
@router.post("/admin/fazercards/catalog/refresh")
async def fzr_catalog_refresh(game: str = DEFAULT_GAME_ID, admin=Depends(require_permission("catalog.manage"))):
    fazercards._catalog_cache.clear()
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
    """Signature HMAC-SHA256 sur le RAW BODY — déléguée à l'adapter FazerCards.

    Le webhook est GLOBAL au fournisseur, pas à un jeu : le provider est résolu sans jeu
    (aucun jeu, PUBG Mobile compris, n'est présumé être celui du webhook).
    """
    return providers.get_provider(None).verify_webhook_signature(raw, signature)


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
