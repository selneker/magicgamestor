import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core.db import db
from core.games import DEFAULT_GAME_ID, check_product_type, product_deliverable, public_game_ids
from core.security import ADMIN_ROLES, get_optional_user, require_permission
from services.fzr_mapping import mapping_ok

router = APIRouter(tags=["products"])
PUBLIC = {"_id": 0}


async def _games_by_id(ids) -> dict:
    """Jeux nécessaires à la règle de livrabilité (id + affectation de catégories fournisseur)."""
    docs = await db.games.find({"id": {"$in": list(set(ids))}},
                               {"_id": 0, "id": 1, "fazercards_categories": 1,
                                "fazercards_categories_configured": 1}).to_list(500)
    return {g["id"]: g for g in docs}


def _public(p: dict, game: dict | None) -> dict:
    """Vue publique : coût fournisseur jamais exposé + drapeau achetable.

    `purchasable` suit DÉSORMAIS la règle de livrabilité unique (`core.games.product_deliverable`) :
    un produit dont le chemin de livraison est absent, non confirmé ou lié à une catégorie d'un
    autre jeu n'est jamais présenté comme achetable.
    """
    p.setdefault("game_id", DEFAULT_GAME_ID)  # products created before Phase 1
    p["purchasable"] = product_deliverable(p, game or {"id": p["game_id"]})
    p.pop("fazercards_mapping", None)
    return p


class ProductIn(BaseModel):
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    # Per-game type key, validated against the game's configured product types (core.games).
    type: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    evo_limit: str | None = Field(default=None, pattern=r"^(season|lifetime|week)$")
    name: str = Field(min_length=1, max_length=60)
    name_en: str | None = None
    uc_amount: int | None = None
    duration_months: int | None = None
    price: int = Field(gt=0)
    old_price: int | None = None
    popular: bool = False
    badge: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    description_fr: str = ""
    description_en: str = ""
    active: bool = True
    sort_order: int = 0
    requires_mapping: bool | None = None
    game_id: str = Field(default=DEFAULT_GAME_ID, min_length=1, max_length=60)

    @field_validator("image_url")
    @classmethod
    def _http_url(cls, value):
        value = (value or "").strip()
        if not value:
            return None
        if not re.match(r"^https?://[^\s]+$", value):
            raise ValueError("URL d'image invalide (https://…)")
        return value


@router.get("/products")
async def list_products(
    type: str | None = None, q: str | None = None, min_price: int | None = None, max_price: int | None = None,
    popular: bool | None = None, sort: str = Query("default", pattern=r"^(default|price_asc|price_desc|uc_desc)$"),
    include_inactive: bool = False, game: str | None = None, user=Depends(get_optional_user),
):
    # `include_inactive` (catalogue admin) n'est honoré que pour un compte staff : un visiteur
    # anonyme ne peut jamais lister les produits inactifs (défense en profondeur, la route reste
    # publique pour le catalogue actif).
    if include_inactive and (not user or user.get("role") not in ADMIN_ROLES):
        include_inactive = False
    query = {} if include_inactive else {"active": True}
    if not include_inactive:
        # S1: the public catalogue only ever exposes eligible games, even with an explicit `game`.
        public_ids = await public_game_ids()
        if game and game not in public_ids:
            return []
        allowed = [game] if game else list(public_ids)
        legacy = [None] if DEFAULT_GAME_ID in allowed else []
        query["$and"] = [{"$or": [{"game_id": {"$in": allowed + legacy}}] +
                          ([{"game_id": {"$exists": False}}] if legacy else [])}]
    elif game:
        query["game_id"] = {"$in": [game, None]} if game == DEFAULT_GAME_ID else game
    if type:
        query["type"] = {"$in": type.split(",")}
    if popular is not None:
        query["popular"] = popular
    price = {}
    if min_price is not None:
        price["$gte"] = min_price
    if max_price is not None:
        price["$lte"] = max_price
    if price:
        query["price"] = price
    if q:
        query["$or"] = [{"name": {"$regex": re.escape(q), "$options": "i"}}, {"slug": {"$regex": re.escape(q), "$options": "i"}}]
    sort_map = {"default": [("sort_order", 1)], "price_asc": [("price", 1)], "price_desc": [("price", -1)], "uc_desc": [("uc_amount", -1)]}
    rows = await db.products.find(query, PUBLIC).sort(sort_map[sort]).to_list(500)
    games = await _games_by_id(p.get("game_id", DEFAULT_GAME_ID) for p in rows)
    out = [_public(p, games.get(p.get("game_id", DEFAULT_GAME_ID))) for p in rows]
    # Le catalogue public n'annonce jamais un produit dont la livraison est inutilisable.
    return out if include_inactive else [p for p in out if p["purchasable"]]


@router.get("/products/{slug}")
async def get_product(slug: str):
    product = await db.products.find_one({"slug": slug, "active": True}, PUBLIC)
    if not product or product.get("game_id", DEFAULT_GAME_ID) not in await public_game_ids():
        raise HTTPException(status_code=404, detail="Product not found")
    related = await db.products.find({"type": product["type"], "game_id": product.get("game_id", DEFAULT_GAME_ID), "slug": {"$ne": slug}, "active": True}, PUBLIC) \
        .sort([("price", 1)]).to_list(50)
    related.sort(key=lambda p: abs(p["price"] - product["price"]))
    game = await db.games.find_one({"id": product.get("game_id", DEFAULT_GAME_ID)},
                                   {"_id": 0, "id": 1, "fazercards_categories": 1,
                                    "fazercards_categories_configured": 1})
    view = _public(product, game)
    if not view["purchasable"]:
        # Un produit non livrable ne doit pas être achetable : la fiche disparaît du public.
        raise HTTPException(status_code=404, detail="Product not found")
    return {**view, "related": [r for r in (_public(x, game) for x in related) if r["purchasable"]][:4]}


@router.post("/admin/products", dependencies=[Depends(require_permission("catalog.manage"))])
async def create_product(body: ProductIn):
    await check_product_type(body.game_id, body.type)
    if await db.products.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug already exists")
    data = body.model_dump()
    data["requires_mapping"] = bool(data.get("requires_mapping"))
    if data["active"] and data["requires_mapping"]:
        raise HTTPException(status_code=409, detail="Mapping fournisseur manquant : créez le produit inactif, configurez le mapping (Admin → Fournisseur) puis activez-le.")
    doc = {**data, "id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/admin/products/{product_id}", dependencies=[Depends(require_permission("catalog.manage"))])
async def update_product(product_id: str, body: ProductIn):
    existing = await db.products.find_one({"id": product_id}, PUBLIC)
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    clash = await db.products.find_one({"slug": body.slug, "id": {"$ne": product_id}})
    if clash:
        raise HTTPException(status_code=409, detail="Slug already exists")
    # Isolation des mappings : un mapping fournisseur appartient à UN jeu. Changer le jeu d'un
    # produit qui porte déjà un mapping laisserait ce mapping (d'un autre jeu) utilisable par
    # erreur. On refuse tant que le mapping n'a pas été retiré explicitement.
    if body.game_id != existing.get("game_id", DEFAULT_GAME_ID) and existing.get("fazercards_mapping"):
        raise HTTPException(status_code=409, detail="⚠ Ce produit porte un mapping fournisseur : retirez-le (Admin → Fournisseur) avant de changer son jeu.")
    await check_product_type(body.game_id, body.type)
    data = body.model_dump()
    if body.requires_mapping is None:
        data["requires_mapping"] = existing.get("requires_mapping", False)
    if data["active"] and data["requires_mapping"] and not mapping_ok(existing.get("fazercards_mapping")):
        raise HTTPException(status_code=409, detail="⚠ Mapping fournisseur manquant ou non confirmé : impossible d'activer ce produit.")
    if existing.get("active") and not data["active"]:
        # Désactiver le DERNIER produit livrable rendrait le jeu vendable vide : on refuse pour
        # que l'invariant « jeu actif ⇒ catalogue livrable » reste vrai (le jeu se désactive
        # explicitement dans Admin → Jeux).
        game_id = existing.get("game_id", DEFAULT_GAME_ID)
        remaining = await db.products.count_documents({"id": {"$ne": product_id}, "game_id": game_id, "active": True})
        if remaining == 0 and await db.games.find_one({"id": game_id, "active": True}):
            raise HTTPException(status_code=409, detail="⚠ Dernier produit actif de ce jeu : désactivez le jeu (Admin → Jeux) avant, sinon sa boutique deviendrait vide.")
    await db.products.update_one({"id": product_id}, {"$set": data})
    return await db.products.find_one({"id": product_id}, PUBLIC)


@router.delete("/admin/products/{product_id}", dependencies=[Depends(require_permission("catalog.manage"))])
async def delete_product(product_id: str):
    existing = await db.products.find_one({"id": product_id}, PUBLIC)
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    if existing.get("active"):
        game_id = existing.get("game_id", DEFAULT_GAME_ID)
        # La suppression du DERNIER produit réellement livrable viderait la boutique d'un jeu
        # encore public : refusé (le jeu se désactive explicitement dans Admin → Jeux).
        deliverable_left = False
        game_doc = await db.games.find_one({"id": game_id}, PUBLIC)
        async for other in db.products.find({"id": {"$ne": product_id}, "game_id": game_id, "active": True},
                                            {"_id": 0, "requires_mapping": 1, "fazercards_mapping": 1}):
            if product_deliverable(other, game_doc):
                deliverable_left = True
                break
        if not deliverable_left and await db.games.find_one({"id": game_id, "active": True}):
            raise HTTPException(status_code=409, detail="⚠ Supprimer ce produit rendrait la boutique de ce jeu vide : désactivez le jeu avant.")
    res = await db.products.delete_one({"id": product_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}
