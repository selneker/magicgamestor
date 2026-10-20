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
| T2.3 Plaque blanche du logo | **fait** | `694ae49` | disque néon + bord encre pour le bouton de jeu ; plus aucun blanc en dur dans `GameButton.js` |
| T2.5 Bouton désactivé « Vérifier l'ID » | **fait** | `f584111` + `8525054` + `87650b1` | `aria-disabled` + gestionnaire inerte, fond atténué ≥ 3:1 ; 8 tests (clic, Entrée, chargement, contraste) |
| T2.6 Bouton « Payer via USSD » | **fait** | `d7f3207` | texte encre sur la couleur de marque inchangee : 5,9:1 / 7,2:1. Audit : 14 → 6 |
| T2.7 Liens destructifs en sombre | **fait** | `8728d7b` | `--destructive` + `--destructive-foreground` déplacés en `.dark` : 3,06 → 5,40:1 et 2,73 → 4,82:1. Audit : 6 → 2 |
| T2.8 Indice de vérification sur panneau néon | **fait** | `5828422` | `text-foreground/75` : 3,87 → 4,74:1 en sombre |
| T2.9 Puce de choix du fournisseur | **fait** | `b3079c2` | texte encre sur la couleur de marque : 5,9:1 / 7,2:1 |
| T2.10 Icône de statut de paiement | **fait** | `f36db2a` | l'icône prend l'avant-plan du thème : 17,3:1 / 9,8:1 |
| T2.10 (suite) | **découpé** | | les badges admin → **T2.12** (tâche admin) ; la pastille du chat → **T5.7** |
| T2.11 Rayon des popups du checkout | **fait** | `2c8822c` + `603f2fd` | dialogue 28 px sur 4 coins, tiroir 28 px sur 2 coins gauches ; le `!` est une rustine pour T5.2 |
| T2.12 Les pages admin | todo | | hors audit : 5 tuiles colorées, badges MVola/Orange, `text-rose-600`… |
| T2.13 Corrections de revue | **fait** | `af61cf3` + `d80aa3f` + `b201ebe` + `dd09da6` | offset d'anneau, chemins du script de captures, branche morte, indice a 80 % |
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

> **Les pages admin ne sont pas auditées.** `PAGES` ne contient que les pages client ; `/admin` et ses
> sous-pages (`/admin/products`, `/admin/orders`, `/admin/fazercards`…) **ne sont pas mesurées** — ni
> leur contraste, ni celui des composants admin (`text-rose-600`, `text-emerald-600`, `hover:text-rose-600`,
> qui sortent bruts du remappage, cf. T5.4). Le tableau de bord admin a notamment 5 tuiles de stats
> colorées (`text-primary`, `text-amber-600`, `text-emerald-600`, `text-violet-600`) qui ne sont pas
> couvertes. **À traiter dans une tâche dédiée** (ajouter les pages admin à `PAGES` et corriger les
> familles de couleurs qui fuient) — pas dans T2.3.

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

### T2.4 — état après T2.6 (2026-10-20)

| Page | 390 px clair | 390 px sombre | 1440 px clair | 1440 px sombre |
|---|---|---|---|---|
| accueil | 0 | 0 | 0 | 0 |
| catalogue | 0 | 0 | 0 | 0 |
| checkout-1-verification-initiale | 0 | 0 | 0 | 0 |
| checkout-1-verification | 0 | 1 | 0 | 1 |
| checkout-2-methode | 0 | 0 | 0 | 0 |
| checkout-3-ussd-mvola | 0 | 0 | 0 | 0 |
| checkout-3-ussd-orange | 0 | 0 | 0 | 0 |
| checkout-4-reference | 0 | 0 | 0 | 0 |
| statut-paiement | 0 | 0 | 0 | 0 |
| fiche-produit | 0 | 0 | 0 | 0 |
| compte | 0 | 2 | 0 | 2 |
| suivi | 0 | 0 | 0 | 0 |
| fidelite | 0 | 0 | 0 | 0 |
| **total** | **0** | **3** | **0** | **3** |

**TOTAL : 6 échecs.** Les 8 de T2.6 sont tombés, **aucun nouvel échec**. Il reste 2 × T2.8 et 4 × T2.7.

> Point de vérification : l'écran « statut de paiement » **est** bien atteint par le parcours de l'audit
> (le mock doit renvoyer une commande pour `POST /orders`, sinon le parcours plante sur la garde d'erreur
> globale et la page est comptée 0 échec sans avoir été mesurée).

### T2.4 — état après T2.7 (2026-10-20) — état final de la phase 2

| Page | 390 px clair | 390 px sombre | 1440 px clair | 1440 px sombre |
|---|---|---|---|---|
| accueil | 0 | 0 | 0 | 0 |
| catalogue | 0 | 0 | 0 | 0 |
| checkout-1-verification-initiale | 0 | 0 | 0 | 0 |
| checkout-1-verification | 0 | 1 | 0 | 1 |
| checkout-2-methode | 0 | 0 | 0 | 0 |
| checkout-3-ussd-mvola | 0 | 0 | 0 | 0 |
| checkout-3-ussd-orange | 0 | 0 | 0 | 0 |
| checkout-4-reference | 0 | 0 | 0 | 0 |
| statut-paiement | 0 | 0 | 0 | 0 |
| fiche-produit | 0 | 0 | 0 | 0 |
| compte | 0 | 0 | 0 | 0 |
| suivi | 0 | 0 | 0 | 0 |
| fidelite | 0 | 0 | 0 | 0 |
| **total** | **0** | **1** | **0** | **1** |

**TOTAL : 2 échecs** (101 → 30 → 14 → 6 → 2). Il ne reste que l'indice « Vérifiez que cet ID… »
(2 × 3,87:1, sombre) → **T2.8**. Les 4 échecs destructifs et les 8 de l'USSD sont tombés.

### Phase 2 — clôture (2026-10-20)

**Objectif atteint : 0 échec** sur les 12 pages auditées, dans les 4 combinaisons (390 px / 1440 px × clair /
sombre). Les captures de référence sont dans `audit-shots/` (hors dépôt, régénérables avec
`node frontend/scripts/shots-phase2.mjs`).

| Page | 390 px clair | 390 px sombre | 1440 px clair | 1440 px sombre |
|---|---|---|---|---|
| accueil | 0 | 0 | 0 | 0 |
| catalogue | 0 | 0 | 0 | 0 |
| checkout-1-verification-initiale | 0 | 0 | 0 | 0 |
| checkout-1-verification | 0 | 0 | 0 | 0 |
| checkout-2-methode | 0 | 0 | 0 | 0 |
| checkout-3-ussd-mvola | 0 | 0 | 0 | 0 |
| checkout-3-ussd-orange | 0 | 0 | 0 | 0 |
| checkout-4-reference | 0 | 0 | 0 | 0 |
| statut-paiement | 0 | 0 | 0 | 0 |
| fiche-produit | 0 | 0 | 0 | 0 |
| compte | 0 | 0 | 0 | 0 |
| suivi | 0 | 0 | 0 | 0 |
| fidelite | 0 | 0 | 0 | 0 |
| **total** | **0** | **0** | **0** | **0** |

Trajectoire : **101 → 30 (T2.1) → 14 (T2.2) → 6 (T2.6) → 2 (T2.7) → 0 (T2.8, T2.9, T2.10)**.

**Ce que l'audit ne voit pas** — il ne mesure que le **texte** des **pages listées dans `PAGES`** :

| Élément | Mesure | Tâche |
|---|---|---|
| Les **icônes** (WCAG 1.4.11, 3:1) | l'icône de statut était à 2,79:1 | **T2.10** (corrigé) |
| Les **bordures** (3:1) | jamais mesurées | limite documentée |
| Les **pages admin** | jamais mesurées | **T2.12** |
| La **page /chat** | hors `PAGES` | la pastille « non lus » (1,08:1) → **T5.7** |
| L'**opacité d'un élément** | l'audit compose l'alpha de la *couleur*, pas l'`opacity` de l'élément | limite documentée (T2.5 traite le cas à part) |
| Les **fondus d'opacité de survol** | idem : `hover:opacity-90` n'est pas composé | mesuré à la main dans les rapports |
| Les **états désactivés** | exclus (exclusion n° 7, WCAG 1.4.3) | T2.5, seuil ≥ 3:1 vérifié par un test |
| Les **pages non listées** (`/privacy`, `/legal`, `/support`, `/events`, `/chat`…) | jamais mesurées | à voir |

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

**T2.3 White logo plate** — **DONE (`694ae49`, 2026-10-20)**
- File: `GameButton.js` only.
- Problem: the disc's background was a hardcoded `#FFFFFF`, animated by framer-motion (`animate={{ backgroundColor: "#FFFFFF" }}`) — a raw white disc on the black nav, in **both** themes (the nav slab is dark in both).
- There is **no logo file** in this component: the glyph is the lucide `Gamepad2` vector (`fill="none" stroke="currentColor"`, transparent), and the real game logos (API images, `GameLogo` in `Home.js`) sit on a **neon** disc (`bg-primary`) — never on white.
- Do: the disc becomes the brand **neon** with an **ink** border (like the nav's active pill), the glyph stays ink, and **no hardcoded colour remains in the file** (the framer-motion background animation is removed; the soft shadow becomes theme-relative and is dropped in dark mode, where a dark shadow on the dark nav was invisible anyway).
- Validate: 390 px, light and dark, cart bar visible. Touch target **60 × 60** kept, translated `aria-label` (« Jeux – PUBG Mobile ») kept, **no overlap** with the cart bar (12 px of clearance) nor with the nav, ink glyph on neon = **16,7:1**, and the nav's active neon pill is **191 px** away — the two neons cannot be confused. `yarn build`, `yarn test:ci` green, contrast audit unchanged at **14 failures**.

**T2.4 Automated contrast audit** — **DONE (`7bc393a`, `68416e0`, `7da61e1`)**
- New file: `frontend/scripts/audit-contrast.mjs` (`playwright-core` devDependency, Chromium via `CHROMIUM_PATH`).
- Do: load the key pages (home, catalogue, checkout, product, account, order tracking, loyalty) at 390 px and
  1440 px, in light and dark themes; list text elements below 4.5:1 (3:1 for large text); exit non-zero if any
  are found.
- Validate: 0 failures across the 4 combinations. The command is `yarn audit:contrast` (not wired into
  `build` / `test` / `prestart`).

**T2.5 Disabled « Vérifier l'ID » button** — **DONE (`f584111`, `8525054`, `87650b1`, 2026-10-20)**
- Files: `components/store/PubgIdVerify.js` (checkout PUBG), `components/store/checkout/IdentityFieldsVerify.js` (the **generic twin**, used by `StepVerify.js:77` for games with dynamic fields), and the two test files.
- Problem: the disabled state is `disabled:opacity-50` — cream at 50 % opacity on the ink button, 1.12:1 as
  painted. The audit cannot see it (element opacity is not composited), so it is measured apart.
- Do: no native `disabled` attribute any more — **`aria-disabled`** (the button stays focusable, so the
  customer can reach it and understand it is unavailable) + **`aria-busy`**, and **the handler makes the
  guard** (`if (inert) return;`: no verification, no submission). Inactive state: muted background `bg-muted`
  + theme foreground (**16:1 in light, 9,6:1 in dark**), `cursor-not-allowed`, **no hover and no press
  effect**. During a verification the button keeps its active surface (the « en cours » stays readable) but
  stays inert: no double request.
- The checkout has **no `<form>`** (the container is a `<div data-testid="checkout-form">`) and the button is
  a `type="button"`: Enter in the ID field submits nothing. The test asserts both.
- Validate: 8 tests (`PubgIdVerify.test.js` 6 + `IdentityFieldsVerify.test.js` 2) — click and Enter on the
  inactive button trigger **no request and no state change**; Enter in the ID field triggers **no request and
  no submission**; the loading state is inert with `aria-busy` and no double request; the active state still
  verifies; the inactive contrast is ≥ 3:1 computed from the **token values read in `index.css`** (by theme
  block, order-independent). **The tests are discriminating: on the previous implementation 6 of the 8 fail**
  (the 2 that pass are the unchanged « active » cases). `yarn build`, `yarn test:ci` (7 suites / 31 tests)
  green, contrast audit unchanged at **14 failures**.
- **Suggestion de la revue (2026-10-20) :** le survol de la variante **non-checkout** (page fidélité) a
  changé — l'ancien `hover:bg-slate-700` (brut, non remappé, donc un bleu-gris sur un bouton noir) est
  devenu `hover:opacity-90`, comme la variante checkout. Le résultat est plus cohérent, mais c'est un
  changement d'état de survol non annoncé : à acter ici ou à revenir à `hover:bg-slate-700`.
- Note (corrigée le 2026-10-20 après la revue) : le message « ID invalide » **reste affiché** quand l'API
  répond `{ valid: false }` (identifiant inconnu) — `PubgIdVerify.js:38` et `IdentityFieldsVerify.js:66`.
  Ce qui a changé, c'est le contrôle de format côté client : il est devenu **inatteignable** (la garde
  `inert` couvre la même condition), donc un identifiant mal saisi ne déclenche plus de requête **et**
  n'affiche plus de message. Le chemin auto-déclenché (effet `autoTrigger`) pouvait, lui, afficher le
  message avant la garde ; il ne le peut plus. La ligne morte a été supprimée en **T2.13** ; l'affichage est
  conservé. Le texte d'aide « 9 à 13 chiffres » est prévu en Phase 4 (**T4.6**).
- Validate: the button is `aria-disabled`, the **click** and the **Enter key** trigger nothing (no request, no
  state change), and the disabled state is at ≥ 3:1.

**T2.6 « Payer via USSD » button — white on the brand green** — **DONE (`d7f3207`, 2026-10-20)**
- File: `components/store/checkout/StepPay.js` only (the `<a data-testid="ussd-button">`).
- Problem: `text-white` on `var(--mvola)` (`#00A651`) = **3,19:1**, and on `var(--orange)` (`#FF7900`) = **2,63:1**. 8 failures, on the MVola **and** the Orange screen, in the 4 combinations.
- Do: **the brand colour does not move** — the text becomes ink (the Tailwind `ink` token): **5,91:1** on the green, **7,18:1** on the orange. The lucide icon follows `currentColor`, so it turns ink too. The focus ring becomes `outline-ink` (3 px): the global neon ring was invisible on both colours (2,67:1 and 2,2:1).
- Validate: 390 px, MVola and Orange, light and dark — text 5,91 / 7,18, icon ink, hover ≈ 5,0 / 6,0 (the element opacity is not composed by the measurement), focus: ink ring, `:focus-visible` true, 5,91 / 7,18 against the button and 18:1 against the card. `yarn build`, `yarn test:ci` (7 suites / 31 tests) green, contrast audit **14 → 6**, no new failure.

### T2.6 — inventaire des autres usages blanc / couleur de marque (2026-10-20)

L'audit ne voit que ce qu'il mesure : **le texte**, sur les pages listées. Les usages ci-dessous
**n'apparaissent donc pas** dans la mesure, mais ont été mesurés à la main dans le navigateur.

| Fichier | Élément | Couleurs | Contraste mesuré | Visible par l'audit ? | Tâche |
|---|---|---|---|---|---|
| `PaymentFlow.js:191` | puce de choix du fournisseur (sélectionnée) | blanc sur la couleur de marque | **3,19:1** (MVola) · **2,63:1** (Orange) | non (l'audit ne clique pas la puce) | **T2.9** |
| `PaymentMethodPicker.js:61,77` | même puce + bouton de méthode | blanc sur la couleur de marque | 3,19 / 2,63 | — | **code mort** (jamais importé) → T5.7 |
| `PaymentStatus.js:42` | icône du disque « en attente » | la couleur de marque sur son disque à 12 % | **2,79:1** (clair) · 3,43:1 (sombre) | non (l'auditeur ne mesure pas les icônes) | **T2.10** |
| `AdminDashboard.js:51` | badge « MVola n » | vert sur fond de carte | **3,19:1** (clair) · 3,95:1 (sombre) | non (pages admin) | **T2.10** |
| `AdminDashboard.js:52` | badge « Orange n » | orange sur fond de carte | **2,63:1** (clair) · 4,81:1 (sombre) | non (pages admin) | **T2.10** |
| `ChatWorkspace.js:53` | pastille « non lus » | blanc sur néon | **1,08:1** | non (page /chat hors `PAGES`) | **T2.10** |
| `OrderTrack.js:136` | bouton « Reprendre le paiement » | encre sur la couleur de marque | 5,91 / 7,18 | non | ✓ conforme |

> Deux bugs au passage, relevés pendant la mesure :
> - `AdminDashboard.js:51-52` : `bg-[var(--mvola)]/10` **ne rend rien** — Tailwind ne peut pas appliquer un
>   modificateur d'alpha à une variable qui contient un hex (`rgb(#00A651 / .1)` est invalide), donc le fond
>   teinté prévu est absent (le fond mesuré est `rgba(0,0,0,0)`).
> - `ChatWorkspace.js:53` : blanc sur néon est un défaut de la même famille que T2.2 (le néon ne porte que de
>   l'encre, ou alors il faut un fond sombre sous le texte).

**T2.9 — La puce de choix du fournisseur** — **DONE (`b3079c2`, 2026-10-20)**
- File: `components/store/PaymentFlow.js` (~l.191, `ManualPanel`).
- Fix: texte **encre** sur la couleur de marque inchangée, comme T2.6 → **5,91:1** sur le vert MVola,
  **7,18:1** sur l'orange (étaient 3,19 et 2,63). La puce **non** sélectionnée (`bg-card` +
  `muted-foreground`, 5,86:1) est déjà conforme et n'est pas touchée.

**T2.10 — L'icône de statut de paiement** — **DONE (`f36db2a`, 2026-10-20)**
- File: `components/store/PaymentStatus.js` (~l.60).
- Problem: the icon wore the provider colour on its own 12 %-tinted disc → **2,79:1** in light (the
  non-text bar asks 3:1).
- Fix: the icon takes the **theme foreground**, the disc keeps the provider tint (the MVola/Orange identity
  stays readable). Measured: **17,3:1** in light, **9,77:1** in dark.

**T2.10 (suite) — découpée le 2026-10-20**
- **Les badges admin** (`pages/admin/AdminDashboard.js:51-52`, `text-[var(--mvola)]` / `text-[var(--orange)]` sur
  fond de carte : **3,19:1** en clair, 3,95 et 4,81 en sombre) → **T2.12**, avec la tâche admin. Au passage :
  `bg-[var(--mvola)]/10` **ne rend rien** (Tailwind ne peut pas appliquer un modificateur d'alpha à une variable
  qui contient un hex) → le fond teinté prévu est absent.
- **La pastille « non lus » du chat** (`components/chat/ChatWorkspace.js:53`, `bg-primary text-white` =
  **1,08:1**) → **T5.7** (ChatWorkspace est monté sur /chat : ce n'est pas du code mort, mais la correction est
  routée vers T5.7).

**T2.11 — Les coins arrondis des popups du checkout** — **DONE (`2c8822c`, `603f2fd`, 2026-10-20)**
- Cible : des coins cohérents avec la carte produit (`rounded-[28px]`, mesuré **28 px** sur les 4 coins).
- Les 3 popups du parcours **client**, et leur **rayon calculé** (mesuré dans le navigateur, pas lu dans les
  classes) :

  | Popup | Fichier | Type | Rayon calculé 390 px | Rayon calculé 1440 px |
  |---|---|---|---|---|
  | Tiroir panier | `components/store/CartDrawer.js:96` | `Sheet` (latéral droit, pleine hauteur) | **0 px** (4 coins) | **0 px** (4 coins) |
  | Dialogue « pack évolutif » | `pages/PackEvolutif.js:97` | `Dialog` (fenêtre centrée) | **14 px** (4 coins) | **14 px** (4 coins) |
  | Sélecteur de jeu | `components/layout/GameSelector.js:51` | panneau artisanal | **28 px** ✓ | (déclencheur `md:hidden`, non atteignable) |

  - Les 14 px du dialogue viennent du **remappage** : `rounded-3xl` → `border-radius: 14px !important`
    (`index.css:178`). La classe à utiliser est donc `rounded-[28px]` (absente du remappage) — et
    `sm:rounded-[28px]` en plus, car `ui/dialog.jsx:34` impose `sm:rounded-lg` (12 px) qui l'emporterait
    sur la classe de base à ≥ 640 px.
  - `ui/dialog.jsx` et `ui/sheet.jsx` **ne sont pas modifiés** (l'unification de tous les popups est en T5.2) :
    le rayon se règle dans le `className` du composant appelant. Aucun des deux n'impose un rayon qui l'empêche.
  - Le contenu doit être rogné par les coins (`overflow-hidden`) **sans** couper l'anneau de focus, la croix de
    fermeture ni l'ombre — mesuré : la croix est à 16 px (tiroir) / 17 px (dialogue) du bord, son anneau de
    focus s'étend à 4 px, donc il reste à l'intérieur d'un rayon de 28 px ; l'ombre n'est jamais rognée par
    l'`overflow` de l'élément lui-même.
  - **Appliqué aux deux** : le dialogue (« pack évolutif ») passe à **28 px sur les 4 coins**, le tiroir panier
    à **28 px sur les 2 coins gauches** (c'est une feuille latérale droite : les coins droits sont contre
    l'écran). Le sélecteur de jeu est **inchangé** (déjà 28 px).

**T2.11 — ce qui a été mesuré (avant / après), et la rustine `!`**

| Popup | Fichier | Coin | Avant (390 / 1440) | Après (390 / 1440) |
|---|---|---|---|---|
| Dialogue évo | `pages/PackEvolutif.js:97` | 4 coins | 14 px / 14 px | **28 px / 28 px** |
| Tiroir panier | `components/store/CartDrawer.js:96` | haut-gauche | 0 px / 0 px | **28 px / 28 px** |
| Tiroir panier | idem | bas-gauche | 0 px / 0 px | **28 px / 28 px** |
| Tiroir panier | idem | haut-droit / bas-droit | 0 px / 0 px | **0 px / 0 px** (inchangés) |

**La rustine `!` est temporaire.** `ui/dialog.jsx:34` impose `sm:rounded-lg` (12 px) sur toutes les
fenêtres, et `index.css:178` remappe `rounded-3xl` en 14 px `!important`. Il faut donc
`!rounded-[28px]` (la classe n'est pas remappée, le `!` passe devant `sm:rounded-lg`). **À retirer en T5.2**,
quand les rayons seront unifiés — d'ici là, `ui/dialog.jsx` et `ui/sheet.jsx` ne sont **pas** modifiés.

**`overflow-hidden` : ce qui a été vérifié (rects avant / après)**
- **Défilement interne du tiroir** : la liste garde `overflow-y: auto` ; avec 12 articles,
  `scrollHeight 1052` > `clientHeight 591` → le défilement fonctionne toujours (le conteneur est rogné,
  pas la liste).
- **Ombre** : inchangée (`rgba(0,0,0,.1) 0 10px 15px -3px` + `rgba(0,0,0,.1) 0 4px 6px -4px`) — l'overflow d'un
  élément ne rogne jamais sa propre ombre.
- **Croix de fermeture** : tiroir à 16 px du bord (coin droit droit → jamais rogné), dialogue à 17 px
  (le coin arrondi de 28 px a un centre à 28 px : le point de la croix est à 15,6 px de ce centre, donc
  à l'intérieur).
- **Bouton « Commander »** : 25 px du bord gauche, 8 px du bas → visible, non rogné.
- **Contenu du dialogue** : 25 px des bords → non rogné.
- **Rects des conteneurs** : inchangés (tiroir `390×844` en mobile, `448×900` en 1440 px ; dialogue
  `390×350` en mobile, `448×350` en 1440 px).

Captures dans `audit-shots/` : `t211-avant-*` et `t211-apres-*` (1 article, comparaison directe) +
`t211-apres-12articles-*` (défilement interne).

**T2.13 — Corrections de revue** — **DONE (`af61cf3`, `d80aa3f`, `b201ebe`, `dd09da6`, 2026-10-20)**

Revue de la branche `phase-2-sombre` (verdict : *Request Changes*, aucun bloquant). Un commit par point :

1. **`af61cf3`** — `components/layout/GameSelector.js:70` : `ring-offset-[hsl(var(--foreground))]` →
   `ring-offset-ink`. L'offset suivait l'ancien fond `bg-foreground` du panneau ; T2.2 l'a rendu noir
   (`bg-ink`), donc l'offset devenait crème en sombre (halo crème autour de l'anneau néon sur fond noir).
   Mesure (box-shadow calculé) : offset `rgb(17,17,17)` en clair **et** en sombre, identique au fond du
   panneau ; avant : `rgb(10,10,10)` en clair et `rgb(243,242,237)` en sombre.
2. **`d80aa3f`** — `frontend/scripts/shots-phase2.mjs` : les 3 chemins absolus personnels sont remplacés
   par `process.env.CHROMIUM_PATH` (message d'erreur explicite + sortie 1 si absent ou invalide, comme
   `audit-contrast.mjs`) et des chemins relatifs au script (`fileURLToPath(new URL(...))`).
3. **`b201ebe`** — `PubgIdVerify.js` / `IdentityFieldsVerify.js` : suppression de la **seule** ligne morte
   (le contrôle de format côté client, rendu inatteignable par la garde `inert`). L'**affichage** du message
   « ID invalide » est **conservé** : le statut est toujours posé par la réponse de l'API (`valid: false`,
   identifiant inconnu) — voir la note corrigée de T2.5.
4. **`dd09da6`** — l'indice « Vérifiez que cet ID… » passe de `text-foreground/75` à
   `text-foreground/80` : 10,94:1 en clair et **5,46:1** en sombre (au lieu de 9,08 et 5,03) — la marge
   sur le seuil de 4,5 passe de 0,24 à 0,96.

**T2.12 — Les pages admin** (hors audit)
- `PAGES` ne contient que les pages client : `/admin` et ses sous-pages ne sont **ni mesurées ni corrigées**.
- Éléments relevés : les 5 tuiles de stats colorées du tableau de bord (`text-primary`, `text-amber-600`,
  `text-emerald-600`, `text-violet-600`), les badges MVola / Orange (T2.10), les `text-rose-600` / `hover:text-rose-600`
  des boutons d'action, `bg-rose-500 text-white` des pastilles de ton.
- Do: ajouter les pages admin à `PAGES` (avec un rôle administrateur dans le mock) puis corriger les familles
  qui fuient du remappage.
- Validate: l'audit passe de 0 à N sur les pages admin, puis N → 0.

**T2.7 Destructive links in dark mode** — **DONE (`8728d7b`, 2026-10-20)**
- Files: `index.css` **only** (the `.dark` block) — the 19 usages all go through the tokens, no component changes.
- Problem: in dark mode `--destructive` = `6 70% 50%` → « Déconnexion » **3,06:1**, « Supprimer mon compte » **2,73:1** on `#2B2B2B` / `#333333`.
- The same token is used **twice**: as a background (button, badge, icon disc — the label sits on the red) and as a text colour. One value cannot serve both, so **both tokens move together** in `.dark`:
  - `--destructive: 6 90% 70%` (`#F77B6E`) — was `6 70% 50%`
  - `--destructive-foreground: 0 0% 4%` (ink) — was inherited white
  - The light theme is **not touched at all**.
- Measured (390 px, `/compte`, dark):

  | Element | Colours calculées | Contraste |
  |---|---|---|
  | « Déconnexion » (12 px) | `rgb(247,123,110)` on `rgb(43,43,43)` | **5,40:1** (was 3,06) |
  | … its hover | bg `rgb(247,123,110)`, text `rgb(10,10,10)` | **7,55:1** |
  | « Supprimer mon compte » (16 px) | `rgb(247,123,110)` on `rgb(51,51,51)` | **4,82:1** (was 2,73) |
  | the icon disc (44×44) | bg `rgb(247,123,110)`, icon `rgb(10,10,10)` | **7,55:1** |
  | the red button (189×36) | bg `rgb(247,123,110)`, text `rgb(10,10,10)` | **7,55:1** |
  | … its hover (90 % opacity over the card) | bg `rgb(227,116,104)`, text `rgb(32,21,19)` | **5,93:1** |

  Light theme (unchanged): 4,77 / 5,35 / 5,35:1. The **hover of the red button in light mode was already at 4,06:1** (pre-existing, untouched).
- Validate: `yarn build`, `yarn test:ci` (7 suites / 31 tests), contrast audit **6 → 2**, no new failure. Captures in `/tmp/opencode/shots/t27-*.png` (the visual judgement is for a human: the coral `#F77B6E` replaces `#D93826` on the dark theme — **if that reads too soft, the fallback is two tokens**: one for the red-as-text and one for the red-as-background).
- Out of scope, listed for **T5.4**: `toast.jsx:62` uses hardcoded reds (`text-red-300`, `group-[.destructive]:hover:text-red-50`, `focus:ring-red-400`, `focus:ring-offset-red-600`) that do not follow the token; same family as `text-red-600` / `text-rose-600` in the forms and the admin.

**T2.8 « Vérifiez que cet ID… » on the tinted neon panel** — **DONE (`5828422`, 2026-10-20)**
- Files: `components/store/PubgIdVerify.js` (the `pubg-verify-confirm` paragraph) and `components/store/checkout/IdentityFieldsVerify.js` (the same hint on the same panel, in the generic multi-game component).
- Fix: `text-muted-foreground` → **`text-foreground/75`** (the theme foreground, as the subtitles of the ink panels already do at /70, /75, /85). Measured: **4,74:1** in dark (was 3,87), ~9:1 in light. The visual hierarchy is kept (12 px against the 18 px bold title).
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

**T3.7 Focus ring lisible sur les deux surfaces** (ajoutée le 2026-10-20, issue de la revue)
- Problem: `index.css:94` pose `outline: 2px solid hsl(var(--primary))` pour **tous** les éléments
  `:focus-visible`. Le néon sur une surface claire est à **1,03:1** : l'anneau de focus est invisible en mode
  clair pour un utilisateur clavier. Concretement, le bouton « Vérifier l'ID » inactif (`bg-muted` en clair)
  hérite de cet anneau.
- Do: un jeton d'anneau lisible (≥ 3:1) sur les deux types de surface, et l'appliquer à l'anneau global.
  Les surfaces d'encre (néon) et les surfaces claires ont chacune besoin d'une couleur d'anneau différente :
  prévoir un jeton par surface, ou un anneau à double contraste (couleur + liseré).
- Validate : l'anneau de focus est mesuré ≥ 3:1 sur le fond crème **et** sur le fond encre, dans les deux
  thèmes ; le focus clavier est visible sur le bouton de vérification inactif en mode clair.
- Attention : `StepPay.js` et `ProductCard.js` posent déjà un `outline-ink` local (l'anneau global ne leur
  suffit pas) — à conserver.

**T3.6 Local fonts** — `public/index.html` (~l.30) loads Google Fonts. Install `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/onest`, import them, drop the Google link, add a `size-adjust` fallback. Check that `public/sw.js` caches the fonts.

### Phase 4 — Content and states (1–2 days)

**T4.1 Missing translations** — `ProductCard.js` (~l.27-29, 58-59, 63, 110, 113, 116): "Prime+", "Évolutif", "UC", "mois", "Populaire", "Elite Pack", "Abonnement", "Indisponible", "Retirer du panier", "au panier". FR and EN for every key. **The chat files are out of scope for this task** (`Chat.js`, `ChatWorkspace.js`, `ChatThread.js`, ~28 strings) — the 4 chat files are still hardcoded French, but the floating chat they belong to is not mounted (see T5.7); revisit them only if the chat is actually wired into the app.

**T4.6 Help text for the ID when the button is inactive** (ajoutée le 2026-10-20, issue de la revue)
- Since T2.5/T2.13, a malformed ID makes the button inert: no request, and **no message** (the « ID
  invalid » message is now only shown when the API answers `valid: false`).
- Do: show a helper text under the field — « 9 à 13 chiffres » / « 9 to 13 digits » — when the button is
  inactive because the format is wrong (not while a verification is running). Keys FR + EN via `t()`.
- Files: `components/store/PubgIdVerify.js`, `components/store/checkout/IdentityFieldsVerify.js`,
  `src/i18n/translations.js`.
- Validate: the helper appears for a malformed ID and disappears for a valid one, in FR and EN.

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
- **À traiter dans T5.4** : le survol du bouton rouge en **thème clair** est à **4,06:1** (fond rouge à 90 % d'opacité, texte blanc à 90 %) — un état préexistant, non modifié par T2.7 ; les rouges en dur de `toast.jsx:62` (`text-red-300`, `hover:text-red-50`, `focus:ring-red-400`) ; `text-red-600` / `text-rose-600` dans les formulaires et l'admin ; `bg-[var(--mvola)]/10` qui ne rend rien (un modificateur d'alpha sur une variable hex).

**T5.5 Borders** — the brutalist identity must NOT go everywhere. 2 px ink border only on actionable elements: product cards, primary buttons, one or two key panels. Other surfaces keep thin but **visible** rules (≥ 3:1). Replace the `border-foreground` remap (~15% opacity) with an explicit `--rule` token.

**T5.6 Hardcoded colours** — the 71 `text-[#0A0A0A]` → `text-primary-foreground`. Unify the 5 dark greys. Align the theme colour between `ThemeToggle.js` (~l.13) and `public/index.html` (~l.14).

**T5.7 Delete the confirmed dead components** — `components/chat/FloatingChat.js` and `components/chat/ChatLink.js`.
- **Ajouté le 2026-10-20 (revue) : `components/ui/badge.jsx`, `components/ui/alert.jsx` et
  `components/ui/toast.jsx` sont eux aussi du code mort** — aucun import dans `src/` (`grep -rn
  "components/ui/badge\|components/ui/alert\"" src/` → vide) ; l'app monte le Toaster **sonner**
  (`App.js:3,94`), pas `components/ui/toaster.jsx`, donc `ui/toast.jsx` n'est jamais rendu. Conséquence
  relevée pendant la revue de T2.7 : leurs variantes destructives utilisent l'ancien rouge
  (`hover:bg-destructive/80`, `border-destructive/50`) et ne sont donc pas concernées par le déplacement des
  jetons destructifs de `.dark`. **Confirmed dead (2026-10-20):** each is referenced only by its own definition, there is no `import()` and no `React.lazy` anywhere in `src/`, the `/chat` route renders `pages/Chat.js` → `ChatWorkspace` and `/admin/messages` → `pages/admin/AdminChat.js` → `ChatWorkspace`, and the built bundle contains 0 occurrences of their strings (CRA tree-shook them out). **Do not delete them before this task is picked up** — until then they stay untouched.

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
