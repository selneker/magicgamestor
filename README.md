# Magic Game Store — v2 (`selneker/magicgamestor`)

Boutique PUBG Mobile UC (Madagascar). Stack : **React + CRACO** (frontend) · **FastAPI + Motor/MongoDB** (backend) · paiements MVola / Orange Money via **PAPI**.

Ce dépôt remplace progressivement l'ancien projet `selneker/magicgamestore` (toujours en production sur `magicgame.store`). Les deux dépôts ne sont **pas** fusionnés.

```
selneker/magicgamestor
├── backend/    → Render Web Service  (magicgamestore-api-v2)  → MongoDB Atlas (nouvelle base)
├── frontend/   → Render Static Site  (magicgamestore-web-v2)  → appelle le backend via REACT_APP_BACKEND_URL
└── render.yaml → Blueprint déclarant les deux services
```

---

## 1. Développement local

```bash
# Backend
cd backend
cp .env.example .env            # remplir les valeurs (jamais commité)
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend
cd frontend
cp .env.example .env            # REACT_APP_BACKEND_URL=http://localhost:8001
yarn install
yarn start
```

Le backend démarre sur une base **vide** : `core/seed.py` crée automatiquement l'admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), le catalogue, l'événement par défaut et les settings.

Endpoints de santé :

| Route | Réponse |
|---|---|
| `GET /health` | `{"status":"ok"}` — utilisé par le Health Check Render |
| `GET /api/` | `{"name":"Magic Game Store API","status":"ok"}` |

---

## 2. Déploiement Render (Blueprint)

1. Render → **Blueprints** → *New Blueprint Instance* → dépôt `selneker/magicgamestor`, branche `main`.
2. Render lit `render.yaml` et crée **deux services** dans le projet « Magic Game Store » :
   - `magicgamestore-api-v2` (Python web service, rootDir `backend`)
   - `magicgamestore-web-v2` (Static Site, rootDir `frontend`)
3. Saisir les variables `sync: false` demandées (voir tableaux ci-dessous). `JWT_SECRET` est généré par Render.
4. Attendre la fin des deux déploiements. Le frontend reçoit automatiquement `REACT_APP_BACKEND_URL` = URL publique du backend (`fromService`).
5. Renseigner ensuite `FRONTEND_URL`, `CORS_ORIGINS` et `BACKEND_PUBLIC_URL` sur le backend avec les URLs réellement attribuées, puis *Manual Deploy* du backend.

### Configuration manuelle équivalente (si pas de Blueprint)

**Backend — Web Service**

| Champ | Valeur |
|---|---|
| Name | `magicgamestore-api-v2` |
| Repository / Branch | `selneker/magicgamestor` / `main` |
| Root Directory | `backend` |
| Runtime | Python |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn server:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

**Frontend — Static Site**

| Champ | Valeur |
|---|---|
| Name | `magicgamestore-web-v2` |
| Repository / Branch | `selneker/magicgamestor` / `main` |
| Root Directory | `frontend` |
| Build Command | `yarn install --frozen-lockfile && yarn build` |
| Publish Directory | `build` |
| Redirect/Rewrite | Source `/*` → Destination `/index.html` → **Rewrite** (React Router) |

---

## 3. Variables d'environnement — Backend (`magicgamestore-api-v2`)

| Variable | Obligatoire | Staging (Phase 1) | Production (Phase 2) | Notes |
|---|---|---|---|---|
| `MONGO_URL` | oui | `mongodb+srv://…` (Atlas, **nouvelle** base) | idem | Ne jamais réutiliser `MONGODB_URI` ni l'ancienne base |
| `DB_NAME` | oui | `magicgamestore_prod` | `magicgamestore_prod` | Base vide au premier démarrage |
| `JWT_SECRET` | oui | `generateValue: true` | idem | Nouveau secret aléatoire (≥ 32 octets) |
| `ADMIN_EMAIL` | oui | email admin | idem | Compte créé par `seed.py` |
| `ADMIN_PASSWORD` | oui | **nouveau** mot de passe | idem | Jamais dans le code / Git |
| `FRONTEND_URL` | oui | `https://magicgamestore-web-v2.onrender.com` | `https://magicgame.store` | Redirections success/failure PAPI |
| `BACKEND_PUBLIC_URL` | recommandé | `https://magicgamestore-api-v2.onrender.com` | URL publique stable du backend | Webhook PAPI `…/api/payments/papi/notification`. Si vide : `RENDER_EXTERNAL_URL` |
| `CORS_ORIGINS` | oui | `https://magicgamestore-web-v2.onrender.com` | `https://magicgame.store,https://www.magicgame.store` | Liste CSV. `*` est ignoré par le code |
| `PAYMENT_MODE` | oui | `simulation` | `papi` (après validation) | |
| `PAPI_API_BASE` | oui | `https://app.papi.mg/engine/api` | idem | |
| `PAPI_API_KEY` | prod | vide ou clé test | **nouvelle** clé PAPI | Régénérer (ancienne compromise) |
| `PAPI_WEBHOOK_SECRET` | prod | vide | **nouveau** secret webhook | Régénérer (ancien compromis) |
| `MVOLA_MERCHANT_MSISDN` | oui | numéro MVola | idem | Affiché au client (fallback USSD) |
| `ORANGE_MERCHANT_NUMBER` | oui | numéro Orange Money | idem | |
| `PYTHON_VERSION` | oui | `3.11.9` | idem | Fixé dans `render.yaml` |

`PORT` est fourni par Render ; le serveur écoute sur `0.0.0.0:$PORT`.

## 4. Variables d'environnement — Frontend (`magicgamestore-web-v2`)

| Variable | Obligatoire | Valeur | Notes |
|---|---|---|---|
| `REACT_APP_BACKEND_URL` | oui | `https://magicgamestore-api-v2.onrender.com` | Sans slash final. Injectée **au build** (`fromService` dans le Blueprint). Tout changement ⇒ rebuild du Static Site |

Ne pas utiliser `REACT_APP_API_URL`. Ne jamais pointer vers l'ancien backend.

---

## 5. Sécurité — credentials compromises

Le dépôt contenait publiquement `backend/.env`. Ces fichiers ne sont plus suivis par Git (`.gitignore` : `.env`, `.env.*`, `!.env.example`) mais l'historique Git les conserve. **Toutes** les valeurs qui s'y trouvaient sont compromises. Avant la mise en production, régénérer :

- `JWT_SECRET`
- `ADMIN_PASSWORD`
- clé API PAPI et secret webhook PAPI (dashboard PAPI → régénérer)
- mot de passe / utilisateur MongoDB de l'ancienne base si elle reste en ligne

Ne jamais recopier les anciennes valeurs dans Render.

---

## 6. Webhook PAPI

- `successUrl` / `failureUrl` → `FRONTEND_URL/suivi/<order_number>?pubg_id=…&return=success|failure`
- `notificationUrl` → `BACKEND_PUBLIC_URL/api/payments/papi/notification` (jamais le Static Site)
- Signature `X-Papi-Signature` (HMAC-SHA256, tolérance 300 s) vérifiée dans `services/payments.py` — ne jamais désactiver en production.

---

## 7. Procédure de bascule du domaine (`magicgame.store`)

**Phase 1 — Staging (DNS inchangé)**
1. Déployer les deux services v2 ; l'ancien service continue de servir `magicgame.store`.
2. `PAYMENT_MODE=simulation`, `FRONTEND_URL`/`CORS_ORIGINS` = URL du Static Site v2.
3. Dérouler les tests de la section 8 sur `https://magicgamestore-web-v2.onrender.com`.

**Phase 2 — Production (toujours DNS inchangé)**
1. Backend : `PAPI_API_KEY`, `PAPI_WEBHOOK_SECRET` (nouvelles valeurs), `PAYMENT_MODE=papi`.
2. Backend : `FRONTEND_URL=https://magicgame.store`, `CORS_ORIGINS=https://magicgame.store,https://www.magicgame.store` (garder temporairement l'URL onrender du Static Site dans la liste pour continuer à tester).
3. Vérifier `BACKEND_PUBLIC_URL`, une commande réelle de faible montant (30 UC), le callback webhook et le passage `pending_payment → paid`.

**Cutover DNS**
1. Render → `magicgamestore-web-v2` → *Settings → Custom Domains* → ajouter `magicgame.store` **et** `www.magicgame.store`. Render affiche les enregistrements attendus.
2. Chez le registrar : remplacer les enregistrements actuels par ceux indiqués par Render
   - `magicgame.store` : `A` → IP Render du Static Site (ou `ALIAS/ANAME` → `magicgamestore-web-v2.onrender.com`)
   - `www` : `CNAME` → `magicgamestore-web-v2.onrender.com`
3. Attendre la validation + certificat TLS Render (quelques minutes à 1 h). Render redirige automatiquement `www.magicgame.store` → `magicgame.store` (domaine principal = apex).
4. Vérifier : `/`, `/boutique`, `/suivi/<n°>`, `/admin` en rafraîchissant directement (rewrite SPA), aucune erreur CORS, cookies `access_token`/`refresh_token` posés (Secure, SameSite=None), login → refresh → logout.
5. Retirer l'URL onrender du Static Site de `CORS_ORIGINS` si souhaité.

**Après migration** (après plusieurs jours de vérification) : suspendre l'ancien service Render, archiver l'ancien dépôt, décider du sort de l'ancienne base, révoquer les anciennes credentials, vérifier qu'aucune variable Render ne pointe vers l'ancien projet.

---

## 8. Checklist de tests

Backend : `GET /health`, `GET /api/`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/refresh`, `POST /api/auth/logout`.

Frontend : `/`, `/boutique`, `/produit/*`, `/commande`, `/suivi`, `/suivi/*`, `/connexion`, `/inscription`, `/compte`, `/admin` (avec rafraîchissement direct).

E-commerce : boutique → produit → panier → quantité → checkout (PUBG ID, pseudo, méthode) → commande → MongoDB → suivi → paiement simulé (~8 s) → statut `paid`.

Admin : login, dashboard, catalogue, commandes, événements, statistiques, changement de statut, déconnexion.

Google : connexion, création auto du compte, cookie session, logout, refresh, `/compte`, `/admin`.

---

## Mise à jour ciblée — thème, notifications, chat et abonnements

- Thème clair/sombre global via `next-themes` déjà installé, préférence `mgs-theme` dans localStorage, préférence système à la première visite et initialisation avant rendu. Les toasts existants restent en place.
- Chat privé `/chat` (compte obligatoire) et `/admin/messages`, une conversation persistante par compte, historique paginé, messages de 2 000 caractères maximum et non-lus. Polling visible uniquement : messages 5 s, liste 10 s, badge 20 s. L’authentification existante n’a pas été modifiée.
- Une commande contenant `items.type = prime|prime_plus` maximum par `pubg_id`, tous statuts et toutes durées confondus. Un index unique partiel protège aussi les requêtes concurrentes et prend en compte les commandes existantes. Les commandes UC seules ne sont pas concernées, y compris après un achat Prime. Un panier mixte compte comme commande d’abonnement. L’erreur HTTP 409 est affichée par les toasts existants.
- Index partiel avec `$in` : MongoDB 6.0+ requis (Atlas compatible). S’il existe déjà plusieurs commandes d’abonnement pour un même PUBG ID, MongoDB refusera la création de l’index ; aucune commande ne sera supprimée automatiquement. Vérifier ces doublons avant une future mise en service. La règle porte sur les commandes conservées en base ; la suppression définitive existante retire aussi l’entrée d’index.

### Notifications système admin (Web Push / VAPID)

Dépendance backend ajoutée : `pywebpush==2.5.0` (dépendances transitives de chiffrement installées par pip). Aucune dépendance frontend ajoutée. Service Worker `/sw.js`, sans cache ni interception des paiements/API. Le manifeste permet l’ajout à l’écran d’accueil.

Variables **backend uniquement**, à configurer ultérieurement dans Render > Environment, sans modifier `render.yaml` :

| Variable | Contenu |
|---|---|
| `VAPID_PRIVATE_KEY_PEM` | Clé privée EC P-256 PEM, multiligne ou avec `\n` échappés ; secret serveur uniquement |
| `VAPID_PUBLIC_KEY` | Clé publique P-256 brute (point non compressé), encodée base64url sans padding |
| `VAPID_SUBJECT` | Contact valide `mailto:adresse-admin` |
| `PUSH_ENDPOINT_HOSTS` | `fcm.googleapis.com,updates.push.services.mozilla.com,*.push.apple.com` |

Générer une paire stable dans un environnement de confiance avec `vapid --gen` (fourni par py-vapid), puis convertir la clé publique :

```python
import base64
from cryptography.hazmat.primitives import serialization
with open("public_key.pem", "rb") as f:
    key = serialization.load_pem_public_key(f.read())
print(base64.urlsafe_b64encode(key.public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)).decode().rstrip("="))
```

Conserver la même paire entre déploiements. Ne jamais copier la clé privée dans le frontend, le README ou Git. Les clés locales de test sont uniquement dans le `.env` ignoré. Aucune variable frontend supplémentaire n’est nécessaire.

Dans l’admin : **Activer les notifications** demande la permission après clic, inscrit cet appareil, puis **Tester la notification** envoie un véritable Web Push. **Désactiver** retire l’inscription. Un clic sur une notification ouvre `/admin/commandes?order=<id>` ; la connexion existante est requise si la session a expiré. Les inscriptions 404/410 sont supprimées, les erreurs temporaires conservées. L’inscription, la suppression et les tests sont réservés aux administrateurs. Les destinations sont limitées aux services Push autorisés, sans redirections HTTP.

Limites navigateur : HTTPS et autorisation système nécessaires ; le mode « Ne pas déranger », les politiques du navigateur ou l’arrêt complet du navigateur peuvent empêcher l’affichage. Sur iOS/iPadOS 16.4+, ajouter le site à l’écran d’accueil et l’ouvrir depuis cette icône. La réception en arrière-plan ne dépend pas du polling de l’admin. L’envoi utilise une tâche de fond FastAPI après création de commande ; pas de file durable, donc une interruption du serveur pendant l’envoi peut perdre une notification. Un backend Render Free endormi peut retarder la création de commande au réveil. Le bouton d’activation indique clairement l’absence de configuration VAPID si les variables ne sont pas encore renseignées.

Aucun déploiement n’est effectué par cette mise à jour. Pour enregistrer le code sur GitHub, utiliser **Save to Github**, avec le message demandé : `Add dark mode, admin push notifications and customer chat`.

---

## 9. Interdits

Ne pas : fusionner les dépôts · utiliser l'ancien `server.js` / `package.json` · utiliser `MONGODB_URI` · déployer React et FastAPI dans un même service · servir React depuis FastAPI · `CORS_ORIGINS=*` · secrets dans Git ou `render.yaml` · réutiliser l'ancienne base · activer PAPI réel avant les tests · envoyer le webhook au frontend · changer le DNS avant validation · supprimer l'ancien service avant validation.
