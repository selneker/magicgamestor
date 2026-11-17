# PL-CHK-4 — Refonte du tunnel de commande, style Binance

Branche : `feat/chk-4-binance-flow` (depuis `origin/main` `c33ac2d`). Un commit, pas de push.
**Hash : `35d52b0`** — 27 fichiers, +1648/−2133 (chemins explicites ; `Issues/`, `repports/`,
drivers de captures et hors-sujet jamais ajoutés).
Maquette fait foi : `/home/selneker/Downloads/apercu-checkout-binance.html` (9 écrans).
Toutes les chaînes passent par `t()` (parité FR/EN 929/929 vérifiée par script). Aucune nouvelle
dépendance. Aucune couleur hors jetons. Aucune image dans le dépôt. Aucun appel production (tests,
audit et captures travaillent sur des mocks).

## Étape 0 — inventaire de l'existant

- Ancien tunnel en 3 étapes (`CheckoutSteps.js`) : StepVerify (saisie + vérification ID via
  `IdentityFieldsVerify`), StepPay (méthode, téléphone, USSD, création de commande à l'étape 2),
  StepConfirm (page `/commande/confirmation` envoyant encore `manual_reference`).
- Écran de reprise `/orders/:id` (PL-CHK-3) : `OrderResume` avec USSD complet, zone de preuve,
  sondage auto (`useAutoPaymentPoll`) et relance (`usePaymentRetry`) — conservés.
- `PaymentFlow.js` : logos, codes USSD (`#111*1*2*…` / `#144*1*1*…`, **jamais affichés** sur
  l'écran 2), `NetworkPicker`, `ManualProviderPicker`, `CopyButton`, `PrimaryCta` — réutilisés.
- Captcha (`CaptchaWidget.js`) : garde `typeof process` à retirer, `size` calc par `matchMedia`
  à remplacer par `flexible`, thème/langue du site à passer à `render()`.
- `CheckoutConfirm.js` : envoyait `manual_reference` à `POST /orders` — à remplacer par un redirect.
- Dépendance backend vérifiée : `git grep cancel_reason -- backend` non vide (contrat
  `POST /orders/{id}/cancel { reason }` + 409 → lot autorisé).
- `AuthPage` / `AuthExtras` : en-tête site complet → à passer en en-tête minimal (mode focalisé).
- Layout : Header/PendingOrderBanner/Footer/BottomNav/CartDrawer toujours rendus → à conditionner.

## Écrans livrés (maquette → implémentation)

| # | Maquette | Implémentation |
|---|---|---|
| 1 | Commande (montant, ID joueur vérifié, méthodes en lignes, remarque courte, CTA fixé) | `Checkout.js` réécrit — une seule étape, redirection `/orders/:id` à la création |
| 2 | Paiement MVola/Orange (titre, délai, 2 étapes losanges, copie) | `OrderTrack.js` `OrderResume` réécrit (branche `manual`) |
| 3 | Feuille « Confirmation du paiement » (vignettes ≤3, case obligatoire) | `ProofPay.js` `ProofSheet` (Radix Sheet side="bottom") |
| 4 | Attente (illustration, récap « Détails de la commande », Relancer + cooldown) | `ProofPay.js` `ProofWaiting` |
| 5/6 | Binance USDT (QR, montant, réseau, détection automatique) | `OrderTrack.js` branche `binance` + `BinancePay` (composant PL-CHK-2 conservé) |
| 7 | Annulation (5 raisons, « Garder ma commande » primaire) | `CancelSheet.js` (nouveau) |
| 8 | Expirée (horloge, n° de commande, Recommencer) | `ProofPay.js` `ProofExpired` |
| 9 | Feuille « Vérification de sécurité » (Turnstile interaction-only) | `Checkout.js` feuille toujours montée, invisible sans interaction + `CaptchaWidget.js` |

## Détail par tâche (fichier:ligne)

### Tâche 1 — Écran 1 « Commande » (`frontend/src/pages/Checkout.js`)
- En-tête minimal : `:284-288` (BackButton + nom du jeu).
- Montant en grand « Vous payez » : `:283-294`.
- ID joueur vérifié (ID + pseudo sur deux lignes, coche, « Changer ») : `:299-315`, portage de la
  logique d'identité de l'ancien StepVerify : `saveIdentity` `:141-147` (POST `/me/game-identities`
  si connecté, dédupliqué côté serveur), `handleVerified` + `valuesRef` `:153-164` (le verdict
  arrive avec une closure antérieure au re-render — portage exact du pattern StepVerify).
- Méthodes en lignes (testids `method-mvola` / `method-orange` / `method-binance`) : `:323-325` ;
  méthodes actives uniquement (`providers.*.configured !== false` + `crypto.available`) : `:107-118`.
- Remarque courte unique par méthode (`checkout-remark`) : `remarkMvola/Orange/Binance`, rendue
  sous la ligne sélectionnée (une seule à la fois).
- Binance : `NetworkPicker` dans la ligne sélectionnée (`payment-expanded-binance`), réseau requis
  avant CTA ; création puis `POST /crypto/initiate` existant — jamais de 2ᵉ initiation.
- CTA `checkout-submit` fixé en bas `:349` ; payload `:171-217` : `payment_method: "manual"` +
  `manual_operator: "mvola"|"orange"`, **jamais** `manual_reference`, **jamais** de téléphone vide.
- Feuille CAPTCHA (écran 9) toujours montée, invisible (`:357-380`), garde `typeof process`
  retirée du widget.
- Reprise PL-CHK-3 : `:100-112` — `readPendingOrderId()` renvoie `{ id, createdAt }` (bug corrigé :
  l'effet construisait `/orders/[object Object]`) ; commande finalisée → purge ; invalide → purge.
- Jeton captcha à usage unique : `submitOrder(tokenArg)` / `createOrder(tokenArg)` passent le jeton
  explicitement (`:171`, `:218`) — le state du hook est périmé lors de l'auto-soumission déclenchée
  par `onVerify` ; `onClick={() => submitOrder()}` (l'ancien `onClick={submitOrder}` passait
  l'événement MouseEvent comme jeton).

### Tâche 2 — Écran 2 « Paiement » (`frontend/src/pages/OrderTrack.js`)
- `OrderResume` réécrit `:132-349` : en-tête minimal retour + « Annuler la commande » (`:235-240`) ;
  titre « Ouvrir MVola / Orange Money pour payer » / « Envoyer des USDT » `:229,280` ;
  `PaymentCountdown` `:252,282` ; étapes losanges `Diamond` + KV (montant, nom, numéro — issus de
  `/payments/config` avec `name`, jamais écrits en dur) `:255-274` ; boutons de copie (retour
  « Copié ») ; bouton « Envoyer la preuve » fixé en bas `:313-319` (`env(safe-area-inset-bottom)`).
- Ancienne commande sans `manual_operator` persisté : `ManualProviderPicker` `:246-248`.
- AUCUN récapitulatif (il vit à l'écran 4), aucun code USSD affiché (exports `USSD` conservés).
- Branche `binance` `:278-287` : slot rouvert via `GET /crypto/{id}/status` — jamais de 2ᵉ
  initiation ; bouton « En attente du paiement… » désactivé `:320-326`.
- Branches statuts `:305-309` : `proof_submitted` → ProofWaiting, `late_payment` → LateScreen,
  `expired` → ProofExpired, `cancelled/failed` → EndScreen, `paid/delivered/awaiting_verification`
  → OrderCard. Statut final → `clearPendingOrderId()` `:169-171`.
- `useAutoPaymentPoll` `:81-99` et `usePaymentRetry` `:105-117` conservés (PL-CHK-3).
- Page de recherche `/suivi` inchangée.

### Tâche 3 — Feuille de preuve (`frontend/src/components/store/checkout/ProofPay.js`)
- `ProofSheet` `:66-198` : Radix Sheet side="bottom" (fenêtre centrée 480 px ≥1024 px), vignettes
  1–3 (preuves déjà envoyées comprises dans le plafond), champ file `accept="image/jpeg,image/png"`
  `:170`, case obligatoire « J'ai déjà payé le montant exact » `:183`, récap unique
  (produit · ID · montant), `POST /orders/{id}/proof` multipart sans Content-Type manuel ;
  erreurs `proof_*` / 429 / 503 / 403 / 404 mappées vers des messages FR/EN, `captcha_required`
  → mécanisme existant, `proof_deadline_passed` → refetch (écran 8).
- `ProofWaiting` `:200-339` : illustration SVG en ligne, carte « Détails de la commande »
  (Collapsible ouverte par défaut) — **ID joueur et pseudo sur deux lignes séparées** `:299-301`,
  Relancer fixé avec cooldown mm:ss sur le bouton `:320`, plafond de relances ;
  sondage 10 s ×3, 20 s ×2 puis 30 s (onglet visible uniquement, arrêt au démontage / statut final).
- `LateScreen` `:341`, `EndScreen` `:354`, `ProofExpired` `:367` (écran 8 : n° de commande dans le
  texte, « Recommencer » vers `/boutique`).

### Tâche 4 — Annulation (`frontend/src/components/store/checkout/CancelSheet.js`, nouveau)
- 5 radios `cancel-reason-wrong_info|change_method|too_short|cannot_pay_now|other` `:81-90`
  (textes exacts de la maquette) ; primaire « Garder ma commande » `cancel-keep` `:97`, lien
  « Annuler la commande » `cancel-confirm` `:102` désactivé sans raison.
- `POST /orders/{id}/cancel { reason }` `:46` ; 409 (`cancel_not_allowed` / `cancel_conflict`) →
  message clair + `onConflict` (refetch) `:56-59` ; succès → `onCancelled` → retour accueil.
- Montée depuis l'écran 2 : `OrderTrack.js:236,340-346`.

### Tâche 5 — CheckoutConfirm = redirect (`frontend/src/pages/CheckoutConfirm.js`)
- L'ancienne page (qui envoyait `manual_reference`) est remplacée par un `<Navigate>` : écran de
  paiement de la commande en attente (< 24 h, PL-CHK-3) sinon l'accueil. Tests dédiés (3).

### Tâche 6 — CAPTCHA (`frontend/src/components/common/CaptchaWidget.js`)
- **Garde `typeof process` retirée** ; `size: "flexible"` `:53-60,111` (toute la largeur du
  conteneur, jamais de débordement à 320 px) ; `appearance: "interaction-only"` `:111` ;
  thème du site `:110` ; langue du site `:113` (le widget se re-rend quand la langue change —
  dépendance `lang` ajoutée à l'effet, corrigeait un warning ESLint) ;
  `before-interactive-callback` / `after-interactive-callback` `:121-122` → le parent ouvre/referme
  la feuille « Vérification de sécurité ». Contrat `captcha_required` + fail-closed inchangés.

### Tâche 7 — Mode focalisé (`frontend/src/lib/bottomChrome.js`, `Layout.js`, AuthPage, AuthExtras)
- `FOCUSED_PREFIXES` = `/commande`, `/orders/`, `/connexion`, `/inscription`,
  `/mot-de-passe-oublie` (`bottomChrome.js:19-22`) ; `Layout.js:27-35` ne rend plus Header,
  PendingOrderBanner, Footer, BottomNav, CartDrawer sur ces routes (AdminBottomNav toujours rendu)
  et passe `<main>` en `pb-0` `:29-32` (tout padding du Layout créait un défilement fantôme de
  24 px à 360×640).
- `AuthPage.js:58-63` : en-tête minimal flèche retour (repli accueil sans historique,
  `window.history.state?.idx`) + logo seul. `AuthExtras.js:17-23` : même en-tête via prop `back`
  (seule `ForgotPassword`, route focalisée, l'utilise).

### Tâche 8 — PaiementFlow réduit aux exports partagés (`frontend/src/components/store/PaymentFlow.js`)
- Conservés : `PAYMENT_LOGOS` `:11`, `USSD` `:17` (jamais affiché, export conservé), `pretty` `:21`,
  `paymentFee` `:23`, `NetworkPicker` `:32`, `ManualProviderPicker` `:55`, `CopyButton` `:75`,
  `PrimaryCta` `:107`. Le reste (ancien wizard) supprimé avec les écrans morts.

### Tâche 9 — i18n (`frontend/src/i18n/translations.js`)
- ~40 clés ajoutées FR + EN : `checkout.youPay`… `checkout.cancelConflict` (`:103-124` FR,
  `:285-306` EN) ; `orderExpiredBody` mis à jour avec `{number}` (texte de la maquette écran 8).
- Parité vérifiée par script : **929/929, 0 onlyFr / 0 onlyEn**.

## Composants supprimés (0 usage restant, grep vérifié)

- `frontend/src/components/store/checkout/CheckoutSteps.js`
- `frontend/src/components/store/checkout/StepVerify.js` + `StepVerify.test.js`
- `frontend/src/components/store/checkout/StepPay.js`
- `frontend/src/components/store/checkout/StepConfirm.js`
- `frontend/src/components/store/PaymentMethodPicker.js`
- `frontend/src/components/store/PaymentStatus.js` + `PaymentStatus.test.js`

## Tests (avant / après)

- Avant (baseline `origin/main`) : **35 suites / 384 tests**, tous verts.
- Après : **33 suites / 379 tests**, tous verts — 2 fichiers de test supprimés avec leurs
  composants (`StepVerify.test.js`, `PaymentStatus.test.js`), cohérent avec la baseline.
- Réécrits pour le nouveau flux :
  - `Checkout.test.js` : 19 tests (méthodes actives, remarque par méthode, CTA désactivé, payload
    `manual_operator` sans téléphone ni `manual_reference`, Binance + initiation, double-clic,
    erreurs 422 lisible, feuille CAPTCHA ouverte/fermée + jeton, reprise PL-CHK-3).
  - `OrderTrack.test.js` : 25 tests (écran 2 par opérateur, numéros issus de la config avec `name`,
    opérateur null → sélecteur, copie, branches statuts, annulation ouvre la feuille + POST
    `{reason}`, 403/404 → `order-not-available`, sondage auto arrêté au démontage, boutons de liste).
  - `ProofPay.test.js` : 19 tests (feuille : vignettes/plafond incluant preuves existantes/case
    obligatoire/multipart sans Content-Type/erreurs serveur/captcha/deadline ; attente : cooldown,
    relance, poll et arrêt au démontage ; écrans de fin).
  - `CaptchaWidget.test.js` : +1 test (contrat `onInteractive` via before/after-interactive).
  - `CheckoutConfirm.test.js` : 3 tests (redirect accueil / `/orders/:id` / purge périmée).
- Pièges de test documentés dans les fichiers : contenu Radix portalisé dans `document.body` ;
  `formatAr` insère une espace fine U+202F (`toLocaleString("fr-FR")`) — matcher par regex,
  jamais `"2 500"` littéral.

## `yarn build`

`REACT_APP_BACKEND_URL=http://localhost:8001 yarn build` : **Compiled successfully, 0 warning
ESLint**. (Le warning Tailwind `duration-[420ms]` est préexistant, hors lot — `BottomNav.js`.)

## Audit de contraste

`yarn build` (bundle de production, sans clé Turnstile) puis `CHROMIUM_PATH=/home/selneker/.local/bin/google-chrome yarn audit:contrast` :

```
================ CONTRASTE : ECHECS PAR PAGE ================
page                      390px clair   390px sombre   1440px clair  1440px sombre  
accueil                   0             0             0             0             
catalogue                 0             0             0             0             
checkout-1-init           0             0             0             0             
checkout-1-verification   0             0             0             0             
checkout-1-methode-mvola  0             0             0             0             
checkout-1-methode-binance0             0             0             0             
paiement-manuel-mvola     0             0             0             0             
paiement-manuel-orange    0             0             0             0             
paiement-attente          0             0             0             0             
paiement-expire           0             0             0             0             
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
```

Exit code : **0**. Le driver de l'audit a été adapté au nouveau flux (les écrans d'étapes
`checkout-2-methode` / `checkout-3-emploi*` n'existent plus) : écran unique `/commande` (init,
vérifié, méthode sélectionnée MVola/Binance) + écrans `/orders/:id` par état (manuel MVola, manuel
Orange, attente, expiration, statut auto). Aucune exclusion de mesure ajoutée.

## Captures (`repports/captures/PL-CHK-4/`, non suivi git)

- 9 écrans × 360 et 390 px, clair + sombre ; écrans 1–2 aussi à 1280 px (clair + sombre) ;
  connexion focalisée (sans header/footer) : **44 captures**.
- Driver : `frontend/capture-pl-chk-4.mjs` (NON suivi git, jamais commité) — serveur statique
  build/, interception `**/api/**`, Turnstile simulé (jamais de jeton → feuille 9 figée ouverte),
  `POST /orders` laissé en attente pour figer l'écran 9. Contrôle visuel effectué.

## Écrans ne tenant PAS sur 360×640 (mesuré, `scrollHeight` à 360×640)

- **05/06 Binance** : 835/855 px — le contenu du composant `BinancePay` (PL-CHK-2, conservé tel
  quel : QR 168 px, adresse, MEMO, expiration) dépasse l'écran ; défilement avec le bouton
  « En attente du paiement… » fixé. À traiter dans un lot dédié si la contrainte s'applique aux
  écrans Binance.
- **10 connexion** : 702 px — le formulaire auth (Google + email + mot de passe + options) n'a pas
  été comprimé : le mode focalisé supprime le chrome du site mais la page défile de ~62 px.
- Écrans 1, 2, 3, 4, 7, 8 : **640 px exactement** (tiennent sans défilement, boutons fixés).

## Non vérifié ici (à valider en réel)

- Backend non exécutable dans cet environnement (pas de MongoDB/docker/sudo) : contrats
  `/orders/{id}/cancel`, `/orders/{id}/proof`, `manual_operator`, `cancel_reason` vérifiés par
  lecture du code backend uniquement — lancer la suite backend côté dépôt backend.
- Turnstile réel (clé de production) : les tests, l'audit et les captures utilisent des mocks/stubs ;
  le comportement réel `interaction-only` + fail-closed est couvert par les tests unitaires du
  contrat, pas par un trafic Cloudflare réel.
- Aucun paiement réel, aucun appel production : numéros marchands de tests uniquement
  (`0383905692`/`0377519833` dans les mocks d'audit/captures). Les codes USSD réels existants ne
  sont jamais affichés ni inventés.
- Validation manuelle sur vrai téléphone (Android 390 px, réseau lent) à faire avant fusion.

## Bugs trouvés et corrigés en cours de lot

1. `readPendingOrderId()` renvoie `{ id, createdAt }` — l'effet de reprise construisait
   `/orders/[object Object]` (corrigé `Checkout.js:101-102`).
2. Jeton captcha périmé : l'auto-soumission déclenchée par `onVerify` relisait un state périmé —
   `submitOrder(tokenArg)` / `createOrder(tokenArg)` passent le jeton explicitement.
3. `onClick={submitOrder}` passait l'événement MouseEvent comme `tokenArg` → `() => submitOrder()`.
4. `pb-6` du `<main>` du Layout sur les routes focalisées : défilement fantôme de 24 px à 360×640
   sur TOUS les écrans du tunnel → `pb-0` en mode focalisé (`Layout.js:29-32`).
5. Dépendance `lang` manquante dans l'effet Turnstile (warning ESLint bloquant le critère
   « build sans warning ») → le widget se re-rend avec la nouvelle langue.
