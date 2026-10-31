# Test local de la vérification d'identité (PL-003-SMOKE-2)

Procédure d'exploitation pour faire tourner `backend/scripts/smoke_identity.py` contre un
backend **local**, sur une **copie** de la base de production (`mgs_copy`), **sans aucune clé
réelle** et sans qu'aucun service externe puisse être appelé.

## 1. Prérequis

- MongoDB local sur `mongodb://localhost:27017`, base `mgs_copy` (copie déjà migrée par
  `python -m core.identity_keys`).
- Un `backend/.env` (fichier **ignoré par Git**, `.gitignore:38`) créé à partir de
  `.env.example`. Modèle ci-dessous, section 2.

## 2. Variables du `.env` local

Tout est lu par `server.py:2-4` (`load_dotenv(Path(__file__).parent / ".env")`) **avant**
`from core.db import client` (`server.py:14`) : l'ordre d'import est correct, il ne faut donc
pas de `--env-file` ni de répertoire de lancement particulier.

| Variable | Valeur locale | Rôle |
|---|---|---|
| `MONGO_URL` | `mongodb://localhost:27017` | **obligatoire dès l'import** (`core/db.py:4`) |
| `DB_NAME` | `mgs_copy` | **obligatoire dès l'import** (`core/db.py:5`) |
| `JWT_SECRET` | aléatoire local | signature des jetons (`core/security.py:57`, `routers/auth.py:350`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | compte de test local | `seed_all()` (`core/seed.py:90-93`) : crée/actualise ce super-admin |
| `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `CORS_ORIGINS` | `http://localhost:3000`, `http://localhost:8001` | CORS + anti-CSRF (`core/origins.py`) |
| `COOKIE_DOMAIN` | **vide** | cookie limité à l'hôte (le domaine `.magicgame.store` n'a pas de sens en local) |
| `PAYMENT_MODE` | `simulation` | aucune passerelle PAPI appelée (`services/payments.py:21-26`) |
| `PAPI_API_BASE`, `FIVEONE_API_BASE`, `BINANCE_API_BASE`, `FAZERCARDS_API_BASE`, `NEFERBYTE_API_BASE` | `http://127.0.0.1:9` | adresse locale inatteignable : aucune sortie réseau possible |
| `*_API_KEY`, `*_SECRET` | **vides** | chaque service a un `configured()` faux ⇒ aucun envoi |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | vides | `services/mailer.py:17-19` : aucun e-mail |
| `VAPID_*` | vides | `services/push.py:35-36` : aucune notification |
| `NEFERBYTE_CACHE_SECRET` | aléatoire local | HMAC du cache (aucun ID en clair) |

`FIVEONE_API_BASE` / `FIVEONE_API_KEY` (passerelle de paiement secondaire,
`services/fiveone.py:15-16`) **ne figurent pas dans `.env.example`** : les renseigner quand
même, vides + URL locale, pour qu'aucun défaut implicite ne s'applique.

## 3. Ce qui s'exécute tout seul

| Tâche | Fichier:ligne | Fréquence | Sortie réseau possible ? |
|---|---|---|---|
| `binance_watcher.run_forever` | `server.py:40`, `services/binance_watcher.py:186-189` | boucle, 30 s | **Non** avec des clés vides : `binance.configured()` (`services/binance.py:28-30`) est faux et `check_once` sort après `expire_due()` (`:158-161`) |
| `expire_due` (appelée par la boucle) | `services/binance_watcher.py:71-76` | 30 s | Non : écrit seulement en base locale (paiements crypto expirés) |
| `on_order_paid` (livraison fournisseur) | `services/binance_watcher.py:107` | à la confirmation d'un dépôt | **Inatteignable** sans clés Binance |
| Migrations de démarrage | `server.py:29-39` | une fois | Non : lecture/écriture locale, additives |

Aucune autre tâche de fond : tous les autres traitements différés sont des `BackgroundTasks`
FastAPI, donc déclenchés **par une requête**, jamais par le démarrage.

## 4. Les trois étapes pour Selneker

1. **Clé FazerCards** (seule intervention manuelle dans `backend/.env`) :

   ```
   FAZERCARDS_API_BASE=https://api.fzr.cards/api/v2
   FAZERCARDS_API_KEY=<la clé 32+ caractères du panneau reseller>
   ```

2. **Démarrer le backend** (depuis `backend/`) :

   ```bash
   cd backend && python -m uvicorn server:app --host 127.0.0.1 --port 8001
   ```

   Attendre `Application startup complete.`

3. **Lancer le test de fumée**, avec ses propres identifiants (jamais écrits dans un fichier) :

   ```bash
   cd backend
   export SMOKE_PUBG_ID='<ton_id_pubg>'
   export SMOKE_FF_ID='<ton_id_free_fire>'
   python scripts/smoke_identity.py; echo "code = $?"
   ```

## 5. Après le test

```bash
unset SMOKE_PUBG_ID SMOKE_FF_ID SMOKE_FF_SERVER
```

Puis `Ctrl+C` sur uvicorn (ou `pkill -f "uvicorn server:app"`), et remettre `FAZERCARDS_API_KEY=`
vide ainsi que `FAZERCARDS_API_BASE=http://127.0.0.1:9` dans `.env` : sans cela, la prochaine
exécution appellerait le vrai fournisseur.

## 6. Effets connus sur `mgs_copy`

- **Création d'un compte admin** (`ADMIN_EMAIL`) au premier démarrage si l'adresse n'existe
  pas encore. Supprimer ce document (`db.users.delete_one({"email": …})`) suffit à revenir à
  l'état initial.
- Les migrations `server.py:29-39` sont idempotentes ; sur une copie déjà migrée, mesurées à
  **0 document** modifié (journal `mgs.identity`).
- `reconcile_sellable_games()` **désactive** un jeu actif sans catalogue vendable ; elle
  **n'active jamais** un jeu. Une copie dont `call-of-duty` est inactif le reste, et
  `GET /api/games` n'expose alors que les jeux actifs.
