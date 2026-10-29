# Lancer les suites « live » sur `localhost:8001`

Mode d'emploi pour les suites de tests qui parlent à un **vrai serveur** en plus de Mongo :
`test_phase3_games`, `test_multigame_identity_contract`, `test_multigame_core`,
`test_saved_identities`, `test_fzr_phase3`.

Objectif : les exécuter **sans jamais approcher la production** — ni sa base, ni ses clés.

> Ce document ne contient aucun secret et n'en demande aucun. Tout ce qui est généré l'est par
> `openssl` sur ta machine et ne quitte pas `~/mgs-live`.

---

## 0. Ce qu'il faut comprendre avant de commencer

| | |
|---|---|
| Le serveur | lancé **par toi**, sur `127.0.0.1:8001`, avec une base Mongo **jetable** |
| La base | son nom doit contenir « **test** » (ex. `mgs_test_live`) — sinon les tests refusent de tourner |
| Le dossier | une **copie propre** du dépôt, sans le `.env` de production |
| Les clés | aucune clé fournisseur, aucun secret de paiement : ces 5 suites n'en ont pas besoin |

Le garde-fou est dans `backend/tests/conftest.py` : si `DB_NAME` ne contient pas « test »,
`core.db.db` est remplacé par un objet qui **lève au premier accès**. Aucune lecture, aucune
écriture, aucun `delete_many` ne peut atteindre la base configurée. Si tu vois

```
DB_NAME='...' ne contient pas « test » : tests Mongo refusés
```

c'est le garde-fou, pas un bug : corrige `DB_NAME`.

---

## 1. Prérequis (à vérifier une fois)

```bash
python3 --version     # 3.11 ou plus
git --version
openssl version
mongod --version      # ou : docker --version
mongosh --version     # fourni avec MongoDB (sert au nettoyage et au diagnostic)
```

Si tu n'as pas `mongod`, l'option Docker est donnée à l'étape 3.

---

## 2. Un dossier propre, sans `.env` hérité

Depuis le dépôt principal :

```bash
cd /home/selneker/Projects/GameStore/magicgamestor
git worktree add --detach ~/mgs-live feat/changement_fournisseur
cd ~/mgs-live/backend
ls -a | grep -c '^\.env$'      # doit afficher 0
```

**Pourquoi `--detach`** : la branche est déjà ouverte dans ton dépôt principal, git refuse de
l'ouvrir deux fois. En `--detach`, ce dossier est une photo du dernier commit : tu peux tout
casser dedans sans rien changer à ta branche.

**Pourquoi un dossier à part** : ton `.env` de production n'est pas copié (il est ignoré par
git), donc aucune clé réelle n'entre dans la boucle.

---

## 3. Une base Mongo jetable

**Option A — `mongod` local :**

```bash
mkdir -p ~/mgs-mongo
mongod --dbpath ~/mgs-mongo --port 27017 --bind_ip 127.0.0.1
```

**Option B — Docker :**

```bash
docker run --rm -d --name mgs-test-mongo -p 127.0.0.1:27017:27017 mongo:7
```

Laisse ce terminal ouvert (c'est le terminal « Mongo »).

---

## 4. Un `.env` minimal, local, jetable

```bash
cd ~/mgs-live/backend
umask 077
cat > .env <<EOF
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=mgs_test_live
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@mgs-test.example.com
ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
chmod 600 .env
```

Cinq lignes, aucune clé fournisseur. `DB_NAME=mgs_test_live` contient « test » → le garde-fou
laisse passer.

**Pourquoi ce fichier est obligatoire alors que le dossier est « propre »** : deux modules le
lisent **à l'import** (`tests/test_multigame_core.py` via `dotenv_values`, et
`tests/test_saved_identities.py` qui en importe les variables). Sans lui, ils échouent à la
collecte, avant même de tester quoi que ce soit. Il ne remplace pas le `.env` de production : il
le remplace **uniquement** dans `~/mgs-live`.

`ADMIN_EMAIL` / `ADMIN_PASSWORD` servent à deux choses : le serveur crée (ou met à jour) ce
compte super-admin au démarrage (`core/seed.py`), et les tests s'en servent pour se connecter.
L'adresse doit passer la validation d'e-mail de l'API : un domaine réservé comme `test.local`
est refusé en `422` (« special-use or reserved name »), d'où `mgs-test.example.com`.

---

## 5. Installer les dépendances du dossier propre

```bash
cd ~/mgs-live/backend
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -c "import fastapi, motor, pytest; print('deps ok')"
```

---

## 6. Terminal A — le serveur sur `:8001`

```bash
cd ~/mgs-live/backend
set -a; . ./.env; set +a          # exporte les 5 variables, sans rien afficher
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
```

Attends la ligne :

```
Magic Game Store API ready (payment mode=...)
```

Vérifie depuis un autre terminal :

```bash
curl -sS http://127.0.0.1:8001/health
```

**Pourquoi `set -a; . ./.env`** : le serveur lit aussi `backend/.env`, mais l'exporter évite tout
doute sur ce que voit le processus. La commande n'affiche rien.

---

## 7. Terminal B — les 5 suites

```bash
cd ~/mgs-live/backend
set -a; . ./.env; set +a          # MÊMES valeurs que le serveur, sinon 401 à la connexion admin

.venv/bin/python -m pytest \
  tests/test_phase3_games.py \
  tests/test_multigame_identity_contract.py \
  tests/test_multigame_core.py \
  tests/test_saved_identities.py \
  tests/test_fzr_phase3.py \
  -n 0 -q
```

Trois détails qui comptent :

- **`python -m pytest`** (pas `pytest` tout court) : `test_saved_identities` importe
  `tests.test_multigame_core`, ce qui suppose `backend/` dans le chemin d'import. `python -m`
  l'ajoute.
- **`-n 0`** : série, un test à la fois. `pytest.ini` impose `-n 2` par défaut ; ces suites
  partagent la même base et le même compte admin, la parallélisation les fait se marcher dessus.
- **sans `BACKEND_TEST_URL`** : le défaut `http://localhost:8001` est déjà le bon.

---

## 8. Lire le résultat

| Module | Attendu |
|---|---|
| `test_phase3_games` | 8 passed |
| `test_fzr_phase3` | 26 passed |
| les trois autres | 0 échec |

Constaté par exécution le 2026-10-28 (BE-010 puis BE-011, base jetable, `-n 0`) : **60 passed,
0 échec** sur les 5 suites. `test_phase3_games` = 8 passed une fois l'isolation de ses deux tests
unitaires corrigée (ils exécutaient l'appel dans une boucle asyncio neuve au lieu de celle du
client Mongo) ; `test_fzr_phase3` = 26 passed après réécriture du test qui décrivait encore
l'ancienne règle « multi-lignes / quantité > 1 refusée », qui n'existe plus (une ligne
`quantity=2` produit deux unités fournisseur).

> Je ne donne pas de total pour `test_multigame_identity_contract`, `test_multigame_core` et
> `test_saved_identities` : je ne peux pas exécuter Mongo dans mon environnement, donc je ne les
> ai jamais vus passer. Ce qui est attendu, c'est **0 échec** ; un échec est à me rapporter tel
> quel (étape 10).

---

## 9. Arrêter et nettoyer

```bash
# terminal B : rien à arrêter
# terminal A : Ctrl-C  (le serveur s'arrête, le client Mongo se ferme)

# terminal Mongo : Ctrl-C (option A)   ou   docker stop mgs-test-mongo (option B)

# supprimer la base jetable
mongosh --quiet "mongodb://127.0.0.1:27017/mgs_test_live" --eval 'db.dropDatabase()'

# supprimer le dossier propre (il contient .env et .venv → --force)
cd /home/selneker/Projects/GameStore/magicgamestor
git worktree remove --force ~/mgs-live
rm -rf ~/mgs-mongo
git worktree list                 # ~/mgs-live ne doit plus apparaître
```

`--force` est nécessaire parce que `.env` et `.venv` ne sont pas suivis par git : sans lui, git
refuse de supprimer un dossier « modifié ».

---

## 10. En cas d'échec — quoi me coller

Colle **ce bloc et rien d'autre**. Il ne contient aucun secret : ni `.env`, ni clé, ni mot de
passe.

```bash
cd ~/mgs-live/backend
python3 --version
.venv/bin/python -m pytest --version
mongosh --quiet "mongodb://127.0.0.1:27017/mgs_test_live" --eval 'db.runCommand({ping:1}).ok'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8001/health
.venv/bin/python -m pytest tests/test_phase3_games.py -n 0 -q --tb=short 2>&1 | tail -40
```

Puis, pour le module qui échoue, la même commande en remplaçant le nom du fichier.

**Ne colle jamais** : le contenu de `.env`, une clé API, un mot de passe, un cookie ou un jeton
d'authentification.

Symptômes courants :

| Message | Cause |
|---|---|
| `DB_NAME='...' ne contient pas « test »` | `DB_NAME` sans « test » → étape 4 |
| `ConnectionError` / `MaxRetryError` sur `27017` | Mongo n'écoute pas → étape 3 |
| `ConnectionError` sur `8001` | le serveur n'est pas lancé → étape 6 |
| `KeyError: 'MONGO_URL'` à la collecte | `.env` absent dans `~/mgs-live/backend` → étape 4 |
| `401` sur `/api/auth/login` | `ADMIN_EMAIL`/`ADMIN_PASSWORD` non exportés dans le terminal B → étape 7 |

---

## 11. Ce que ce mode d'emploi ne couvre pas

D'autres suites du dépôt parlent aussi au serveur, mais elles ont besoin de services externes
(PAPI/Mvola, Binance, Mailjet, push VAPID) : `test_auth_hardening`, `test_payment_lifecycle`,
`test_binance_crypto`, `test_iter*`, `test_phase3_finalization`, `test_session_persistence`…
Elles ne sont pas concernées par la migration ALUU et ne sont pas couvertes ici.

Pour vérifier l'écran admin de l'URL de webhook (BE-005) en local, ajoute cette ligne au `.env`
de `~/mgs-live` **avant** de démarrer le serveur :

```
BACKEND_PUBLIC_URL=http://127.0.0.1:8001
```

La ligne « URL de webhook » de l'écran fournisseur affiche alors
`http://127.0.0.1:8001/api/aluu/webhook` ; sans elle, elle affiche « non configuré ». C'est la
même variable que celle des webhooks PAPI — il n'y en a pas d'autre.
