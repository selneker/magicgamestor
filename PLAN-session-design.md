# Plan — session sans flash de connexion + retouches boutique/commande

Statut : plan opérationnel. Un lot = un commit `fix(<zone>): …`, validation avant de passer au suivant.

## 0. Périmètre

- **Artefact servi** : `frontend/public/index.html` (2,35 Mo, 6 284 lignes, CSS inline, React neutralisé). Toutes les corrections de ce plan visent ce fichier ; `src/**` et le backend restent intacts, sauf ajout éventuel d'un test de garde-fou.
- Ne pas reprendre les fichiers non suivis déjà présents dans l'arbre (`frontend/scripts/proto-z3b-dev.mjs`, `orchestration(portage).md`, `untitled.md`).
- Le mandat « ne touche pas les styles » est lu ici comme **autorisant uniquement** les changements explicitement nommés plus bas ; aucun autre réglage visuel.

## 1. Audit — causes constatées

| Symptôme | Cause (preuve) |
|---|---|
| Page de connexion qui clignote au rechargement alors que le compte est enregistré | `boot()` affiche immédiatement la page de l'URL (`index.html:6225-6233`) puis attend `/auth/me` (`:3844-3854`, retries 3 s/8 s). Le `MutationObserver` (`:6105`) déclenche `route()` avec `me = null` : `loaders.connexion` (`:6042`) ne redirige vers `boutique` qu'après résolution de session (`:6273-6275`). |
| Logo / nav / bottom-nav absents pendant ce temps | `body[data-page="connexion"] .nav-w, .footer, .bottom-nav-w { display:none !important }` (`:979`). `mgsSetNav()` (`:3503-3508`) et `syncAuthChrome()` (`:4911-4928`) ne s'exécutent qu'après. |
| « Skip » vers le choix des jeux sans chrome | `loaders.connexion` (`:6042`) et `doAuth()` (`:5113-5118`) appellent `mgsShowPage("boutique")` ; la page connexion a déjà été peinte et a déjà consommé son animation. |
| Animation d'entrée | `.mgs-page.is--active{animation:mgsPageIn .5s …}` / `@keyframes` / `prefers-reduced-motion` (`:597-599`) ; `mgsReveal()` est volontairement vide (`:3510`). À préserver, pas à remplacer. |
| Favoris sur les cartes | 8 boutons dans le markup (`:2473,2488,…,2578`), CSS (`:914-918`), état `FAV_KEY/getFavs/toggleFav/syncFavs` (`:3956-3959`), délégué clic (`:3630,6162`). |
| Statut « Kapotue » vert | `.mgs-co-id-status.is--ok` défini deux fois en vert (`:1149` et `:1277`), rendu à `:4168`. |
| Ombres noires | Popin humaine `box-shadow:.5em .5em 0 var(--color--dark)` (`:1220`). Le bouton « Passer la commande » n'a **pas** de `box-shadow` déclaré : l'ombre perçue vient probablement de la couche noire `.button-main-inner__back` au survol/focus (`:361-406`) — à confirmer par mesure avant édition. |

## 2. Lots de travail

### Lot 1 — Session, redirection et animation (fonctionnel)

- [x] 1. Garder le paint immédiat partout sauf sur les routes dépendantes de la session. Dans `boot()` (`:6225-6277`), conserver l'affichage direct pour `/`, `/boutique`, `/evenements`, etc. Pour `SESSION_LOADERS` (`:6000`) — notamment `connexion` — ne pas poser `data-page="connexion"` tant que `sessionResolved` est faux ; laisser la page courante peinte et son animation se terminer.
- [x] 2. Décision unique après `/auth/me`. Si `me` est renseigné : `history.replaceState` vers `/boutique`, puis **un seul** passage `is--active` vers `boutique` (une seule exécution de `mgsPageIn`). Si invité : afficher `connexion` normalement. Ne pas ajouter d'appel réseau ni modifier les délais 3 s/8 s.
- [x] 3. Empêcher le clignotement sur navigation. Dans `needLogin()` (`:4934`) et `loaders` (`:6007-6045`), si la session est résolue et `me` présent, aller directement à `boutique` sans passer par `data-page="connexion"` ; si elle ne l'est pas, différer (comportement déjà en place) sans peindre la page.
- [x] 4. Chrome. La règle `:979` ne doit s'appliquer qu'à une page connexion réellement affichée à un invité. Après redirection connectée, vérifier `mgsSetNav("boutique")` (`:3503`) + `syncAuthChrome()` (`:4911`) : logo, `.nav-w`, `.bottom-nav-w` visibles et item « jeux » actif. Aucune retouche de leur style.
- [x] 5. Animation. Ne pas supprimer `mgsPageIn`, ne pas ajouter d'animation, ne pas toucher à `gsap`/`lenis` (`:3521-3524`) ni au `@media prefers-reduced-motion` (`:599`). Contrôle : `animationName === "mgsPageIn"`, une seule activation, sur la page finale.
- [x] 6. Tests : `/auth/me` mocké en 200 / 401 / 200 différé ; assérer la suite de `body[data-page]` observée, l'URL finale, `getComputedStyle(...).display`, l'état `is--active` du bottom-nav et le nom d'animation.

### Lot 2 — `/boutique` : cartes

- [ ] 1. Retirer les favoris jusqu'à la racine (consigne « clean le code ») : markup des 8 cartes, CSS `:914-918`, `FAV_KEY`/`getFavs`/`toggleFav`/`syncFavs` `:3956-3959`, délégués `:3630` et `:6162`, clé i18n si elle existe. Contrôle final : `grep -i "fav"` sur le fichier servi ne remonte plus aucune occurrence fonctionnelle.
- [ ] 2. Cartes quasi carrées : ajuster `.mgs-pcard` (`:907`) avec un `aspect-ratio` proche de 1, puis réduire les tailles de texte internes (`.mgs-pcard__amount` `:920-921`, `.mgs-pcard__title` `:924`, et si nécessaire badge/catégorie `:911,923`). Uniquement des jetons existants (`--color--*`, `--font--*`). Conserver le hover (`:908`).
- [ ] 3. Mesurer à 390 px et 1 440 px : rapport largeur/hauteur de la carte, taille de police calculée, `document.scrollWidth === innerWidth`, cible tactile `.mgs-pill__add` ≥ 44 px (`:943`), aucun texte coupé.

### Lot 3 — `/commande`

- [ ] 1. Statut ID : passer `.mgs-co-id-status.is--ok` (`:1149` et `:1277`) en `var(--color--dark)`, conserver l'icône de validation. Déplacer le `<p class="mgs-co-id-status">` (`:2812`) au niveau des suggestions `.mgs-co-recent` (`:2811`), c'est-à-dire juste sous le champ et avant le bloc des suggestions. Ne pas modifier `coStatus()` (`:4300`) ni la logique de vérification.
- [ ] 2. Bouton texte « changer l'ID » : ajouter dans `.mgs-co-id-row` (`:2810`) un bouton nu, texte noir semibold, qui vide/focalise le champ, réinitialise le statut (`:4294`) et les suggestions, sans toucher à `mgs_last_player_id` ni au pré-remplissage (`:4292-4295`). Zone tactile ≥ 44 px via padding transparent. Nouvelle chaîne visible traduite FR/EN dans le dictionnaire de `index.html`.
- [ ] 3. Ombre du bouton « Passer la commande » : d'abord mesurer `getComputedStyle` au repos et en `:hover`/`:focus-visible` forcés pour identifier la source (`box-shadow` ou `.button-main-inner__back`). Ensuite neutraliser **uniquement** sur ce bouton (`.mgs-co-screen > .button-main`), sans modifier la règle globale `.button-main`. Contrôle : `boxShadow === "none"` et aucune couleur noire décalée au repos comme au survol.
- [ ] 4. Popin de vérification humaine : retirer `box-shadow` de `.mgs-human-popup` (`:1220`) ; retirer le bouton `.mgs-human-cancel` **de cette popin uniquement** (`:3696`) — la classe est partagée avec la popin d'annulation (`:3709`) et son gestionnaire (`:6200`) ; retirer le texte visible du `<label>` (`:3696`) en gardant la checkbox `.mgs-human-cb` et un nom accessible non visible pour `openHuman()` (`:4380-4407`). Laisser le bouton X (`:3693`) fermer la popin.
- [ ] 5. Bouton pleine largeur : dans `.mgs-human-foot` (`:1238`) / `.mgs-human-confirm` (`:1240`), faire occuper toute la largeur de la boîte au bouton (`flex:1 1 auto;width:100%;min-width:0`) ; les spans internes sont déjà à 100 %. Contrôle par rects à 390 px.
- [ ] 6. Contrôles : la case/Turnstile continue de piloter `disabled` (`:4386-4407`) ; `closeHuman()` (`:4409`) reste fonctionnel ; aucun `box-shadow` résiduel mesuré.

## 3. Vérification à l'implémentation

- `cd frontend && REACT_APP_BACKEND_URL=<valeur de .env.example> yarn build`, puis `yarn test:ci` (garde-fou `src/index-html.test.js`).
- `node frontend/scripts/proto-logic.test.mjs` et `node frontend/scripts/proto-functional.mjs` (Chromium : `~/.hermes/tools/chromium-1248/chrome-linux64/chrome`).
- Navigateur, avec `?v=<timestamp>` pour éviter le cache HTML : `/connexion`, `/compte`, `/boutique`, `/commande` à 390 px et 1 440 px ; `/auth/me` mocké (200, 401, lent) ; relevé des `data-page` successifs, des styles calculés et des rects — pas de validation à la capture d'écran seule.
- Un commit par lot, message `fix(<zone>): …` ; `git status` et HEAD vérifiés avant chaque commit (arbre partagé).

## 4. Points ouverts — décisions retenues pour l'exécution

1. Le propriétaire a explicitement demandé ces retouches visuelles : la règle « ne touche pas les styles » est suspendue **aux seuls points listés**.
2. « Kapotue » placé juste sous le champ ID, avant le bloc des suggestions.
3. Supprimer uniquement le bouton « Fermer » du pied de la popin et le libellé visible du `<label>` ; conserver le paragraphe d'introduction et le bouton X.
4. Aucune nouvelle couleur introduite : « Kapotue » passe en `var(--color--dark)`.
