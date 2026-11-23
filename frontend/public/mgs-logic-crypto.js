/**
 * mgs-logic-crypto.js — logique Binance / USDT du prototype statique.
 *
 * Reprend le comportement de `main` :
 *   - `frontend/src/pages/Checkout.js:79,85,173-177` : lecture de
 *     `GET /crypto/config` (méthode active si `available`), puis, pour une
 *     commande Binance, `POST /crypto/initiate { order_id, network }` ;
 *   - `frontend/src/components/store/checkout/BinancePay.js:11,24-40` :
 *     sondage `GET /crypto/{order_id}/status` toutes les 8 s, arrêt sur
 *     `CONFIRMED` (et sur `FAILED`), reprise du paiement existant ;
 *   - `backend/routers/crypto.py:107,112,123` : les trois routes ci-dessus ;
 *     `backend/services/crypto.py:14,15,58-66` : réseaux, statuts, forme
 *     publique du paiement.
 *
 * Aucun DOM, aucun style, aucune classe, aucun texte destiné à l'utilisateur :
 * uniquement des données et des codes. Chargé comme script classique :
 * expose `globalThis.MGS_CRYPTO`.
 */
(function (root) {
  "use strict";

  /* Défaut aligné sur le runtime du prototype (`index.html:3526` :
   * `https://api.magicgame.store`, confirmée par le propriétaire). */
  var DEFAULT_BACKEND = "https://api.magicgame.store";

  /* Même cadence que `main` (BinancePay.js:11). */
  var POLL_MS = 8000;

  /* La liste des réseaux n'est PAS codée en dur : elle vient de
   * `GET /crypto/config` — `backend/services/crypto.py:46-47,58-62` renvoie
   * uniquement les réseaux actifs — et le backend statue sur un réseau
   * invalide (`routers/crypto.py:77-78`). */
  var STATUS = { WAITING: "WAITING", DETECTED: "DETECTED", CONFIRMED: "CONFIRMED", FAILED: "FAILED" };

  function backend() {
    var base = root.MGS_BACKEND_URL || DEFAULT_BACKEND;
    return String(base).replace(/\/+$/, "");
  }

  /* ---------- transport ---------- */

  /* Transport par défaut : `fetch` + cookies, comme le runtime
   * (index.html:3533-3538). Il ne refait PAS le rafraîchissement 401 :
   * l'appelant peut fournir son propre transport via `useTransport()` pour
   * réutiliser `req()` du prototype. */
  function defaultTransport(method, path, body) {
    var url = backend() + "/api" + path;
    var opts = { method: method, credentials: "include", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return root.fetch(url, opts).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (_) { data = null; } }
        return { status: response.status, data: data };
      });
    });
  }

  var transport = defaultTransport;

  /**
   * useTransport(fn) — remplace le transport HTTP.
   * `fn(method, path, body)` doit résoudre `{ status, data }` (path relatif à
   * `/api`, par exemple "/crypto/config") et rejeter en cas d'erreur réseau.
   * Passer `null` restaure le transport par défaut.
   */
  function useTransport(fn) {
    transport = typeof fn === "function" ? fn : defaultTransport;
    return { ok: true, code: "transport_set" };
  }

  function call(method, path, body) {
    var pending;
    try { pending = transport(method, path, body); }
    catch (e) { return Promise.resolve({ status: 0, data: null, network: true }); }
    return Promise.resolve(pending).then(function (res) {
      return { status: (res && res.status) || 0, data: res ? res.data : null, network: false };
    }, function () {
      return { status: 0, data: null, network: true };
    });
  }

  function detailOf(data) {
    return data && typeof data.detail === "string" ? data.detail : "";
  }

  /* ---------- lecture de la configuration ---------- */

  /**
   * loadConfig() — GET /crypto/config.
   * Résout :
   *   { ok, code, status,
   *     available,          // bool : Binance réellement configuré côté serveur
   *     currency,           // "USDT"
   *     expiryMinutes,      // durée de vie d'un paiement (minutes)
   *     networks: [ { key, label, memoRequired } ]  // vide si indisponible
   *   }
   * Codes : "ok" | "network_error" | "http_<status>" | "bad_payload".
   */
  function loadConfig() {
    return call("GET", "/crypto/config").then(function (res) {
      if (res.network) return { ok: false, code: "network_error", status: 0, available: false, currency: "USDT", expiryMinutes: 0, networks: [] };
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, code: "http_" + res.status, status: res.status, available: false, currency: "USDT", expiryMinutes: 0, networks: [] };
      }
      var data = res.data;
      if (!data || typeof data !== "object") {
        return { ok: false, code: "bad_payload", status: res.status, available: false, currency: "USDT", expiryMinutes: 0, networks: [] };
      }
      var networks = Array.isArray(data.networks) ? data.networks.map(function (n) {
        return {
          key: n && n.key ? String(n.key) : "",
          label: n && n.label ? String(n.label) : "",
          memoRequired: !!(n && n.memo_required),
        };
      }).filter(function (n) { return !!n.key; }) : [];
      return {
        ok: true,
        code: "ok",
        status: res.status,
        available: !!data.available,
        currency: data.currency ? String(data.currency) : "USDT",
        expiryMinutes: typeof data.expiry_minutes === "number" ? data.expiry_minutes : 0,
        networks: data.available ? networks : [],
      };
    });
  }

  /* ---------- forme publique d'un paiement ---------- */

  function isoMs(value) {
    if (!value) return 0;
    var ms = Date.parse(value);
    return isNaN(ms) ? 0 : ms;
  }

  /**
   * payment(raw) — normalise un paiement renvoyé par le backend
   * (`backend/services/crypto.py:65-66,80-96`).
   * Renvoie null si `raw` est vide, sinon :
   *   { id, orderId, orderNumber, network, binanceNetwork, currency,
   *     address, memo, amountUsdt, baseUsdt, amountAr, rateArPerUsdt,
   *     status, txHash, createdAt, expiresAt, expiresInMs }
   * `expiresInMs` est recalculé à l'appel (0 si inconnu, jamais négatif).
   */
  function payment(raw) {
    if (!raw || typeof raw !== "object") return null;
    var expiresAt = raw.expires_at ? String(raw.expires_at) : "";
    var expiresMs = isoMs(expiresAt);
    var left = expiresMs ? expiresMs - Date.now() : 0;
    return {
      id: raw.id ? String(raw.id) : "",
      orderId: raw.order_id ? String(raw.order_id) : "",
      orderNumber: raw.order_number ? String(raw.order_number) : "",
      network: raw.network ? String(raw.network) : "",
      binanceNetwork: raw.binance_network ? String(raw.binance_network) : "",
      currency: raw.currency ? String(raw.currency) : "USDT",
      address: raw.address ? String(raw.address) : "",
      memo: raw.memo ? String(raw.memo) : "",
      amountUsdt: raw.amount_usdt != null ? String(raw.amount_usdt) : "",
      baseUsdt: raw.base_usdt != null ? String(raw.base_usdt) : "",
      amountAr: typeof raw.amount_ar === "number" ? raw.amount_ar : 0,
      rateArPerUsdt: typeof raw.rate_ar_per_usdt === "number" ? raw.rate_ar_per_usdt : 0,
      status: raw.status ? String(raw.status) : "",
      txHash: raw.tx_hash ? String(raw.tx_hash) : "",
      createdAt: raw.created_at ? String(raw.created_at) : "",
      expiresAt: expiresAt,
      expiresInMs: left > 0 ? left : 0,
    };
  }

  /* ---------- initiation ---------- */

  /* `POST /crypto/initiate` (backend/routers/crypto.py:112-121) répond 400
   * dans deux cas distincts, 409 dans trois, 503 pour la saturation. Les
   * libellés cités sont ceux du backend (fichier:ligne ci-dessus). */
  function initiateCode(status, data) {
    var detail = detailOf(data);
    if (status === 400) {
      if (/binance/i.test(detail)) return "not_binance";
      if (/r[ée]seau/i.test(detail)) return "network_unavailable";
      return "bad_request";
    }
    if (status === 403) return "forbidden";
    if (status === 404) return "order_not_found";
    if (status === 409) {
      if (/d[ée]j[àa]/i.test(detail)) return "already_open";
      if (/attente/i.test(detail)) return "not_pending";
      if (/indisponible/i.test(detail)) return "unavailable";
      return "conflict";
    }
    if (status === 429) return "rate_limited";
    if (status === 503) return "too_many";
    return "http_" + status;
  }

  /**
   * initiate(orderId, network) — POST /crypto/initiate { order_id, network }.
   * Résout { ok, code, status, detail, payment }.
   * Codes : "ok" | "network_error"
   * | "not_binance" | "network_unavailable" | "bad_request" | "forbidden"
   * | "order_not_found" | "already_open" | "not_pending" | "unavailable"
   * | "conflict" | "rate_limited" | "too_many" | "http_<status>".
   * `detail` est le texte brut du backend (donnée, pas une chaîne du module).
   * Aucune validation locale du réseau : c'est le backend qui statue
   * (`routers/crypto.py:77-78` → 400 « Réseau USDT non disponible. »).
   */
  function initiate(orderId, network) {
    var id = orderId != null ? String(orderId) : "";
    var net = network != null ? String(network) : "";
    if (!id) return Promise.resolve({ ok: false, code: "order_not_found", status: 0, detail: "", payment: null });
    return call("POST", "/crypto/initiate", { order_id: id, network: net }).then(function (res) {
      if (res.network) return { ok: false, code: "network_error", status: 0, detail: "", payment: null };
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, code: "ok", status: res.status, detail: "", payment: payment(res.data) };
      }
      return { ok: false, code: initiateCode(res.status, res.data), status: res.status, detail: detailOf(res.data), payment: null };
    });
  }

  /* ---------- suivi ---------- */

  /**
   * statusOf(orderId) — GET /crypto/{order_id}/status.
   * Résout { ok, code, status, orderStatus, orderDeadline, payment }.
   * La route est indexée par l'identifiant de COMMANDE
   * (backend/routers/crypto.py:123-127), pas par celui du paiement.
   * `orderDeadline` = `payment_deadline_at` de la commande quand le backend le
   * renvoie (modèle PaymentCountdown.js:15). NOTE : la projection actuelle de
   * `/crypto/{id}/status` ne contient que `status` (routers/crypto.py:50) —
   * `orderDeadline` est donc "" tant que le backend ne l'expose pas ; l'appelant
   * passe alors l'échéance de la commande à `poll` via `opts.deadlineAt`.
   */
  function statusOf(orderId) {
    var id = orderId != null ? String(orderId) : "";
    if (!id) return Promise.resolve({ ok: false, code: "order_not_found", status: 0, orderStatus: "", orderDeadline: "", payment: null });
    return call("GET", "/crypto/" + encodeURIComponent(id) + "/status").then(function (res) {
      if (res.network) return { ok: false, code: "network_error", status: 0, orderStatus: "", orderDeadline: "", payment: null };
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, code: res.status === 404 ? "order_not_found" : res.status === 403 ? "forbidden" : "http_" + res.status, status: res.status, orderStatus: "", orderDeadline: "", payment: null };
      }
      var data = res.data || {};
      return {
        ok: true,
        code: "ok",
        status: res.status,
        orderStatus: data.order_status ? String(data.order_status) : "",
        orderDeadline: data.payment_deadline_at ? String(data.payment_deadline_at) : "",
        payment: payment(data.payment),
      };
    });
  }

  var pollState = { timer: null, stopped: true, seq: 0 };

  /**
   * poll(orderId, onUpdate, opts) — sonde GET /crypto/{order_id}/status
   * (BinancePay.js:24-40). `opts` :
   *   - intervalMs  : cadence, 8000 par défaut ;
   *   - maxAttempts : 0 (défaut) = illimité ;
   *   - deadlineAt  : échéance ISO de la commande (`payment_deadline_at`,
   *                   modèle PaymentCountdown.js:15). À défaut, `orderDeadline`
   *                   renvoyé par statusOf est utilisé ;
   *   - onExpired() : appelé quand l'échéance arrive à zéro (PaymentCountdown.js:33).
   * `onUpdate({ ok, code, status, orderStatus, orderDeadline, payment, done,
   * failed, expired, attempt })` à chaque réponse ; `done` = CONFIRMED,
   * `failed` = FAILED, `expired` = échéance atteinte.
   * S'arrête seul sur CONFIRMED, FAILED, l'expiration (onExpired), ou si la
   * commande n'est plus en attente de paiement sans paiement en cours (plus
   * prudent que `main`, qui continue jusqu'au démontage). Une erreur réseau
   * continue le sondage (comme `main`). `stop()` arrête immédiatement.
   */
  function poll(orderId, onUpdate, opts) {
    stop();
    opts = opts || {};
    var interval = typeof opts.intervalMs === "number" && opts.intervalMs > 0 ? opts.intervalMs : POLL_MS;
    var max = typeof opts.maxAttempts === "number" && opts.maxAttempts > 0 ? opts.maxAttempts : 0;
    var seq = ++pollState.seq;
    var attempts = 0;
    pollState.stopped = false;

    function tick() {
      if (pollState.stopped || seq !== pollState.seq) return;
      attempts++;
      statusOf(orderId).then(function (res) {
        if (pollState.stopped || seq !== pollState.seq) return;
        var done = !!(res.payment && res.payment.status === STATUS.CONFIRMED);
        var failed = !!(res.payment && res.payment.status === STATUS.FAILED);
        var gone = !res.payment && !!res.orderStatus && res.orderStatus !== "pending_payment";
        var deadlineMs = isoMs(opts.deadlineAt || res.orderDeadline || "");
        var expired = !done && !failed && !!deadlineMs && Date.now() >= deadlineMs;
        if (typeof onUpdate === "function") {
          try {
            onUpdate({
              ok: res.ok, code: res.code, status: res.status,
              orderStatus: res.orderStatus, orderDeadline: res.orderDeadline, payment: res.payment,
              done: done, failed: failed, expired: expired, attempt: attempts,
            });
          } catch (_) { /* l'appelant ne casse pas le sondage */ }
        }
        if (done || failed) { stop(); return; }
        if (expired) { if (typeof opts.onExpired === "function") { try { opts.onExpired(); } catch (_) { /* idem */ } } stop(); return; }
        if (gone) { stop(); return; }
        if (max && attempts >= max) { stop(); return; }
        pollState.timer = setTimeout(tick, interval);
      });
    }

    pollState.timer = setTimeout(tick, interval);
    return { orderId: orderId, stop: stop };
  }

  /** stop() — arrête le sondage en cours (aucun effet sinon). */
  function stop() {
    pollState.stopped = true;
    pollState.seq++;
    if (pollState.timer) { clearTimeout(pollState.timer); pollState.timer = null; }
    return { ok: true, code: "stopped" };
  }

  root.MGS_CRYPTO = {
    backend: backend,
    pollMs: POLL_MS,
    status: STATUS,
    useTransport: useTransport,
    loadConfig: loadConfig,
    initiate: initiate,
    statusOf: statusOf,
    poll: poll,
    stop: stop,
    payment: payment,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
