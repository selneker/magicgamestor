# Phase 3 — Première commande réelle FazerCards (EN ATTENTE DE VALIDATION HUMAINE)

## Commande MGS préparée
- order_number: MGS-33861A
- order_id: 6a695f32-4271-4e2e-9b93-4ca3f940c580
- statut MGS: paid (référence manuelle mvola:PHASE3-PREP, marquée payée par admin pour préparation)
- produit: 60 UC (product_id 7465c4dc-25c2-4318-b0db-c480f0cc32ec, slug 60-uc, prix MGS 5 000 Ar)

## Rapport preflight (généré live le 2026-09-25)
- provider: fazercards
- category_id: pubg_mobile_auto
- offer_id: 60_uc
- offer_name: 60 UC
- price_usd: 0.8838
- player_id: 52328390220
- player_name (validé live): Fredito7135
- idempotency_key: MGS-33861A-1 (stable, réutilisée en cas de retry)
- mode fulfillment: MANUEL (fzr_auto=false)
- webhook: désactivé (hors scope Phase 3, suivi via GET /orders/{id})

## Blocage
- Balance FazerCards: $0.0000 → INSUFFISANTE (il faut ≥ $0.8838)
- Créditer le wallet FazerCards avant l'envoi.

## Procédure d'envoi (après validation humaine explicite UNIQUEMENT)
Admin → Commandes → MGS-33861A → "Envoyer au fournisseur" → vérifier rapport → "Confirmer l'envoi"
ou: POST /api/admin/orders/6a695f32-4271-4e2e-9b93-4ca3f940c580/fazercards/fulfill

## INTERDICTION
NE JAMAIS confirmer l'envoi (POST fulfill) sans autorisation explicite de l'utilisateur.
