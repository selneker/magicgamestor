# Plan — suite de corrections design (prototype servi)

Statut : plan uniquement. Aucune correction de ce document n'est encore appliquée.

## Périmètre et preuves

- Artefact servi : `frontend/public/index.html` (CSS inline, React neutralisé). Le React de `src/**` n'est pas servi.
- Arbre poussé sur `main` au `600e7ac` avant ce plan.
- Mesures relevées dans un vrai Chromium (harnais `scripts/proto-functional.mjs`, viewports 390×844 et 1440×900, page rechargée avec `?v=<timestamp>`) :

| Surface | Mesure observée | Source |
|---|---|---|
| Boutique / commande, 390 px | lien fil d'Ariane `Accueil` : **60×20 px** (cible < 44 px) | AUDIT cibles tactiles |
| Compte, 1440 px | boutons `FR` **52×34 px** et `Clair` **67×34 px** (cible < 44 px) | AUDIT cibles tactiles |
| Compte, 390 px et 1440 px | 5 champs `.mgs-input` à **15,2 px** (risque de zoom iOS sous 16 px) | AUDIT cibles tactiles |
| Toutes pages | `:focus-visible` : 11 occurrences ; `prefers-reduced-motion` : 13 ; `outline:none` : 2 (dont `.mgs-input:focus` avec anneau `box-shadow` jaune) | `grep` sur `index.html` |
| Paiement | la navigation est masquée sur `data-co=2/3` ; le formulaire `data-co=1` la garde | commit `ca4c346`, E2E 22/22 |
| Contraste | `yarn audit:contrast` après fusion sur `main` : **non concluant** (`page.evaluate: Target page, context or browser has been closed`, puis timeout 600 s) | `/tmp/mgs-audit-main.log` |

## Lots proposés (ordre recommandé)

### Lot A — Cibles tactiles (HIGH, WCAG 2.5.8)

1. Étendre la zone cliquable du fil d'Ariane `Accueil` à 44×44 px sans changer son apparence (padding transparent ou pseudo-élément), sur boutique et commande. Ne pas déplacer le lien.
2. Porter les boutons `FR` et `Clair` du compte à une hauteur minimale de 44 px en gardant le même rendu visible (padding transparent). Vérifier qu'ils ne se chevauchent pas à 320 px.
3. Contrôle : rejouer l'AUDIT cibles tactiles à 390 px, 320 px et 1440 px ; aucune cible visible < 44×44 px.

### Lot B — Champs de saisie (MEDIUM, iOS)

1. Passer `.mgs-input` à `font-size:16px` sur mobile uniquement (`@media max-width:767px`), sans modifier le style desktop.
2. Contrôle : `getComputedStyle(input).fontSize === "16px"` à 390 px ; aucune cassure de layout sur le compte.

### Lot C — Focus clavier (MEDIUM)

1. Remplacer `.mgs-input:focus{outline:none;...}` par `:focus-visible` avec le même anneau jaune, en gardant le focus natif pour la souris si le design le permet.
2. Mesurer l'anneau jaune (`--color--yellow-700`) contre le fond crème et le fond encre : objectif 3:1 (1.4.11). Si le couple échoue, proposer un valeur de token existante — aucune nouvelle couleur.
3. Contrôle : parcours Tab complet sur boutique → commande → paiement, avec indicateur visible à chaque arrêt.

### Lot D — Paiement sans issue (HIGH si confirmé)

1. Vérifier au clavier que `Retour` et `Annuler la commande` restent accessibles quand `.nav-w`, `.footer` et `.bottom-nav-w` sont masqués (`data-co=2/3`).
2. Si l'un des deux est hors portée ou sans nom accessible, corriger **uniquement** ce point ; ne pas réafficher la navigation.
3. Contrôle : E2E clavier sur les deux écrans de paiement, à 390 px et 1440 px.

### Lot E — Contraste (à rejouer avant tout déploiement)

1. Relancer `yarn build` puis `CHROMIUM_PATH=… yarn audit:contrast` sur `main` dans un environnement où le navigateur reste ouvert (l'échec observé ici est un crash du harnais, pas un résultat d'audit).
2. Ne rien corriger à l'aveugle : toute modification de couleur doit partir d'un échec mesuré et d'un token existant.
3. Règle permanente : refaire l'audit après chaque fusion vers `main`.

### Lot F — Mouvement (LOW)

1. Confirmer que les 13 guards `prefers-reduced-motion` couvrent l'animation d'entrée `mgsPageIn` et les transitions de popin ; ne retirer aucune animation demandée par le propriétaire.
2. Contrôle : capturer les pages avec `prefers-reduced-motion: reduce` et vérifier que le contenu reste visible.

## Hors périmètre

- Aucun changement de position, d'ordre ou de style non nommé ci-dessus.
- Aucune nouvelle couleur, police, ombre ou animation.
- Aucune modification du backend, des paiements ou des appels API.
- Les fichiers non suivis préexistants (`frontend/scripts/proto-z3b-dev.mjs`, `orchestration(portage).md`, `untitled.md`) ne sont pas inclus.

## Décision attendue du propriétaire

Valider l'ordre des lots. Le lot A concerne des cibles tactiles mesurées sous le seuil et peut être appliqué seul sans arbitrage visuel ; les lots B à F nécessitent l'accord pour toucher respectivement au style des champs, au focus, au tunnel de paiement, aux couleurs et aux animations.
