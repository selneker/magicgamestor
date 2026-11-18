"""PL-STOCK-1 — disponibilité fournisseur d'un produit (état unique « achetable »).

Ce module centralise l'état de disponibilité fournisseur d'un produit et le calcul qui en découle.
Il ne lit aucune source : c'est `shop2topup_stock` qui relève, et le job de synchro qui applique.

- `supplier_available` : `True`/`False` = dernier état CONSTATÉ, `None`/absent = inconnu. Aucune
  panne fournisseur ne marque tout le catalogue : seul un constat explicite écrit `False`.
- `supplier_available_confirmed` : la rupture vient d'un **relevé fournisseur réussi**
  (`OutOfStock`, `source = CONFIRMED_STOCK_SOURCE`). Elle **n'expire jamais sur durée** : rien ne
  l'efface hors `mark_supplier_available` (relevé `InStock`). Aucune route admin ne la lève encore :
  le jour où elle existera, elle passera par cette même fonction. Une rupture *déduite* (échec de
  livraison, série de remboursements, disparition de la liste d'offres) n'est qu'une présomption :
  elle garde l'expiration `STOCK_STALE_MINUTES` (60 min).
- `supplier_checked_at` : date ISO UTC du dernier constat. Passé `STOCK_STALE_MINUTES`, une rupture
  **non confirmée** redevient « inconnu », donc achetable. Cette date est **rafraîchie à chaque
  constat** (même quand la rupture est déjà connue) : une rupture qui dure ne vieillit donc pas.
  Une rupture **confirmée** l'ignore complètement (règle 1).
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

ADMIN_FIELDS = ("supplier_available", "supplier_checked_at", "manual_unavailable",
                "supplier_available_confirmed",
                "absent_from_supplier_list", "supplier_list_checked_at", "absent_streak",
                "absent_first_at")
REASON_SUPPLIER = "supplier_out_of_stock"
REASON_ADMIN = "admin"
# Source d'une rupture CONFIRMÉE : un relevé fournisseur réussi qui a lu `OutOfStock`.
# Toute autre source (`delivery`, `refund`, `offers_list`) n'est qu'une présomption, et garde
# l'expiration de 60 min.
CONFIRMED_STOCK_SOURCE = "shop2topup"


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
    """État EFFECTIF fournisseur : `False` (rupture) · `True` (disponible) · `None` (inconnu).

    Une rupture **confirmée par relevé** reste `False` quel que soit son âge : rien ne l'efface à
    part `mark_supplier_available` (relevé `InStock`). Une rupture *déduite*, non datée ou plus
    vieille que `stale_minutes()`, vaut « inconnu » : on ne bloque jamais une vente sur une
    information périmée.
    """
    raw = (product or {}).get("supplier_available")
    if raw is True:
        return True
    if raw is not False:
        return None
    if (product or {}).get("supplier_available_confirmed") is True:
        return False
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


def mapping_offer_ids(mapping: dict | None) -> list[str]:
    """Offres fournisseur exigées par un produit (direct ou composé), ids vides ignorés.

    Un `offer_id` null ou vide n'est jamais une absence : il est simplement inexploitable.
    """
    if not mapping:
        return []
    if mapping.get("mode", "direct") == "composite":
        raw = [c.get("offer_id") for c in mapping.get("components") or []]
    else:
        raw = [mapping.get("offer_id")]
    return [str(offer).strip() for offer in raw if str(offer or "").strip()]


def admin_fields(product: dict | None, now: datetime | None = None,
                 refund_counts: dict[str, int] | None = None) -> dict:
    """Champs ajoutés aux réponses ADMIN (état effectif + horodatage + forçage + observation).

    `refund_counts` (offre → clients remboursés) est fourni par l'appelant en une seule requête ;
    sans lui, `refund_count_window` n'est pas inventé et le champ est absent.
    """
    product = product or {}
    fields = {
        "supplier_available": supplier_state(product, now),
        "supplier_checked_at": product.get("supplier_checked_at"),
        "supplier_available_confirmed": bool(product.get("supplier_available_confirmed")),
        "manual_unavailable": bool(product.get("manual_unavailable")),
        # PL-STOCK-2 : observation de la liste fournisseur (`observe` ne bloque jamais la vente).
        "absent_from_supplier_list": bool(product.get("absent_from_supplier_list")),
        "supplier_list_checked_at": product.get("supplier_list_checked_at"),
    }
    if refund_counts is not None:
        fields["refund_count_window"] = max(
            (int(refund_counts.get(offer, 0)) for offer in mapping_offer_ids(product.get("fazercards_mapping"))),
            default=0)
    return fields


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

    La bascule est ATOMIQUE : seule la première (`supplier_available != False`) écrit l'audit et
    alerte l'admin. Une répétition (autre unité, autre commande, passage suivant du relevé)
    **rafraîchit seulement `supplier_checked_at`**, sans nouvelle alerte : c'est ce qui empêche une
    rupture qui dure d'expirer au bout de `STOCK_STALE_MINUTES`.
    `STOCK_SYNC_ENABLED=false` désactive tout marquage automatique.
    Ne lève jamais : l'issue de la livraison ne dépend pas de ce marquage.

    `source` est conservée dans `supplier_available_confirmed` : une rupture issue d'un relevé
    fournisseur réussi (`CONFIRMED_STOCK_SOURCE`) n'expire jamais sur durée. Une présomption déjà
    posée peut donc être **confirmée** plus tard ; une présomption ne dégrade jamais une
    confirmation existante.
    """
    if not sync_enabled():
        return False
    product_id = str((product or {}).get("id") or "").strip()
    if not product_id:
        return False
    confirmed = source == CONFIRMED_STOCK_SOURCE
    stamp = _now().isoformat()
    try:
        transition = await db.products.update_one(
            {"id": product_id, "supplier_available": {"$ne": False}},
            {"$set": {"supplier_available": False, "supplier_checked_at": stamp,
                      "supplier_available_confirmed": confirmed}})
        if transition.modified_count != 1:
            # Déjà en rupture : on ne rafraîchit que la date (et on confirme si le relevé l'a lue).
            refresh = {"supplier_checked_at": stamp}
            if confirmed:
                refresh["supplier_available_confirmed"] = True
            await db.products.update_one(
                {"id": product_id, "supplier_available": False}, {"$set": refresh})
            return False
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Marquage stock impossible (%s)", type(exc).__name__)
        return False
    name = str((product or {}).get("name") or product_id)
    try:
        await audit("product.supplier_unavailable", actor, product_id,
                    {"source": source, "supplier_available": False,
                     "supplier_available_confirmed": confirmed})
        await notifications.notify_stock_unavailable(name, product_id)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Alerte stock non envoyée (%s)", type(exc).__name__)
    return True


async def mark_supplier_available(product: dict | None, *, actor: str | None = None,
                                  source: str = CONFIRMED_STOCK_SOURCE) -> bool:
    """Lève une rupture sur un relevé fournisseur réussi (`InStock`) — règle 1.

    Efface `supplier_available`, `supplier_checked_at` et `supplier_available_confirmed` : le
    produit redevient « inconnu », donc achetable immédiatement, sans attendre l'expiration.
    Transition ATOMIQUE : le filtre ne retient que ce qui est réellement en rupture, donc un
    `InStock` répété n'écrit rien et n'alerte plus. `manual_unavailable` n'est jamais touché : le
    forçage admin reste prioritaire et indépendant.
    `STOCK_SYNC_ENABLED=false` la neutralise aussi, en symétrie du marquage.
    L'alerte `stock_restored` part même si l'admin a forcé l'indisponibilité : le produit reste
    alors non achetable, mais les deux signaux ne sont jamais confondus.
    Ne lève jamais : l'appelant (job de synchro) ne doit pas échouer sur ce marquage.
    """
    if not sync_enabled():
        # Symétrie avec le marquage : le drapeau coupe la synchro dans les deux sens, sinon des
        # ruptures se lèveraient toutes seules alors que plus personne ne les confirme.
        return False
    product_id = str((product or {}).get("id") or "").strip()
    if not product_id:
        return False
    try:
        result = await db.products.update_one(
            {"id": product_id, "supplier_available": False},
            {"$unset": {"supplier_available": "", "supplier_checked_at": "",
                        "supplier_available_confirmed": ""}})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Levée de rupture impossible (%s)", type(exc).__name__)
        return False
    if result.modified_count != 1:
        return False
    name = str((product or {}).get("name") or product_id)
    try:
        await audit("product.supplier_available", actor, product_id,
                    {"source": source, "supplier_available": None})
        await notifications.notify_stock_restored(name, product_id)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Alerte retour stock non envoyée (%s)", type(exc).__name__)
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

    Les ruptures **confirmées** (`supplier_available_confirmed`) sont exclues du balayage : elles
    ne doivent jamais expirer sur durée (règle 1). Seul `mark_supplier_available` les lève.
    """
    moment = now or _now()
    cutoff = (moment - timedelta(minutes=stale_minutes())).isoformat()
    query = {
        "supplier_available": {"$in": [True, False]},
        "supplier_available_confirmed": {"$ne": True},
        "$or": [{"supplier_checked_at": {"$lt": cutoff}},
                {"supplier_checked_at": {"$exists": False}}],
    }
    projection = {"_id": 0, "id": 1, "name": 1, "supplier_available": 1, "manual_unavailable": 1}
    expired = restored = 0
    async for product in db.products.find(query, projection):
        result = await db.products.update_one(
            {"id": product.get("id"), "supplier_available": product.get("supplier_available"),
             "supplier_available_confirmed": {"$ne": True}},
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
