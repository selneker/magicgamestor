import { AUTH_ERROR_KEYS, authErrorKey } from "./authErrors";

// PL-UX-4 — l'API renvoie encore des détails anglais (« Invalid email or
// password ») : la page ne doit JAMAIS les afficher. On mappe le code, sinon
// le statut HTTP, sinon un texte générique français.

test("401 (mauvais identifiants) → message français dédié", () => {
  const err = { response: { status: 401, data: { detail: "Invalid email or password" } } };
  expect(authErrorKey(err)).toBe(AUTH_ERROR_KEYS.invalidCredentials);
});

test("409 (email déjà pris) → message français dédié", () => {
  expect(authErrorKey({ response: { status: 409, data: { detail: "Email already registered" } } }))
    .toBe(AUTH_ERROR_KEYS.emailTaken);
});

test("429 (trop de tentatives) → message français dédié", () => {
  expect(authErrorKey({ response: { status: 429, data: { detail: "Too many attempts. Try again in 15 minutes." } } }))
    .toBe(AUTH_ERROR_KEYS.tooManyAttempts);
});

test("code d'erreur connu → son message (prioritaire sur le statut)", () => {
  expect(authErrorKey({ response: { status: 401, data: { code: "email_taken" } } }))
    .toBe(AUTH_ERROR_KEYS.emailTaken);
});

test("code inconnu → repli sur le statut HTTP", () => {
  expect(authErrorKey({ response: { status: 401, data: { code: "mystery_code" } } }))
    .toBe(AUTH_ERROR_KEYS.invalidCredentials);
});

test("statut inconnu / erreur réseau → texte français générique (jamais l'anglais)", () => {
  expect(authErrorKey({ response: { status: 418, data: { detail: "I am a teapot" } } })).toBe(AUTH_ERROR_KEYS.generic);
  expect(authErrorKey(new Error("Network Error"))).toBe(AUTH_ERROR_KEYS.generic);
  expect(authErrorKey(undefined)).toBe(AUTH_ERROR_KEYS.generic);
});

test("repli fourni par la page (lien expiré sur la réinitialisation)", () => {
  expect(authErrorKey({ response: { status: 400, data: {} } }, AUTH_ERROR_KEYS.invalidLink))
    .toBe(AUTH_ERROR_KEYS.invalidLink);
});

test("toutes les clés pointent vers des clés i18n existantes (parité FR/EN)", () => {
  const { translations } = require("@/i18n/translations");
  Object.values(AUTH_ERROR_KEYS).forEach((key) => {
    ["fr", "en"].forEach((lang) => {
      const value = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), translations[lang]);
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    });
  });
});
