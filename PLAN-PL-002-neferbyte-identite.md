# PL-002 — Plan : vérification ID / ZONE_ID joueur via Neferbyte (Fazercards reste le top-up)

**Rappel de la demande :** basculer le fournisseur de vérification d'ID et ZONE_ID joueur de Fazercards (3 jeux couverts) vers Neferbyte (~34 jeux), tout en gardant Fazercards comme fournisseur de top-up principal. Aucun code n'est écrit par le planificateur ; ce plan sert à générer les prompts des agents Backend / Frontend / Testeur.

**Langue de travail :** français. **Document de règles :** PL-001 (planning-agent-rules.md).

---

## 1. État des lieux (preuves fichiers/lignes)

### Ce qui existe déjà côté frontend (lecture seule, confirmé)
- `frontend/src/components/store/checkout/IdentityFieldsVerify.js:70` : `POST /fazercards/validate-id { game_id, fields }` (ex. `player_id` + `zone_id` depuis la config admin du jeu).
- `frontend/src/components/store/PubgIdVerify.js:37` : `POST /fazercards/pubg/validate-id { player_id }` (legacy PUBG Mobile, garde `/^\d{9,13}$/`).
- `frontend/src/components/store/checkout/StepVerify.js` : orchestre les deux flux, `POST /me/game-identities` en cas de succès, bouton « Continuer » bloqué tant que `verified`.
- `frontend/src/pages/Checkout.js` : `POST /orders { game_id, identity_id, pubg_id, identity_fields, ... }`, redirige `/suivi/${n}?pubg_id=${id}`.
- `frontend/src/lib/api.js:3-6` : axios, `baseURL = REACT_APP_BACKEND_URL + "/api"`, `withCredentials: true` ; `errorMessage()` (ligne 40-46).
- Contrat HTTP actuel (tests) : `data.valid === true` = succès ; `data.valid === false` = ID invalide ; autre = panne. **Ce contrat appartient à Fazercards.**

### Contrat Neferbyte (doc lue en intégralité : `docs-magicgamestor/neferbyte_api_documentation.pdf`, 19 pages)
- `GET https://api.neferbyte.com/game-id-checker/{game}/{id}/{server?}`
- Auth : header `x-api-key` (hash MD5 32 chars) — **doit rester côté serveur**, jamais dans le frontend ni dans le dépôt.
- Succès : `{ success: true, data: { game, userId, username } }` ; erreur : `{ error: true, msg: "..." }`. Brancher sur `success`/`error`, **pas sur le statut HTTP**.
- Slugs **case-sensitive** : `mobile-legends`, `free-fire`, `ff-global`, `pubgm-global`, `valorant`, …
- Cas particuliers : `mobile-legends` exige `{id}/{server}` ; `ff-global` (Garena) renvoie aussi la région ; `valorant` utilise `{name}/{tag}` ; `pokemonunite` ID chaîne ; `bgmi` derrière abonnement add-on ; `pubgm-global` inclut `is_ban`.
- Quota journalier par plan, reset à 00:00 UTC ; mise en cache côté backend recommandée.

### Règles applicables (AGENTS.md + PL-001)
- Rôle : je suis le Planificateur. Pas de code, pas d'installation, pas de push, pas d'appel API de production.
- Backend, paiements et appels API sont hors de mon périmètre d'exécution ; je les planifie, je ne les code pas.
- Fail-closed pour tout ce qui touche l'ID joueur et le paiement (§7 PL-001, §4.4 AGENTS.md).
- Pas de clé API dans le frontend ni dans le dépôt (§4.1 PL-001, §4.5 AGENTS.md).

---

## 2. Décisions déjà prises (Selneker) et décisions à valider

### Décisions déjà prises
1. Neferbyte remplace Fazercards pour la **vérification d'ID joueur uniquement** ; le top-up / paiement reste Fazercards (inchangé).
2. Le contrat HTTP frontend existe déjà et ne change pas → **aucun nouveau endpoint frontend** (le fournisseur interne change côté backend uniquement).
3. Jeux à traiter par Neferbyte : jeux nécessitant vérification ID/ZONE_ID, dont Mobile Legends (server/zone_id), Pokemon Unite (ID chaîne), Valorant (name+tag).

### Décisions à valider par Selneker (bloquantes pour le Backend)
1. **Slug Free Fire** : `free-fire` (Indonésie/SEA) ou `ff-global` (global, renvoie aussi la région) ?
2. **PUBG Mobile** : slug `pubgm-global` — confirmez-vous ?
3. **Préflight** (commande déjà payée) : si Neferbyte est en panne / quota épuisé → avertissement non bloquant (recommandé, sinon commande payée coincée) ou 502 bloquant comme aujourd'hui ?
4. **Config admin** : piloter `identity_provider` / `neferbyte_slug` depuis Admin → Jeux, ou garder la table en code pour ce refactor ?
5. **Quels jeux du catalogue** sont mappés à Neferbyte (au-delà de ML, PUBG, Pokemon Unite, Valorant) ?

---

## 3. Tâches par agent

### Backend (agent DeepSeek)

#### PL-002-BE-1 — Séparer Provider en IdentityProvider + TopupProvider
**Objectif :** isoler la résolution d'identité de la résolution de top-up, comportement inchangé.
**Fichiers concernés :** `backend/services/providers/*`, `backend/core/games.py`. Ne pas toucher au top-up (`create_order`, `get_offers`, webhooks).
**Critères d'acceptation :** `get_provider()` inchangé pour le top-up ; fournisseur d'identité distinct et utilisable par les 3 appels d'identité ; aucun changement de comportement top-up.
**Cas d'erreur :** régression sur le top-up (commande, paiement, webhook) interdite.

#### PL-002-BE-2 — Créer le service Neferbyte (`services/neferbyte.py`)
**Objectif :** appeler `GET https://api.neferbyte.com/game-id-checker/{slug}/{id}[/{server}]` avec header `x-api-key`.
**Fichiers concernés :** `backend/services/neferbyte.py` (nouveau), `.env.example` (`NEFERBYTE_API_BASE`, `NEFERBYTE_API_KEY` vide).
**Critères d'acceptation :** branchement sur `success` (pas sur le statut HTTP) ; erreurs normalisées (`Can't find` → `valid:false` ; quota/auth/maintenance → `503 provider_unavailable` ; timeout → `504`) ; pas de log d'ID/pseudo en clair ; un seul retry, transport uniquement.
**Cas d'erreur :** fournisseur indisponible, quota atteint, ID introuvable, slug inconnu, maintenance — tous mappés sans exposer de détail technique au frontend.

#### PL-002-BE-3 — NeferbyteProvider + table de config d'identité
**Objectif :** routage par jeu entre Neferbyte et FazerCards.
**Fichiers concernés :** `backend/services/providers/` (NeferbyteProvider), table config `IDENTITY_PROVIDER` / `NEFERBYTE_GAMES`, fonction `get_identity_provider()`.
**Critères d'acceptation :** jeu non mappé → FazerCards (comportement actuel) ; mapping incohérent → `503 unsupported_game` ; jeux mappés → Neferbyte.
**Cas d'erreur :** jeu sans fournisseur d'identité configuré.

#### PL-002-BE-4 — Brancher les 3 appels d'identité
**Objectif :** router checkout, router PUBG legacy et `fzr_fulfillment.preflight` vers le fournisseur d'identité.
**Fichiers concernés :** router checkout, router PUBG legacy, `backend/services/fzr_fulfillment.py` (preflight).
**Critères d'acceptation :** les 3 appels utilisent le nouveau fournisseur d'identité ; contrat HTTP inchangé (`valid:true/false`) ; `get_provider()` **non modifié** pour le top-up.
**Cas d'erreur :** fail-closed — pas de validation automatique en cas d'erreur fournisseur.

#### PL-002-BE-5 — Cache TTL + compteur de quota
**Objectif :** cache des résultats (TTL 10 min, clé hashée) + compteur de quota (reset 00:00 UTC).
**Fichiers concernés :** `backend/services/neferbyte.py` (ou couche cache dédiée).
**Critères d'acceptation :** cache fonctionnel avec clé hashée (pas d'ID en clair) ; quota respecté, pas de dépassement silencieux.
**Cas d'erreur :** cache indisponible → appel direct (fail-closed préservé).

#### PL-002-BE-6 — Tests backend + variables d'environnement
**Objectif :** couvrir Neferbyte avec des tests unitaires.
**Fichiers concernés :** `backend/test_neferbyte_identity.py` (nouveau), `.env.example`.
**Critères d'acceptation :** tests passent avec un **ID réel valide** et un **ID invalide** pour chaque jeu mappé ; `.env.example` documenté (clé vide).
**Cas d'erreur :** ID invalide refusé, fournisseur en panne → pas de validation automatique.

### Frontend (agent Minimax)

#### PL-002-FE-1 — Audit frontend : confirmer qu'aucun changement n'est nécessaire
**Objectif :** vérifier que le contrat HTTP inchangé (`POST /fazercards/validate-id`, `{valid:true/false}`) ne requiert aucune modification frontend.
**Fichiers concernés :** `frontend/src/components/store/checkout/IdentityFieldsVerify.js`, `PubgIdVerify.js`, `StepVerify.js`, `Checkout.js`, `CheckoutConfirm.js` (lecture seulement ; modification uniquement si un jeu requiert un champ identité absent de la config admin).
**Critères d'acceptation :** `yarn build` et `yarn test:ci` passent ; aucun nouvel appel vers Neferbyte depuis le frontend ; pas de clé API exposée.
**Cas d'erreur :** si un jeu requiert un champ d'identité non présent dans la config admin, le signaler comme bloquant plutôt que de l'ajouter en silence.

### Testeur (agent Nemotron, Playwright)

#### PL-002-QA-1 — Scénarios de vérification d'ID
**Objectif :** valider le parcours ID sur environnement de test.
**Fichiers concernés :** scénarios Playwright (à créer), pas de modification de code source.
**Critères d'acceptation :** cas normal (ID valide → succès, pseudo affiché pour confirmation avant paiement), ID invalide → refus de la commande, fournisseur en panne → confirmation manuelle (jamais validation automatique), timeout → confirmation manuelle, quota atteint → confirmation manuelle.
**Cas d'erreur :** aucun scénario critique en échec avant passage à Selneker.

---

## 4. Ordre d'exécution et dépendances

1. `PL-002-BE-1` (séparation Provider) — fondation.
2. `PL-002-BE-2` (service Neferbyte) — dépend de BE-1.
3. `PL-002-BE-3` (NeferbyteProvider + config) — dépend de BE-2.
4. `PL-002-BE-4` (brancher les 3 appels) — dépend de BE-3.
5. `PL-002-BE-5` (cache + quota) — dépend de BE-4.
6. `PL-002-BE-6` (tests backend) — dépend de BE-5 ; backend fige le contrat.
7. `PL-002-FE-1` (audit frontend) — après que le contrat backend est figé et validé par Selneker (porte de sortie §9.6).
8. `PL-002-QA-1` (tests Playwright) — après BE-6 et FE-1.

**Porte de sortie Backend → Frontend :** le contrat est écrit et validé par Selneker avant tout code frontend qui en dépend.

---

## 5. Risques et plan B

| Risque | Impact | Plan B |
|---|---|---|
| Fournisseur Neferbyte indisponible ou quota épuisé | Vérification ID bloquée | Confirmation manuelle (fail-closed) ; préflight non bloquant si choisi par Selneker (décision Q3) |
| Slug de jeu incohérent (Free Fire, PUBG) | Vérification échoue pour ce jeu | Ne pas mapper le jeu jusqu'à confirmation du slug (décision Q1/Q2) |
| Jeu non mappé / mapping incohérent | Vérification inopérante | Retour immédiat à FazerCards (retirer le jeu de `IDENTITY_PROVIDER`), pas de migration, pas de frontend |
| Quota Neferbyte épuisé | Vérification bloquée | Cache TTL 10 min + compteur ; confirmation manuelle au-delà |
| Changement de contrat HTTP | Régression frontend | Contrat figé `valid:true/false` ; pas de modification frontend sans validation Selneker |

---

## 6. Plan de test

- **Cas normal :** ID valide → fournisseur confirme succès → pseudo affiché au client pour confirmation avant paiement → commande créée.
- **ID invalide :** `valid:false` / `success:false` → commande refusée, message traduit, aucun détail technique exposé.
- **Fournisseur en panne :** 5xx / timeout → confirmation manuelle, jamais validation automatique.
- **Timeout :** un seul nouvel essai, puis confirmation manuelle.
- **Quota atteint :** réponse quota → confirmation manuelle.
- **Pseudo trouvé :** montré au client avant paiement (§7.4 PL-001).
- **Validation :** un ID réel valide et un ID invalide pour chaque jeu mappé avant mise en ligne.

---

## 7. Non vérifié (à confirmer par Selneker ou par les agents à l'exécution)

- Slugs exacts : `free-fire` vs `ff-global` ; `pubgm-global` pour PUBG.
- Comportement préflight en cas de panne/quota (avertissement non bloquant ou 502 bloquant).
- Config admin vs table en code pour piloter `identity_provider` / `neferbyte_slug`.
- Liste exacte des jeux du catalogue mappés à Neferbyte.
- Que le contrat HTTP reste bien `valid:true/false` après le changement de fournisseur interne côté backend.
- Que la config admin contient déjà les champs d'identité (server/zone_id pour ML, name/tag pour Valorant, ID chaîne pour Pokemon Unite) — sinon c'est un blocant frontend.

---

**ID du plan :** `PL-002` (jamais réutilisé).  
**Prochaine étape après validation des 5 décisions :** rédaction des prompts d'agent, chacun commençant par son ID (`PL-002-BE-1`, `PL-002-FE-1`, `PL-002-QA-1`, …), conformément à la chaîne d'agents §9 de PL-001.
