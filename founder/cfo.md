# Unit economics: Magic Game Store — recharges de jeux vidéo à Madagascar (magicgame.store)

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

## One commande

| line | per commande |
| --- | ---: |
| Price | $15,000.00 |
| Coût fournisseur de top-up (revente UC/packs) | -$13,200.00 |
| Frais de paiement (MVola / Orange Money / USDT) | -$300.00 |
| Vérification d'identité joueur (API fournisseur) | -$100.00 |
| **Contribution** (what each commande leaves to pay the fixed costs) | **$1,400.00** (9%) |

## The margin that matters

Fixed costs: $490,000 a month (Salaire gérant (1 équivalent temps plein) $400,000, Hébergement backend, domaines, outils SaaS $60,000, Frais divers (assurance, bancaires) $30,000).

- **Break-even: 12 commandes a day.** Below that you lose money every month.
- **Profit margin at your plan** (8 a day): **-4%** of every sale, after every cost.

## Year 1, month by month

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

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | -4% | 12 | -$2,898,000 |
| Price -10% | -16% | never | -$6,093,000 |
| Volume -20% | -8% | 12 | -$3,494,400 |
| Unit costs +15% | -18% | never | -$7,243,200 |

## Red flags

- Year 1 loses money on operations (-$2,898,000).
- The startup spend is not earned back within year 1.
