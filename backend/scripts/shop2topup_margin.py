#!/usr/bin/env python3
"""PL-006-T09A-V1 — marge par lot Shop2Topup, en LECTURE SEULE.

Une ligne par lot du manifeste T04 (`core/shop2topup_mapping.py`) : prix MGS en ariary, prix
revendeur en dollars, coût converti, marge. Rien n'est écrit : ni fichier, ni base, ni dépôt.
Le prix MGS n'est jamais modifié — ce script ne fait que le relire.

SOURCES (aucune valeur inventée)
================================
- prix MGS : `core/seed.py:9-12` (`UC_PACKS`, 3ᵉ champ = prix public actuel) ;
- prix revendeur : `GET /catalog/subcategories?categoryId=2`, champ `price` — « montant facturé
  au revendeur », comme `unit_price` (`RAPPORT-SHOP2TOPUP-API.md` § 4). `unit_price` n'existe
  que sur `/catalog/subcategory/{id}/price`, **une route par SKU** : six appels dépasseraient le
  plafond de 3 GET de cette tâche, et `price` porte le même montant (§ 4, note finale) ;
- prix public : l'API catalogue ne le publie pas (`RAPPORT-SHOP2TOPUP-API.md` § 3 bis, H4 : il
  vient du JSON-LD de la page publique). Aucune colonne ne l'invente : une ligne le dit.

MODE D'EMPLOI
=============

    # Essai à blanc (défaut) : aucun appel réseau, aucune clé, prix FICTIFS étiquetés.
    MONGO_URL='mongodb://127.0.0.1:1' DB_NAME=factice \\
        python backend/scripts/shop2topup_margin.py --rate 4500

    # Relevé réel : au plus 3 GET, clé dans la session du terminal, jamais affichée.
    read -rs SHOP2TOPUP_API_KEY && export SHOP2TOPUP_API_KEY
    MONGO_URL='mongodb://127.0.0.1:1' DB_NAME=factice \\
        python backend/scripts/shop2topup_margin.py --rate 4500 --fee-pct 2 --live
    unset SHOP2TOPUP_API_KEY

`--rate auto` (PL-006-T09B-V1) lit le taux stocké par la maintenance (`settings.p2p_rate`) ; avec
`--live`, il interroge P2P.Army à la place (une requête POST, clé `P2P_ARMY_API_KEY`). Un relevé
P2P refusé arrête le script avant tout appel au catalogue.

`MONGO_URL` / `DB_NAME` ne servent qu'à l'import : `services.providers` charge `core.db` (client
Motor paresseux) et `core.seed` relit `UC_PACKS`. Ce script n'ouvre aucune connexion et n'exécute
aucune requête en base — sauf `--rate auto` sans `--live`, qui lit le seul réglage `p2p_rate`.

GARDE-FOUS
==========
- `--rate` est obligatoire : aucun taux de change n'est codé en dur.
- Sans `--live`, AUCUN appel réseau ; les prix affichés sont fictifs et le disent.
- Avec `--live`, 2 GET (`/catalog/subcategories` + `/catalog/category/2/requirements`, appelés
  par `get_offers`) — jamais plus de 3.
- La clé est lue par `os.environ["SHOP2TOPUP_API_KEY"]` ; absente ⇒ arrêt AVANT tout appel.
- Un SKU absent du catalogue donne la mention « absent », sans exception.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:  # permet `python backend/scripts/...` depuis la racine
    sys.path.insert(0, str(BACKEND_DIR))

from core.seed import UC_PACKS  # noqa: E402
from core.shop2topup_mapping import SHOP2TOPUP_MANIFEST  # noqa: E402
from services.providers.shop2topup_adapter import KEY_ENV, Shop2TopupProvider  # noqa: E402
from services.providers.errors import ProviderError  # noqa: E402

GAME_ID = "pubg-mobile"
CATEGORY_ID = "2"  # « Direct Topup / PUBG Mobile », mesuré (RAPPORT § 5 bis)
GET_MAX = 3
LABEL_ABSENT = "absent"

# Prix revendeur FICTIFS pour l'essai à blanc — valeurs ARBITRAIRES, ni mesurées ni extrapolées :
# elles montrent le format et les deux statuts (OK / PERTE). Seul `--live` lit de vrais prix.
DRY_RUN_PRICES = {"13": "0.850000", "14": "4.400000", "15": "8.800000",
                  "16": "23.500000", "17": "49.000000", "19": "199.000000"}

WIDTHS = (11, 7, 5, 14, 13, 11, 12, 9, 7)


def _api_key() -> str:
    """Clé lue UNIQUEMENT dans l'environnement (`os.environ[...]`), jamais dans un fichier."""
    try:
        return (os.environ["SHOP2TOPUP_API_KEY"] or "").strip()
    except KeyError:
        return ""


def mgs_prices() -> dict[int, int]:
    """Prix MGS en ariary par nombre d'UC, relus dans `core/seed.py:9-12`."""
    # `UC_PACKS` : (uc, old_price, price, popular) — `price` est le 3ᵉ champ (`seed.py:47`).
    return {uc: price for uc, _old, price, _popular in UC_PACKS}


def _decimal(value) -> Decimal | None:
    """Montant décimal, ou `None` si la valeur est absente/illisible — jamais un zéro inventé."""
    try:
        return Decimal(str(value).strip())
    except Exception:
        return None


def _ar(value: Decimal) -> str:
    """Ariary entier, séparateur d'espace comme `core/seed.py:49`."""
    return f"{int(value):,}".replace(",", " ")


async def fetch_prices(provider) -> dict[str, str]:
    """Prix revendeur par SKU, lus dans le catalogue (GET uniquement, via l'adaptateur)."""
    catalog = await provider.get_offers(CATEGORY_ID)
    return {str(offer.get("offer_id")).strip(): offer.get("price")
            for offer in catalog.get("offers") or []
            if str(offer.get("offer_id") or "").strip()}


def build_rows(prices: dict[str, str], rate: Decimal, fee_pct: Decimal) -> list[dict]:
    """Une ligne par lot du manifeste : coût = prix revendeur × taux × (1 + frais/100)."""
    factor = Decimal(1) + fee_pct / Decimal(100)
    mgs = mgs_prices()
    rows = []
    for entry in SHOP2TOPUP_MANIFEST:
        sku = entry["sku"]
        unit = prices.get(sku)
        price = _decimal(unit) if unit is not None else None
        row = {"lot": f"{entry['uc_total']} UC", "uc": entry["uc_total"], "sku": sku,
               "mgs": mgs.get(entry["uc_total"]), "unit_price": None, "cost": None,
               "margin": None, "margin_pct": None}
        if price is not None and row["mgs"] is not None:
            row["unit_price"] = price
            row["cost"] = (price * rate * factor).quantize(Decimal(1))
            row["margin"] = Decimal(row["mgs"]) - row["cost"]
            row["margin_pct"] = (row["margin"] / Decimal(row["mgs"]) * 100
                                 ).quantize(Decimal("0.1"))
        rows.append(row)
    return rows


def format_row(row: dict) -> str:
    """Ligne du tableau ; « absent » au lieu d'une erreur quand le SKU n'est pas au catalogue."""
    cells = [row["lot"], str(row["uc"]), row["sku"],
             _ar(Decimal(row["mgs"])) if row["mgs"] is not None else "—",
             f"{row['unit_price']:.6f}" if row["unit_price"] is not None else LABEL_ABSENT,
             _ar(row["cost"]) if row["cost"] is not None else "—",
             _ar(row["margin"]) if row["margin"] is not None else "—",
             f"{row['margin_pct']:.1f}" if row["margin_pct"] is not None else "—",
             ("OK" if row["margin"] > 0 else "PERTE") if row["margin"] is not None else "—"]
    return "  ".join(f"{cell:<{width}}" if index == 0 else f"{cell:>{width}}"
                     for index, (cell, width) in enumerate(zip(cells, WIDTHS))).rstrip()


def _header() -> str:
    cells = ["lot", "UC", "SKU", "prix MGS (Ar)", "revendeur ($)", "coût (Ar)",
             "marge (Ar)", "marge %", "statut"]
    return "  ".join(f"{cell:<{width}}" if index == 0 else f"{cell:>{width}}"
                     for index, (cell, width) in enumerate(zip(cells, WIDTHS))).rstrip()


def _error_label(exc: Exception) -> str:
    """Résumé d'erreur sans corps de réponse (le solde du compte y figure)."""
    code = getattr(exc, "code", None) or "-"
    status = getattr(exc, "status_code", None) or "-"
    return f"{type(exc).__name__} (HTTP {status}, code {code})"


def _report(rows: list[dict], rate: Decimal, fee_pct: Decimal, live: bool, out) -> int:
    out(f"PL-006-T09A-V1 — marge par lot Shop2Topup — {GAME_ID} — "
        + ("RELEVÉ RÉEL (GET uniquement)" if live
           else "ESSAI À BLANC (prix FICTIFS, aucun appel fournisseur)"))
    out(f"taux : 1 USDT = {_ar(rate)} Ar · frais d'achat d'USDT : {fee_pct} % · "
        f"coût = revendeur × taux × (1 + frais/100)")
    out("prix MGS relus dans core/seed.py:9-12 · marge % du prix MGS · SKU = item_id du manifeste T04")
    out("prix public : non publié par l'API catalogue (JSON-LD de la page seulement, RAPPORT § 3 bis).")
    out(_header())
    for row in rows:
        out(format_row(row))
    losses = sum(1 for row in rows if row["margin"] is not None and row["margin"] <= 0)
    absent = sum(1 for row in rows if row["margin"] is None)
    out(f"lots en perte : {losses} / {len(rows)} ({absent} absent(s)).")
    if not live:
        out("prix revendeur ci-dessus FICTIFS (essai à blanc) — relancer avec --live pour le vrai relevé.")
    out("lecture seule : aucun prix modifié, aucune écriture en fichier, en base ou dans le dépôt.")
    return 0


async def _resolve_rate(raw, live: bool, out) -> Decimal | None:
    """`--rate` numérique, ou `auto` : taux stocké (base) ou, avec `--live`, relevé P2P.Army."""
    text = str(raw).strip()
    if text.lower() != "auto":
        try:
            value = Decimal(text)
        except InvalidOperation:
            out("taux invalide : --rate attend un nombre strictement positif ou « auto ».")
            return None
        if value <= 0:
            out("taux invalide : --rate doit être un nombre strictement positif.")
            return None
        return value
    from services import p2p_rate  # import différé : `p2p_rate` réutilise ce module

    if live:
        try:
            info = await p2p_rate.fetch_rate()
        except Exception as exc:
            reason = getattr(exc, "reason", None) or type(exc).__name__
            out(f"taux P2P illisible ({reason}) — aucun chiffre affiché.")
            return None
        out(f"taux P2P.Army : 1 USDT = {info['rate']:.2f} Ar · {info['n_ads']} annonces · "
            f"{info['source']}")
        return Decimal(str(info["rate"]))
    try:
        saved = await p2p_rate.stored()
    except Exception as exc:
        out(f"taux stocké illisible ({type(exc).__name__}) — aucun chiffre affiché.")
        return None
    value = saved.get("rate")
    if not value:
        out("aucun taux stocké : lancer la maintenance d'abord, ou --rate auto --live.")
        return None
    out(f"taux stocké : 1 USDT = {float(value):.2f} Ar · "
        f"relevé {saved.get('fetched_at') or 'inconnu'}")
    return Decimal(str(value))


async def run(*, rate: Decimal | str, fee_pct: Decimal = Decimal(0), live: bool = False,
              provider=None, out=print) -> int:
    """Exécute le relevé. `provider` n'est fourni que par les tests (transport bouchonné)."""
    resolved = await _resolve_rate(rate, live, out)
    if resolved is None:
        return 2
    rate = resolved
    if not live:
        return _report(build_rows(DRY_RUN_PRICES, rate, fee_pct), rate, fee_pct, live, out)

    if not _api_key():
        out(f"{KEY_ENV}=*** absente : arrêt AVANT tout appel fournisseur.")
        return 2
    out(f"{KEY_ENV}=*** (présente, jamais affichée) · au plus {GET_MAX} GET, aucun POST")

    provider = provider or Shop2TopupProvider()
    try:
        prices = await fetch_prices(provider)
    except ProviderError as exc:
        out(f"catalogue illisible : {_error_label(exc)} — aucun chiffre affiché.")
        return 3
    return _report(build_rows(prices, rate, fee_pct), rate, fee_pct, live, out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Marge par lot Shop2Topup, en lecture seule (essai à blanc par défaut).")
    parser.add_argument("--rate", required=True,
                        help="taux : ariary par USDT, ou « auto » (taux stocké ; avec --live, "
                             "relevé P2P.Army). Aucun taux n'est codé en dur")
    parser.add_argument("--fee-pct", default=Decimal(0), type=Decimal,
                        help="frais de votre achat d'USDT, en pourcentage (défaut 0)")
    parser.add_argument("--live", action="store_true",
                        help=f"relève réelle du catalogue (au plus {GET_MAX} GET, clé requise)")
    args = parser.parse_args(argv)
    return asyncio.run(run(rate=args.rate, fee_pct=args.fee_pct, live=args.live))


if __name__ == "__main__":
    raise SystemExit(main())
