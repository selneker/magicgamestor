"""PL-006-T09B-V1 — taux USDT/ariary lu sur P2P.Army, stocké et surveillé.

SENS « BUY » / « SELL » — décision et preuve
============================================
Nous achetons de l'USDT avec des ariary : le prix qui compte est celui qu'un **acheteur** paie,
donc la section `BUY`. La documentation P2P.Army (`https://p2p.army/en/p2p-api/docs`) ne définit
pas ces deux mots en une phrase, mais son schéma d'historique les fixe : `buy` y est le
**minimum** (« Minimum BUY price ») et `sell` le **maximum** (« Maximum SELL price »). Un minimum
n'a de sens que du côté où l'on achète : `BUY` porte donc les offres de vente (le prix payé par
l'acheteur), `SELL` les offres d'achat. C'est aussi la convention des places P2P (onglet « Acheter »).
Risque assumé et vérifiable au premier relevé : comparer la valeur rendue à celle de l'onglet
« Acheter » de l'application ; voir le rapport T09B.

SOURCE ET FORME (documentation, aucune valeur inventée)
=======================================================
`POST https://p2p.army/v1/api/get_p2p_prices`, en-tête `X-APIKEY`, corps
`{"market", "fiat", "asset", "limit"}` ; réponse `{"status": 1, "prices": [{"payment_method",
"prices_BUY": ["…"], "prices_SELL": ["…"], …}]}`. Les annonces des opérateurs MVola / Orange
Money / Airtel Money sont reconnues par leur code `payment_method` ; si ce filtre ne laisse pas
assez d'annonces, on retombe sur toutes les méthodes (le `source` enregistré le dit).

RÈGLES
======
1. Taux = **médiane des 5 meilleures annonces** `BUY` ; moins de 3 annonces valides ⇒ relevé refusé.
2. Relevé refusé, taux hors 1 000–20 000 Ar/USDT, ou écart > 15 % avec le dernier bon taux ⇒ le
   dernier bon taux reste en place, le problème est journalisé (jamais d'alerte pour un refus).
3. Stockage dans `settings.p2p_rate` — clé **neuve**. `binance.rate_ar_per_usdt` n'est ni lu ni
   écrit ici (il sert aux paiements crypto, `routers/crypto.py:27`).
4. `sync_rate` est appelé par `order_maintenance.run_all()` : au plus une lecture toutes les
   30 minutes, inerte sans `P2P_ARMY_API_KEY`, ne lève jamais.
5. Plus de 60 minutes sans relevé valide ⇒ `p2p_rate_stale`, **une fois par épisode** ; le premier
   relevé valide suivant envoie `p2p_rate_recovered`.
6. Chaque relevé réussi vérifie la marge des six lots (même calcul que
   `scripts/shop2topup_margin.py`, réutilisé) et alerte `margin_below_threshold` **une fois par lot
   et par épisode** si la marge descend sous `MARGIN_ALERT_MIN_PCT` (défaut 0). Aucun prix n'est
   modifié, aucun produit désactivé.

La clé est lue uniquement par `os.environ["P2P_ARMY_API_KEY"]` et n'apparaît ni dans un journal,
ni dans un message d'alerte, ni dans une exception.
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
DEFAULT_MARKET = "binance"
FIAT = "MGA"
ASSET = "USDT"
SIDE = "BUY"  # section « acheter de l'USDT » : le prix payé, voir l'en-tête
TIMEOUT_S = 10.0

MIN_ADS = 3
TOP_ADS = 5
MIN_RATE = 1_000.0
MAX_RATE = 20_000.0
MAX_DEVIATION_PCT = 15.0
REFRESH_MINUTES = 30
STALE_MINUTES = 60

STORE_KEY = "store"
RATE_FIELD = "p2p_rate"
ALERT_URL = "/admin/catalogue"
PAYMENT_WORDS = ("mvola", "orange", "airtel")
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


def _prices(rows) -> list[Decimal]:
    """Prix `BUY` valides (strictement positifs) de toutes les lignes fournies."""
    found: list[Decimal] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        for raw in row.get("prices_BUY") or []:
            try:
                value = Decimal(str(raw).strip())
            except (InvalidOperation, ValueError):
                continue
            if value > 0:
                found.append(value)
    return found


def _wanted(row) -> bool:
    method = str((row or {}).get("payment_method") or "").lower()
    return any(word in method for word in PAYMENT_WORDS)


async def fetch_rate(*, client: httpx.AsyncClient | None = None,
                     market: str | None = None, now: datetime | None = None) -> dict:
    """Un relevé P2P.Army ; lève `RateRefused` (catégorie seule) ou une erreur de transport."""
    key = api_key()
    if not key:
        raise RateRefused("api_key_missing")
    market = market or market_name()
    owned = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT_S)
    try:
        response = await client.post(
            f"{API_BASE}/get_p2p_prices",
            headers={"X-APIKEY": key},
            json={"market": market, "fiat": FIAT, "asset": ASSET, "limit": TOP_ADS})
        response.raise_for_status()
        body = response.json()
    finally:
        if owned:
            await client.aclose()
    if not isinstance(body, dict) or int(body.get("status") or 0) != 1:
        raise RateRefused("api_status")
    rows = body.get("prices") or []
    prices = _prices([row for row in rows if _wanted(row)])
    mode = "+".join(PAYMENT_WORDS)
    if len(prices) < MIN_ADS:  # filtre opérateur insuffisant : toutes les méthodes, en le disant
        prices = _prices(rows)
        mode = "all"
    if len(prices) < MIN_ADS:
        raise RateRefused("not_enough_ads")
    best = sorted(prices)[:TOP_ADS]
    rate = float(median(best))
    if not MIN_RATE <= rate <= MAX_RATE:
        raise RateRefused("out_of_range")
    return {"rate": round(rate, 2), "fetched_at": _iso(now or _now()),
            "source": f"p2p_army:{market}:{SIDE}:{mode}",
            "n_ads": len(prices), "market": market, "side": SIDE}


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
                    ("rate", "fetched_at", "source", "n_ads", "market", "side")})
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
