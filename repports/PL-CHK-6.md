# PL-CHK-6 — Fin de la boucle : une commande en attente s'offre, elle ne s'impose jamais

Branche : `fix/chk-6-no-loop` (depuis `origin/main` = `4d69fee`, PL-CHK-5 fusionné via PR #91)
Lot : **PL-CHK-6** — la commande mémorisée (`mgs_pending_order_id`) ne bloque plus la création d'une
nouvelle commande ; toute commande invalide meurt en silence à chaque lecture ; « Recommencer »
devient effectif.
**Demande explicite du propriétaire : fusion dans `main` + push (dérogation au « aucun push » initial).**

---

## 1. Causes (étape 0) — fichier:ligne, avant modification

**Cause 1 — la redirection automatique du tunnel (la boucle elle-même).**
`frontend/src/pages/Checkout.js:101-109` : l'effet de reprise PL-CHK-3 lisait `readPendingOrderId()`
et, si l'API renvoyait un statut actif, faisait `navigate('/orders/${data.id}', { replace: true })`.
La commande invalide (manuelle sans `manual_operator` = statut actif mais non payable) restait
mémorisée : chaque ouverture de `/commande` expulsait le client du tunnel. `recovering`
(`Checkout.js:67`) gelait en plus l'écran « panier vide » pendant la reprise.

**Cause 2 — « Recommencer » muet.**
`frontend/src/pages/OrderTrack.js:327-333` : `restart-button` était un `<Link to="/boutique">` nu —
**aucun `clearPendingOrderId()`**, aucune navigation d'état. Idem `proof-restart`
(`frontend/src/components/store/checkout/ProofPay.js:375`, `<Link to="/boutique">`).
L'effet de purge de `OrderTrack.js:171-173` ne couvrait que `RESUME_DONE`
(`paid/delivered/cancelled/failed/expired`) — **pas** le cas `manual` sans `manual_operator` :
la clé survivait à « Recommencer » et la bannière (ou l'ancienne reprise) reproposait la commande
à l'infini.

**Cause 3 — qui touchait la clé.**
`frontend/src/lib/pendingOrder.js` (clé `mgs_pending_order_id`, purge 24 h dans `candidateOrderId()`).
Écriture : `Checkout.js:192` (création). Lectures + purges partielles : `Checkout.js:104-108`
(purge seulement les statuts finaux), `PendingOrderBanner.js:60-79` (invité : purge 403/404/statut
final ; connecté : `actives[0]` **sans validation**), `OrderTrack.js:171-173` (`RESUME_DONE` seulement).

**Cause 4 — client connecté : commande invalide en bannière.**
`frontend/src/components/store/PendingOrderBanner.js:55-57` : `/orders/me` filtré sur
`ACTIVE_STATUSES` puis `actives[0]` retenu tel quel — une commande manuelle sans opérateur (ou tout
autre cas non payable) pouvait être proposée en bannière, et l'ordre réel de `/orders/me` n'était
pas garanti comme « plus récent d'abord ».

---

## 2. Question 5 — le frontend envoie/relit-il `manual_operator` pour une commande neuve ?

**Oui, prouvé par lecture (aucun changement nécessaire côté frontend) :**

- **Envoi à la création** : `frontend/src/pages/Checkout.js` (payload `/orders`) :
  `payment_method: method === "binance" ? "binance" : "manual"` et
  `...(method && method !== "binance" ? { manual_operator: method } : {})` — couvert par les tests
  `Checkout.test.js` « payload payment_method=manual + manual_operator=mvola|orange ».
- **Relecture à l'écran de paiement** : `frontend/src/pages/OrderTrack.js` :
  `const op = order.manual_operator` (`"mvola" | "orange" | null`) ; l'écran dédié
  `resume-unpayable` s'affiche quand `op` est `null` (commande très ancienne ou backend qui
  n'enverrait pas le champ).
- **Conclusion** : le frontend est conforme. Si une commande neuve se retrouve malgré tout sans
  `manual_operator`, c'est que le **backend déployé** n'enregistre pas / ne renvoie pas le champ —
  hors périmètre frontend, à vérifier côté API (`backend/`, non exécutable dans cet environnement :
  pas de MongoDB/docker/sudo, cf. AGENTS.md).

---

## 3. Implémentation — fichier:ligne (après modification)

| Tâche | Fichier | Quoi |
|---|---|---|
| — | `frontend/src/lib/pendingOrder.js` | `PENDING_ACTIVE_STATUSES`, `isUsablePendingOrder(order)` (statut actif **ET** opérateur présent si manuel) et `restartTarget(order)` (`/boutique?game=${game_id}`, `/` si jeu inconnu) — règle partagée par toutes les lectures |
| T1 | `frontend/src/pages/Checkout.js` | **Effet de reprise supprimé** (ancien :101-109), `recovering` supprimé (ancien :67, :257 → `items.length === 0`), import `readPendingOrderId`/`clearPendingOrderId` retiré ; la seule redirection reste celle qui suit la création réussie (`:192-193` écrit la clé **remplacée**, navigate `replace`) |
| T2 | `frontend/src/pages/OrderTrack.js` | Effet de purge étendu : clé purgeée si elle pointe sur **cette** commande et statut `RESUME_DONE` **ou** manuelle sans opérateur ; **403/404** : purge dans le `catch` si la clé pointe sur l'URL courante ; purge bornée à l'identité de la commande (une autre commande mémorisée n'est jamais purgée par erreur) |
| T2 | `frontend/src/pages/OrderTrack.js` | `restart()` : `clearPendingOrderId()` **puis** `navigate(restartTarget(order), { replace: true })` — branché sur `restart-button` (désormais un `<Button type="button">`, plus un Link) |
| T2 | `frontend/src/components/store/checkout/ProofPay.js` | `ProofExpired` : `proof-restart` = handler (purge + navigate, `useNavigate`) ; `EndScreen` (`cancelled`/`failed`) : bouton **« Recommencer »** ajouté (purge + navigate), `proof-home` conservé en sortie secondaire |
| T2 | `frontend/src/components/store/PendingOrderBanner.js` | Invité : la commande lue passe par `isUsablePendingOrder` — non utilisable → `clearPendingOrderId()` + rien affiché (403/404 inchangé) ; `refetch` : même validation |
| T2 | `frontend/src/pages/OrderTrack.js` | Annulation réussie : `onCancelled` purge la clé avant de naviguer (`/`, `replace`) — le POST réussi n'est suivi d'aucun refetch, la clé survivait sinon ; le 409 de conflit ne passe **pas** dans `onCancelled` (clé conservée, commande toujours en attente) |
| T3 | `frontend/src/pages/OrderTrack.js` | `resume-unpayable` : bouton discret `resume-back-home` (« Retour à l'accueil », `order.backHome` existant, variante `outline`) sous le message, plus `restart-button` fixé en bas |
| T4 | `frontend/src/components/store/PendingOrderBanner.js` | Connecté : candidates = `/orders/me` filtré `isUsablePendingOrder`, **trié par `created_at` décroissant** → `actives[0]` = plus récente **valide** ; une invalide n'est jamais retenue (passe à la suivante ou bannière absente) |

- i18n : **aucune nouvelle clé** (`checkout.restart`, `order.backHome` existaient déjà) ; parité
  re-vérifiée : **fr 926 / en 926**.
- `CheckoutConfirm.js` (`/commande/confirmation`, alias historique PL-CHK-4) : inchangé — ce n'est
  pas le tunnel, il ne redirige que sur un candidat < 24 h, et la bannière n'y est jamais affichée.
- Limite connue hors périmètre : la liste `/suivi` (PL-CHK-3) peut encore proposer « Envoyer la
  preuve » sur une commande manuelle sans opérateur — l'écran cible affiche alors
  `resume-unpayable` + « Recommencer » effectif (aucune boucle possible).

---

## 4. Tests

Baseline avant lot : **34 suites / 381 tests** (fin PL-CHK-5). Après : **34 suites / 398 tests**
(**+17**, 0 échec).

- `Checkout.test.js` — le bloc « reprise PL-CHK-3 » (redirection attendue) est remplacé par
  « le tunnel n'impose jamais une commande en attente » : clé active → **aucun** appel
  `/orders/{id}`, **aucune** navigation, formulaire utilisable ; clé invalide (manuel sans
  opérateur) → idem ; création réussie → clé **remplacée** (`o-ancienne` → `o1`) ;
  panier vide + clé → écran « panier vide », jamais de redirection ; **stockage indisponible**
  (g) → l'écran 1 fonctionne et la création réussit.
- `OrderTrack.test.js` — `resume-unpayable` : `resume-back-home` vers `/`, clic
  `restart-button` → `navigate("/boutique?game=pubg-mobile", { replace: true })` + clé purgée ;
  manuelle sans opérateur vue par l'API → clé pointée purgée ; statut final sur une **autre**
  commande → clé d'une autre commande **jamais** purgée ; `expired/cancelled/failed` → clic
  `proof-restart` → purge + écran 1 du jeu (variante jeu inconnu → `/`) ; 403/404 sur une
  commande mémorisée → clé purgée ; annulation confirmée → POST cancel + **clé purgée** +
  navigation `/` (replace). Mock `useNavigate` devenu partagé (`mockNavigate`).
- `ProofPay.test.js` — écran 8 : `proof-restart` = handler (plus de `href`), clic → purge +
  `/boutique?game=pubg-mobile` ; `cancelled` : « Recommencer » + `proof-home`.
- `PendingOrderBanner.test.js` — `baseOrder` porté à `manual_operator: "mvola"` (réalité
  PL-CHK-5) ; nouveaux : connecté — l'invalide (plus récente) n'est **jamais** retenue, la valide
  plus ancienne passe devant ; toutes invalides → bannière absente ; invité — manuelle sans
  opérateur → jamais affichée, entrée purgée. Le test « sans stockage » (g) existant reste vert.

```
Test Suites: 34 passed, 34 total
Tests:       398 passed, 398 total
```

## 5. Build & audit de contraste

- `yarn build` (`REACT_APP_BACKEND_URL=http://localhost:8001`) : OK, aucun warning ESLint
  (les 2 warnings affichés sont pré-existants : dépréciation Node `fs.F_OK`, classe Tailwind
  arbitraire `duration-[420ms]`).
- `yarn audit:contrast` sur la branche : **TOTAL : 0 echec** (exit 0, 977,24 s), 390 px et 1440 px,
  clair et sombre — aucune couleur touchée par ce lot, aucune exclusion modifiée.
- Règle permanente n° 12 : audit re-lancé sur `main` **après fusion** (`8dee44e`) :
  **TOTAL : 0 echec** (exit 0, 880,92 s) — `main` conforme avant déploiement.

## 6. Captures (`repports/captures/PL-CHK-6/`, non commitées)

Driver : `frontend/capture-pl-chk-6.mjs` (non commité, modèle PL-CHK-5 ; stub Turnstile, API
simulée, 0 appel production). 10 PNG (5 scénarios × 360×640 × clair/sombre) + `controle-scenario.json`
— **10/10 vérifications OK** :

1. `01-tunnel-cle-invalide` — `/commande` avec clé → commande manuelle sans opérateur : le tunnel
   s'affiche normalement, URL inchangée, aucune redirection.
2. `02-resume-unpayable` — message + « Retour à l'accueil » discret + « Recommencer » fixé en bas.
3. `03-recommencer-boutique` — clic « Recommencer » → `/boutique?game=pubg-mobile`, **clé purgée**,
   bannière absente.
4. `04-recommencer-expire` — écran 8 → clic `proof-restart` → `/boutique?game=pubg-mobile`, clé purgée.
5. `05-banniere-commande-valide` — invité avec commande valide : bannière « Continuer » offre la
   commande, la boutique reste utilisable.

## 7. Commit & fusion

- Commit branche : **`113e8db`** — `PL-CHK-6: le tunnel n'impose jamais une commande en attente — purge
  silencieuse des commandes invalides (statut final, 403/404, manuel sans operateur), Recommencer
  effectif vers l'ecran 1 du jeu, banniere connecte: plus recente valide, retour accueil discret`
- `git diff --name-only origin/main | grep -Ei '\.(png|jpe?g|webp)$'` : **vide** (aucune image dans le diff).
- Fichiers commités (9, chemins explicites ; `Issues/`, `repports/`, drivers de capture jamais ajoutés) :
  `frontend/src/lib/pendingOrder.js`, `frontend/src/pages/Checkout.js` (+test),
  `frontend/src/pages/OrderTrack.js` (+test), `frontend/src/components/store/PendingOrderBanner.js` (+test),
  `frontend/src/components/store/checkout/ProofPay.js` (+test).
- Fusion dans `main` : **`8dee44e`** (merge `--no-ff` de `fix/chk-6-no-loop`, `git push origin main`
  `4d69fee..8dee44e`) — `main` == `origin/main`. Revalidation sur `main` : `yarn build` OK,
  `yarn test:ci` 34 suites / 398 tests, 0 échec.

## 8. Non vérifié ici

- **Backend réel** non exécutable dans cet environnement (pas de MongoDB/docker/sudo) : les
  contrats (`GET /orders/{id}` retournant `manual_operator`, `POST /orders/{id}/cancel`) ont été
  vérifiés **par lecture**. À valider par l'utilisateur sur l'API réelle, notamment que le backend
  déployé renvoie bien `manual_operator` sur les commandes neuves (question 5).
- **Appareils réels** (390 px réseau lent, iOS/Android) : captures faites à 360×640 headless ;
  validation manuelle sur téléphone à faire avant déploiement, comme pour chaque phase.
