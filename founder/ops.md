# Opérations — Magic Game Store

## 1. Ce que l'entreprise fait chaque jour (cycle quotidien)

Une boutique en ligne n'a pas d'ouverture physique, mais elle a un rythme quotidien. Les étapes marquées (client) sont vues par le client.

1. **Vérification du matin (interne)** : vérifier que les API fournisseurs (top-up Fazercards, identité Neferbyte) répondent, consulter le solde du float de caisse fournisseur, lister les commandes en attente.
2. **Commandes entrantes (client)** : le client choisit un pack, son compte joueur est vérifié avant paiement, il paie (MVola, Orange Money ou USDT), la commande est créée.
3. **Vérification d'identité (interne)** : l'identité du joueur (ID + zone/serveur) est validée avant toute livraison ; si l'API fournisseur d'identité est en panne, la commande est mise en attente, pas livrée à l'aveugle (fail-closed).
4. **Paiement confirmé (interne)** : rapprochement du paiement avec la commande (notification MVola / Orange Money / transaction USDT).
5. **Livraison du top-up (client)** : le fournisseur de top-up crédite le compte du client ; le client reçoit une confirmation et peut suivre sa commande (`/suivi/<n>`).
6. **SAV et réclamations (client)** : echec de livraison, compte erroné, remboursement — traité par e-mail/SMS.
7. **Clôture du jour (interne)** : rapprochement des encaissements (MVola, Orange Money, Binance) avec les commandes du jour ; vérification du solde du float fournisseur.
8. **Commande fournisseur (hebdo)** : recharger le float de caisse chez le fournisseur de top-up si le solde est bas.

## 2. Fournisseurs

| Input / équipement | Fournisseur(s) | Prix / comment obtenir | Minimum | Délais | Conditions |
|---|---|---|---|---|---|
| Top-up de jeux (UC, packs) | Fazercards (principal) | Devis à demander — tarifs non consultés | à demander | à demander | à demander |
| Vérification ID/zone joueur | Neferbyte (~34 jeux) | API, clé `x-api-key` côté serveur uniquement ; quota journalier par plan | quota par plan | temps réel | clé API à ne jamais exposer au frontend |
| Encaissement mobile money | MVola, Orange Money | Tarifs opérateurs à demander (frais par transaction) | — | temps réel | selon contrat opérateur |
| Encaissement crypto | Binance (USDT) | selon conditions Binance | — | selon réseau blockchain | selon conditions Binance |
| Hébergement / domaine | à identifier | factures à rassembler | — | — | — |

Aucun de ces prix n'est confirmé dans ce document : chaque ligne doit être renseignée par un devis public ou un contact direct, puis reportée dans `founder/numbers.json` et le CFO relancé.

## 3. Les personnes

- **Fondateur / gérant** : commande, administration du site, SAV, suivi des finances (estimation : temps plein).
- **Une personne support/admin** (estimation) : traitement des réclamations, rapprochement quotidien des encaissements, suivi du float.
- Hypothèse de salaire : à caler sur le SMIG ou le salaire visé par le fondateur (source publique à vérifier pour Madagascar). Charges patronales au-delà du salaire : varient selon le statut — à valider avec un expert-comptable.
- Rota du premier mois : le fondateur assure tout, le support rentre dès que le volume le justifie (ramp : 2 → 10 commandes/jour sur 12 mois).

## 4. Routines (SOPs) — une page chacune

**Ouverture (check du matin)** : 1) API fournisseurs en ligne ? 2) Solde du float fournisseur suffisant ? 3) Liste des commandes en attente de la veille traitée ?

**Traitement d'une commande (cœur du métier)** : 1) Vérifier l'identité du joueur (Neferbyte / Fazercards) — si échec, prévenir le client avant tout paiement. 2) Attendre la confirmation de paiement. 3) Commander le top-up chez le fournisseur. 4) Livrer sur le compte vérifié. 5) Confirmer au client et activer le suivi de commande.

**Réclamation client** : 1) Accuser réception sous 24 h. 2) Vérifier l'identité commandée vs le compte crédité. 3) Si erreur de notre côté : re-livrer ou rembourser selon le cas. 4) Si fournisseur en panne : attendre la reprise ou rembourser. 5) Noter l'incident pour le registre des risques.

**Clôture (fin de journée)** : rapprocher les encaissements MVola / Orange Money / Binance avec les commandes du jour ; tout écart fait l'objet d'une note ; vérifier le solde du float fournisseur et passer commande de recharge si bas.

**Réappro hebdomadaire (float)** : chaque semaine, vérifier le solde fournisseur et commander assez de float pour couvrir la semaine prévisionnelle (selon le ramp de ventes).

## 5. Outils (la plus petite pile)

- **Vente / point de vente** : le site magicgame.store lui-même (panier, checkout, suivi de commande, compte client).
- **Paiements** : MVola, Orange Money, Binance (USDT) — aucun terminal physique nécessaire.
- **Comptabilité** : tableur ou logiciel de comptabilité à choisir (à valider avec l'expert-comptable).
- **Suivi client** : e-mail / SMS pour les confirmations de commande et le SAV.

## 6. Licences, permis et assurances (à confirmer)

Pour une entreprise de commerce de services numériques à Madagascar, vérifier (liste indicative, non exhaustive ; les règles varient et évoluent — confirmer chaque point auprès de l'autorité ou d'un professionnel, ce n'est pas un conseil juridique) :

- Immatriculation au registre de commerce et obtention de la patente (CFE / autorités fiscales malgaches).
- Numéro d'identification fiscale et déclaration de TVA selon les seuils en vigueur.
- Conformité des encaissements par mobile money et cryptomonnaie (règles de change et de services de paiement — à vérifier auprès de la Banque centrale / autorités financières).
- Assurance responsabilité civile professionnelle (à deviser chez un assureur).

## 7. Registre des risques

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
