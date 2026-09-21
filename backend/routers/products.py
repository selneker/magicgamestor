import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import db
from core.security import require_permission

router = APIRouter(tags=["products"])
PUBLIC = {"_id": 0}


class ProductIn(BaseModel):
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    type: str = Field(pattern=r"^(uc|prime|prime_plus)$")
    name: str = Field(min_length=1, max_length=60)
    name_en: str | None = None
    uc_amount: int | None = None
    duration_months: int | None = None
    price: int = Field(gt=0)
    old_price: int | None = None
    popular: bool = False
    badge: str | None = None
    description_fr: str = ""
    description_en: str = ""
    active: bool = True
    sort_order: int = 0


@router.get("/products")
async def list_products(
    type: str | None = None, q: str | None = None, min_price: int | None = None, max_price: int | None = None,
    popular: bool | None = None, sort: str = Query("default", pattern=r"^(default|price_asc|price_desc|uc_desc)$"),
    include_inactive: bool = False,
):
    query = {} if include_inactive else {"active": True}
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
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"slug": {"$regex": q, "$options": "i"}}]
    sort_map = {"default": [("sort_order", 1)], "price_asc": [("price", 1)], "price_desc": [("price", -1)], "uc_desc": [("uc_amount", -1)]}
    return await db.products.find(query, PUBLIC).sort(sort_map[sort]).to_list(500)


@router.get("/products/{slug}")
async def get_product(slug: str):
    product = await db.products.find_one({"slug": slug, "active": True}, PUBLIC)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    related = await db.products.find({"type": product["type"], "slug": {"$ne": slug}, "active": True}, PUBLIC) \
        .sort([("price", 1)]).to_list(50)
    related.sort(key=lambda p: abs(p["price"] - product["price"]))
    return {**product, "related": related[:4]}


@router.post("/admin/products", dependencies=[Depends(require_permission("catalog.manage"))])
async def create_product(body: ProductIn):
    if await db.products.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug already exists")
    doc = {**body.model_dump(), "id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/admin/products/{product_id}", dependencies=[Depends(require_permission("catalog.manage"))])
async def update_product(product_id: str, body: ProductIn):
    clash = await db.products.find_one({"slug": body.slug, "id": {"$ne": product_id}})
    if clash:
        raise HTTPException(status_code=409, detail="Slug already exists")
    res = await db.products.update_one({"id": product_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return await db.products.find_one({"id": product_id}, PUBLIC)


@router.delete("/admin/products/{product_id}", dependencies=[Depends(require_permission("catalog.manage"))])
async def delete_product(product_id: str):
    res = await db.products.delete_one({"id": product_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}
