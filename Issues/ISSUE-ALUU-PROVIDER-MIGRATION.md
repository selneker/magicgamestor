# Issue : Remplacement du fournisseur de top-up FazerCards par ALUU.in

## Contexte
Magic Game Store utilise **FazerCards** (`api.fzr.cards`) comme fournisseur de top-up jeu (PUBG Mobile, Free Fire). L'abonnement FazerCards arrive à échéance (~29-30-10-2026). **ALUU.in doit devenir le fournisseur actif avant cette date.**

## Décision opérationnelle
- **ALUU = fournisseur principal**, **FazerCards = fallback** (si ALUU est indisponible).
- Aucun jeu n'est présumé ALUU par défaut : fail-closed si un jeu n'a aucun fournisseur configuré.
- FazerCards est conservé en voie de retour (non supprimé brutalement pendant ces 3 jours).
- Le paiement mvola/orange/papi est **non touché** (gateway séparée de FazerCards/ALUU).

## Périmètre
Tout le cycle fournisseur : validation d'identité joueur (Name Check), catalogue/offres, création de commande, statut de commande, webhook.

## Détails techniques (doc ALUU lue : docs/pdfspark-output.pdf)
- Base URL : `https://aluu.in`, auth header `x-api-key` sur chaque requête, JSON over HTTPS
- IP whitelist requise dans le profil ALUU (403 sinon)
- Catalogue : `GET /api/v1/products/:gameCode` (packs avec `denom`, `price`, `requiresUserId/ServerId/CharName`)
- Jeux : `GET /api/v1/games` (PUBG Mobile = `pubgm`)
- Créer commande : `POST /api/v1/create` (`game`, `denom`, `userid`, `[serverid]`, `[charname]`, `partner_orderid` = id unique marchand/idempotence, `[partner_webhook_url]`)
- Statut : `GET /api/v1/partner_orderid` ou `POST /api/v1/partner_orderid/track` ; batch `POST /api/v1/status/batch`
- Statuts bruts : `pending` (non final), `successful` (livré, final), `error` (échec, final), `cancelled` (annulé, final)
- Webhook : POST sur l'URL déclarée ; signature = `hex(HMAC_SHA256(SECRET_KEY, timestamp + "." + raw_body))` ; headers `X-Webhook-Timestamp` + `X-Webhook-Signature` (hex direct, pas de préfixe `sha256=`) ; rejeter si timestamp > 5 min ; vérifier sur le **raw body** ; répondre 2xx sous 10s ; gérer les doublons via `orderid`
- Name Check (validation identité) : `GET /api/check/game-check` params `code=<gamecode>`, `characterId` (ID joueur), `[server_code]`

## Plan (3 jours, début 27-10-2026)
- **Jour 1** : client bas niveau `backend/services/aluu.py` + adapter `backend/services/providers/aluu_adapter.py` (interface `Provider`) + tests unitaires mockés + vars `.env.example` (`ALUU_API_BASE`, `ALUU_API_KEY`, `ALUU_WEBHOOK_SECRET`, `ALUU_WEBHOOK_HEADER`)
- **Jour 2** : cohabitation via `GAME_PROVIDER` dans `backend/services/providers/__init__.py` (ALUU principal sur le(s) jeu(x) cible(s), FazerCards défaut/fallback) + route webhook ALUU `POST /aluu/webhook` + tests webhook
- **Jour 3** : cutover ALUU actif, recette manuelle, `yarn build` + `yarn test:ci` frontend, commit `fix(fournisseur): …` sur branche dédiée puis PR

## Critères de validation (DoD)
- `AluuProvider` instanciable, respecte l'interface `Provider`, tests mockés verts (pas d'appel réseau réel)
- `get_provider(<jeu cible>)` résout ALUU ; `get_provider(None)`/défaut résout FazerCards
- Webhook ALUU vérifie la signature et parse l'événement ; routes FazerCards intactes
- Build frontend + tests verts ; recette manuelle OK avec credentials ALUU
- Commit effectué

## Points ouverts (à confirmer avec l'utilisateur avant implémentation)
1. Credentials ALUU (clé API, secret webhook) + IP du serveur à whitelister — jamais en dur dans le code
2. Quel(s) jeu(s) basculer sur ALUU en premier (PUBG Mobile `pubgm` ? Free Fire ?) et table `GAME_PROVIDER` souhaitée
3. Sélecteur admin ALUU/FazerCards nécessaire ou pilotage backend (`get_provider`) suffisant pour ces 3 jours

## Fichiers critiques (à créer/modifier)
- `backend/services/aluu.py` (créer)
- `backend/services/providers/aluu_adapter.py` (créer)
- `backend/tests/test_aluu_adapter.py` (créer)
- `backend/tests/test_aluu_webhook.py` (créer)
- `backend/services/providers/__init__.py` (modifier)
- `backend/.env.example` (modifier)
- `backend/routers/fazercards.py` (modifier : ajouter route webhook ALUU)

**Règle : aucun code avant validation de ce plan.**
