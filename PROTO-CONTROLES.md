# PROTO-CONTROLES — audit des commandes (PL-FE-009, phase 3)

Généré par `frontend/scripts/proto-dead-controls.mjs` contre le site de `scripts/demo-local.sh`.

**Éléments interactifs visibles audités : 120** — vivants 120, morts 0.

Méthode : clic réel sans `force:true`, gestionnaires lus par CDP (`DOMDebugger.getEventListeners`) **et** délégués (`e.target.closest(…)` sur `document`), liens réels, `data-nav` routés, champs de saisie.

## Écrans et états parcourus

accueil · catalogue (liste jeux, catalogue PUBG, favori) · panier + drawer · connexion · inscription · mot de passe oublié · compte (profil, mot de passe, suppression) · points · commandes (liste, détail, filtre, recherche, pagination) · paiement (écrans 1/2/3, MVola, Orange, Binance, popup humain, annulation) · événements · pack évolutif · support · menu mobile 390 px · langue EN.

## Commandes mortes

**Aucune.**

## Commandes vivantes, par écran

### accueil (33)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#top"]` | Magic Game Store | lien interne routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#"][data-nav="boutique"]` | boutique | data-nav routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#"][data-nav="commandes"]` | commandes | data-nav routé | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `a[href="#"][data-nav="support"]` | support | data-nav routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#"][data-nav="compte"]` | compte | data-nav routé | main:frontend/src/pages/Account.js:180-182 |
| `button` | 0 | gestionnaire délégué: .nav-cart-btn | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `button#menuButton` | Menu | gestionnaire: mouseenter | main:frontend/src/components/layout/Header.js |
| `a[href="#"][data-nav="points"]` | 120 pts | data-nav routé | main:frontend/src/pages/Loyalty.js |
| `a[href="#jeux"]` | Voir la boutique | gestionnaire: mouseenter | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#jeux"]` | Choisir un jeu | gestionnaire: mouseenter | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#securite"]` | Suivre une commande | gestionnaire: mouseenter | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `a[href="#jeux"]` | Voir la boutique | lien interne routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#recharger"]` | Recharger | gestionnaire: mouseenter | — |
| `button` | Diapositive précédente | gestionnaire: click | — |
| `a[href="#top"]` | choisir un jeu | lien interne routé | — |
| `input#EMAIL` | email | champ de saisie | — |
| `a#submit-static-form[href="#support"]` | s’abonner | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `input#Compliance` | checkbox | champ de saisie | — |
| `a[href="https://magicgame.store/chat"]` | Obtenir de l’aide | lien externe | main:frontend/src/pages/Catalog.js:118,257 ; main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="https://wa.me/261377519833"]` | WhatsApp | lien externe | — |
| `a[href="https://web.facebook.com/profile.php?id=61564007603785"]` | Facebook | lien externe | main:frontend/src/pages/Account.js:180-182 |
| `a[href="https://wa.me/261377519833"]` | WhatsApp | lien externe | — |
| `a[href="tel:+261****5692"]` | Téléphone · 038 39 056 92 | gestionnaire délégué: a | — |
| `a[href="#support"]` | Discord | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#top"][data-nav="accueil"]` | accueil | lien interne routé | — |
| `a[href="#boutique"][data-nav="boutique"]` | boutique | lien interne routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#commandes"][data-nav="commandes"]` | commandes | lien interne routé | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `a[href="#support"][data-nav="support"]` | support | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#compte"][data-nav="compte"]` | compte | lien interne routé | main:frontend/src/pages/Account.js:180-182 |
| `a[href="#support"]` | FAQ | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#support"]` | Politique de confidentialité | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#support"]` | Conditions d’utilisation | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#support"]` | Support | lien interne routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |

### boutique (12)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#top"][data-nav="accueil"]` | Accueil | lien interne routé | — |
| `div` | Populaire PUBG MobileUC, Prime & Royal P | gestionnaire délégué: .mgs-game | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#"]` | Voir les offres | gestionnaire délégué: a[href^="#"] | — |
| `div` | Free FireDiamants & abonnements Diamants | gestionnaire délégué: .mgs-game | main:frontend/src/pages/Catalog.js:118,257 |
| `div` | Mobile LegendsDiamonds & Starlight Diamo | gestionnaire délégué: .mgs-game | main:frontend/src/pages/Catalog.js:118,257 |
| `div` | Nouveau Call of Duty MobileCP & Battle P | gestionnaire délégué: .mgs-game | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#"][data-nav="support"]` | Demander un jeu | data-nav routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#boutique"]` | Tous les jeux | lien interne routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#produit"][data-nav="produit"]` | Voir le produit | lien interne routé | — |
| `button` | Ajouter aux favoris | gestionnaire délégué: .mgs-pcard__fav | main:frontend/src/lib/favorites.js:3 |
| `button` | Ajouter au panier | gestionnaire délégué: .mgs-pill__add | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `a[href="#"][data-nav="pack"]` | Voir le pack | data-nav routé | main:frontend/src/pages/PackEvolutif.js |

### panier (7)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `button` | 1 | gestionnaire délégué: .nav-cart-btn | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `button` | Retirer un | gestionnaire délégué: .mgs-stepper__btn | — |
| `button` | Fermer | gestionnaire délégué: .mgs-cart-close | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `button` | − | gestionnaire délégué: .mgs-cart-item__qty button | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `button` | + | gestionnaire délégué: .mgs-cart-item__qty button | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `button` | Retirer | gestionnaire délégué: .mgs-cart-item__del | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `button` | Commander | gestionnaire délégué: .mgs-cart-checkout | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 ; main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 ; main:frontend/src/pages/Checkout.js ; backend/routers/payments.py |

### compte (19)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#"][data-nav="boutique"]` | boutique | data-nav routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#"][data-nav="compte"]` | compte | data-nav routé | main:frontend/src/pages/Account.js:180-182 |
| `a[href="#"][data-nav="points"]` | 0 pts | data-nav routé | main:frontend/src/pages/Loyalty.js |
| `a[href="#"][data-nav="connexion"]` | Déconnexion | data-nav routé | — |
| `a[href="#"][data-nav="commandes"]` | 1Commandes ↗ | data-nav routé | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `input#acc-name` | text | champ de saisie | — |
| `input#acc-phone` | tel | champ de saisie | — |
| `input#acc-ids` | text | champ de saisie | — |
| `a[href="#"]` | Enregistrer | gestionnaire délégué: a[href^="#"] | — |
| `input#pw-cur` | password | champ de saisie | — |
| `input#pw-next` | password | champ de saisie | — |
| `a[href="#"]` | Changer le mot de passe | gestionnaire délégué: a[href^="#"] | — |
| `a[href="#"]` | Supprimer le compte | gestionnaire délégué: a[href^="#"] | main:frontend/src/pages/Account.js:180-182 |
| `button` | FR | gestionnaire délégué: .mgs-tag-toggle | — |
| `button` | Clair | gestionnaire délégué: .mgs-tag-toggle | — |
| `a[href="#"][data-nav="commandes"]` | Mes commandes | data-nav routé | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `a[href="#"][data-nav="points"]` | Points fidélité | data-nav routé | main:frontend/src/pages/Loyalty.js |
| `a[href="#"][data-nav="boutique"]` | Boutique | data-nav routé | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#"][data-nav="support"]` | Support | data-nav routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |

### connexion (12)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `button` | Connexion | gestionnaire délégué: .mgs-tab | — |
| `button` | Inscription | gestionnaire délégué: .mgs-tab | — |
| `a[href="#"]` | Continuer avec Google | gestionnaire délégué: a[href^="#"] | — |
| `input#em` | email | champ de saisie | — |
| `input#pw` | password | champ de saisie | — |
| `input` | checkbox | champ de saisie | — |
| `a[href="#mdp"][data-nav="mdp"]` | Mot de passe oublié ? | gestionnaire délégué: a[data-nav] | main:frontend/src/pages/AuthExtras.js:37-96 |
| `a[href="#"][data-nav="compte"]` | Se connecter | data-nav routé | main:frontend/src/pages/Account.js:180-182 |
| `button` | Connexion | gestionnaire délégué: .mgs-tab | — |
| `button` | Inscription | gestionnaire délégué: .mgs-tab | — |
| `input#reg-name` | text | champ de saisie | — |
| `a[href="#"][data-nav="compte"]` | Créer le compte | data-nav routé | main:frontend/src/pages/Account.js:180-182 |

### mdp (3)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `input#fpe` | email | champ de saisie | — |
| `a[href="#mdp"]` | Envoyer le lien | gestionnaire délégué: a[href^="#"] | — |
| `a[href="#connexion"][data-nav="connexion"]` | Retour à la connexion | lien interne routé | — |

### commande (15)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#"]` | Retour | gestionnaire délégué: a[href^="#"] | — |
| `a[href="#commandes"][data-nav="commandes"]` | Voir le suivi | lien interne routé | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `input` | ID joueur | champ de saisie | — |
| `button` | Vérifier l'ID | gestionnaire délégué: .button-main | — |
| `label` | MVolaPaiement manuel | gestionnaire délégué: .mgs-co-method | main:frontend/src/pages/Checkout.js ; backend/routers/payments.py |
| `label` | Orange MoneyPaiement manuel | gestionnaire délégué: .mgs-co-method | main:frontend/src/pages/Checkout.js ; backend/routers/payments.py |
| `button` | Passer la commande | gestionnaire délégué: .button-main | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `button` | 123456789 | gestionnaire délégué: .mgs-co-recent-chip | — |
| `label` | MVolaPaiement manuel | gestionnaire délégué: .mgs-co-method | main:frontend/src/pages/Checkout.js ; backend/routers/payments.py |
| `button` | Fermer | gestionnaire délégué: .mgs-human-close | — |
| `label` | label | gestionnaire délégué: .mgs-human-check | — |
| `a[href="#"]` | Confidentialité | gestionnaire: click | — |
| `a[href="#"]` | Aide | gestionnaire: click | — |
| `button` | Fermer | gestionnaire délégué: .mgs-human-cancel | main:frontend/src/components/store/checkout/CancelSheet.js:21-25 ; backend/routers/orders.py:124-127 |
| `button` | Passer la commande | gestionnaire délégué: .button-main | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |

### evenements (3)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#"][data-nav="boutique"]` | Participer | data-nav routé | main:frontend/src/pages/Catalog.js:118,257 |
| `button` | 0 | gestionnaire délégué: .mgs-card__like | — |
| `button` | 0 | gestionnaire délégué: .mgs-card__share | — |

### pack (3)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `input#eid` | input | champ de saisie | — |
| `a[href="#"][data-nav="pack"]` | Vérifier | data-nav routé | main:frontend/src/pages/PackEvolutif.js |
| `a[href="#"][data-nav="commandes"]` | Payer le palier 2 | data-nav routé | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |

### support (7)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#"][data-nav="support"]` | support | data-nav routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#"]` | Chat en directRéponse en quelques minute | gestionnaire délégué: .mgs-panel | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `a[href="#"]` | WhatsApp··· ·· ··· ·· (numéro à confirme | gestionnaire délégué: .mgs-panel | — |
| `a[href="#"]` | Emailsupport@magicgame.store | gestionnaire délégué: .mgs-panel | main:frontend/src/pages/Catalog.js:118,257 ; main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |
| `input#sj` | input | champ de saisie | — |
| `textarea#ms` | textarea | champ de saisie | — |
| `a[href="#"][data-nav="support"]` | Envoyer | data-nav routé | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |

### menu mobile (6)

| élément | libellé | ce qu'il fait | équivalent dans main |
|---|---|---|---|
| `a[href="#"][data-nav="compte"]` | Compte | data-nav routé | main:frontend/src/pages/Account.js:180-182 |
| `button` | 1 | gestionnaire délégué: [aria-label*="Panier"] | main:frontend/src/context/CartContext.js:29 ; main:frontend/src/components/store/CartDrawer.js:129 |
| `a[href="#jeux"]` | Boutique | gestionnaire: click | main:frontend/src/pages/Catalog.js:118,257 |
| `a[href="#recharger"]` | Événements | gestionnaire: click | — |
| `a[href="#commandes"][data-nav="commandes"]` | Commandes | gestionnaire: click | main:frontend/src/pages/OrderHistory.js:185 ; backend/routers/orders.py:436-438 |
| `a[href="#support"]` | Support | gestionnaire: click | main:frontend/src/pages/Support.js ; main:frontend/src/pages/Chat.js |


## Équivalents dans `main` (preuves)

| règle | fichier:ligne |
|---|---|
| panier : un seul jeu, plafond 20 / 1 | `main:frontend/src/components/store/ProductCard.js:52-53`, `main:frontend/src/context/CartContext.js:4,29`, `main:frontend/src/components/store/CartDrawer.js:129` |
| tri par prix | `main:frontend/src/pages/Catalog.js:118,257` |
| stat « Jeux liés » | `main:frontend/src/pages/Account.js:182` |
| favoris persistés | `main:frontend/src/lib/favorites.js:3` |
| ID récents 10 max / 60 car. | `main:frontend/src/lib/recentPlayerIds.js:22,28` |
| pagination (libellés + composant) | `main:frontend/src/components/ui/pagination.jsx:61,78`, `main:frontend/src/i18n/translations.js:294` |
| motifs d'annulation | `main:frontend/src/components/store/checkout/CancelSheet.js:21-25`, `backend/routers/orders.py:124-127` |
| oubli / réinitialisation | `main:frontend/src/pages/AuthExtras.js:37-96`, `backend/routers/auth.py:218-253` |
| j'aime / partage | `main:frontend/src/pages/Events.js:29-39,95-96`, `backend/routers/events.py:52-68` |
