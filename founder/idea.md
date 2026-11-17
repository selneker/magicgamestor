# Magic Game Store

## Ce que c'est
Magic Game Store (magicgame.store) est une boutique en ligne de recharges de jeux vidéo (top-up) pour le marché malgache. Elle vend des UC PUBG Mobile, des abonnements Prime et Prime+, et des packs évolutifs, livrés sur le compte joueur du client après vérification de son identité.

## Pour qui
Les joueurs de Madagascar, surtout sur mobile (écrans de 390 px sur des réseaux lents), qui paient en ariary (MGA) avec MVola, Orange Money ou Binance USDT.

## Comment ça marche
1. Le client choisit un jeu et un pack sur le catalogue.
2. Son compte joueur est vérifié (ID et zone de serveur) avant le paiement — chez Fazercards aujourd'hui, en migration vers Neferbyte (≈ 34 jeux couverts, contre 3 chez Fazercards).
3. Il paie en MVola, Orange Money ou USDT (Binance).
4. La recharge est livrée sur son compte ; il suit sa commande en temps réel.

## Technique
Backend FastAPI + MongoDB (motor), API sous `/api`, 15 routeurs, authentification par cookies HttpOnly. Frontend React 19 + Tailwind 3.4 (CRA 5 / craco 7), français par défaut, anglais secondaire. L'hébergement et le domaine sont déjà en place (magicgame.store).
