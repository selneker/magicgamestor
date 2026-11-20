"""T04 — manifeste Shop2Topup → produits MGS (PUBG Mobile, lots UC).

Règle de lecture, à appliquer à la lettre :

- **Unité obligatoire : `UC`.** Tout libellé en « WOW Coins » est **exclu** du rapprochement :
  même nombre, autre monnaie — 60 WOW Coins (`sku` 32637) n'est pas 60 UC (`sku` 13).
- **`uc_total` = la SOMME des nombres du libellé**, pas le premier : « 300 + 25 UC » = 325.
- Un couple n'existe que si **le total ET le jeu** correspondent exactement. Un lot sans
  équivalent exact n'est pas inventé : il est listé hors manifeste (A3 — aucun ajout de produit).
- Prime / Prime+ / packs évolutifs restent **hors manifeste** tant que le propriétaire ne les a
  pas validés (A3).

Les `sku` sont les `item_id` de l'API revendeur, prouvés égaux aux `sku` du JSON-LD public
(T03c, § 5 bis du rapport). Les `name_seen` sont copiés de la fixture réelle
`backend/tests/fixtures/shop2topup/pubg-mobile.html` (relevé du 18/11/2026).
"""
import re

SHOP2TOPUP_KEY = "shop2topup"

# Un lot = un couple validé. `game_id` explicite : un slug réutilisé par un autre jeu ne doit
# jamais être rattaché par erreur.
SHOP2TOPUP_MANIFEST = (
    {"sku": "13", "product_slug": "60-uc", "uc_total": 60,
     "name_seen": "Direct Topup — 60 UC", "game_id": "pubg-mobile"},
    {"sku": "14", "product_slug": "325-uc", "uc_total": 325,
     "name_seen": "Direct Topup — 300 + 25 UC", "game_id": "pubg-mobile"},
    {"sku": "15", "product_slug": "660-uc", "uc_total": 660,
     "name_seen": "Direct Topup — 600 + 60 UC", "game_id": "pubg-mobile"},
    {"sku": "16", "product_slug": "1800-uc", "uc_total": 1800,
     "name_seen": "Direct Topup — 1,500 + 300 UC", "game_id": "pubg-mobile"},
    {"sku": "17", "product_slug": "3850-uc", "uc_total": 3850,
     "name_seen": "Direct Topup — 3,000 + 850 UC", "game_id": "pubg-mobile"},
    {"sku": "19", "product_slug": "16200-uc", "uc_total": 16200,
     "name_seen": "Direct Topup — 12,000 + 4,200 UC", "game_id": "pubg-mobile"},
)

# Livraison directe sur le compte joueur (aucun code à stocker).
SHOP2TOPUP_MODE = "direct"


def parse_uc_total(name: str) -> int | None:
    """Total UC d'un libellé Shop2Topup, ou `None` si ce n'est pas un lot UC.

    Applique la règle du fichier : « WOW Coins » exclu, total = somme des nombres avant `UC`.
    """
    lowered = name.lower()
    if "uc" not in lowered or "wow coins" in lowered:
        return None
    head, _, _ = lowered.partition("uc")
    numbers = [int(found.replace(",", "")) for found in re.findall(r"\d[\d,]*", head)]
    return sum(numbers) if numbers else None
