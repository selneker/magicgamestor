"""PL-STOCK-2 — signaux de rupture observables : remboursement fournisseur et liste des offres.

Le fournisseur n'expose aucun stock : une rupture se constate APRÈS coup, par deux signaux
indirects. Chacun a sa règle prudente, parce qu'un signal isolé ne prouve jamais une rupture.

1. Remboursement. Le fournisseur accepte la commande puis la rembourse (`processing` →
   `refund`). Un remboursement isolé peut venir d'un identifiant joueur refusé, d'un solde
   revendeur insuffisant, etc. Le produit n'est mis hors vente qu'à partir de
   `STOCK_REFUND_THRESHOLD` remboursements (défaut 2) de clients DIFFÉRENTS pour la même offre,
   dans `STOCK_REFUND_WINDOW_MINUTES` (défaut 120), en excluant les motifs classés « non liés au
   stock ». Un motif inconnu compte (le fournisseur ne documente aucun champ de motif).
2. Liste des offres (`GET /topups/offers`). `STOCK_OFFERS_SYNC_MODE` = `off` | `observe` (défaut)
   | `enforce`. En `observe`, rien n'est bloqué : l'état admin est renseigné et alerté une fois
   par transition. En `enforce`, une absence ne compte qu'après 2 relevés valides espacés d'au
   moins 5 minutes, avec une liste non vide et moins de 50 % des offres disparues d'un coup.

Toute erreur réseau, 401/403/503, timeout ou réponse inexploitable laisse les états intacts.
Aucune fonction de ce module ne lève : un relevé ne doit jamais casser une commande ni le cron.
Le nom du fournisseur n'apparaît ni dans les réponses publiques ni dans les alertes.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

from core.audit import audit
from core.db import db
from services import fazercards, notifications, stock

logger = logging.getLogger("mgs.stock")

DEFAULT_REFUND_THRESHOLD = 2
MAX_REFUND_THRESHOLD = 20
DEFAULT_REFUND_WINDOW_MINUTES = 120
MAX_REFUND_WINDOW_MINUTES = 7 * 24 * 60
DEFAULT_OFFERS_MODE = "observe"
OFFERS_MODES = ("off", "observe", "enforce")
# Deux relevés d'absence doivent être espacés d'au moins 5 minutes avant tout passage hors vente.
MIN_ABSENCE_MINUTES = 5
# Une disparition d'au moins la moitié des offres d'une catégorie est jugée suspecte (relevé ignoré).
SUSPECT_DROP_RATIO = 0.5
REASON_MAX_CHARS = 200

# Motifs de remboursement NON liés au stock : ils ne comptent jamais dans la règle 2.
NON_STOCK_REASON_WORDS = (
    "insufficient balance", "balance insufficient", "solde insuffisant", "solde revendeur", "solde",
    "invalid player", "player not found", "player invalid", "unknown player",
    "invalid id", "id not found", "identifiant invalide", "identifiant introuvable", "identifiant refusé",
    "api key", "unauthorized", "forbidden", "invalid token", "subscription", "abonnement",
    "timeout", "timed out", "network", "connection", "unreachable", "injoignable", "rate limit",
)

# Champs texte réellement lus dans la réponse fournisseur (jamais le payload entier).
REASON_KEYS = ("refund_reason", "reason", "failure_reason", "error", "message", "note", "description")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value) -> datetime | None:
    """Date ISO (chaîne ou datetime) en UTC. Illisible ou absente ⇒ `None`."""
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


def refund_threshold() -> int:
    """`STOCK_REFUND_THRESHOLD` (défaut 2, borné 1..20) : nombre de clients remboursés distincts."""
    try:
        value = int(os.environ.get("STOCK_REFUND_THRESHOLD", str(DEFAULT_REFUND_THRESHOLD)))
    except (TypeError, ValueError):
        value = DEFAULT_REFUND_THRESHOLD
    return max(1, min(value, MAX_REFUND_THRESHOLD))


def refund_window_minutes() -> int:
    """`STOCK_REFUND_WINDOW_MINUTES` (défaut 120, borné 1 min..7 j)."""
    try:
        value = int(os.environ.get("STOCK_REFUND_WINDOW_MINUTES", str(DEFAULT_REFUND_WINDOW_MINUTES)))
    except (TypeError, ValueError):
        value = DEFAULT_REFUND_WINDOW_MINUTES
    return max(1, min(value, MAX_REFUND_WINDOW_MINUTES))


def offers_sync_mode() -> str:
    """`STOCK_OFFERS_SYNC_MODE` : `off`, `observe` (défaut) ou `enforce`. Inconnu ⇒ `observe`."""
    raw = (os.environ.get("STOCK_OFFERS_SYNC_MODE") or "").strip().lower()
    return raw if raw in OFFERS_MODES else DEFAULT_OFFERS_MODE


def customer_key(order: dict | None) -> str | None:
    """Identité de CLIENT pour compter les remboursements distincts, jamais une identité joueur.

    Commande sans compte et sans email : inconnue (`None`). Un remboursement non attribuable ne
    peut pas prouver deux clients différents : il est donc exclu du compte (jamais de blocage).
    """
    order = order or {}
    user_id = str(order.get("user_id") or "").strip()
    if user_id:
        return f"user:{user_id}"
    email = str(order.get("email") or "").strip().lower()
    if email:
        return f"email:{email}"
    return None


def _text(value) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("reason", "message", "code", "error", "description"):
            found = _text(value.get(key))
            if found:
                return found
    return ""


def extract_reason(raw: dict | None, fallback: str | None = None) -> str:
    """Motif brut du remboursement, tronqué. Seuls des champs texte connus sont lus."""
    if isinstance(raw, dict):
        for key in REASON_KEYS:
            found = _text(raw.get(key))
            if found:
                return found[:REASON_MAX_CHARS]
        found = _text(raw.get("refund"))
        if found:
            return found[:REASON_MAX_CHARS]
    return str(fallback or "").strip()[:REASON_MAX_CHARS]


def is_non_stock_reason(reason: str | None) -> bool:
    """Motif classé « non lié au stock » (solde, identifiant joueur, clé API, réseau) ?

    Un motif inconnu ou vide n'est PAS exclu : il compte, comme demandé (le fournisseur ne
    documente aucun champ de motif).
    """
    text = str(reason or "").strip().lower()
    if not text:
        return False
    return any(word in text for word in NON_STOCK_REASON_WORDS)


async def refund_customer_count(offer_id: str, now: datetime | None = None) -> int:
    """Clients DISTINCTS remboursés pour cette offre dans la fenêtre, motifs stock uniquement."""
    cutoff = ((now or _now()) - timedelta(minutes=refund_window_minutes())).isoformat()
    seen: set[str] = set()
    async for row in db.stock_refunds.find(
            {"offer_id": offer_id, "at": {"$gte": cutoff}, "customer_key": {"$ne": None}},
            {"_id": 0, "customer_key": 1, "raw_reason": 1}):
        key = str(row.get("customer_key") or "")
        if not key or is_non_stock_reason(row.get("raw_reason")):
            continue
        seen.add(key)
    return len(seen)


async def refund_window_counts(now: datetime | None = None) -> dict[str, int]:
    """Comptes par offre pour l'admin (une seule requête, aucun N+1)."""
    cutoff = ((now or _now()) - timedelta(minutes=refund_window_minutes())).isoformat()
    per_offer: dict[str, set] = {}
    async for row in db.stock_refunds.find(
            {"at": {"$gte": cutoff}, "customer_key": {"$ne": None}},
            {"_id": 0, "offer_id": 1, "customer_key": 1, "raw_reason": 1}):
        key = str(row.get("customer_key") or "")
        offer = str(row.get("offer_id") or "")
        if not key or not offer or is_non_stock_reason(row.get("raw_reason")):
            continue
        per_offer.setdefault(offer, set()).add(key)
    return {offer: len(keys) for offer, keys in per_offer.items()}


async def products_for_offer(offer_id: str) -> list[dict]:
    """Produits dont le mapping exige cette offre (direct ou composé)."""
    found = []
    projection = {"_id": 0, "id": 1, "name": 1, "fazercards_mapping": 1}
    async for product in db.products.find({"fazercards_mapping": {"$exists": True}}, projection):
        if offer_id in stock.mapping_offer_ids(product.get("fazercards_mapping")):
            found.append(product)
    return found


async def record_supplier_refund(*, order: dict | None, line_index: int, offer_id: str | None,
                                 provider_order_id: str | None, raw: dict | None = None,
                                 fallback_reason: str | None = None, source: str,
                                 actor: str | None = None) -> dict:
    """Mécanisme 1 — enregistre UN remboursement constaté puis applique la règle prudente.

    L'écriture est idempotente : `_id` = commande fournisseur + offre, donc un même remboursement
    rejoué (sondage + webhook) ne compte qu'une fois. Ne change jamais le flux de commande et ne
    lève jamais.
    """
    try:
        items = (order or {}).get("items") or []
        item = items[line_index] if 0 <= line_index < len(items) else {}
        product_id = str(item.get("product_id") or "").strip()
        offer = str(offer_id or "").strip()
        if not product_id or not offer:
            return {"recorded": False, "customers": 0, "marked": 0}
        key = f"{provider_order_id or (order or {}).get('id') or ''}:{offer}"
        try:
            await db.stock_refunds.insert_one({
                "_id": key, "product_id": product_id, "offer_id": offer,
                "order_id": (order or {}).get("id"), "customer_key": customer_key(order),
                "at": _now().isoformat(),
                "raw_reason": extract_reason(raw, fallback_reason),
                "source": source, "actor": actor,
            })
        except DuplicateKeyError:
            return {"recorded": False, "customers": 0, "marked": 0}
        customers = await refund_customer_count(offer)
        if customers < refund_threshold():
            return {"recorded": True, "customers": customers, "marked": 0}
        marked = 0
        for product in await products_for_offer(offer):
            if await stock.mark_supplier_unavailable(product, actor=actor or "stock-refund",
                                                     source="refund"):
                marked += 1
        return {"recorded": True, "customers": customers, "marked": marked}
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Signal de remboursement ignoré (%s)", type(exc).__name__)
        return {"recorded": False, "customers": 0, "marked": 0}


def _spaced(first_at, moment: datetime) -> bool:
    """Deux relevés d'absence doivent être séparés d'au moins `MIN_ABSENCE_MINUTES`."""
    start = _parse(first_at)
    return start is not None and moment - start >= timedelta(minutes=MIN_ABSENCE_MINUTES)


async def _mapped_products_by_category() -> dict[str, list[dict]]:
    """Produits mappés, groupés par catégorie fournisseur (une seule lecture)."""
    grouped: dict[str, list[dict]] = {}
    projection = {"_id": 0, "id": 1, "name": 1, "fazercards_mapping": 1}
    async for product in db.products.find({"fazercards_mapping": {"$exists": True}}, projection):
        mapping = product.get("fazercards_mapping") or {}
        category = str(mapping.get("category_id") or "").strip()
        if category:
            grouped.setdefault(category, []).append(product)
    return grouped


async def _suspect_drop(category_id: str, previous: dict | None, present: list[str],
                        moment: datetime) -> bool:
    """Relevé suspect (≥ 50 % des offres disparues d'un coup) : rien n'est appliqué, alerte une fois."""
    known = [str(o) for o in (previous or {}).get("offer_ids") or []]
    if len(known) < 2:
        return False
    disappeared = len(set(known) - set(present))
    if disappeared < len(known) * SUSPECT_DROP_RATIO:
        return False
    if not (previous or {}).get("suspect_alerted"):
        await db.stock_offer_checks.update_one(
            {"_id": category_id},
            {"$set": {"suspect_alerted": True, "suspect_at": moment.isoformat()}}, upsert=True)
        try:
            await notifications.notify_stock_list_suspect()
        except Exception as exc:  # type: ignore[attr-defined]
            logger.warning("Alerte de relevé suspect non envoyée (%s)", type(exc).__name__)
    return True


async def _apply_listing(product: dict, present: list[str], moment: datetime, mode: str) -> str:
    """État de listing d'UN produit. Retourne `present`, `absent` ou `marked` (hors vente)."""
    mapped = stock.mapping_offer_ids(product.get("fazercards_mapping"))
    # Aucune offre exploitable (offer_id null) : « inconnu », jamais « absent ».
    absent = bool(mapped) and any(offer not in present for offer in mapped)
    was_absent = bool(product.get("absent_from_supplier_list"))
    first_at = moment.isoformat() if absent and not was_absent else product.get("absent_first_at")
    streak = (int(product.get("absent_streak") or 0) + 1) if absent else 0
    await db.products.update_one({"id": product.get("id")}, {"$set": {
        "absent_from_supplier_list": absent,
        "supplier_list_checked_at": moment.isoformat(),
        "absent_streak": streak,
        "absent_first_at": first_at if absent else None,
    }})
    if absent and not was_absent:
        await audit("product.supplier_list_changed", "stock-sync", product.get("id"),
                    {"absent": True, "source": "offers_list"})
        if mode == "observe":
            try:
                await notifications.notify_stock_list_absent(
                    str(product.get("name") or product.get("id")), str(product.get("id") or ""))
            except Exception as exc:  # type: ignore[attr-defined]
                logger.warning("Alerte de produit absent non envoyée (%s)", type(exc).__name__)
    elif not absent and was_absent:
        await audit("product.supplier_list_changed", "stock-sync", product.get("id"),
                    {"absent": False, "source": "offers_list"})
    if not absent:
        return "present"
    if mode != "enforce" or streak < 2 or not _spaced(first_at, moment):
        return "absent"
    marked = await stock.mark_supplier_unavailable(
        {"id": product.get("id"), "name": product.get("name")},
        actor="stock-sync", source="offers_list")
    return "marked" if marked else "absent"


async def sync_offers(now: datetime | None = None) -> dict:
    """Mécanisme 3 — relevé de la liste des offres des catégories réellement mappées.

    Branché sur la route cron EXISTANTE (aucune nouvelle route). Ne lève jamais : une panne
    fournisseur laisse tous les états en place.
    """
    counters = {"offers_checked": 0, "offers_absent": 0, "offers_marked": 0, "offers_suspect": 0}
    mode = offers_sync_mode()
    if mode == "off":
        return counters
    moment = now or _now()
    try:
        grouped = await _mapped_products_by_category()
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("Relevé des offres impossible (%s)", type(exc).__name__)
        return counters
    for category_id, products in grouped.items():
        try:
            data = await fazercards.pubg_offers_fresh(category_id)
        except Exception as exc:  # réseau, 401/403/503, timeout, réponse invalide : rien ne change
            logger.warning("Relevé des offres ignoré (%s)", type(exc).__name__)
            continue
        present = [str(o.get("offer_id")) for o in (data or {}).get("offers") or []
                   if str(o.get("offer_id") or "").strip()]
        if not present:  # liste vide : réponse inexploitable, on ne touche à rien
            continue
        counters["offers_checked"] += 1
        previous = await db.stock_offer_checks.find_one({"_id": category_id})
        if await _suspect_drop(category_id, previous, present, moment):
            counters["offers_suspect"] += 1
            continue
        await db.stock_offer_checks.update_one(
            {"_id": category_id},
            {"$set": {"at": moment.isoformat(), "offer_ids": present, "suspect_alerted": False}},
            upsert=True)
        for product in products:
            outcome = await _apply_listing(product, present, moment, mode)
            if outcome != "present":
                counters["offers_absent"] += 1
            if outcome == "marked":
                counters["offers_marked"] += 1
    return counters
