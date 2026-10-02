# MGS — Phase 2 (Checkout UX/UI + Paiements + Binance USDT auto)

## Original problem statement
Cahier des charges client "MAGIC GAME STORE (MGS) — PHASE 2 : CHECKOUT UX/UI + PAYMENT SYSTEM + BINANCE AUTO VERIFICATION" : checkout 4 étapes (Vérif ID PUBG via FazerCards existant → choix paiement radio cards → paiement → confirmation), slide ~240ms ease-out, bottom nav + game button cachés, bouton retour identique au profil, MVola/Orange auto avec checkbox frais obligatoire, paiement manuel simplifié (référence demandée à l'étape 4), Binance USDT on-chain (TRC20/BEP20/Aptos/TON, PAS Binance Pay), modèles BinanceWallet/CryptoPayment (WAITING/DETECTED/CONFIRMED/FAILED), BinancePaymentWatcher, Admin > Paiements > Binance, sécurité (mauvais réseau/montant, double tx, tx inconnue, txHash unique). Ne pas reconstruire MGS, respecter le design Neo Brutalism existant. Aucun commit/push sans validation. Repo : https://github.com/selneker/magicgamestor.git

## Architecture (repo réel)
- Frontend CRA+craco, React 19, react-router 7, framer-motion 11, shadcn, i18n FR/EN (src/i18n/translations.js), Archivo/Nohemi, Neon Brutalism (#C5FE02 / #0A0A0A / #F4F3EE).
- Backend FastAPI + motor, routers/ + services/ + core/ (db, security, ratelimit, audit, seed). Hébergé Render.
- Paiements : Papi (services/payments.py, routers/payments.py) + FiveOne (services/fiveone.py, routers/fiveone.py), manuel USSD ; frais services/fees.py ; livraison services/fulfillment.on_order_paid → fzr_fulfillment.
- FazerCards : services/fazercards.py + POST /api/fazercards/pubg/validate-id, UI PubgIdVerify.js.

## Client decisions
- Réutiliser FazerCards, ne rien recréer. Binance : env vars BINANCE_WEB3_API_KEY / BINANCE_WEB3_SECRET vides pour l'instant, backend only. Maquettes plus tard.
- Ordre : 2.1 checkout UX → 2.2 paiements locaux → 2.3 Binance → 2.4 tests. Validation à chaque étape.

## Status
- Analyse du repo réel livrée (clone lecture seule dans /tmp/mgs). Aucune modification de code.

## Next tasks
- P0 : validation du plan + import du repo dans /app, puis Phase 2.1.
