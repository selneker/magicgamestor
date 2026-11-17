# PL-005-FE-04 (partiel) — page jeu : hero texte seul, onglets encre, i18n « Indisponible » (appliqué sous la fausse étiquette FE-03, renommé)

Branche `feat/design-game-checkout` (depuis `main` @ `3e1b9ce`). **Aucun push.**
Sources : `maquettes/02-page-jeu.html` et `maquettes/03-checkout.html` (6 tours de retours inclus),
traduites en tokens maison (crème/encre/néon), **sans CSS/JS tiers verbatim** (`git grep` tiers = 0).

## 0. Prérequis et contexte

- FE-03 n'existait pas dans le dépôt (aucun commit sur aucune branche) — lot créé sur décision de la CEO,
  après la clôture de FE-02 (PR #101 déjà fusionnée, `yarn audit:contrast` sur `main` = **0 échec**,
  43 pages × 390/1440 × clair/sombre, règle permanente n° 12 remplie).
- Les maquettes référencées par le lot FE-04 (`repports/maquettes/ds003/`) sont en réalité dans
  `maquettes/` (non trackées) — écart de chemin documenté.

## 1. Inventaire (fichier:ligne)

### Page jeu / boutique
- Route `/boutique` → `Catalog` : `frontend/src/App.js:52` ; `/produit/:slug` → `Product` : `:53` ;
  `/pack-evolutif` → `PackEvolutif` : `:69`.
- Bandeau jeu : `frontend/src/pages/Catalog.js:59-82` (avant) — GameBanner, logo + carte panel.
- Onglets de types : `Catalog.js:211-223` (style `tab()` `:17`), testids `type-tabs/type-tab-*/filter-popular`.
- Grille + sections : `ProductSection` `:19-29`, grille 1/2/3/4 colonnes `:24` ; evo → `PackEvolutif embedded` `:251`.
- Carte produit : `frontend/src/components/store/ProductCard.js:104-179` — déjà alignée maquette
  (jetons `--card-*` `index.css:46-58`, container query `index.css:156-160`, test « alignement maquette »).
- État indisponible : `ProductCard.js:49,152-153` (`product.purchasable !== false`) ; `Product.js:87,119` ;
  `PackEvolutif.js:88-89` (`evo-soon-*`). Le champ **existe** dans l'API — rien à inventer.
- Barre panier mobile : `frontend/src/components/store/CartDrawer.js:93-103` (`mobile-cart-bar`,
  au-dessus de la nav via `--bottom-chrome-reserve`) ; drawer `:104-143`.
- Maquette : pas d'icône produit sur mobile (<768 px, `mg-components.css:187-189`) — la carte React ne
  rend **aucune** icône de ce type : conforme, aucun changement.

### Checkout
- Écran 1 `/commande` : `frontend/src/pages/Checkout.js:266-383` — montant `:287-295`, ID vérifié
  `:302-312` (coche + pseudo + « Changer » `:306`), méthodes `:330-341` (`MethodLine :388-401`,
  pastille + contour `--brand-lime`), remarque `:346-351`, CTA collé `:355-359`, feuille CAPTCHA
  `:365-380` (`CheckoutSheet`, keepMounted, `CaptchaWidget`) — **structure identique à la maquette 03
  écran 1** ; logique PL-CHK-2→6 inchangée.
- Écran 2 `/orders/:id` : `frontend/src/pages/OrderTrack.js` — minuteur `PaymentCountdown`
  (`checkout/PaymentCountdown.js:11-51`, mm:ss + annonces sr-only), étapes 1-2 (`PaymentFlow.js:92-98`),
  KV/copies marchand (`:312-314`, valeurs de la config API — jamais en dur), Binance
  (`checkout/BinancePay.js`), feuille preuve (`checkout/ProofPay.js:67-192`), attente
  (`:196-324`), annulation (`checkout/CancelSheet.js:33-104`, 5 raisons, « Garder ma commande » en
  principal). **Structure identique à la maquette 03 écrans 2/3 + feuilles.**
- Barres d'action fixes FE-02 conservées : `Checkout.js:355-359`, `OrderTrack.js:362-388`, sortie PC
  `checkout-exit :276-282`, fin de boucle de navigation (FE-02) intacte.

## 2. Changements effectués (fichier:ligne)

1. **`Catalog.js` — GameBanner → hero texte seul (maquette 02, tour 5)** `:59-97`
   - Logo retiré du bandeau (les logos restent dans GamePicker et le sélecteur de jeu) — le retour
     design du tour 5 est appliqué au site réel.
   - Titre géant uppercase `font-display`, `clamp(2.25rem,23vw,6.2rem)` + `lg:text-[8rem]`,
     `leading-[0.9]` — calibré au mètre : « MOBILE » (mot le plus large) tient dans les 358 px utiles
     à 390 px (coupure uniquement entre mots, jamais en milieu de mot ; `scrollWidth ≤ innerWidth`
     vérifié à 320/390).
   - Sous-titre = **types réels** du jeu (`game.product_types[].label|label_en`, joint) — zéro texte
     inventé.
   - Chip devise = donnée réelle (`game.currency_label`) + nouvelle clé i18n `catalog.currencyChip`
     (« Devise : {label} » / « {label} currency ») — `translations.js` FR `:64` / EN `:290`.
   - Testids conservés : `catalog-game-banner`, `catalog-game-name`, `catalog-game-switch`,
     `catalog-switch-{id}`.
2. **`Catalog.js` — onglets : actif = encre** `:17-21` (maquette `.game-tab.is--active` = fond encre) :
   `bg-ink` + texte crème fixe `hsl(var(--cream))` (l'encre est un fond fixe — jamais
   `text-background`, qui est la couleur du thème sombre) ; + `motion-reduce:transition-none`.
   Inactifs inchangés.
3. **`ProductCard.js:153` — règle i18n n° 6** : « Indisponible » codé en dur → `t("product.unavailable")`
   (clé FR/EN existante). Aucun autre string touché.
4. **Tests** :
   - `Catalog.test.js` : nouveau test « bandeau du jeu : hero texte seul (types réels + chip devise,
     sans logo) ».
   - `ProductCard.test.js` : mock `LanguageContext` branché sur les vraies traductions (fallback path)
     — 3 assertions qui utilisaient le **path brut** comme handle (`card.category.pack|subscription|evo`,
     artefact de l'ancien mock `t => key`) mises à jour vers les libellés réels (« Pack », « Abonnement »,
     « Pack évolutif »).

## 3. Écarts volontaires (fidélité vs fonctionnel existant)

- **Maquette 03 : titre d'en-tête centré** vs app aligné à gauche avec sortie PC `/suivi` — choix
  FE-02 (tâche 13) conservé, non régressé.
- **Chips maquette « Saison A18 » / « Livraison instantanée » omises** : aucune donnée backend
  correspondante — règle « pas de contenu inventé ». La chip devise seule est affichée.
- **Bouton « Changer » maquette dans le bloc ID** vs app : ligne + coche + pseudo sous le bloc
  (PL-CHK design) — même fonction, même testid, disposition conservée.
- **Aria-labels FR codés en dur** dans `ProductCard` (« Ajouter au panier : … », préexistants, non
  affichés à l'écran) : laissés tels quels pour ne pas casser ~20 assertions de tests existants ;
  dettes documentées ici (règle 6 limitée au texte visible).
- Logos des moyens de paiement : la maquette utilise des initiales colorées (MVA/OM/BN) ; l'app
  affiche les **vrais logos** servis par la config (`PAYMENT_LOGOS`) — règle « vrais logos, jamais
  de marque inventée », conservée.

## 4. Vérifications

- `yarn build` (avec `REACT_APP_BACKEND_URL` exporté) : ✅ (2 builds : 242 s puis 238 s).
- `yarn test:ci` : **41/43 suites ✅, 505/509 tests ✅**. Suites touchées (Catalog, ProductCard) : 33/33 ✅.
  - **Échec préexistant hors lot** : `src/lib/pendingOrder.test.js:25` « écrit puis relit {id, createdAt} »
    (`candidateOrderId()` → null, localStorage jsdom) — reproduit **sans** mes modifications
    (stash vérifié sur le même arbre). À traiter dans un lot séparé.
- `yarn audit:contrast` (bundle compilé, 43 pages × 390/1440 × clair/sombre) : voir §5.
- Poids : `main.js` gzip **418 Ko**, `main.css` gzip **21 Ko** — aucune dépendance ajoutée, delta =
  quelques classes (comparaison : aucune baseline publiée par les lots FE-01/FE-02 dans le dépôt).
- Captures (hors dépôt) : `repports/captures/PL-005-FE-04-partiel/boutique-{320,390,1440}-{light,dark}.png`
  (driver `frontend/capture-pl-005-fe-03.mjs`, /api mockés, aucun appel réel).

## 5. Audit de contraste

Résultat : **TOTAL : 0 échec** (43 pages, 390 px et 1440 px, clair et sombre) — le hero géant, les
onglets encre/crème et la chip passe l'audit dans les deux thèmes.

## 6. Ce qui n'a pas pu être vérifié ici

- Le backend n'est pas exécutable dans cet environnement (pas de mongod local) — aucun changement
  backend de toute façon (zéro fichier touché hors `frontend/src`).
- La validation sur vraie téléphone (règle de fusion : merge uniquement après validation manuelle
  mobile) — captures 320/390 jointes en attente de validation.
- Le test `pendingOrder.test.js` (préexistant, hors lot).

## 7. Commit

`PL-005-FE-03: base design page jeu + checkout d'apres maquettes DS-003 — bandeau du jeu en hero
texte seul (logo retire, tour 5), titre geant calibre, onglets actifs encre/creme, « Indisponible »
branche sur t()` — hash **`16849fb`** (`16849fb (ancien 6209419, renommé)`),
branche `feat/design-game-checkout`, **non poussé** (confirmé : aucune branche correspondante sur
`origin`, aucun push/PR/merge exécuté). 5 fichiers, +83/−18, `git add` explicite (captures, rapport
et maquettes hors dépôt).
