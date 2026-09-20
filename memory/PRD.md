# Magic Game Store — PRD / mémoire projet

## Problème d'origine
Reprise d'une boutique PUBG Mobile en production (magicgame.store / api.magicgame.store, Render, Mongo, Papi).
Priorités : sécuriser le cycle de paiement Papi (expiration 15 min, idempotence, anti-rejeu, anti-spam), retirer la
dépendance Emergent du login Google, ajouter vérification email / mot de passe oublié / suppression de compte, emails
SMTP, système de points (ledger), échanges, transferts, audit — sans casser design (Neon Brutalism), données ni règles
Prime/Prime+ (1 Prime + 1 Prime+ actifs max par pubg_id).

## Architecture
- Frontend CRA/craco React 19 + Tailwind + shadcn (`frontend/src`), routes dans `App.js`, i18n `i18n/translations.js`.
- Backend FastAPI (`backend/server.py`, routers `auth|products|orders|payments|events|chat|push|loyalty`,
  services `payments|loyalty|mailer|fulfillment|push`, `core/{db,security,ratelimit,audit,seed}`), Mongo via motor.
- Paiement : commande → tentative(s) (`payments`, une par `client_ref`) → lien Papi → webhook signé → `apply_status`
  atomique → `fulfillment.on_order_paid` (points + email + audit) une seule fois.

## Implémenté (2026-06)
- Paiement : tentatives, deadline interne 15 min, `expired`, late_success, dédup callbacks (`payment_events`),
  signature/token/montant/référence vérifiés, retry avec nouvelle référence, rate limiting configurable.
- Auth : Google OAuth propriétaire (`/auth/google/start|callback`), vérification email, resend, forgot/reset,
  change-password, révocation JWT via `auth_version`, suppression/anonymisation de compte.
- Emails SMTP (mailer) avec wordmark du Header ; fidélité (ledger, rewards, redemptions, transferts avec acceptation,
  admin `/admin/fidelite`) ; audit_logs + `GET /api/admin/audit`.
- Tests : `backend/tests/test_payment_lifecycle.py` (17), `test_auth_loyalty.py` (10) — verts.

## Backlog
- P1 : exporter le wordmark en PNG pour Google Console ; configurer SMTP + Google dans Render ; page admin audit UI.
- P2 : reset des points promo expirants ; notifications push pour late_success ; remplacer manifest icons par la charte.
- P2 : rate limiter distribué (Redis) si plusieurs instances Render.
