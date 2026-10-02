# MGS — Phase 2 (Checkout UX/UI + Paiements + Binance USDT auto)

## Original problem statement
Cahier des charges "MAGIC GAME STORE (MGS) — PHASE 2 : CHECKOUT UX/UI + PAYMENT SYSTEM + BINANCE AUTO VERIFICATION" (fourni par le client) : checkout 4 étapes (Vérif ID PUBG via FazerCards existant → choix paiement radio cards → paiement → confirmation), slide 240ms ease-out, nav bas cachée + bouton retour du profil, MVola/Orange auto avec checkbox frais, paiement manuel simplifié (référence à l'étape 4), Binance USDT on-chain (TRC20/BEP20/Aptos/TON, pas Binance Pay), modèles BinanceWallet/CryptoPayment, BinancePaymentWatcher, admin Binance, sécurité txHash unique. Respect strict du design Neo Brutalism existant. Aucun commit/push sans validation.

## Client decisions
- Vérification PUBG : réutiliser FazerCards existant, ne rien recréer.
- Binance : clé Web3 fournie plus tard ; env vars vides BINANCE_WEB3_API_KEY / BINANCE_WEB3_SECRET ; backend only.
- Références visuelles : envoyées plus tard.
- Ordre : 2.1 checkout UX → 2.2 paiements locaux → 2.3 Binance → 2.4 tests. Validation à chaque étape.

## Status (2026)
- Analyse : BLOQUÉE — /app ne contient qu'un template vide (1 commit "Initial commit", aucun remote git, aucun code MGS/FazerCards/MVola).

## Next tasks
- P0 : importer le repo MGS dans le workspace, puis livrer le rapport d'analyse.
