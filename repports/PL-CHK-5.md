# PL-CHK-5 — Corrections de l'écran de paiement (`/orders/:id`, feuilles, Binance, auth)

Branche `fix/chk-5-payment` (depuis `origin/main` = `b4c439e`, PL-CHK-4 fusionné via #90).
Maquettes fait foi : `/home/selneker/Downloads/apercu-corrections-paiement.html` (paiement, feuilles, bureau)
et `/home/selneker/Downloads/apercu-checkout-binance_4.html` (écrans 1, 2, 5, 6, 9).
Captures : `repports/captures/PL-CHK-5/` (non commitées). Aucun appel production ; aucun changement backend ;
aucune nouvelle dépendance.

---

## Étape 0 — Causes prouvées (fichier:ligne)

### 1. Le sélecteur d'opérateur sur une commande neuve
- Le payload de création envoie bien `manual_operator` : `frontend/src/pages/Checkout.js:186-187`
  (`payment_method: method === "binance" ? "binance" : "manual"` + `manual_operator: method` pour mvola/orange).
- Le backend le stocke : `backend/routers/orders.py:388`
  (`"manual_operator": body.manual_operator if body.payment_method == "manual" else None`) et le relit :
  `orders.py:161` (`public_order` fait `setdefault("manual_operator", None)`) + `orders.py:456-459`
  (GET `/orders/{id}` → `public_order`). Le frontend le lisait : `OrderTrack.js:154`.
- **La cause du défaut affiché** : le sélecteur s'affichait sur `!order.manual_operator`
  (`frontend/src/pages/OrderTrack.js:245-249` avant le lot) et son choix local (`setOperator`, état
  React seulement) n'était **jamais persisté** ; pendant ce temps le titre « Payé avec » de la
  feuille repliait sur MVola indépendamment du sélecteur (`ProofPay.js:264-266` avant le lot) —
  d'où « titre MVola / sélecteur Orange ».
- Pour une NOUVELLE commande, la seule voie vers `manual_operator: null` serait un backend déployé
  **antérieur à #89** : Pydantic v2 ignore les champs extra par défaut (pas de `extra="forbid"` dans
  `OrderIn`, `orders.py:63-77`). **Non vérifiable ici** (backend non exécutable dans cet
  environnement — pas de MongoDB/docker/sudo ; version déployée inconnue). Le frontend envoie
  correctement le champ sur la version actuelle du backend (`OrderIn` déclare et valide le champ,
  `orders.py:76` + validateur `orders.py:111-118`).

### 2. Les feuilles perdaient leurs boutons
- `frontend/src/components/ui/sheet.jsx:33-34` : `side="bottom"` = `fixed inset-x-0 bottom-0`,
  **ni `max-height` ni `overflow`**. ProofSheet (`ProofPay.js:132-193` avant le lot), CancelSheet
  (`CancelSheet.js:69-106` avant le lot) et la feuille captcha custom (`Checkout.js:359-378` avant
  le lot) empilaient contenu + boutons dans la même colonne sans hauteur contrainte : sur un écran
  bas (620 px de bureau) le contenu dépassait la fenêtre et le pied n'était ni visible ni fixé.
- `ui/sheet.jsx` est **intentionnellement inchangé** (CartDrawer l'utilise encore) : une coquille
  dédiée partagée a été créée à la place (`CheckoutSheet.js`).

### 3. La flèche de retour
- Un seul composant partagé : `frontend/src/components/common/BackButton.js:6` avant le lot —
  `CLS = "h-10 w-10 rounded-full border bg-card"` (cercle bordé) + `ArrowLeft` 16 px. Utilisé par
  `Checkout.js:260,277`, `OrderTrack.js:199`, `AuthPage.js:60`, `AuthExtras.js:21`.

### 4. Composants trop gros
- CopyButton : `frontend/src/components/store/PaymentFlow.js` (avant le lot) — `h-11 w-11
  rounded-[8px] border` (gros carré bordé).
- Diamond : `frontend/src/pages/OrderTrack.js:352` avant le lot — 27 px / chiffre 13 px.
- PaymentCountdown : `frontend/src/components/store/checkout/PaymentCountdown.js:42-47` avant le
  lot — carte grise `bg-muted` + `text-2xl`.
- BinancePay : `frontend/src/components/store/checkout/BinancePay.js` avant le lot — QR 168 px +
  grande carte + bouton « J'ai payé » ≈ 835 px de haut (débordait 360×640).

---

## T1 — Plus de sélecteur d'opérateur
- `frontend/src/pages/OrderTrack.js` : état `operator` supprimé ; `op = order.manual_operator`
  (`OrderTrack.js:230`) ; branches `manual && op` (titre/stapes/CTA preuve) vs `manual && !op`
  (écran `resume-unpayable`, `OrderTrack.js:250` + bouton `restart-button` → /boutique,
  `OrderTrack.js:329`) ; ProofSheet rendue seulement si `manual && op` ; import `Diamond, KV` depuis
  PaymentFlow (`OrderTrack.js:18`).
- `frontend/src/components/store/PaymentFlow.js` : `ManualProviderPicker` supprimé.
- La cause (point 1 étape 0) est corrigée côté affichage ; la création envoie déjà `manual_operator`
  (`Checkout.js:186-187`, inchangé, déjà conforme — couvert par `Checkout.test.js`).
- i18n : ajout `checkout.cannotPayHere` FR/EN ; suppression `chooseOperator`.

## T2 — BackButton style iOS
- `frontend/src/components/common/BackButton.js` réécrit : chevron SVG nu `viewBox 0 0 12 20`
  (12×20 px, trait arrondi 2,4), **sans cercle ni fond**, zone tactile 44×44 (`h-11 w-11`) avec
  retrait négatif optique `-ml-2`, `aria-label` FR/EN (`common.back`), `to` → Link sinon button
  (`BackButton.js:10-15`).
- Utilisé partout : tunnel (`Checkout.js:260,277`), `/orders/:id` (`OrderTrack.js:199` + en-têtes
  reprise), `AuthPage.js:60`, `AuthExtras.js:21`. Anciens boutons ronds : retirés (composant
  réécrit, aucun style résiduel).

## T3 — Copie, losanges, compte à rebours
- `frontend/src/components/store/PaymentFlow.js:75-97` : CopyButton nue — `Copy`/`Check` 20×20 px
  trait 1,6 (`PaymentFlow.js:80`), sans cadre ni fond, zone 44×44 avec retrait négatif droit
  (`-mr-2`), retour « Copié » conservé.
- `Diamond` 22×22 px, chiffre 11 px, filet aligné au centre : `PaymentFlow.js:90-93` ; conteneur
  d'étapes `pl-[34px]` + filet `left-[11px]` (`OrderTrack.js:262-263`, `BinancePay.js:61-62`).
- `frontend/src/components/store/checkout/PaymentCountdown.js:45-47` : une seule ligne « Payer
  sous » 16 px + temps 16 px extrabold couleur d'avertissement, séparés de 8 px (`items-baseline
  gap-2`) ; carte grise supprimée ; `role="timer"` + paliers sr-only 5 min/1 min/expiration
  inchangés. i18n `countdownLabel` → « Payer sous » / "Pay within".

## T4 — Feuille partagée, boutons toujours visibles
- NOUVEAU `frontend/src/components/store/checkout/CheckoutSheet.js` : contenu défilable
  (`min-h-0 flex-1 overflow-y-auto`, `${testId}-scroll`) + **pied fixe** (`flex-none border-t`,
  `${testId}-footer`) ; hauteur `max-h-[calc(100dvh-48px)]` (`CheckoutSheet.js:71`) ; pied avec
  `env(safe-area-inset-bottom)` (`:116`) ; croix ✕ 44 px aria-label (`:106-113`) ; poignée ;
  focus piégé (Radix) ; Échap ; `aria-modal` ; fermeture arrière-plan refusée pendant l'envoi
  (`onEscapeKeyDown`/`onInteractOutside` + garde `onOpenChange`, busy) ; bureau ≥1024 : fenêtre
  centrée 480 px, max-h 80 %, pied « Fermer » (`${testId}-desktop-close`) + principal.
- Migration : `ProofPay.js:134` (footer `proof-submit`, case « J'ai déjà effectué le paiement. »
  `:185`, clé `proofExactPaid`), `CancelSheet.js` (footer `cancel-keep` lime + `cancel-confirm`
  contour grisé sans raison `:76-83`), `Checkout.js:359-378` → feuille captcha `keepMounted`
  (`Checkout.js:361`).
- **Découverte du lot** : une feuille Radix MODALE `forceMount`-ée verrouille le `body`
  (`pointer-events: none`, via `DismissableLayer` de `@radix-ui/react-dismissable-layer:70-84`) et
  masque toute la page (`aria-hidden`, via `hideOthers` dans `DialogContentModal`) dès le montage,
  même fermée — la page entière devenait inutilisable. La feuille captcha est donc NON MODALE
  (`modal={!keepMounted}`, `CheckoutSheet.js:76`) : la coquille fournit l'overlay cliquable (sauf
  busy) et le piège de focus Tab en boucle (`trapTab`, `CheckoutSheet.js:36-48`). Preuves/annulation
  restent Radix modales standards.
- Testids conservés : `proof-sheet-title`, `cancel-sheet-title`, `captcha-sheet-title`,
  `proof-exact-checkbox`, `proof-submit`, `cancel-keep`, `cancel-confirm`, `cancel-reason-*`,
  `captcha-sheet-submit` ; nouveaux stables : `${testId}-footer`, `-scroll`, `-close`,
  `-desktop-close`, `BackButton` (`*-back`), `copy-*`.

## T5 — BinancePay (écran 6)
- `frontend/src/components/store/checkout/BinancePay.js` réécrit : deux étapes numérotées (losanges
  partagées) — ① montant exact / réseau / adresse tronquée au milieu (`truncateMiddle`,
  `BinancePay.js:20` — 4 premiers + … + 4 derniers, la copie prend la **valeur complète**
  `:69`), ② « Le paiement est détecté automatiquement. Aucune preuve à envoyer. » (`:78`) ; QR
  retiré ; bouton manuel « J'ai payé » retiré (maquette = bouton désactivé « En attente du
  paiement… », rendu par OrderTrack `:334-337`, `binance-waiting`) ; état FAILED conservé
  (`crypto-failed` + lien suivi) ; **logique inchangée** : sondage GET `/crypto/{id}/status`
  toutes les 8 s, `onConfirmed` au statut CONFIRMED, **jamais de 2ᵉ initiation** (POST /crypto non
  appelé depuis ce composant ; vérifié par `OrderTrack.test.js:227,239`).
- `resume-binance-noproof` rendu DANS BinancePay (texte maquette) ; OrderTrack garde le même testid
  pour la branche sans slot (`OrderTrack.js:293`).
- i18n : ajout `binanceExactTitle/binanceExactAmount/binanceNetwork/binanceAddress/binanceMemo` ;
  suppression `binancePayTitle`, `walletAddress`, `memo`, `copyAddress`, `iPaid`, `exactAmount`,
  `expiresAt`, `cryptoChecking` (FR et EN). `qrcode.react` reste dans package.json (import retiré —
  retrait de dépendance non demandé).

## T6 — Connexion / inscription compactées
- `frontend/src/pages/AuthPage.js` : en-tête 44 px, `pb-6 pt-1`, titre 26 px, carte `p-5 mt-5`,
  Google h-11, séparateur `my-4`, champs h-11, `space-y-3.5`, pied `mt-4`. Connexion tient
  360×640 ; inscription tient aussi (le widget Cloudflare d'inscription déborde → défilement
  toléré par l'énoncé).
- `frontend/src/pages/AuthExtras.js` (Shell, mot de passe oublié / réinitialisation) : mêmes
  resserrements + champs h-11.
- Capture : `10-connexion-360x640-light/dark.png`.

---

## Validation

### Tests (baseline PL-CHK-4 : 33 suites / 379 tests)
- `yarn test:ci` : **34 suites / 381 tests, 0 échec** (après le correctif captcha non-modal ; un
  run intermédiaire avait 4 échecs attendus — tests à adapter, voir ci-dessous).
- Avant/après :
  - `OrderTrack.test.js` : test « sélecteur d'opérateur affiché » remplacé par « AUCUN sélecteur,
    AUCUN numéro — message + Recommencer » (`resume-unpayable`, `restart-button` href /boutique) ;
    les 25 autres tests conservés (dont « jamais de 2e initiation » ×2, payload `manual_operator`
    déjà couvert côté `Checkout.test.js`).
  - `Checkout.test.js` : 4 requêtes captcha migrées `container.querySelector` → `document.body`
    (feuille Radix portalisée) ; test « sans clé : aucune feuille » adapté.
  - `ProofPay.test.js` : +3 assertions (texte de case « J'ai déjà effectué le paiement. », pied
    `proof-sheet-footer` contient `proof-submit`, zone défilable ne le contient pas).
  - `BackButton.test.js` NOUVEAU : sans cercle ni bordure, `h-11 w-11`, aria-label, action + lien.
  - `PaymentCountdown.test.js` : inchangé, passe (label via i18n).

### Build
- `REACT_APP_BACKEND_URL=http://localhost:8001 yarn build` → « Compiled successfully », exit 0,
  **aucun avertissement ESLint** (seuls warnings Tailwind préexistants `duration-[420ms]` et
  dépréciation Node `fs.F_OK`).

### Audit de contraste (sur `main` après fusion, règle n° 12 : à relancer)
- Run sur la branche (bundle compilé, `CHROMIUM_PATH=/home/selneker/.local/bin/google-chrome`) :
  durée 959,56 s ; sortie de fin exacte :
  ```
  admin-messages-conversation0             0             0             0             0
  admin-fidelite             0             0             0             0
  admin-utilisateurs       0             0             0             0

    TOTAL : 0 echecs
  Done in 959.56s.
  ```
  exit **0**, 0 échec, 0 page non chargée (le script sort en erreur sinon). Un seul Chromium à la
  fois ; pas d'OOM.
- **À relancer sur `main` après fusion** (règle permanente n° 12).

### Images dans le dépôt
- `git diff --name-only origin/main | grep -Ei '\.(png|jpe?g|webp)$'` → **vide** (exit 1).

### Contrôle de visibilité des boutons — 3 feuilles × 5 tailles × 2 thèmes
Contrôle automatisé (`getBoundingClientRect().bottom <= window.innerHeight` sur le pied ET chaque
bouton) exécuté au moment de chaque capture ; journal complet dans
`repports/captures/PL-CHK-5/controle-visibilite.json`. Résultat : **30/30 vérifications OK,
0 échec** — pied et boutons toujours dans la fenêtre :

| Feuille | 360×560 | 360×640 | 390×844 | 1366×620 | 1280×720 |
|---|---|---|---|---|---|
| preuve (`proof-submit` + Fermer bureau) | OK (fond=560) | OK (628) | OK (832) | OK (471) | OK (521) |
| annulation (`cancel-keep`, `cancel-confirm` + Fermer) | OK | OK (832) | OK (832) | OK (464) | OK (514) |
| captcha (`captcha-sheet-submit` + Fermer) | OK | OK (628) | OK (832) | OK (391) | OK (441) |

(Valeurs = `bottom` du dernier bouton en px ; `<= innerHeight` partout ; bureau ajoute « Fermer »
dans le même pied — même bottom.)

Captures (40) : les 3 feuilles × 5 tailles × clair/sombre + appuis : écran 2 (MVola) et écran 6
(Binance) 360×640 et 1366×620 en clair et sombre, connexion compactée 360×640 clair et sombre.

### Commit
- Un commit `PL-CHK-5: …`, `git add` à chemins explicites ; jamais `Issues/`,
  `PLAN-PL-002-neferbyte-identite.md`, `planning-agent-rules.md`, `repports/`, `frontend/capture-pl-chk-*.mjs`.
- Hash : **`0140ccfcb6bad4f5ba72268caecb25fdcbefc061`** — « PL-CHK-5: paiement sans selecteur
  d'operateur, feuilles a pied fixe (dvh), retour iOS, copie/losanges/countdown compacts, Binance
  ecran 6, auth compactee » (16 fichiers, +525/−326 ; aucun push).

---

## Non vérifié ici
- **Backend réel** : non exécutable dans cet environnement (pas de MongoDB/docker/sudo). Contrats
  vérifiés par lecture (`orders.py:76,111-118,161,388,456-459`).
- **Version backend déployée** : inconnue ; un backend antérieur à #89 expliquerait un
  `manual_operator: null` sur commande neuve (Pydantic v2 ignore les champs extra). À confirmer en
  production.
- **Vrai widget Cloudflare Turnstile** : captures avec le stub (clé de test publique 1x…AA, widget
  ne donnant jamais de jeton) ; le comportement réel (interactive challenge) n'est pas reproduit.
- **Appareils réels** : captures Chromium desktop (user-agent desktop, viewport mobile émulé) ;
  pas de test sur téléphone physique (USSD réel, clavier natif, encoche/safe-area réels).
