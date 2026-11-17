# Rapport PL-NAV-1-COMPACT — barre du bas compacte + grille 2 colonnes + fix bouton manette

Branche : `feat/nav-1-compact` (créée depuis `main` à jour = `8dee44e`). **Aucun push, aucun merge,
aucune PR** — le propriétaire s'en charge. Un seul commit, préfixé `PL-NAV-1-COMPACT`.

## 1. Inventaire et verdict historique (étape 0)

| Élément | Fichier:ligne (avant lot) |
|---|---|
| Barre de navigation mobile | `frontend/src/components/layout/BottomNav.js:50-93` (wrapper :56, nav :59, items :66-91) |
| Bouton changement rapide de jeu | `frontend/src/components/layout/GameButton.js:44-83` (bouton :46, calques image/manette/✕ :60-80) |
| Sélecteur de jeu (panneau ouvert) | `frontend/src/components/layout/GameSelector.js:60-121` (liste `<ul>` :73) |
| Styles partagés | `frontend/src/index.css:248` (`.nav-pill` cercle), `:251` (`.nav-outer` 52 px), `:252` (`.nav-item-pill` 44 px) |

**Verdict historique — honnête : l'état « compact PLAN-004 » n'existe pas dans le dépôt.** Les
recherches (`git log --follow`, `git log -S` sur `flexGrow`/`inset-x-0`/`pr-[3.75rem]`/`pr-[5rem]`,
`--grep compact/PLAN-004` sur tout `--all`, grep des docs `plan-frontend-minimax.md`,
`planning-agent-rules.md`, `PLAN-PL-002-neferbyte-identite.md`, `repports/*.md`) ne trouvent
**ni** un commit PLAN-004 touchant ces fichiers **ni** un commit élargisseur ultérieur. La barre
est née **pleine largeur** dès sa création :

- `289c1da` « UI: navigation basse, cartes jeux, checkout une page (#83) » (PL-UI-BOTTOM-1, 2026-11-09)
  = commit de naissance du composant ; la nav y est déjà `flex-1` + items `{flexGrow: active?2.4:1, flexBasis:0}`.
  Seul changement de marge dans ce commit : `pr-[5rem]` → `pr-[3.75rem]` (historique antérieur :
  `f1d6e82`, `93e7756`, `572bb11` montrent le même wrapper).
- Le style « grille 2 colonnes » du sélecteur existe en revanche bien à l'origine de la
  fonctionnalité : `f1d6e82` (`grid grid-cols-2`, cartes `rounded-[20px]`, badge « actif »), avant
  la réécriture en pill horizontale (`92bd9fa` puis `289c1da`).

La cible « compacte » a donc été implémentée **depuis la consigne explicite** (largeur ≈ contenu des
4 onglets), pas par restauration d'un état antérieur ; aucune fonctionnalité n'a été perdue
(`layoutId` pastille active, animation du libellé, aria/testids, mode concentré conservés).

## 2. Corrections (fichier:ligne) et mesures

| # | Correction | Fichier:ligne (après lot) |
|---|---|---|
| T1 | Pastille compacte **centrée**, jamais étirée : wrapper `justify-center` + `pr-[4.5rem]` (garantit 8 px d'écart avec le bouton manette : 12+52+8, aucun chevauchement à 320 px) ; nav perd `flex-1`, gagne `max-w-full`, `gap-0.5` ; items perdent le style inline `{flexGrow…, flexBasis:0}` et `px-2`→`px-1.5` | `BottomNav.js:56` (wrapper), `:60` (nav), `:72` (items) |
| T2 | Icônes 21→**18 px** (:85), libellé 13,5→**12 px** (plancher 11 px respecté) :90, `pl-2`→`pl-1.5` ; hauteurs inchangées (`nav-outer` 52 px / `nav-item-pill` 44 px, `index.css:251-252` non touchée) → zones tactiles ≥ 44 px conservées, contrastes inchangés | `BottomNav.js:85,90` |
| T3 | Sélecteur redevenu **grille 2 colonnes** (état d'origine `f1d6e82`) : `<ul>` `grid grid-cols-2 gap-1.5 max-h-[min(58vh,320px)] overflow-y-auto overflow-x-hidden p-1.5`, cartes `min-h-[44px] rounded-[16px]` (pastille ronde 44 px + nom 11 px), actif = `bg-primary` + ring néon + `aria-checked`, « Tous » conservé (> 5 jeux, `MAX_ITEMS=5`), ancre `bottom-[calc(max(0.75rem,env(safe-area-inset-bottom,0px))+4.5rem)]` inchangée, fermeture ✕ / Échap / clic extérieur conservées | `GameSelector.js:98` (grille), `:108-125` (cartes), `:127-140` (« Tous ») |
| T4 | Bouton manette : `relative` ajouté au `motion.button` → les calques `absolute inset-0` d'`AnimatePresence` ont désormais **le bouton** pour conteneur (avant : le wrapper fixed, 12 px plus haut) ; image **parfaitement ronde** (clip `nav-pill` 9999px, `object-cover`, remplit le cercle) et manette/✕ **exactement centrées** H/V | `GameButton.js:47` |

**Cause racine T4 (prouvée par mesure)** : le bouton n'était pas positionné, donc les calques
absolus prenaient le wrapper fixed (64 px de haut) comme conteneur → image 52×**64** px, radius 0,
débordant de 12 px sous le bouton ; manette/✕ décentrées de 6 px vers le bas.

**Largeur à 390 px (mesurée via driver Chromium, `frontend/capture-nav-state.mjs`, non commité) :**

| | Avant | Après |
|---|---|---|
| Barre `bottom-nav` | **318 px** (x 12→330), chevauchait le bouton manette (x 326→378) de **4 px** | **193 px** (x 69→261, centrée), **65 px** d'écart avec le bouton |
| Image du jeu actif | 52×**64** px, `border-radius: 0`, débordait de 12 px | **48×48** px, entièrement contenue, `btnRadius: 9999px` |
| Constat identique | aux 4 largeurs (320/360/390/430), clair et sombre : nav 193 px partout, aucun chevauchement, aucun débord | |

## 3. Tests, build, audit, images

- **Tests avant** : `yarn test:ci` = 34 suites / **398 tests** (baseline). **Après** : 34 suites /
  **402 tests, 402 passés** — 4 nouveaux tests `nav-1`…`nav-4` dans
  `GameQuickSwitch.test.js:223-296` (grille 2 colonnes + ancre, bouton positionné + image
  `object-cover` + icône centrée, pastille non étirée, libellé/icônes réduits). Aucun test
  préexistant modifié en échec.
- **Build** : `REACT_APP_BACKEND_URL=… yarn build` OK (96,9 s) — le bundle audité/capturé est l'état de la branche.
- **`yarn audit:contrast`** (sortie exacte) : **TOTAL : 0 echecs** — 38 pages × (390 px, 1440 px) ×
  (clair, sombre), **0 page non chargée**, exit **0**, 976,32 s.
  *(Note : un 1ᵉʳ run a signalé 2 pages checkout « NON CHARGEE » à 390 px clair uniquement — pages
  non touchées par ce lot ; phénomène mémoire déjà documenté dans `repports/PL-CHK-2-FIX1.md`
  §Note d'environnement. Le 2ᵉ run, identique par ailleurs, a rendu les mêmes pages à 0 échec.
  Aucun seuil ni exclusion du script modifié.)*
- **Images** : `git diff --name-only origin/main | grep -Ei '\.(png|jpe?g|webp)$'` → **vide**
  (aucune image commitée).

## 4. Commit

- Branche : **`feat/nav-1-compact`** · Commit : **(voir `git log -1` sur la branche)**, message
  `PL-NAV-1-COMPACT: barre du bas compacte centree, grille 2 colonnes, image ronde et icone centree`
  (chemins ajoutés explicitement : `BottomNav.js`, `GameButton.js`, `GameSelector.js`,
  `GameQuickSwitch.test.js`).
- **Confirmé : AUCUN `git push`, AUCUN merge, AUCUN `gh pr create`** — la branche reste locale,
  le propriétaire pousse/fusionne lui-même.

## 5. Captures (hors dépôt, `repports/captures/PL-NAV-1-COMPACT/`)

36 PNG (18 « avant » + 18 « après ») : 4 largeurs (320×640, 360×640, 390×844, 430×844) × clair/sombre ×
(barre seule `ferme-actif`, switcher ouvert `ouvert`, `ferme-sans-jeu` à 390 px). Contrôles visuels
faits : grille 2 colonnes sans débord à 320 px, jeu actif marqué (fond néon + anneau), image du
bouton parfaitement ronde, manette centrée sans jeu actif, pastille compacte centrée, ✕ au-dessus
de la barre, aucun chevauchement.

## 6. Non vérifié

- **Appareil réel** : les mesures/captures viennent d'un Chromium headless (driver local, API
  simulée, aucun appel production). Le rendu sur iPhone/Android réels (safari iOS, safe-area,
  `env(safe-area-inset-bottom)`, clavier virtuel) reste à valider par le propriétaire.
