import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

// PL-SEC-HARDEN-1-CAPTCHA — Cloudflare Turnstile, chargé par une balise <script>
// externe (aucun paquet npm). La clé est publique (site key) et lue au build :
// ABSENTE → le composant ne rend rien, ne bloque pas le formulaire et le champ
// `captcha_token` est simplement omis de la requête (le backend l'ignore quand
// TURNSTILE_ENABLED=false). La SÉLECTION du moyen de paiement n'est pas ici.
//
// Le widget est auto-descriptif (l'iframe Turnstile porte son propre texte et
// son thème a/b) : on ne lui ajoute aucun libellé pair de couleurs hors jetons.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Chargement singleton : plusieurs formulaires montés ne produisent qu'un
// seul <script>. Si window.turnstile est déjà présent (script de test ou
// préchargé), on le résout directement sans injecter quoi que ce soit.
let turnstilePromise = null;
function loadTurnstile() {
  if (typeof window !== "undefined" && window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => {
      turnstilePromise = null; // réessayable au prochain montage (CDN de retour)
      reject(new Error("turnstile-load-failed"));
    };
    document.head.appendChild(s);
  });
  return turnstilePromise;
}

// Clé de site PUBLIC (jamais secrète). `process.env.REACT_APP_*` est inliné par
// CRA au build : l'expression entière `process.env.REACT_APP_TURNSTILE_SITE_KEY`
// est remplacée par un littéral, SANS garde `typeof process` — le navigateur
// compilé n'a pas de global `process`, une telle garde laisserait le widget
// inerte dans le bundle (piège découvert à la capture). Si la var manque au
// build, l'expression reste telle quelle : ReferenceError → try/catch →
// désactivé sans crash. Les tests pilotent la clé via l'environnement jest.
const siteKey = () => {
  try { return process.env.REACT_APP_TURNSTILE_SITE_KEY; }
  catch (_) { return undefined; } // build sans la var : pas de global process → désactivé
};
const captchaEnabled = () => {
  const key = siteKey();
  return !!key && typeof key === "string" && !!key.trim();
};

// Taille compacte sur petit écran : le widget « normal » mesure 300 px de large,
// plus large qu'un écran 320 px moins le padding de la carte (272 px).
const widgetSize = () => {
  if (typeof window === "undefined") return "normal";
  if (typeof window.matchMedia !== "function") return "normal";
  return window.matchMedia("(max-width: 400px)").matches ? "compact" : "normal";
};

const widgetTheme = () => {
  try { return document.documentElement.classList.contains("dark") ? "dark" : "light"; }
  catch (_) { return "light"; }
};

// Détecte une erreur serveur liée au CAPTCHA : jeton absent/expiré/invalide.
// Le contrat exact (code dédié) reste à confirmer avec le rapport du lot
// backend PL-SEC-HARDEN-1 — tant qu'aucun code n'est publié, on couvre un
// statut 428 + toute chaîne « captcha »/« turnstile » dans code ou message.
export function isCaptchaError(err) {
  const code = String(err?.response?.data?.code || err?.code || "");
  const detail = String(err?.response?.data?.detail || err?.message || "");
  if (err?.response?.status === 428) return true;
  return /captcha|turnstile/i.test(code) || /captcha|turnstile/i.test(detail);
}

export const CaptchaWidget = forwardRef(function CaptchaWidget({ onVerify, onError }, ref) {
  const [failed, setFailed] = useState(false); // chargement du script impossible → ne pas bloquer le formulaire
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!captchaEnabled()) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey(),
          theme: widgetTheme(),
          size: widgetSize(),
          callback: (token) => onVerifyRef.current(token),
          // Expiration : Turnstile exige un re-solve — jeton remis à vide.
          "expired-callback": () => onVerifyRef.current(""),
          "error-callback": () => onVerifyRef.current(""),
        });
      })
      .catch(() => { if (!cancelled) { setFailed(true); onErrorRef.current?.(); } });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && typeof window !== "undefined" && window.turnstile?.remove) {
        try { window.turnstile.remove(widgetIdRef.current); } catch (_) { /* widget déjà parti */ }
        widgetIdRef.current = null;
      }
    };
  }, []);

  // Jeton à usage unique : après une erreur serveur liée au CAPTCHA, le formulaire
  // appelle reset() → Turnstile propose un nouveau challenge, le parent vide son jeton.
  useImperativeHandle(ref, () => ({
    reset() {
      const id = widgetIdRef.current;
      if (id != null && typeof window !== "undefined" && window.turnstile?.reset) {
        try { window.turnstile.reset(id); } catch (_) { /* id expiré côté Turnstile */ }
      }
    },
  }));

  if (!captchaEnabled() || failed) return null;
  return <div ref={containerRef} className="mt-1 flex min-h-16 justify-center" data-testid="captcha-widget" />;
});

/**
 * État partagé des formulaires intégrant le widget :
 *   const captcha = useCaptcha();
 *   ...
 *   captcha.siteKey        — clé (string) ou "" ; la clé est publique.
 *   captcha.ready          — true si le formulaire peut être soumis sans attendre
 *                            (pas de clé, ou jeton obtenu), false sinon.
 *   captcha.tokenFor(...)  — pièce à envoyer : la valeur ou undefined (champ omis).
 *   <CaptchaWidget ref={captcha.ref} onVerify={captcha.onVerify} /> ou null.
 */
export function useCaptcha() {
  const [token, setToken] = useState("");
  const [loadFailed, setLoadFailed] = useState(false); // script Turnstile injoignable → capacité conservée
  const onVerify = useCallback((value) => setToken(typeof value === "string" ? value : ""), []);
  const onError = useCallback(() => setLoadFailed(true), []);
  const ref = useRef(null);
  return {
    siteKey: siteKey() || "",
    enabled: captchaEnabled(),
    ready: !captchaEnabled() || loadFailed || !!token,
    onError,
    // Après une erreur CAPTCHA ou une expiration : vide le jeton côté parent
    // (le bump de `key` par le parent re-crée le widget et repose un nouveau
    // challenge).
    expire: () => setToken(""),
    tokenFor: () => (captchaEnabled() && !loadFailed && token) ? token : undefined,
    ref,
    onVerify,
  };
}
