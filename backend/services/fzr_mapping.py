"""Phase 4 — mapping fournisseur générique (direct ou composé) pour tous les types de produits MGS."""
import re
from datetime import datetime, timezone

from fastapi import HTTPException

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
    """Envoi fournisseur réel : mapping direct confirmé uniquement (multi-commandes hors scope)."""
    return mapping_ok(mapping) and mapping.get("mode", "direct") == "direct"


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
