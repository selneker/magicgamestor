"""Lot 4 — mapping produit MGS → pack ALUU : appariement EXACT, aperçu en lecture seule, apply explicite.

Règles (aucune n'est négociable côté code) :

- **Appariement exact uniquement, sur la QUANTITÉ.** Le `denom` numérique du pack passe en
  premier (`Pack` = quantité commandée chez ALUU) ; à défaut, le nom du pack doit contenir UN
  SEUL nombre autonome (« 60 UC », « 86 Diamonds »). Deux packs candidats pour la même
  quantité = `ambiguous`, jamais applicable. Aucun appariement par prix, aucun arrondi.
- **Aucune écriture sans apply explicite.** `preview()` ne lit que des documents ; `apply()`
  n'écrit que pour les `product_ids` fournis et seulement s'ils restent `exact` dans l'aperçu
  frais qu'on lui passe (le routeur le recalcule juste avant, cf. Lot 6).
- **`fazercards_mapping` n'est jamais lu ni écrit ici** : le rollback FazerCards reste possible
  et aucune donnée FazerCards n'est réinterprétée comme une donnée ALUU.
"""
import re
from datetime import datetime, timezone

from core.audit import audit
from core.db import db
from services.fzr_mapping import game_product_query

# Nombre AUTONOME uniquement — même règle que `fzr_mapping._OTHER_QTY` (copie assumée : ici la
# sémantique est celle des packs ALUU, où `denom` est prioritaire et le nom n'est qu'un repli).
_AMOUNT_IN_NAME = re.compile(r"(?<![A-Za-z0-9])(\d+)(?![0-9])")

EXACT, AMBIGUOUS, MISSING = "exact", "ambiguous", "missing"
MATCH_BY_DENOM, MATCH_BY_NAME = "denom", "name"

PRODUCT_PROJECTION = {"_id": 0, "id": 1, "slug": 1, "name": 1, "uc_amount": 1, "price": 1,
                      "requires_mapping": 1, "aluu_mapping": 1}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def amount_of(offer: dict) -> tuple[int | None, str | None]:
    """Quantité d'un pack ALUU et son origine : `("denom"|"name", None)` en cas de doute.

    `offer_id` est le `denom` du catalogue ALUU (normalisé par l'adapter). Un `denom` non
    numérique n'est PAS interprété comme une quantité : on retombe alors sur le nom, et
    seulement s'il porte un unique nombre autonome.
    """
    denom = str(offer.get("offer_id") or "").strip()
    if denom.isdigit() and int(denom) > 0:
        return int(denom), MATCH_BY_DENOM
    numbers = _AMOUNT_IN_NAME.findall(str(offer.get("name") or ""))
    if len(numbers) == 1 and int(numbers[0]) > 0:
        return int(numbers[0]), MATCH_BY_NAME
    return None, None


def _index_packs(packs: list[dict]) -> dict[int, list[dict]]:
    """Quantité → packs candidats. Les packs sans quantité lisible sont ignorés."""
    by_amount: dict[int, list[dict]] = {}
    for pack in packs or []:
        amount, matched_by = amount_of(pack)
        if amount is None:
            continue
        by_amount.setdefault(amount, []).append({
            "offer_id": str(pack.get("offer_id") or "").strip(),
            "name": pack.get("name"),
            "price_usd": pack.get("price_usd"),
            "matched_by": matched_by,
        })
    return by_amount


def _pick(candidates: list[dict]) -> list[dict]:
    """Priorité au `denom` numérique : s'il existe au moins un candidat par `denom`, on ignore
    ceux trouvés par le nom (le nom peut décrire un bonus, ex. « 66 » → « 60 UC + 6 UC »)."""
    by_denom = [c for c in candidates if c["matched_by"] == MATCH_BY_DENOM]
    return by_denom or candidates


def current_state(mapping: dict | None, game_code: str, denom: str) -> str:
    """État du mapping ALUU existant : `ok` (identique), `relink` (autre cible), `missing`."""
    if not mapping:
        return "missing"
    same = (str(mapping.get("game_code") or "").strip() == game_code
            and str(mapping.get("denom") or "").strip() == denom
            and mapping.get("confirmed") is not False)
    return "ok" if same else "relink"


def mapping_ok_aluu(mapping: dict | None) -> bool:
    """Mapping ALUU utilisable : code jeu + pack présents et confirmé (jamais `confirmed: false`)."""
    if not mapping or mapping.get("confirmed") is False:
        return False
    return bool(str(mapping.get("game_code") or "").strip() and str(mapping.get("denom") or "").strip())


def match_products(products: list[dict], packs: list[dict], game_code: str) -> dict:
    """Appariement PUR (aucune I/O) : produits MGS à quantité × packs ALUU.

    Seuls les produits à quantité (`uc_amount > 0`) sont appariables exactement ; les produits
    Prime / Prime+ / pack évolutif ne le sont pas et ne sont donc pas listés (mapping manuel).
    """
    by_amount = _index_packs(packs)
    items: list[dict] = []
    for product in products:
        target = product.get("uc_amount")
        if not target or target <= 0:
            continue
        candidates = _pick(by_amount.get(target, []))
        base = {
            "product_id": product.get("id"), "slug": product.get("slug"),
            "name": product.get("name"), "uc_amount": target,
            "requires_mapping": bool(product.get("requires_mapping")),
            "mgs_price": product.get("price"),
        }
        if not candidates:
            items.append({**base, "match": MISSING, "matched_by": None, "denom": None,
                          "aluu_name": None, "price_usd": None, "current": "missing",
                          "reason": f"aucun pack ALUU de quantité {target}"})
            continue
        if len(candidates) > 1:
            items.append({**base, "match": AMBIGUOUS, "matched_by": None, "denom": None,
                          "aluu_name": None, "price_usd": None, "current": "missing",
                          "reason": "plusieurs packs ALUU pour la même quantité",
                          "candidates": [c["offer_id"] for c in candidates]})
            continue
        offer = candidates[0]
        items.append({**base, "match": EXACT, "matched_by": offer["matched_by"],
                      "denom": offer["offer_id"], "aluu_name": offer["name"],
                      "price_usd": offer["price_usd"],
                      "current": current_state(product.get("aluu_mapping"), game_code,
                                               offer["offer_id"]),
                      "reason": None})
    unmatched = [{"product_id": i["product_id"], "name": i["name"], "uc_amount": i["uc_amount"],
                  "match": i["match"], "reason": i["reason"]}
                 for i in items if i["match"] != EXACT]
    summary = {
        EXACT: sum(1 for i in items if i["match"] == EXACT),
        AMBIGUOUS: sum(1 for i in items if i["match"] == AMBIGUOUS),
        MISSING: sum(1 for i in items if i["match"] == MISSING),
        "already_linked": sum(1 for i in items if i["current"] == "ok"),
    }
    return {"items": items, "unmatched": unmatched, "summary": summary}


async def preview(game_id: str, game_code: str, packs: list[dict], *, collection=None) -> dict:
    """Dry-run LECTURE SEULE des produits à quantité d'un jeu contre les packs ALUU fournis.

    `packs` = `offers` renvoyés par `AluuProvider.get_offers` (aucun appel réseau ici).
    """
    products = await (collection or db.products).find(
        {"uc_amount": {"$gt": 0}, "type": {"$nin": ["prime", "prime_plus", "evo"]},
         **game_product_query(game_id)}, PRODUCT_PROJECTION).to_list(1000)
    return {"game_id": game_id, "aluu_game_code": game_code,
            **match_products(products, packs, game_code)}


def _mapping_doc(item: dict, game_code: str, actor: str | None) -> dict:
    return {
        "game_code": game_code,
        "denom": item["denom"],
        "offer_name": item["aluu_name"],
        "price_usd_at_link": item["price_usd"],
        "confirmed": True,
        "source": "admin_apply",
        "linked_at": _now(),
        "linked_by": actor or "system",
    }


async def apply(preview_doc: dict, product_ids: list[str], *, actor: str | None = None,
                collection=None) -> dict:
    """Écrit `aluu_mapping` pour les SEULS `product_ids` fournis, et seulement s'ils sont `exact`.

    `preview_doc` doit être un aperçu frais (revalidation live côté routeur). Tout le reste est
    renvoyé en `skipped` avec son motif. Aucune écriture hors `products.aluu_mapping` :
    `fazercards_mapping` n'est jamais touché.
    """
    game_code = str(preview_doc.get("aluu_game_code") or "").strip()
    wanted = {str(pid).strip() for pid in product_ids or [] if str(pid or "").strip()}
    by_id = {item.get("product_id"): item for item in preview_doc.get("items") or []}
    written: list[dict] = []
    unchanged: list[dict] = []
    skipped: list[dict] = []

    if not game_code:
        return {"written": [], "unchanged": [], "skipped": [{"product_id": pid,
                                                             "reason": "code jeu ALUU absent"}
                                                            for pid in sorted(wanted)],
                "written_count": 0, "unchanged_count": 0, "skipped_count": len(wanted)}

    for product_id in sorted(wanted):
        item = by_id.get(product_id)
        if item is None:
            skipped.append({"product_id": product_id, "reason": "produit hors aperçu"})
            continue
        if item.get("match") != EXACT:
            skipped.append({"product_id": product_id,
                            "reason": item.get("reason") or f"appariement {item.get('match')}"})
            continue
        if item.get("current") == "ok":
            unchanged.append({"product_id": product_id, "denom": item.get("denom")})
            continue
        doc = _mapping_doc(item, game_code, actor)
        await (collection or db.products).update_one({"id": product_id},
                                                     {"$set": {"aluu_mapping": doc}})
        await audit("aluu.mapping_applied", actor, product_id,
                    {"game_code": game_code, "denom": doc["denom"],
                     "offer_name": doc["offer_name"], "price_usd_at_link": doc["price_usd_at_link"],
                     "previous": item.get("current")})
        written.append({"product_id": product_id, "denom": doc["denom"],
                        "offer_name": doc["offer_name"], "price_usd": doc["price_usd_at_link"]})

    return {"written": written, "unchanged": unchanged, "skipped": skipped,
            "written_count": len(written), "unchanged_count": len(unchanged),
            "skipped_count": len(skipped)}


__all__ = ["AMBIGUOUS", "EXACT", "MISSING", "amount_of", "apply", "current_state",
           "mapping_ok_aluu", "match_products", "preview"]
