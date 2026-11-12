"""PL-STOCK-1 — disponibilité fournisseur d'un produit (état unique « achetable »).

Le fournisseur de cartes n'expose AUCUN champ de stock dans son catalogue (voir le rapport du lot) :
l'indisponibilité ne peut donc pas être lue à la source. Ce module centralise les deux signaux
réellement observables et le calcul qui en découle :

- `supplier_available` : `True`/`False` = dernier état CONSTATÉ (échec de livraison pour rupture),
  `None`/absent = inconnu. Aucune panne fournisseur ne marque tout le catalogue : seul un échec de
  livraison explicitement classé « rupture » écrit `False`.
- `supplier_checked_at` : date ISO UTC du constat. Passé `STOCK_STALE_MINUTES` (60 par défaut), un
  état `False` n'est plus opposé au client : il redevient « inconnu », donc achetable. Sans source
  de stock, c'est ce délai qui assure le retour automatique à la vente (mécanisme H) ; un nouveau
  échec le re-bloquera immédiatement.
- `manual_unavailable` : forçage admin, prioritaire et SANS expiration. Il ne touche jamais
  `supplier_available`.

Une seule fonction décide de l'achat (`purchasable`) ; toutes les routes l'utilisent. Le nom du
fournisseur n'apparaît ni dans les réponses publiques ni dans les alertes admin.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from core.audit import audit
from core.db import db
from services import notifications
from services.fzr_mapping import mapping_ok
from services.providers.errors import ProviderInsufficientBalanceError

logger = logging.getLogger("mgs.stock")

DEFAULT_STALE_MINUTES = 60
MAX_STALE_MINUTES = 7 * 24 * 60

# Codes d'erreur fournisseur reconnus comme une rupture de stock (jamais un solde insuffisant :
# c'est un problème de compte revendeur, pas de stock, et il ne doit pas bloquer le catalogue).
STOCK_ERROR_CODES = frozenset({
    "out_of_stock", "outofstock", "out-of-stock", "sold_out", "soldout", "no_stock",
    "insufficient_stock", "stock_insufficient", "stock_unavailable", "unavailable_stock",
})
# Phrases de stock acceptées dans le message d'erreur. Volontairement étroites : « indisponible »
# seul ou « balance » ne suffisent jamais (le fournisseur les emploie aussi pour ses pannes).
STOCK_ERROR_WORDS = (
    "out of stock", "out-of-stock", "sold out", "sold_out", "no stock", "not enough stock",
    "insufficient stock", "stock is empty", "stock empty", "stock unavailable", "stock exhausted",
    "rupture de stock", "rupture stock", "stock épuisé", "stock epuise",
)

ADMIN_FIELDS = ("supplier_available", "supplier_checked_at", "manual_unavailable")
REASON_SUPPLIER = "supplier_out_of_stock"
REASON_ADMIN = "admin"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value) -> datetime | None:
    """Date ISO (chaîne ou datetime) en UTC. Illisible ou absente ⇒ `None` (état non daté)."""
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and value.strip():
        try:
            moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def sync_enabled() -> bool:
    """`STOCK_SYNC_ENABLED` (défaut vrai) : autorise le marquage AUTOMATIQUE sur échec de livraison."""
    raw = (os.environ.get("STOCK_SYNC_ENABLED") or "").strip().lower()
    return raw in ("", "1", "true", "yes", "on")


def stale_minutes() -> int:
    """Durée de validité d'un état `False` (`STOCK_STALE_MINUTES`, 60 par défaut, bornée)."""
    try:
        value = int(os.environ.get("STOCK_STALE_MINUTES", str(DEFAULT_STALE_MINUTES)))
    except (TypeError, ValueError):
        value = DEFAULT_STALE_MINUTES
    return max(1, min(value, MAX_STALE_MINUTES))


def supplier_state(product: dict | None, now: datetime | None = None) -> bool | None:
    """État EFFECTIF fournisseur : `False` (rupture fraîche) · `True` (disponible) · `None` (inconnu).

    Un `False` non daté ou plus vieux que `stale_minutes()` vaut « inconnu » : on ne bloque jamais
    une vente sur une information périmée.
    """
    raw = (product or {}).get("supplier_available")
    if raw is True:
        return True
    if raw is not False:
        return None
    checked = _parse((product or {}).get("supplier_checked_at"))
    if checked is None:
        return None
    if (now or _now()) - checked > timedelta(minutes=stale_minutes()):
        return None
    return False


def unavailable_reason(product: dict | None, now: datetime | None = None) -> str | None:
    """Motif court de non-achat : `admin` (prioritaire) · `supplier_out_of_stock` · `None`.

    Un mapping fournisseur manquant n'est PAS un motif de cet enum : il garde son message
    existant (`fzr_mapping.purchase_blocked`) et n'apparaît pas dans ce champ.
    """
    if (product or {}).get("manual_unavailable") is True:
        return REASON_ADMIN
    if supplier_state(product, now) is False:
        return REASON_SUPPLIER
    return None


def purchasable(product: dict | None, now: datetime | None = None) -> bool:
    """DÉCISION UNIQUE d'achat, utilisée par le catalogue et la création de commande.

    Un produit est achetable si : pas de forçage admin, pas de rupture fournisseur fraîche, et
    mapping fournisseur valide quand le produit l'exige (garde historique conservée).
    """
    product = product or {}
    if product.get("manual_unavailable") is True:
        return False
    if supplier_state(product, now) is False:
        return False
    if product.get("requires_mapping") and not mapping_ok(product.get("fazercards_mapping")):
        return False
    return True


def public_fields(product: dict | None, now: datetime | None = None) -> dict:
    """Champs ajoutés aux réponses PUBLIQUES (aucun détail fournisseur, aucun nom)."""
    return {"purchasable": purchasable(product, now),
            "unavailable_reason": unavailable_reason(product, now)}


def admin_fields(product: dict | None, now: datetime | None = None) -> dict:
    """Champs ajoutés aux réponses ADMIN (état effectif + horodatage + forçage)."""
    product = product or {}
    return {"supplier_available": supplier_state(product, now),
            "supplier_checked_at": product.get("supplier_checked_at"),
            "manual_unavailable": bool(product.get("manual_unavailable"))}


def is_out_of_stock_error(exc: BaseException) -> bool:
    """Classe CONSERVATRICE d'une erreur de commande fournisseur : rupture de stock ou non.

    Un solde revendeur insuffisant n'est jamais une rupture. Un code explicite prime sur le
    message ; à défaut, seules les phrases de stock listées ci-dessus sont reconnues.
    """
    if isinstance(exc, ProviderInsufficientBalanceError):
        return False
    code = str(getattr(exc, "code", "") or "").strip().lower()
    if code:
        if code in STOCK_ERROR_CODES or "stock" in code or "sold" in code:
            return True
    message = str(getattr(exc, "error", None) or getattr(exc, "message", "") or exc).lower()
    return any(word in message for word in STOCK_ERROR_WORDS)


async def mark_supplier_unavailable(product: dict | None, *, actor: str | None = None,
                                    source: str = "delivery") -> bool:
    """Mécanisme C — marque immédiatement le produit indisponible après une rupture constatée.

    Transition ATOMIQUE : seule la première bascule (`supplier_available != False`) modifie le
    document, écrit l'audit et alerte l'admin. Une répétition (autre unité, autre commande) est un
    no-op silencieux. `STOCK_SYNC_ENABLED=false` désactive tout marquage automatique.
    Ne lève jamais : l'issue de la livraison ne dépend pas de ce marquage.
    """
    if not sync_enabled():
        return False
    product_id = str((product or {}).get("id") or "").strip()
    if not product_id:
        return False
    stamp = _now().isoformat()
    try:
        result = await db.products.update_one(
            {"id": product_id, "supplier_available": {"$ne": False}},
            {"$set": {"supplier_available": False, "supplier_checked_at": stamp}})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Marquage stock impossible (%s)", type(exc).__name__)
        return False
    if result.modified_count != 1:
        return False
    name = str((product or {}).get("name") or product_id)
    try:
        await audit("product.supplier_unavailable", actor, product_id,
                    {"source": source, "supplier_available": False})
        await notifications.notify_stock_unavailable(name, product_id)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Alerte stock non envoyée (%s)", type(exc).__name__)
    return True


async def set_manual_unavailable(product_id: str, value: bool, *, actor: str | None = None) -> dict | None:
    """Mécanisme D — forçage admin, indépendant du fournisseur. Retourne le produit ou `None`.

    Retirer le forçage ne touche JAMAIS `supplier_available` (les deux signaux restent distincts).
    Une alerte n'est pas envoyée : l'admin est devant son écran (même règle que les sources
    internes de paiement).
    """
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        return None
    previous = bool(existing.get("manual_unavailable"))
    if previous == bool(value):
        return existing
    await db.products.update_one({"id": product_id}, {"$set": {"manual_unavailable": bool(value)}})
    await audit("product.availability_set", actor, product_id,
                {"manual_unavailable": bool(value), "previous": previous})
    return await db.products.find_one({"id": product_id}, {"_id": 0})


async def expire_stale_states(now: datetime | None = None) -> dict:
    """Mécanisme B/H — remet à « inconnu » les états fournisseur périmés (balayage cron).

    Idempotent : chaque document n'est basculé qu'une fois (filtre sur l'état courant), donc une
    alerte `stock_restored` n'est émise qu'à la transition réelle. Un produit encore forcé par
    l'admin est bien remis à « inconnu » mais n'alerte pas (il reste indisponible, rien ne change
    pour le client).
    """
    moment = now or _now()
    cutoff = (moment - timedelta(minutes=stale_minutes())).isoformat()
    query = {
        "supplier_available": {"$in": [True, False]},
        "$or": [{"supplier_checked_at": {"$lt": cutoff}},
                {"supplier_checked_at": {"$exists": False}}],
    }
    projection = {"_id": 0, "id": 1, "name": 1, "supplier_available": 1, "manual_unavailable": 1}
    expired = restored = 0
    async for product in db.products.find(query, projection):
        result = await db.products.update_one(
            {"id": product.get("id"), "supplier_available": product.get("supplier_available")},
            {"$set": {"supplier_available": None, "supplier_checked_at": moment.isoformat()}})
        if result.modified_count != 1:
            continue
        expired += 1
        if product.get("supplier_available") is False and product.get("manual_unavailable") is not True:
            restored += 1
            name = str(product.get("name") or product.get("id"))
            try:
                await notifications.notify_stock_restored(name, str(product.get("id") or ""))
            except Exception as exc:  # type: ignore[attr-defined]
                logger.warning("Alerte retour stock non envoyée (%s)", type(exc).__name__)
    return {"stock_expired": expired, "stock_restored": restored}
