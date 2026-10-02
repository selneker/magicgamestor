"""Phase 4 — mapping fournisseur générique (direct ou composé) pour tous les types de produits MGS."""
import re
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from services import fazercards

MAX_COMPONENTS = 10
_UC_NAME = re.compile(r"^([\d\s]+)\s*UC$", re.IGNORECASE)
_UC_ID = re.compile(r"^(\d+)_uc$", re.IGNORECASE)


def _now():
    return datetime.now(timezone.utc).isoformat()


def uc_amount_of(offer: dict) -> int | None:
    """Quantité UC d'une offre fournisseur, déduite du catalogue live (jamais hardcodée)."""
    m = _UC_NAME.match((offer.get("name") or "").strip())
    if m:
        return int(m.group(1).replace(" ", ""))
    m = _UC_ID.match((offer.get("offer_id") or "").strip())
    return int(m.group(1)) if m else None


def classify_offer(offer: dict) -> str:
    """uc | subscription | currency | special — dérivé du catalogue live, pour la couverture admin."""
    if uc_amount_of(offer) is not None:
        return "uc"
    name, oid = (offer.get("name") or "").lower(), (offer.get("offer_id") or "").lower()
    if "prime" in oid or "prime" in name:
        return "subscription"
    if re.match(r"^\d", name.strip()):
        return "currency"
    return "special"


def mapping_ok(mapping: dict | None) -> bool:
    """Mapping utilisable (direct ou composé) : structure complète et confirmé."""
    if not mapping or mapping.get("confirmed") is False:
        return False
    if mapping.get("mode", "direct") == "direct":
        return bool(mapping.get("category_id") and mapping.get("offer_id"))
    return bool(mapping.get("category_id") and mapping.get("components"))


def fulfillable(mapping: dict | None) -> bool:
    """Envoi fournisseur réel : mapping DIRECT ou COMPOSÉ confirmé.
    Un mapping composé est décomposé en interne au fulfillment (chaque composant = 1 commande FazerCards directe)."""
    return mapping_ok(mapping)


def mapping_status(mapping: dict | None) -> str:
    if not mapping:
        return "missing"
    if mapping.get("confirmed") is False:
        return "unconfirmed"
    if not mapping_ok(mapping):
        return "invalid"
    return mapping.get("mode", "direct")


def supplier_cost_usd(mapping: dict | None):
    if not mapping:
        return None
    if mapping.get("mode", "direct") == "composite":
        return mapping.get("total_price_usd_at_link")
    return mapping.get("price_usd_at_link")


def purchase_blocked(product: dict) -> str | None:
    """Produit exigeant un mapping fournisseur valide et confirmé avant toute vente."""
    if product.get("requires_mapping") and not mapping_ok(product.get("fazercards_mapping")):
        return f"« {product.get('name')} » n'est pas encore disponible : mapping fournisseur manquant ou non confirmé."
    return None


async def build_mapping(product: dict, body) -> dict:
    """Valide contre le catalogue FazerCards live puis construit le document de mapping. Rien n'est inventé."""
    offers = await fazercards.pubg_offers_fresh(body.category_id)
    by_id = {o["offer_id"]: o for o in offers["offers"]}
    base = {"category_id": offers["category_id"], "confirmed": bool(body.confirmed), "linked_at": _now()}
    if body.mode == "direct":
        if not body.offer_id:
            raise HTTPException(status_code=422, detail="offer_id requis pour un mapping direct.")
        offer = by_id.get(body.offer_id)
        if not offer:
            raise HTTPException(status_code=409, detail="Cette offre n'existe pas dans le catalogue FazerCards live.")
        # Un produit UC ne peut être lié EN DIRECT qu'à l'offre fournisseur de MÊME quantité UC.
        # Sinon (ex. 120 UC → 60 UC) c'est un faux mapping : refuser et exiger une composition exacte.
        if product.get("type") == "uc" and product.get("uc_amount"):
            amount = uc_amount_of(offer)
            if amount is not None and amount != product["uc_amount"]:
                raise HTTPException(status_code=409,
                                    detail=f"Mapping direct invalide : « {offer['name']} » = {amount} UC ≠ {product['uc_amount']} UC attendus. "
                                           f"Utilisez l'offre exacte ou une composition dont la somme vaut exactement {product['uc_amount']} UC.")
        return {**base, "mode": "direct", "offer_id": offer["offer_id"], "offer_name": offer["name"],
                "price_usd_at_link": offer["price_usd"]}
    if product.get("type") != "uc":
        raise HTTPException(status_code=409, detail="La composition n'est autorisée que pour les produits UC. Prime / Prime Plus / Pack évolutif : mapping direct uniquement.")
    if not body.components:
        raise HTTPException(status_code=422, detail="Au moins un composant est requis.")
    if len(body.components) > MAX_COMPONENTS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_COMPONENTS} composants.")
    target = product.get("uc_amount")
    if not target:
        raise HTTPException(status_code=409, detail="Produit sans quantité UC : composition impossible.")
    components, total_uc, total_usd = [], 0, 0.0
    for comp in body.components:
        offer = by_id.get(comp.offer_id)
        if not offer:
            raise HTTPException(status_code=409, detail=f"Offre « {comp.offer_id} » introuvable dans le catalogue FazerCards live.")
        amount = uc_amount_of(offer)
        if amount is None:
            raise HTTPException(status_code=409, detail=f"« {offer['name']} » n'est pas une offre UC : composition refusée.")
        try:
            price = float(offer["price_usd"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=502, detail="Prix fournisseur illisible pour ce composant.")
        components.append({"offer_id": offer["offer_id"], "offer_name": offer["name"], "quantity": comp.quantity,
                           "uc_amount": amount, "price_usd_at_link": offer["price_usd"]})
        total_uc += amount * comp.quantity
        total_usd += price * comp.quantity
    if total_uc != target:
        raise HTTPException(status_code=409,
                            detail=f"Composition invalide : {total_uc} UC ≠ {target} UC attendus. La somme des composants doit être exactement égale au produit vendu.")
    return {**base, "mode": "composite", "components": components, "total_uc": total_uc,
            "total_price_usd_at_link": round(total_usd, 4)}


# ---------- Audit générique des mappings UC : direct / composition exacte / manquant ----------
def mapping_total_uc(mapping: dict | None, catalog_by_offer: dict) -> int | None:
    """UC réellement livrés par un mapping, recalculés depuis le catalogue live. None si indéterminable."""
    if not mapping:
        return None
    if mapping.get("mode", "direct") == "composite":
        total = 0
        for c in mapping.get("components") or []:
            amt = c.get("uc_amount")
            if amt is None:
                offer = catalog_by_offer.get((mapping.get("category_id"), c.get("offer_id")))
                amt = uc_amount_of(offer) if offer else None
            if amt is None:
                return None
            total += amt * c.get("quantity", 1)
        return total
    offer = catalog_by_offer.get((mapping.get("category_id"), mapping.get("offer_id")))
    return uc_amount_of(offer) if offer else None


def _uc_offers_by_category(catalog: list[dict]) -> dict:
    """Offres UC disponibles par catégorie, quantités déduites du catalogue live (jamais hardcodées)."""
    out = {}
    for cat in catalog:
        ucs = []
        for o in cat.get("offers") or []:
            amt = uc_amount_of(o)
            if amt and amt > 0:
                ucs.append({"offer_id": o["offer_id"], "offer_name": o["name"],
                            "price_usd": o["price_usd"], "uc_amount": amt})
        if ucs:
            out[cat["category_id"]] = ucs
    return out


def _compose_exact(target: int, uc_offers: list[dict]) -> list[dict] | None:
    """Composition EXACTE minimisant le nombre d'unités. Aucune approximation : None si somme exacte impossible."""
    best_by_amt = {}
    for o in uc_offers:
        a = o["uc_amount"]
        if a not in best_by_amt or float(o["price_usd"]) < float(best_by_amt[a]["price_usd"]):
            best_by_amt[a] = o
    amounts = sorted(best_by_amt, reverse=True)
    inf = float("inf")
    dp = [0] + [inf] * target
    pick = [None] * (target + 1)
    for v in range(1, target + 1):
        for a in amounts:  # descendant → à nombre d'unités égal, on privilégie la plus grosse offre
            if a <= v and dp[v - a] + 1 < dp[v]:
                dp[v], pick[v] = dp[v - a] + 1, a
    if dp[target] == inf:
        return None
    combo, v = [], target
    while v > 0:
        combo.append(best_by_amt[pick[v]])
        v -= pick[v]
    return combo


def _group_components(combo: list[dict]) -> list[dict]:
    counts, order = {}, []
    for o in combo:
        if o["offer_id"] not in counts:
            counts[o["offer_id"]] = {**o, "quantity": 0}
            order.append(o["offer_id"])
        counts[o["offer_id"]]["quantity"] += 1
    return [counts[oid] for oid in order]


def resolve_uc_mapping(target_uc: int, catalog: list[dict]) -> dict | None:
    """RÈGLE GÉNÉRALE — SKU UC exact → direct ; sinon somme exacte disponible → composition ; sinon None (manquant)."""
    if not target_uc:
        return None
    by_cat = _uc_offers_by_category(catalog)
    for cat_id, offers in by_cat.items():
        exact = [o for o in offers if o["uc_amount"] == target_uc]
        if exact:
            o = min(exact, key=lambda x: float(x["price_usd"]))
            return {"mode": "direct", "category_id": cat_id, "offer": o}
    best = None
    for cat_id, offers in by_cat.items():
        combo = _compose_exact(target_uc, offers)
        if combo and len(combo) <= MAX_COMPONENTS and (best is None or len(combo) < len(best[1])):
            best = (cat_id, combo)
    if best:
        return {"mode": "composite", "category_id": best[0], "components": _group_components(best[1])}
    return None


def mapping_doc_from_resolution(resolution: dict) -> dict:
    """Document de mapping (schéma identique à build_mapping), confirmé, issu d'une résolution d'audit."""
    base = {"category_id": resolution["category_id"], "confirmed": True, "linked_at": _now(), "source": "uc_audit"}
    if resolution["mode"] == "direct":
        o = resolution["offer"]
        return {**base, "mode": "direct", "offer_id": o["offer_id"], "offer_name": o["offer_name"],
                "price_usd_at_link": o["price_usd"]}
    components, total_uc, total_usd = [], 0, 0.0
    for c in resolution["components"]:
        components.append({"offer_id": c["offer_id"], "offer_name": c["offer_name"], "quantity": c["quantity"],
                           "uc_amount": c["uc_amount"], "price_usd_at_link": c["price_usd"]})
        total_uc += c["uc_amount"] * c["quantity"]
        total_usd += float(c["price_usd"]) * c["quantity"]
    return {**base, "mode": "composite", "components": components, "total_uc": total_uc,
            "total_price_usd_at_link": round(total_usd, 4)}


async def audit_uc_products(catalog: list[dict]) -> list[dict]:
    """Audit LECTURE SEULE de chaque produit UC MGS vs catalogue fournisseur live. N'écrit rien."""
    catalog_by_offer = {(cat["category_id"], o["offer_id"]): o for cat in catalog for o in (cat.get("offers") or [])}
    rows = []
    async for p in db.products.find({"type": "uc", "uc_amount": {"$gt": 0}},
                                    {"_id": 0, "id": 1, "slug": 1, "name": 1, "uc_amount": 1,
                                     "fazercards_mapping": 1}).sort("uc_amount", 1):
        target = p.get("uc_amount")
        current = p.get("fazercards_mapping")
        current_uc = mapping_total_uc(current, catalog_by_offer)
        current_ok = bool(target) and mapping_ok(current) and current_uc == target
        resolution = resolve_uc_mapping(target, catalog) if target else None
        if resolution and resolution["mode"] == "direct":
            resolved_mode, summary = "direct", resolution["offer"]["offer_name"]
        elif resolution:
            resolved_mode = "composite"
            summary = " + ".join(f"{c['quantity']}×{c['offer_name']}" for c in resolution["components"])
        else:
            resolved_mode, summary = "missing", None
        if current_ok:
            action = "ok"
        elif resolution:
            action = "fix"
        elif current:
            action = "remove"  # faux mapping et aucune somme exacte → doit devenir manquant
        else:
            action = "already_missing"
        rows.append({"product_id": p["id"], "slug": p["slug"], "name": p["name"], "uc_amount": target,
                     "current_status": mapping_status(current), "current_uc": current_uc,
                     "resolved_mode": resolved_mode, "resolved_summary": summary, "action": action})
    return rows


async def apply_uc_audit(catalog: list[dict], actor: str | None = None) -> dict:
    """Corrige les mappings UC (direct/composition exacte, sinon manquant). Préserve les mappings déjà corrects."""
    rows = await audit_uc_products(catalog)
    fixed, removed = [], []
    for row in rows:
        if row["action"] == "fix":
            doc = mapping_doc_from_resolution(resolve_uc_mapping(row["uc_amount"], catalog))
            await db.products.update_one({"id": row["product_id"]}, {"$set": {"fazercards_mapping": doc}})
            await audit("fzr.uc_audit_fix", actor, row["product_id"],
                        {"slug": row["slug"], "uc_amount": row["uc_amount"], "mode": doc["mode"],
                         "summary": row["resolved_summary"]})
            fixed.append(row)
        elif row["action"] == "remove":
            await db.products.update_one({"id": row["product_id"]}, {"$unset": {"fazercards_mapping": ""}})
            await audit("fzr.uc_audit_remove", actor, row["product_id"],
                        {"slug": row["slug"], "uc_amount": row["uc_amount"]})
            removed.append(row)
    return {"rows": rows, "fixed": fixed, "removed": removed,
            "fixed_count": len(fixed), "removed_count": len(removed)}
