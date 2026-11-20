"""PL-006-T06 — synchro disponibilité fournisseur → catalogue (Checkpoint A).

Ce module applique au catalogue le relevé de `shop2topup_stock`. C'est le seul endroit qui décide
« ce SKU est en rupture » à partir d'une lecture réussie. Trois règles le gouvernent :

1. **Seuls les produits rattachés sont concernés.** Un produit sans
   `supplier_mapping.shop2topup` n'est ni lu ni écrit (T04, A1).
2. **On ne conclut que ce qui a été lu.** `OutOfStock` lu ⇒ `mark_supplier_unavailable` avec
   `CONFIRMED_STOCK_SOURCE` (rupture qui n'expire pas) ; `InStock` lu ⇒ `mark_supplier_available` ;
   page en échec, SKU absent ou disponibilité inconnue ⇒ **aucune écriture**.
3. **Un relevé douteux ne touche à rien.** Aucune page lue, ou moins de la moitié des SKU attendus
   couverts : l'état du catalogue reste tel quel (même prudence que `stock_signals.py:42`).

La santé du relevé est suivie à part : `pages_failed` non vide — ou une couverture insuffisante,
qui est un échec de relevé au même titre — pendant `HEALTH_STREAK_ALERT` passages de suite ⇒
**une** alerte admin par les canaux existants ; le premier passage sans échec envoie le retour à
la normale, une seule fois. Une lecture qui échoue en silence est le pire des
cas : le signal mourrait sans que personne ne le sache.

`STOCK_SYNC_ENABLED=false` rend le passage inerte : aucune requête, aucune écriture. Un verrou
empêche deux passages de se chevaucher ; le second est ignoré (une lecture dure jusqu'à 30 s, voir
`shop2topup_stock.TOTAL_BUDGET_S`).
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from core.db import db
from core.shop2topup_mapping import SHOP2TOPUP_KEY
from services import notifications, shop2topup_stock, stock

logger = logging.getLogger("mgs.availability_sync")

# Chemin du rattachement écrit par T04 : c'est lui qui sélectionne les produits concernés.
MAPPED = f"supplier_mapping.{SHOP2TOPUP_KEY}"
PROJECTION = {"_id": 0, "id": 1, "name": 1, MAPPED: 1}

# Moins de la moitié des SKU attendus couverts ⇒ relevé jugé suspect, rien n'est appliqué.
SUSPECT_COVERAGE_RATIO = 0.5
# Nombre de passages consécutifs avec au moins une page en échec avant d'alerter l'admin.
HEALTH_STREAK_ALERT = 3
HEALTH_ID = SHOP2TOPUP_KEY
HEALTH_URL = "/admin/catalogue"
# Aucun nom de fournisseur : ces textes partent sur l'écran de l'admin (et Telegram).
HEALTH_MESSAGES = {
    "unhealthy": (
        "Relevé de disponibilité en échec",
        f"Le relevé est incomplet (page illisible ou couverture insuffisante) depuis "
        f"{HEALTH_STREAK_ALERT} passages : le catalogue n'est plus mis à jour. Vérifiez la source "
        "de disponibilité.",
    ),
    "recovered": (
        "Relevé de disponibilité rétabli",
        "La lecture des disponibilités fonctionne de nouveau : le catalogue est mis à jour "
        "normalement.",
    ),
}

# Mode d'application du relevé (décision de revue T06).
SYNC_MODE_ENV = "STOCK_SYNC_MODE"
MODE_APPLY = "apply"
MODE_OBSERVE = "observe"


def sync_mode() -> str:
    """`STOCK_SYNC_MODE` : `apply` écrit, `observe` se contente de journaliser.

    Défaut `observe` : ce relevé est nouveau, il n'écrit donc rien dans le catalogue tant que le
    propriétaire ne l'a pas demandé explicitement. Toute valeur inconnue retombe sur `observe` —
    on n'écrit que sur un choix explicite, jamais par accident. La santé du relevé, elle, est
    suivie dans les deux modes : le mode change les écritures, pas la surveillance.
    """
    raw = (os.environ.get(SYNC_MODE_ENV) or "").strip().lower()
    return MODE_APPLY if raw == MODE_APPLY else MODE_OBSERVE


_run_lock = asyncio.Lock()


def _counters() -> dict:
    """Compteurs renvoyés par un passage (aucun détail produit, aucune donnée client).

    `would_mark_*` ne compte que les écritures qu'un passage en `observe` aurait faites : le
    propriétaire peut comparer l'intention et l'effet avant de passer en `apply`.
    """
    return {"checked": 0, "marked_out": 0, "marked_in": 0, "skipped": 0,
            "pages_ok": 0, "pages_failed": 0,
            "mode": MODE_OBSERVE, "would_mark_out": 0, "would_mark_in": 0}


async def _mapped_products() -> list[dict]:
    """Produits rattachés au fournisseur, avec leur SKU — une seule lecture, sans plafond."""
    found = []
    async for product in db.products.find({MAPPED: {"$exists": True}}, PROJECTION):
        mapping = (product.get("supplier_mapping") or {}).get(SHOP2TOPUP_KEY) or {}
        sku = str(mapping.get("sku") or "").strip()
        if not sku:
            continue  # rattachement sans SKU : inexploitable, jamais interprété comme « absent »
        found.append({"id": product.get("id"), "name": product.get("name"), "sku": sku})
    return found


async def _notify_health(kind: str) -> None:
    """Alerte de santé par les canaux admin existants (push + Telegram). Ne lève jamais."""
    title, body = HEALTH_MESSAGES[kind]
    try:
        await notifications.notify_admin(event=f"stock_sync_{kind}", title=title, body=body,
                                         url=HEALTH_URL)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Alerte de santé non envoyée (%s)", type(exc).__name__)


async def _update_health(*, pages_ok: int, pages_failed: int, suspect: bool = False,
                         now: datetime | None = None) -> None:
    """Suit la santé du relevé : une alerte par épisode de panne, un retour par rétablissement.

    `suspect` (couverture insuffisante) compte comme un échec : un relevé qui ne couvre pas la
    moitié des SKU attendus laisse le catalogue aveugle exactement comme une page illisible.
    L'état est écrit **avant** l'envoi : un passage suivant ne peut donc pas répéter l'alerte.
    Un journal de santé indisponible n'empêche ni la synchro ni l'alerte.
    """
    failing = pages_failed > 0 or suspect
    try:
        state = await db.stock_sync_health.find_one({"_id": HEALTH_ID}) or {}
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Santé du relevé illisible (%s)", type(exc).__name__)
        state = {}
    streak = int(state.get("failed_streak") or 0) + 1 if failing else 0
    alerted = bool(state.get("alerted"))
    alert = failing and streak >= HEALTH_STREAK_ALERT and not alerted
    recovered = not failing and alerted
    try:
        await db.stock_sync_health.update_one(
            {"_id": HEALTH_ID},
            {"$set": {"failed_streak": streak, "alerted": alert or (alerted and not recovered),
                      "pages_ok": pages_ok, "pages_failed": pages_failed,
                      "coverage_suspect": bool(suspect),
                      "last_run_at": (now or datetime.now(timezone.utc)).isoformat()}},
            upsert=True)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Santé du relevé non enregistrée (%s)", type(exc).__name__)
    if alert:
        logger.warning("relevé en échec depuis %d passages : alerte admin", streak)
        await _notify_health("unhealthy")
    elif recovered:
        logger.info("relevé de nouveau lisible : retour à la normale signalé")
        await _notify_health("recovered")


async def run_once(now: datetime | None = None) -> dict:
    """Un passage complet : lire la source, appliquer l'état, suivre la santé.

    Inerte si `STOCK_SYNC_ENABLED` est faux. En mode `observe` (défaut), tout est lu, journalisé
    et surveillé, mais **aucune écriture** n'est faite. Ne lève jamais : c'est une tâche du cron,
    une panne du relevé ne doit pas interrompre les autres tâches.
    """
    counters = _counters()
    if not stock.sync_enabled():
        logger.info("synchro de disponibilité désactivée (STOCK_SYNC_ENABLED)")
        return counters
    if _run_lock.locked():
        # Deux passages simultanés écriraient deux fois le même état : le second est ignoré.
        logger.warning("passage précédent encore en cours : celui-ci est ignoré")
        return counters
    async with _run_lock:
        return await _sync(counters, now)


async def _sync(counters: dict, now: datetime | None) -> dict:
    mode = sync_mode()
    counters["mode"] = mode
    try:
        products = await _mapped_products()
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Catalogue illisible (%s), relevé ignoré", type(exc).__name__)
        return counters
    if not products:
        logger.info("aucun produit rattaché : rien à synchroniser")
        return counters

    reading = await shop2topup_stock.fetch_stock()
    counters["pages_ok"] = reading.pages_ok
    counters["pages_failed"] = reading.pages_failed

    expected = {product["sku"] for product in products}
    covered = expected & set(reading.states)
    # Une couverture insuffisante est un échec de RELEVÉ pour la santé, au même titre qu'une page
    # illisible (décision de revue T06) ; les compteurs de pages, eux, ne comptent que le réel.
    suspect = not reading.conclusive or len(covered) < len(expected) * SUSPECT_COVERAGE_RATIO
    await _update_health(pages_ok=reading.pages_ok, pages_failed=reading.pages_failed,
                         suspect=suspect, now=now)
    if suspect:
        # Une page en échec n'invalide pas les autres : on ne juge que la couverture réelle.
        logger.warning("relevé ignoré : %d SKU attendu(s), %d couvert(s), %d page(s) en échec, "
                       "aucun état modifié", len(expected), len(covered), reading.pages_failed)
        return counters

    observing = mode != MODE_APPLY
    for product in products:
        verdict = reading.states.get(product["sku"])
        if verdict is None:
            counters["skipped"] += 1  # ni publié ni conclu : jamais une rupture
            continue
        counters["checked"] += 1
        if observing:
            # Mode observe : on journalise l'écriture qu'on aurait faite, sans l'écrire.
            counters["would_mark_out" if not verdict else "would_mark_in"] += 1
            logger.info("mode observe : le produit %s serait marqué %s (aucune écriture)",
                        product.get("id"), "en rupture" if not verdict else "disponible")
            continue
        if verdict:
            if await stock.mark_supplier_available(product, actor="stock-sync",
                                                   source=stock.CONFIRMED_STOCK_SOURCE):
                counters["marked_in"] += 1
            continue
        if await stock.mark_supplier_unavailable(product, actor="stock-sync",
                                                 source=stock.CONFIRMED_STOCK_SOURCE):
            counters["marked_out"] += 1
    logger.info("synchro terminée : %(checked)d vérifié(s), %(marked_out)d en rupture, "
                "%(marked_in)d rétabli(s), %(skipped)d ignoré(s), %(pages_ok)d page(s) lue(s), "
                "%(pages_failed)d en échec", counters)
    if observing:
        logger.info("mode observe : %(would_mark_out)d rupture(s) et %(would_mark_in)d retour(s) "
                    "auraient été écrits, aucune écriture effectuée", counters)
    return counters
