# Magic Game Store — PRD

## Problème / objectif
Boutique PUBG Mobile (Madagascar) : achat d'UC, abonnements Prime / Prime+, suivi de commande,
événements, chat support, back-office admin. Paiement MVola / Orange Money (PAPI) + USSD manuel.

## Stack
React 19 (CRA/craco, Tailwind, shadcn/ui, framer-motion) + FastAPI + MongoDB. next-themes (clé `mgs-theme`).

## Règles métier (INTANGIBLES)
Abonnements, par `pubg_id` :
- max 1 Prime actif, max 1 Prime+ actif ; Prime + Prime+ autorisé ; Prime+Prime et Prime++Prime+ interdits
- panier : UC illimités + 1 Prime + 1 Prime+
- même type : actif ou `pending` bloque ; `cancelled`/`failed` ne bloquent pas ; rachat possible après expiration
- expirations Prime et Prime+ indépendantes ; concurrence protégée par l'index unique `(pubg_id, type)` sur `subscription_locks`

## Historique
- Itérations 1-6 : catalogue, panier, checkout/PAPI, suivi, événements, auth (JWT + Google), admin,
  chat (ChatThread/ChatWorkspace + chat flottant déplaçable), Web Push VAPID admin, thème clair/sombre,
  boutons de copie admin, règles d'abonnement + tests.
- 2026-06 — **Refonte visuelle Neon Brutalism** : tokens #C5FE02 / #0A0A0A / #F4F3EE, radius 0, typographie
  display (`--font-display`, Archivo en attente des WOFF2 Nohemi), Header/BottomNav liquid glass/Footer/Home
  hero éditorial rotatif/FloatingChat/Button/StatusPill/Admin refondus, textes marketing réécrits.
- 2026-06 — **Hotfix sécurité** (iteration_7.json, 23/23) : garde `sub`/`type` dans `_user_from_jwt`,
  suppression du mot de passe admin en clair de `tests/backend_test.py` et `auth_testing.md` (lu depuis `.env`).
  Faux positifs confirmés : libellés i18n « password », `localStorage` du chat (position {x,y} seulement).
- 2026-06 — **Polish UI final** (iteration_8.json) : suppression de la quantité UC dupliquée dans les cartes
  produit (nom de produit retiré de la carte), hiérarchie catégorie → quantité → prix → ancien prix/remise → CTA,
  hauteurs de cartes et CTA alignés (variance 0), cartes Prime « n MOIS » + catégorie PUBG PRIME/PRIME+,
  onglets catalogue et cartes événements brutalistes, quantité en `clamp()` → 0 débordement de 320 à 430px.

## Backlog
- P1 : déposer les fichiers Nohemi (.woff2) dans `frontend/public/fonts` + décommenter les `@font-face`.
- P1 : changer `ADMIN_PASSWORD` en production (valeur exposée dans l'historique git).
- P1 : validation réelle du Web Push sur appareil (permissions, réception, click-through).
- P2 : page abonnements dédiée (Prime/Prime+ actifs + dates d'expiration par PUBG ID).
- P2 : nettoyage des comptes/commandes de test `qa_*`.
