"""T09 — bascule contrôlée du catalogue PUBG Mobile (Shop2Topup).

RIEN NE CHANGE AU DÉPLOIEMENT
=============================
Le service est appelé au démarrage (`server.py`, à côté du rattachement T04) mais ne fait
rien tant que `SHOP2TOPUP_CUTOVER` est absente ou vaut `off`. Les trois autres valeurs sont
explicites :

    dry-run   calcule, journalise et enregistre le rapport dans `settings.cutover_report` ;
              n'écrit AUCUN produit.
    apply     applique une seule fois (garde `settings.cutover.applied_at`), après avoir
              enregistré l'état d'avant dans `settings.cutover.snapshot`.
    rollback  restaure le snapshot et rien d'autre, puis note `rolled_back_at` — un nouvel
              `apply` redevient permis.

CE QUE `apply` FAIT, POUR PUBG MOBILE SEULEMENT
===============================================
1. Prix des 6 lots du manifeste T04 (`core/shop2topup_mapping.py:23-36`), retrouvés par leur
   slug ET leur total d'UC (`uc_amount`), jamais par leur position. Le champ écrit est
   `product["price"]` — celui que la commande recopie dans `items[].unit_price`
   (`routers/orders.py:378`), donc **une commande déjà créée garde son prix payé** ;
   `old_price` (prix barré, affichage seul) n'est pas touché.
2. Masque (`active: false`) les lots UC de PUBG Mobile **sans**
   `supplier_mapping.shop2topup`. L'ensemble calculé doit être exactement les 8 lots connus
   (`UNMAPPED_LOTS`) et les 6 lots mappés doivent être exactement le manifeste : sinon
   **rien n'est écrit**, le rapport explique l'écart. `active` est le seul mécanisme de
   visibilité du catalogue (`routers/products.py:86`).
3. Déplace le badge « populaire » de 30 UC et 1 320 UC vers 325 UC et 660 UC (A3) : le
   drapeau `popular` et le libellé `badge` sont écrits ensemble, comme dans `core/seed.py:50-51`.

SÉCURITÉ D'ÉCRITURE
===================
- Le snapshot précède toute écriture et n'est jamais réécrit par un `apply` suivant tant
  qu'un `rollback` ne l'a pas consommé.
- Chaque produit touché reçoit **un seul `$set` absolu** (jamais un delta) : un `apply`
  interrompu se rejoue et converge vers le même état ; `applied_at` n'est écrit qu'après la
  dernière mise à jour.
- Ordre documenté : snapshot → prix (6 lots mappés) → visibilité (8 lots) → badge (4 lots) →
  `applied_at`.
- Toute erreur est journalisée et rendue en compteur : le démarrage du serveur n'échoue
  jamais à cause de la bascule.

Aucun produit n'est créé ni supprimé. Les produits hors lots UC (Prime, packs évolutifs)
sont seulement listés dans le rapport, avec leur fournisseur, pour la décision du
propriétaire avant la coupure de FazerCards.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from core.db import db
from core.shop2topup_mapping import SHOP2TOPUP_KEY, SHOP2TOPUP_MANIFEST
from services import notifications

logger = logging.getLogger("mgs.shop2topup_cutover")

MODE_ENV = "SHOP2TOPUP_CUTOVER"
CUTOVER_KEY = "cutover"          # settings.cutover.{applied_at,snapshot,rolled_back_at}
REPORT_KEY = "cutover_report"    # settings.cutover_report
GAME_ID = "pubg-mobile"
ALERT_URL = "/admin/catalogue"
PROJECTION = {"_id": 0}

# Prix payés, en ariary (T09). 60 UC est déjà à ce prix : aucun écrit.
TARGET_PRICES = {60: 5000, 325: 22000, 660: 44000,
                 1800: 109000, 3850: 217000, 16200: 871000}
# Les 8 lots UC sans équivalent Shop2Topup (calculés, jamais supposés).
UNMAPPED_LOTS = frozenset({30, 90, 120, 180, 415, 720, 985, 1320})
POPULAR_OFF = frozenset({30, 1320})
POPULAR_ON = frozenset({325, 660})
SNAPSHOT_FIELDS = ("price", "active", "popular", "badge")


class PlanError(Exception):
    """Écart entre la base et ce que `apply` attend ; le message est lisible tel quel."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


def mode() -> str:
    return (os.environ.get(MODE_ENV) or "").strip().lower()


def _supplier(product: dict) -> str:
    """Fournisseur lisible d'un produit : la clé de mapping, sinon `aucun`."""
    mapping = product.get("supplier_mapping") or {}
    for name in (SHOP2TOPUP_KEY, "g2bulk"):
        if mapping.get(name):
            return name
    if product.get("fazercards_mapping"):
        return "fazercards"
    return "aucun"


def _changes(product: dict, uc: int) -> dict:
    """Champs à écrire pour un lot UC (vide si rien ne change)."""
    fields = {}
    target_price = TARGET_PRICES.get(uc)
    if target_price is not None and product.get("price") != target_price:
        fields["price"] = target_price
    if uc in UNMAPPED_LOTS and product.get("active"):
        fields["active"] = False
    popular = True if uc in POPULAR_ON else (False if uc in POPULAR_OFF else product.get("popular"))
    if bool(product.get("popular")) != bool(popular):
        fields["popular"] = bool(popular)
        fields["badge"] = "popular" if popular else None
    return fields


def _lot_rows(products: list[dict]) -> tuple[list[dict], list[dict], list[dict], list[str]]:
    """Tableau avant/après des 14 lots, écritures prévues, produits touchés, erreurs de garde."""
    errors: list[str] = []
    grouped: dict[int, list[dict]] = {}
    for product in products:
        uc = product.get("uc_amount")
        if uc is not None:
            grouped.setdefault(int(uc), []).append(product)

    manifest = {row["uc_total"]: row["product_slug"] for row in SHOP2TOPUP_MANIFEST}
    unknown = sorted(set(grouped) - set(manifest) - UNMAPPED_LOTS)
    if unknown:
        errors.append(f"lots UC non prévus: {unknown}")
    missing = sorted((set(manifest) | UNMAPPED_LOTS) - set(grouped))
    if missing:
        errors.append(f"lots UC absents: {missing}")
    for uc, items in sorted(grouped.items()):
        if len(items) > 1:
            errors.append(f"{uc} UC présent {len(items)} fois")

    mapped = {int(p["uc_amount"]) for p in products
              if p.get("uc_amount") is not None and (p.get("supplier_mapping") or {}).get(SHOP2TOPUP_KEY)}
    unmapped = {int(p["uc_amount"]) for p in products
                if p.get("uc_amount") is not None
                and not (p.get("supplier_mapping") or {}).get(SHOP2TOPUP_KEY)}
    if mapped != set(manifest):
        errors.append(f"lots mappés {sorted(mapped)} ≠ manifeste {sorted(manifest)}")
    if unmapped != set(UNMAPPED_LOTS):
        errors.append(f"lots sans mapping {sorted(unmapped)} ≠ attendus {sorted(UNMAPPED_LOTS)}")

    rows, writes, touched = [], [], []
    for uc in sorted(set(manifest) | set(UNMAPPED_LOTS)):
        items = grouped.get(uc) or []
        product = items[0] if len(items) == 1 else None
        if product is None:
            continue
        if product.get("slug") != manifest.get(uc, product.get("slug")):
            errors.append(f"lot {uc} UC : slug {product.get('slug')!r} inattendu")
        fields = _changes(product, uc)
        rows.append({"slug": product.get("slug"), "uc": uc,
                     "price_before": product.get("price"),
                     "price_after": fields.get("price", product.get("price")),
                     "active_before": bool(product.get("active")),
                     "active_after": fields.get("active", bool(product.get("active"))),
                     "popular_before": bool(product.get("popular")),
                     "popular_after": fields.get("popular", bool(product.get("popular")))})
        touched.append(product)
        if fields:
            writes.append({"id": product.get("id"), "slug": product.get("slug"), "fields": fields})

    if not errors:
        for uc in manifest:
            product = grouped[uc][0]
            if not product.get("active"):
                errors.append(f"lot mappé {uc} UC inactif")
    return rows, writes, touched, errors


def _orphans(products: list[dict]) -> list[dict]:
    """Produits PUBG actifs hors lots UC : listés, jamais modifiés."""
    return [{"slug": p.get("slug"), "name": p.get("name"), "type": p.get("type"),
             "price": p.get("price"), "supplier": _supplier(p)}
            for p in products
            if p.get("uc_amount") is None and p.get("active")]


async def _products() -> list[dict]:
    return await db.products.find({"game_id": GAME_ID}, PROJECTION).to_list(None)


async def build_plan() -> dict:
    """Lit les produits et rend le plan complet (aucune écriture)."""
    products = await _products()
    rows, writes, touched, errors = _lot_rows(products)
    snapshot = [{"id": p.get("id"), "slug": p.get("slug"),
                 **{field: p.get(field) for field in SNAPSHOT_FIELDS}} for p in touched]
    return {"ok": not errors, "errors": errors, "lots": rows, "writes": writes,
            "snapshot": snapshot, "orphans": _orphans(products)}


async def _doc(key: str) -> dict:
    return dict(await db.settings.find_one({"key": key}) or {})


async def _report(report: dict) -> None:
    await db.settings.update_one({"key": REPORT_KEY},
                                 {"$set": {"report": report, "updated_at": report["at"]}},
                                 upsert=True)


def _log_rows(rows: list[dict]) -> None:
    for row in rows:
        logger.info("lot %s UC : prix %s → %s · actif %s → %s · populaire %s → %s",
                    row["uc"], row["price_before"], row["price_after"],
                    row["active_before"], row["active_after"],
                    row["popular_before"], row["popular_after"])


async def _notify(event: str, title: str, body: str) -> None:
    try:
        await notifications.notify_admin(event=event, title=title, body=body, url=ALERT_URL)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("alerte %s non envoyée (%s)", event, type(exc).__name__)


async def dry_run(moment: datetime) -> dict:
    plan = await build_plan()
    _log_rows(plan["lots"])
    if not plan["ok"]:
        logger.error("bascule en essai à blanc : garde en échec %s", plan["errors"])
    await _report({"mode": "dry-run", "at": _iso(moment), "ok": plan["ok"],
                   "errors": plan["errors"], "lots": plan["lots"],
                   "writes": plan["writes"], "orphans": plan["orphans"]})
    return {"cutover": "dry-run"}


async def apply(moment: datetime) -> dict:
    state = await _doc(CUTOVER_KEY)
    applied, rolled = state.get("applied_at"), state.get("rolled_back_at")
    if applied and (not rolled or str(rolled) < str(applied)):
        logger.warning("bascule déjà appliquée le %s : rien à faire", applied)
        return {"cutover": "already_applied"}

    plan = await build_plan()
    if not plan["ok"]:
        # Garde de sécurité : le catalogue ne correspond pas à ce qui est attendu.
        logger.error("bascule refusée, aucun produit écrit : %s", plan["errors"])
        await _report({"mode": "apply-blocked", "at": _iso(moment), "ok": False,
                       "errors": plan["errors"], "lots": plan["lots"],
                       "writes": [], "orphans": plan["orphans"]})
        return {"cutover": "blocked"}

    snapshot = state.get("snapshot")
    if not snapshot:
        snapshot = plan["snapshot"]
        await db.settings.update_one({"key": CUTOVER_KEY},
                                     {"$set": {"snapshot": snapshot, "snapshot_at": _iso(moment)}},
                                     upsert=True)
        logger.info("état d'avant enregistré pour %s produit(s)", len(snapshot))

    before = {entry.get("id"): entry for entry in snapshot}
    written: list[dict] = []
    try:
        for write in plan["writes"]:
            result = await db.products.update_one({"id": write["id"]}, {"$set": write["fields"]})
            if getattr(result, "matched_count", 1) == 0:
                logger.warning("produit %s introuvable à l'écriture", write["slug"])
                continue
            written.append(write)
            logger.info("produit %s : %s", write["slug"], sorted(write["fields"]))
    except Exception:
        # Un `apply` interrompu ne doit pas laisser la moitié des lots changés : les produits
        # déjà écrits sont remis dans leur état d'avant, puis `run()` journalise l'échec.
        logger.error("écriture interrompue après %s produit(s) : retour à l'état d'avant", len(written))
        for write in written:
            entry = before.get(write["id"]) or {}
            fields = {field: entry.get(field) for field in SNAPSHOT_FIELDS}
            try:
                await db.products.update_one({"id": write["id"]}, {"$set": fields})
            except Exception as exc:  # la base est peut-être déjà injoignable
                logger.error("restauration de %s impossible (%s)", write["slug"], type(exc).__name__)
        raise

    await db.settings.update_one({"key": CUTOVER_KEY},
                                 {"$set": {"applied_at": _iso(moment)}}, upsert=True)
    _log_rows(plan["lots"])
    await _report({"mode": "apply", "at": _iso(moment), "ok": True, "errors": [],
                   "lots": plan["lots"], "writes": plan["writes"],
                   "orphans": plan["orphans"], "applied": True})
    await _notify("catalogue_cutover_applied", "Bascule catalogue appliquée",
                  f"{len(plan['writes'])} produit(s) mis à jour : 6 prix, 8 lots masqués, "
                  "badge « populaire » sur 325 et 660 UC. Détail : settings.cutover_report.")
    return {"cutover": "applied"}


async def rollback(moment: datetime) -> dict:
    state = await _doc(CUTOVER_KEY)
    snapshot = state.get("snapshot") or []
    if not snapshot:
        logger.warning("retour arrière demandé sans snapshot : rien à restaurer")
        return {"cutover": "nothing_to_roll_back"}

    restored = 0
    for entry in snapshot:
        fields = {field: entry.get(field) for field in SNAPSHOT_FIELDS}
        result = await db.products.update_one({"id": entry.get("id")}, {"$set": fields})
        if getattr(result, "matched_count", 1) == 0:
            logger.warning("produit %s introuvable au retour arrière", entry.get("slug"))
            continue
        restored += 1

    await db.settings.update_one({"key": CUTOVER_KEY},
                                 {"$set": {"rolled_back_at": _iso(moment)},
                                  "$unset": {"snapshot": "", "snapshot_at": ""}}, upsert=True)
    await _report({"mode": "rollback", "at": _iso(moment), "ok": True, "restored": restored})
    await _notify("catalogue_cutover_rolled_back", "Bascule catalogue annulée",
                  f"{restored} produit(s) restauré(s) à l'état d'avant. "
                  "Un nouveau SHOP2TOPUP_CUTOVER=apply redevient possible.")
    return {"cutover": "rolled_back", "restored": restored}


async def run(mode_value: str | None = None, moment: datetime | None = None) -> dict:
    """Point d'entrée unique ; ne lève jamais. `off` sort sans lire la base."""
    selected = (mode_value if mode_value is not None else mode()).strip().lower()
    if selected in ("", "off"):
        return {"cutover": "off"}
    moment = moment or _now()
    try:
        if selected == "dry-run":
            return await dry_run(moment)
        if selected == "apply":
            return await apply(moment)
        if selected == "rollback":
            return await rollback(moment)
        logger.warning("%s=%r inconnu : aucune action", MODE_ENV, selected)
        return {"cutover": "unknown"}
    except Exception as exc:  # une bascule ne fait jamais échouer le démarrage
        logger.error("bascule catalogue interrompue (%s)", type(exc).__name__)
        return {"cutover": "error"}


async def run_at_startup(moment: datetime | None = None) -> dict:
    """Appelé par `server.py` au démarrage ; alias lisible de `run()`."""
    return await run(moment=moment)
