# PL-UX-5-ADMIN-ORDERS-V2 — Rapport

**Point de situation final (12/11)** : la v1 a été fusionnée par le propriétaire (PR **#95**, `ec4cef6`), puis le resserrage (PR **#96**, `c3b83ad`). Le **retour d'alignement** du propriétaire (« paiement/email en ligne avec le statut », « produit en ligne avec la date/heure ») est livré sur la branche **`fix/ux-5-orders-align`**, commit **`3fdf591`** — 1 commit devant `origin/main` (`c3b83ad`), 2 fichiers, +55/−40, **aucun push** (branche absente de l'origine, `git ls-remote` = 0).

### Alignement (retour propriétaire, 12/11 — 2ᵉ itération)
Les colonnes 1 et 2 redeviennent des **piles autonomes** à cheval sur les lignes 1-2 de la grille (col. 3 = montant l. 1, actions l. 2), ce qui rend l'alignement purement interne :
- **Produit ↔ date/heure** : marge produit `sm:mt-[2px]` = marge date `mt-[2px]`, interlignes fixés (date `leading-[17px]`, produit `leading-[21px]`) → hauts de ligne **identiques au rendu (325 = 325, mesuré)**.
- **Paiement/email ↔ badge de statut** : marge paiement `sm:mt-[3px]` calculée (21 + 2 + 21 + 3 = 47 = 21 + 2 + 17 + 7) et wrapper du badge `leading-none` (supprime le décalage de 1 px du strut d'interligne) → **349 = 349, mesuré**.
- Ligne produit dupliquée dans le DOM (résumé mobile `sm:hidden` / pile bureau `hidden sm:block`) — contenu statique uniquement.
- Mesures : `capture-pl-ux-5.mjs` (`yDate/yProduct/yBadge/yMeta`), captures régénérées + planche `comparaison-maquette-vs-app.png`. Tests 463/464 (échec unique = `pendingOrder.test.js` connu), build OK. Couleurs inchangées → audit de contraste non re-passé (aucun texte/neuvième peinture modifié).

---

## 1. Inventaire (Étape 0) et point critique « Marquer livrée »

| Élément | Avant (sur `d462307`) | Fichier:ligne |
|---|---|---|
| Carte de commande admin | PL-UX-4 : 4 lignes mobiles / colonnes desktop | `AdminOrders.js:186-241` |
| Badge de statut (« style d'origine ») | `StatusPill` — boîte bord 1 px, rayon 0, majuscules, graisse 800 (`font-black`), icône à gauche, texte 10 px | `OrderTrack.js:23-39` (STYLE + composant) |
| Sélecteur de statut + gestionnaire | `Select onValueChange={(v) => setStatus(o, v)}` ; trigger `rounded-full h-9 w-44` | `AdminOrders.js:226-229` ; `setStatus` `:137-139` |
| **Bouton « Marquer livrée »** | `onClick={() => setStatus(o, "delivered")}` | `AdminOrders.js:230` (avant) |
| Ce que le bouton appelait | `setStatus(o, "delivered")` → `PATCH /admin/orders/{id}` `{ status }` + toast + `load()` | `AdminOrders.js:137-139` |
| Bloc « Détails » (FzrFulfillment) | Grande barre grise `bg-slate-50`, en-tête « DÉTAILS » + bouton rond de repli | `FzrFulfillment.js:101-124` |
| « Preuves (n) » | Bouton `rounded-full h-11` | `OrderProofs.js:22-31` |
| Visionneuse | `ProofViewer` inchangée (PL-UX-4) | `components/admin/ProofViewer.js` |
| Icône de copie (admin, avant PL-UX-4) | `CopyButton` par défaut : carré bordé 24 px, icône 14 px ; PL-UX-4 utilisait `bare` (sans cadre) | `CopyButton.js:13-16` ; usages avant PL-UX-4 : `git show 0bf8c55:frontend/src/pages/admin/AdminOrders.js` (lignes « CopyButton value=… ») |

### Point critique — VERDICT : le sélecteur REMPLACE le bouton en toute sécurité ✅

- Le bouton (`AdminOrders.js:230` avant) et le sélecteur (`:226` avant) appelaient **tous les deux la même fonction** `setStatus(o, "delivered")` → **même route** `PATCH /admin/orders/{id}`, **même corps** `{ status: "delivered" }`, **mêmes effets** (toast `order.status.delivered`, `load()`).
- Effets backend identiques pour un statut cible donné, quel que soit le point d'entrée — `backend/routers/orders.py:793-823` (lecture seule) : contrôle de transition `:796-798`, `proof_reviewed_at` / `proof_validated_at` `:803-809`, `history` `:810`, audit `:817`, `on_order_paid` (payée) `:819`, `reverse_for_order` (annulée) `:820-822`, libération des verrous d'abonnement `:823`. Aucun endpoint « deliver » séparé n'existe.
- Condition d'affichage identique : `canDeliver(o.status)` ⇔ `TRANSITIONS[o.status]?.includes("delivered")` ⇔ « Livrée » proposée dans le sélecteur.
- → Le bouton est **supprimé partout** (bureau et mobile) ainsi que `canDeliver` (code mort) ; le sélecteur « Livrée » reste visible et, comme aujourd'hui, désactivé quand aucune transition n'est possible (`delivered`/`cancelled`). Test ajouté : `admin-deliver-*` absent.

## 2. Spécification appliquée (fichier:ligne → valeur)

### Communs
| Valeur maquette | Appliqué à |
|---|---|
| Carte : rayon 16 px, bordure 1 px, marges 14/16 px | `AdminOrders.js:99` `rounded-[16px] border border-[color:var(--rule)] bg-white px-4 py-[14px]` |
| Rayons boutons/sélecteur/icônes = 8 px (jamais de pilule) | Select `:179` `rounded-[8px]` ; Preuves `OrderProofs.js:29` ; suppression `AdminOrders.js:185` ; simulations `:182-184` ; Envoyer/Rafraîchir `FzrFulfillment.js:116,122` ; chevron `:124` |
| Badge : boîte d'origine, plus petit (9,5 px, 2 px × 6 px, icône 10 px, rayon 0, majuscules, 800, interlettrage léger) | `OrderTrack.js:35-42` prop `small` (`text-[9.5px] px-1.5 py-[2px] tracking-[0.06em]`, icône `h-2.5`), défaut = style d'origine inchangé ; utilisé `AdminOrders.js:120,133` |
| Couleurs badge : Payée = fond vert citron/texte noir ; Livrée = noir/blanc ; Attente = blanc/noir | Classes d'origine conservées (`OrderTrack.js:24-32`) : paid `bg-primary` (= jeton lime `--primary` #C5FE02) + `text-[#0A0A0A]` ; delivered `bg-foreground text-background` ; pending `border-foreground bg-transparent` (blanc sur carte) |
| Icône de copie : carré bordé 20 px, bordure 1 px, rayon 3 px, icône 12 px | `CopyButton.js:11,21` variante `small` (zone tactile 44 px via pseudo-élément `before:-inset-3`) ; défaut/`bare` inchangés (PaymentFlow non touché) |
| Chiffres tabulaires (numéro, montant, date, ID) | classe `num` : `AdminOrders.js:118,127,132,140,158` |
| Espace entre cartes 10 px | `AdminOrders.js:278` `space-y-2.5` |

### Resserrage (retour du propriétaire, 12/11 — espaces vides supprimés)
La 1ʳᵉ version découpait le bureau en **lignes de grille partagées** : la ligne 1 était étirée à la hauteur de
l'en-tête (n° + date + badge ≈ 90 px) → grands blancs entre pseudo/produit et montant/sélecteur. La maquette empile
**chaque colonne en une cellule** (`.row` + marges internes). Corrigé pour coller au pixel :
- `sm:gap-y-0` + marges internes = valeurs exactes de la maquette : produit `sm:mt-[3px]` (`.prod{margin-top:3px}`),
  paiement `mt-1.5` = 6 px (`.meta{margin-top:6px}`), actions `sm:mt-[10px]` (`.acts{margin-top:10px}`),
  Détails `mt-[10px]` (`.det{margin-top:10px}`) — `FzrFulfillment.js:110`.
- En-tête col. 1 à cheval sur les 3 lignes (`sm:row-span-3`) — plus aucune ligne étirée.
- Montant aligné à droite (`sm:text-right`) comme `.right{text-align:right}`.
- Date mobile courte sans secondes (écart n° 5 **résolu** : « 11/11/2026 16:30 » comme la maquette) ; le bureau
  garde les secondes (deux variantes d'en-tête déjà séparées).

### Bureau (≥ 641 px, breakpoint `sm:` du site = 640 px, inchangé)
| Valeur maquette | Appliqué à |
|---|---|
| Grille `215px \| 1fr \| auto`, espace 18 px | `AdminOrders.js:99` `sm:grid-cols-[215px_1fr_auto] sm:gap-[18px]` (mesuré au rendu : `215px 267.9px 407px`) |
| Col. 1 : n° gras 14 px + copie ; date 11 px gris ; badge | `AdminOrders.js:128-134` (`text-[14px] font-bold`, date `text-[11px] tracking-[0.04em]`, badge `mt-[7px]`) |
| Col. 2 : « pseudo · ID » 14 px 600 une seule ligne + copie ; produit gris ; opérateur en gras + « · email » gris 12 px | `AdminOrders.js:154-163` (pseudo `truncate`, jamais de passage à la ligne), `:136` (produit), `:165-176` (opérateur `font-semibold text-foreground`, email `text-xs`) |
| Col. 3 : montant 800 17 px ; sélecteur 235 px bord encre rayon 8 px ; « Preuves (n) » bordé rayon 8 ; suppression 34 px sans bordure ; pas de « Marquer livrée » | `AdminOrders.js:140` (`text-[17px] font-extrabold`), `:179` (`sm:w-[235px] sm:h-[34px] border-ink`), `OrderProofs.js:29` + `AdminOrders.js:181`, `:185` (`sm:h-[34px] sm:w-[34px]` ghost) |
| Sous la carte : séparateur 1 px puis « Détails » + chevron 12 px gris 600 — plus de grande barre grise | `FzrFulfillment.js:105-124` (`border-t pt-[9px]`, lien `text-xs font-semibold text-muted-foreground`) — la barre grise `bg-slate-50` est supprimée |
| « Preuves (n) » seulement s'il y a ≥ 1 preuve | `OrderProofs.js:18` (inchangé) |

### Mobile (≤ 640 px) — cartes repliables
| Valeur maquette | Appliqué à |
|---|---|
| Bloc repliable, chevron carré bordé 26 px rayon 8 px ; bas = fermé, haut = ouvert (rotation 180°, 200 ms, coupée sous `prefers-reduced-motion`) | `AdminOrders.js:110-126` (`h-[26px] w-[26px] rounded-[8px]`, `rotate-180 transition-transform duration-200 motion-reduce:transition-none`) |
| En-tête entièrement cliquable, `<button>` avec `aria-expanded` + `aria-controls` | `AdminOrders.js:105-125` + `data-testid` `admin-order-toggle-{n}` `:113` |
| Fermée : n° + date + badge à gauche, flèche à droite, ligne « produit … montant » | `:115-125` + ligne résumé `:136-141` |
| Ouverte : séparateur, « pseudo · ID » + copie, opérateur gras, email gris tronqué « … », sélecteur pleine largeur 44 px, rangée Preuves (flexible, 44 px) + suppression (44 px), lien « Détails » | corps `:145-193` : sélecteur `:179` (`h-11 w-full`), Preuves `:181` (`h-11 flex-1`), suppression `:185` (`h-11 w-11`), email `:176-178` (`basis-full truncate` ; le « · » n'apparaît que sur bureau) |
| Toutes repliées par défaut ; état local non persistant, correct après rafraîchissement/filtre | `AdminOrderCard` `useState(false)` `:97` — composant dédié à identité React stable (clé = id) : l'état survit au rechargement des 15 s, se réinitialise quand la carte disparaît du filtre |
| Zone tactile ≥ 44 px (en-tête entier) ; aucun débordement à 320 px | en-tête = toute la ligne ; mesuré : `docW == innerW` à 320/390/1440 |
| `data-testid` sur le bouton de repli et la zone repliée | `admin-order-toggle-{n}` `:113`, `admin-order-body-{n}` `:148` |

### Un seul DOM, deux mises en page
Le corps se dissout en cellules de grille sur bureau (`sm:contents`, `AdminOrders.js:146`) ; l'en-tête existe en **deux variantes** : bouton pur mobile (`sm:hidden`, sans icône de copie — la maquette n'en met pas dans l'en-tête fermé) et colonne 1 bureau (`hidden sm:block`, avec copie). Cela évite d'imbriquer un `<button>` de copie dans le `<button>` de repli (HTML invalide — détecté par React pendant les tests) et garantit qu'`aria-expanded` n'existe que là où le repli existe (mobile).

## 3. Liste des écarts par rapport à la maquette

1. **« Forcer payée » / « Forcer échouée » conservés** sur les commandes `pending_payment` non manuelles (maquette : absents). Les actions sont déclarées « inchangées » par la spec ; je n'ai changé que leur rayon (8 px au lieu de pilule).
2. **Lien « Détails » absent sur la commande en attente** (maquette : présent sur les 3 cartes). Le bloc Détails n'existe que pour les commandes payées/suivies fournisseur — comportement inchangé (`FzrFulfillment.js:67`), la spec le déclarant inchangé.
3. **Actions « Envoyer (n) » et « Rafraîchir »** affichées dans la ligne Détails quand elles s'appliquent (maquette : seulement « Détails + chevron »). Actions inchangées exigées ; sans ces boutons elles seraient devenues inaccessibles.
4. **Ligne méthode enrichie** : pour les commandes USSD, « USSD · **MVola** · réf » (référence + icône de copie conservées) ; pour MVola/Orange legacy, « **MVola** · 034… » + copie. La maquette ne montre que « opérateur · email » ; j'ai gardé la référence/le numéro (les `data-testid` `copy-ref-*` / `copy-phone-*` existants sont protégés par la spec) et mis l'opérateur en gras comme demandé.
5. ~~**Date avec secondes sur mobile**~~ **Résolu le 12/11** : le mobile affiche la date courte sans secondes (« 11/11/2026 16:30 ») comme la maquette ; le bureau garde les secondes (les deux variantes d'en-tête sont déjà des nœuds séparés).
6. **Couleurs = jetons du site, pas les hex de la maquette** : lime `--primary` #C5FE02 (maquette #CBFE01), bordures `var(--rule)` / `var(--rule-strong)` / `border-ink` (maquette #E4E1D8 / #cfcbc0). Règle 2 (jetons existants) + règle 7 du guide projet (pas de hex hors jeton).
7. **Badge « Livrée » en thème sombre** : boîte claire + texte encre (`bg-foreground text-background`, couleurs d'origine auto-cohérentes) ; la maquette n'est définie qu'en clair.
8. **Pseudo long tronqué « … » sur bureau réel** : la maquette (canevas 960 px) affiche « NomTresLongDeJoueurPUBG » en entier ; dans l'admin réel (~926 px de contenu), la colonne 2 fait ~268 px → troncation avec « … », une seule ligne respectée (exigence « aucun texte qui passe à la ligne de force »).
9. **En-tête mobile sans icône de copie du n°** : conforme à la maquette (copie du n° uniquement en colonne 1 bureau) ; conséquence technique documentée en §2 (imbrication de boutons interdite).
10. **Maquette sans variante 320 px** : vérifié par mesure (aucun débordement, `docW = 320`), capture fournie.

## 4. Vérifications

### Tests (`yarn test:ci`)
- **Avant** (`main`, `d462307`) : `Test Suites: 1 failed, 38 passed, 39 total` / `Tests: 1 failed, 459 passed, 460 total` — l'unique échec est le cas **connu et pré-existant** `frontend/src/lib/pendingOrder.test.js:20` (date codée en dur `2026-11-10T12:00:00Z`, périmée > 24 h) ; non touché, comme demandé.
- **Après** (`1293c2a`) : `Test Suites: 1 failed, 38 passed, 39 total` / `Tests: 1 failed, 463 passed, 464 total` — même échec connu, **aucun nouveau test en échec**, +4 tests.
- Ajouts `AdminOrders.test.js` : grille bureau 3 colonnes + badge compact + `admin-deliver-*` absent ; cartes repliées par défaut, ouverture/fermeture, `aria-expanded`/`aria-controls` ; sélecteur `w-full h-11 rounded-[8px] border-ink` + email tronqué + Preuves masqué sans preuve ; actions de simulation conservées ; classes du bouton Preuves (`rounded-[8px]`, `sm:h-[34px]`). Ajout `FzrFulfillment.test.js` : plus de barre grise, lien « Détails » + chevron comme repli, rayons 8 px.
- Avertissement React `validateDOMNesting` (bouton de copie imbriqué dans le bouton de repli) **détecté pendant les tests puis corrigé** (§2) ; plus aucun avertissement.

### `yarn build` — OK (`REACT_APP_BACKEND_URL` pris dans `.env.example`, valeur publique ; 86 s). Note honnête : j'ai par erreur lu le nom d'une variable dans `.env` en début de session, sans en afficher la valeur ; corrigé immédiatement et ne s'est pas reproduit.

### `yarn audit:contrast` (bundle compilé, Chromium Chrome for Testing 156)
Sortie exacte (fin) :

```
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
Done in 976.57s.
```
40 pages auditées (390/1440, clair et sombre), **0 échec, 0 page NON CHARGÉE, exit 0**. Aucune exclusion ajoutée.

### Comparaison visuelle (vérification 3) — `repports/captures/PL-UX-5/`
15 fichiers : captures maquette (`maquette-bureau.png`, `maquette-mobile-ferme.png`, `maquette-mobile-ouvert.png` — la maquette n'offre pas de variante 320), captures application (`app-bureau-ferme-1440x900-{light,dark}.png`, `app-mobile-ferme-390x844-{light,dark}.png`, `app-mobile-ouvert-390x844-{light,dark}.png`, `app-mobile-ferme-320x700-{light,dark}.png`, `app-mobile-ouvert-320x700-{light,dark}.png`) et planches **côte à côte** `comparaison-maquette-vs-app.png`. Mesures au rendu : grille `215px | 1fr | auto`, badge `9.5px / 2px 6px / rayon 0 / uppercase / 900`, `deliverPresent: false`, `aria-expanded` false→true au clic, corps `hidden`→`block`, aucun débordement horizontal à 320 px.

### Images
`git diff --name-only origin/main | grep -Ei '\.(png|jpe?g|webp)$'` → **aucune sortie** (exit 1) ✓. Fichiers interdits (`Issues/`, `PLAN-PL-002-neferbyte-identite.md`, `planning-agent-rules.md`, `repports/`, `capture-*.mjs`) absents du commit (7 fichiers suivis modifiés, `git add` à chemins explicites).

## 5. Commit

- **Hash : `1293c2a`** (`1293c2ab067d947eab08dda44f32a4cbb34bcb59`) — branche **`feat/ux-5-admin-orders-v2`**, 1 commit devant `origin/main` (`d462307`).
- **Sans push : confirmé explicitement** — la branche n'existe pas sur `origin` (`git ls-remote` = 0 référence). Pas de merge, pas de PR.
- Fichiers du commit : `AdminOrders.js`, `AdminOrders.test.js`, `OrderProofs.js`, `FzrFulfillment.js`, `FzrFulfillment.test.js`, `CopyButton.js`, `OrderTrack.js`. **Aucun changement backend/API/route** (lecture seule de `routers/orders.py` pour la preuve du point critique).

## 6. Non vérifié ici

- **Appareil réel** : gestes tactiles (toucher l'en-tête vs défilement), clavier natif, luminosité, cibles 44 px au doigt — tout a été vérifié au simulateur Chromium (390/320, `isMobile`+`hasTouch`) et par mesures DOM, pas sur téléphone.
- Le comportement **après un vrai rechargement de la liste toutes les 15 s** (état ouvert conservé par identité React) est garanti par construction mais non observé sur une longue durée avec de vraies données.
- Le filtre opérateur (PL-UX-3), la visionneuse (PL-UX-4) et le bloc Détails n'ont pas été re-testés fonctionnellement de bout en bout (hors périmètre, inchangés).
- Le cas `pendingOrder.test.js` reste en échec sur `main` (pré-existant) — un lot de correction vous a déjà été proposé, « dis-moi si je le fais ».

## Décisions soumises au propriétaire

- Rappel PL-UX-4 toujours ouvert : faut-il retirer la **barre de navigation basse de l'admin** (visible sur les captures mobiles) ?
- Les boutons « Forcer payée / Forcer échouée » sont conservés (§3.1) : s'il faut les retirer comme la maquette le laisse penser, ce sera un mini-lot.
