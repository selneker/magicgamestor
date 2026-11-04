# Fixtures SDUI — contrat aluu-admin v0

Copies et échantillons du contrat `/home/selneker/Projects/GameStore/contracts/aluu-admin/`
(dépôt hors application — jamais modifié, jamais servi). Importés uniquement par les
tests (jest) ; aucun appel réseau n'y touche.

| Fichier | Source |
|---|---|
| `screen-provider.json` | copie **fidèle** (octets) de `screen-provider.json` |
| `screen-mapping.json` | copie **fidèle** (octets) de `screen-mapping.json` |
| `preview-response.json` | échantillon § 3.3 du README (rows `proposed`/`ambiguous`/`missing`, `summary` ignoré côté client) |
| `apply-response.json` | échantillon § 3.4 du README (réponse 200 d'apply) |
| `error-codes.json` | liste des 22 `codes[].code` de `errors.json` |
| `errors-samples.json` | une erreur par famille de scope (`validate`, `preflight`, `fulfill`, `webhook`, `config`, `mapping`, `refresh`, `reconciliation`, `all`) + le 403 d'authentification sans `code` (enveloppe FastAPI `{ detail }`) |

Copie du 2026-10-28. Empreintes SHA-256 des originaux au moment de la copie :

```
9cb614b10054b0f26502e1b90f02c608b0611cb42cadaece34e105cf60c87658  errors.json
538bd35cb1553a2f13a35e4bc92cf89378bf278c6583a04795c9c77b412012ce  i18n-keys.json
2d8489fd751ce9013e0a9e23928ead88b00f5fd7bba914f6180f89431186b1db  screen-mapping.json
beca9de088ee6086e99ab179abc74e45b6f4972c44c35dc0c94072f094aeb357  screen-provider.json
c9fc2370cdfbc93eeef2ccd06e10bb8168868e6604c3fe952d05e64c0d0896c9  README.md
```

Si le contrat évolue : nouvelle version = nouveau dossier du contrat (règle du README) ;
renouveler ici la copie, la date et les empreintes — jamais modifier une copie consommée
par un test déjà passé.
