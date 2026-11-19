"""PL-006-T09C-V1 — taux USDT/ariary lu sur P2P.Army, filtré, stocké et surveillé.

POURQUOI `get_p2p_order_book` ET PLUS `get_p2p_prices`
=====================================================
`get_p2p_prices` ne rend, par méthode de paiement, qu'un tableau de prix : aucune
identité de vendeur, aucune limite, aucune qualité. On ne peut donc ni dédoublonner
un vendeur, ni écarter une annonce inutilisable. La documentation expose
`POST /get_p2p_order_book` (§ « P2P Ads (Standard) », `https://p2p.army/en/p2p-api/docs`),
une ligne par annonce avec `price`, `min_fiat`, `max_fiat`, `payment_methods`,
`user_id`, `adv_id`, `user_orders`, `user_rate`, `is_merchant` et `text` : c'est la
seule source qui permette les filtres ci-dessous. Un seul appel sert donc au relevé
et au diagnostic (`scripts/p2p_rate_dump.py`). Cet endpoint n'est pas réservé aux
plans Pro (seul `/history/p2p_prices` l'est, d'après la même page).

SENS « BUY » / « SELL »
=======================
Nous achetons de l'USDT avec des ariary : le prix qui compte est celui qu'un
**acheteur** paie, donc `side=BUY`. Le schéma d'historique fixe `buy` comme
**minimum** et `sell` comme **maximum** ; un minimum n'a de sens que du côté où
l'on achète. Le carnet `BUY` rend les annonces de vente à ce prix.

FILTRES — uniquement des champs documentés
==========================================
`method`    : `payment_methods` contient au moins une méthode de
              `P2P_PAYMENT_METHODS` (défaut `mvola,orange`, sous-chaînes
              insensibles à la casse). Airtel n'est plus retenu par défaut et il
              n'y a **plus de repli** sur toutes les méthodes.
`capacity`  : `min_fiat` ≤ `P2P_REF_AMOUNT_AR` (défaut 200 000) ≤ `max_fiat`.
`quality`   : `user_rate` ≥ `P2P_MIN_COMPLETION_PCT` (défaut 90) et
              `user_orders` ≥ `P2P_MIN_ORDERS` (défaut 50) ; champ absent vaut 0,
              donc l'annonce est écartée faute de preuve.
`duplicate` : une annonce par vendeur (`user_id`, sinon `adv_id`), la moins chère
              gardée. Le dédoublonnage passe **après** les autres filtres : une
              annonce moins chère mais inutilisable ne doit pas faire perdre le
              vendeur.
`price`     : `price` illisible ou ≤ 0 — une ligne inexploitable n'entre pas dans
              la médiane (comptée à part pour que le total reste juste).
`restricted`: **aucun filtre** — la documentation ne publie aucun drapeau de
              restriction (identité, ancienneté, pays, annonce privée ou hors
              ligne) ; seul `text` est du texte libre, donc rien n'est deviné et
              `n_rejected["restricted"]` reste à 0, par transparence.

RÈGLES
======
1. Taux = **médiane des 5 meilleures annonces retenues** ; moins de 3 ⇒ relevé refusé.
2. Relevé refusé, taux hors 1 000–20 000 Ar/USDT, ou écart > 15 % avec le dernier
   bon taux ⇒ le dernier bon taux reste en place, le problème est journalisé.
3. Stockage dans `settings.p2p_rate` — clé **neuve** — avec `n_ads` (retenues) et
   `n_rejected` (par raison). `binance.rate_ar_per_usdt` n'est ni lu ni écrit ici.
4. `sync_rate` est appelé par `order_maintenance.run_all()` : au plus une lecture
   toutes les 30 minutes, inerte sans `P2P_ARMY_API_KEY`, ne lève jamais.
5. Plus de 60 minutes sans relevé valide ⇒ `p2p_rate_stale`, une fois par épisode ;
   le premier relevé valide suivant envoie `p2p_rate_recovered`.
6. Chaque relevé réussi vérifie la marge des six lots (calcul de
   `scripts/shop2topup_margin.py`, réutilisé) et alerte `margin_below_threshold`
   une fois par lot et par épisode sous `MARGIN_ALERT_MIN_PCT` (défaut 0).

La clé est lue uniquement par `os.environ["P2P_ARMY_API_KEY"]` et n'apparaît ni dans
un journal, ni dans un message d'alerte, ni dans une exception.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from statistics import median

import httpx

from core.db import db
from services import notifications
from services.providers import get_provider
from scripts.shop2topup_margin import GAME_ID, build_rows, fetch_prices

logger = logging.getLogger("mgs.p2p_rate")

API_BASE = "https://p2p.army/v1/api"
KEY_ENV = "P2P_ARMY_API_KEY"
MARKET_ENV = "P2P_MARKET"
METHODS_ENV = "P2P_PAYMENT_METHODS"
REF_ENV = "P2P_REF_AMOUNT_AR"
COMPLETION_ENV = "P2P_MIN_COMPLETION_PCT"
ORDERS_ENV = "P2P_MIN_ORDERS"
DEFAULT_MARKET = "binance"
DEFAULT_METHODS = "mvola,orange"
DEFAULT_REF_AMOUNT = "200000"
DEFAULT_MIN_COMPLETION = "90"
DEFAULT_MIN_ORDERS = "50"
FIAT = "MGA"
ASSET = "USDT"
SIDE = "BUY"  # section « acheter de l'USDT » : le prix payé, voir l'en-tête
TIMEOUT_S = 10.0

MIN_ADS = 3
BEST_ADS = 5     # médiane des 5 meilleures annonces retenues
FETCH_ADS = 15   # annonces demandées au carnet (diagnostic inclus)
MIN_RATE = 1_000.0
MAX_RATE = 20_000.0
MAX_DEVIATION_PCT = 15.0
REFRESH_MINUTES = 30
STALE_MINUTES = 60

REASONS = ("method", "capacity", "restricted", "quality", "duplicate", "price")

STORE_KEY = "store"
RATE_FIELD = "p2p_rate"
ALERT_URL = "/admin/catalogue"
MARGIN_ENV = "MARGIN_ALERT_MIN_PCT"


class RateRefused(Exception):
    """Relevé refusé ; `reason` est une catégorie stable, jamais la charge utile."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def api_key() -> str:
    """Clé lue UNIQUEMENT dans l'environnement (`os.environ[...]`), jamais dans un fichier."""
    try:
        return (os.environ[KEY_ENV] or "").strip()
    except KeyError:
        return ""


def configured() -> bool:
    return bool(api_key())


def market_name() -> str:
    return _env(MARKET_ENV) or DEFAULT_MARKET


def _number(name: str, default: str, cast):
    """Variable numérique ; valeur illisible ⇒ défaut documenté."""
    try:
        return cast(os.environ.get(name) or default)
    except (TypeError, ValueError, InvalidOperation):
        return cast(default)


def payment_words() -> tuple[str, ...]:
    """Méthodes utilisables : `P2P_PAYMENT_METHODS`, sous-chaînes insensibles à la casse."""
    raw = os.environ.get(METHODS_ENV) or DEFAULT_METHODS
    words = tuple(part.strip().lower() for part in raw.split(",") if part.strip())
    return words or tuple(DEFAULT_METHODS.split(","))


def ref_amount() -> Decimal:
    """Montant de référence ariary que l'annonce doit pouvoir couvrir."""
    return Decimal(str(_number(REF_ENV, DEFAULT_REF_AMOUNT, float)))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


def _parse_iso(value) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def margin_threshold() -> float:
    """`MARGIN_ALERT_MIN_PCT`, en pourcentage ; une valeur illisible vaut 0."""
    try:
        return float(os.environ.get(MARGIN_ENV, "0"))
    except (TypeError, ValueError):
        return 0.0


def _price(ad: dict) -> Decimal | None:
    """Prix d'annonce (`price`, chaîne) ; `None` s'il est illisible ou nul."""
    try:
        value = Decimal(str(ad.get("price")).strip())
    except (InvalidOperation, ValueError):
        return None
    return value if value > 0 else None


def screen(ads) -> list[tuple[dict, Decimal | None, str | None]]:
    """Une ligne par annonce : (annonce, prix retenu, motif de rejet ou `None`).

    Ordre : prix lisible → méthode → capacité → qualité, puis doublons par vendeur
    (l'annonce la moins chère de chaque vendeur survit). Voir l'en-tête du module
    pour la justification de chaque champ et l'absence de filtre de restriction.
    """
    words = payment_words()
    ref = ref_amount()
    min_pct = _number(COMPLETION_ENV, DEFAULT_MIN_COMPLETION, float)
    min_orders = _number(ORDERS_ENV, DEFAULT_MIN_ORDERS, float)

    def why(ad: dict) -> str | None:
        methods = [str(method).lower() for method in (ad.get("payment_methods") or [])]
        if not any(word in method for method in methods for word in words):
            return "method"
        try:
            low = Decimal(str(ad.get("min_fiat")).strip())
            high = Decimal(str(ad.get("max_fiat")).strip())
        except (InvalidOperation, ValueError):
            return "capacity"
        if not low <= ref <= high:
            return "capacity"
        try:
            completion = float(ad.get("user_rate") or 0)
            orders = float(ad.get("user_orders") or 0)
        except (TypeError, ValueError):
            return "quality"
        return None if completion >= min_pct and orders >= min_orders else "quality"

    rows: list[tuple[dict, Decimal | None, str | None]] = []
    for ad in ads or []:
        if not isinstance(ad, dict):
            continue
        price = _price(ad)
        rows.append((ad, price, "price" if price is None else why(ad)))

    groups: dict[str, list[int]] = {}
    for index, (ad, _price_value, reason) in enumerate(rows):
        if reason is None:
            groups.setdefault(str(ad.get("user_id") or ad.get("adv_id") or f"#{index}"),
                               []).append(index)
    for indexes in groups.values():
        keep = min(indexes, key=lambda index: rows[index][1])
        for index in indexes:
            if index != keep:
                rows[index] = (rows[index][0], None, "duplicate")
    return rows


def counts(rows) -> dict[str, int]:
    """Nombre de rejets par raison ; les cinq motifs de l'énoncé restent à 0 s'ils sont vides."""
    tally = {reason: 0 for reason in REASONS}
    for _ad, _price_value, reason in rows or []:
        if reason:
            tally[reason] += 1
    return tally


async def fetch_ads(*, client: httpx.AsyncClient | None = None,
                    market: str | None = None) -> list[dict]:
    """Annonces brutes du carnet `BUY` (aucun filtre) ; lève `RateRefused` ou le transport."""
    key = api_key()
    if not key:
        raise RateRefused("api_key_missing")
    market = market or market_name()
    owned = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT_S)
    try:
        response = await client.post(
            f"{API_BASE}/get_p2p_order_book",
            headers={"X-APIKEY": key},
            json={"market": market, "fiat": FIAT, "asset": ASSET,
                  "side": SIDE, "limit": FETCH_ADS})
        response.raise_for_status()
        body = response.json()
    finally:
        if owned:
            await client.aclose()
    if not isinstance(body, dict) or int(body.get("status") or 0) != 1:
        raise RateRefused("api_status")
    return [row for row in (body.get("ads") or []) if isinstance(row, dict)]


async def fetch_rate(*, client: httpx.AsyncClient | None = None,
                     market: str | None = None, now: datetime | None = None) -> dict:
    """Un relevé filtré ; lève `RateRefused` (catégorie seule) ou une erreur de transport."""
    market = market or market_name()
    rows = screen(await fetch_ads(client=client, market=market))
    kept = sorted(price for _ad, price, reason in rows if reason is None)
    rejected = counts(rows)
    logger.info("relevé P2P %s : %s annonces retenues, rejets %s", market, len(kept), rejected)
    if len(kept) < MIN_ADS:
        raise RateRefused("not_enough_ads")
    rate = float(median(kept[:BEST_ADS]))
    if not MIN_RATE <= rate <= MAX_RATE:
        raise RateRefused("out_of_range")
    return {"rate": round(rate, 2), "fetched_at": _iso(now or _now()),
            "source": f"p2p_army:{market}:{SIDE}:{'+'.join(payment_words())}",
            "n_ads": len(kept), "n_rejected": rejected, "market": market, "side": SIDE}


def _deviation(rate: float, previous) -> float:
    try:
        previous = float(previous)
    except (TypeError, ValueError):
        return 0.0
    return abs(float(rate) - previous) / previous * 100 if previous > 0 else 0.0


async def stored() -> dict:
    """Réglage `settings.p2p_rate` (dict vide s'il n'existe pas encore)."""
    doc = await db.settings.find_one({"key": STORE_KEY}, {"_id": 0, RATE_FIELD: 1}) or {}
    value = doc.get(RATE_FIELD)
    return dict(value) if isinstance(value, dict) else {}


async def _set(fields: dict) -> None:
    """Écrit des chemins pointés : `p2p_rate` ne remplace jamais le reste du document `store`."""
    await db.settings.update_one({"key": STORE_KEY},
                                 {"$set": {f"{RATE_FIELD}.{key}": value
                                           for key, value in fields.items()}}, upsert=True)


async def _alert(event: str, title: str, body: str) -> None:
    try:
        await notifications.notify_admin(event=event, title=title, body=body, url=ALERT_URL)
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("alerte %s non envoyée (%s)", event, type(exc).__name__)


async def _maybe_stale(saved: dict, moment: datetime) -> None:
    """Alerte `p2p_rate_stale` une seule fois par épisode (drapeau en base, écrit avant l'envoi)."""
    fetched = _parse_iso(saved.get("fetched_at"))
    if fetched is None or moment - fetched <= timedelta(minutes=STALE_MINUTES):
        return
    if saved.get("stale_alerted"):
        return
    await _alert("p2p_rate_stale", "Taux USDT/ariary périmé",
                 f"Aucun relevé valide depuis plus de {STALE_MINUTES} minutes : le taux de "
                 "conversion USDT → ariary n'est plus à jour.")
    try:
        await _set({"stale_alerted": True})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("drapeau p2p_rate_stale non enregistré (%s)", type(exc).__name__)


async def _check_margin(info: dict, saved: dict, provider=None) -> None:
    """Marge des six lots au taux retenu ; une alerte par lot et par épisode sous le seuil."""
    try:
        prices = await fetch_prices(provider or get_provider(GAME_ID))
        rows = build_rows(prices, Decimal(str(info["rate"])), Decimal(0))
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("catalogue illisible (%s) : marge non vérifiée", type(exc).__name__)
        return
    threshold = Decimal(str(margin_threshold()))
    below = {row["sku"]: row for row in rows
             if row["margin_pct"] is not None and row["margin_pct"] < threshold}
    already = {str(sku) for sku in (saved.get("margin_alerted") or [])}
    for sku, row in below.items():
        if sku in already:
            continue
        await _alert("margin_below_threshold", "Marge sous le seuil",
                     f"Lot {row['lot']} (SKU {sku}) : marge {row['margin_pct']} % au taux de "
                     f"{info['rate']:.2f} Ar/USDT.")
    try:
        await _set({"margin_alerted": sorted(below)})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("drapeau margin_alerted non enregistré (%s)", type(exc).__name__)


async def sync_rate(now: datetime | None = None, client: httpx.AsyncClient | None = None,
                    provider=None) -> dict:
    """Un passage de maintenance : rafraîchit le taux au plus toutes les 30 min, alerte, ne lève jamais."""
    if not configured():
        return {"p2p_rate": "disabled"}
    moment = now or _now()
    try:
        saved = await stored()
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("réglage p2p_rate illisible (%s)", type(exc).__name__)
        return {"p2p_rate": "store_error"}

    touched = [value for value in (_parse_iso(saved.get("fetched_at")),
                                   _parse_iso(saved.get("last_attempt_at"))) if value]
    if touched and moment - max(touched) < timedelta(minutes=REFRESH_MINUTES):
        return {"p2p_rate": "fresh"}
    try:
        await _set({"last_attempt_at": _iso(moment)})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("horodatage du relevé non enregistré (%s)", type(exc).__name__)

    try:
        info = await fetch_rate(client=client, now=moment)
    except RateRefused as exc:
        logger.warning("relevé P2P refusé (%s) : dernier taux conservé", exc.reason)
        await _maybe_stale(saved, moment)
        return {"p2p_rate": "refused"}
    except Exception as exc:  # transport, JSON, HTTP : jamais propagé par le cron
        logger.warning("relevé P2P en échec (%s) : dernier taux conservé", type(exc).__name__)
        await _maybe_stale(saved, moment)
        return {"p2p_rate": "error"}

    previous = saved.get("rate")
    if previous and _deviation(info["rate"], previous) > MAX_DEVIATION_PCT:
        logger.warning("écart de %.1f %% avec le dernier taux (%s → %s) : relevé refusé",
                       _deviation(info["rate"], previous), previous, info["rate"])
        await _maybe_stale(saved, moment)
        return {"p2p_rate": "refused"}

    try:
        await _set({key: info[key] for key in
                    ("rate", "fetched_at", "source", "n_ads", "n_rejected", "market", "side")})
    except Exception as exc:  # type: ignore[attr-defined]
        logger.warning("taux P2P non enregistré (%s)", type(exc).__name__)
        return {"p2p_rate": "store_error"}

    if saved.get("stale_alerted"):
        await _alert("p2p_rate_recovered", "Taux USDT/ariary rétabli",
                     f"Un relevé valide a été enregistré : 1 USDT = {info['rate']:.2f} ariary.")
        try:
            await _set({"stale_alerted": False})
        except Exception as exc:  # type: ignore[attr-defined]
            logger.warning("drapeau p2p_rate_recovered non enregistré (%s)", type(exc).__name__)

    await _check_margin(info, saved, provider)
    return {"p2p_rate": "fetched"}
