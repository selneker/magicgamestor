import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useLang } from "@/context/LanguageContext";

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
      turnstilePromise = null; // réessayable (bouton « Réessayer » ou prochain montage)
      s.remove(); // pas de balise morte qui s'accumule à chaque tentative
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

// PL-CHK-4 — taille `flexible` : le widget occupe TOUTE la largeur de son
// conteneur (conteneur aligné à gauche, 100 % — plus de Pilule 300 px plus
// large qu'un écran 320 px moins le padding). Apparence `interaction-only` :
// invisible tant que Cloudflare ne demande pas d'action — le conteneur ne
// réserve donc AUCUNE hauteur (aucun saut de mise en page) ; quand une
// interaction est demandée, `before-interactive-callback` prévient le parent
// qui ouvre la feuille « Vérification de sécurité » (écran 9).
const widgetSize = () => "flexible";

const widgetTheme = () => {
  try { return document.documentElement.classList.contains("dark") ? "dark" : "light"; }
  catch (_) { return "light"; }
};

// Détecte une erreur serveur liée au CAPTCHA : jeton absent/expiré/invalide.
// CONTRAT EXPLICITE backend PL-SEC-HARDEN-1 : réponse 400 + code
// `captcha_required` (« Vérification anti-robot requise. ») — testé en premier.
// On GARDE la détection de transition (statut 428, chaînes « captcha »/
// « turnstile » dans code ou message) pour un ancien déploiement backend encore
// actif pendant la bascule.
export function isCaptchaError(err) {
  const body = err?.response?.data || {};
  if (err?.response?.status === 400 && body.code === "captcha_required") return true;
  const code = String(body.code || err?.code || "");
  const detail = String(body.detail || err?.message || "");
  if (err?.response?.status === 428) return true;
  return /captcha|turnstile/i.test(code) || /captcha|turnstile/i.test(detail);
}

export const CaptchaWidget = forwardRef(function CaptchaWidget({ onVerify, onError, onInteractive, visible = false }, ref) {
  const { t, lang } = useLang();
  // Échec de chargement du CDN Cloudflare : STOP fail-closed — le formulaire
  // reste bloqué jeton manquant ; on affiche un message inline + un bouton
  // « Réessayer » qui retente le script sans recharger la page. Sans clé
  // configurée, tout ce cheminement n'existe pas (formulaire normal).
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setFailed(false); setAttempt((n) => n + 1); }, []);
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onInteractiveRef = useRef(onInteractive);
  onInteractiveRef.current = onInteractive;

  useEffect(() => {
    if (!captchaEnabled() || failed) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey(),
          theme: widgetTheme(),
          size: widgetSize(),
          // PL-CHK-4 — invisible jusqu'à ce que Cloudflare demande une action.
          // PL-UX-4 — `visible` : quand l'API a EXPLICITE demanded le contrôle
          // (`captcha_required`), le widget doit être VISIBLE (sinon le
          // formulaire est bloqué sans rien à faire) : on passe alors en
          // apparence « always ». Un échec d'identifiants ordinaire ne force
          // rien : le comportement escaladé reste inchangé.
          appearance: visible ? "always" : "interaction-only",
          // Langue du site (codes courts "fr" / "en" ; valeur inconnue → repli auto).
          language: lang === "en" ? "en" : "fr",
          callback: (token) => onVerifyRef.current(token),
          // Expiration : Turnstile exige un re-solve — jeton remis à vide.
          "expired-callback": () => onVerifyRef.current(""),
          "error-callback": () => onVerifyRef.current(""),
          // PL-CHK-4 — Cloudflare demande une action (écran 9) : le parent ouvre
          // la feuille « Vérification de sécurité » ; jeton reçu / interaction
          // terminée : le parent la referme et poursuit.
          "before-interactive-callback": () => onInteractiveRef.current?.(true),
          "after-interactive-callback": () => onInteractiveRef.current?.(false),
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
  }, [failed, attempt, lang, visible]); // visible : ré-rendu du widget (apparence)

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

  if (!captchaEnabled()) return null;
  if (failed) {
    return (
      <div className="mt-1 flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[10px] bg-muted/40 px-3 py-2 text-center" data-testid="captcha-widget-failed">
        <p className="text-xs text-muted-foreground" role="status">{t("captcha.loadError")}</p>
        {/* Cible tactile maison ≥ 44 px (h-11) : la règle du dépôt est plus stricte que la AA web. */}
        <button type="button" onClick={retry} data-testid="captcha-retry" className="h-11 rounded-full border-2 border-[color:var(--rule)] px-4 text-xs font-bold text-foreground">
          {t("captcha.retry")}
        </button>
      </div>
    );
  }
  // Conteneur : toute la largeur, aligné à gauche ; avec `interaction-only`
  // le widget n'occupe AUCUNE place tant que Cloudflare ne demande rien
  // (aucune hauteur réservée, aucun saut de mise en page).
  // PL-UX-4 — en mode `visible` (contrôle exigé par l'API), le widget est
  // affiché : un libellé français le nomme et le cadre le sépare du reste
  // de la carte. Le bouton de soumission reste SOUS le widget (jamais masqué).
  return (
    <div className="w-full" data-testid="captcha-widget">
      {visible && (
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground" data-testid="captcha-widget-label">{t("captcha.label")}</p>
      )}
      <div ref={containerRef} className="w-full text-left" />
    </div>
  );
});

/**
 * État partagé des formulaires intégrant le widget :
 *   const captcha = useCaptcha();
 *   ...
 *   captcha.siteKey        — clé (string) ou "" ; la clé est publique.
 *   captcha.ready          — true si le formulaire peut être soumis (pas de clé,
 *                            ou jeton obtenu). L'échec de chargement du CDN ne
 *                            débloque PLUS : fail-closed, le message inline et
 *                            le bouton « Réessayer » vivent dans le widget.
 *   captcha.tokenFor(...)  — pièce à envoyer : la valeur ou undefined (champ omis).
 *   <CaptchaWidget ref={captcha.ref} onVerify={captcha.onVerify} /> ou null.
 */
export function useCaptcha() {
  const [token, setToken] = useState("");
  const onVerify = useCallback((value) => setToken(typeof value === "string" ? value : ""), []);
  const ref = useRef(null);
  return {
    siteKey: siteKey() || "",
    enabled: captchaEnabled(),
    ready: !captchaEnabled() || !!token,
    onError: () => {}, // informatif ; le widget gère son propre écran d'erreur
    // Après une erreur CAPTCHA ou une expiration : vide le jeton côté parent
    // (le bump de `key` par le parent re-crée le widget et repose un nouveau
    // challenge).
    expire: () => setToken(""),
    tokenFor: () => (captchaEnabled() && token) ? token : undefined,
    ref,
    onVerify,
  };
}
