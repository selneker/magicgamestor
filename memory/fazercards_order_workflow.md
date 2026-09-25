# FazerCards — Workflow de commande (documentation Phase 2, À NE PAS CODER AVANT LA PHASE 3)

## Source de vérité (API v2, https://api.fzr.cards/api/v2, header X-API-Key)
- `GET /topups` : catégories achetables (pagination cursor : `limit` max 500, `meta.next_cursor`, `meta.has_more`).
- `GET /topups/offers?category_id=…` : offres (`offer_id`, `name`, `price_usd` décimal string) + `fields` requis.
- `POST /topups/order` : `{category_id, offer_id, fields}` — le couple (category_id, offer_id) doit provenir du même appel offers. Le wallet est débité immédiatement, puis statut `processing` → completed/refund.
- Header optionnel `Idempotency-Key` (string unique ≤255, ex. UUID) : un retry avec la même clé renvoie la commande d'origine sans re-débiter. À UTILISER OBLIGATOIREMENT en Phase 3.
- La validation d'ID (`POST /topups/validate-id`, category `pubg_mobile`) utilise un namespace DIFFÉRENT des category_id achetables — ne jamais commander avec `pubg_mobile`.

## Catégories PUBG Mobile achetables (relevé live 25/09/2026 pod — dynamiques, ne pas hardcoder)
| category_id | name | note |
|---|---|---|
| pubg_mobile_auto | PUBG Mobile (Auto) | Global, livraison auto après commande |
| pubg_mobile_fast | PUBG Mobile (Fast) | Global, version rapide (UC 1800+ uniquement) |
| pubg_mobile_manual | PUBG Mobile (Manual) | Global, 5–15 min, succès ~50/50, refund possible |
| pubg_mobile_reserve | PUBG Mobile (Reserve) | Global, secours en cas de panne du principal |

`fields` requis (identiques pour les 4 catégories) : `[{key: "player_id", label: "Player ID", type: "text"}]`

## Mapping proposé MGS → FazerCards (catégorie pubg_mobile_auto, prix live 25/09/2026)
| Produit MGS (slug, prix public) | Offre FazerCards | offer_id | price_usd | Confiance |
|---|---|---|---|---|
| Premier achat (evo-premier-achat, 5 800 Ar, lifetime) | First Purchase Pack | first_purchase_pack | 0.8800 | Forte (nom exact) |
| Fragments matériaux (evo-fragments-materiaux, 17 000 Ar, season) | Upgradable Firearm Materials Pack | upgradable_firearm_materials_pack | 2.6360 | Forte |
| Emblème mythique (evo-embleme-mythique, 20 500 Ar, week) | Weekly Mythic Emblem Value Pack | weekly_mythic_emblem_value_pack | 2.6250 | Forte (hebdo ↔ limite week) |
| Fragments mythique (evo-fragments-mythique, 24 000 Ar, season) | Mythic Emblem Pack | mythic_emblem_pack | 4.3890 | À CONFIRMER (nom non exact : « Mythic Emblem Pack » ≠ « fragments ») |

Offres proches non retenues : Weekly Deal Pack 1 (0.8820), Weekly Deal Pack 2 (2.6250).
Les prix USD sont des coûts fournisseur live : à REVALIDER côté backend au moment de tout futur checkout (prix + disponibilité). Aucune conversion Ar/marge calculée en Phase 2.

## Endpoint interne Phase 2
`GET /api/fazercards/pubg/catalog` (admin, permission `catalog.manage`) → catégories + offres + prix USD + fields, cache 10 min (`services/fazercards.py::_catalog_cache`).

## Phase 3 (à faire plus tard, jamais commencé)
1. Choix de la catégorie d'achat (auto vs manual vs reserve) + stratégie de bascule.
2. Mapping persistant admin (produit MGS ↔ category_id+offer_id) — pas de hardcode.
3. `POST /topups/order` avec Idempotency-Key = UUID stocké sur la commande MGS.
4. Revalidation prix/dispo avant débit ; webhooks/statuts ; remboursement/échec.
