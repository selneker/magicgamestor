PL-DS-001 — maquette design système Magic Game Store

Fichiers créés (statique, HTML + CSS en fichier, aucun framework, aucun appel réseau, icônes SVG uniquement) :
- maquettes/00-design-system.html — jetons, typographie, boutons (incl. effet flip Slush), cartes, badges, champ, nav, pastille jeu, marquee, avis étoiles.
- maquettes/01-accueil.html — hero, preuves de confiance, cartes de jeux 2 colonnes mobile / 4 colonnes desktop, étapes, « pourquoi », avis clients, ticker.
- maquettes/02-page-jeu.html — page PUBG Mobile (en-tête jeu, figure 60 UC, grille de packs, barre d’achat collante mobile).
- maquettes/03-checkout.html — 3 écrans de paiement sans stepper, pas d’en-tête/pied pendant le paiement, récap sur l’écran d’attente (ID joueur et pseudo sur lignes séparées), « Envoyer la preuve de paiement » en bas, sondage d’annulation, Turnstile pleine largeur à gauche.

Jetons principaux : fond crème hsl(48 20% 94%), encre hsl(0 0% 4%), surface encre hsl(0 0% 7%), néon hsl(72 99% 50%) réservé aux surfaces d’encre, accents v1 violet/bleu/vert/jaune/orange, bordure dure 2px encre, ombre dur 3px, radius 10px (cartes 28px), échelle fluide base 16px @ 1440px (clamp), polices Bricolage Grotesque / Onest en pile système (pas de webfont).

Décisions de design : contraste ≥ 4,5:1, cibles tactiles ≥ 44×44px, focus visible 2–4px, prefers-reduced-motion respecté, une CTA primaire par écran, néon uniquement sur encre, pastille de prix = surface fixe + texte encre fixe, navigation mobile = barre du bas ≤ 5 items, lecture vérifiée à 390 px et 1440 px.

Écarts avec le site actuel : pastilles de jeu colorées (accents v1) absentes du site, boutons à effet flip, barre d’achat collante stylisée, ticker d’informations, structure du checkout réinventée (pas de stepper, recap à la fin). Aucun fichier du site React n’a été modifié.
