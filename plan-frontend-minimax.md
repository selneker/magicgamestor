# Magic Game Store — Frontend Plan (agent-facing)

> Working plan for the frontend refactor. `AGENTS.md` holds the permanent rules; this file holds the phased work.
> **One phase per session.** Never hand the whole plan to the agent at once — hand it Part B for the current phase only.

---

## Part A — Permanent rules (already merged into `AGENTS.md`)

See `AGENTS.md` § "Working rules". They are the authority; this section is only a pointer.

---

## Part B — 5 phases, short tasks, one validation criterion each

Estimated 8–10 working days in short sessions. **One phase = one git branch** (`phase-1-paiement`, …).
Merge only after manual validation on a real phone.

### Progress

| Task | Status | Commit | Notes |
|---|---|---|---|
| T1.1 Mobile cart bar | **done** | `450af04` + `572bb11` | CTA coverage 89% → 0% (measured across the full button width). Follow-up commit fixed z-index, nav-less routes, product page and the virtual keyboard |
| T1.2 Step counter "Étape 4 / 3" | **done** | `2dfd7a6` | 4 named steps, total derived from `screens.length`, vertical layout. Walked 1/4 → 4/4 in FR and EN |
| T1.3 USSD instructions | **done** | `0131ea6` + `651dac8` | Code, amount and merchant number are all rendered. Verified in the 4 combinations FR/EN × MVola/Orange at 390px. Follow-up fixed the `tel:` encoding and the copy message |
| T1.4 Payment status | **done** | `8522e20` | Icon disc via opacity overlay (not `color-mix()`), locale-aware amount, single `role="status"` region that never re-announces on poll |
| T1.5 Build without backend URL | **done** | `8d70c0c` + `48a4e3d` + `6a87334` | Build fails without the var (production only); Error Boundary FR/EN; `Home.js` survives a non-array payload |
| T1.6 Mémoiser le contrat d'identité | **done** | `f50db6c` | Without the `useMemo`, a game with no `identity_fields` left the customer **blocked at checkout step 1**. Before/after measured on the same build |
| T1.7 Garde-fou global sur les réponses `/api` | todo | | described below, not implemented |
| T2.1 Texte fixe sur les surfaces néon | **fait** | `d5e7e78` | 72 échecs de carte produit ramenés à **0** sur les 4 combinaisons. Audit : 101 → 30 |
| T2.4 Script d'audit de contraste | **fait** | `7bc393a` + `68416e0` + `7da61e1` | baseline re-mesurée : **101 échecs** ; exclusions et limites listées en tête de script |
| T2.2 Surfaces d'encre et barre panier | **fait** | `aa831e9` | 16 échecs + les 2 de `/suivi` ramenés à **0**. Audit : 30 → 14. Inventaire complet dans le plan |
| T2.3 Plaque blanche du logo | todo | | `GameButton.js`, `backgroundColor: "#FFFFFF"` |
| T2.5 Bouton désactivé « Vérifier l'ID » | todo | | à faire après T2.3, commit séparé |
| T2.6 Bouton « Payer via USSD » | todo | | blanc sur vert MVola (3,19:1) et sur orange (2,63:1) — 8 échecs |
| T2.7 Liens destructifs en sombre | todo | | « Déconnexion » 3,06:1, « Supprimer mon compte » 2,73:1 |
| T2.8 Indice de vérification sur panneau néon | todo | | « Vérifiez que cet ID… » 3,87:1 en sombre — trouvé en couvrant l'étape 1 du checkout |
| T2 → T5 | todo | | |

### T2.4 — mesure de départ (2026-10-20, avant toute modification)

`yarn audit:contrast` (`frontend/scripts/audit-contrast.mjs`) sert le bundle compile, injecte des données
simulées et mesure le contraste **réellement peint** de chaque texte visible. Pages auditées : accueil,
catalogue, les 4 étapes du checkout (dont l'écran USSD pour MVola **et** Orange), l'écran de statut de
paiement, la fiche produit, /compte, /suivi et la fidélité. 390 px et 1440 px, clair et sombre.

| Page | 390 px clair | 390 px sombre | 1440 px clair | 1440 px sombre |
|---|---|---|---|---|
| accueil | 2 | 23 | 1 | 22 |
| catalogue | 1 | 19 | 0 | 18 |
| checkout-1-verification | 0 | 0 | 0 | 0 |
| checkout-2-methode | 0 | 0 | 0 | 0 |
| checkout-3-ussd-mvola | 1 | 1 | 1 | 1 |
| checkout-3-ussd-orange | 1 | 1 | 1 | 1 |
| checkout-4-reference | 0 | 0 | 0 | 0 |
| statut-paiement | 0 | 0 | 0 | 0 |
| fiche-produit | 0 | 0 | 0 | 0 |
| compte | 0 | 2 | 0 | 2 |
| suivi | 1 | 1 | 0 | 0 |
| fidelite | 0 | 0 | 0 | 0 |
| **total** | **6** | **47** | **4** | **44** |

**TOTAL : 101 échecs** (10 en clair, 91 en sombre). Cible : 0.

> La première mesure annonçait 100. La re-mesure sur le même commit et le même bundle donne **101** :
> l'échec supplémentaire est le bouton « J'ai payé — saisir ma référence », mesuré **pendant sa transition**
> de couleur (le script vient de le cliquer). Il ne s'est pas reproduit aux runs suivants : c'est une limite
> de la mesure, pas un défaut de contraste. Les totaux par colonne ci-dessus sont ceux de la re-mesure.

Les causes, par nombre d'occurrences :

| Cause | Nb | Exemple | Tâche |
|---|---|---|---|
| Carte produit : texte crème sur fond néon | 68 | « 660 UC » **1,04:1**, badge de type **1:1**, chiffre **1,04:1**, badge « Populaire » **1,29:1** | **T2.1** |
| Bouton « Payer via USSD » : blanc sur vert MVola | 8 | **3,19:1** | **T2.6** |
| Panneau d'accent : `bg-foreground` bascule en crème | 6 | « Jeux disponibles » **1:1** | **T2.2** |
| Barre panier : `text-primary` remappé en couleur de texte | 6 | « 2 500 Ar » **1:1** (clair) | **T2.2** |
| « Moyens de paiement » dans un panneau encre | 4 | **1:1** | **T2.2** |
| Badge de réduction néon dans la barre de prix | 4 | « 15 » **1,04:1** | **T2.1** |
| Lien destructif en rouge sur fond sombre | 4 | « Déconnexion » **3,06:1**, « Supprimer mon compte » **2,73:1** | **T2.7** |
| Bouton désactivé « Vérifier l'ID » | 0 * | crème à 50 % d'opacité sur blanc, **1,12:1** | **T2.5** |

\* Le bouton désactivé n'apparaît pas dans la mesure : son état désactivé est rendu avec
`disabled:opacity-50`, que l'audit ne voit pas comme un texte opaque. **T2.5** le traite séparément, comme
convenu.

**Quatre choses apprises sur la mesure** (à ne pas refaire) :
- le fond doit être déterminé par **hit-test**, pas par remontée d'ancêtres : le fond peut venir d'un élément
  positionné en absolu qui n'est pas un ancêtre du texte (pastille néon de la barre de navigation) ;
- un élément qui peint **lui-même** un fond opaque : ce fond est le bon, sans hit-test ;
- un texte **masqué par un calque flottant** (barre panier, en-tête sticky) est une occlusion, pas un contraste :
  il faut l'ignorer, sinon la mesure compte des éléments invisibles ;
- la sonde doit partir des **glyphes** (Range sur le nœud de texte), pas du bord gauche de l'élément : sinon
  on mesure le badge qui précède le texte.

### T2.4 — l'auditeur : exclusions et limites (`7da61e1`, 2026-10-20)

Le script **ne doit jamais être assoupli pour atteindre 0**. Toutes les exclusions de mesure sont listées
**en tête de `frontend/scripts/audit-contrast.mjs`**, chacune avec sa raison :

| # | Exclusion | Raison |
|---|---|---|
| 1 | texte invisible (`display:none`, `visibility:hidden`, `opacity:0`) | rien n'est peint à l'écran |
| 2 | classe `sr-only` | texte réservé aux lecteurs d'écran |
| 3 | texte hors de la fenêtre | il sera mesuré au défilement (la boucle couvre toute la hauteur) |
| 4 | rectangle de glyphe < 4 × 4 px | ponctuation ou artefact de rendu |
| 5 | texte masqué par un calque flottant | occlusion, pas contraste : le fond visible est celui du calque |
| 6 | élément déplacé entre la mesure et le hit-test | la position mesurée n'est plus valide |
| 7 | composant inactif (`disabled`, `aria-disabled`) | WCAG 1.4.3 exempte les composants inactifs ; le bouton « Vérifier l'ID » désactivé est traité à part (**T2.5**, seuil ≥ 3:1 mesuré par un test dédié) |

**Ce que l'auditeur ne mesure pas** (noté en tête de script) : les bordures et séparateurs (WCAG 1.4.11,
3:1), les icônes porteuses de sens (3:1), les éléments non textuels, les fonds image ou dégradés, les
filtres CSS (`grayscale` de la carte « Indisponible »), l'**opacité** d'un élément (un texte atténué par
`disabled:opacity-50` est mesuré avec sa couleur pleine), le texte multi-lignes, les largeurs autres que
390/1440 px, le thème « système », et les pages hors de la liste `PAGES`.

**Couverture corrigée** : l'étape 1 du checkout est désormais mesurée dans ses deux états —
`checkout-1-verification-initiale` (champ vide, bouton « Vérifier l'ID » désactivé) et
`checkout-1-verification` (après vérification). L'ancien script cliquait « Continuer » dans les deux cas :
il mesurait l'**étape 2** sous le nom « checkout-1-verification ». **L'écran de vérification n'était jamais
audité** — c'est cette couverture qui a révélé l'échec de **T2.8**.
Deux variantes de carte manquaient aussi (carte « Indisponible », carte « Pack UC » non populaire) : elles
sont dans les données simulées de l'audit depuis `7da61e1`.
Une page qui ne se charge pas est désormais **signalée** (« NON CHARGÉE ») et fait sortir le script en
erreur : une page absente ne peut pas passer pour conforme.

### T2.2 — inventaire des surfaces d'encre, de `text-primary` et des alpha (2026-10-20)

**Surfaces d'encre.** Une surface d'encre doit être **noire dans les deux thèmes**, avec un texte
**crème fixe** : sinon le fond (fixe) et le texte (relatif au thème) se contredisent. Trois surfaces
mélangeaient les deux et cassaient le contraste :

| Surface | Avant | Après |
|---|---|---|
| `.panel-black` — 3 usages, `Home.js:75/89/311` | `bg-foreground` + `text-background` → crème en sombre | `bg-ink` + crème fixe |
| Carte « 02 » — `Home.js:113` | `bg-foreground text-background` | `bg-ink` + crème fixe |
| Barre panier — `CartDrawer.js:88` | `bg-foreground` + `text-background` | `bg-ink` + crème fixe |
| Sélecteur de jeu — `GameSelector.js:51` | `bg-foreground` + `text-background` | `bg-ink` + crème fixe |

Les **autres** surfaces inversées (`Header.js` pastille de points, `Account.js`,
`AdminBottomNav.js`, `PubgIdVerify.js`, `button.jsx`, `PaymentMethodPicker.js`, `OrderTrack.js`…) sont
**auto-cohérentes** (`bg-foreground` + `text-background`) : leur contraste ne dépend pas du thème. Elles
ne sont pas touchées ici — les uniformiser relève de T5.4.

**Jetons — pas de doublon.** L'encre vient du **jeton Tailwind `ink`** (`#111111`, déjà présent) : pas de
variable CSS dupliquée. Le crème fixe n'existait pas en tant que jeton (`--background` bascule en
sombre) ; la valeur `48 20% 94%` déjà présente dans le fichier est **promue en jeton `--cream`**
(`--background: var(--cream)`) et réutilisée par `.panel-black`, `.eyebrow-invert` et `.panel-points` :
une seule occurrence dans le fichier, aucun hex nouveau.

**`text-primary` — les 19 usages, classés.**

| Fichier | Usage | Surface | Classe cible |
|---|---|---|---|
| `Home.js:78` | nombre de jeux | panneau d'encre | **`text-neo-on-ink`** (migré) |
| `Home.js:94` | chevron d'étape | panneau d'encre | **`text-neo-on-ink`** (migré) |
| `Home.js:98` | « Moyens de paiement » | panneau d'encre | **`text-neo-on-ink`** (migré) |
| `Home.js:114` | numéro « 02 » | carte d'encre | **`text-neo-on-ink`** (migré) |
| `CartDrawer.js:89` | total du panier | barre d'encre | **`text-neo-on-ink`** (migré) |
| `Home.js:69` | numéros 01/02/03 du héros | page | `text-foreground` (T5.4) |
| `AuthPage.js:64`, `OrderTrack.js:125`+`:151`, `AuthExtras.js:39`, `StepVerify.js:72` | liens | page | `text-foreground` (T5.4) |
| `ProtectedRoute.js:11` | spinner | page | `text-foreground` (T5.4) |
| `AdminDashboard.js:12`+`:32` | chiffres de stats | carte | `text-foreground` (T5.4) |
| `AdminBottomNav.js:105` | `hover:` du ✕ | en-tête d'encre | `hover:text-foreground` (T5.4) |
| `button.jsx:21` (variante `link`), `radio-group.jsx:17` (pastille) | primitives | page | `text-foreground` (T5.4) |
| `FloatingChat.js:51`+`:60` | chat flottant | **code mort** | inchangé (T5.7) |

> Les usages « ailleurs » **ne sont pas migrés dans T2.2** : ils sont déjà lisibles, et les migrer
> ferait passer l'accent néon en crème sur toute l'application en mode sombre — c'est un changement de
> design, pas un correctif de contraste. Ils sont listés et classés ici pour **T5.4**, qui supprimera le
> remappage de `.text-primary`.

**`text-background/xx` et `border-background/xx` — tous les usages.**

| Fichier | Classe | Surface | Verdict |
|---|---|---|---|
| `Home.js:80` | `text-background/70` | panneau d'encre | migré → crème fixe 70 % |
| `Home.js:83` | `border-background/25` | panneau d'encre | bordure → crème fixe 25 % |
| `Home.js:94` | `text-background/85` | panneau d'encre | migré → crème fixe 85 % |
| `Home.js:98` | `border-background/20` (trait) + `/30` (puces) | panneau d'encre | crème fixe 20 % / 30 % |
| `Home.js:98` | `text-background` (puces MVola…) | panneau d'encre | crème fixe |
| `Home.js:116` | `text-background/70` | carte « 02 » | migré → crème fixe 70 % |
| `Home.js:312` | `text-background/75` | panneau d'encre | migré → crème fixe 75 % |
| `Header.js:61` | `text-background/70` (« pts ») | pastille inversée auto-cohérente | inchangé |
| `GameSelector.js:55` | `text-background/45` | panneau d'encre | **non décoratif** (libellé de section, 11 px) : 4,2:1 → **remonté à 60 %** |
| `GameSelector.js:81` | `text-background/55` (description) | panneau d'encre | 5,6:1 → crème fixe 55 % |
| `GameSelector.js:84` | `text-background/45` | panneau d'encre | **décoratif** (icône `aria-hidden`) : 3:1 suffit |
| `GameSelector.js:67` | `bg-background/10`, `hover:bg-background/5` | panneau d'encre | crème fixe 10 % / 5 % |
| `FloatingChat.js:58` | `text-background/60` | **code mort** | inchangé (T5.7) |

> **Aucun texte à 30 %** : le seul `30 %` du lot est une **bordure** (`border-background/30`,
> `Home.js:98`), donc décorative. Le texte le plus faible était le libellé « JEUX » à 45 % — il n'est
> pas décoratif, d'où la correction à 60 %.

**Barre panier — ne pas se fondre dans le fond.** En mode sombre, la barre est noire (`#111111`) sur un
fond `#2B2B2B` : 1,33:1, elle disparaît. Le cadre crème à 35 % ne donnait que 2,2:1 → **remonté à
55 %**, soit **4,3:1** contre le fond sombre (et 5,8:1 contre la barre elle-même). L'ombre néon
décalée (4 px, déjà présente) et le bouton « Commander » néon restent les principaux repères.

### T2.4 — état après T2.1 (2026-10-20)

| Page | 390 px clair | 390 px sombre | 1440 px clair | 1440 px sombre |
|---|---|---|---|---|
| accueil | 2 | 5 | 1 | 4 |
| catalogue | 1 | 1 | 0 | 0 |
| checkout-1-verification-initiale | 0 | 0 | 0 | 0 |
| checkout-1-verification | 0 | 1 | 0 | 1 |
| checkout-2-methode | 0 | 0 | 0 | 0 |
| checkout-3-ussd-mvola | 1 | 1 | 1 | 1 |
| checkout-3-ussd-orange | 1 | 1 | 1 | 1 |
| checkout-4-reference | 0 | 0 | 0 | 0 |
| statut-paiement | 0 | 0 | 0 | 0 |
| fiche-produit | 0 | 0 | 0 | 0 |
| compte | 0 | 2 | 0 | 2 |
| suivi | 1 | 1 | 0 | 0 |
| fidelite | 0 | 0 | 0 | 0 |
| **total** | **6** | **12** | **3** | **9** |

**TOTAL : 30 échecs.** Les **72 échecs de carte produit sont tombés** : il n'en reste **aucun** sur les
4 combinaisons.

| Cause | Nb | Exemple | Tâche |
|---|---|---|---|
| Bouton « Payer via USSD » : blanc sur vert MVola / orange | 8 | **3,19:1** (MVola), 2,63:1 (Orange) | **T2.6** |
| Barre panier : `text-primary` remappé en couleur de texte | 6 | « 2 500 Ar » **1:1** (clair) | **T2.2** |
| Panneau d'accent : `bg-foreground` bascule en crème | 6 | « Jeux disponibles » **1:1** (sombre) | **T2.2** |
| « Moyens de paiement » dans un panneau encre | 4 | **1:1** | **T2.2** |
| Lien destructif en rouge sur fond sombre | 4 | « Déconnexion » **3,06:1**, « Supprimer mon compte » **2,73:1** | **T2.7** |
| Indice « Vérifiez que cet ID… » sur un panneau teinté néon | 2 | **3,87:1** (sombre) | **T2.8** |

**Les 2 échecs de `/suivi`** (1 en clair, 1 en sombre, 0 à 1440 px) sont le **montant de la barre panier**
(« 2 500 Ar », classe `.num.block.text-lg.text-primary`) : `text-primary` est remappé en couleur de texte
(`index.css:209`), donc le total s'affiche en encre **sur l'encre** de la barre (1:1) en clair, et en néon
sur crème en sombre. À 1440 px la barre panier n'existe plus (`md:hidden`), d'où 0 échec. → **T2.2**, même
cause que les 6 échecs de barre panier. Ce n'est pas un défaut propre à `/suivi`.

### T2.4 — état après T2.2 (2026-10-20)

| Page | 390 px clair | 390 px sombre | 1440 px clair | 1440 px sombre |
|---|---|---|---|---|
| accueil | 0 | 0 | 0 | 0 |
| catalogue | 0 | 0 | 0 | 0 |
| checkout-1-verification-initiale | 0 | 0 | 0 | 0 |
| checkout-1-verification | 0 | 1 | 0 | 1 |
| checkout-2-methode | 0 | 0 | 0 | 0 |
| checkout-3-ussd-mvola | 1 | 1 | 1 | 1 |
| checkout-3-ussd-orange | 1 | 1 | 1 | 1 |
| checkout-4-reference | 0 | 0 | 0 | 0 |
| statut-paiement | 0 | 0 | 0 | 0 |
| fiche-produit | 0 | 0 | 0 | 0 |
| compte | 0 | 2 | 0 | 2 |
| suivi | 0 | 0 | 0 | 0 |
| fidelite | 0 | 0 | 0 | 0 |
| **total** | **1** | **6** | **1** | **6** |

**TOTAL : 14 échecs.** Les **16 échecs de T2.2 et les 2 de `/suivi` sont tombés**, il n'y a **aucun nouvel
échec** nulle part. Il ne reste que quatre causes, toutes affectées à une tâche :

| Cause | Nb | Exemple | Tâche |
|---|---|---|---|
| Bouton « Payer via USSD » : blanc sur vert MVola / orange | 8 | **3,19:1** (MVola), 2,63:1 (Orange) | **T2.6** |
| Lien destructif en rouge sur fond sombre | 4 | « Déconnexion » **3,06:1**, « Supprimer mon compte » **2,73:1** | **T2.7** |
| Indice « Vérifiez que cet ID… » sur un panneau teinté néon | 2 | **3,87:1** (sombre) | **T2.8** |

### T1.5 implementation notes (2026-10-20)

Three commits, as agreed:

1. **`8d70c0c`** — `frontend/scripts/check-backend-url.mjs` + the `prebuild` / `prestart` hooks in `package.json`.
   - CRA replaces `process.env` with an object literal holding **only the `REACT_APP_*` keys present at build time**
     (`react-scripts/config/env.js:70-100`). **Absent** → the bundle gets `baseURL: "undefined/api"` → blank page.
   - **An empty value is legitimate** and is accepted: it produces `baseURL: "/api"`, a *relative* URL, which is the
     "front and API on the same domain" case. **Only the absence of the variable is a build defect.** The check
     therefore tests *presence*, not value. `yarn build` → exit 1 · `yarn start` → warning, still starts ·
     `yarn test` → no hook, never blocked.
2. **`48a4e3d`** — `frontend/src/components/ErrorBoundary.jsx`, mounted in `src/index.js` **outside every provider**,
   plus the `error.*` strings in `translations.js`. The boundary resolves the language itself from
   `localStorage["mgs_lang"]` (FR unless the stored value is exactly `"en"`) instead of using `useLang()`.
3. **`6a87334`** — `asList(endpoint, payload)` in `pages/Home.js`: a non-array payload becomes `[]` and logs a
   `console.warn` naming the endpoint. `subs === null` (loading) still yields `undefined` so the skeletons show
   instead of the "no offers" message.

Verified in the browser on the real defect (HTML payload on `/api/products`): the error screen appears in FR and EN,
light and dark; **no stack trace on screen**; the error and its stack in the console; the "Recharger" button reloads.

### PR de la phase 1 — texte à coller (branche `fix/phase-1-review` vs `feat/all_fixing`)

> Titre : `fix(phase-1): parcours de paiement mobile et garde d'erreur globale`
>
> - **T1.1** Barre panier mobile : au-dessus de la navigation, masquée sur la fiche produit, pendant la
>   saisie clavier et sous une surcouche.
> - **T1.2** Compteur d'étapes : « Étape 1 / 4 » → « Étape 4 / 4 », avec des étapes nommées.
> - **T1.3** Instructions USSD : code, montant et numéro marchand affichés, copie du code, lien `tel:`
>   encodé.
> - **T1.4** Statut de paiement : fond d'icône valide, montant selon la langue, région `role="status"`
>   unique.
> - **T1.5** Build en échec explicite si `REACT_APP_BACKEND_URL` manque, **Garde d'erreur globale
>   (Error Boundary)** en FR/EN, accueil qui survit à une charge utile non-tableau.
> - **T1.6** Contrat d'identité du jeu mémoïsé.
> - **T1.8** Tests du script de contrôle d'environnement, repli si `ResizeObserver` manque, repli
>   `env()` pour la barre panier.
>
> La branche est prête mais **pas poussée** : `git push origin fix/phase-1-review`, puis
> https://github.com/selneker/magicgamestor/compare/feat/all_fixing...fix/phase-1-review

### T1.7 — Global guard on `/api` responses (to study, **not implemented**)

`Home.js` is now guarded, but the same failure class exists elsewhere (see the list below). The proposed approach, for
a future task:

> An **axios response interceptor** in `src/lib/api.js` that rejects any response on `/api` whose `Content-Type` is
> not JSON (or whose body is not a JSON array/object when the caller expects a list). The rejection would be a normal
> `Promise` rejection, so every existing `.catch(() => setX([]))` would already handle it — no per-page change.
> The interceptor would also log the offending URL.

Open questions to settle before coding it: the interceptor must **not** touch the auth endpoints that legitimately
answer with 401 (those are already handled by the refresh interceptor), and it must decide between *rejecting* and
*normalising to `[]`* — rejecting is safer but would turn a partial outage into a full page error, normalising is
quieter but hides the problem. My inclination: **normalise to `[]` for list endpoints and log loudly**, and keep the
Error Boundary as the last resort. Needs a decision, and a test for each shape.

### Other unguarded API-array call sites (listed, **not modified** — this is the material for T1.7)

| File:line | Operation | Source |
|---|---|---|
| `pages/Catalog.js:116` → `183,185,191,194,195,196` | `setProducts(r.data)` then `visibleProducts.filter(...)` | `/api/products` |
| `pages/Catalog.js:129` | `products.filter(...)` (favourites) | `/api/products` |
| `pages/OrderTrack.js:77` → `160,168` | `setHistory(r.data)` then `history.slice().map()`, `o.items.map()` | `/api/orders/me` |
| `pages/Loyalty.js:97` → `13,16` | `setData(r.data)` then `data.ledger` → `entries.map()` | `/api/loyalty/me` |
| `pages/Loyalty.js:98,99` → `40,72` | `setRewards(r.data)`, `setTransfers(r.data)` then `.map()` | `/api/loyalty/rewards`, `/transfers` |
| `pages/Events.js:14` → `18,26,36` | `setEvents(r.data)` then `list.map()` | `/api/events` |
| `pages/Product.js:28` → `49` | `setProduct(r.data)` then `product.items.map()` | `/api/products/:slug` |
| `components/chat/ChatThread.js:31` | `data.messages.map(...)` inside a spread | `/api/chat/…` |
| `pages/admin/AdminOrders.js:33` | `data.products.filter(...)` | admin |
| `pages/admin/AdminFazercards.js:19,131,242,243,244,391,521` | `.filter(...)` on API payloads | admin |
| `pages/admin/AdminProducts.js:67,68`, `AdminGames.js:24` | `.filter(...)` on API payloads | admin |

`pages/Catalog.js` is the most exposed: the catalogue is the main storefront page and it has no guard at all.

**T1.4 implementation notes (2026-10-20):**
- **Icon disc:** an absolutely-positioned overlay with `background: var(--mvola)` and `opacity: 0.12`. `color-mix()`
  was ruled out: the resolved production browserslist (`npx browserslist --env=production`, 39 targets) still
  contains **`chrome 109`** and **`and_uc 15.5`**, and `color-mix()` needs Chrome 111+. `opacity` is CSS 1 and works
  everywhere, including UC 15.5.
- **Amount:** `Intl.NumberFormat(lang)` + " Ar" → "2 500 Ar" (FR) / "2,500 Ar" (EN). `formatAr()` in
  `src/lib/api.js` is still hardcoded `fr-FR` for its ~10 other call sites — **left untouched** because T1.4's file
  list is `PaymentStatus.js` only. Generalising `formatAr(n, locale)` is a one-line, backward-compatible change if
  you want the whole app locale-aware.
- **Status announcement:** the `role="status" aria-live="polite"` heading is rendered **outside** the state
  branches so it stays the same DOM node; its text is derived from `state`. Measured: 0 text mutations across
  3 polls (9 s), exactly 1 mutation on the pending → completed transition, on the same node. It is the only live
  region in the component.

**T1.3 implementation notes (2026-10-20):** the `tel:` link needs the USSD terminator encoded — a raw `#` opens
the fragment and the browser drops it from the path, so the dialled sequence lost its terminator. The code is now
`encodeURIComponent`-encoded and the transmitted string matches the displayed code exactly.

**T1.1 validation criterion (revised 2026-10-20):** measure the **coverage of the "Commander" button across its
whole width** (walk the button's x-axis and check that every point hits the button), **not** `elementFromPoint` at
the centre. On the broken layout the centre happened to fall in a 13 px gap between the nav glass and the FAB, so a
centre-point check would have passed a 89 %-covered button.

**T1.3 inventory (2026-10-20)** — everything needed is already available, nothing is missing:

| Value | Source | Evidence |
|---|---|---|
| Merchant number | API | `GET /api/payments/config` → `providers.{mvola,orange}.merchant` — `backend/routers/payments.py:176-177`. Read at `PaymentFlow.js:184`, `StepPay.js:34` |
| Amount | API (derived) | `summary.subtotal + summary.fee` — `StepPay.js:35`; subtotal from the order lines, fee from the same config (`payment_fees`) |
| USSD code | **Frontend template** | `PaymentFlow.js:16-19` — `USSD.mvola = (phone, amount) => \`#111*1*2*${phone}*${amount}*1*0#\``, `USSD.orange = (phone, amount) => \`#144*1*1*${phone}*${phone}*${amount}*1#\``. The **backend has no USSD template at all** — grep for `111*1*2` / `144*1*1` in `backend/**/*.py` returns nothing |

The code is already computed at `StepPay.js:36` and consumed by the `tel:` link at `StepPay.js:45` — it is
simply never displayed. **No value has to be invented.**

Translation keys currently **unused** (0 references): `ussdTitle`, `ussdAmount`, `ussdNumber`, `ussdCode`,
`ussdSteps`, `ussdNote`, `ussdNext`. Already used: `ussd`, `ussdName`, `ussdNumberShort`, `manualHowto`,
`manualPayTitle`, `manualPaid`, `manualSub`.
None of the unused keys expects a `{placeholder}` — they are labels and literal sentences. `ussdSteps` is an
**array of 5 strings**, so `t()` returns it as-is (`LanguageContext` only interpolates when the value is a string).

**T1.6 — Mémoiser le contrat d'identité.** `Checkout.js:63` does
`const identitySpec = game?.identity_fields || []`. When a game has no `identity_fields` this creates a **new
array on every render**, so `spec` changes identity, so `handleVerified` changes identity, so the reset effect in
`PubgIdVerify` (`useEffect(..., [pubgId, onVerified])`, `PubgIdVerify.js:14-15`) re-fires and wipes the
verification result. Not a live bug today — `GET /api/games` always injects the resolved contract
(`backend/routers/games.py:27`, backend `identity_spec()`) — but the frontend has no equivalent fallback to the
backend's `identity_spec()`. Fix with a `useMemo` on `identitySpec`, in its own commit, after T1.5.

**T1.1 deviation (approved by the user):** the plan listed only `CartDrawer.js`, `BottomNav.js` and
`GameButton.js`. `Layout.js` was needed to reserve the extra bottom space, otherwise the cart bar would
cover the footer's last row. `BottomNav.js` and `GameButton.js` turned out to need **no change** for the
overlap itself — but the route predicate they each duplicated was extracted to `src/lib/bottomChrome.js`
so the cart bar, the nav and the FAB can never disagree about which chrome is on screen.

**T1.1 follow-up (`572bb11`)** — found by review, all four fixed and measured in the browser:
- `z-[60]` was above the cart drawer (Sheet, z-50) and the chat panel (z-50) → now `z-[45]`, above the nav
  (z-40) but below every overlay.
- The bar floated 84 px above the bottom on routes with no nav (`/commande`, `/compte`, `/admin`).
- On a product page it collided with `Product.js`'s own sticky buy bar → the cart bar is hidden on `/produit`.
- With the on-screen keyboard the layout viewport shrinks and the bar rose over the field being typed into
  (catalogue search, login e-mail) → the bar is hidden while a text field has focus.

**T1.1 known follow-ups (not fixed here, they belong to later tasks):**
- The cart bar total uses `text-primary` on `bg-foreground` → invisible in dark mode (1.06:1). → **T2.2**
- `border-foreground` on the cart bar is remapped to a 15%-opacity hairline → **T5.5**

**Dead components found while testing:** `components/chat/FloatingChat.js` and `components/chat/ChatLink.js`
are never imported anywhere — the floating chat FAB does not exist in the running app. `ChatWorkspace` and
`ChatThread` are used (by `/chat` and the admin chat page). The `panelOpen` guard added to the cart bar is
correct but currently has nothing to hide.

**Latent fragility found while driving the checkout (fixed in T1.6):** `Checkout.js` did
`const identitySpec = game?.identity_fields || []` — when a game has no `identity_fields` this creates a
**new array on every render**, which makes `handleVerified` a new function, which re-triggers
`PubgIdVerify`'s reset effect (`useEffect(..., [pubgId, onVerified])`) and wipes the verification result.
Measured on the same build, with a game that has **no** `identity_fields`:

| | child state "valid" | "Continuer" button | screen reached |
|---|---|---|---|
| without the `useMemo` | **wiped** | **absent** | `checkout-screen-1` — **blocked** |
| with the `useMemo` | kept ("Pseudo: TestPlayer") | present | `checkout-screen-2` |

With `identity_fields` present, both builds pass — which is why the bug stayed latent: the backend always injects the
resolved contract (`backend/routers/games.py:27`), so only a game *without* fields would trigger it. The frontend has
no equivalent fallback to the backend's `identity_spec()`, so the reference is now memoised.

### Reconciliation notes (verified against the current tree)

| Plan said | Reality | Use |
|---|---|---|
| `cd frontend && npm run build` | Repo is **yarn 1.22.22** (`yarn.lock`, `packageManager` pinned, no `package-lock.json`) | `cd frontend && yarn build` |
| "run the lint if it exists" | **No `lint` script.** ESLint config lives in `craco.config.js:96-105` and enables only `react-hooks` rules | `yarn build` + `yarn test:ci` |
| — | `yarn build` currently **succeeds** without `REACT_APP_BACKEND_URL` and produces a broken bundle | always export the var before building (T1.5 makes it fail loudly) |
| Touch target ≥ 44×44 px | House rule from iOS HIG / Material. WCAG 2.2 AA web floor is 24 CSS px — 44 is a deliberate stricter choice, not a WCAG minimum | keep 44 px |
| — | The working tree is **dirty** with in-flight auth work (backend + frontend) on branch `feat/all_fixing` | commit or stash it **before** creating `phase-1-paiement` |

All file/line references below were verified against the current tree and match.

### Phase 1 — Money path (absolute priority, 2 days)

Goal: a customer can add to cart, pay, and track their order on mobile.

**T1.1 Mobile cart bar hidden behind the nav**
- Files: `CartDrawer.js` (~l.18), `BottomNav.js` (~l.51), `GameButton.js` (~l.19-20). Correct reference: `Product.js` (~l.96, `bottom-20`).
- Problem: three fixed elements overlap. Cart bar (`fixed bottom-3`, z-30) sits under the nav (`bottom-0`, z-40), and the 60×60 floating button lands on the "Commander" button.
- Do: raise the cart bar above the nav (offset = nav height + safe-area + margin) with a higher z-index. Hide or move the floating button while the cart bar is visible.
- Validate: at 390 px with one item in the cart, "Commander" is fully visible and clickable (`document.elementFromPoint` at the button centre returns the button).

**T1.2 Step counter reads "Étape 4 / 3"**
- Files: `Checkout.js` (~l.160), `translations.js` (~l.64), `CheckoutSteps.js` (~l.4-5).
- Problem: `n = step + 1` reaches 4 while "/ 3" is hardcoded, and 4 screens render across 3 stages.
- Do: 4 named steps using the existing `checkout.stepVerify`, `stepMethod`, `stepPay`, `stepConfirm` keys. The total comes from a parameter, not a hardcoded digit in the translation.
- Validate: walking the whole checkout, the counter goes 1/4 → 4/4 and the highlighted stage matches the screen.

**T1.3 USSD instructions never rendered**
- File: `StepPay.js` (~l.31-51). Keys already translated FR/EN: `checkout.ussdCode`, `ussdAmount`, `ussdSteps`, `ussdNote`, `ussdNext`.
- Problem: only the merchant number and a `tel:` link are shown. Without telephony (tablet, desktop) payment is impossible.
- Do: show the USSD code, the amount, the steps and the note. Add a copy button for the code. Keep `tel:` as a secondary action.
- **Do not invent a USSD code.** Use what the code or the backend already provides. If the datum does not exist, ask.
- Validate: the payment screen shows code, amount and steps in both languages, without depending on the `tel:` link.

**T1.4 Payment status**
- File: `PaymentStatus.js` (~l.43).
- Problems: `background: "${color}1a"` with `color = "var(--mvola)"` yields invalid CSS; `order.total.toLocaleString("fr-FR")` ignores the active language.
- Do: use `color-mix(in srgb, var(--mvola) 10%, transparent)`. Format per the active language. Add `aria-live="polite"` on the status message.
- Validate: the icon circle has a visible background; the amount format changes in English.

**T1.5 Build without a backend URL = white screen**
- Files: craco config or a `prebuild` script, `Home.js` (~l.243), app entry point.
- Problem: without `REACT_APP_BACKEND_URL`, axios calls `undefined/api` and `Home.js` crashes (`s.filter is not a function`) — a blank page with no message.
- Do: (1) fail the build with a clear message when the var is missing, (2) guard the `.filter` calls with `Array.isArray`, (3) add a global Error Boundary with a readable FR/EN message.
- Validate: `yarn build` without the var fails with an explicit message. With an API that errors, the page shows an error state, not a white screen.

### Phase 2 — Readable dark mode (1 day)

Goal: zero contrast failures, in light and dark.

**T2.1 Fixed foreground for neon surfaces** — **DONE (`d5e7e78`, 2026-10-20)**
- File: `ProductCard.js` only (`index.css` untouched).
- Problem: fixed neon background `#D4FF00` (`bg-neo`) + inherited `text-foreground`, which becomes cream in dark mode → 1.04:1.
- Do: **a fixed surface needs a fixed foreground.** The card's content wrapper gets `text-ink`
  (`#111111` — the Tailwind token already used by `border-ink` / `bg-ink` in that file); the price pill gets
  `text-foreground` (it is the only child that paints a *theme* surface: `bg-white` → `hsl(var(--card))`);
  the discount badge (`bg-neo`) gets `text-ink`.
- The `--neo-card-fg` token planned here was **not created**: the Tailwind token `ink` (`#111111`,
  `tailwind.config.js:30`) already **is** that token — same value in both themes — and the file already uses
  `border-ink` / `bg-ink` / `text-ink/70`. A new CSS variable would have been a duplicate. (`--neo-text` in
  `index.css` carries the same value and is still unused.)
- Validate: **72 product-card failures → 0** on the 4 combinations. Variants checked: UC popular with and
  without the discount badge, « Pack UC », « Prime+ », « Prime », « Évolutif » (Elite Pack), « Indisponible »,
  card already in the cart (quantity pill) and hover state. Captures before/after at 390 px, light and dark.

**T2.2 Black panels turn cream** — **DONE (`aa831e9`, 2026-10-20)**
- Files: `index.css` (`.panel-black`, `.eyebrow-invert`, `.panel-points`, new `--cream` token, new `.text-neo-on-ink` class), `Home.js` (panels, « 02 » card), `CartDrawer.js` (cart bar), `GameSelector.js` (panel + alphas).
- Problem: `.panel-black` = `bg-foreground`, so it is cream in dark mode. `.dark .text-primary` becomes neon on cream → 1.06:1. And in light mode `text-primary` is remapped to the body colour, so on an ink panel it is ink on ink → 1:1.
- Do: `.panel-black` becomes a **fixed** ink surface (black in both themes) with fixed cream text. Neon is used **only** on ink surfaces, via an explicit class (`.text-neo-on-ink`).
- **Do not make `.text-primary` neon everywhere** — neon on a cream background is unreadable.
- Implementation: the ink comes from the Tailwind token `ink` (`bg-ink`, no duplicated variable); the fixed cream is the value already in the file (`48 20% 94%`) promoted to the token `--cream` (`--background: var(--cream)`), reused by `.panel-black`, `.eyebrow-invert` and `.panel-points`. The `text-background/xx` inside those surfaces become `text-[color:hsl(var(--cream)/.x)]`. The **remap of `.text-primary` stays** (removed in T5.4).
- Validate: "JEUX DISPONIBLES", "COMMENT ÇA MARCHE", "Ouvrir le chat" and the "02" card stay black in dark mode with readable text; the cart bar total (« 2 500 Ar ») is readable in both themes. **16 failures + the 2 of `/suivi` → 0**, no new failure anywhere (audit 30 → 14). Captures 390 px and 1440 px, light and dark: home page, cart bar, game selector.

**T2.3 White logo plate**
- File: `GameButton.js` (~l.32, `backgroundColor: "#FFFFFF"`).
- Do: theme-dependent background via a token — no white box on the black nav in dark mode.

**T2.4 Automated contrast audit** — **DONE (`7bc393a`, `68416e0`, `7da61e1`)**
- New file: `frontend/scripts/audit-contrast.mjs` (`playwright-core` devDependency, Chromium via `CHROMIUM_PATH`).
- Do: load the key pages (home, catalogue, checkout, product, account, order tracking, loyalty) at 390 px and
  1440 px, in light and dark themes; list text elements below 4.5:1 (3:1 for large text); exit non-zero if any
  are found.
- Validate: 0 failures across the 4 combinations. The command is `yarn audit:contrast` (not wired into
  `build` / `test` / `prestart`).

**T2.5 Disabled « Vérifier l'ID » button**
- File: `frontend/src/components/store/PubgIdVerify.js` (~l.42-44, the `btn` class and the `verify` handler).
- Problem: the disabled state is `disabled:opacity-50` — cream at 50 % opacity on the ink button, 1.12:1 as
  painted. The audit cannot see it (element opacity is not composited), so it is measured apart.
- Do: muted background + **ink** text at **≥ 3:1**, no opacity trick, no shadow, `cursor-not-allowed`,
  `aria-disabled`. **The handler must do nothing when the button is disabled** (no verification, no
  submission) — with `aria-disabled` the button stays focusable, so the guard is in the handler.
- Validate: the button is `aria-disabled`, the **click** and the **Enter key** trigger nothing (no request, no
  state change), and the disabled state is at ≥ 3:1.

**T2.6 « Payer via USSD » button — white on the brand green** (hole found on 2026-10-20)
- File: `frontend/src/components/store/checkout/StepPay.js` (~l.101, the `<a data-testid="ussd-button">`).
- Problem: `text-white` on `var(--mvola)` (`#00A651`) = **3,19:1**, and on `var(--orange)` (`#FF7900`) =
  **2,63:1**. 8 failures, on the MVola **and** the Orange screen, in the 4 combinations.
- Do: **do not change the brand colour.** Two routes: (a) ink text (`#111111`) on the unchanged brand
  colour — 5,9:1 on MVola, 7,2:1 on Orange; (b) a darker tone reserved for that button
  (`--mvola-strong` / `--orange-strong`) keeping white text. **The approach is announced before coding.**
- Validate: « Payer via USSD » is at ≥ 4.5:1 in light and dark, for MVola **and** Orange; the brand colour
  itself is unchanged.

**T2.7 Destructive links in dark mode** (hole found on 2026-10-20)
- Files: `index.css` (the `--destructive` / `--destructive-foreground` pair in `.dark`), `pages/Account.js`
  (~l.63 « Déconnexion », ~l.247 « Supprimer mon compte », ~l.280).
- Problem: in dark mode `--destructive` = `6 70% 50%` → « Déconnexion » **3,06:1** and « Supprimer mon
  compte » **2,73:1** on `#2B2B2B`.
- Do: fix the **token** in `.dark` — no local hex in the component. A lighter red reads as text on a dark
  background, but the destructive *button* (`bg-destructive` + `--destructive-foreground`) must keep a
  readable pairing, so the two tokens move together.
- Validate: « Déconnexion » and « Supprimer mon compte » at ≥ 4.5:1 in dark mode, and the delete-confirmation
  button (red background) still at ≥ 4.5:1.

**T2.8 « Vérifiez que cet ID… » on the tinted neon panel** (hole found on 2026-10-20)
- File: `frontend/src/components/store/PubgIdVerify.js` (~l.67, the `pubg-verify-confirm` paragraph).
- Problem: `text-muted-foreground` on `bg-primary/15` → **3,87:1** in dark mode (2 failures). Found only
  because the audit now measures the verification screen (see the auditor section above).
- Do: a foreground that holds on the neon-tinted panel, in both themes.
- Validate: ≥ 4.5:1 in light and dark, on the verified panel.


### Phase 3 — Accessibility and fonts (2 days)

**T3.1 Accessible names** — `Header.js` (~l.94): the account link has no name; add `aria-label` via `t()`. Sweep every `size="icon"` button.

**T3.2 Chat button keyboard-operable** — **REMOVED (2026-10-20).** `components/chat/FloatingChat.js` is not imported anywhere: the floating chat button does not exist in the running app. The task is moot until the component is wired up. The dead code is scheduled for removal in Phase 5 (T5.7).

**T3.3 Focus in dialogs** — `GameSelector.js` (~l.41-54), `AdminBottomNav.js` (~l.90-101), `FloatingChat.js` (~l.53). Use the Radix `Dialog` already present (focus trap, initial focus, focus restore) instead of the hand-rolled `role="dialog"`.

**T3.4 Touch targets ≥ 44 px** — header cart button and account link (36), favourite heart (32), add-to-cart (40), quantity buttons (28), filter chips (35), search field (40), cart-drawer close (`ui/sheet.jsx` ~l.53-58). Enlarge the hit area (padding or `min-h`/`min-w`); the visual may stay small.

**T3.5 Page skeleton** — skip link "Aller au contenu", `<main id="main">`, focus moved to `<main>` on route change.

**T3.6 Local fonts** — `public/index.html` (~l.30) loads Google Fonts. Install `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/onest`, import them, drop the Google link, add a `size-adjust` fallback. Check that `public/sw.js` caches the fonts.

### Phase 4 — Content and states (1–2 days)

**T4.1 Missing translations** — `ProductCard.js` (~l.27-29, 58-59, 63, 110, 113, 116): "Prime+", "Évolutif", "UC", "mois", "Populaire", "Elite Pack", "Abonnement", "Indisponible", "Retirer du panier", "au panier". FR and EN for every key. **The chat files are out of scope for this task** (`Chat.js`, `ChatWorkspace.js`, `ChatThread.js`, ~28 strings) — the 4 chat files are still hardcoded French, but the floating chat they belong to is not mounted (see T5.7); revisit them only if the chat is actually wired into the app.

**T4.5 Locale-aware amounts** — `formatAr()` in `src/lib/api.js` is hardcoded `fr-FR`, so every amount in the app is
"2 500 Ar" even in English. Change it to `formatAr(n, locale = "fr-FR")` and pass the active language at the call
sites. **Known temporary inconsistency (introduced by T1.4, resolved here):** the payment-status screen
(`components/store/PaymentStatus.js`) formats its total with `Intl.NumberFormat(lang)` → "2,500 Ar" in EN, while the
cart and the order summary next to it still show "2 500 Ar" because they go through `formatAr`. The two disagree on the
same screen until this task is done. `formatAr` was deliberately left untouched during T1.4 because that task's file
list was `PaymentStatus.js` only.

**T4.2 Catalogue duplicate** — `Catalog.js` (~l.183, 191, 194): "Les plus choisis" and "Packs UC" show the same 3 cards. Apply the `popularIds` dedupe that is already computed.

**T4.3 Heading hierarchy** — `ProductCard.js` (~l.100): titles are `h2` inside `h2` sections → make them `h3`. `Account.js` (~l.82): section titles must be real `h2`.

**T4.4 Loading / empty / error** — `Events.js` (~l.34) shows "Aucun événement" while loading. `Loyalty.js` (~l.97, 105) turns an API error into a 0 balance. `Home.js` (~l.238) swallows the error. Create 3 distinct states (skeleton, empty, error with a "Réessayer" button).

### Phase 5 — Design-system coherence (2 days)

**T5.1 Dead code cleanup** — delete `src/styles/product-card.css` (duplicate), `rounded-neo`, `.neo-card-radius`, the unused `--neo-*` variables.

**T5.2 Radius scale** — reduce to 4 or 5 values (e.g. 6, 10, 16, 28, pill). Replace arbitrary px radii with those values.

**T5.3 Type scale** — remove 8 px and 9 px, raise 10 px to 11 px, route the 44 `text-[11px]` declarations through `.eyebrow`.

**T5.4 Remap table** — (`index.css` ~l.175-222, outside `@layer`). Remove it progressively (one class family per commit) and replace usages with tokens (`--warning`, `--success`, `--danger`, `--info`, elevations). Leaking families: `rose`, `amber`, `emerald`, `sky`, `slate`.

**T5.5 Borders** — the brutalist identity must NOT go everywhere. 2 px ink border only on actionable elements: product cards, primary buttons, one or two key panels. Other surfaces keep thin but **visible** rules (≥ 3:1). Replace the `border-foreground` remap (~15% opacity) with an explicit `--rule` token.

**T5.6 Hardcoded colours** — the 71 `text-[#0A0A0A]` → `text-primary-foreground`. Unify the 5 dark greys. Align the theme colour between `ThemeToggle.js` (~l.13) and `public/index.html` (~l.14).

**T5.7 Delete the confirmed dead chat components** — `components/chat/FloatingChat.js` and `components/chat/ChatLink.js`. **Confirmed dead (2026-10-20):** each is referenced only by its own definition, there is no `import()` and no `React.lazy` anywhere in `src/`, the `/chat` route renders `pages/Chat.js` → `ChatWorkspace` and `/admin/messages` → `pages/admin/AdminChat.js` → `ChatWorkspace`, and the built bundle contains 0 occurrences of their strings (CRA tree-shook them out). **Do not delete them before this task is picked up** — until then they stay untouched.

---

## Part C — Prompts to paste into opencode

### Session start (adapt per phase)

```
Read AGENTS.md, then plan-frontend-minimax.md (Part B, Phase 1 only).

Work on branch phase-1-paiement (create it if missing).

Do ONE task at a time, in order: T1.1, T1.2, T1.3, T1.4, T1.5.
For each task:
1. Read the files involved and summarise in 3 lines what you found (confirm the problem, or say what differs
   from the description).
2. Propose the change in a few lines and wait for my "ok".
3. Apply, run `cd frontend && yarn build`, commit.
4. Report in the AGENTS.md format.

Never move to the next task without my approval. If a datum is missing (USSD code, translation string), stop
and ask.
```

### Single task (use when the agent drifts)

```
Task: T1.1 (mobile cart bar hidden) only.
Allowed files: CartDrawer.js, BottomNav.js, GameButton.js.
Touch nothing else.
Success criterion: at 390 px wide, with one item in the cart, the "Commander" button is visible and clickable,
with no overlap against the bottom nav or the floating button.
Read the 3 files first, then explain your plan before editing.
```

### End-of-phase review (fresh session)

```
Re-read AGENTS.md and Phase N of plan-frontend-minimax.md.
Do a read-only review of the branch diff against main (git diff main).
For each task in the phase: say done, partial or missing, with file and line as evidence.
Also list any out-of-scope change. Do not modify any file.
```

---

## Operating notes

- Keep sessions short: one phase per session; restart from scratch if the agent starts repeating or drifting.
- Always ask for a summary of what it found before it writes code — that is where contradictions show up.
- Validate on a real phone after each phase, not just the build.
- If a task fails twice, split it into two smaller ones instead of re-explaining.
- A stronger model (Claude Code) can run the end-of-phase review — the author does not review their own work well.
