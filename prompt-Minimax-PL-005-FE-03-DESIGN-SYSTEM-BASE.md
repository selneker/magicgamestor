# PROMPT-ID: PL-005-FE-03-DESIGN-SYSTEM-BASE

## Mission

Tu es Minimax, agent frontend sur magicgame.store (repo `selneker/magicgamestor`). Ce lot pose la **base du
nouveau design** (maquettes PL-DS-003 validées par le propriétaire) : couleurs, typographies, composants
communs, **navigation desktop et mobile**, footer, puis la **page d'accueil**. Les pages « jeu » et
« paiement » viennent dans le lot suivant (PL-005-FE-04) : ne les touche pas ici, sauf ce que la base
change automatiquement (couleurs/polices).

**Prérequis** : PL-005-FE-02 (historique des commandes) doit être fusionné dans `main`. Vérifie avec
`git log origin/main --oneline | grep PL-005-FE-02`. S'il manque, **arrête-toi** et dis-le.

Maquettes (jointes au message du propriétaire, à copier **hors dépôt** dans `repports/maquettes/ds003/`) :
`00-design-system.html`, `01-accueil.html`, `02-page-jeu.html`, `03-checkout.html`, `icons.html`,
`mg-brand.css`, `mg-components.css`, `design-system.css`, `design-system.js`. Ouvre-les dans Chromium.
Les couches `mg-brand.css` (tokens de marque) et `mg-components.css` (composants) sont la **vérité du
design** ; `design-system.css` et `design-system.js` ne sont **que de la référence visuelle** (voir règle 2).

## Règles strictes (non négociables)

1. **Fidélité** : le rendu final suit les maquettes (couleurs, rayons, espacements, typographie, boutons,
   cartes). Aucune invention, aucun embellissement. Chaque écart non demandé est un défaut.
2. **Pas de copie verbatim d'un site tiers.** `design-system.css` est du CSS copié d'un site existant
   (Webflow « Slush ») et `design-system.js` un bundle d'animations tiers. **Ne les ajoute pas au dépôt.**
   Reconstruis dans le CSS du projet uniquement ce qui est utilisé par nos pages, avec nos propres noms de
   classes et variables, en lisant `mg-brand.css` + `mg-components.css` comme source. Aucune classe
   `w-*`, `webflow-*`, aucune police propriétaire. Dis dans le rapport ce que tu as reconstruit.
3. **Pas de copie des transitions de page.** La transition « 3D » des maquettes fait
   `window.location.href = …` : elle **casse le routeur React** et recrée le bug de boucle du bouton retour
   corrigé en FE-02. **Interdit.** Navigation = routeur actuel, rien d'autre.
4. **Animations** : seulement celles à fort effet et bon marché — révélation douce au chargement du hero,
   survol/appui des boutons et cartes, bascule de la nav. Respecte `prefers-reduced-motion` (tout coupé).
   **Pas** de curseur personnalisé, pas de Lenis (défilement lissé), pas de parallaxe, pas de marquee
   animé tant que le lot ne les demande pas. Aucune nouvelle dépendance (GSAP, Lenis, motion…) **sauf
   justification écrite** (taille gzip, licence) et seulement si le CSS seul ne suffit vraiment pas.
5. **Polices** : Onest (texte) et Bricolage Grotesque (titres), **auto-hébergées** (fichiers `.woff2`
   variables dans `public/fonts/`, licence OFL, sous-ensembles latin + latin-ext), `font-display: swap`,
   `preload` de la police de texte uniquement. **Aucun appel à Google Fonts.** Si les fichiers ne sont pas
   dans les maquettes, installe-les depuis le paquet npm officiel `@fontsource-variable/onest` et
   `@fontsource-variable/bricolage-grotesque` (indique-le dans le rapport) — jamais depuis un CDN.
6. **Aucun contenu inventé.** La maquette contient des **faux avis clients** (« Recharge reçue en moins de
   cinq minutes… »), des chiffres et des délais d'exemple. **Ne les porte pas.** Une section sans contenu
   réel est **supprimée**, pas remplie. Les textes de l'accueil actuel du site (vrais prix, vrais délais,
   vrais moyens de paiement, vrai numéro de téléphone) restent la source ; la maquette ne donne que la
   mise en forme.
7. **Aucun changement backend, API, routes, logique de commande, CAPTCHA, `data-testid` existants.** Parité
   i18n FR/EN conservée (aucune chaîne en dur).
8. **Ne touche pas** : l'admin (style carré, hors périmètre), l'historique/détail des commandes de FE-02
   (seules les couleurs/polices des variables partagées peuvent changer — vérifie qu'il reste conforme à sa
   maquette), le checkout (lot suivant).
9. Une branche `feat/design-system-base` depuis `main` à jour, dossier de travail habituel, aucun worktree
   ni clone. **Un seul commit** préfixé `PL-005-FE-03`, `git add` explicite (jamais `git add .`), jamais
   `Issues/`, `PLAN-PL-002-neferbyte-identite.md`, `planning-agent-rules.md`, ni image/capture.
10. **Aucun `git push`, `gh pr create` ni merge.** Le propriétaire le fait.
11. Captures hors dépôt : `repports/captures/PL-005-FE-03/`. Avant de commiter, écris la **liste de tes
    écarts** par rapport aux maquettes (même vide : « aucun écart »).

## Étape 0 — Inventaire (avant de modifier)

Note fichier:ligne : (a) où sont définis aujourd'hui les couleurs/variables globales, le thème clair/sombre
(`--status-*` de FE-01, palette lime `#CBFE01`, etc.) et les polices ; (b) le composant d'en-tête/navigation
desktop et la **navigation mobile** actuels : liste exacte des entrées, routes, états actifs, comportements ;
(c) **le logo principal actuel** (fichier, composant, tailles utilisées) ; (d) **l'indicateur « admin en
ligne »** (ou équivalent : pastille verte, texte « en ligne/online », statut de disponibilité du support) :
tous les endroits où il est rendu **et** l'appel API/websocket/polling qui l'alimente ; (e) la page d'accueil
actuelle et ses sections ; (f) le footer ; (g) comment les barres d'action fixes en bas de page de FE-02 se
comportent avec la nav mobile.

## Spécification

### 1. Tokens et polices
- Reprends les tokens de `mg-brand.css` : encre `#111111`, crème `#F4F1E8`, violet profond `#5c4ade`,
  néon `#D4FF00`, bleu/jaune/vert/orange de la maquette, titres Bricolage Grotesque, texte Onest.
- **Thème sombre conservé** (le site en a un aujourd'hui) : la maquette n'a qu'un thème clair. Construis le
  thème sombre en **inversant encre/crème** avec les mêmes accents, sans inventer d'autres couleurs.
  Thème clair = défaut de la maquette.
- Les variables existantes utilisées par d'autres pages (FE-01/FE-02, admin, etc.) **gardent leur nom** :
  tu changes leur valeur ou tu ajoutes des alias, tu ne renommes rien en masse. Aucun poids de police
  supérieur à 800 ; le texte courant reste ≤ 600.
- Ajoute une page de contrôle interne **non routée en production** n'est pas demandé : ne crée pas de page.

### 2. Logo
- Partout où la maquette met son logo, utilise **notre logo principal actuel** (étape 0-c). Le logo des
  maquettes (carré noir incliné + éclair) est un **espace réservé : ne l'utilise pas**, ne le recopie pas.
- Dans la pastille ronde de la nav, le logo doit rester lisible (contraste AA sur le fond de la pastille,
  clair et sombre). Favicon, `<title>`, balises meta : inchangés.

### 3. Navigation desktop
- Pilule flottante de la maquette (logo rond + boutons colorés Boutique / Événements / Commandes / Support +
  bouton menu). **Mêmes entrées, mêmes routes que la nav actuelle** (étape 0-b) ; n'ajoute ni ne retire
  aucune entrée, ne change aucune destination. Les noms de la maquette ne sont qu'indicatifs : garde les
  libellés i18n existants.
- Navigation au clavier complète, focus visible, `aria-current`, `aria-expanded` sur le menu.

### 4. Navigation mobile (point d'attention du propriétaire)
- **Fonctionnalité inchangée** : mêmes entrées, mêmes routes, mêmes états actifs, mêmes comportements
  (y compris la bascule de jeu si elle existe aujourd'hui ; si elle n'existe pas, **ne l'ajoute pas** — la
  pastille « Bientôt » de la maquette est un exemple).
- **Style** de `.bottom-nav` de la maquette (pilule encre translucide, entrée active en pastille néon),
  mais **plus grand et plus lisible** que la maquette :
  - cible tactile ≥ 48 px de haut par entrée ;
  - icône 24 px ; libellé **≥ 12 px** (la maquette est à ≈10 px, trop petit), jamais coupé, une seule ligne ;
  - `padding-bottom: env(safe-area-inset-bottom)` ; testé à 320, 360, 390 et 430 px ;
  - état actif lisible sans dépendre de la couleur seule (fond + libellé plus marqué).
- Compatibilité avec les barres d'action fixes de FE-02 (détail de commande, paiement) : **aucun
  chevauchement** ; garde le comportement actuel (étape 0-g) et prouve-le par capture.

### 5. Retrait de l'indicateur « admin en ligne »
- **Supprime l'indicateur partout** (étape 0-d) : l'élément, ses styles, ses textes i18n devenus inutiles,
  **et l'appel réseau/polling/websocket qui l'alimente côté frontend** s'il ne sert qu'à ça (ne laisse pas de
  requête en tâche de fond pour rien). **Ne supprime aucune route ni logique backend** : dis dans le rapport
  quel endpoint devient inutilisé, sans le toucher. Le bouton/chemin vers le support reste.
- Aucun texte du type « en ligne / hors ligne / répond en X minutes » ne doit rester affiché.

### 6. Composants communs (depuis `mg-components.css`)
Boutons (principal, secondaire, états survol/appui/désactivé/chargement), cartes, puces, champs de saisie,
accordéon FAQ, pied de page (cartes liens sociaux + téléphone **réels** du site actuel). Un seul jeu de
composants réutilisable, pas de duplication. Rayons et espacements = maquette.

### 7. Page d'accueil
Reproduis `01-accueil.html` avec le **contenu réel** : hero, bandeau d'appel à l'action, « Comment ça marche »,
« Pourquoi nous », choix du jeu, FAQ, footer. **Retire la section avis** tant qu'aucun vrai avis n'est
disponible (règle 6) — dis-le dans le rapport. Mobile d'abord (320/390 px), puis desktop.

## Vérifications

1. `yarn test:ci` et `yarn build` avant/après, comparés **par identifiants**. Échec connu et préexistant :
   `pendingOrder.test.js:20` (ne pas toucher, le mentionner). Aucun nouvel échec. Ajoute des tests : nav
   mobile (mêmes entrées/routes qu'avant, entrée active), absence totale de l'indicateur « en ligne »,
   logo principal rendu (pas l'espace réservé), thème sombre applique les variables inversées.
2. `yarn audit:contrast` : propre, sortie exacte dans le rapport (clair **et** sombre ; le néon sur crème
   est illisible en texte : n'utilise le néon que comme fond avec texte encre).
3. Recherche : `git grep -n -i "slush\|webflow\|osmo"` dans les fichiers ajoutés doit être vide ;
   `git grep -n "window.location.href"` : aucun ajout dans ce lot.
4. Poids : compare la taille du bundle JS/CSS gzip avant/après et rapporte-la (budget : +30 Ko gzip CSS
   maximum, 0 Ko JS ajouté hors justification).
5. Captures **côte à côte maquette / site**, accueil, nav ouverte/fermée, mobile 320 et 390, desktop 1440,
   clair et sombre, dans `repports/captures/PL-005-FE-03/`. Avant de commiter :
   `git diff --name-only origin/main | grep -Ei '\.(png|jpe?g|webp)$'` ne doit rien afficher (les `.woff2`
   sont permis).
6. Rejoue manuellement : aller sur l'accueil → boutique → retour navigateur ×3 : **aucune boucle**.

## Rapport attendu

1. Inventaire (fichier:ligne), dont **où était l'indicateur « admin en ligne »** et ce qui l'alimentait.
2. Fichier:ligne de chaque point de la spécification (1 à 7) avec la valeur appliquée.
3. Ce que tu as reconstruit à la place du CSS/JS tiers ; polices et provenance ; dépendances ajoutées (ou
   « aucune »).
4. Sections de l'accueil supprimées (avis…) et pourquoi.
5. Liste des écarts par rapport aux maquettes (ou « aucun écart »).
6. Tests avant/après, `audit:contrast`, poids, résultat des commandes de recherche.
7. Hash du commit et branche, **sans push** (confirme-le).
8. Ce qui n'a pas pu être vérifié (appareil réel, Safari iOS).
