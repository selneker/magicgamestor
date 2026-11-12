// PL-UX-4 — messages d'erreur FRANÇAIS pour les pages d'authentification.
//
// Le backend renvoie encore des détails en anglais sur ces routes
// (`routers/auth.py` : « Invalid email or password », « Email already
// registered », « Too many attempts… »). Le détail brut ne doit JAMAIS être
// affiché : on traduit par CODE d'erreur quand l'API le fournit, sinon par
// STATUT HTTP, sinon on retombe sur un texte français générique.
//
// Aucun changement de contrat backend : ce module ne fait que CHOISIR le
// message affiché à partir de la réponse déjà reçue.

export const AUTH_ERROR_KEYS = {
  invalidCredentials: "auth.errorInvalidCredentials",
  emailTaken: "auth.errorEmailTaken",
  tooManyAttempts: "auth.errorTooManyAttempts",
  accountBlocked: "auth.errorAccountBlocked",
  invalidLink: "auth.errorInvalidLink",
  unavailable: "auth.errorUnavailable",
  generic: "auth.errorGeneric",
};

// Codes d'erreur API → message. Le backend n'expose aujourd'hui que
// `captcha_required` (traité à part) ; cette table prépare le terrain sans
// rien inventer côté serveur.
const CODE_MAP = {
  invalid_credentials: AUTH_ERROR_KEYS.invalidCredentials,
  invalid_email_or_password: AUTH_ERROR_KEYS.invalidCredentials,
  wrong_password: AUTH_ERROR_KEYS.invalidCredentials,
  email_taken: AUTH_ERROR_KEYS.emailTaken,
  email_exists: AUTH_ERROR_KEYS.emailTaken,
  email_already_registered: AUTH_ERROR_KEYS.emailTaken,
  too_many_attempts: AUTH_ERROR_KEYS.tooManyAttempts,
  rate_limited: AUTH_ERROR_KEYS.tooManyAttempts,
  account_blocked: AUTH_ERROR_KEYS.accountBlocked,
  user_blocked: AUTH_ERROR_KEYS.accountBlocked,
  invalid_token: AUTH_ERROR_KEYS.invalidLink,
  invalid_link: AUTH_ERROR_KEYS.invalidLink,
  expired_token: AUTH_ERROR_KEYS.invalidLink,
};

// Statut HTTP → message (quand aucun code n'est fourni par l'API).
// 400 n'y est pas : sa signification dépend de la route (lien expiré sur la
// réinitialisation, validation ailleurs) — chaque page passe son repli.
const STATUS_MAP = {
  401: AUTH_ERROR_KEYS.invalidCredentials,
  403: AUTH_ERROR_KEYS.accountBlocked,
  409: AUTH_ERROR_KEYS.emailTaken,
  422: AUTH_ERROR_KEYS.generic,
  429: AUTH_ERROR_KEYS.tooManyAttempts,
  500: AUTH_ERROR_KEYS.unavailable,
  502: AUTH_ERROR_KEYS.unavailable,
  503: AUTH_ERROR_KEYS.unavailable,
  504: AUTH_ERROR_KEYS.unavailable,
};

// Clé i18n du message à afficher pour une erreur d'authentification.
// `fallback` : clé utilisée quand rien n'est reconnu (page par page).
export function authErrorKey(err, fallback = AUTH_ERROR_KEYS.generic) {
  const code = String(err?.response?.data?.code || err?.code || "").trim().toLowerCase();
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  const status = err?.response?.status;
  if (status && STATUS_MAP[status]) return STATUS_MAP[status];
  return fallback;
}
