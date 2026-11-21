/**
 * mgs-logic-captcha.js — logique Cloudflare Turnstile du prototype statique.
 *
 * Reprend le comportement de `main` (`frontend/src/components/common/CaptchaWidget.js`)
 * SANS React et SANS aucun élément visible propre : le module ne crée que la
 * balise <script> du CDN et délègue le rendu à `turnstile.render(container, …)`
 * dans le conteneur FOURNI par l'appelant. Aucun style, aucune classe, aucun
 * texte destiné à l'utilisateur : uniquement des données et des codes.
 *
 * Chargé comme script classique : expose `globalThis.MGS_CAPTCHA`.
 * Aucune dépendance, aucun appel réseau hors le CDN Cloudflare.
 */
(function (root) {
  "use strict";

  /* Même URL que `main` (CaptchaWidget.js:13) — script explicite, rendu manuel. */
  var SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

  /* La clé de site est PUBLIQUE. `main` la lit au build via
   * `process.env.REACT_APP_TURNSTILE_SITE_KEY` (CaptchaWidget.js:47-51) ; le
   * prototype statique n'a pas d'étape de build, donc deux sources équivalentes
   * sont acceptées ici, dans cet ordre :
   *   1. `window.MGS_TURNSTILE_SITE_KEY` (variable posée par la page) ;
   *   2. `<meta name="mgs-turnstile-sitekey" content="…">`.
   * Aucune valeur n'est inventée : sans clé, `enabled()` est faux et le champ
   * `captcha_token` doit être omis de la requête (le backend l'ignore quand
   * TURNSTILE_ENABLED=false, cf. backend/services/captcha.py:42-46).
   */
  function siteKey() {
    var injected = root.MGS_TURNSTILE_SITE_KEY;
    if (typeof injected === "string" && injected.trim()) return injected.trim();
    try {
      var doc = root.document;
      var meta = doc && doc.querySelector ? doc.querySelector('meta[name="mgs-turnstile-sitekey"]') : null;
      var content = meta && meta.getAttribute ? meta.getAttribute("content") : "";
      return content && String(content).trim() ? String(content).trim() : "";
    } catch (_) {
      return "";
    }
  }

  function enabled() {
    return !!siteKey();
  }

  /* Singleton de chargement, comme `main` : un seul <script> pour plusieurs
   * formulaires ; `window.turnstile` déjà présent (préchargé ou test) est
   * utilisé tel quel. Un échec retire la balise et autorise une nouvelle
   * tentative (bouton « Réessayer » côté appelant).
   */
  var loadPromise = null;
  function loadTurnstile() {
    if (root.turnstile) return Promise.resolve(root.turnstile);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc || !doc.createElement) { loadPromise = null; reject(new Error("no-document")); return; }
      var s = doc.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = function () {
        if (root.turnstile) resolve(root.turnstile);
        else { loadPromise = null; reject(new Error("turnstile-missing")); }
      };
      s.onerror = function () {
        loadPromise = null;           // réessayable
        if (s.parentNode) s.parentNode.removeChild(s); // pas de balise morte accumulée
        reject(new Error("turnstile-load-failed"));
      };
      (doc.head || doc.body || doc.documentElement).appendChild(s);
    });
    return loadPromise;
  }

  var state = {
    token: "",
    widgetId: null,
    container: null,
    onToken: null,
    onExpire: null,
  };

  /* `main` suit le thème de l'application (`dark` sur <html>) et la langue du
   * document (CaptchaWidget.js:60-67, 108). */
  function widgetTheme() {
    try { return root.document.documentElement.classList.contains("dark") ? "dark" : "light"; }
    catch (_) { return "light"; }
  }
  /* `main` suit la langue de l'application (`useLang()`, CaptchaWidget.js:108).
   * Dans le prototype, la langue vit dans `localStorage.mgs_lang`
   * (index.html:3461) et `document.documentElement.lang` n'est mis à jour que
   * par `setLang` : on lit donc `mgs_lang` d'abord, puis l'attribut. */
  function widgetLanguage() {
    try {
      var stored = "";
      try { stored = (root.localStorage && root.localStorage.getItem("mgs_lang")) || ""; } catch (_) { stored = ""; }
      var lang = stored || (root.document && root.document.documentElement ? root.document.documentElement.lang : "");
      return String(lang || "").toLowerCase() === "en" ? "en" : "fr";
    } catch (_) {
      return "fr";
    }
  }

  function clearToken() {
    state.token = "";
  }

  /**
   * render(container, { onToken, onExpire, appearance })
   *
   * Rend le widget Turnstile DANS le conteneur fourni. Ne crée aucun élément
   * visible : `turnstile.render` y injecte son iframe.
   *   - onToken(token)  : jeton obtenu (chaîne) ou "" à l'expiration/erreur.
   *   - onExpire()      : jeton expiré ou erreur Cloudflare (à re-solliciter).
   *   - appearance      : "interaction-only" par défaut (comme `main`) ;
   *                       passer "always" quand l'API a répondu
   *                       `captcha_required` (CaptchaWidget.js:110-114).
   * Résout { ok, code } ; codes : "ready" | "disabled" | "no_container"
   * | "load_failed" | "render_failed". Ne rejette jamais.
   */
  function render(container, opts) {
    opts = opts || {};
    state.container = container || null;
    state.onToken = typeof opts.onToken === "function" ? opts.onToken : null;
    state.onExpire = typeof opts.onExpire === "function" ? opts.onExpire : null;
    state.widgetId = null;
    clearToken();

    if (!enabled()) return Promise.resolve({ ok: false, code: "disabled" });
    if (!container) return Promise.resolve({ ok: false, code: "no_container" });

    var appearance = opts.appearance === "always" ? "always" : "interaction-only";

    return loadTurnstile().then(function (turnstile) {
      try {
        if (state.widgetId != null && turnstile.remove) {
          try { turnstile.remove(state.widgetId); } catch (_) { /* widget déjà parti */ }
        }
        state.widgetId = turnstile.render(container, {
          sitekey: siteKey(),
          theme: widgetTheme(),
          size: "flexible",       // même taille que `main` (CaptchaWidget.js:58)
          appearance: appearance, // invisible tant que Cloudflare ne demande rien
          language: widgetLanguage(),
          callback: function (token) {
            state.token = typeof token === "string" ? token : "";
            if (state.onToken) state.onToken(state.token);
          },
          "expired-callback": function () {
            clearToken();
            if (state.onToken) state.onToken("");
            if (state.onExpire) state.onExpire();
          },
          "error-callback": function () {
            clearToken();
            if (state.onToken) state.onToken("");
            if (state.onExpire) state.onExpire();
          },
        });
        return { ok: true, code: "ready" };
      } catch (_) {
        return { ok: false, code: "render_failed" };
      }
    }).catch(function () {
      return { ok: false, code: "load_failed" };
    });
  }

  /** Jeton à envoyer : "" quand le captcha est désactivé ou sans jeton. */
  function getToken() {
    return enabled() ? state.token || "" : "";
  }

  /**
   * reset() — jeton à usage unique : après une erreur `captcha_required`,
   * l'appelant vide son jeton et Turnstile repose un challenge
   * (CaptchaWidget.js:128-136). Codes : "reset" | "disabled" | "no_widget".
   */
  function reset() {
    if (!enabled()) { clearToken(); return { ok: false, code: "disabled" }; }
    clearToken();
    var turnstile = root.turnstile;
    if (state.widgetId == null || !turnstile || !turnstile.reset) return { ok: false, code: "no_widget" };
    try {
      turnstile.reset(state.widgetId);
      return { ok: true, code: "reset" };
    } catch (_) {
      return { ok: false, code: "no_widget" };
    }
  }

  /**
   * isCaptchaError(err) — contrat backend PL-SEC-HARDEN-1, identique à `main`
   * (CaptchaWidget.js:75-83) : 400 + code `captcha_required` ; on garde la
   * détection 428 et les chaînes « captcha »/« turnstile » pour un ancien
   * déploiement encore actif. Accepte { status, code, detail } (retour des
   * modules MGS) ou une erreur axios-like { response: { status, data } }.
   */
  function isCaptchaError(err) {
    if (!err) return false;
    var response = err.response || {};
    var body = response.data || {};
    var status = err.status != null ? err.status : response.status;
    var code = String((body.code != null ? body.code : err.code) || "");
    var detail = String((body.detail != null ? body.detail : err.detail) || err.message || "");
    if (status === 400 && (body.code === "captcha_required" || err.code === "captcha_required")) return true;
    if (status === 428) return true;
    return /captcha|turnstile/i.test(code) || /captcha|turnstile/i.test(detail);
  }

  root.MGS_CAPTCHA = {
    scriptUrl: SCRIPT_URL,
    siteKey: siteKey,
    enabled: enabled,
    render: render,
    getToken: getToken,
    reset: reset,
    isCaptchaError: isCaptchaError,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
