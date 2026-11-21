# PROTO-CONTRAT — modules de logique du prototype statique

Document destiné à l'agent qui possède `frontend/public/index.html` et
`frontend/scripts/proto-functional.mjs`. Il décrit **ce que font** les deux modules
neufs, **ce qu'ils renvoient**, et **ce que l'écran doit afficher**. Aucune règle de
design n'est imposée ici : les modules ne créent aucun élément visible, aucun style,
aucune classe et aucun texte destiné à l'utilisateur.

Étalon : `main`. Chaque comportement reproduit est cité `fichier:ligne`.

| Module | Fichier | Chargé par |
|---|---|---|
| Turnstile | `frontend/public/mgs-logic-captcha.js` | `<script src="mgs-logic-captcha.js"></script>` |
| Binance / USDT | `frontend/public/mgs-logic-crypto.js` | `<script src="mgs-logic-crypto.js"></script>` |
| Tests | `frontend/scripts/proto-logic.test.mjs` | `cd frontend && node scripts/proto-logic.test.mjs` |

Les deux fichiers sont des scripts classiques (pas de module ES) : ils exposent
`window.MGS_CAPTCHA` et `window.MGS_CRYPTO`. Aucune dépendance, aucun appel réseau
hors `fetch` vers le backend et hors le CDN Cloudflare.

---

## 1. `MGS_CAPTCHA` — Cloudflare Turnstile

Reproduit `frontend/src/components/common/CaptchaWidget.js` : script explicite
(`:13`), taille `flexible` (`:58`), apparence `interaction-only` (`:110-114`),
thème et langue du document (`:60-67`), jeton vidé à l'expiration et à l'erreur
(`:118-121`), `reset()` après une erreur `captcha_required` (`:128-136`).

### `MGS_CAPTCHA.siteKey()` → `string`

Clé **publique** du site, ou `""`. Sources, dans cet ordre :

1. `window.MGS_TURNSTILE_SITE_KEY` ;
2. `<meta name="mgs-turnstile-sitekey" content="…">`.

`main` la lit au build via `process.env.REACT_APP_TURNSTILE_SITE_KEY`
(`CaptchaWidget.js:47-51`). Le prototype n'a pas d'étape de build : il faut donc
fournir la valeur par l'une des deux sources ci-dessus (voir « Points ouverts »).

### `MGS_CAPTCHA.enabled()` → `boolean`

`true` si une clé est présente. Quand c'est `false`, **le champ `captcha_token`
doit être omis** de toutes les requêtes : le backend l'ignore quand
`TURNSTILE_SECRET_KEY` est vide (`backend/services/captcha.py:42-46`).

### `MGS_CAPTCHA.render(containerElement, { onToken, onExpire, appearance })`

Rend le widget **dans le conteneur fourni** (le module ne crée que la balise
`<script>` du CDN). Ne rejette jamais ; renvoie une promesse de `{ ok, code }`.

| Paramètre | Type | Rôle |
|---|---|---|
| `containerElement` | `Element` | conteneur fourni par la page (le module n'en crée aucun) |
| `onToken(token)` | `(string) => void` | jeton obtenu, ou `""` à l'expiration / erreur |
| `onExpire()` | `() => void` | jeton expiré ou erreur Cloudflare : re-solliciter |
| `appearance` | `"interaction-only" \| "always"` | `interaction-only` par défaut ; passer `always` quand l'API a répondu `captcha_required` (`CaptchaWidget.js:110-114`) |

Codes : `"ready"` (widget posé), `"disabled"` (pas de clé — ne rien afficher),
`"no_container"` (conteneur absent), `"load_failed"` (CDN injoignable : la balise
est retirée, un nouvel appel retente), `"render_failed"`.

### `MGS_CAPTCHA.getToken()` → `string`

Jeton à envoyer. `""` si le captcha est désactivé ou si aucun jeton n'est encore
obtenu. **Règle d'envoi** : `captcha_token` n'est ajouté au corps que si la valeur
est non vide.

### `MGS_CAPTCHA.reset()` → `{ ok, code }`

Vide le jeton et repose un challenge. Codes : `"reset"`, `"disabled"`,
`"no_widget"`. À appeler après une erreur `captcha_required`
(`CaptchaWidget.js:128-136`, `Checkout.js:164-166`).

### `MGS_CAPTCHA.isCaptchaError(err)` → `boolean`

Contrat backend identique à `main` (`CaptchaWidget.js:75-83`) : `400` + code
`captcha_required`, ou `428`, ou `code`/`detail` contenant `captcha`/`turnstile`.
Accepte `{ status, code, detail }` ou une erreur axios-like
`{ response: { status, data } }`.

### Où le backend exige un jeton

| Route | Condition | Référence |
|---|---|---|
| `POST /auth/register` | toujours, si le secret est configuré | `backend/routers/auth.py:169` |
| `POST /auth/forgot-password` | toujours, si configuré | `backend/routers/auth.py:221` |
| `POST /auth/login` | après **2** échecs pour le même email | `backend/routers/auth.py:29,113-130` |
| `POST /orders` | toujours, si configuré | `backend/routers/orders.py:321` |

Réponse d'échec : `400` avec `{"code": "captcha_required"}`
(`backend/services/captcha.py:58-62`). Le champ du corps s'appelle
`captcha_token` (`backend/routers/orders.py:82`, `backend/routers/auth.py:40,47,70`).

### Ce que l'écran doit afficher

Rien de plus que ce que le design contient déjà. Le widget Turnstile est
auto-descriptif (son iframe porte son propre texte). En cas d'échec de chargement
du CDN, l'appelant affiche son propre message et son propre bouton « Réessayer »
(le module ne fournit aucun texte) puis rappelle `render()`.

---

## 2. `MGS_CRYPTO` — Binance / USDT

Reproduit `frontend/src/pages/Checkout.js:79,85,140-142,173-177` et
`frontend/src/components/store/checkout/BinancePay.js:11,24-40` ; routes
`backend/routers/crypto.py:107,112,123`.

### `MGS_CRYPTO.useTransport(fn)` → `{ ok, code }`

Remplace le transport HTTP. `fn(method, path, body)` doit résoudre
`{ status, data }` (`path` relatif à `/api`, par exemple `"/crypto/config"`) et
rejeter en cas d'erreur réseau. `useTransport(null)` restaure le transport par
défaut (`fetch`, `credentials: "include"`, `BASE + "/api" + path`).

**Recommandé** : passer un adaptateur sur le `req()` existant du prototype pour
bénéficier du rafraîchissement 401 déjà en place (`index.html:3533-3538`) :

```js
MGS_CRYPTO.useTransport(function (method, path, body) {
  return req(path, { method: method, body: body ? JSON.stringify(body) : undefined })
    .then(function (data) { return { status: 200, data: data }; });
});
```

### `MGS_CRYPTO.loadConfig()` → promesse

`GET /crypto/config` (`backend/routers/crypto.py:107`,
`backend/services/crypto.py:58-62`).

```js
{
  ok, code, status,
  available,      // bool : Binance réellement configuré côté serveur
  currency,       // "USDT"
  expiryMinutes,  // durée de vie d'un paiement
  networks: [ { key, label, memoRequired } ]   // [] si available === false
}
```

Codes : `"ok"`, `"network_error"`, `"http_<status>"`, `"bad_payload"`.

`available` est la seule source de vérité pour afficher ou non la méthode Binance
(`main` : `binanceActive = !!crypto?.available`, `Checkout.js:85`).

### `MGS_CRYPTO.initiate(orderId, network)` → promesse

`POST /crypto/initiate { order_id, network }` (`backend/routers/crypto.py:112-121`).

```js
{ ok, code, status, detail, payment }
```

`payment` est normalisé (voir ci-dessous) ou `null`. `detail` est le texte brut
du backend (donnée, pas une chaîne du module).

Codes : `"ok"` ; `"invalid_network"` (réseau hors
`TRC20|BEP20|APTOS|TON`, aucun appel réseau) ; `"network_error"` ; `"not_binance"`
(400) ; `"network_unavailable"` (400) ; `"bad_request"` (400) ;
`"forbidden"` (403) ; `"order_not_found"` (404) ; `"already_open"` (409) ;
`"not_pending"` (409) ; `"unavailable"` (409) ; `"conflict"` (409) ;
`"rate_limited"` (429) ; `"too_many"` (503) ; `"http_<status>"`.

**Prérequis** : la commande doit avoir été créée avec
`payment_method: "binance"` (`Checkout.js:140`) et rester `pending_payment`.
Sinon le backend répond 400 / 409.

### `MGS_CRYPTO.statusOf(orderId)` → promesse

`GET /crypto/{orderId}/status` (`backend/routers/crypto.py:123-127`). La route est
indexée par l'identifiant de **commande**, pas par celui du paiement.

```js
{ ok, code, status, orderStatus, payment }
```

Codes : `"ok"`, `"network_error"`, `"order_not_found"`, `"forbidden"`,
`"http_<status>"`.

### `MGS_CRYPTO.poll(orderId, onUpdate, opts)` → `{ orderId, stop }`

Sonde `statusOf` toutes les **8000 ms** (`BinancePay.js:11`) et appelle
`onUpdate` à chaque réponse :

```js
{ ok, code, status, orderStatus, payment, done, failed, attempt }
```

- `done` : `payment.status === "CONFIRMED"` → **arrêt** ;
- `failed` : `payment.status === "FAILED"` → **arrêt** ;
- paiement absent **et** `orderStatus !== "pending_payment"` → **arrêt** ;
- une erreur réseau **ne** coupe pas le sondage (`BinancePay.js:33`).

`opts` : `intervalMs` (défaut 8000), `maxAttempts` (défaut 0 = illimité).

### `MGS_CRYPTO.stop()` → `{ ok, code }`

Arrête immédiatement le sondage en cours.

### `MGS_CRYPTO.payment(raw)` → objet | `null`

Normalise un paiement (`backend/services/crypto.py:65-66,80-96`) :

```js
{
  id, orderId, orderNumber,
  network,          // "TRC20" | "BEP20" | "APTOS" | "TON"
  binanceNetwork,   // code Binance (ex. "TRX")
  currency,         // "USDT"
  address, memo,
  amountUsdt,       // montant EXACT à envoyer, déjà arrondi au pas de 0.0001
  baseUsdt, amountAr, rateArPerUsdt,
  status,           // "WAITING" | "DETECTED" | "CONFIRMED" | "FAILED"
  txHash, createdAt, expiresAt,
  expiresInMs       // recalculé à l'appel, jamais négatif
}
```

### Constantes

`MGS_CRYPTO.networks` = `["TRC20","BEP20","APTOS","TON"]` ;
`MGS_CRYPTO.status` = `{ WAITING, DETECTED, CONFIRMED, FAILED }` ;
`MGS_CRYPTO.pollMs` = `8000`.

### Ce que l'écran doit afficher (données, pas de design)

Sur l'écran de paiement existant (`index.html:2579-2590`), la méthode Binance se
comporte comme le paiement manuel, avec ces données à la place de « Nom du
marchand » / « Numéro » :

| Donnée | Source | Remarque |
|---|---|---|
| Montant exact | `payment.amountUsdt` + `payment.currency` | **le montant exact**, jamais `baseUsdt` |
| Réseau | `payment.network` | libellé lisible : `config.networks[].label` |
| Adresse | `payment.address` | la copie prend la valeur **complète** |
| Mémo | `payment.memo` | à afficher seulement s'il est non vide |
| Compte à rebours | `payment.expiresInMs` | `expiryMinutes` de la config au départ |
| Attente | `poll` → `DETECTED` | « paiement détecté » |
| Fin | `poll` → `done` / `failed` | `done` : commande à vérifier ; `failed` : paiement refusé |

Aucune preuve n'est demandée pour Binance : la détection est automatique
(`BinancePay.js:17-19`, `binanceNoProof`). Le bouton d'envoi de preuve ne doit pas
être proposé sur ce chemin.

---

## 3. Tests

`cd frontend && node scripts/proto-logic.test.mjs`

20 tests, sans réseau ni navigateur : les modules sont chargés dans un contexte
`node:vm` avec un DOM factice (captcha) et un transport simulé (crypto). Le
script sort en code 1 au premier échec et affiche `N passed, M failed`.
