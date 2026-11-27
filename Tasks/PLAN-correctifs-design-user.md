# Plan — correctifs UX/design, partie utilisateur

Statut : **PLAN — en attente de validation du propriétaire. Aucun fichier applicatif n'a été modifié dans cette étape.**
Date : 2026-11-26 · Sources : feedback annotations 1 → 11 sur `/`, `/boutique`, `/commandes`, `/support` et tunnel de paiement.

---

## 1. Problematique

Le prototype sert une interface correctement dessinée mais qui **explique trop et oriente mal** : des CTA redondants, des pastilles « Boutique / Catalogue » et des phrases d'aide répétées en haut de page, des états vides rédigés pour un administrateur (« configurez-le dans l'administration ») et un avatar dont l'action n'est pas comprise. Deux défauts sont plus structurants :

1. **Texte coupé** : les titres `.h-l` de la grille d'accueil utilisent l'échelle display globale (`6.5em`, puis `3.8em` / `2.6em` en mobile — `frontend/public/index.html:1036,1040-1041`) sans contrainte de largeur dans `.two-col-grid__text` en mobile (`:516`). Les mots sont tronqués à 390 px, pas seulement « espacés ».
2. **Simulation visible** : quatre cartes de jeux figées dans le HTML (`:2482-2490`) restent affichées quand `GET /games` ne répond pas ou renvoie une liste vide, car `renderGames()` sort early (`:3896`). Le visiteur voit donc des jeux, descriptions et icônes inventés à la place des jeux réels activés par l'admin. Le même réflexe se voit dans l'image : le gabarit porte une icône SVG générique (`:2483,2485,2487,2489`) que le JS ne remplace que si `image_url` / `icon_url` existe (`:3910-3914`).

Les autres annotations sont des redondances de chrome (footer sur toutes les pages, navigation complète pendant le paiement) et des messages qui fuient le vocabulaire interne au lieu de rester neutres pour l'utilisateur.

---

## 2. Perimètre et artefact serve

- **Artefact à modifier : `frontend/public/index.html` uniquement** (CSS inline, React neutralisé). CRA le copie verbatim dans `build/index.html`.
- `design-system-v3.html` (racine) est la référence de design non suivie ; `frontend/public/mgs-v3.css` existe mais **n'est pas chargé** par la page servie (vérifié : aucune référence à `mgs-v3.css` dans le HTML) : ne pas les éditer.
- Aucune modification de `src/**` (sauf garde-fou de test si un lot le nécessite), du backend, des appels API, du paiement ni de la logique métier.
- Aucune retouche de style hors des sélecteurs nommés dans le feedback. Les couleurs, radius, ombres, polices et animations restent ceux de la feuille existante ; aucun nouveau token ni valeur hexadécimale.
- Les textes visibles restent dans le dictionnaire `t()` du prototype (`:3770` FR, `:3773` EN) quand le message change ; les deux langues sont mises à jour ensemble.
- Arbre de départ : `main` au `44d6479`, avec un `PORTAGE.md` supprimé et quatre fichiers non suivis préexistants (`PLAN-admin-slush.md`, `frontend/scripts/proto-z3b-dev.mjs`, `orchestration(portage).md`, `untitled.md`). Ils ne font pas partie de ce plan ; ne pas les écraser ni les inclure dans un commit.

---

## 3. Grilles methodologiques utilisees

| Grille | Ce qu'elle apporte à ce plan |
|---|---|
| **design-system-alignment** | Audit avant édition, preuves `fichier:ligne`, lots isolés, un commit par lot, artefact servi identifié, aucun « ajustement » non demandé, cache-busting `?v=<ts>` avant mesure. |
| **claude-design** | Surface d'abord : accueil = *Decide/Learn*, boutique = *Explore*, support/commandes/paiement = *Configure/Operate*. Pas de hero ni de grille de trois cartes ajoutés ; pas de contenu inventé, pas de faux chiffres. |
| **better-interface** | Une seule table de constats rangés par impact, preuves plutôt que goût, `HIGH` si le texte est coupé ou si l'information induit en erreur (avatar, état vide administrateur), `LOW` pour la simple redondance. |
| **better-layout** | Mesure des colonnes et des espacements à 320/390/768/992/1200/1440 px, `minmax(0,1fr)` / `min-width:0` si un libellé déborde, pas de `width:100vw`, croissance du texte traduit, `scrollWidth <= clientWidth` sur chaque libellé. |

---

## 4. Matrice de preuves (avant toute édition)

| Ref. feedback | Symptôme | Preuve dans l'artefact servi | Impact | Lot |
|---|---|---|---|---|
| 1.1 | CTA « Choisir un jeu » redondant avec « Voir la boutique », même `href="#jeux"` | `:2358` et `:2359` | MEDIUM | A |
| 1.2 | Avatar « SE » = initiales, pas l'image du compte ; l'action « compte » n'est pas évidente | `:2335`, `:4967-4975`, `:5038-5047` | MEDIUM | A |
| 2.1 | `Commencez ici : vos jeux` coupé ; supprimer « vos jeux » | `:2368`, échelle `:1036,1040-1041`, largeur `:516` | HIGH | A |
| 2.2 | Paragraphe trop grand | `:2369`, `.h-s` dans la feuille de base `:14` | MEDIUM | A |
| 2.3 | `Suivez votre commande` coupé | `:2377` | HIGH | A |
| 2.4 | Paragraphe trop grand | `:2378` | MEDIUM | A |
| 2.5 | `Découvrez les offres Prime` coupé | `:2383` | HIGH | A |
| 2.6 | `Rechargez & jouez instantanément` coupé | `:2391` | HIGH | A |
| 3.1 | Cartes de jeux simulées : 4 cartes figées, conservées si l'API est vide | `:2482-2490`, `:3880`, `:3892-3896` | HIGH | B |
| 3.2 | Images générées → doit venir de `image_url` admin | `:2483,2485,2487,2489`, `:3910-3914` | HIGH | B |
| 4.1 / 4.2 | Pastille « Boutique » redondante | `:2481` | LOW | B |
| 5.1 | Pastille « Catalogue » redondante | `:2495` | LOW | B |
| 5.2 | Message d'état vide « configurez-le dans l'administration » + bordure tiret | `:815-816`, clé `catalog.emptyGame` `:3770`/`:3773`, usages `:4078,4083,4469` | MEDIUM | D |
| 6.1 | Phrase « Prix en ariary… Compte joueur vérifié… » à retirer | `:2495` | LOW | B |
| 6.2 | Phrase « Sélectionnez un jeu… » à retirer | `:2481` | LOW | B |
| 7 | Cartes : plus d'espacement desktop, 2 colonnes mobile | `:851-869` (actuel `gap:.75em`, `1fr` sous 479 px) | MEDIUM | C |
| 8 | État vide commandes : bordure tiret, message trop prescriptif et trop visible | `:2654`, `:815-816` | MEDIUM | D |
| 9.1 | Bloc « Chat en direct » à retirer de toutes les tailles | `:2815` (panneau `.mgs-panel--green`) | MEDIUM | E |
| 9.2 | WhatsApp + Email à déplacer sous « Envoyer un message » | `:2815` (panneaux et formulaire sur la même ligne) | MEDIUM | E |
| 10 | Footer visible sur toutes les pages | `:999` (masqué seulement sur `connexion` et `commande`) | MEDIUM | F |
| 11 | Navigation complète pendant le paiement/upload | `:1283-1286` (`.nav-w` entier masqué) | MEDIUM | F |

Rappel : `:999` et `:1285-1286` utilisent `:has()` / `body[data-page]` ; `showPage()` pose `body.dataset.page` en `:3537`. Toute règle de chrome doit être vérifiée à 390 px et 1440 px, pas seulement lue dans la feuille.

---

## 5. Validation du plan (criteres d'acceptation avant de coder)

Le plan estconsideré validé seulement si :

1. **Perimètre accepté** : 11 annotations couvertes par 6 lots, aucun fichier hors `frontend/public/index.html` (hors garde-fou de test éventuel) modifié.
2. **Mesures avant/après** : pour chaque lot, relever dans un vrai Chromium (390×844 et 1440×900, page rechargée avec `?v=<timestamp>`) les rects et `getComputedStyle` des noeuds cités. Une capture seule ne prouve ni le centrage ni l'absence de coupure.
3. **Texte** : `scrollWidth <= clientWidth` et `rect.right <= innerWidth` pour les 4 titres et les 4 paragraphes ; `documentElement.scrollWidth === innerWidth` sur chaque page testée.
4. **Données** : avec `GET /games` mocké (jeux actifs, `image_url` fournie), seuls les jeux de l'API sont affichés, avec leur nom, leur description et leur image ; avec une liste vide, aucune carte de démo ne subsiste.
5. **Chrome** : `getComputedStyle(footer).display === "none"` sur toutes les pages sauf `accueil` ; sur `data-co=2` et `data-co=3`, `.is--nav-logo` reste visible et cliquable tandis que `.nav-inner-right`, `.bottom-nav-w` et `.footer` sont masqués.
6. **Non-régression** : `yarn build` + `yarn test:ci` verts ; le harnais E2E du prototype reste vert hors échecs préexistants documentés ; aucun nouveau couple de contraste mesuré par `yarn audit:contrast` par rapport au baseline connu (371 échecs, dont 323 faux positifs documentés dans `PLAN-design-suite.md`).
7. **Décisions ouvertes tranchées** (§8) avant d'exécuter les lots qui en dépendent. Les lots non concernés peuvent démarrer sans attendre.

### Commandes de verification (à exécuter lot par lot, puis en global)

```bash
cd frontend
export REACT_APP_BACKEND_URL=https://api.magicgame.store   # obligatoire avant build
yarn build
yarn test:ci
node scripts/proto-logic.test.mjs
node scripts/proto-functional.mjs      # harnais E2E prototype, API mockée
# après fusion sur main seulement :
CHROMIUM_PATH=~/.hermes/tools/chromium-1248/chrome-linux64/chrome yarn audit:contrast
```

Mesure navigateur : une seule session par lot, re-navigation avec `?v=<timestamp>` après chaque édition (le HTML est mis en cache et les pages se réinitialisent seules). Ne pas mesurer un état forcé qui sera réécrit par l'observateur de session.

---

## 6. Lots d'action (un lot = un commit = une verification)

### [x] Lot A — Accueil : CTA redondant, avatar, titres et paragraphes

1. Supprimer l'ancre `data-cursor="choisir un jeu"` (`:2359`) ; garder « Voir la boutique » (`:2358`) et « Suivre une commande » (`:2360`) sans déplacer les autres éléments.
2. Remplacer le texte `:2368` par « Commencez ici » (suppression de « vos jeux » et du « : » pendant — voir point ouvert P1).
3. Réduire la taille des 4 titres (`:2368,2377,2383,2391`) et des 4 paragraphes (`:2369,2378,2384,2392`) **uniquement dans `.two-col-grid__text`**, en réutilisant des valeurs déjà présentes dans la feuille (échelle `.h-l` / `.h-m` / `.h-s` de `:1036-1041` et variantes existantes) — aucune nouvelle valeur.
4. Avatar : découpler l'affichage de `syncAuthChrome()` (`:4958-4975`) de `loyaltyOk` ; utiliser `avatarSrc()` / `paintAvatar()` (`:5038-5047`) dès que `me` existe, avec repli sur les initiales si l'image échoue. Google `picture`Only si le champ est exposé par `/auth/me` (point ouvert P2). Conserver `aria-label="Compte"` et le `data-nav="compte"`.
5. Contrôle : 2 CTA dans `.button-row` ; 4 titres sans coupure à 320/390/1440 ; avatar visible avec `me` même si l'appel points échoue (mock 401/500), initiales seulement en repli image ; `yarn build` + `yarn test:ci`.

### [x] Lot B — Boutique : jeux réels, images admin, en-têtes épurés

1. Supprimer les 4 cartes figées `:2482-2490` et faire dépendre le rendu de `renderGames()` (`:3892-3935`) : aucune carte tant que `GET /games` n'a pas fourni de jeu actif. État vide = message simple, sans simulation (décision P3 pour le cas « API en échec »).
2. Image : ne garder que `g.image_url || g.icon_url` (`:3910-3914`). Si le champ est absent, ne pas afficher d'icône inventée ; le fond coloré existant reste le seul container. Ne pas créer de nouvelle URL.
3. Retirer `<p class="eyebrow">Boutique</p>` et le `<p class="mgs-sub">Sélectionnez un jeu…</p>` de `:2481` ; retirer `<p class="eyebrow">Catalogue</p>` et le `<p class="mgs-sub">Prix en ariary…</p>` de `:2495`. Conserver les `<h1>`.
4. Contrôle : avec un mock `/games` contenant 2 jeux, exactement 2 cartes dont le nom, la description et l'image viennent du mock ; avec une liste vide, 0 carte ; plus aucun des 4 textes supprimés dans le DOM ; pas de débordement des titres.

### [x] Lot C — Boutique : grille des cartes de jeu

1. Desktop : augmenter l'espacement de `.mgs-boutique-games .mgs-grid--2` (`:851`) avec un pas d'espacement déjà utilisé dans la feuille ; ne pas changer la largeur des cartes ni leur ordre.
2. Mobile : faire tomber la grille à **2 colonnes** dès la-largeur mobile et supprimer la règle `1fr` de `:869` (actuellement 1 colonne sous 479 px). Vérifier `grid-template-columns` calculé à 320, 390, 479, 480, 767, 768, 991, 992, 1199, 1200, 1440.
3. Contrôle : aucun libellé `.mgs-game__name` / `.mgs-game__desc` avec `scrollWidth > clientWidth` ; pas de scroll horizontal ; l'aspect desktop existant (`:865`) reste inchangé sauf le gap.

### [x] Lot D — Etats vides (catalogue + commandes)

1. Remplacer la valeur FR et la valeur EN de `catalog.emptyGame` (`:3770`, `:3773`) par un message court et neutre, sans mention d'administration. Garder la clé, l'icône Lucide déjà présente et `t()`.
2. Style de `.mgs-empty` : retirer le `border:.125em dashed …` (`:815`) **uniquement pour les états vides ciblés** (`.mgs-empty` du catalogue et `.mgs-cmd-empty` `:2654`), centre horizontal et vertical, taille réduite, pas de nouveau token de couleur.
3. Contrôle : `borderStyle === "none"` mesuré ; boîte centrée dans son container ; icône visible ; texte court identique FR/EN ; garde-fou dans `src/index-html.test.js` seulement si nécessaire.

### [x] Lot E — Support : retrait du chat, contacts en bas du formulaire

1. Retirer l'ancre `.mgs-panel--green` « Chat en direct » de `:2815` sur toutes les largeurs (pas de `display:none` responsif : suppression du noeud et de son JS s'il existe un renderer associé). Adapter la grille 3 colonnes de cette ligne à 2 colonnes pour que les deux panneaux restent alignés.
2. Déplacer WhatsApp et Email sous le bloc « Envoyer un message » (même ligne `:2815`) ; remplacer « (numéro à confirmer) » par **+261 37 751 9833** fourni dans le feedback (P4) et garder `support@magicgame.store`. Utiliser des liens `tel:` / `mailto:` si le gabarit le permet sans nouvelle couleur.
3. Contrôle : `.mgs-panel--green` absent du DOM sur `/support` à 320/390/768/1440 ; les deux coordonnées sont dans le bloc formulaire et n'apparaissent plus en haut ; aucun `href="#"` restant sur ces deux contacts.

### [x] Lot F — Chrome global : footer et paiement

1. Footer : remplacer la règle `:999` par une règle unique du type `body:not([data-page="accueil"]) .footer{display:none!important}` — conserver les masquages `connexion` / `commande` existants, sans toucher au `main`, à la nav sauf précision ci-dessous, ni au bottom-nav hors tunnel.
2. Paiement : dans `:1283-1286`, ne plus masquer `.nav-w` entier ; masquer uniquement la partie fonctionnelle de la nav (`.nav-inner-right`), en laissant `.is--nav-logo` (`:2322`) visible et cliquable. `.footer` et `.bottom-nav-w` restent masqués sur `data-co=2` et `data-co=3`.
3. Contrôle : sur `accueil` le footer est visible ; sur `boutique`, `commandes`, `support`, `produit`, `profil`, `connexion`, `admin`, le footer a `display:none` ; sur `data-co=2` et `data-co=3`, le logo a un rect non nul et répond à un clic, tandis que les liens de nav et le bottom-nav ont `display:none`. `data-co=1` reste inchangé.

---

## 7. Hors périmètre

- Aucun changement d'ordre, de position ou de style non nommé dans le feedback.
- Aucune nouvelle couleur, police, ombre, animation, icône ou composant.
- Aucune modification de la logique de paiement, des endpoints, du backend ou des clés/tokens.
- Aucune modification de `design-system-v3.html` ni de `frontend/public/mgs-v3.css` (non chargé).
- Les lots dépendant d'un point ouvert restent décochés tant que la décision n'est pas donnée.

---

## 8. Points ouverts — décisions du propriétaire

| Id | Question | Lot concerné | Proposition par défaut |
|---|---|---|---|
| P1 | « Commencez ici : vos jeux » : garder le « : » final ? | A | « Commencez ici » (pas de ponctuation pendante). |
| P2 | L'image Google est-elle exposée par `/auth/me` ? Le backend crée bien un champ `picture` à l'inscription Google (`backend/routers/auth.py:175`) mais aucun champ n'a été confirmé dans la réponse `/auth/me` côté prototype. | A | Utiliser `avatarSrc()` (Gravatar à partir de l'email) + initiales en repli ; brancher `me.picture` seulement si le champ est confirmé. |
| P3 | Que faire des cartes de jeux si `GET /games` échoue (pas d'admin configuré) ? | B | Aucune carte de démo ; état vide silencieux, sans message « configurez-le ». |
| P4 | Le numéro WhatsApp +261 37 751 9833 remplace définitivement « (numéro à confirmer) » ? | E | Oui, tel que fourni dans le feedback. |
| P5 | Quelle cible de réduction typographique ? « Diminuer » n'est pas chiffré. | A | Réutiliser une valeur d'échelle existante, validateur visuellement à 390 px ; ne pas inventer de `px`. |
| P6 | Le footer contient `id="support"` cible d'ancres `href="#support"` (`:2896,2929,2938,2943,2946,2970`) ; le masquer sur les autres pages casse-t-il un parcours ? | F | La nav utilise `data-nav="support"` (`showPage()` `:3531-3545`) ; vérifier chaque ancre au clavier et à la souris, corriger seulement si un lien devient mort. |

---

## 9. Push et deploiement (apres validation et execution des lots)

1. Un commit par lot, message `fix(<zone>): <description courte>` (`fix(accueil)`, `fix(boutique)`, `fix(proto)`, `fix(support)`), HEAD vérifié avant chaque commit ; ne jamais inclure les fichiers non suivis préexistants.
2. `git push` sur la branche de travail, puis fusion dans `main` seulement après validation visuelle sur un vrai téléphone à 390 px.
3. Le service web Render (`magicgamestore-web-v2`) déploie automatiquement depuis `main` en ~36 s ; aucun déploiement backend manuel n'est nécessaire puisque ce plan ne touche pas au backend.
4. Après fusion : relancer `yarn audit:contrast` sur `main` (règle permanente AGENTS.md §12) et comparer au baseline ; ne pas assouplir le script d'audit.

---

## 10. Etat d'avancement

- [x] Problematique rédigée à partir des 11 annotations.
- [x] Matrice de preuves relevée dans l'artefact servi.
- [x] Plan de validation et lots définis.
- [x] Validation du propriétaire (perimètre + points ouverts P1–P6) — propositions par défaut retenues ; P2 tranché par lecture de `backend/routers/auth.py:387-389` et `backend/core/security.py:16` : `/auth/me` expose bien `picture`.
- [x] Exécution des lots A → F, un commit par lot sur la branche `fix/proto-ux-correctifs` (53b31e6 → a508cc1).
- [x] Tests verts : `yarn build`, `yarn test:ci` (45 suites / 537 tests), `proto-logic.test.mjs` (29/29). Harnais E2E : 3 échecs préexistants identiques à la baseline, aucun nouveau.
- [ ] Push de la branche `fix/proto-ux-correctifs`.
- [ ] Validation visuelle sur un vrai téléphone à 390 px puis fusion dans `main`.
- [ ] Audit de contraste post-fusion sur `main` (règle permanente AGENTS.md §12) — non exécuté ici : le plan impose de le lancer sur le résultat de la fusion, pas sur une branche.

## 11. Points mesurés et limites connues (exécution du 2026-11-27)

- Mesures Chromium 390×844 et 1440×900 re-naviguées avec `?v=<timestamp>` : 2 CTA visibles, 4 titres et 4 paragraphes sans texte coupé (rectangle réel du texte dans son conteneur), avatar visible avec `me` même quand `/loyalty/me` répond 500, 2 cartes de jeux issues du mock et 0 carte quand la liste est vide, grille à 2 colonnes de 320 à 767 px, états vides sans bordure et centrés, chat absent du DOM et contacts `tel:`/`mailto:` dans le bloc formulaire, footer visible seulement sur `accueil`, logo 48×48 cliquable en `data-co=2/3`.
- **`scrollWidth` des titres animés** : le titre « Commencez ici » garde +2 à +3 px de `scrollWidth` sur son conteneur à 320/390 px, causé par les spans GSAP de `data-anim-slant` (présent avant les correctifs : 274/271). Le rectangle du texte réel reste dans le conteneur ; il ne s'agit donc pas d'une coupure visible, et l'écart est signalé plutôt que masqué.
- **Débordement documentaire préexistant** : `documentElement.scrollWidth` vaut 1452 px à 1440 px (et 776/1001/1000/1209/1210 aux largeurs intermédiaires), identique avant et après les lots, causé par le marquee ; hors périmètre du feedback, non corrigé.
- **Harnais E2E** : 3 échecs préexistants (filechooser MVola/Orange, poll Binance) relevés avant toute édition et retrouvés à l'identique après — aucun échec nouveau, aucun rapport de réussite inventé.
- Le stash `stash@{0}` contient 100 suppressions de docs/maquettes préexistantes sur `main`, non incluses dans les commits de cette branche.
