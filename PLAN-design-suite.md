# Plan — suite de corrections design (prototype servi)

Statut : **exécuté le 2026-11-25 — tous les lots 0, A, B, C, D et F appliqués et vérifiés** (`✓` ci-dessous). Le document reste la référence du périmètre ; les versions initiales avaient des qualifications WCAG erronées, rectifiées ici. Deux points restent ouverts et nécessitent l'arbitrage du propriétaire (exception « inline » du fil, `role="button"` sur les liens) ; un troisième est une proposition de couleur non appliquée (anneau de focus).

## Résultats d'exécution (2026-11-25)

| Lot | État | Preuve |
|---|---|---|
| 0 — contraste | ✓ | `CHROMIUM_PATH=… yarn audit:contrast` a terminé sans crash (~32 min) : **371 échecs**, dont **323** faux positifs connus (texte blanc sur `.button-main`, fond peint par `.button-main-inner__bg`), **20** `.nav-avatar-d` blanc sur blanc, **20** badge `.mgs-status--progress` à **2,65:1**, **8** `.h-s sm-p-s` noir sur noir. Aucune couleur modifiée à l'aveugle. |
| A — cibles | ✓ | 4 fils `.mgs-crumb a` ont `::after` 44×44 ; `elementFromPoint` à ±20 px du centre valide sur `Accueil` à 320/390/1440. `FR`/`Clair` gardent leur rendu visible (43×31 à 320, 52×34 / 67×34 à 1440) avec une zone 44×44 et un écart de **7 px à 320**, **13 px à 1440** (pas de chevauchement). |
| B — champs | ✓ | `getComputedStyle(input).fontSize` = **16 px à 390 px**, **15,2 px à 1440 px** (desktop inchangé). |
| C — focus | ✓ (avec point ouvert) | `.mgs-input:focus-visible` produit l'anneau `rgb(255,215,49) 0 0 0 3,2px` au focus clavier. Mesure du couple : `#ffd731` sur blanc = **1,40:1** (échec 1.4.11, seuil 3:1), sur noir = **15,02:1**. Aucune couleur appliquée : proposition d'un token existant `--color--purple-800` (**6,02:1** sur blanc) ou `--color--orange-800` (**3,47:1**) à arbitrer. |
| D — paiement | ✓ | Sur `data-co=2`, `Retour`/`Annuler` gardent leurs noms ; popup d'annulation : `aria-modal="true"`, focus déplacé sur la première raison, `.main-w` `inert`, Échap ferme et rend le focus au déclencheur (mesuré dans Chromium). `data-co=3` ne contient pas ces boutons. |
| F — mouvement | ✓ | Sous `prefers-reduced-motion: reduce`, `.mgs-page.is--active` calcule `animation-name: none`, `opacity: 1`, contenu visible (hauteur 4 049 px). |
| Garde-fou | ✓ | `frontend/src/index-html.test.js` verrouille les six marqueurs des correctifs ; `yarn build` + `yarn test:ci` verts (45 suites / 535 tests). |

## Périmètre, sources et seuils

- **Artefact servi et suivi** : `frontend/public/index.html` (CSS inline, React neutralisé). CRA le copie verbatim dans `build/index.html` ; `design-system-v3.html` à la racine est la référence de design **non suivie** (`.gitignore:112`). Toute correction s'applique à l'artefact suivi ; ne pas éditer la référence ni `src/**`.
- Arbre poussé sur `main` au `600e7ac` avant ce plan.
- **Seuils à ne pas confondre** : WCAG 2.5.8 AA = **24×24 px CSS** (avec exceptions, dont « inline » et espacement). **44×44 px est une règle maison** (`AGENTS.md` §8, issue d'iOS HIG / Material), plus stricte que la WCAG. Ne jamais présenter la règle maison comme une obligation WCAG.
- Mesures relevées dans un vrai Chromium (`scripts/proto-functional.mjs`, 390×844 et 1440×900, page rechargée avec `?v=<timestamp>`), complétées par relecture du HTML servi.

| Surface | Mesure observée | Qualification corrigée | Source |
|---|---|---|---|
| Boutique / commande, 390 px | fil `Accueil` : **60×20 px** | 20 px < plancher AA 24 ; **exception « inline » à trancher**, pas un échec AA affirmé. Échec certain de la règle maison 44 | `AUDIT cibles tactiles`, `index.html:808,2453` |
| Compte, 1440 px | `FR` **52×34**, `Clair` **67×34** | **AA respecté** (≥24) ; échec **règle maison 44 uniquement** | `AUDIT cibles tactiles` |
| Compte, 390 et 1440 px | 5 champs `.mgs-input` à **15,2 px** | Risque zoom iOS (<16 px), pas un critère WCAG direct | `index.html:799` (`.95em`) |
| Toutes pages | `:focus-visible` : 11 occurrences ; `outline:none` : 2 | Les 11 occurrences sont **toutes** dans des sélecteurs `.button-main` (`:361-413`, `:1318`) : un composant, pas une couverture. Anneau jaune détourné sur `.mgs-input:focus` (`:800`) | `grep` + lecture |
| Toutes pages | `prefers-reduced-motion` : 13 occurrences | **8 règles CSS + 5 références JS**, dont 4 configs GSAP `MM.add({reduceMotion…})` (`:3155,3332,3348,3365`). Ne pas dire « 13 gardes » | `grep` + lecture |
| Paiement | navigation masquée sur `data-co=2/3` (`:1258-1259`), conservée sur `data-co=1` | Exact. `Retour` (`:2821`, avec `aria-label`) et `Annuler la commande` (`:2834`) existent dans `data-co=2` ; `data-co=3` (`:2836-2843`) ne contient que `Voir ma commande` (`:2842`) | commit `ca4c346`, E2E 22/22 |
| Annulation | popup `role="dialog"` sans `aria-modal` (`:3698`) ; `openCancel()` (`:4748-4762`) ne déplace pas le focus et ne rend pas le fond `inert` ; `closeCancel()` (`:4763`) ne restaure pas le focus | Échec clavier réel, absent du plan initial | lecture du HTML |
| Fils d'Ariane | `.mgs-crumb a` (`:808`) sert 4 fils (`:2453,2471,2595,2639`) ; deux portent `role="button"` sur un `<a href>` (`:2471,2639`, aussi `:2802` au `Retour` de `data-co=1`) | Le plan initial ne visait qu'un lien sur deux pages : symptôme au lieu de classe | lecture du HTML |
| Contraste | `yarn audit:contrast` après fusion sur `main` : `page.evaluate: Target page, context or browser has been closed` (`/tmp/mgs-audit-main.log`) | Le « crash » était le SIGTERM d'un timeout à 600 s. Relancé sans limite courte, l'audit **termine** : 371 échecs (voir résultats). Token `--color--yellow-700:#ffd731` existe (`:14`) ; anneau mesuré à 1,40:1 sur blanc | log + `grep` + mesure |

## Règle commune à chaque lot

1. Éditer `frontend/public/index.html` uniquement ; ne pas toucher à `src/**` (hors garde-fou de test du point 3), à `design-system-v3.html`, au backend, paiement ou appels API.
2. `yarn build` (avec `REACT_APP_BACKEND_URL` exporté), servir `build/index.html`, puis **re-naviguer avec `?v=<timestamp>`** et re-mesurer dans le même appel navigateur (les pages se réinitialisent seules).
3. Ajouter un garde-fou dans `frontend/src/index-html.test.js` pour verrouiller le plancher mesuré, afin qu'un correctif ne se perde pas à la prochaine copie.
4. Un commit par lot, format `fix(proto): …` ; aucun lot appliqué sans l'accord du propriétaire.

## Lots proposés — ordre corrigé

### [x] Lot 0 (ex-É) — Préalable bloquant : audit de contraste

1. Relancer `yarn build` puis `CHROMIUM_PATH=… yarn audit:contrast` sur `main` dans un environnement où le navigateur reste ouvert. Le log actuel est un crash : **statut NON VÉRIFIÉ**, pas un résultat d'audit.
2. Ne rien corriger à l'aveugle : toute modification de couleur part d'un couple mesuré et d'un token existant. Ne pas assouplir le script pour atteindre zéro. Si le harnais remonte un couple 1:1 sur `.button-main`, vérifier d'abord le faux positif connu du fond peint par un calque enfant (`.button-main-inner__bg`) ; une exclusion éventuelle doit être ajoutée en tête du script **avec sa raison**.
3. Règle permanente : refaire l'audit après chaque fusion vers `main` (`AGENTS.md` §12).
4. Contrôle : l'audit termine sans crash et produit des couples mesurés.

### [x] Lot A — Cibles tactiles (règle maison 44 px ; AA à trancher pour le fil)

1. Cible réelle : `.mgs-crumb a` (`:808`), **4 occurrences** (`:2453,2471,2595,2639`), pas seulement `Accueil`. Étendre la zone cliquable à 44×44 px **par pseudo-élément positionné en absolu**, pas par `padding` sur un `<a>` inline (qui décale le flux et contourne la règle « ne rien déplacer »). Ne pas changer l'apparence ni la position du lien.
2. `FR` et `Clair` (compte, 1440 px) : hauteur minimale 44 px en conservant le rendu visible ; vérifier le non-chevauchement à 320 px et 390 px.
3. Qualifier le fil : 20 px est sous le plancher AA de 24 px, mais l'exception « inline » peut s'appliquer — demander l'arbitrage avant d'écrire « échec WCAG ». Le correctif reste justifié par la règle maison.
4. Contrôle : rejouer l'`AUDIT cibles tactiles` à 320, 390 et 1440 px ; aucune cible visible < 44×44 px ; garde-fou ajouté à `index-html.test.js`.

### [x] Lot B — Champs de saisie (iOS, pas WCAG)

1. `.mgs-input` à `font-size:16px` sur mobile uniquement (`@media max-width:767px`), sans modifier le style desktop (`:799`).
2. Contrôle : `getComputedStyle(input).fontSize === "16px"` à 390 px ; aucune cassure de layout sur le compte.

### [x] Lot C — Focus clavier

1. Remplacer `.mgs-input:focus{outline:none;box-shadow…}` (`:800`) par un `:focus-visible` avec le même anneau. Conserver `outline:none` pour le focus souris : restaurer l'outline natif serait un changement visible. **Ne pas raisonner en nombre d'occurrences** : parcourir chaque contrôle interactif et vérifier un indicateur visible au focus clavier.
2. Mesurer l'anneau `--color--yellow-700` (`#ffd731`, `:14`) contre le fond crème et le fond encre, objectif **3:1 (1.4.11)**. Si le couple échoue, **proposer** une valeur de token existante — ne pas appliquer sans accord. Aucun ratio chiffré sans mesure réelle.
3. Contrôle : parcours Tab complet boutique → commande → paiement, indicateur visible à chaque arrêt, aucun arrêt masqué par une barre fixe.

### [x] Lot D — Tunnel de paiement et annulation (HIGH si confirmé)

1. Vérifier au clavier que `Retour` (`:2821`) et `Annuler la commande` (`:2834`) restent accessibles sur `data-co=2` quand la navigation est masquée. Si l'un manque de nom accessible ou de portée, corriger **uniquement** ce point ; ne pas réafficher la navigation.
2. Retirer `data-co=3` du libellé du contrôle : les deux boutons n'y existent pas (`:2836-2843`). Vérifier plutôt `Voir ma commande` (`:2842`).
3. Vrai point à corriger : `openCancel()` (`:4748-4762`) doit déplacer le focus dans la popup, poser `inert` sur le fond, et la popup doit porter `role="dialog"` + `aria-modal="true"` (`:3698`) ; `closeCancel()` (`:4763`) doit rendre le focus au déclencheur, et Échap doit fermer.
4. Contrôle : E2E clavier sur `data-co=2` et la popup d'annulation, à 390 px et 1440 px.

### [x] Lot F — Mouvement (LOW)

1. Confirmer que `mgsPageIn` est couvert (`:599`, `.mgs-page.is--active{animation:none}`) et que les transitions de popup le sont (`:1214`, `:1261`). Ne pas retirer d'animation demandée par le propriétaire. Ne pas compter les 13 occurrences comme des gardes.
2. Contrôle : capturer les pages avec `prefers-reduced-motion: reduce` et vérifier que le contenu reste visible.

## Point de sémantique à arbitrer (hors lots)

`<a href … role="button">` sur les fils d'Ariane et le `Retour` de `data-co=1` (`:2471,2639,2802`) écrase la sémantique de lien (Cmd/Ctrl/clic milieu, annonce lecteur d'écran). Le correctif est de retirer l'ARIA, pas de réécrire l'élément — mais c'est une décision du propriétaire, pas un correctif automatique.

## Hors périmètre

- Aucun changement de position, d'ordre ou de style non nommé ci-dessus.
- Aucune nouvelle couleur, police, ombre ou animation ; aucun assouplissement de l'audit de contraste.
- Aucune modification de `src/**`, du backend, des paiements ou des appels API.
- Les fichiers non suivis préexistants (`frontend/scripts/proto-z3b-dev.mjs`, `orchestration(portage).md`, `untitled.md`) ne sont pas inclus.

## Décision attendue du propriétaire — après exécution

Les six lots ont été appliqués et vérifiés ; il ne reste **aucune décision sur l'ordre ni sur l'application des lots**. Restent trois arbitrages :

1. **Anneau de focus (lot C)** : mesuré à 1,40:1 sur fond blanc, donc sous le seuil 1.4.11 de 3:1. Je n'ai pas changé la couleur. Si le propriétaire veut un anneau conforme, le token existant `--color--purple-800` donne 6,02:1 (ou `--color--orange-800`, 3,47:1) — à valider avant application.
2. **Fil d'Ariane** : 20 px de haut, sous le plancher AA de 24 px, mais l'exception « inline » peut s'appliquer. À trancher pour qualifier ou non d'échec WCAG ; le correctif 44 px reste appliqué au titre de la règle maison.
3. **`<a href … role="button">`** sur `:2471,2639,2802` : retirer l'ARIA redonnerait la sémantique de lien native. Non modifié, car c'est une décision du propriétaire.

Rappel opérationnel : l'audit de contraste doit être relancé après chaque fusion vers `main` (règle permanente §12). Ses 371 échecs, dont 323 faux positifs documentés, ne sont pas réglés par ce plan : toute correction de couleur doit partir d'un couple mesuré.
