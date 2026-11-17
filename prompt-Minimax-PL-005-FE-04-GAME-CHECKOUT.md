# PROMPT-ID: PL-005-FE-04-GAME-CHECKOUT

## Mission

Tu es Minimax, agent frontend sur magicgame.store (repo `selneker/magicgamestor`). Ce lot applique le
nouveau design (base posée par PL-005-FE-03) à la **page jeu / boutique** et au **parcours de paiement**
(checkout), en suivant `02-page-jeu.html` et `03-checkout.html` (dans `repports/maquettes/ds003/`).

**Prérequis** : PL-005-FE-03 fusionné dans `main` (`git log origin/main --oneline | grep PL-005-FE-03`),
sinon **arrête-toi**. Reprends **toutes les règles strictes du lot FE-03** (fidélité, pas de CSS/JS tiers
verbatim, pas de transition de page, animations légères, pas de contenu inventé, aucun changement
backend/API/logique/CAPTCHA/`data-testid`, parité i18n, pas de dépendance sans justification, branche
`feat/design-game-checkout`, un seul commit préfixé `PL-005-FE-04`, `git add` explicite, **aucun push/PR/merge**,
captures hors dépôt dans `repports/captures/PL-005-FE-04/`, liste des écarts avant commit).

## Étape 0 — Inventaire

Note fichier:ligne : la page jeu actuelle (grille de packs, cartes produit, prix, remises, onglets, état
« indisponible » du produit s'il existe), le panier/barre d'achat, le checkout actuel (écrans, champs ID joueur
+ pseudo vérifié, choix du moyen de paiement, minuteur, envoi de preuve, écran d'attente, annulation,
CAPTCHA), les composants communs déjà créés en FE-03 à **réutiliser**, et les barres d'action fixes de FE-02.

## Spécification

### Page jeu
- Grille de packs et cartes produit de la maquette : chiffre, unité, remise barrée, pilule de prix, bouton
  d'ajout ; onglets de catégories ; pas d'icône produit sur mobile (comme la maquette).
- **Données réelles uniquement** (packs, prix, remises du backend). Aucun prix ou pack d'exemple.
- **Produit indisponible** (`purchasable: false` / erreur `product_unavailable`, si ces champs existent
  déjà) : carte grisée, bouton désactivé « momentanément indisponible », jamais caché. Si ces champs
  n'existent pas dans le code, **ne les invente pas** : signale-le dans le rapport.
- Le « + » devient ✓ au clic et la pilule rebondit (animation courte, coupée en `prefers-reduced-motion`).
  Pas de « point volant », pas de simulation de panier (c'est une démo de maquette).

### Checkout (3 écrans de la maquette)
- Écran 1 : commande (montant, lignes, ID joueur + pseudo vérifié, moyens de paiement avec **les vrais logos
  et les vrais moyens** du site, remarque, CAPTCHA, bouton principal).
- Écran 2 : paiement (étapes, détails à payer, compte à rebours, bouton « preuve envoyée »/envoi de preuve).
- Écran 3 : attente/vérification (état, message, preuve reçue).
- **Boutons d'action en bas** (barre fixe, comme FE-02), bouton retour mobile + sortie rapide vers `/suivi`
  conservés tels que FE-02 les a posés ; **aucune boucle de navigation** (teste retour navigateur ×3).
- Feuille (preuve / annulation) comme la maquette. Toute la logique actuelle (validation d'ID, expiration,
  reprise d'une commande `pending_payment`, règle « jamais de commande forcée ») reste **identique**.

## Vérifications

Mêmes exigences que FE-03 : tests avant/après par identifiants (`pendingOrder.test.js:20` connu), nouveaux
tests (carte indisponible grisée si le champ existe, barre d'action en bas, ID invalide bloque le paiement,
reprise de commande en attente), `yarn audit:contrast` clair et sombre, `git grep` tiers vide, poids gzip,
captures côte à côte mobile 320/390 et desktop, clair et sombre, parcours complet joué de bout en bout avec
le fournisseur et le paiement **mockés** (aucun vrai appel).

## Rapport attendu

Inventaire (fichier:ligne) ; fichier:ligne de chaque élément ; champs réels vs absents ; écarts (ou
« aucun écart ») ; tests, contraste, poids ; hash du commit et branche, **sans push** (confirme-le) ;
ce qui n'a pas pu être vérifié.
