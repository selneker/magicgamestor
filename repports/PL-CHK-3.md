# PL-CHK-3 — Reprise de commande en attente (page complète, bannière, liste)

Branche `feat/chk-3-resume` (base `a36adb4` = origin/main) · un commit · aucun push
Frontend uniquement — **aucun changement backend, aucune nouvelle dépendance.**

---

## ⚠️ Donnée manquante côté API (à traiter en premier)

**L'opérateur manuel choisi (Mvola / Orange) n'est pas persisté.** Au checkout, il vit
uniquement dans l'état local `reference.provider` du tunnel :

- saisie : `frontend/src/components/store/PaymentFlow.js` — `ManualPanel`, état `reference`
  remonté depuis `frontend/src/pages/Checkout.js` (`setReference({ ...reference, provider })`) ;
- le payload `POST /orders` n'envoie **aucun** champ opérateur (`manual_reference` n'est plus
  envoyé du tout depuis PL-CHK-2) ;
- la lecture `GET /orders/{id}` (projection `PUBLIC = {"_id": 0}`,
  `backend/routers/orders.py:31`) et `public_order` (`orders.py:128-139`) ne renvoient donc
  **pas** l'opérateur : `payment_method: "manual"` seulement ;
- il n'est même pas survécu au rechargement dans le checkout lui-même (défaut `"mvola"`
  appliqué à chaque rechargement — préexistant, noté aussi).

**Champ exact à ajouter côté backend (proposition, hors périmètre de ce lot)** :

```
order.manual_operator : str | None  — pattern "mvola" | "orange", null si payment_method != "manual"
```

- rempli par le validateur de `POST /orders` depuis un champ optionnel du payload ;
- exposé tel quel par `public_order()` (aucune donnée sensible, pas de projection à masquer) ;
- le front le lira alors sur la commande et présélectionnera le picker de l'écran de reprise
  (`ManualProviderPicker` — `frontend/src/components/store/PaymentFlow.js:194`).

**En attendant**, conformément à la consigne (« ne l'invente pas »), l'écran de reprise affiche
le sélecteur d'opérateur (composant partagé avec l'étape 2 du checkout) et le client choisit
explicitement Mvola ou Orange avant de payer — le code USSD, le numéro marchand et le bouton
d'appel suivent le choix. Tests : `OrderTrack.test.js` (« changement d'opérateur met à jour le
code USSD »).

---

## Étape 0 — Inventaire (fichier:ligne)

| Élément | Référence |
|---|---|
| Route de suivi existante | `frontend/src/App.js:54-55` (`/suivi`, `/suivi/:orderNumber` → `<OrderTrack />`) |
| Page de suivi | `frontend/src/pages/OrderTrack.js` (recherche via `GET /orders/track`, historique `GET /orders/me` :155-158) |
| Liste des commandes du client connecté | historique rendu par `OrderTrack` (:198-244), API `GET /orders/me` (`backend/routers/orders.py:397-400`, tri `created_at` desc) |
| Lecture d'une commande | `GET /orders/{id}` (`orders.py:428-432`), accès **invité par UUID** via `_accessible_order` (:143-154) — l'UUID est un secret de fait |
| Ce que renvoie la lecture | projection `PUBLIC = {"_id": 0}` (:31) → commande presque complète : `payment_method`, `total/subtotal/payment_fee`, `status`, `payment_deadline_at` (garanti par `public_order` :133-135), `payment_proofs` (nettoyées `blob_name`/`sha256` :136-139), `game_id`, `items`, `pubg_id`. **Manque : l'opérateur manuel** (cf. tête de rapport) |
| Numéro à payer | non stocké sur l'order ; il vient de la config `GET /payments/config` → `providers.{mvola,orange}.merchant` (consommé par `Checkout.js:127`, réutilisé tel quel par l'écran de reprise) |
| Composants étape 3 réutilisés | `ProofPay` + `LateScreen`/`EndScreen`/`ProofExpired` (`frontend/src/components/store/checkout/ProofPay.js`, branches :62-71, exports fin de fichier), `PaymentCountdown` (`PaymentCountdown.js:11`, prop `order`, `onZero`), `BinancePay` (`checkout/BinancePay.js:9`, slot rouvert via `GET /crypto/{id}/status`) |
| Chrome bas / barre panier | `frontend/src/lib/bottomChrome.js` (le checkout `/commande` masque déjà le chrome bas ; la bannière n'apparaît jamais sur `/commande` ni `/orders/:id`) |
| Point d'insertion bannière | `frontend/src/components/layout/Layout.js` — sous `<Header />` (:23), au-dessus de `<main>` |
| Transition de page | `frontend/src/components/layout/PageTransition.js` `TAB_ORDER` groupe 2 |

---

## Tâche 1 — Page de commande = écran de reprise

- **Route** : `frontend/src/App.js:57` — `<Route path="/orders/:orderId" element={<OrderTrack />} />`.
- **Sélecteur** : `OrderTrack.js:246-251` — le composant par défaut est un sélecteur sans hook
  conditionnel : `/orders/:orderId` monte `OrderResume`, les autres routes gardent la page de
  recherche inchangée.
- **`OrderResume`** (`OrderTrack.js:130-244`) :
  - lecture `GET /orders/{orderId}` (propriétaire connecté **ou** invité porteur de l'UUID) ;
  - **403/404** → message générique sans détail + retour accueil
    (`order.notAvailable`, `order.notAvailableBody`, `order.backHome`, testids
    `order-not-available`, `order-back-home`) — **jamais** le numéro de commande ni le statut ;
  - statut final vu par l'API → `clearPendingOrderId()` (`OrderTrack.js:162-165`) ;
  - branches de statut — **composants de l'étape 3 réutilisés, aucune copie de code** :
    - `pending_payment` + `manual` : `ManualProviderPicker` (partagé avec `ManualPanel`,
      `PaymentFlow.js:194`) + `ProofPay` complet (USSD, montant, zone de preuve, écran
      d'attente) — `OrderTrack.js:206-213` ;
    - `pending_payment` + auto (mvola/orange/fiveone) : `PaymentCountdown` + bouton de
      reprise du provider via le sondage `/payments/{id}/status` (5 s, inchangé) —
      `OrderTrack.js:214-224` ; relance `POST /payments/initiate` conservée pour
      `failed`/`expired` auto (`retry-payment-button`) ;
    - `pending_payment` + `binance` : slot rouvert via `GET /crypto/{id}/status` —
      **jamais de 2ᵉ initiation** (`api.post` jamais appelé sur cet écran, testé) ;
    - `proof_submitted` : `ProofPay` → `ProofWaiting` (Relancer + cooldown, poll 10 s → 20 s
      → 30 s, onglet visible seulement, arrêt au démontage — inchangés PL-CHK-2) ;
    - `late_payment` → `LateScreen`, `expired` → `ProofExpired` (bouton recommencer),
      `cancelled`/`failed` → `EndScreen`, `paid`/`delivered`/`awaiting_verification` →
      carte seule (le texte `order.next.*` y est déjà) ;
  - carte de commande (`OrderCard`) **toujours visible en haut**, composant de statut dessous ;
  - compte à rebours à 0 → `onZero` = refetch de l'état réel (`OrderTrack.js:169`).
- **Transitions** : groupe 2 de `TAB_ORDER` étendu à `/orders`
  (`PageTransition.js:11`) — même sens de slide que `/suivi`.

## Tâche 2 — Mémoriser la commande en cours

- **Util** : `frontend/src/lib/pendingOrder.js` — clé `mgs_pending_order_id`, contenu
  **uniquement** `{ id, createdAt }`, `try/catch` sur chaque accès (site fonctionnel sans
  stockage), péremption 24 h (`candidateOrderId()` purge l'entrée périmée et renvoie `null`).
- **Écriture à la création** : `frontend/src/pages/Checkout.js:211`
  (`writePendingOrderId(data.id, data.created_at || …)` après `POST /orders`) ; **effacement**
  au statut terminal : `Checkout.js:166` (effet `DONE_STATUSES`).
- **Effacement côté reprise** : `OrderTrack.js:162-165` (statut final vu par l'API) et
  `PendingOrderBanner.js` (404/403/statut final → `clearPendingOrderId()` silencieux).
- **Client connecté** : l'API fait foi — `PendingOrderBanner` lit `GET /orders/me` filtré
  `[pending_payment, proof_submitted]` (déjà trié desc côté backend), **sans dépendre du
  stockage** ; l'écran de reprise lit `GET /orders/{id}`.
- **Invité** : `candidateOrderId()` → `GET /orders/{id}` de vérification **avant** affichage ;
  entrée périmée (>24 h), inconnue (404) ou déjà finale → supprimée en silence.

## Tâche 3 — Bannière « Commande en cours »

- **Composant** : `frontend/src/components/store/PendingOrderBanner.js` (+ `.test.js`, 9 tests).
- **Insertion** : `Layout.js:23`, sous `<Header />`, avant `<main>`.
- **Visibilité** (`visibleOn`, `PendingOrderBanner.js:14-15`) : `/`, préfixes `/jeux`,
  `/boutique`, `/produit/`, `/pack-evolutif` — **jamais** `/commande` ni `/orders/:id` (testé :
  aucun appel API sur ces routes).
- **Contenu** : logo jeu (fallback `GameLogo`), statut (« Commande en cours » ou
  « Preuve envoyée · vérification en cours »), montant, compte à rebours **réutilisé**
  (`PaymentCountdown` : `role="timer"`, annonces sr-only aux seuls paliers 5 min / 1 min /
  expiration, aucune animation — `prefers-reduced-motion` respecté de fait), bouton
  **Continuer** → `/orders/:id` (`banner-continue`).
- **Multi-commandes (connecté)** : plus récente affichée + lien « Voir mes commandes » →
  `/suivi` (`banner-view-orders`, connecté uniquement).
- **Aucun saut de mise en page** : pendant le chargement, un **slot de hauteur réservée**
  (même gabarit que la carte, `min-h-[68px]`, `pending-order-banner-loading`) est rendu ; si
  aucune commande → rendu sans espace (`null`).
- **Échéance à 0** sur la bannière → refetch ; statut final → bannière disparue + entrée
  purgée. La dernière requête gagne (`requestId`) : navigation rapide sans état périmé.

## Tâche 4 — Liste des commandes

- `frontend/src/pages/OrderTrack.js:340-349` — chaque commande
  `pending_payment`/`proof_submitted` de l'historique reçoit un bouton → `/orders/{id}`
  (`history-resume-{numéro}`) :
  - `pending_payment` + manual → **« Envoyer la preuve »** (`order.resumeProof`) ;
  - `pending_payment` + auto → **« Continuer le paiement »** (`order.resumePay`) ;
  - `proof_submitted` → **« Voir l'état »** (`order.resumeView`) ;
  - statuts finals : aucun bouton. Badges de statut PL-CHK-2 inchangés (`StatusPill`).

## Tâche 5 — Cas limites

- **Compte à rebours à 0** : `PaymentCountdown onZero` → refetch `GET /orders/{id}` (reprise
  `OrderTrack.js:169`, bannière `PendingOrderBanner.js` `refetch`) ; l'état réel remplace
  l'écran (ex. `expired` → `ProofExpired`).
- **Double envoi de preuve (2 onglets)** : le serveur reste l'autorité — les codes `proof_*`
  (`proof_conflict`, `proof_limit`, …) affichent leurs messages via `proofErrorMessage`
  (`ProofPay.js`, inchangé) ; aucun chemin front ne poste la preuve hors de `ProofPay`.
- **Commande d'un autre client** : 403 → message générique (`order-not-available`), testé.
- **Aucune boucle de redirection** : le checkout ne navigue plus vers le suivi que dans le cas
  Binance sans slot actif (PL-CHK-2, inchangé) ; `/orders/:id` ne redirige jamais — il affiche.

## i18n (parité FR/EN exacte)

`frontend/src/i18n/translations.js` — namespace `order` :
FR :108-110 · EN :263-265 — `banner.{live,continue,viewOrders,proofWaiting}`,
`resumePay`, `resumeProof`, `resumeView`, `notAvailable`, `notAvailableBody`, `backHome`.
`checkout.chooseOperator` (existant) réutilisé par `ManualProviderPicker`.

## Tests

Nouveaux / étendus (motif du dépôt : `createRoot` + `act`, router v7 mocké, api mockée,
aucun backend) :

- `src/lib/pendingOrder.test.js` (4) : `{id, createdAt}` seulement ; JSON corrompu muet ;
  purge 24 h ; **stockage indisponible → aucun plantage** (surcharge `Storage.prototype` —
  jsdom : `localStorage` est un Proxy, la surcharge d'instance ne marche pas).
- `src/components/store/PendingOrderBanner.test.js` (9) : invisible sur
  `/commande`, `/commande/confirmation`, `/orders/x`, `/suivi` (0 appel API) ; connecté
  multi-commandes → plus récente + « Voir mes commandes » ; connecté une seule → pas de lien ;
  connecté statut final → absente ; invité via stockage vérifié par l'API ; entrée 404
  supprimée en silence ; statut final → purgée ; `proof_submitted` → texte dédié + countdown ;
  stockage indisponible.
- `src/pages/OrderTrack.test.js` (+14) : reprise manual (picker + USSD + zone de preuve),
  changement d'opérateur → code USSD orange ; auto mvola (countdown + bouton, **pas** de zone
  de preuve) ; binance (slot rouvert via `/crypto/{id}/status`, `api.post` jamais appelé ;
  sans slot → countdown seul) ; `proof_submitted`/`late_payment`/`expired`/`failed` → écrans
  dédiés ; `paid` → carte seule ; 403 → générique sans détail + retour accueil ; **arrêt du
  sondage au démontage** (temps réel : 1ᵉʳ refresh immédiat, intervalle 5 s, plus aucun appel
  après unmount) ; boutons de liste (labels + href, aucun bouton sur statut final).
- `src/pages/Checkout.test.js` : création mvola → `localStorage["mgs_pending_order_id"]`
  contient **exactement** `{ id, createdAt }`.

**Avant** (baseline `a36adb4`) : 33 suites / 357 tests.
**Après** : **35 suites / 384 tests — 0 échec, 0 ignoré** (`yarn test:ci`).

## Build & audit

- `REACT_APP_BACKEND_URL=http://localhost:8001 yarn build` → OK (bundle généré).
- `yarn audit:contrast` (Chromium système, bundle compilé) :

```
$ REACT_APP_BACKEND_URL=http://localhost:8001 yarn build   # OK
$ CHROMIUM_PATH=/home/selneker/.local/bin/google-chrome yarn audit:contrast

================ CONTRASTE : ECHECS PAR PAGE ================
page                      390px clair   390px sombre   1440px clair  1440px sombre  
accueil                   0             0             0             0             
catalogue                 0             0             0             0             
checkout-1-verification-initiale0             0             0             0             
checkout-1-verification   0             0             0             0             
checkout-2-methode        0             0             0             0             
checkout-3-ussd-mvola     0             0             0             0             
checkout-3-ussd-orange    0             0             0             0             
checkout-3-preuve         0             0             0             0             
checkout-3-preuve-vignettes0             0             0             0             
statut-paiement           0             0             0             0             
fiche-produit             0             0             0             0             
compte                    0             0             0             0             
suivi                     0             0             0             0             
fidelite                  0             0             0             0             
verif-invalide            0             0             0             0             
verif-champ-manquant      0             0             0             0             
verif-503                 0             0             0             0             
verif-429                 0             0             0             0             
verif-html                0             0             0             0             
verif-succes              0             0             0             0             
pubg-invalide             0             0             0             0             
pubg-503                  0             0             0             0             
pubg-html                 0             0             0             0             
fidelite-pubg-invalide    0             0             0             0             
fidelite-pubg-503         0             0             0             0             
fidelite-pubg-html        0             0             0             0             
admin-dashboard           0             0             0             0             
admin-commandes           0             0             0             0             
admin-catalogue           0             0             0             0             
admin-jeux                0             0             0             0             
admin-fournisseur         0             0             0             0             
admin-paiements           0             0             0             0             
admin-evenements          0             0             0             0             
admin-messages            0             0             0             0             
admin-messages-conversation0             0             0             0             
admin-fidelite            0             0             0             0             
admin-utilisateurs        0             0             0             0             

  TOTAL : 0 echecs
EXIT=0
```

**0 échec · 0 page non chargée · exit 0** (pages non chargées : aucune — le tableau ci-dessus
est complet, aucune ligne manquante ; durée réelle 1162 s).

- Images dans le diff : `git diff --name-only origin/main | grep -Ei '\.(png|jpe?g|webp)$'` →
  **vide** (les captures vivent dans `repports/captures/PL-CHK-3/`, jamais commité).

## Captures (360 et 390 px, clair + sombre)

Reconstituées via un driver local (build servi sur 127.0.0.1, `/api/**` interceptées — aucun
appel production) : bannière « en cours », bannière « preuve envoyée », reprise manuelle
(picker + USSD + zone de preuve), reprise `proof_submitted`, reprise `expirée`, liste avec
boutons.

```
$ ls repports/captures/PL-CHK-3/   # 24 PNG, jamais committés

banner-pending-360-dark.png    banner-pending-360-light.png    banner-pending-390-dark.png    banner-pending-390-light.png
banner-proof-360-dark.png      banner-proof-360-light.png      banner-proof-390-dark.png      banner-proof-390-light.png
list-resume-360-dark.png       list-resume-360-light.png       list-resume-390-dark.png       list-resume-390-light.png
resume-expired-360-dark.png    resume-expired-360-light.png    resume-expired-390-dark.png    resume-expired-390-light.png
resume-manual-360-dark.png     resume-manual-360-light.png     resume-manual-390-dark.png     resume-manual-390-light.png
resume-proof-360-dark.png      resume-proof-360-light.png      resume-proof-390-dark.png      resume-proof-390-light.png
```

Vérifiées visuellement (au moins) :
- `resume-manual-390-light` : picker MVola/Orange (MVola actif), compte à rebours, récap,
  code USSD `#111*1*2*0383905692*2500*1*0#`, numéro marchand, zone « Envoyer la preuve » ;
- `banner-pending-390-light` : carte « Commande en cours · 660 UC », compte à rebours
  mm:ss, bouton Continuer ;
- `banner-proof-390-dark` : « Preuve envoyée · vérification en cours » en thème sombre ;
- `resume-proof-390-dark` : carte + « Preuve envoyée », « 1 capture(s) envoyée(s) », Relancer ;
- `resume-expired-390-light` : badge « PAIEMENT EXPIRÉ », écran d'expiration, Recommencer ;
- `list-resume-390-dark` : historique avec « Envoyer la preuve » (manual), « Continuer le
  paiement » (auto), « Voir l'état » (proof_submitted) + « Voir le suivi » inchangé.

Incidents du driver corrigés en cours de route (hors dépôt livré) : import `readFile` depuis
`node:fs` (version callback) → `node:fs/promises` ; interception `/orders/me` qui comparait le
pathname exact sans le préfixe `/api` (la liste renvoyait `{}` → page en erreur).

## Non vérifié ici

- **Backend réel** : environnement sans MongoDB — la lecture `GET /orders/{id}`, la liste
  `/orders/me` et les codes `proof_*` ont été simulés ; à confirmer sur le backend de prod/staging.
- **Multi-onglets** (double envoi de preuve simultané) : seule la logique serveur-first est
  préservée côté front, pas de course réelle testée.
- **Appareils réels** : 360/390 px simulés (Chromium) ; tactile, clavier et performances réseau
  réels non mesurés.
- **Comportement `manual_operator` une fois le champ backend ajouté** : le picker reste sur le
  défaut « MVola » tant que l'API ne renvoie rien.

## Commit

```
d0baedf  PL-CHK-3: reprise de commande en attente — page /orders/:id, banniere « Commande en cours », boutons de liste
13 files changed, 814 insertions(+), 41 deletions(-)
branche feat/chk-3-resume (base a36adb4 = origin/main) — aucun push
```
