# Marque — Magic Game Store

## Brief (déjà rassemblé)
- `founder/idea.md` : boutique de recharges de jeux vidéo pour Madagascar, prix en ariary, compte vérifié avant paiement.
- `founder/marketing.md` : positionnement joueurs malgaches sur mobile, réseaux lents, paiement MVola / Orange Money / USDT.
- `founder/competitors.md` : aucun concurrent répertorié à ce jour (à faire).
- Panel d'acheteurs : **non encore réalisé** — la marque est bâtie sur le positionnement marketing, pas sur des réactions d'acheteurs réelles. À faire avec `/founder-consumer` avant de figer l'identité.

## 1. Le nom existant
Le magasin existe déjà sous **Magic Game Store** (`magicgame.store`). Évaluation rapide :

| critère | évaluation |
|---|---|
| Ce qu'il dit | Magasin de jeux, clair et descriptif |
| À l'oreille | facile à dire en français comme en anglais |
| Sur une enseigne / icône d'app | lisible, mais générique ("magic" et "game" sont très usités) |
| Risque | confusion possible avec d'autres boutiques de jeux ; disponibilité de la marque et des noms de domaine non vérifiée |

Si le fondateur veut conserver ce nom, les vérifications ci-dessous sont obligatoires avant tout investissement dans l'identité visuelle.

## 2. Dix noms de remplacement (si changement souhaité)

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

## 3. Vérifications à faire par le fondateur (pas de marque tant que rien n'est déposé)

- **Marque** : rechercher dans le registre compétent pour Madagascar (OAPI — Organisation africaine de la propriété intellectuelle, qui couvre Madagascar) et, si visée à l'international, WIPO Global Brand Database, EUIPO (UE) ou USPTO (US). Classes à vérifier : 9 (logiciels, téléchargements de jeux), 35 (vente au détail de jeux/recharges), 38 (télécommunications), 42 (services informatiques). Je ne peux faire que des recherches publiques ; un avocat en propriété industrielle confirme la disponibilité. Rien n'est protégé tant que le fondateur n'a pas déposé.
- **Domaine** : `magicgame.store` est déjà utilisé. Vérifier si `magicgame.com`, `.mg`, `.com.mg` ou alternatives sont libres (noms de registre, pas d'assomption).
- **Handles** : Instagram, TikTok, X, YouTube — vérifier la disponibilité de chaque nom retenu.
- **Confusion** : aucun nom retenu ne doit se rapprocher d'un concurrent répertorié dans `founder/competitors.md` (liste encore à constituer).

## 4. Voix et promesse

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

## 5. Look (brief)

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

## Règles respectées
Aucun nom, logo, couleur ou slogan copié sur un concurrent. Aucune police, image ou icône sans licence. Ce document n'est pas un conseil juridique en marques.
