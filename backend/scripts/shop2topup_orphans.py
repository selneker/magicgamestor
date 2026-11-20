#!/usr/bin/env python3
"""PL-006-T04B-V1 — produits PUBG hors lots UC face aux offres Shop2Topup.

LECTURE SEULE, AUCUNE ÉCRITURE
==============================
Ce script ne modifie ni produit, ni mapping, ni prix, ni fichier, ni base. Il produit un tableau
de rapprochement pour que le propriétaire tranche, produit par produit : **mapper** ou **masquer**.
Aucun `supplier_mapping` n'est écrit ; aucun produit n'est désactivé.

SOURCES (aucune valeur inventée)
================================
- produits MGS : `core/seed.py` — `PRIME_PACKS` (8 abonnements) et `EVO_PACKS` (4 packs) ;
- offres Shop2Topup : `tests/fixtures/shop2topup/pubg-mobile.html`, bloc JSON-LD de la page
  publique relevée le 18/11/2026 (SKU, nom, prix **public** en dollars) ;
- avec `--live` seulement : prix **revendeur** par `GET /catalog/subcategories?categoryId=2`,
  même méthode que `scripts/shop2topup_margin.py` (au plus 3 GET, via l'adaptateur).

RAPPROCHEMENT
=============
Par **nom et durée**, jamais par position :
- Prime / Prime+ : même famille ET même nombre de mois dans le nom de l'offre ;
- packs évolutifs : mots-clés de la famille, sans nombre de mois.
Une seule correspondance sur un abonnement = `certaine`. Un pack évolutif reste `à valider` :
son nom ne dit pas ce que contient le lot MGS (UC, AG, quantités). Plusieurs candidats ou aucun
candidat = `à valider` / `sans équivalent`, jamais un choix silencieux.

MODE D'EMPLOI
=============

    # Essai à blanc (défaut) : aucun appel réseau, aucune clé, prix PUBLICS de la fixture.
    MONGO_URL='mongodb://127.0.0.1:1' DB_NAME=factice \\
        python backend/scripts/shop2topup_orphans.py

    # Relevé réel : au plus 3 GET, clé dans la session du terminal, jamais affichée.
    read -rs SHOP2TOPUP_API_KEY && export SHOP2TOPUP_API_KEY
    MONGO_URL='mongodb://127.0.0.1:1' DB_NAME=factice \\
        python backend/scripts/shop2topup_orphans.py --live --rate 4500
    unset SHOP2TOPUP_API_KEY

`--rate` est obligatoire avec `--live` (ariary par USDT, ou `auto` : taux stocké, ou relevé
P2P.Army avec `--live`). Aucun taux n'est codé en dur.

`MONGO_URL` / `DB_NAME` ne servent qu'à l'import (`core.db` lit ces variables au chargement).
Ce script n'ouvre aucune connexion et n'exécute aucune requête en base, sauf `--rate auto` sans
`--live`, qui lit le seul réglage `settings.p2p_rate` — comme `shop2topup_margin.py`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:  # permet `python backend/scripts/...` depuis la racine
    sys.path.insert(0, str(BACKEND_DIR))

from core.seed import EVO_PACKS, PRIME_PACKS  # noqa: E402
from core.shop2topup_mapping import SHOP2TOPUP_MANIFEST  # noqa: E402
from scripts.shop2topup_margin import (_ar, _decimal, _resolve_rate,  # noqa: E402
                                       fetch_prices)
from services.providers.shop2topup_adapter import KEY_ENV, Shop2TopupProvider  # noqa: E402
from services.providers.errors import ProviderError  # noqa: E402
# Mêmes lecteurs JSON-LD que la synchronisation de stock (T02) : un seul analyseur dans le
# dépôt, donc aucun risque de divergence sur les blocs `<script>` multiples de la page.
from services.shop2topup_stock import _JsonLdCollector, _iter_offers  # noqa: E402

GAME_ID = "pubg-mobile"
FIXTURE = BACKEND_DIR / "tests" / "fixtures" / "shop2topup" / "pubg-mobile.html"
GET_MAX = 3

CERTAIN = "certaine"
TO_VALIDATE = "à valider"
NO_MATCH = "sans équivalent"

# Mots-clés de rapprochement des packs évolutifs. Volontairement fermés et explicites : une
# famille sans mots-clés connus reste « sans équivalent » au lieu d'être devinée.
EVO_KEYWORDS: dict[str, tuple[str, ...]] = {
    "evo-fragments-materiaux": ("firearm materials",),
    "evo-premier-achat": ("first purchase",),
    "evo-embleme-mythique": ("mythic emblem",),
    "evo-fragments-mythique": ("mythic fragments",),
}

WIDTHS = (26, 13, 11, 36, 13, 15, 12, 11, 11, 8)
HEADER = ("produit MGS", "prix MGS (Ar)", "SKU", "offre Shop2Topup", "prix public ($)",
          "certitude", "revendeur ($)", "coût (Ar)", "marge (Ar)", "marge %")


def _api_key() -> str:
    """Clé lue UNIQUEMENT dans l'environnement (`os.environ[...]`), jamais dans un fichier."""
    try:
        return (os.environ[KEY_ENV] or "").strip()
    except KeyError:
        return ""


def _norm(text: str | None) -> str:
    """Nom comparable : minuscules, accents retirés, ponctuation réduite à une espace."""
    plain = unicodedata.normalize("NFKD", str(text or ""))
    plain = "".join(char for char in plain if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", plain.lower()).strip()


def fixture_offers(path: Path | str = FIXTURE) -> list[dict]:
    """Offres (SKU, nom, prix public $) lues dans les blocs JSON-LD de la page publique."""
    collector = _JsonLdCollector()
    collector.feed(Path(path).read_text(encoding="utf-8"))
    collector.close()
    if not collector.blocks:
        raise ValueError("aucun bloc JSON-LD dans la fixture")
    offers, seen = [], set()
    for block in collector.blocks:
        try:
            document = json.loads(block)
        except (ValueError, TypeError):
            # Un bloc annexe (WebSite, Organization…) peut être tronqué sans que la partie
            # produit le soit : on l'ignore, comme `services/shop2topup_stock.py:191-195`.
            continue
        for offer in _iter_offers(document):
            sku = str(offer.get("sku") or "").strip()
            if not sku or sku in seen:  # un SKU publié deux fois ne devient pas deux candidats
                continue
            seen.add(sku)
            offers.append({"sku": sku,
                           "name": str(offer.get("name") or "").strip(),
                           "price_usd": str(offer.get("price") or "").strip()})
    return offers


def scoped_offers(offers: list[dict]) -> list[dict]:
    """Offres HORS lots UC : ni le manifeste T04, ni un lot UC / WOW Coins.

    Les lots UC déjà couverts par T04 ne sont pas des orphelines ; les lots UC que MGS ne vend
    pas (10, 8 100, 24 300, 32 400, 40 500) et les WOW Coins relèvent de A3/P7, pas de ce
    rapprochement : ils sont écartés ici pour que le tableau ne parle que des 12 produits hors UC.
    """
    uc_skus = {str(entry["sku"]) for entry in SHOP2TOPUP_MANIFEST}
    currency = re.compile(r"\bUC\b|WOW Coins", re.IGNORECASE)
    return [offer for offer in offers
            if offer["sku"] not in uc_skus and not currency.search(offer["name"])]


def mgs_products() -> list[dict]:
    """Les 12 produits PUBG hors lots UC, relus dans `core/seed.py` (jamais recopiés)."""
    products = []
    for kind, months, _old, price in PRIME_PACKS:
        label = "Prime+" if kind == "prime_plus" else "Prime"
        products.append({"slug": f"{kind.replace('_', '-')}-{months}m",
                         "name": f"{label} {months} mois", "family": kind,
                         "months": months, "mgs": price})
    for slug, name, _name_en, _desc_fr, _desc_en, price, _limit in EVO_PACKS:
        products.append({"slug": slug, "name": name, "family": "evo", "months": None,
                         "mgs": price})
    return products


def months_of(name: str) -> int | None:
    """Nombre de mois lu dans un nom d'offre anglais (« Prime (12 Months) » -> 12)."""
    match = re.search(r"(\d+)\s*month", _norm(name))
    return int(match.group(1)) if match else None


def _prime_candidates(product: dict, offers: list[dict]) -> list[dict]:
    wants_plus = product["family"] == "prime_plus"
    found = []
    for offer in offers:
        name = _norm(offer["name"])
        if "prime" not in name:
            continue
        if ("prime plus" in name) != wants_plus:
            continue
        if months_of(name) != product["months"]:
            continue
        found.append(offer)
    return found


def _evo_candidates(product: dict, offers: list[dict]) -> list[dict]:
    keywords = EVO_KEYWORDS.get(product["slug"], ())
    return [offer for offer in offers
            if keywords and all(word in _norm(offer["name"]) for word in keywords)]


def match_product(product: dict, offers: list[dict]) -> dict:
    """Une ligne de rapprochement : candidats, certitude et note. Aucun choix silencieux."""
    candidates = (_evo_candidates(product, offers) if product["family"] == "evo"
                  else _prime_candidates(product, offers))
    # Ordre indépendant de la page : deux candidats sortent toujours dans le même ordre.
    candidates = sorted(candidates, key=lambda offer: offer["sku"])
    note = ""
    if product["family"] == "evo":
        # Le nom de l'offre ne décrit pas le contenu du lot MGS (UC, AG, quantités) : jamais
        # « certaine » sur un pack évolutif, même quand le nom traduit la même famille.
        certainty = NO_MATCH if not candidates else TO_VALIDATE
        if len(candidates) > 1:
            note = f"{len(candidates)} candidats : contenu et prix à confirmer"
        elif candidates:
            note = "contenu du lot non décrit par le nom de l'offre"
    elif not candidates:
        certainty = NO_MATCH
    elif len(candidates) == 1:
        certainty = CERTAIN
    else:
        certainty = TO_VALIDATE
        note = f"{len(candidates)} candidats pour la même durée"
    return {"slug": product["slug"], "product": product["name"], "mgs": product["mgs"],
            "certainty": certainty, "note": note,
            "skus": [offer["sku"] for offer in candidates],
            "offers": [offer["name"] for offer in candidates],
            "public": [offer["price_usd"] for offer in candidates]}


def build_rows(offers: list[dict]) -> list[dict]:
    return [match_product(product, offers) for product in mgs_products()]


def orphan_offers(offers: list[dict], rows: list[dict]) -> list[dict]:
    """Offres Shop2Topup qu'aucun produit MGS ne revendique (Elite Pass, Weekly Deal…)."""
    used = {sku for row in rows for sku in row["skus"]}
    return [offer for offer in offers if offer["sku"] not in used]


def add_margins(rows: list[dict], prices: dict[str, str], rate: Decimal,
                fee_pct: Decimal) -> None:
    """Coût et marge, seulement quand UN SEUL SKU est en face (sinon aucun chiffre inventé)."""
    factor = Decimal(1) + fee_pct / Decimal(100)
    for row in rows:
        row.update({"unit_price": None, "cost": None, "margin": None, "margin_pct": None})
        if len(row["skus"]) != 1:
            continue
        unit = _decimal(prices.get(row["skus"][0]))
        if unit is None:
            continue
        cost = (unit * rate * factor).quantize(Decimal(1))
        row["unit_price"] = unit
        row["cost"] = cost
        row["margin"] = Decimal(row["mgs"]) - cost
        row["margin_pct"] = (row["margin"] / Decimal(row["mgs"]) * 100).quantize(Decimal("0.1"))


def _join(values: list[str]) -> str:
    return " | ".join(values) if values else "—"


def format_row(row: dict) -> str:
    cells = [
        row["product"],
        _ar(Decimal(row["mgs"])),
        _join(row["skus"]),
        _join(row["offers"]),
        _join([f"{price}" for price in row["public"]]),
        row["certainty"],
        f"{row['unit_price']:.6f}" if row.get("unit_price") is not None else "—",
        _ar(row["cost"]) if row.get("cost") is not None else "—",
        _ar(row["margin"]) if row.get("margin") is not None else "—",
        f"{row['margin_pct']:.1f}" if row.get("margin_pct") is not None else "—",
    ]
    return "  ".join(f"{cell:<{width}}" if index == 0 else f"{cell:>{width}}"
                     for index, (cell, width) in enumerate(zip(cells, WIDTHS))).rstrip()


def _header() -> str:
    return "  ".join(f"{cell:<{width}}" if index == 0 else f"{cell:>{width}}"
                     for index, (cell, width) in enumerate(zip(HEADER, WIDTHS))).rstrip()


def _report(rows: list[dict], orphans: list[dict], rate: Decimal | None, fee_pct: Decimal,
            live: bool, out) -> int:
    out(f"PL-006-T04B-V1 — produits PUBG hors lots UC / offres Shop2Topup — {GAME_ID} — "
        + ("RELEVÉ RÉEL (GET uniquement)" if live
           else "ESSAI À BLANC (prix PUBLICS de la fixture, aucun appel fournisseur)"))
    if live:
        out(f"taux : 1 USDT = {_ar(rate)} Ar · frais d'achat d'USDT : {fee_pct} % · "
            "coût = revendeur × taux × (1 + frais/100)")
        out("prix revendeur : GET /catalog/subcategories (au plus 3 GET) · "
            "marge % du prix MGS")
    else:
        out("prix public ($) : fixture du 18/11/2026 (JSON-LD de la page publique) — "
            "prix REVENDEUR et marge absents : relancer avec --live --rate <Ar/USDT>.")
    out("prix MGS (Ar) relus dans core/seed.py · rapprochement par NOM et DURÉE, jamais par position")
    out(_header())
    for row in rows:
        out(format_row(row))
        if row["note"]:
            out(f"{'':<{WIDTHS[0]}}  ↳ {row['note']}")
    out("")
    out("offres Shop2Topup sans produit MGS (à ne pas mapper tant que le propriétaire n'a pas tranché) :")
    for offer in orphans:
        out(f"  SKU {offer['sku']:<8} {offer['price_usd']:>8} $  {offer['name']}")
    counts = {label: sum(1 for row in rows if row["certainty"] == label)
              for label in (CERTAIN, TO_VALIDATE, NO_MATCH)}
    out("")
    out(f"produits MGS : {len(rows)} · certaines : {counts[CERTAIN]} · "
        f"à valider : {counts[TO_VALIDATE]} · sans équivalent : {counts[NO_MATCH]} · "
        f"offres sans produit : {len(orphans)}")
    if live:
        losses = sum(1 for row in rows if row["margin"] is not None and row["margin"] <= 0)
        priced = sum(1 for row in rows if row["margin"] is not None)
        out(f"lignes chiffrées : {priced} / {len(rows)} · en perte : {losses}.")
    out("lecture seule : aucun produit modifié, aucun mapping écrit, aucun produit masqué.")
    return 0


def _error_label(exc: Exception) -> str:
    """Résumé d'erreur sans corps de réponse (le solde du compte y figure)."""
    code = getattr(exc, "code", None) or "-"
    status = getattr(exc, "status_code", None) or "-"
    return f"{type(exc).__name__} (HTTP {status}, code {code})"


async def run(*, rate: Decimal | str | None = None, fee_pct: Decimal = Decimal(0),
              live: bool = False, provider=None, out=print,
              fixture: Path | str = FIXTURE) -> int:
    """Exécute le rapprochement. `provider` n'est fourni que par les tests."""
    try:
        offers = fixture_offers(fixture)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        out(f"fixture illisible ({type(exc).__name__}) — aucun tableau affiché.")
        return 2
    if not offers:
        out("fixture sans offre — aucun tableau affiché.")
        return 2
    offers = scoped_offers(offers)
    rows = build_rows(offers)
    orphans = orphan_offers(offers, rows)
    if not live:
        return _report(rows, orphans, None, fee_pct, False, out)

    if rate is None or str(rate).strip() == "":
        out("--live exige --rate (ariary par USDT, ou « auto ») — aucun chiffre affiché.")
        return 2
    resolved = await _resolve_rate(rate, live, out)
    if resolved is None:
        return 2
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
    add_margins(rows, prices, resolved, fee_pct)
    return _report(rows, orphans, resolved, fee_pct, True, out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rapprochement des produits PUBG hors lots UC avec Shop2Topup, en lecture seule.")
    parser.add_argument("--live", action="store_true",
                        help=f"relève le prix revendeur (au plus {GET_MAX} GET, clé requise)")
    parser.add_argument("--rate", default=None,
                        help="taux ariary par USDT, ou « auto » — obligatoire avec --live")
    parser.add_argument("--fee-pct", default=Decimal(0), type=Decimal,
                        help="frais de votre achat d'USDT, en pourcentage (défaut 0)")
    args = parser.parse_args(argv)
    return asyncio.run(run(rate=args.rate, fee_pct=args.fee_pct, live=args.live))


if __name__ == "__main__":
    raise SystemExit(main())
