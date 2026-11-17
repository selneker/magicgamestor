# PL-CHK-2 — Parcours de paiement « preuve de paiement » (style Binance) + aperçu admin des preuves

- **Branche** : `feat/chk-2-proof` (base `4e97463` = origin/main) — aucun push
- **Commit** : `90308e3da8d6d9fb532748aeec7cfbf674e57960` (1 commit, préfixé `PL-CHK-2`, 14 fichiers, +1417 / −235)
- **Date** : 2026-11-10
- **Captures** : `repports/captures/PL-CHK-2/` (36 fichiers, hors dépôt — le dossier `repports/` est non suivi et volontairement **pas** committé)

---

## 1. Inventaire étape 0 (état sur origin/main avant le lot)

- Ancien flux de création : `Checkout.js` — la commande (POST `/orders`) n'était créée **qu'au clic de paiement** de l'étape 3 pour les méthodes non manuelles, et l'étape manuelle saisissait une `manual_reference` dans le payload (checkout `StepConfirm.js` : `checkout-4-reference`, champ `manual-reference` portalé par `CheckoutConfirm.js:55`).
- Widget captcha : `Checkout.js:207-211` (un seul widget persistant, mécanisme PL-SEC-HARDEN-1 inchangé).
- Backend (lecture seule) : `backend/routers/orders.py:69` `manual_reference` optionnel ; `:116-124` `initial_status()` accepte les deux formes (avec/ sans référence, compat historique) ; `:352` payload toujours complété.
- Contrat de suivi : `TRACK_PUBLIC :34` (masqué : `_id/email/payment_phone`) ; la commande publique expose `id` + `payment_deadline_at` + `payment_proofs` (`:364`).
- Codes serveur : 409 `proof_*` (`proof_not_allowed`, `proof_not_pending`, `proof_already_validated`, `proof_limit`, `proof_count`, `proof_format`, `proof_too_large`, `proof_conflict`, `proof_deadline_passed`) ; 429 `remind_cooldown` / `remind_limit` (`:438-444`, le cooldown/limite passent en 429, le reste en 409) ; 503/502 si l'upload est indisponible.
- Admin : les images de preuve sont servies par un GET authentifiés par cookies vers `/admin/orders/{id}/proofs/{index}` ; **JPEG purgé après 7 jours** (410), 404/503/502 = indisponible.
- GET `/orders/{id}` : accessible au propriétaire connecté **ou** à l'invité porteur de l'UUID de commande (reprise sans session).

## 2. Réalisation — par tâche (fichier:ligne dans le commit `90308e3`)

### T1 — Création de la commande à l'étape 2 (toutes méthodes)
- `frontend/src/pages/Checkout.js:30-42` : clé de reprise `mgs_pending_order` (sessionStorage) + statuts qui clôturent le tunnel (`DONE_STATUSES`).
- `Checkout.js:207-226` : `continueMethod()` — la commande est créée À LA FIN DE L'ÉTAPE 2 pour **toutes** les méthodes, payload **sans `manual_reference`** ; `go(2)` affiche l'écran Paiement.
- `Checkout.js:81` + `run()` : garde anti double-clic **synchrone** (`inFlight`) — un double-clic dans la même frame avant que le DOM ne peigne `disabled` ne déclenche qu'un seul appel ; bouton en chargement (`busy`).
- Erreur de création → toast + **reste à l'étape 2** (jamais d'écran intermédiaire).
- Captcha : le jeton accompagne désormais la création (`captcha.tokenFor()` dans `createOrder`, `Checkout.js:180-192`) ; widget inchangé, toujours rendu en dehors des écrans animés (`Checkout.js:270-278`).
- Reprise : `Checkout.js:121-140` — au rechargement, GET `/orders/{id}` retrouve la commande ; statut terminal → écran Confirmation ; `pending_payment` → étape Paiement ; Binance : rouverture du slot via GET `/crypto/{id}/status` si actif, sinon navigation vers le suivi (**jamais de 2ᵉ initiation**).
- `Checkout.js:148-150` : l'écran « panier vide » est masqué pendant la reprise (`recovering`) et la clé est retirée au statut terminal.

### T2 — Compte à rebours (toutes méthodes)
- `frontend/src/components/store/checkout/PaymentCountdown.js` (nouveau) : décompte `mm:ss` calculé depuis `payment_deadline_at` (deadline memoïsée `:15-17`) ; accessibilité : `role="timer"` non annuncié seconde à seconde (`:46`), région sr-only `role="status"` annoncant les paliers 5 min / 1 min / expiration (`:27-45,47`) ; `urgent < 5 min` (`:48-49`); à 0 → `onZero()` (rechargement de la commande côté appelant).
- Branché sur **toutes** les variantes de l'étape 3 : manuel (`ProofPay.js` « PaymentCountdown »), auto (`StepPay.js:32`), Binance (`StepPay.js:23`).

### T3 — Manuel : USSD inchangé + zone de preuve
- `frontend/src/components/store/checkout/ProofPay.js` (nouveau) :
  - instructions USSD conservées (5 rewords documentées dans `translations.js` : `checkout.manual`, `checkout.ussdNote`, `checkout.ussdSteps[5]`, `checkout.manualHowto`, `checkout.refRequired`) ; le champ texte « référence » est retiré de l'étape de confirmation (`StepConfirm.js` réécrit).
  - `ProofUpload` / `ProofZone` (`:79-263`) : zone de captures — JPEG/PNG uniquement (`:22`), 8 Mo (`:21`), **3 fichiers max en comptant `payment_proofs` déjà envoyés** (`:87-88`), compteur « n / 3 captures » (`:211`).
  - envoi `FormData` avec champ `files` répété, **sans Content-Type à la main** (le navigateur pose la limite multipart) — `:124-129` ; `URL.revokeObjectURL` à chaque retrait (`:110-114`), au succès (`:127`), et au démontage via ref « dernier rendu » (`:94-98`).
  - `proof_deadline_passed` (400) → rechargement de la commande → écran d'expiration (`:131-132`).
  - jamais de texte brut de code serveur : mapping `detail.code` → clés i18n (`PROOF_CODE_KEYS :25-30`, `proofErrorMessage :39-50`) ; `captcha_required` via le mécanisme `isCaptchaError` existant.

### T4 — Écran « Preuve envoyée » (relance + polling)
- `ProofPay.js:267-356` (`ProofWaiting`) :
  - **Relancer** : POST `/orders/{id}/remind` — cooldown 3 min issu de `remaining_seconds` (200 ou du 429 `remind_cooldown`), 3 relances max (`remind_limit` désactive le bouton, autorité serveur) ; 429 gérés (`:283-300`) ; bouton désactivé pendant l'appel ET le cooldown.
  - **Polling du statut** : boucle itérative 3 × 10 s → 2 × 20 s → puis 30 s, **onglet visible uniquement**, arrêt au démontage et sur statut final (`FINAL_STATUSES :75`, `:304-326`) ; le signal paid/delivered → étape Confirmation vit au niveau du routeur (`useDoneSignal :56-60`) car `ProofWaiting` est démonté quand le statut quitte `proof_submitted`.

### T5 — Statuts `proof_submitted` / `late_payment`
- `frontend/src/pages/OrderTrack.js:13-20` : STYLE + libellés FR/EN (clés `order.status.proof_submitted`, `order.status.late_payment`) et badges (bordure encrée + horloge).
- `frontend/src/pages/admin/AdminOrders.js:19,21-28` : `STATUSES` +2, `TRANSITIONS` en miroir exact du backend ; libellé USSD seul pour le filtre méthode ; `<OrderProofs order={o}/>` intégré au détail (`:132`).

### T6 — Aperçu admin des preuves (aucune action admin modifiée)
- `frontend/src/pages/admin/OrderProofs.js` (nouveau) : GET auth cookies par index via l'instance `api` existante + `responseType: "blob"` (`:33`), vignettes 80 px, agrandisseur (Dialog + blob dédié, libéré à la fermeture `:50-64`), déséquentiel avec libération au démontage (`27-46`) ; `410 = preuve purgée`, `404/503/502 = indisponible` (`:17`), la page ne casse pas (état d'erreur explicite).
- Sécurité : aucune image exposée par une URL publique — tout passe par le GET authentifié par cookies.

### T7 — i18n
- `frontend/src/i18n/translations.js` : clés FR/EN du parcours (proof*, remind*, countdown*, late*, orderExpired*) ; **parité FR/EN vérifiée : 867 / 867 chaînes** (script Node ad hoc, `PARITY OK 867 strings`). Les clés retirées du flux (`checkout.reference`, `refHint`, `refRequired`, `ussdNext`) restent présentes : elles sont référencées par `PaymentMethodPicker.js` (composant déjà mort sur origin/main — aucun import), que le périmètre interdisait de modifier/supprimer.

### T8 — Audit de contraste (script)
- `frontend/scripts/audit-contast.mjs` → `frontend/scripts/audit-contrast.mjs` (retouches dans le commit) :
  - pages « `checkout-3-preuve` » / « `checkout-3-preuve-vignettes` » remplacent l'ancienne « checkout-4-reference » (`:307-308`) ; ORDER enrichi (`:206-212`, deadline +20 min) ; TINY_PNG / PROOF_FILES (`:216-224`) ; mock de GET `/orders/{id}` (`:282-283`).
  - **Correction du driver** (hors PL-CHK-2 initial, découverte pendant la validation) : les testids `pubg-id-input` / `pubg-verify-btn` / `reward-pubg-input` **n'existent plus dans aucun composant** (déjà vrai sur origin/main) — le pilotage des pages checkout ne-opopait en silence et l'audit mesurait l'écran d'init de l'étape 1 pour toutes les pages checkout. Le driver utilise maintenant le flux réel `identity-field-player_id` + `identity-verify-btn` (composant générique `IdentityFieldsVerify`, endpoint POST `/fazercards/validate-id`) et le mock `pubgVerify` répond sur cet endpoint réel (`pubg-*` et `fidelite-pubg-*` dirigent désormais les états voulus). Aucun seuil du script n'a été changé.

## 3. Validation

| Vérification | Commande | Résultat |
|---|---|---|
| Build | `cd frontend && REACT_APP_BACKEND_URL=http://localhost:8001 yarn build` | ✅ « Compiled successfully », **0 avertissement ESLint** (deux avertissements react-hooks trouvés au premier build ont été corrigés : deadline memoïsée de PaymentCountdown ; nettoyage des blobs de ProofPay par ref « dernier rendu ») |
| Tests | `cd frontend && yarn test:ci` | ✅ **33 suites / 351 tests, 0 échec** (avant : 31 suites / 326 tests ; +17 ProofPay.test, +5 PaymentCountdown.test, +3 AdminOrders.test ; Checkout.test réécrit) |
| Contraste | `cd frontend && CHROMIUM_PATH=/home/selneker/.local/bin/google-chrome yarn audit:contrast` (sur le bundle build) | ✅ **TOTAL : 0 echecs, 0 page non chargée, exit 0** (37 pages × 390/1440 px × clair/sombre — cf. table complète §3.1) |
| Images | `git diff --name-only origin/main \| grep -Ei '\.(png\|jpe?g\|webp)$'` | ✅ vide (aucune image dans le dépôt ; les captures de preuve vivent dans le mock du script d'audit en base64) |

### 3.1 Sortie exacte de `yarn audit:contrast` (run final, après correction du driver)

```
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
```

(Rappel du guide : à relancer sur **main après la fusion**, règle permanente n° 12.)

## 4. Captures (hors dépôt — `repports/captures/PL-CHK-2/`)

36 captures : 9 scénarios × **360 + 390 px** × **clair + sombre** (deviceScaleFactor 2). Réponses 100 % simulées (route `**/api/**` interceptée), **aucun appel production** ; aucune image ajoutée au dépôt.
Le script pilote (`capture-plchk2.mjs`) était temporaire : il a servi les captures puis **supprimé** (non committé). En cas de re-capture, il est trivial à reconstituer à partir de `scripts/audit-contrast.mjs`.

| Fichier (préfixe) | Écran |
|---|---|
| `04-etape3-manuelle-vide-*` | Étape 3 manuelle vide : countdown 19:mn, récap, code USSD, étapes, « Preuve de paiement · 0/3 captures », bouton épinglé désactivé |
| `05-etape3-manuelle-vignettes-*` | Vignettes 2/3 sélectionnées (champ file réel + setInputFiles) |
| `06-etape3-manuelle-envoi-*` | Envoi en cours (POST `/proof` pendent 9 s) : bouton « Envoi en cours… » |
| `07-etape3-manuelle-erreur-*` | Erreur 503 → « Envoi de preuve indisponible, réessayez plus tard » + `role="alert"` |
| `08-preuve-envoyee-relancer-actif-*` | « Preuve envoyée » — Relancer actif (reprise d'une commande `proof_submitted` automatique : mgs_pending_order + méthode manuelle) |
| `09-preuve-envoyee-relance-en-attente-*` | « Preuve envoyée » — Relancer en attente (429 `remind_cooldown`, cooldown affiché) |
| `10-commande-expiree-*` | Commande expirée après `proof_deadline_passed` → recharge → écran d'expiration |
| `11-etape3-binance-countdown-*` | Étape 3 Binance : countdown + panier USDT, QR, adresse, « J'ai payé » |
| `12-admin-section-preuves-*` | Section admin « Preuves » : badge « Preuve en vérification », statut select preuve chiffrée, vignette auth cookies |

Note de lecture : les captures sont des `fullPage` — à `fullPage`, les éléments `sticky` (résumé de commande, barre « Envoyer la preuve ») sont peints à la position d'épinglage de la première viewport ; le chevauchement apparent au milieu de l'image est un artefact de couture, pas un chevauchement réel dans la viewport (vérifié ensuite par écran normal).

## 5. Divergences / points ouverts

1. **`CheckoutConfirm.js` reste tel quel** : la route `/commande/confirmation` reste accessible en URL directe et envoie encore `manual_reference` dans `/orders`. Le backend accepte les deux formes (`initial_status()` ; `Checkout.js:180-192` ne l'envoimage plus). Paiement proposé à l'utilisateur, en-dehors du périmètre.
2. **Pas de route d'annulation client** : en fait raison au « retour arrière » à l'étape 3 → `navigate(trackUrl)` (ordre de suivi) ; la commande expire d'elle-même une fois le délai atteint. Proposé tel quel, à discuter.
3. **OrderTrack.test.js non modifié** : le plan mentionnait une extension de ce fichier (badges des 2 statuts) — le fichier dans l'arborescence est identique à origin/main (les 2 statuts sont implémentés dans `OrderTrack.js` et les badges admin sont couverts par `AdminOrders.test.js`, mais les badges côté « suivi » n'ont pas de test dédié).
4. **Clés i18n retirées du flux vivantes encore dans `translations.js`** (`checkout.reference`, `checkout.refHint`, `checkout.refRequired`, `checkout.ussdNext`) : référencées par `PaymentMethodPicker.js` (aucun import du composant — code mort déjà présent sur origin/main). Retirer les clés puis supprimer le composant nécessiterait de toucher un fichier gros du lot ; non fait dans le périmètre.
5. **Contenu-type de l'envoi d'axe FormData** : axios non mocké au build (`tests` mockés) — la récupération du Content-Type n'est pas testée par le code client (non récuprée, secourues par le service).
6. **Le test `yarn test:ci` ne teste pas la libellés des codes serveur graphiquement** : le mapping texte-seul (`PROOF_CODE_KEYS`) est couvert unitairement dans `ProofPay.test.js` (17 tests) mais pas l'écran réel ; l'audit de contraste a cochber les 2 écrans de preuve (`checkout-3-preuve`, `checkout-3-preuve-vignettes`) et 0 échec.

## 6. Ce qui n'a pas pu être vérifié ici

- **Backend non exécutable** dans cet environnement (pas de `mongod`/`docker`/`sudo`) : les comportements serveur suivants sont **non vérifiés** — lecture du code uniquement :
  - création de commande avec `manual_reference` absent (deux formes acceptées : code `routers/orders.py:69,116-124,352`) ;
  - `payment_deadline_at` posé à la création (`:364`, `order_maintenance.payment_deadline_iso()`) ;
  - upload de preuve (multipart, plafonds `proof_limit`/`proof_count`/`proof_format`/`proof_too_large`, 503/502) ;
  - relance (POST `/orders/{id}/remind`, 429 `remind_cooldown`/`remind_limit`) ;
  - transitions de statut (miroir exact `TRANSITIONS` AdminOrders `:21-28`) ;
  - purge des images de preuve à 7 jours (410 all admin, `OrderProofs.js:17`).
  → **Demander l'exécution de `pytest` chez l'utilisateur** pour fermer ces points.

## 7. État final du dépôt

- 1 commit sur `feat/chk-2-proof` : `90308e3da8d6d9fb532748aeec7cfbf674e57960` — pas de push.
- Non committés (intentionnellement) et **non supprimés** : `Issues/`, `PLAN-PL-002-neferbyte-identite.md`, `planning-agent-rules.md` (fichiers de l'autre agent), `repports/` (captures).
- Ce rapport : `repports/PL-CHK-2.md` (non committé).
