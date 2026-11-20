#!/usr/bin/env python3
"""PL-006-T08C-V1 — essai de Checkpoint B pour Shop2Topup.

Ce script sert UNIQUEMENT à constater, avec le propriétaire, qu'une commande de test peut être
créée puis suivie sans dépasser le budget. Il n'écrit rien : ni fichier, ni base de données.

MODE D'EMPLOI
=============

    # 1) Essai à blanc (défaut) : aucun appel réseau, aucune clé requise.
    python backend/scripts/shop2topup_checkpoint_b.py --player-id 52328390220

    # 2) Appel réel (dépense réelle) : la clé doit être dans la session du terminal, jamais
    #    dans un fichier, et elle n'est ni affichée ni journalisée.
    SHOP2TOPUP_API_KEY='<clé Render>' \\
        python backend/scripts/shop2topup_checkpoint_b.py --player-id 52328390220 --confirm-spend

    # 3) Avec la sonde du lot (1 appel `POST /orders/batch` en plus) :
    SHOP2TOPUP_API_KEY='<clé Render>' \\
        python backend/scripts/shop2topup_checkpoint_b.py --player-id 52328390220 \\
        --confirm-spend --probe-batch

GARDE-FOUS
==========
- `--player-id` est obligatoire ; `--zone-id` n'est transmis que s'il est fourni.
- Sans `--confirm-spend`, AUCUN appel réseau n'est fait.
- Avec `--confirm-spend` : au plus 1 création (SKU 13 = 60 UC), au plus 6 lectures de statut,
  1 appel de lot si `--probe-batch`. Le budget de l'adaptateur reste seul juge : une lecture
  refusée est affichée, jamais contournée par une attente.
- La clé est lue par `os.environ["SHOP2TOPUP_API_KEY"]`, jamais écrite, jamais affichée (le
  journal montre `SHOP2TOPUP_API_KEY=***`). Absente ⇒ arrêt AVANT tout appel.
- La clé d'idempotence est CONSTANTE : un second passage retombe sur la même commande
  fournisseur (aucun double achat).
- L'identifiant joueur est masqué à moitié dans tout affichage ; les montants de solde, s'il en
  apparaissait un, seraient remplacés par `<balance>`.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:  # permet `python backend/scripts/...` depuis la racine
    sys.path.insert(0, str(BACKEND_DIR))

from services.providers.base import OrderStatus  # noqa: E402
from services.providers.errors import ProviderError  # noqa: E402
from services.providers.shop2topup_adapter import (  # noqa: E402
    BATCH_REQUEST_KEY, KEY_ENV, Shop2TopupProvider)

# Valeurs MESURÉES dans RAPPORT-SHOP2TOPUP-API.md § 4 et § 5 bis :
# categoryId=2 « Direct Topup / PUBG Mobile », item_id 13 = « 60 UC ».
GAME_ID = "pubg-mobile"
CATEGORY_ID = "2"
SKU = "13"
SKU_LABEL = "60 UC"
# Constante, jamais aléatoire : un retry doit retomber sur la MÊME commande fournisseur.
IDEMPOTENCY_KEY = "checkpoint-b-pubg-mobile-sku13"
STATUS_READS_MAX = 6
FINAL_STATUSES = (OrderStatus.COMPLETED, OrderStatus.REFUND, OrderStatus.FAILED)


def _api_key() -> str:
    """Clé lue UNIQUEMENT dans l'environnement (`os.environ[...]`), jamais dans un fichier."""
    try:
        return (os.environ["SHOP2TOPUP_API_KEY"] or "").strip()
    except KeyError:
        return ""


def mask_half(value: str | None) -> str:
    """Masque la moitié d'un identifiant (ex. `52328******`) — jamais l'identifiant complet."""
    text = str(value or "")
    if not text:
        return "<vide>"
    visible = max(1, len(text) // 2)
    return text[:visible] + "*" * (len(text) - visible)


def sanitize(value):
    """Remplace tout solde par `<balance>` avant affichage ; ne journalise jamais un secret.

    Les clés contenant `balance` ou `wallet` sont purgées. Les clés ressemblant à un secret
    (`key`, `secret`, `token`, `authorization`) sont remplacées par `***`.
    """
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if "balance" in lowered or "wallet" in lowered:
                cleaned[key] = "<balance>"
            elif any(word in lowered for word in ("api_key", "secret", "token", "authorization")):
                cleaned[key] = "***"
            else:
                cleaned[key] = sanitize(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


def identity_fields(player_id: str, zone_id: str | None = None) -> dict:
    """Champs transmis à l'adaptateur — aucune valeur inventée, la zone seulement si fournie."""
    fields = {"player_id": str(player_id)}
    if str(zone_id or "").strip():
        fields["zone_id"] = str(zone_id).strip()
    return fields


def _error_label(exc: Exception) -> str:
    """Résumé d'erreur sans corps de réponse (le solde et l'e-mail du compte y figurent)."""
    code = getattr(exc, "code", None) or "-"
    status = getattr(exc, "status_code", None) or "-"
    return f"{type(exc).__name__} (HTTP {status}, code {code})"


def _dry_run(player_id: str, zone_id: str | None, probe_batch: bool, out) -> int:
    key_present = bool(_api_key())
    out("PL-006-T08C-V1 — Checkpoint B Shop2Topup — ESSAI À BLANC (aucun appel réseau)")
    out(f"jeu                : {GAME_ID}")
    out(f"catégorie API      : {CATEGORY_ID}")
    out(f"SKU / offre        : {SKU} = {SKU_LABEL}")
    out(f"clé d'idempotence  : {IDEMPOTENCY_KEY} (constante, réutilisée au retry)")
    out(f"identifiant joueur : {mask_half(player_id)}")
    out(f"zone               : {mask_half(zone_id) if zone_id else '<non fournie>'}")
    out(f"clé fournisseur    : {KEY_ENV}=*** ({'présente' if key_present else 'absente'})")
    out(f"appels prévus      : 1 création, ≤ {STATUS_READS_MAX} lectures de statut"
        + (", 1 appel de lot" if probe_batch else ""))
    out("aucun appel réseau, aucune écriture ni fichier ni base — rien n'a été dépensé.")
    return 0


async def run(*, player_id: str, zone_id: str | None = None, confirm_spend: bool = False,
              probe_batch: bool = False, provider=None, out=print) -> int:
    """Exécute l'essai. `provider` n'est fourni que par les tests (transport bouchonné)."""
    if not confirm_spend:
        return _dry_run(player_id, zone_id, probe_batch, out)

    out("PL-006-T08C-V1 — Checkpoint B Shop2Topup — APPEL RÉEL (dépense autorisée)")
    out(f"jeu                : {GAME_ID}")
    out(f"catégorie API      : {CATEGORY_ID}")
    out(f"SKU / offre        : {SKU} = {SKU_LABEL}")
    out(f"clé d'idempotence  : {IDEMPOTENCY_KEY}")
    out(f"identifiant joueur : {mask_half(player_id)}")

    if not _api_key():
        out(f"{KEY_ENV}=*** absente : arrêt AVANT tout appel fournisseur.")
        return 2
    out(f"{KEY_ENV}=*** (présente, jamais affichée)")

    provider = provider or Shop2TopupProvider()
    fields = identity_fields(player_id, zone_id)

    try:
        order = await provider.create_order(CATEGORY_ID, SKU, fields, IDEMPOTENCY_KEY)
    except ProviderError as exc:
        out(f"création refusée : {_error_label(exc)} — aucune commande créée.")
        return 3
    out(f"commande fournisseur : {order.id}")
    out(f"statut initial       : {order.status or '<vide>'} ({order.normalized_status})")

    if probe_batch:
        try:
            batch = await provider.get_orders([order.id])
            out(f"lot : champ d'entrée = {BATCH_REQUEST_KEY} ; trouvées = {len(batch.orders)} ; "
                f"inconnues = {len(batch.not_found)}")
        except ProviderError as exc:
            out(f"lot non lu : {_error_label(exc)}")

    for attempt in range(1, STATUS_READS_MAX + 1):
        try:
            latest = await provider.get_order(order.id)
        except ProviderError as exc:
            if getattr(exc, "code", None) == "rate_budget_exceeded":
                out(f"lecture {attempt} : refusée par le budget (aucune attente codée).")
                break
            out(f"lecture {attempt} : échec — {_error_label(exc)}")
            return 3
        out(f"lecture {attempt} : {latest.status or '<vide>'} ({latest.normalized_status})")
        if latest.normalized_status in FINAL_STATUSES:
            break

    out("réponses fournisseur non affichées (tout solde serait remplacé par <balance>).")
    out("terminé : aucune écriture en base, aucun fichier créé.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Essai de Checkpoint B Shop2Topup (à blanc par défaut, aucun appel réseau).")
    parser.add_argument("--player-id", required=True, help="identifiant joueur (masqué à l'affichage)")
    parser.add_argument("--zone-id", default=None, help="zone/serveur, si le jeu en demande un")
    parser.add_argument("--confirm-spend", action="store_true",
                        help="autorise la dépense : 1 création + lectures de statut bornées")
    parser.add_argument("--probe-batch", action="store_true",
                        help="ajoute 1 appel POST /orders/batch et affiche le nom du champ d'entrée")
    args = parser.parse_args(argv)
    return asyncio.run(run(player_id=args.player_id, zone_id=args.zone_id,
                           confirm_spend=args.confirm_spend, probe_batch=args.probe_batch))


if __name__ == "__main__":
    raise SystemExit(main())
