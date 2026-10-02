# MGS — Phase 2 (Checkout UX/UI + Paiements + Binance USDT auto)

## Original problem statement
Cahier des charges client "MAGIC GAME STORE (MGS) — PHASE 2 : CHECKOUT UX/UI + PAYMENT SYSTEM + BINANCE AUTO VERIFICATION" : checkout 4 étapes (Vérif ID PUBG via FazerCards existant → choix paiement radio cards → paiement → confirmation), slide ~240ms ease-out, bottom nav + game button cachés, bouton retour identique au profil, MVola/Orange auto avec checkbox frais obligatoire, paiement manuel simplifié (référence demandée à l'étape 4), Binance USDT on-chain (TRC20/BEP20/Aptos/TON, PAS Binance Pay), BinanceWallet/CryptoPayment (WAITING/DETECTED/CONFIRMED/FAILED), BinancePaymentWatcher, Admin > Paiements > Binance, sécurité (mauvais réseau/montant, double tx, tx inconnue, txHash unique). Ne pas reconstruire MGS. Repo : https://github.com/selneker/magicgamestor.git
Validated decisions: Binance Exchange/CEX deposit-history API (read-only), admin rate stored per payment, server-side unique amount + expiry, shared BackButton, reuse fulfillment.on_order_paid, no parallel architecture.

## Architecture
- Frontend CRA React 19, framer-motion, shadcn, i18n FR/EN, Neon Brutalism.
- Backend FastAPI + motor (routers/services/core). Binance: services/binance.py (signed GET /sapi/v1/capital/deposit/hisrec + config/getall), services/crypto.py (settings in settings.store.binance, quotes, crypto_payments), services/binance_watcher.py (30s loop + on-demand checks, crypto_unmatched log), routers/crypto.py.

## Implemented (2026-10-02)
- 4-step checkout (Checkout.js + components/store/checkout/*), shared BackButton (Account + Checkout), BottomNav/GameButton hidden on /commande, PubgIdVerify `checkout` mode (same FazerCards call, temporary/provider errors), PaymentFlow radio cards + fee checkbox + Binance card, PaymentStatus theme + onCompleted.
- Binance backend + admin page /admin/paiements/binance + checkout (QR via qrcode.react).
- Tests: backend/tests/test_binance_crypto.py (19 pass, mocked Binance), lifecycle 17/17, fees 10/10, MVola simulation e2e OK.

## Backlog
- P0: real Binance read-only key in production env, configure wallets/rate, live small-amount test per network (TRC20/BEP20/APTOS/TON incl. memo).
- P1: apply client UI reference screenshots; fix pre-existing test_iter23 hardcoded admin password.
- P2: admin action to manually link an unmatched deposit to an order.
