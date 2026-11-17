# PL-CHK-2-FIX1 — Création de commande étape 2 : plus de `payment_phone` vide (422 « Invalid phone number »)

- **Branche** : `fix/chk-2-phone` (base `b470241` = origin/main, squash PL-CHK-2 #86) — aucun push
- **Commit** : `24d8df1165ace467807a7fb6cafb37664f454fd2` (1 commit, préfixé `PL-CHK-2-FIX1`, 3 fichiers, +123 / −5)
- **Date** : 2026-11-10
- **Contexte prod** : frontend retiré de la production — aucune commande possible, le backend répond « Value error, Invalid phone number » à la création avec le paiement manuel (Orange Money) sélectionné.

---

## 1. Cause exacte (prouvée dans le code, étape 0)

### Côté backend (lecture seule, non modifié)

- `frontend/../backend/routers/orders.py:92-100` — validateur `valid_phone` sur `payment_phone` :
  - `v is None` → accepté (renvoyé tel quel) ;
  - sinon `digits` = chiffres extraits, **`len(digits) < 10` → `raise ValueError("Invalid phone number")`** → Pydantic l'enrobe en 422 « Value error, Invalid phone number ».
- `backend/routers/orders.py:68` — `payment_phone: str | None = None` : champ **optionnel** du modèle `OrderIn` de création.
- `backend/routers/orders.py:314-318` — requis **seulement** pour `mvola`/`orange` automatiques (`400 "Payment phone number is required"` si absent) ; **jamais pour `manual` ni `binance`**.
- Seuls consommateurs du champ : les passerelles auto (`backend/services/fiveone.py:67`, `backend/services/payments.py:87`) et l'export CSV admin (`orders.py:800-806`). Le flux manuel construit l'USSD à partir du numéro **marchand** (`frontend/src/components/store/checkout/ProofPay.js:89-91` — `USSD[provider](merchant.merchant, …)`), pas de `payment_phone`.

### Côté frontend (la régression)

- `frontend/src/pages/Checkout.js:223` (état origin/main) — dans `continueMethod()` :
  ```js
  await (order || createOrder(method, { payment_phone: phone }));
  ```
  exécuté pour **toutes** les méthodes non-binance, **y compris `manual`**.
- Le champ `phone` (`Checkout.js:62`, initial `""` ou `user?.phone`) n'est saisissable **que** dans le panneau des méthodes automatiques (`PaymentFlow.js:89` → `AutoPanel` `:131-141`) ; la carte manuelle rend `ManualPanel` (`PaymentFlow.js:90`) **sans champ téléphone** et `canContinue` n'exige rien pour `manual` (`PaymentFlow.js:47`).

### Cause en une phrase

`Checkout.js:223` envoyait `payment_phone: ""` à la création d'une commande **manuelle** (champ jamais saisissable pour cette méthode, `PaymentFlow.js:90`), et le validateur Pydantic `backend/routers/orders.py:92-100` rejette toute chaîne non-`None` de moins de 10 chiffres → 422 « Value error, Invalid phone number » → plus aucune commande manuelle possible.

**Verdict : cause côté frontend** (payload invalide), le backend est conforme à son contrat — **aucune modification backend**.

## 2. Correction (fichier:ligne dans le commit `24d8df1`)

- `frontend/src/pages/Checkout.js:239-252` (`continueMethod`) :
  - **manuel** → `createOrder(method)` **sans** `payment_phone` (le backend l'accepte comme absent, `:68` ; la preuve passe par l'USSD marchand) ;
  - **auto (mvola/orange)** → `createOrder(method, { payment_phone: phone || undefined })` : numéro saisi → tel quel (il était déjà contraint par `phoneOk` ≥ 10 chiffres, `PaymentFlow.js:46-47`) ; vide → champ **omis**, jamais `""` (le backend répondrait alors 400 « Payment phone number is required », chaîne lisible, au lieu d'une 422) ;
  - **binance** → inchangé (`createOrder("binance")` n'a jamais porté de téléphone).
- Erreur de validation lisible — `frontend/src/pages/Checkout.js:37-51,218-225` :
  - `validationDetails()` détecte les 422 Pydantic (`status === 422`, `detail` tableau) ; `validationField()` extrait le dernier élément de `loc` ; `FIELD_TEXT_KEYS` mappe `payment_phone` → `checkout.phoneError` ;
  - dans le catch de `run()` : toast **FR/EN** (`checkout.phoneError` pour le champ connu, `checkout.orderValidationError` en repli) au lieu du texte technique « Value error, Invalid phone number » ; on **reste à l'étape 2** (comportement inchangé de `run`).
- i18n — `frontend/src/i18n/translations.js` : `checkout.phoneError` + `checkout.orderValidationError` FR/EN. Parité **869/869**, 0 clé manquante.

## 3. Payload avant / après (par méthode, à la fin de l'étape 2)

| Méthode | Avant (`Checkout.js:223` main) | Après (`24d8df1`) |
|---|---|---|
| **manual** (Orange Money) | `{ payment_method: "manual", payment_phone: "" }` → **422** | `{ payment_method: "manual" }` — champ **omis** |
| **mvola / orange** auto | `payment_phone: phone` (numéro saisi, ou `""`) | `payment_phone: phone \|\| undefined` — numéro tel quel, ou omis si vide |
| **binance** | pas de `payment_phone` (branche séparée) | inchangé |

(`CheckoutConfirm.js:54` — route URL directe, hors PL-CHK-2 — omettait déjà `payment_phone` pour le manuel : `manual ? undefined : ctx.phone`. Non modifié.)

## 4. Validation

| Vérification | Commande | Résultat |
|---|---|---|
| Tests | `cd frontend && yarn test:ci` | ✅ **33 suites / 357 tests, 0 échec** (avant : 33 suites / 351 tests ; `Checkout.test.js` 7 → 13 tests) |
| Build | `REACT_APP_BACKEND_URL=http://localhost:8001 yarn build` | ✅ « Compiled successfully », 0 warning ESLint |
| Contraste | `CHROMIUM_PATH=… yarn audit:contrast` (sur le bundle build) | ✅ **TOTAL : 0 echecs**, 0 page non chargée, exit 0 — cf. §4.1 |
| Images | `git diff --name-only origin/main \| grep -Ei '\.(png\|jpe?g\|webp)$'` | ✅ vide |
| Parité i18n | script Node | ✅ 869/869 |

### 4.1 Sortie exacte de `yarn audit:contrast` (run final)

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

**Note d'environnement** : le 1ᵉʳ run de l'audit a signalé 13 « NON CHARGEE » à 1440 px clair uniquement (fidelite-pubg-* et admin-* : pages **non touchées** par ce lot). Le 2ᵉ run, identique par ailleurs, a rendu ces mêmes pages à 0 échec sans aucune erreur de chargement — la machine dispose de 3,8 Go de RAM avec un swap presque saturé (5,2/5,9 Go) et les timeouts de chargement du script (30 s + 15 s) ont cédé sous la pression mémoire de Chromium ; fragilité d'environnement, pas une régression du code. Aucun seuil ou exclusion du script n'a été modifié.

## 5. Tests ajoutés (`frontend/src/pages/Checkout.test.js`, 13 tests au total)

- **payload par méthode** : MVola avec numéro saisi → `payment_phone: "0341234567"` dans le payload ; Orange idem ; Binance → jamais de champ + `/crypto/initiate` appelé ; auto **sans** numéro → champ omis (jamais `""`) ; manuel (test existant renforcé) → champ absent + toujours sans `manual_reference`.
- **erreur lisible** : 422 `loc: ["body","payment_phone"]` → toast « Numéro à débiter invalide : vérifiez le numéro (10 chiffres). » + **reste à l'étape 2** ; 422 sur un autre champ → message générique FR (jamais le texte technique). Résolus via le vrai `LanguageContext` (traductions réelles), ce qui vérifie aussi l'existence des clés FR.

## 6. Divergences / points ouverts

1. **Backend non exécuté ici** (`pytest` impossible : pas de mongod/docker/sudo). Le correctif ne touche pas le backend ; le contrat est vérifié **en lecture** (`orders.py:68,92-100,314-318`). À fermer par `cd backend && pytest` chez l'utilisateur, puis test sur un vrai téléphone (manuel Orange Money → création OK, commande `pending_payment` avec échéance) avant remise en production du frontend.
2. **`CheckoutConfirm.js` (route URL directe)** reste inchangé ; il omet déjà `payment_phone` pour le manuel mais garde `manual_reference` textuel (déjà noté hors périmètre dans PL-CHK-2). Si un 422 survenait sur cette route (ex. champ `pseudo`), son toast reste le texte technique `errorMessage` — hors ce correctif.
3. Dépôt : `Issues/`, `PLAN-PL-002-neferbyte-identite.md`, `planning-agent-rules.md`, `repports/` volontairement **non committés et non supprimés**.
