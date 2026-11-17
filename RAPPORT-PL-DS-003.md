PL-DS-003 — maquette design system « refonte fidèle Slush » dans `maquettes/` uniquement. Aucun fichier du site modifié, aucun commit. Dossier ouvrable en double-clic, hors-ligne (libs et polices vendues localement).

Livrables : `design-system.css` (179 Ko, généré — ne pas éditer : `python3 tools/build_design_system.py`) = CSS Slush copié VERBATIM (webflow reset + site design, @font-face propriétaires exclus) + les 3 blocs `<style>` inline de la référence (scaling Osmo, easings/hovers, Lenis) + couche marque (mg-brand.css) + composants (mg-components.css). `design-system.js` (28 Ko) = port fidèle du bundle Osmo sans jQuery/Barba : CustomEase `slush`/`slush-bounce` (paths exacts), defaults ease slush .525, Lenis lerp .12, nav pilule (scroll ±300 yPercent, hover desktop / burger mobile rotate 90 + scaleX), curseur quickTo, marquee GSAP lié au scroll, reveals SplitText (chars from:"end", lignes 3D), parallaxe, runPageLoad, logique Magic Game (icônes, slider, toggles) et fallback no-gsap.

Transition 3D en deux moitiés (Barba inutilisable en file://) : au clic sur un lien interne, la page s'envole (wrapper clipPath, 3 volets aux couleurs shuffle) puis navigation ; au chargement, la page arrive en 3D (z -100vw → 0, volets 1.875 s) avec runPageLoad au onStart. Durées D=1.25 / C=0.8, U=45 — valeurs de la référence.

Pages : `00-design-system.html` (couleurs, typo, boutons, cartes, slider, icônes), `01-accueil.html` (hero .h-d géant + hero-lime, marquee data-marquee-scroll-speed="10", grille packs), `02-page-jeu.html` (h-l géant, onglets UC/Prime/Prime+/Évolutif, buy-bar, bottom-nav), `03-checkout.html` (3 écrans sans stepper, feuilles preuve/annulation, marchand en placeholders ···), `icons.html` (48 icônes + Rejouer). Iconothèque et mapping icône→pack inchangés (48 icônes extraites de Small_Icons.svg, sprite inliné ~390 Ko, `tools/build_pages.py`).

Dépendances vendues : `vendor/` (gsap 3.12.7, ScrollTrigger, CustomEase, SplitText 3.12.5 du miroir de la référence, lenis 1.1.14) et `fonts/` (Onest + Bricolage Grotesque variables, subsets latin/latin-ext) — plus aucun CDN ni Google Fonts : la maquette marche sans réseau et les captures sont déterministes.

Corrections de débogage : `id="navContainer"` sur les navs ; scope de runPageLoad = `[data-hero-content]` sinon première section (gardes sur cibles vides) ; anti-flash réduit à la règle Slush exacte (`html.has-js [data-hero-content]{opacity:0}` — les anciennes règles cachaient le h1 définitivement) ; fond crème (`body` Slush est sur --color--dark, remappé en --color--light) ; bloc slider de 00 enveloppé dans un conteneur positionné (`.img-slider` est absolute inset:0 chez Slush — à nu il couvrait toute la page) ; scrollY capturé avant scrollTo(0,0) dans la transition sortante.

Captures : mode `?capture` dans design-system.js — pose les états finaux SANS tweens, car sous --virtual-time-budget rAF ne tourne pas (2 frames en 12 s mesurées) : GSAP saute à la frame rare et les captures tombaient en plein volet. Captures 390 et 1440 validées sur les 5 pages dans /tmp/opencode/ds/ (typo géante qui déborde = comportement Slush fidèle : ce SplitText ne produit pas de wrappers de mots, les coupures « RECHA/RGEZ » sont celles de la référence).

Écarts assumés (reportés au fil de l'eau) : Barba → transition en 2 moitiés ; Lottie → SVG animés maison ; fonts propriétaires → Google Fonts vendues ; initSlideShows/initTabSystem/initFooter (jQuery) écartés ; « Download CTA » détecteur d'OS sans objet.

Écarts vs site : maquette hors production (pas d'API, pas de tracking, pastilles paiements en texte), prix/ID en exemple, composants Slush adaptés à la palette crème/encre.

Stop ici — à ouvrir et valider avant toute implémentation React. Aucun commit effectué. (En attente séparé : retours PL-005-FE-02 sur `fix/pl-005-fe-02-design`, commit 3c935cf non poussé.)

---

## Tour 2 — retours design (2026-11-15)

**Accueil à panneaux (image 1)** : sur `01` uniquement (`body[data-page="home"]`), le fond de page est l'ENCRE et chaque section (`.page-hero`, `.section`) est une surface crème `border-radius:2.5em` posée dessus, `margin-inline/bottom:.5em` — l'encre se voit dans l'interstice. Le bandeau marquee reste encre (ticker-note en crème 55 %).

**Marquee CTA** : la police Onest est bien plus large que la Lateral condensée de Slush — `marquee-cta-h` ramené à 7em ≤767 et 5.5em ≤479 (18.75em débordait l'écran 390) ; `.marquee-advanced` forcé à `width:100%` (le 100vw Slush suppose un panneau pleine largeur). Style du bouton inchangé.

**Footer (image 2)** : structure Slush verbatim — `.footer-row-wrap` > `.footer-row` flex > `.footer-social-grid` (cartes crème : Facebook, WhatsApp, « Téléphone · 038 39 056 92 » en carte `is--wide`) + `.footer-row-col.is--last` VERT (heading .h-m + link-list p-l + © + link-list p-m). ≤767 : tout s'empile (règles verbatim). Pas de logos tiers ni de handle inventé. Deux corrections de layout : `.footer-social-grid{flex:1;min-width:0}` (le flex Slush `align-items:flex-start` laissait la grille déborder : 399px dans 366px) et pistes `repeat(2,minmax(0,1fr))` (le 1fr Slush a un minimum auto que les libellés longs gonflaient). Le `.text-link-underline` (fill `currentColor` pleine surface) n'est PAS utilisé dans les cartes — dans la référence Slush non plus ; l'effet des cartes sociales est le `scale(.92)` au survol (verbatim).

**Responsive / marges** : `.reviews-grid` 1 colonne mobile / 3 ≥768 ; inline `padding-top:0` retirés des sections ; `.h-d{padding-bottom:.22em}` (le bloc lime inline-block débordait sous la dernière ligne, `line-height:.76`) ; `body[data-page="home"] .footer{padding-bottom:6em}` ≤991 pour le bottom-nav fixe.

**Cartes produit (02)** : icône produit `.product-card__icon-slot` masquée ≤767 (retour design) ; bouton « + » `.product-card__add` animé façon Slush : 2.8em (≥44px), `transition .5s var(--elastic-ease-out)`, hover `scale(1.12) rotate(90deg)`, active `scale(.92)`, neutralisé sous `prefers-reduced-motion`.

**Build autonomisé** : les sources /tmp du CSS Slush ont disparu — base verbatim figée dans `tools/design-system-base.css` (148,9 Ko) et `build_design_system.py` réécrit (plus de dépendance /tmp). Vérifié : aucun débordement horizontal (`scrollWidth ≤ innerWidth`) sur 00/01/02/03 à 390 et 1440 ; captures 390 + 1440 (hero, footer, cartes) conformes.

## Tour 3 — retours design (2026-11-15)

**Footer calé sur les proportions Slush** : les cartes sociales portaient `p-l` (1,5em) — chez Slush elles sont en 1em, ce qui gonflait `height:13.6em` de 50 % (cartes ~326px vs ~218px attendus). Retrait du `p-l` ; la grille sociale est `flex:none` (taille contenu) et la colonne verte `flex:1` ≥768 (son `width:100%` verbatim dévorait la ligne et écrasait les cartes en rectangles). Desktop : cartes compactes à gauche, colonne verte à droite — image 2.

**Marquee CTA** : le mot géant du DOS (`__back.is--download::before`, 17.5em/10em fixes) gonflait le bouton à 661px pour 390px d'écran — calé sur la même échelle que la face, `13.5vw` (les deux faces → bouton ≈ 355px, « RECHARGER » lisible en entier). Style demandé « comme les boutons mais bordures fixes » : pilules à fond transparent sur le bandeau encre, liseré crème fixe, texte crème ; le survol bascule sur le dos coloré géant (mécanique `button-main` conservée). Le ticker garde son défilement continu GSAP (figé sous `prefers-reduced-motion`).

**FAQ (nouvelle section `#faq`)** : accordéon 4 questions (paiements, vérification ID, délai, support) placée entre « Choisissez votre jeu » et le footer. Gabarit trust-card (cartes bordées radius 1.4em), boutons pleine largeur ≥44px, `data-toggle` (déjà porté dans design-system.js) + `aria-expanded`/`aria-controls`, « + » qui pivote en « × » (`elastic-ease-out`, neutralisé sous reduced-motion). Contenu = faits déjà présents sur la page, rien d'inventé (téléphone 038 39 056 92 = donnée existante).

## Tour 4 — carte produit : polish Slush + simulation panier (2026-11-15)

**Style inchangé, aucune icône ajoutée** : la carte garde sa surface crème, sa bordure, son radius 28px, sa pilule de prix blanche et son CTA encre. Le seul changement visuel est un détail de mouvement : le grand chiffre glisse de .18em vers la droite au survol (rebond élastique, neutralisé reduced-motion).

**Simulation « ajouté au panier » (02-page-jeu)** : au clic sur le « + », le bouton passe en néon et le « + » se change en coche (deux SVG empilés en `grid-area:1/1`, crossfade + rotation), la pilule de prix rebondit, et un point volant néon rejoint la surface panier. Compteur et total réels, calculés depuis le prix affiché de chaque carte :
- desktop ≥992 : pastille flottante en bas à droite (même style que la barre d'achat — pilule encre floue, compte en néon, total, lien vers checkout) qui apparaît au premier ajout ;
- mobile : la barre d'achat existante est mise à jour (total + « N article(s) dans le panier »), la pastille y est masquée ;
- annonce aria-live (« 325 UC ajouté — 2 articles, 26 000 Ar ») ; reduced-motion : pas de vol, retours d'état conservés.
Testé au clic sur 390 et 1440 (compteur, total, coche, barre, pastille) ; anti-débordement OK sur les 6 captures.

## Tour 5 — hero de la page jeu (2026-11-15)

**Icône du hero retirée** : le bloc `.game-hero__logo` (manette sur tuile encre) est supprimé du markup et du CSS — le hero ne montre que le texte (retour design ; les logos du popup « Changer de jeu » ne sont pas touchés).

**Espacement gros titre → texte** : le `margin-bottom:-.1em` verbatim Slush de `.h-l` est calibré pour la police condensée Lateral (line-height .8) — en Onest il écrasait le sous-titre. Même traitement que le hero racine (`.h-d`) : `margin-bottom:.25em` sur `.game-hero__meta .h-l` (l'espace suit l'échelle du titre) et gap `.7em` dans la meta. Vérifié 390 et 1440. Les autres pages étaient déjà conformes : accueil (`.h-d` + marge 1.2em du texte), page 00 (marges inline .6em), checkout (pas de titre géant). Anti-débordement OK sur les 6 captures.

## Tour 6 — navigation mobile (2026-11-15)

**Bottom-nav : style identique, taille augmentée** (retour design — « ne change pas le style, améliore l'UI et augmente un peu leur taille ») : mêmes couleurs, mêmes états (item inactif crème 65 %, actif néon sur voile `.18`), même pilule encre floue. Changements :
- items plus grands : police `.62em` → `.7em` (10 → 11,2 px), icônes `1.5em` → `1.8em` (centre « Jeu » `1.9em` → `2.2em`), padding et gap augmentés — item mesuré à **56 px ≥ 44 px** (cible tactile) ;
- retour de pression à l'appui (`scale(.93)`, neutralisé sous reduced-motion) ;
- `bottom: max(.75em, env(safe-area-inset-bottom))` pour les écrans avec barre gestuelle.
La nav passe de 58 à 87 px de haut : la barre d'achat (`4.6em → 6.1em`) et le popup « Changer de jeu » (`4.6em → 7.1em`) sont remontés pour garder 11 px d'air au-dessus de la nav (chevauchement de −13/−29 px corrigé). Testé 390 (nav, popup ouvert, barre) ; anti-débordement OK sur les 6 captures.
