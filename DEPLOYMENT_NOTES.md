# Magic Game Store — Notes d'exploitation (itération sécurité paiement / auth / fidélité)

## 1. Variables d'environnement backend (Render → magicgamestore-api-v2 → Environment)

Existantes (inchangées) : `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `FRONTEND_URL`,
`BACKEND_PUBLIC_URL`, `CORS_ORIGINS`, `COOKIE_DOMAIN=.magicgame.store`, `PAYMENT_MODE=papi`, `PAPI_API_BASE`,
`PAPI_API_KEY`, `PAPI_WEBHOOK_SECRET`, `MVOLA_MERCHANT_MSISDN`, `ORANGE_MERCHANT_NUMBER`, `VAPID_*`.

Nouvelles (toutes optionnelles avec valeur par défaut, sauf mention) :

| Variable | Rôle | Défaut |
|---|---|---|
| `PAYMENT_TIMEOUT_MINUTES` | Deadline interne d'une tentative | `15` |
| `ORDERS_PER_HOUR_PER_IP` / `ORDERS_PER_HOUR_PER_USER` | Anti-spam création de commandes | `30` / `20` |
| `PAYMENT_INITIATE_PER_10MIN_PER_IP` / `_PER_USER` | Anti-spam tentatives | `15` / `10` |
| `PAYMENT_RETRY_MIN_SECONDS` | Délai minimum entre deux tentatives d'une commande | `20` |
| `PAYMENT_MAX_ATTEMPTS` | Tentatives max par commande | `8` |
| `LOGIN_PER_10MIN_PER_IP`, `REGISTER_PER_HOUR_PER_IP`, `AUTH_EMAILS_PER_HOUR_PER_IP`, `FORGOT_PER_HOUR_PER_EMAIL`, `VERIFY_EMAILS_PER_HOUR` | Anti-abus auth | `30`,`10`,`10`,`3`,`3` |
| `RATE_LIMIT_TRUSTED_IPS` | IPs exemptées (laisser vide en prod) | vide |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **Requis** pour le bouton Google | — |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | **Requis** pour les emails (Mailjet Send API v3.1, HTTPS) | — |
| `MAILJET_FROM_EMAIL`, `MAILJET_FROM_NAME` | Expéditeur validé dans Mailjet | `admin@magicgame.store`, `Magic Game Store` |

Les emails partent en HTTPS vers `https://api.mailjet.com/v3.1/send` (Basic Auth clé/secret) : Render Free bloque
le trafic sortant SMTP 25/465/587, ce qui provoquait les `TimeoutError`. Aucune variable `SMTP_*` n'est plus utilisée
(elles peuvent être supprimées du service Render). Sans `MAILJET_*`, les emails sont journalisés « skipped »
(aucune erreur côté utilisateur).
Sans `GOOGLE_*`, `/api/auth/google/start` répond 503 et le bouton affiche un toast d'erreur.

Frontend (Render → magicgamestore-web-v2) : rien de nouveau (`REACT_APP_BACKEND_URL` inchangé).

## 2. Google Cloud Console (action manuelle — rien n'est simulé)

1. **APIs & Services → OAuth consent screen (Branding)**
   - App name : `Magic Game Store`
   - User support email : email du compte propriétaire
   - App logo : image 120×120 du wordmark officiel (voir §5)
   - App domain → Application home page : `https://magicgame.store`
   - Privacy policy / Terms : pages du site si disponibles
   - **Authorized domains** : `magicgame.store`
   - Publishing status : **In production** (sinon seuls les testeurs peuvent se connecter)
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type : `Web application`
   - Name : `Magic Game Store Web`
   - Authorized JavaScript origins : `https://magicgame.store`, `https://www.magicgame.store`
   - **Authorized redirect URIs** : `https://api.magicgame.store/api/auth/google/callback`
3. Copier Client ID / Client secret dans Render (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) → redéployer l'API.

Flux : bouton → `GET api/auth/google/start` → Google → `GET api/auth/google/callback` (state + nonce vérifiés,
échange du code côté serveur, claims `iss`/`aud`/`email_verified` contrôlés) → cookies `access_token`/`refresh_token`
sur `.magicgame.store` → redirection `https://magicgame.store/compte`. Plus aucune URL `emergentagent.com` dans le flux.
Les comptes Google existants (créés via l'ancien flux) sont retrouvés par email : aucune migration nécessaire.

## 3. Papi (tableau de bord)

- Onglet **Développeur** de la boutique : la clé API (`PAPI_API_KEY`) et le **Secret de signature des notifications**
  (`PAPI_WEBHOOK_SECRET`, format `pwhsec_…`) doivent correspondre à Render.
- `notificationUrl` envoyée par le backend : `https://api.magicgame.store/api/payments/papi/notification`.
- Direct vs Transit : réglage **par méthode de paiement côté Papi**. Aucun changement de code ni de `PAYMENT_MODE`
  n'est requis ; ne renseigner `MVOLA_MERCHANT_MSISDN` / `ORANGE_MERCHANT_NUMBER` qu'avec les numéros marchands réels.
- Références : tentative 1 = `MGS-XXXXXX`, tentatives suivantes = `MGS-XXXXXX-A2`, `-A3`… (une référence Papi
  par tentative, jamais réutilisée). `validDuration` reste `1` heure ; la deadline de 15 minutes est interne.
- Un `SUCCESS` reçu après la deadline → statut `late_success` sur la tentative + bandeau `late_payment` sur la commande
  + audit `payment.late_success` : **traitement manuel** (admin : commande `expired` → `paid` ou remboursement).

## 4. Migrations (automatiques au démarrage, rétro-compatibles)

- `payments` : l'index unique `order_id` est remplacé par unique `client_ref` (les anciens documents = tentative 1).
- `users` : `email_verified` (Google → true, mot de passe → false), `loyalty {earned,promo}`, `auth_version` ajoutés.
- Nouvelles collections : `payment_events`, `auth_tokens` (TTL), `oauth_states` (TTL), `loyalty_ledger`,
  `loyalty_rewards`, `loyalty_redemptions`, `loyalty_transfers`, `audit_logs`.
- Nouveau statut de commande `expired` (transitions : `expired → paid|cancelled`).
- Suppression admin d'une commande payée/livrée refusée (409) : annuler à la place.

## 5. Logo / identité

Le Header n'utilise **pas** de fichier image : le logo officiel est un wordmark typographique rendu en JSX
(`Magic` + bloc `Game` sur fond `#C5FE02` + `Store`, police Archivo, `frontend/src/components/layout/Header.js`).
Les emails reproduisent exactement ce wordmark en HTML. Pour Google (image obligatoire) il faut exporter ce même
wordmark en PNG 120×120 — aucun autre logo n'a été créé. `public/icon-192.png` / `icon-512.png` (carré bleu « MGS »)
ne correspondent pas à la charte et n'ont pas été touchés.
