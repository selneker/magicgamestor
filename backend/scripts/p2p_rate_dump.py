"""PL-006-T09C-V1 — diagnostic en lecture seule du carnet P2P.Army.

Affiche les 15 meilleures annonces du côté `BUY`, telles que les voit
`services/p2p_rate.py`, avec pour chacune le motif de rejet des filtres (ou
« retenue »), puis les **noms** des champs de la première annonce brute pour
comparer la documentation au réel. Aucune écriture : ni fichier, ni base.
La clé n'est lue que dans `os.environ["P2P_ARMY_API_KEY"]` par `p2p_rate.api_key()`
et n'est jamais affichée.

    cd backend
    MONGO_URL='mongodb://127.0.0.1:1' DB_NAME=factice \
      P2P_ARMY_API_KEY=… python scripts/p2p_rate_dump.py

(`core.db` lit `MONGO_URL`/`DB_NAME` à l'import ; le script n'ouvre aucune connexion.)
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:  # permet `python backend/scripts/...` depuis la racine
    sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from services import p2p_rate  # noqa: E402

HEADER = ("rang  prix        min         max         methodes                  "
          "taux  ordres  res  annonce  vendeur  verdict")
LEGEND = ("motifs : method = aucune méthode utilisable ; capacity = limites hors "
          "P2P_REF_AMOUNT_AR ; quality = user_rate/user_orders sous le seuil ; "
          "duplicate = vendeur déjà retenu ; price = prix illisible. "
          "res = drapeau de restriction : aucun n'est documenté.")


def _text(value, size: int | None = None) -> str:
    text = str(value if value not in (None, "") else "-")
    return text[:size] if size else text


def lines(ads) -> list[str]:
    """Lignes d'affichage : aucune valeur personnelle au-delà de 6 / 3 caractères."""
    out = []
    for index, (ad, price, reason) in enumerate(p2p_rate.screen(ads), start=1):
        rank = ad.get("pos")
        out.append(
            f"{str(rank if isinstance(rank, int) else index):>4}  "
            f"{('-' if price is None else str(price)):>10}  "
            f"{_text(ad.get('min_fiat')):>10}  {_text(ad.get('max_fiat')):>10}  "
            f"{_text(','.join(str(m) for m in ad.get('payment_methods') or []), 24):<24}  "
            f"{_text(ad.get('user_rate')):>4}  {_text(ad.get('user_orders')):>6}  "
            f"{'-':>3}  {_text(ad.get('adv_id'), 6):<7}  "
            f"{_text(ad.get('user_name'), 3):<7}  {reason or 'retenue'}")
    return out


def key_names(ads) -> list[str]:
    """Noms des champs de la première annonce, sans aucune valeur."""
    return sorted(ads[0].keys()) if ads else []


async def _read() -> list[dict]:
    async with httpx.AsyncClient(timeout=p2p_rate.TIMEOUT_S) as client:
        return await p2p_rate.fetch_ads(client=client)


def main() -> int:
    try:
        ads = asyncio.run(_read())
    except p2p_rate.RateRefused as exc:
        print(f"relevé refusé : {exc.reason}")
        return 1
    except Exception as exc:  # transport, JSON, HTTP : message court, sans URL ni clé
        print(f"appel impossible : {type(exc).__name__}")
        return 1

    print(HEADER)
    for line in lines(ads):
        print(line)
    print()
    print(LEGEND)
    print(f"{len(ads)} annonce(s) reçue(s) · champs : {', '.join(key_names(ads)) or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
