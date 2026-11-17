# Magic Game Store · Business plan

**Verdict: Not yet**

- ✓ Each commande earns $1400.00 before fixed costs (9% contribution).
- ✗ Year 1 operating LOSS: $2,898,000.

| key number | |
| --- | ---: |
| Price | $15000.00 a commande |
| Profit margin at plan | -4% per commande |
| Break-even | 12 commandes a day |
| Year 1 operating profit | $-2,898,000 |
| Startup spend | $950,000 |
| Cash needed before it pays for itself | $3,848,000 |
| Startup money earned back | not in year 1 |

## The idea

### Ce que c'est
Magic Game Store (magicgame.store) est une boutique en ligne de recharges de jeux vidéo (top-up) pour le marché malgache. Elle vend des UC PUBG Mobile, des abonnements Prime et Prime+, et des packs évolutifs, livrés sur le compte joueur du client après vérification de son identité.

### Pour qui
Les joueurs de Madagascar, surtout sur mobile (écrans de 390 px sur des réseaux lents), qui paient en ariary (MGA) avec MVola, Orange Money ou Binance USDT.

### Comment ça marche
1. Le client choisit un jeu et un pack sur le catalogue.
2. Son compte joueur est vérifié (ID et zone de serveur) avant le paiement — chez Fazercards aujourd'hui, en migration vers Neferbyte (≈ 34 jeux couverts, contre 3 chez Fazercards).
3. Il paie en MVola, Orange Money ou USDT (Binance).
4. La recharge est livrée sur son compte ; il suit sa commande en temps réel.

### Technique
Backend FastAPI + MongoDB (motor), API sous `/api`, 15 routeurs, authentification par cookies HttpOnly. Frontend React 19 + Tailwind 3.4 (CRA 5 / craco 7), français par défaut, anglais secondaire. L'hébergement et le domaine sont déjà en place (magicgame.store).

## Summary

Magic Game Store (magicgame.store) revend des recharges de jeux vidéo (UC PUBG Mobile, Prime, packs évolutifs) aux joueurs de Madagascar, en ariary, payables en MVola, Orange Money ou Binance USDT, avec vérification du compte joueur avant livraison. C'est une boutique en ligne mobile-first, conçue pour les écrans de 390 px sur réseaux lents.

**Verdict : pas encore rentable sur ces estimations.** Chaque commande rapporte 1 400 ariary (9 %) avant les frais fixes, mais le seuil de rentabilité est de 12 commandes par jour alors que le plan table sur 8 : l'année 1 fait une perte d'exploitation de 2 898 000 ariary et il faudrait 3 848 000 ariary de trésorerie avant que le lancement ne se rembourse.

Le panel d'acheteurs n'a pas encore été mené et les conditions financières du board ne sont pas encore écrites (`founder/board.md` manquant) : il n'y a donc ni avis d'acheteurs simulés ni position du board à rapporter à ce stade.

Le plus gros risque est une marge unitaire trop faible : le coût fournisseur de top-up et les frais de paiement mangent presque toute la commande. La contre-mesure est claire et chiffrée par l'outil : renégocier le fournisseur et les frais de paiement, et/ou relever le prix de 10 %. Prix +10 % et coûts −15 % ensemble ramènent le seuil à 4 commandes/jour, la marge à 18 %, et le bénéfice de l'année 1 à +4 642 200, avec le lancement remboursé au mois 7.

Il faut commencer par remplacer les estimations par des vrais chiffres : devis fournisseur de top-up, frais de transaction MVola / Orange Money / USDT, frais d'immatriculation, salaire visé. Avec ceux-ci, relancer le CFO, puis compiler le plan.

**Une chose à faire cette semaine :** contacter Fazercards (top-up), Neferbyte (vérification d'identité) et les opérateurs mobile money pour obtenir leurs tarifs réels, et les reporter dans `founder/numbers.json`.

Les chiffres ci-dessus sont des projections sur des estimations : des clients réels et de vrais devis les confirment ou les infirment avant toute dépense. Ce n'est pas un avis financier, légal ou fiscal.

## The competition

### Ce qu'on sait
Il existe sur le marché des top-up de jeux vidéo :
- les places de marché internationales de recharges (paiement souvent en devises étrangères, cartes bancaires) — moins adaptées au paiement mobile money malgache ;
- les opérateurs mobiles eux-mêmes (MVola, Orange Money) qui proposent parfois des achats forfaitaires ;
- d'autres boutiques de top-up locales ou régionales (noms non vérifiés à ce stade).

### Notre écart
Aucun concurrent nommé n'a été répertorié dans ce document : ce travail de vérification reste à faire (skill `/founder-competitors`). Rien ici ne copie un nom, un logo, des couleurs ou une accroche existants.

### À faire
Dresser la liste réelle des concurrents opérant à Madagascar, leurs prix, leurs moyens de paiement et leurs délais de livraison, puis vérifier que notre nom, domaine et ne créent pas de confusion.

## The offer

### Produits
- Recharges UC PUBG Mobile (produit d'appel, jeu configuré par défaut).
- Abonnements Prime et Prime+ (réservés à PUBG Mobile, clé `RESERVED_TYPE_KEYS` côté backend).
- Packs évolutifs (`evo`) avec vérification d'éligibilité, réutilisés à la fois sur la page dédiée et en filtre du catalogue.
- Catalogue ouvert aux autres jeux via Neferbyte (vérification ID/joueur pour ~34 jeux) ; le top-up/paiement reste chez Fazercards.

### Prix et paiement
- Prix affichés en ariary (MGA), toutes taxes comprises selon la réglementation en vigueur (à confirmer par l'expert-comptable).
- Moyens de paiement : MVola, Orange Money, Binance USDT.
- Aucun moyen de paiement par carte bancaire directe n'est intégré aujourd'hui.

### Livraison et service
- Vérification du compte joueur avant paiement (évite les recharges envoyées sur le mauvais compte).
- Suivi de commande en temps réel (`/suivi/<n>`), panier, compte client avec points de fidélité (`/compte`, `/compte/points`).
- Espace admin : commandes, paiements (MVola, Orange Money, Binance), tableau de bord.

### Ce qui nous distingue
Compte vérifié avant paiement + mobile-first (conçu pour les écrans 390 px et les réseaux lents) + paiement mobile money/crypto, adapté aux habitudes de paiement à Madagascar.

## The numbers

> **Note du CFO** — tous les montants sont en ariary (MGA) ; l'outil affiche "$" comme unité générique. **Tous les chiffres de ce rapport sont des estimations clairement marquées**, non des devis : voir `founder/cfo-sources.md` et les questions ouvertes en fin de ce document.
>
> - **La marge** : à 8 commandes par jour (le plan), la marge est de **-4 %** après tous les coûts ; chaque commande laisse 1 400 ariary (9 %) avant les frais fixes.
> - **La ligne à surveiller** : c'est la marge unitaire, pas le volume. Un prix −10 % fait tomber la marge à -16 % et rend le seuil de rentabilité jamais atteignable. À l'inverse, faire baisser les coûts unitaires de 15 % (négocier le fournisseur de top-up et les frais de paiement) fait passer la marge à 23 %, le seuil à 5 commandes/jour et le bénéfice de l'année 1 de −2 898 000 à +1 447 200 (lancement remboursé au mois 12, trésorerie nécessaire 1 491 200).
> - **Trésorerie** : il faut 3 848 000 ariary avant que le projet ne se rembourse au niveau actuel (1 189 000 avec la combinaison recommandée ci-dessous).
> - **Trois façons d'améliorer la marge** (chacune issue d'une simulation de l'outil, pas d'une supposition) :
>   1. Négocier le coût fournisseur et les frais de paiement (−15 %) : marge 9 % → 23 %, seuil 12 → 5 commandes/jour, bénéfice année 1 −2 898 000 → +1 447 200.
>   2. Relever le prix de 10 % (15 000 → 16 500) : marge −4 % → 5 %, seuil 12 → 6 commandes/jour, bénéfice −2 898 000 → +297 000.
>   3. Les deux ensemble : seuil 4 commandes/jour, marge 18 %, bénéfice année 1 +4 642 200, lancement remboursé au mois 7, trésorerie nécessaire 3 848 000 → 1 189 000.
> - **Le volume seul ne suffit pas** : +25 % de volume laisse encore une marge de −2 % et une perte de 2 152 500 sur l'année — le levier, c'est la marge unitaire (prix et coûts fournisseur/paiement).
> - **Conditions financières du board** : `founder/board.md` n'existe pas encore, elles ne sont pas encore recueillies.
>
> Ce document n'est pas un avis financier, fiscal ou juridique : un expert-comptable doit vérifier la structure, les charges sociales et la taxe avant que de l'argent ne soit engagé.

Every number below comes from the input file. Nothing is looked up or guessed.

### One commande

| line | per commande |
| --- | ---: |
| Price | $15,000.00 |
| Coût fournisseur de top-up (revente UC/packs) | -$13,200.00 |
| Frais de paiement (MVola / Orange Money / USDT) | -$300.00 |
| Vérification d'identité joueur (API fournisseur) | -$100.00 |
| **Contribution** (what each commande leaves to pay the fixed costs) | **$1,400.00** (9%) |

### The margin that matters

Fixed costs: $490,000 a month (Salaire gérant (1 équivalent temps plein) $400,000, Hébergement backend, domaines, outils SaaS $60,000, Frais divers (assurance, bancaires) $30,000).

- **Break-even: 12 commandes a day.** Below that you lose money every month.
- **Profit margin at your plan** (8 a day): **-4%** of every sale, after every cost.

### Year 1, month by month

| month | commandes a day | revenue | profit | cumulative (after $950,000 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2 | $900,000 | -$406,000 | -$1,356,000 |
| 2 | 3 | $1,350,000 | -$364,000 | -$1,720,000 |
| 3 | 4 | $1,800,000 | -$322,000 | -$2,042,000 |
| 4 | 5 | $2,250,000 | -$280,000 | -$2,322,000 |
| 5 | 5 | $2,250,000 | -$280,000 | -$2,602,000 |
| 6 | 6 | $2,700,000 | -$238,000 | -$2,840,000 |
| 7 | 6 | $2,700,000 | -$238,000 | -$3,078,000 |
| 8 | 7 | $3,150,000 | -$196,000 | -$3,274,000 |
| 9 | 7 | $3,150,000 | -$196,000 | -$3,470,000 |
| 10 | 8 | $3,600,000 | -$154,000 | -$3,624,000 |
| 11 | 8 | $3,600,000 | -$154,000 | -$3,778,000 |
| 12 | 10 | $4,500,000 | -$70,000 | -$3,848,000 |

- **Year 1 operating profit: -$2,898,000** on $31,950,000 of revenue.
- After the $950,000 startup spend: -$3,848,000.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **$3,848,000**.

### What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | -4% | 12 | -$2,898,000 |
| Price -10% | -16% | never | -$6,093,000 |
| Volume -20% | -8% | 12 | -$3,494,400 |
| Unit costs +15% | -18% | never | -$7,243,200 |

### Red flags

- Year 1 loses money on operations (-$2,898,000).
- The startup spend is not earned back within year 1.

## Marketing

### Positionnement
La boutique de recharges de jeux vidéo pour les joueurs malgaches : prix en ariary, paiement en MVola, Orange Money ou USDT, compte joueur vérifié avant livraison, conçu pour le mobile sur réseaux lents.

### Première audience
Joueurs de 15 à 35 ans à Madagascar, principalement sur PUBG Mobile, qui rechargent leur compte régulièrement et paient par mobile money.

### Canaux déjà en place
- Référencement naturel : métadonnées, mots-clés, sitemap, robots et données structurées récents (commit `feat(seo)`).
- Site unique (magicgame.store) sans application mobile native ; le site doit être performant à 390 px sur réseau lent (3G).

### À construire
- Présence sur les réseaux sociaux là où sont les joueurs (à choisir : Instagram, TikTok, Facebook selon Madagascar).
- Programme de parrainage / fidélité (les points existent côté compte ; il n'y a pas encore de levier d'acquisition activé).

## Brand

### Brief (déjà rassemblé)
- `founder/idea.md` : boutique de recharges de jeux vidéo pour Madagascar, prix en ariary, compte vérifié avant paiement.
- `founder/marketing.md` : positionnement joueurs malgaches sur mobile, réseaux lents, paiement MVola / Orange Money / USDT.
- `founder/competitors.md` : aucun concurrent répertorié à ce jour (à faire).
- Panel d'acheteurs : **non encore réalisé** — la marque est bâtie sur le positionnement marketing, pas sur des réactions d'acheteurs réelles. À faire avec `/founder-consumer` avant de figer l'identité.

### 1. Le nom existant
Le magasin existe déjà sous **Magic Game Store** (`magicgame.store`). Évaluation rapide :

| critère | évaluation |
|---|---|
| Ce qu'il dit | Magasin de jeux, clair et descriptif |
| À l'oreille | facile à dire en français comme en anglais |
| Sur une enseigne / icône d'app | lisible, mais générique ("magic" et "game" sont très usités) |
| Risque | confusion possible avec d'autres boutiques de jeux ; disponibilité de la marque et des noms de domaine non vérifiée |

Si le fondateur veut conserver ce nom, les vérifications ci-dessous sont obligatoires avant tout investissement dans l'identité visuelle.

### 2. Dix noms de remplacement (si changement souhaité)

1. **Ariary Play** (descriptif) — ancre le prix local et le jeu ; un peu long à l'oreille ; risque de confusion avec des services de change.
2. **Narivo TopUp** (évocatif, de Antananarivo) — ancrage local fort, mémorable ; "topup" s'écrit de plusieurs façons (risque de faute de frappe dans l'URL).
3. **Zoma Games** (inventé, malgache "zoma" = vendredi/marché) — court, bon sur une icône ; sens opaque pour un non-malgache.
4. **Mana Recharge** (évocatif) — "mana" = énergie de jeu, universel ; très utilisé dans le jeu vidéo (risque de confusion).
5. **Selneker Play** (nom du fondateur) — confiance personnelle, peu évocateur du métier ; difficile à revendre ou à déléguer plus tard.
6. **Isika Shop** (malgache "isika" = nous) — communauté, sympathique ; "shop" est très courant.
7. **Voka Pay** (malgache "voka" = jouer) — court, fort sur icône ; proche phonétiquement d'acteurs de paiement existants (à vérifier).
8. **Gasy Top** (descriptif, "gasy" = malgache) — clair pour le public local ; peut paraître trop local pour s'étendre.
9. **Omena Cards** (malgache "omena" = payer) — lie paiement et produit ; "cards" peut évoquer les cartes bancaires (non supportées).
10. **Tafita Games** (nom de personne malgache) — mémorable, personnel sans être le nom du fondateur ; aucune signification de produit.

Shortlist suggérée : **Narivo TopUp**, **Zoma Games**, **Voka Pay**.

### 3. Vérifications à faire par le fondateur (pas de marque tant que rien n'est déposé)

- **Marque** : rechercher dans le registre compétent pour Madagascar (OAPI — Organisation africaine de la propriété intellectuelle, qui couvre Madagascar) et, si visée à l'international, WIPO Global Brand Database, EUIPO (UE) ou USPTO (US). Classes à vérifier : 9 (logiciels, téléchargements de jeux), 35 (vente au détail de jeux/recharges), 38 (télécommunications), 42 (services informatiques). Je ne peux faire que des recherches publiques ; un avocat en propriété industrielle confirme la disponibilité. Rien n'est protégé tant que le fondateur n'a pas déposé.
- **Domaine** : `magicgame.store` est déjà utilisé. Vérifier si `magicgame.com`, `.mg`, `.com.mg` ou alternatives sont libres (noms de registre, pas d'assomption).
- **Handles** : Instagram, TikTok, X, YouTube — vérifier la disponibilité de chaque nom retenu.
- **Confusion** : aucun nom retenu ne doit se rapprocher d'un concurrent répertorié dans `founder/competitors.md` (liste encore à constituer).

### 4. Voix et promesse

**Promesse en une ligne** : « Votre recharge de jeu livrée sur votre compte vérifié, payable en MVola, Orange Money ou USDT, au prix en ariary. »

Trois slogans :
1. « Rechargez votre compte, pas votre patience. »
2. « Le compte vérifié avant le paiement. La livraison après. »
3. « Jeux vidéo à Madagascar : payez en ariary, recevez sur votre compte. »

Voix : **proche, clair, fiable**.
- Proche : on parle comme un joueur à un joueur — fais: utilisez « vous » et des mots simples ; ne faites pas: de jargon technique ou de promesses marketing gonflées.
- Clair : chaque écran dit ce qui se passe ensuite — fais: indiquez le prix, le délai et le moyen de paiement avant tout clic ; ne faites pas: cachez les frais ou les délais derrière un bouton.
- Fiable : un compte vérifié, une livraison tracée — fais: tenez les délais affichés et confirmez chaque commande par écrit ; ne faites pas: livrez sur un compte non vérifié.

Avant / après (réécriture d'une ligne d'accueil existante) :
- Avant : « Achetez vos UC PUBG Mobile, Prime et Prime+ à Madagascar. Prix en ariary, paiement MVola, Orange Money ou Binance USDT, compte joueur vérifié avant paiement. »
- Après : « Rechargez votre compte PUBG Mobile à Madagascar. Payez en MVola, Orange Money ou USDT. Votre compte est vérifié avant le paiement, la livraison est suivie. »

### 5. Look (brief)

**Couleurs (déjà présentes sur le site)** :
- Encre `#111111` — surfaces principales (boutons, fonds de carte, en-têtes admin). Texte sur encre : crème.
- Néon `#D4FF00` — accent uniquement (badges, appels à l'action sur encre). **Jamais sur crème** (illisible, déjà constaté sur le site : texte néon sur fond crème ≈ 1:1).
- Crème (fond clair du site, environ `hsl(48, 20%, 94%)`, soit approximativement `#F2E8D3`) — fonds et texte sur encre.

Contrastes repères (à mesurer avec `yarn audit:contrast` après chaque modification) : crème sur encre ≈ 16:1 (OK) ; néon sur encre ≈ 16:1 (OK) ; néon sur crème ≈ 1:1 (échec WCAG).

**Typographie** : Onest (affichage) et Bricolage Grotesque (texte), déjà chargés depuis Google Fonts dans `public/index.html` et déjà en licence libre (OFL). Aucun achat de police nécessaire.

**Brief logo** : doit dire "jeu + recharge rapide", fonctionner sur une enseigne, sur l'icône d'application à 32 px et en monochrome (encre seule). Éviter les manettes ou éclairs génériques déjà très utilisés dans le jeu vidéo. Des concepts générés par une IA image peuvent être proposés, mais marqués comme des concepts, pas un logo fini.

**Les cinq premiers points de contact** :
1. L'accueil du site (offre, prix en ariary, moyens de paiement visibles tout de suite) ;
2. Le panier et le checkout (prix total, délai de livraison, moyen de paiement avant le bouton payer) ;
3. L'e-mail/SMS de confirmation de commande (numéro de commande, délai, lien de suivi) ;
4. Le premier post sur les réseaux sociaux choisi par le fondateur ;
5. La réponse type à la première réclamation (délai de réponse, remboursement ou re-livraison).

### Règles respectées
Aucun nom, logo, couleur ou slogan copié sur un concurrent. Aucune police, image ou icône sans licence. Ce document n'est pas un conseil juridique en marques.

## Operations

### 1. Ce que l'entreprise fait chaque jour (cycle quotidien)

Une boutique en ligne n'a pas d'ouverture physique, mais elle a un rythme quotidien. Les étapes marquées (client) sont vues par le client.

1. **Vérification du matin (interne)** : vérifier que les API fournisseurs (top-up Fazercards, identité Neferbyte) répondent, consulter le solde du float de caisse fournisseur, lister les commandes en attente.
2. **Commandes entrantes (client)** : le client choisit un pack, son compte joueur est vérifié avant paiement, il paie (MVola, Orange Money ou USDT), la commande est créée.
3. **Vérification d'identité (interne)** : l'identité du joueur (ID + zone/serveur) est validée avant toute livraison ; si l'API fournisseur d'identité est en panne, la commande est mise en attente, pas livrée à l'aveugle (fail-closed).
4. **Paiement confirmé (interne)** : rapprochement du paiement avec la commande (notification MVola / Orange Money / transaction USDT).
5. **Livraison du top-up (client)** : le fournisseur de top-up crédite le compte du client ; le client reçoit une confirmation et peut suivre sa commande (`/suivi/<n>`).
6. **SAV et réclamations (client)** : echec de livraison, compte erroné, remboursement — traité par e-mail/SMS.
7. **Clôture du jour (interne)** : rapprochement des encaissements (MVola, Orange Money, Binance) avec les commandes du jour ; vérification du solde du float fournisseur.
8. **Commande fournisseur (hebdo)** : recharger le float de caisse chez le fournisseur de top-up si le solde est bas.

### 2. Fournisseurs

| Input / équipement | Fournisseur(s) | Prix / comment obtenir | Minimum | Délais | Conditions |
|---|---|---|---|---|---|
| Top-up de jeux (UC, packs) | Fazercards (principal) | Devis à demander — tarifs non consultés | à demander | à demander | à demander |
| Vérification ID/zone joueur | Neferbyte (~34 jeux) | API, clé `x-api-key` côté serveur uniquement ; quota journalier par plan | quota par plan | temps réel | clé API à ne jamais exposer au frontend |
| Encaissement mobile money | MVola, Orange Money | Tarifs opérateurs à demander (frais par transaction) | — | temps réel | selon contrat opérateur |
| Encaissement crypto | Binance (USDT) | selon conditions Binance | — | selon réseau blockchain | selon conditions Binance |
| Hébergement / domaine | à identifier | factures à rassembler | — | — | — |

Aucun de ces prix n'est confirmé dans ce document : chaque ligne doit être renseignée par un devis public ou un contact direct, puis reportée dans `founder/numbers.json` et le CFO relancé.

### 3. Les personnes

- **Fondateur / gérant** : commande, administration du site, SAV, suivi des finances (estimation : temps plein).
- **Une personne support/admin** (estimation) : traitement des réclamations, rapprochement quotidien des encaissements, suivi du float.
- Hypothèse de salaire : à caler sur le SMIG ou le salaire visé par le fondateur (source publique à vérifier pour Madagascar). Charges patronales au-delà du salaire : varient selon le statut — à valider avec un expert-comptable.
- Rota du premier mois : le fondateur assure tout, le support rentre dès que le volume le justifie (ramp : 2 → 10 commandes/jour sur 12 mois).

### 4. Routines (SOPs) — une page chacune

**Ouverture (check du matin)** : 1) API fournisseurs en ligne ? 2) Solde du float fournisseur suffisant ? 3) Liste des commandes en attente de la veille traitée ?

**Traitement d'une commande (cœur du métier)** : 1) Vérifier l'identité du joueur (Neferbyte / Fazercards) — si échec, prévenir le client avant tout paiement. 2) Attendre la confirmation de paiement. 3) Commander le top-up chez le fournisseur. 4) Livrer sur le compte vérifié. 5) Confirmer au client et activer le suivi de commande.

**Réclamation client** : 1) Accuser réception sous 24 h. 2) Vérifier l'identité commandée vs le compte crédité. 3) Si erreur de notre côté : re-livrer ou rembourser selon le cas. 4) Si fournisseur en panne : attendre la reprise ou rembourser. 5) Noter l'incident pour le registre des risques.

**Clôture (fin de journée)** : rapprocher les encaissements MVola / Orange Money / Binance avec les commandes du jour ; tout écart fait l'objet d'une note ; vérifier le solde du float fournisseur et passer commande de recharge si bas.

**Réappro hebdomadaire (float)** : chaque semaine, vérifier le solde fournisseur et commander assez de float pour couvrir la semaine prévisionnelle (selon le ramp de ventes).

### 5. Outils (la plus petite pile)

- **Vente / point de vente** : le site magicgame.store lui-même (panier, checkout, suivi de commande, compte client).
- **Paiements** : MVola, Orange Money, Binance (USDT) — aucun terminal physique nécessaire.
- **Comptabilité** : tableur ou logiciel de comptabilité à choisir (à valider avec l'expert-comptable).
- **Suivi client** : e-mail / SMS pour les confirmations de commande et le SAV.

### 6. Licences, permis et assurances (à confirmer)

Pour une entreprise de commerce de services numériques à Madagascar, vérifier (liste indicative, non exhaustive ; les règles varient et évoluent — confirmer chaque point auprès de l'autorité ou d'un professionnel, ce n'est pas un conseil juridique) :

- Immatriculation au registre de commerce et obtention de la patente (CFE / autorités fiscales malgaches).
- Numéro d'identification fiscale et déclaration de TVA selon les seuils en vigueur.
- Conformité des encaissements par mobile money et cryptomonnaie (règles de change et de services de paiement — à vérifier auprès de la Banque centrale / autorités financières).
- Assurance responsabilité civile professionnelle (à deviser chez un assureur).

### 7. Registre des risques

| Risque | Probabilité | Gravité | Plan |
|---|---|---|---|
| Fournisseur de top-up en panne ou en rupture | moyenne | élevée | commandes en attente, communication client, remboursement si prolongé |
| API d'identité (Neferbyte) en panne / quota épuisé | moyenne | moyenne | mise en attente des commandes (fail-closed), jamais de livraison non vérifiée |
| Panne de MVola / Orange Money | moyenne | élevée | basculer sur l'autre opérateur ou USDT, prévenir les clients |
| Compte joueur mal vérifié → mauvaise livraison | faible | élevée | vérification obligatoire avant paiement ; re-livraison ou remboursement |
| Fraude / paiement contesté | faible | élevée | vérification d'identité, seuils, remboursement au cas par cas |
| Clé API fournisseur exposée | faible | critique | clés côté serveur uniquement, rotation en cas de doute |
| Site lent ou inaccessible (réseaux lents, 390 px) | moyenne | moyenne | optimiser le front (déjà mobile-first), surveiller le checkout |
| Perte des données (commandes, utilisateurs) | faible | critique | sauvegardes MongoDB régulières, tester la restauration |
| Gérant indisponible (maladie) | moyenne | élevée | documenter les SOPs (ce document), former un remplaçant |
| Mois de ventes faibles (ramp plus lent que prévu) | élevée | élevée | réduire les coûts fixes, viser le seuil de rentabilité (12 commandes/jour), réviser les prix |

## Not done yet

- What the board said: run /founder-board
- The buyer panel: run /founder-consumer
- Pricing: run /founder-pricing
- Launch plan: run /founder-launch

_The panel is simulated buyers and the numbers are projections from your inputs. Confirm demand with real customers and costs with real quotes before you spend. Not financial, legal or tax advice._
