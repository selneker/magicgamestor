# Design System — template_to_use.html (Slush App)

**Source** : `template_to_use.html` à la racine du dépôt.
**Provenance** : site `slush.app`, page « Defi » (`data-wf-page="680905cfdc4507383836489b"`, site Webflow `680905cfdc450738383648a6`), dernière publication : 13 nov. 2026.
**CSS** : une feuille partagée externe (Webflow `sui-slush-staging.shared…min.css`, non fournie) + deux blocs `<style>` embarqués (`css-styles` et `css-animations`).
**JS** : jQuery 3.5.1, GSAP 3.12.7 (ScrollTrigger, CustomEase, Draggable, Observer, Flip, InertiaPlugin, SplitText), Lenis 1.1.14, Lottie 5.12.2, Barba 2.9.7.

---

## ⚠️ Champ d'exclusion (à ne pas reporter sur le projet)

Les **animations de transition entre pages** sont documentées ici à titre informatif seulement, elles ne font **pas** partie du design system à reprendre :

- `body[data-barba="wrapper"]`, `main[data-barba="container"][data-barba-namespace="defi"]`, `data-barba-update="nav"`
- les trois éléments `.page-transition-el` placés juste avant `<main>`
- `.is--transitioning { height: 100svh; overflow: hidden; }` et le verrouillage du scroll Lenis pendant la transition
- toute logique Barba de changement de page

Le reste (tailles, palette, typographie, composants, interactions de survol, scroll, lottie) est réutilisable.

---

## 1. Système de tailles fluide (par Osmo, osmo.supply)

Déclaré dans `:root` du bloc `css-styles` :

| Variable | Valeur (desktop) | Rôle |
|---|---|---|
| `--size-unit` | `16` | Unité de base du système |
| `--size-container-ideal` | `1440` | Largeur de référence du conteneur |
| `--size-container-min` | `992px` | Largeur min du conteneur |
| `--size-container-max` | `2250px` | Largeur max du conteneur |
| `--size-container` | `clamp(var(--size-container-min), 100vw, var(--size-container-max))` | Largeur effective du conteneur |
| `--size-font` | `calc(var(--size-container) / (var(--size-container-ideal) / var(--size-unit)))` | Taille de police fluide du `body` |

`body { font-size: var(--size-font); }` → la typographie est **fluide**, calée sur la largeur du viewport via le conteneur.

### Breakpoints (redéfinition de `--size-container-ideal/min/max`)

| Média | Condition | Idéal | Min | Max |
|---|---|---|---|---|
| Tablet | `max-width: 991px` | 1200 | 768px | 991px |
| Mobile paysage | `max-width: 767px` | 550 | 480px | 767px |
| Mobile portrait | `max-width: 479px` | 390 | 320px | 479px |

Autres règles globales : `box-sizing: border-box` sur tous les éléments, `scrollbar` cachée (`::-webkit-scrollbar`, `scrollbar-width: none`), `html { scroll-behavior: initial }`, `-webkit-font-smoothing: antialiased`, `a { color: inherit; text-decoration: none }`, `button { background: transparent; padding: 0 }`, `textarea { resize: none }`, `::selection { background: black; color: white }`.

---

## 2. Palette et thèmes

Les valeurs réelles des couleurs ne sont **pas définies dans ce fichier** (elles vivent dans la feuille Webflow externe partagée). Seuls les noms de tokens et leur usage sont visibles :

- `--color--light` (fond clair)
- `--color--dark` (fond foncé / encre)
- `--color--blue-700`
- `--color--yellow-700`
- `--color--violet-700`
- `--color--green-700`
- `--color--orange-800`
- `--color--purple-800`
- `--color--glacier` (`#DCEEFF` écrit en dur pour `. [data-box-theme="glacier"]`)

### Attributs de thème

| Attribut | Valeurs | Usage |
|---|---|---|
| `data-button-theme` | `light`, `dark` | Thème du bouton : fond clair + texte foncé, ou inversé |
| `data-button-accent` | `white`, `blue`, `yellow`, `violet`, `green`, `orange`, `dark` | Couleur de la face arrière du bouton (effet 3D au survol) |
| `data-box-theme` | `white`, `black`, `blue`, `yellow`, `violet`, `green`, `orange`, `purple`, `glacier` | Fond d'encart (`. [data-box-theme]`, `!important`) ; le noir s'applique aussi avec la classe `.u--bg--black` |

### Règle maison : bordures encre sur TOUTES les boxes et cards

Tout encart, carte ou panneau coloré porte la bordure Slush des boutons :

```css
/* boxes/cards : .125em solid var(--color--dark), comme .button-main */
.trust-card, .review-card, .faq-item, .step-card, .two-col-grid__visual { border: .125em solid var(--color--dark); }
```

- Valeur : `0.125em solid var(--color--dark)` — exactement la bordure de `.button-main[data-button-theme="light"]` (§5) ; jamais un `1px hsl(0 0% 7% / .2)` doux.
- S'applique à **toutes** les surfaces : trust-card, review-card, faq-item, step-card, cartes de jeux (`two-col-grid__visual`), cartes produit, encarts promo/événement.
- Sur une box colorée (`data-box-theme`) la bordure reste encre ; sur un panneau encre (`.panel-black`, bandeau CTA) la bordure est inutile (encre sur encre) — on ne l'ajoute pas.
- Toute nouvelle box/carte créée au projet doit porter cette bordure : c'est la signature « brutaliste » du design system.

### Utilitaires de fond couleur

`u--bg--blue`, `u--bg--violet`, `u--bg--yellow`, `u--bg--orange`, `u--bg--green`, `u--bg--black` (sur `.logo-section__item`, etc.).

---

## 3. Typographie

Classes de texte visibles dans le template :

| Classe | Rôle | Exemple d'usage |
|---|---|---|
| `h-d` | Titre display / héro | `<h1 class="h-d u--rel">` dans le hero |
| `h-l` | Grand titre (h2/h3/h4) | sections, slider, footer |
| `h-s` | Petit texte / corps | paragraphes, légendes, liens footer |
| `h-sm` | Petit titre de section | `h3` de la section « Safety » |
| `p-m` | Paragraphe moyen | copyright footer |
| `p-l` | Lien de liste footer | `.link-list > li > a` |

Utilitaires texte :
- `u--text--italic` — italique (ex. « your Portfolio », « Here to Help »)
- `u--text--caps` — majuscules (copyright)
- `u--weight--bold` — gras
- `u--rel` — `position: relative`

Utilitaires de type responsive (préfixe `xs-` = mobile, `sm-` = small breakpoint) :
- `xs--first`, `xs--last`, `xs--h-ml`, `xs--block`, `xs--full`, `xs--show`
- `sm--hide` (masque sur petit écran, ex. deuxième marquee du footer)
- `mob-vert` (flex en colonne sur mobile)

Polices spécifiques : `Lateral, Impact, sans-serif` pour le texte arrière agrandi des boutons de téléchargement (`.button-main-inner__back.is--download::before`, 17.5em desktop, 10em mobile).

---

## 4. Grille et mise en page

| Classe | Rôle |
|---|---|
| `.container` | Conteneur centré, largeur `--size-container` |
| `.content-wrap-m` / `.content-wrap-sm` | Wrapper de contenu (largeur moyenne / petite) |
| `.content-container` | Bloc de section (+ `padding-vertical-180`, `is--hero`) |
| `.title-row` | Rangée contenant un titre |
| `.flex-row` | Ligne flex (+ `gap--reg`, `gap--small`, `gap-bigger`, `mob-vert`) |
| `.two-col-grid` | Grille deux colonnes (hero : texte ↔ visuel alternés) |
| `.two-col-grid__item` | Item de la grille |
| `.two-col-grid__text` | Partie texte d'un item (h2 + p + CTA) |
| `.two-col-grid__visual` | Partie visuel d'un item (`data-box-theme` colorée) |
| `.two-col-grid__visual-logo` | Logo décoratif SVG derrière le visuel |
| `.logo-section` | Section partenaires (titre + CTA + colonne défilante) |
| `.logo-section__wrapper` / `__scroll` / `__collection` | Marquee vertical de partenaires |
| `.logo-section__item[u--bg--…]` | Item partenaire : logo image + nom `h4.h-s sm-p-s` |
| `.logo-section__overlay` | Overlay de fin de liste |
| `.show--clip` | Utilitaire de masque/découpage (section « Safety ») |

---

## 5. Composant bouton — `.button-main`

### Structure HTML attendue (5 niveaux de spans)

```html
<a class="button-main w-inline-block [text-only] [download-button] [w--current]"
   data-button-theme="light|dark"
   data-button-accent="white|blue|yellow|violet|green|orange|dark"
   data-load-stagger=""
   [data-download-cta="button|logo|text"]>
  <span class="button-main-inner full-h">
    <span data-text="libellé" class="button-main-inner__back"></span>
    <span class="button-main-inner__front">
      <span class="button-main-inner__bg [is--download] [is--white]"></span>
      <span class="button-main-inner__text [has--logo] [has--icon] [smaller-pad]">
        <span>libellé</span>
        [<img class="button-main-inner__logo" …] [<svg class="button-main-inner__arrow" …>]
      </span>
    </span>
  </span>
</a>
```

### Tokens et variantes

- `data-button-theme="light"` : fond `.button-main-inner__bg = var(--color--light)`, bordure `0.125em solid var(--color--dark)`, texte `var(--color--dark)`.
- `data-button-theme="dark"` : fond `var(--color--dark)`, texte `var(--color--light)`.
- `data-button-accent` : colore `.button-main-inner__back` (face arrière de l'effet 3D) avec le token correspondant ; `dark` ajoute aussi `color: var(--color--light)`.
- `text-only` : bouton sans fond visible (CTA hero « Launch web app », « Available on other devices »).
- `download-button` + `data-download-cta` : CTA de téléchargement avec logo navigateur (`.download-button__logo img`) ou texte.
- `is--download` sur `__back` : texte arrière énorme (17.5em, police Lateral/Impact, graisse 800, `text-transform: uppercase`, `line-height: .8`).
- `w--current` : état courant (lien nav actif) ; dans la nav, chaque position a sa couleur de fond spécifique (1=violet, 2=bleu, 3=vert, 4=jaune, 5=orange).

### États et interactions

- `:active` (bouton et cercle nav) : `transform: scale(0.955)`.
- Survol (quand `hover: hover` et pas `prefers-reduced-motion`) : effet de pivot 3D — la face avant recule et s'estompe (`translate: 0 -2em -6em`, `rotate: 1 0 0 85deg`, `opacity: 0`), la face arrière avance (`rotate: 1 0 0 0deg`, `translate: 0 0 0`, `opacity: 1`), le texte du dos remonte avec un délai d'escalade `calc(var(--index) * .012s)`.
- Transition par défaut : `0.5s var(--elastic-ease-out)` sur `.button-main`, `.nav-btn-circle`, `.footer-social-link` ; `__bg` en `background-color .2s var(--color-ease)`.
- `prefers-reduced-motion` : pas de pivot ; inversion des couleurs au survol (fond/texte échangés) pour conserver un feedback visible.
- `.link` : sous-ligne animé (`.link::after`, `transform: scale(0,1)` → `scale(1,1)` de gauche à droite, `0.4s var(--cubic-default)`).

---

## 6. Navigation — `.nav-w`

- `.nav-w` : navigation fixe, `transition: top 0.6s var(--elastic-ease-out)`. Position `top: 4.5em` (desktop) / `4em` (mobile) avant le début du scroll, `1.5em` / `0.75em` après (`body[data-scrolling-started="true"]`), piloté par Lenis.
- `.nav-container.container > .nav-inner` : barre de navigation.
- `.nav-btn-circle.is--nav-logo` : logo marque (SVG 21×22, `fill="currentColor"`).
- `.nav-inner-list > .nav-inner-li` : 5 liens nav, chacun un `.button-main[data-button-theme="light"]` avec un `data-button-accent` différent (yellow, vide, orange, green, violet).
- `#menuButton.nav-btn-circle` : bouton menu (hamburger, lignes `.nav-btn-menu__line.is--h` / `.is--v`).
- Lien « Launch App` : `.button-main[data-button-theme="dark"]`, cible externe.
- `data-barba-update="nav"` sur les liens nav (mise à jour Barba sans rechargement).
- `.nav-btn-chevron` / `.nav-chevron-wrap` : chevrons qui tournent de -90deg au survol de `.nav-btn-circle` ; état `:active` des cercles slideshow : `scale(0.955) rotate(90deg)`.

---

## 7. Sections de contenu

### Hero
`.section > .container > .content-container.padding-vertical-180 > .hero-section > .content-wrap-m`

- `.title-row > h1.h-d.u--rel[data-anim-hero]` : titre héro, lettres animées individuellement (`data-anim-hero` applique `display: inline-block` avec padding/marge de calage sur chaque `.char`).
- `.defi-i-1`, `.defi-i-2` : conteneurs Lottie (icônes onboarding).
- `.button-row` : rangée de CTA boutons.
- `.two-col-grid` : 4 items alternant texte et visuel. Chaque item :
  - `.two-col-grid__text` : `h2.h-l[data-anim-slant]` (+ `xs--first`, `xs--h-ml`), `p.h-s` (+ `xs--last`), optionnellement un CTA bouton `data-button-theme="dark"`.
  - `.two-col-grid__visual[data-box-theme="violet|green|yellow"]` : logo décoratif SVG `.two-col-grid__visual-logo` + image responsive `.cover` (srcset) dans `.u--bg`.
- `data-anim-slant` : même principe de calage lettre par lettre que `data-anim-hero`.

### Bannière CTA défilante — `.cta-banner-section > .cta-banner-inner`

- `.marquee-advanced` : défilement infini, attributs `data-marquee-duplicate="2"`, `data-marquee-direction="right|left"`, `data-marquee-speed="15|20"`, `data-marquee-scroll-speed="10"`, `.xs--show` sur la variante mobile.
- `.download-cta-el.button-main` : boutons CTA dans le défilement, avec `data-box-theme` (white, orange, blue, yellow, green, violet) sur `.button-main-inner__bg.is--download`.
- `.marquee-cta-h` : texte du CTA dans le défilement (`font-variation-settings: "slnt" 100` sur les items impairs).
- `.marquee-cta-dot` : séparateur logo SVG entre les CTA.
- `.marquee-i-1` à `.marquee-i-4` : icônes Lottie en parallaxe (`data-parallax="trigger"`, `data-parallax-start`, `data-parallax-end`).

### Slider sécurité — `.img-slider`

- `.img-slider[data-slideshow-orientation="horizontal"][data-slideshow="wrap"]`
- `.img-slider__list > .img-slide[data-slideshow="slide"][data-box-theme="green|yellow|orange|blue"]` (4 diapositives ; la courante a `.is--current`)
- `.slide-logo-bg` : grand logo décoratif SVG derrière chaque diapositive
- `.img-slide__content` :
  - `h4.h-d.u--text--italic[data-slideshow-heading]` (+ `xs--block` pour le retour à la ligne mobile)
  - `.img-slide__paragraph > p.h-s[data-slideshow-para]`
  - `.img-slide__lottie [.is--smaller]`
- `.slider-overlay` :
  - `.is--nav` : boutons prev (`.u--rotate-180`) / next (`.nav-btn-circle` + chevrons)
  - `.is--bullets` : `.img-slider__overlay-progress > .slider-progress__bar` (4 barres, la courante `.is--current`)

### Section partenaires — `.logo-section`

- `h3.h-sm[data-heading-reveal]` + CTA bouton `data-button-theme="dark"`
- `.logo-section-column > .logo-section__wrapper[data-marquee-scroll-vertical][data-marquee-direction="right"]` : défilement vertical des partenaires
- Items `.logo-section__item[u--bg--blue|violet|yellow|orange|green]` : image logo `.cover` + `h4.h-s sm-p-s`
- `.logo-section__overlay` : masque de fin

### Footer — `.footer > .container > .footer-row-wrap`

- `.footer-row[data-card-reveal="wrap"] > .footer-row-col[data-card-reveal="card"][data-box-theme="violet|yellow"][class="is--large is--yellow"]`
  - `.footer-block-bg > .footer-block-bg__logo` (logo décoratif SVG)
  - `.footer-block-content` : `.u--rel` (icône Lottie `.footer-i-…`, titre `.footer-block__h > h3.h-l`), `.footer-newsletter-para > p.h-s`
  - Formulaire newsletter `.footer-form` (Mailchimp) : `.form-field__wrap > input.form-field.is--footer[type="email"]` + bouton `.button-main.xs--full` (« subscribe`) + `.footer-checkbox` (case + `.footer-checkbox__text`)
- Seconde colonne support : image + `h3.h-l` + `p.h-s` + 2 CTA boutons (`Get support`, `zendesk support` avec `.button-main-inner__logo`)
- 3e partie `.footer-row` :
  - `.footer-social-grid > .footer-social-link.w-inline-block` : icônes Discord, X (Twitter), Instagram, YouTube (SVG 100% viewBox)
  - `.footer-row-col.is--last` : `h3.h-m` + `.link-list.w-list-unstyled > li > a.p-l.text-link.link` (home, Card, defi/earn `.w--current`, get started, security, Download, Guides) ; `.footer-cr > p.p-m.u--weight--bold.u--text--caps` (copyright) ; liens légaux `.p-m.text-link.link` (FAQ, brand assets, Privacy Notice, Terms of service)

---

## 8. Tokens d'animation et d'interaction (bloc `css-animations`)

| Variable | Valeur |
|---|---|
| `--cubic-default` | `cubic-bezier(0.65, 0.05, 0, 1)` |
| `--duration-default` | `0.75s` |
| `--duration-medium` | `0.85s` |
| `--duration-fade` | `0.15s` |
| `--smooth-ease` | `cubic-bezier(.32, .72, 0, 1)` |
| `--color-ease` | `cubic-bezier(.216, .62, .356, 1)` |
| `--elastic-ease-out` | courbe `linear()` type ressort (longue liste de points clés) |

Transitions notables : boutons et cercles nav `0.5s elastic-ease-out` ; `__bg` `background-color .2s color-ease` ; `__front` / `__back` / `__text` / `__back::before` sur hover avec `elastic-ease-out` et durées `default`/`medium`/`fade` ; `.link` underline `0.4s cubic-default` ; `.text-link-underline` `0.75s cubic-default` ; `.nav-w` `top 0.6s elastic-ease-out` ; `.home-qr-wrap` `0.65s cubic-bezier(0.65, 0.05, 0, 1)`.

Autres détails d'interaction :
- `.home-logo-letter:nth-child(n)` : `clip-path: inset(...)` dégressif (lettres du logo mascotte).
- Curseur personnalisé `.cursor` avec logos de navigateurs affichés selon `data-cursor` sur l'élément survolé (spécifique au site Slush, à ne pas réutiliser telle quelle).
- `body:has([data-cursor]:hover) .cursor{ opacity: 1 }`.

---

## 9. Accessibilité et préférences utilisateur

- `.sr-only:not(:focus):not(:active)` : masquage accessible (clip rect + position absolue 1px).
- `role="list"` sur `.nav-inner-list`, `.footer-social-grid`, `.footer-cr` listes.
- `aria-label="Previous Slide"`, `aria-label="Next slide"` sur les boutons du slider.
- `aria-current="page"` + classe `w--current` sur le lien courant.
- `prefers-reduced-motion` : désactive le pivot 3D des boutons et remplace par une inversion de couleur.
- `data-lottie` / `data-lottie-src` : animations Lottie pour les icônes décoratives.
- `loading="lazy"` sur les images.

---

## 10. Ce qui n'est PAS réutilisable (spécifique au template Slush)

- Les transitions de page Barba (voir § exclusions en tête).
- Le curseur custom `.cursor` et ses logos de navigateurs.
- Les assets Lottie et images du site Slush (icônes onboarding, logos partenaires, visuels hero) : seul le **mécanisme** (`data-lottie`, `.cover`, marquee) est réutilisable.
- Le formulaire Mailchimp / HSForms (tiers, hors scope).
- GTM et scripts de suivi.

---

## 11. Note d'intégration pour Magic Game Store

Le template utilise une **feuille CSS externe partagée** qui contient les valeurs réelles des tokens (`--color--*`, largeurs de gap `gap--reg/small/bigger`, polices Webflow). Pour réutiliser ce design system dans `frontend/`, il faut donc :

1. Définir les variables CSS manquantes (`--size-unit`, `--size-container…`, `--color--*`) dans `src/index.css` (couche `@layer base`, voir les règles du projet dans `AGENTS.md` : pas de nouveaux hex codés en dur en dehors d'une définition de token).
2. Reprendre le nommage des classes (`h-d`, `h-l`, `h-s`, `.button-main`, `.two-col-grid`, `.nav-w`…) et les attributs `data-*` (`data-button-theme`, `data-button-accent`, `data-box-theme`, `data-load-stagger`).
3. **Ne pas implémenter les transitions de page Barba** (exclu par consigne).
4. Respecter la règle des cibles tactiles ≥ 44×44 px sur mobile et la parité FR/EN des chaînes via `t()`.
