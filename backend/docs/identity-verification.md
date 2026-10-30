# Vérification d'identité joueur (PL-003)

Document d'exploitation. Tout est côté backend : aucune interface d'administration n'est
nécessaire, la configuration est une **donnée du document jeu**.

## 1. Architecture

- **FazerCards reste le fournisseur de top-up**, et le vérificateur d'identité **par défaut**.
- **Neferbyte** n'est utilisé que pour les jeux dont le document porte un `identity_verifier`
  Neferbyte. Aucun jeu n'est configuré ainsi aujourd'hui : Free Fire et PUBG Mobile restent sur
  FazerCards et ne touchent ni le cache ni le compteur de quota.
- Le choix se fait par jeu, dans le document `games` : champ absent ou `null` = FazerCards
  (comportement historique). Le retour arrière se fait donc en supprimant le champ — sans
  migration, sans redéploiement de configuration, sans changement de frontend.
- **Anti-doublon** : une commande réserve son identité sur le couple `game_id` + `identity_key`
  (index uniques `identity_game_subscription_unique` et `identity_game_evo_unique`), au lieu du
  seul identifiant PUBG historique.
- Un résultat `valid: true` n'est renvoyé que sur un `ok` réel du fournisseur (frais, ou servi
  depuis le cache des succès). Toute panne est **fail-closed** : `valid: false` ou erreur HTTP.

## 2. Configurer un vérificateur Neferbyte pour un jeu

Le champ `identity_verifier` accepte trois formes :

| Valeur | Effet |
|---|---|
| absent / `null` | FazerCards (défaut historique) |
| `{"provider": "fazercards"}` | FazerCards, retour arrière explicite |
| `{"provider": "neferbyte", "slug": …, "id_field": …, "server_field": …}` | Neferbyte |

Exemple **fictif** de configuration Neferbyte pour un jeu à deux champs :

```json
{
  "provider": "neferbyte",
  "slug": "<slug-du-catalogue>",
  "id_field": "<clé-du-champ-identifiant>",
  "server_field": "<clé-du-champ-serveur-ou-zone>"
}
```

Règles vérifiées à l'écriture (rejet 400, rien n'est enregistré) **et** à la résolution (503
`unsupported_game`, aucun appel) :

- `provider` est obligatoire, et vaut exactement `neferbyte` ou `fazercards`.
- `slug` est obligatoire pour Neferbyte et doit correspondre **à la casse près** à une entrée du
  catalogue `services/neferbyte.py` (`GAMES`). Aucun slug n'est inventé ni normalisé.
- `id_field` est obligatoire et doit être un champ d'identité **déclaré** par le jeu.
- `server_field` est obligatoire si l'endpoint du catalogue prend deux segments (`server`, `tag`),
  interdit s'il n'en prend qu'un.

## 3. Variables d'environnement

| Nom | Défaut | Rôle |
|---|---|---|
| `NEFERBYTE_API_BASE` | `https://api.neferbyte.com` | Base de l'API de vérification. |
| `NEFERBYTE_API_KEY` | *(vide)* | Clé fournie par le bot. Vide = vérification indisponible (503), aucun appel. |
| `NEFERBYTE_TIMEOUT_S` | `6` | Délai d'attente par tentative (un seul nouvel essai, uniquement sur réseau/5xx/pseudo introuvable). |
| `NEFERBYTE_CACHE_TTL_S` | `600` | Durée du cache des **succès** uniquement. `0` ou moins = cache désactivé. |
| `NEFERBYTE_DAILY_LIMIT` | *(vide)* | Plafond d'appels réels par jour UTC. Vide, illisible ou ≤ 0 = pas de plafond (compteur seul + avertissement). |
| `NEFERBYTE_CACHE_SECRET` | *(vide)* | Secret du HMAC qui hache les clés de cache. À défaut, `NEFERBYTE_API_KEY` ; sans aucun des deux, un sel public documenté s'applique. |
| `IDENTITY_KEY_MIGRATION` | `on` | `off` (ou `0`/`false`/`no`) désactive la migration de démarrage des clés d'identité. |
| `IDENTITY_KEY_BACKFILL_BATCH` | `500` | Taille des lots du backfill (bornée 1–10 000). |

Aucune de ces variables ne contient de valeur secrète dans `backend/.env.example` : les secrets
viennent du déploiement ou d'un `.env` local ignoré par Git.

## 4. Migration des clés d'identité

La migration est **additive, idempotente et rejouable**. Elle complète `game_id` / `identity_key`
sur `orders`, `subscription_locks` et `evo_locks`, crée les index uniques
`identity_game_subscription_unique` et `identity_game_evo_unique`, puis **et seulement ensuite**
supprime les index historiques (`pubg_id`). Si un document reste sans clé ou si un index ne peut
pas être créé, elle **s'arrête avant toute suppression** : les anciens index continuent de protéger
et l'application démarre normalement.

À faire sur une **copie** ou une base de test, jamais directement en production
(`<MONGO_URL>`, `<DB_NAME>` et `<SAUVEGARDE>` sont des exemples) :

```bash
# 1. Sauvegarde
mongodump --uri="<MONGO_URL>" --db <DB_NAME> --out <SAUVEGARDE>

# 2. Migration au démarrage désactivée, puis exécution manuelle
cd backend
IDENTITY_KEY_MIGRATION=off MONGO_URL="<MONGO_URL>" DB_NAME="<DB_NAME>" python -m core.identity_keys

# 3. Vérification : le résumé JSON doit finir par "complete": true
#    (sinon "reason" indique backfill_incomplet:<collection> ou index_creation_failed)
mongo "<MONGO_URL>/<DB_NAME>" --eval 'printjson(db.subscription_locks.getIndexes()); printjson(db.evo_locks.getIndexes())'
```

Index attendus après migration : `identity_game_subscription_unique`
(`game_id, identity_key, type`), `identity_game_evo_unique`
(`game_id, identity_key, offer_slug, period_key`), et les index `_id` habituels. Les index
`pubg_id` ne doivent plus apparaître.

**Retour arrière** (avant d'ouvrir le trafic sur l'ancien code) :

```bash
mongo "<MONGO_URL>/<DB_NAME>" --eval '
  db.subscription_locks.createIndex({pubg_id: 1, type: 1});
  db.evo_locks.createIndex({pubg_id: 1, offer_slug: 1, period_key: 1});
  db.subscription_locks.dropIndex("identity_game_subscription_unique");
  db.evo_locks.dropIndex("identity_game_evo_unique");'
```

Puis laisser `IDENTITY_KEY_MIGRATION=off`. Les champs `game_id` / `identity_key` ajoutés aux
documents restent en place : un ajout de champ est inoffensif pour l'ancien code.

## 5. Codes d'erreur vus par le client

| Situation | HTTP | `code` / corps |
|---|---|---|
| Fournisseur indisponible (clé absente/refusée, abonnement, maintenance, quota, panne, plafond local atteint) | `503` | `provider_unavailable` — jamais `valid: true` |
| Délai d'attente dépassé (deux tentatives) | `504` | `provider_unavailable` |
| Jeu sans vérificateur utilisable, ou configuration devenue incohérente | `503` | `unsupported_game` — aucun appel fournisseur |
| Champ exigé par l'offre FazerCards absent ou vide au moment de l'envoi | `409` | `Champ « <clé> » manquant pour ce jeu : commande non envoyée.` — rien n'est envoyé |
| Trop de requêtes depuis la même IP (limite existante des routes de validation) | `429` | `rate_limited` — un 429 de débit momentané ne bloque **pas** la journée |

Les corps de réponse des routes de validation (`POST /fazercards/validate-id`,
`POST /fazercards/pubg/validate-id`) sont **inchangés** pour un jeu FazerCards : même forme, mêmes
codes qu'avant PL-003.

## 6. Hors périmètre

- **Saisie manuelle du pseudo** (vérification impossible, arbitrage humain) : non implémentée. Le
  champ `game_identities.validated` existe mais n'est jamais mis à `true`, et aucun statut
  `pending_manual_review` n'est produit aujourd'hui.
- Interface d'administration dédiée au vérificateur : la configuration se fait dans le document
  jeu (l'API admin des jeux valide simplement la valeur).
- Activation d'un jeu sur Neferbyte : décision d'exploitation, hors code.
