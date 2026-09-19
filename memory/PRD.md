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
- expirations Prime et Prime+ indépendantes
Statuts commandes : transitions backend (`routers/orders.py`) — une commande annulée/livrée n'offre plus la livraison.

## Historique
- Itérations 1-6 : catalogue, panier, checkout/PAPI, suivi, événements, auth (JWT + Google), admin
  (dashboard, commandes, catalogue, événements, messages), chat (ChatThread/ChatWorkspace + chat flottant
  déplaçable), Web Push VAPID admin, thème clair/sombre, boutons de copie admin, règles d'abonnement + tests.
- 2026-06 (cette itération) — **Refonte visuelle NEON BRUTALISM** (visuel uniquement, zéro changement métier) :
  - Tokens/CSS repensés (`index.css`) : #C5FE02 / #0A0A0A / #F4F3EE, bords nets (radius 0), règles fines,
    typographie display via `--font-display` (Archivo en attente des WOFF2 Nohemi licenciés — slot `@font-face` prêt),
    remapping global des anciennes classes slate/white pour convertir toutes les pages en clair + sombre.
  - Composants refondus : Header, BottomNav (liquid glass noir + actif néon, labels courts), Footer (ticker néon),
    ProductCard (blocs éditoriaux : gros nombre, prix, CTA), Home (hero éditorial + titres rotatifs),
    FloatingChat (style brutaliste, panneau au-dessus de la nav mobile), Button (variants brutalistes),
    StatusPill, CopyButton, AdminLayout/AdminDashboard/AdminOrders, AdminPush (compact), CartDrawer, Product.
  - Textes marketing : hero rotatif + ticker remplacés par de vrais bénéfices client (FR/EN).
  - Responsive vérifié 320/375/390/430/desktop — aucun débordement horizontal.
  - Validation : `yarn build` OK ; `pytest tests/test_subscription_rule.py tests/test_iter6_extras.py` → 10 passed.

## Backlog
- P1 : déposer les fichiers Nohemi (.woff2) dans `frontend/public/fonts` + décommenter les `@font-face`.
- P1 : validation réelle du Web Push sur appareil (permissions, réception, click-through).
- P2 : page abonnements dédiée montrant Prime/Prime+ actifs et dates d'expiration par PUBG ID.
- P2 : états vides/skeletons dans le style éditorial.
