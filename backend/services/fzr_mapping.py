"""Phase 4 — mapping fournisseur générique (direct ou composé) pour tous les types de produits MGS."""
import re
from datetime import datetime, timezone

from fastapi import HTTPException

from core.audit import audit
from core.db import db
from core.games import DEFAULT_GAME_ID
from services import fazercards, providers

MAX_COMPONENTS = 10
_UC_NAME = re.compile(r"^([\d\s]+)\s*UC$", re.IGNORECASE)
_UC_ID = re.compile(r"^(\d+)_uc$", re.IGNORECASE)
# Autres jeux : nombre AUTONOME uniquement — jamais un chiffre inclus dans un mot (MP40),
# jamais deux nombres (bonus « 500+50 », « 20 30 », séparateur « 1 000 »).
_OTHER_QTY = re.compile(r"(?<![A-Za-z0-9])(\d+)(?![0-9])")


def _now():
    return datetime.now(timezone.utc).isoformat()


def is_currency_product(product: dict) -> bool:
    """Produit de monnaie : quantité > 0 et type hors prime, prime_plus, evo."""
    uc_amount = product.get("uc_amount")
    if not uc_amount or uc_amount <= 0:
        return False
    prod_type = product.get("type")
    return prod_type not in ("prime", "prime_plus", "evo")


def get_currency_label(product: dict, game_id: str | None = None, game_data: dict | None = None) -> str:
    """Libellé de la monnaie utilisé dans les messages de mapping. Jamais la clé de type brute.

    - PUBG Mobile (game_id absent → compat historique) : toujours « UC » → messages PUBG
      identiques au caractère près, quel que soit le type du produit (uc, prime, evo…).
    - Autre jeu : `currency_label` du jeu déjà chargé par l'appelant, sinon le libellé déclaré
      du type du produit (game.product_types), sinon « unités ». AUCUNE requête DB ici :
      c'est l'appelant async (build_mapping) qui lui passe le jeu déjà chargé.
    """
    if game_id is None or game_id == DEFAULT_GAME_ID:
        return "UC"
    game_data = game_data or {}
    label = (game_data.get("currency_label") or "").strip()
    if label:
        return label
    for declared in game_data.get("product_types") or []:
        if declared.get("key") == product.get("type"):
            type_label = (declared.get("label") or "").strip()
            if type_label:
                return type_label
    return "unités"


def uc_amount_of(offer: dict, game_id: str | None = None) -> int | None:
    """Quantité d'une offre fournisseur, déduite du catalogue live (jamais hardcodée).

    - PUBG (game_id absent ou DEFAULT_GAME_ID) : comportement historique au bit près
      (nom « ... UC » puis offer_id « ..._uc »).
    - Autres jeux : la quantité n'est lue que si le nom de l'offre contient UN SEUL nombre
      autonome — « 30 Diamants » → 30, « 80 CP » → 80. Sinon l'offre est refusée pour la
      composition : « Diamonds Pack », « 20 30 Diamonds », « 500+50 Diamants », « 1 000
      Diamants » (séparateur) et « MP40 Bundle » (chiffres dans un mot) → None. Aucune
      approximation : un doute = refus par l'appelant.
    """
    if game_id is None or game_id == DEFAULT_GAME_ID:
        # PUBG legacy behavior — inchangé
        m = _UC_NAME.match((offer.get("name") or "").strip())
        if m:
            return int(m.group(1).replace(" ", ""))
        m = _UC_ID.match((offer.get("offer_id") or "").strip())
        return int(m.group(1)) if m else None
    amounts = _OTHER_QTY.findall(offer.get("name") or "")
    return int(amounts[0]) if len(amounts) == 1 else None


def classify_offer(offer: dict, game_id: str | None = None) -> str:
    """uc | subscription | currency | special — dérivé du catalogue live, pour la couverture admin.

    « uc » n'est renvoyé que pour le jeu historique PUBG Mobile : la couverture d'un autre jeu
    étiquette sa monnaie (Diamants, CP…) « currency », jamais avec le libellé d'un autre jeu.
    """
    if uc_amount_of(offer, game_id) is not None:
        return "uc" if game_id in (None, DEFAULT_GAME_ID) else "currency"
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


def supplier_cost_usd(mapping: dict | None, game_id: str | None = None):
    """Coût fournisseur d'un mapping. `game_id` accepté pour cohérence d'API (le coût ne dépend pas du jeu)."""
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


async def offers_for_game(game_id: str | None, category_id: str, *, provider=None) -> dict:
    """Offres live d'une catégorie, en s'assurant qu'elle appartient bien au jeu du produit
    (aucun mélange entre catalogues de jeux).

    FAIL-CLOSED : un jeu reconnu ne peut accéder qu'à ses propres catégories ; un jeu inconnu
    échoue explicitement (409) via `game_categories` — jamais d'accès au catalogue fournisseur
    complet. Seul le chemin de compatibilité PUBG historique (game_id absent) conserve le
    comportement d'origine, sans contrôle de catégorie.

    Le FOURNISSEUR du jeu décide du catalogue : FazerCards garde `game_categories` +
    `pubg_offers_fresh` à l'identique ; ALUU n'a qu'un catalogue par code jeu, qui doit être
    exactement le `aluu_game_code` du document `games` (aucune autre catégorie n'est lisible).
    """
    if game_id is None:
        # Compat historique : aucun contrôle de catégorie, comportement d'origine.
        return await fazercards.pubg_offers_fresh(category_id)
    provider = provider or await providers.provider_for_game(game_id)
    if provider.name == "aluu":
        game = await db.games.find_one({"id": game_id}, {"_id": 0, "aluu_game_code": 1})
        aluu_code = str((game or {}).get("aluu_game_code") or "").strip()
        if not aluu_code or category_id != aluu_code:
            raise HTTPException(status_code=409,
                                detail=f"Cette catégorie ALUU n'appartient pas au jeu « {game_id} ».")
        return await provider.get_offers(category_id)
    allowed = {c["category_id"] for c in await fazercards.game_categories(game_id)}
    if category_id not in allowed:
        raise HTTPException(status_code=409,
                            detail=f"Cette catégorie FazerCards n'appartient pas au jeu « {game_id} ».")
    return await fazercards.pubg_offers_fresh(category_id)


def _refuse_aluu_game(game_id: str | None, provider) -> None:
    """Le mapping FazerCards ne s'écrit JAMAIS sur un jeu ALUU (rollback et roll-forward séparés)."""
    if provider.name == "aluu":
        raise HTTPException(
            status_code=409,
            detail=(f"Le jeu « {game_id} » utilise le fournisseur ALUU : son mapping s'applique "
                    "depuis l'écran ALUU (aperçu puis application explicite), jamais dans "
                    "le mapping FazerCards."))


async def build_mapping(product: dict, body) -> dict:
    """Valide contre le catalogue FazerCards live puis construit le document de mapping. Rien n'est inventé."""
    game_id = product.get("game_id")
    provider = await providers.provider_for_game(game_id)
    _refuse_aluu_game(game_id, provider)
    offers = await offers_for_game(game_id, body.category_id, provider=provider)
    by_id = {o["offer_id"]: o for o in offers["offers"]}
    base = {"category_id": offers["category_id"], "confirmed": bool(body.confirmed), "linked_at": _now()}
    game_data = None
    if game_id not in (None, DEFAULT_GAME_ID):
        # Le jeu est chargé UNE fois ici (route async) ; le helper get_currency_label ne fait aucune requête.
        game_data = await db.games.find_one({"id": game_id}, {"currency_label": 1, "product_types": 1})
    if body.mode == "direct":
        if not body.offer_id:
            raise HTTPException(status_code=422, detail="offer_id requis pour un mapping direct.")
        offer = by_id.get(body.offer_id)
        if not offer:
            raise HTTPException(status_code=409, detail="Cette offre n'existe pas dans le catalogue FazerCards live.")
        # Un produit de monnaie ne peut être lié EN DIRECT qu'à l'offre fournisseur de MÊME quantité.
        # Sinon (ex. 120 UC → 60 UC) c'est un faux mapping : refuser et exiger une composition exacte.
        if is_currency_product(product):
            amount = uc_amount_of(offer, product.get("game_id"))
            if amount is not None and amount != product["uc_amount"]:
                label = get_currency_label(product, product.get("game_id"), game_data)
                raise HTTPException(status_code=409,
                                    detail=f"Mapping direct invalide : « {offer['name']} » = {amount} {label} ≠ {product['uc_amount']} {label} attendus. "
                                           f"Utilisez l'offre exacte ou une composition dont la somme vaut exactement {product['uc_amount']} {label}.")
        return {**base, "mode": "direct", "offer_id": offer["offer_id"], "offer_name": offer["name"],
                "price_usd_at_link": offer["price_usd"]}
    if not is_currency_product(product):
        label = get_currency_label(product, product.get("game_id"), game_data)
        raise HTTPException(status_code=409, detail=f"La composition n'est autorisée que pour les produits {label}. Prime / Prime Plus / Pack évolutif : mapping direct uniquement.")
    if not body.components:
        raise HTTPException(status_code=422, detail="Au moins un composant est requis.")
    if len(body.components) > MAX_COMPONENTS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_COMPONENTS} composants.")
    target = product.get("uc_amount")
    if not target:
        label = get_currency_label(product, product.get("game_id"), game_data)
        raise HTTPException(status_code=409, detail=f"Produit sans quantité {label} : composition impossible.")
    components, total_uc, total_usd = [], 0, 0.0
    for comp in body.components:
        offer = by_id.get(comp.offer_id)
        if not offer:
            raise HTTPException(status_code=409, detail=f"Offre « {comp.offer_id} » introuvable dans le catalogue FazerCards live.")
        amount = uc_amount_of(offer, product.get("game_id"))
        if amount is None:
            label = get_currency_label(product, product.get("game_id"), game_data)
            raise HTTPException(status_code=409, detail=f"« {offer['name']} » n'est pas une offre {label} : composition refusée.")
        try:
            price = float(offer["price_usd"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=502, detail="Prix fournisseur illisible pour ce composant.")
        components.append({"offer_id": offer["offer_id"], "offer_name": offer["name"], "quantity": comp.quantity,
                           "uc_amount": amount, "price_usd_at_link": offer["price_usd"]})
        total_uc += amount * comp.quantity
        total_usd += price * comp.quantity
    if total_uc != target:
        label = get_currency_label(product, product.get("game_id"), game_data)
        raise HTTPException(status_code=409,
                            detail=f"Composition invalide : {total_uc} {label} ≠ {target} {label} attendus. La somme des composants doit être exactement égale au produit vendu.")
    return {**base, "mode": "composite", "components": components, "total_uc": total_uc,
            "total_price_usd_at_link": round(total_usd, 4)}


# ---------- Audit générique des mappings UC : direct / composition exacte / manquant ----------
def mapping_total_uc(mapping: dict | None, catalog_by_offer: dict, game_id: str | None = None) -> int | None:
    """UC réellement livrés par un mapping, recalculés depuis le catalogue live. None si indéterminable."""
    if not mapping:
        return None
    if mapping.get("mode", "direct") == "composite":
        total = 0
        for c in mapping.get("components") or []:
            amt = c.get("uc_amount")
            if amt is None:
                offer = catalog_by_offer.get((mapping.get("category_id"), c.get("offer_id")))
                amt = uc_amount_of(offer, game_id) if offer else None
            if amt is None:
                return None
            total += amt * c.get("quantity", 1)
        return total
    offer = catalog_by_offer.get((mapping.get("category_id"), mapping.get("offer_id")))
    return uc_amount_of(offer, game_id) if offer else None


def _uc_offers_by_category(catalog: list[dict], game_id: str | None = None) -> dict:
    """Offres UC disponibles par catégorie, quantités déduites du catalogue live (jamais hardcodées)."""
    out = {}
    for cat in catalog:
        ucs = []
        for o in cat.get("offers") or []:
            amt = uc_amount_of(o, game_id)
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


def resolve_uc_mapping(target_uc: int, catalog: list[dict], game_id: str | None = None) -> dict | None:
    """RÈGLE GÉNÉRALE — SKU UC exact → direct ; sinon somme exacte disponible → composition ; sinon None (manquant)."""
    if not target_uc:
        return None
    by_cat = _uc_offers_by_category(catalog, game_id)
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


def game_product_query(game_id: str | None) -> dict:
    """Filtre produits par jeu. PUBG inclut les produits historiques sans `game_id`
    (compatibilité Phase 1) ; tout autre jeu ne voit QUE ses propres produits — jamais
    ceux d'un autre jeu. Sans jeu explicite → aucun filtre (comportement historique)."""
    if not game_id:
        return {}
    if game_id == DEFAULT_GAME_ID:
        return {"$or": [{"game_id": game_id}, {"game_id": {"$exists": False}}]}
    return {"game_id": game_id}


async def audit_uc_products(catalog: list[dict], game_id: str | None = None) -> list[dict]:
    """Audit LECTURE SEULE des produits UC MGS d'UN JEU vs catalogue fournisseur live. N'écrit rien.

    `game_id` isole strictement l'audit : un audit Free Fire ne lit jamais les produits PUBG
    (et inversement). Sans `game_id`, le comportement historique est conservé.

    Un jeu ALUU est IGNORÉ (liste vide) : cet audit compare des offres FazerCards, il ne peut
    rien dire d'un catalogue ALUU. L'écriture correspondante est refusée (`apply_uc_audit`).
    """
    if game_id:
        provider = await providers.provider_for_game(game_id)
        if provider.name == "aluu":
            return []
    catalog_by_offer = {(cat["category_id"], o["offer_id"]): o for cat in catalog for o in (cat.get("offers") or [])}
    query = {"uc_amount": {"$gt": 0}, "type": {"$nin": ["prime", "prime_plus", "evo"]}, **game_product_query(game_id)}
    rows = []
    async for p in db.products.find(query,
                                    {"_id": 0, "id": 1, "slug": 1, "name": 1, "uc_amount": 1,
                                     "fazercards_mapping": 1}).sort("uc_amount", 1):
        target = p.get("uc_amount")
        current = p.get("fazercards_mapping")
        current_uc = mapping_total_uc(current, catalog_by_offer, game_id)
        current_ok = bool(target) and mapping_ok(current) and current_uc == target
        resolution = resolve_uc_mapping(target, catalog, game_id) if target else None
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


async def apply_uc_audit(catalog: list[dict], actor: str | None = None, game_id: str | None = None) -> dict:
    """Corrige les mappings UC d'UN JEU (direct/composition exacte, sinon manquant).

    `game_id` est transmis à l'audit : appliquer l'audit d'un jeu ne modifie JAMAIS les
    produits d'un autre jeu. Préserve les mappings déjà corrects.

    Un jeu ALUU est REFUSÉ (409) : l'audit FazerCards n'écrit jamais dans un jeu dont le
    fournisseur est ALUU (le mapping ALUU passe par son propre aperçu + apply).
    """
    if game_id:
        provider = await providers.provider_for_game(game_id)
        _refuse_aluu_game(game_id, provider)
    rows = await audit_uc_products(catalog, game_id)
    fixed, removed = [], []
    for row in rows:
        if row["action"] == "fix":
            # MÊMES règles de jeu qu'à l'audit : sans `game_id`, les offres d'un autre jeu
            # (« 30 Diamants ») seraient illisibles et aucun correctif ne serait calculable.
            doc = mapping_doc_from_resolution(resolve_uc_mapping(row["uc_amount"], catalog, game_id))
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
