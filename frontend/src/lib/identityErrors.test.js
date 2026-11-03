// PL-003-FE-2 — table des codes de vérification d'identité (contrat PL-003-SEL-2 §2).
import { identityErrorKey } from "./identityErrors";
import { translations } from "@/i18n/translations";

// --- Table §2 : chaque ligne du contrat --------------------------------------

test("valid:false + invalid_id -> refus (rouge)", () => {
  expect(identityErrorKey({ status: 200, code: "invalid_id", valid: false })).toEqual({ display: "refused", key: "checkout.verifyIdInvalid" });
});

test("valid:false + missing_field -> saisie incorrecte", () => {
  expect(identityErrorKey({ status: 200, code: "missing_field", valid: false })).toEqual({ display: "invalid_input", key: "checkout.verifyMissingField" });
});

test("HTTP 422 sans code -> saisie incorrecte (detail jamais affiché brut)", () => {
  expect(identityErrorKey({ status: 422, valid: false })).toEqual({ display: "invalid_input", key: "checkout.verifyMissingField" });
});

test("HTTP 429 sans code -> trop de tentatives", () => {
  expect(identityErrorKey({ status: 429, code: "rate_limited", valid: false })).toEqual({ display: "unavailable", key: "checkout.verifyRateLimited" });
});

test("code rate_limited sans statut (réponse lue) -> trop de tentatives", () => {
  expect(identityErrorKey({ code: "rate_limited", valid: false })).toEqual({ display: "unavailable", key: "checkout.verifyRateLimited" });
});

test.each([502, 503, 504])("HTTP %s sans code -> indisponible", (status) => {
  expect(identityErrorKey({ status, valid: false })).toEqual({ display: "unavailable", key: "checkout.verifyProviderUnavailable" });
});

test("code provider_unavailable -> indisponible", () => {
  expect(identityErrorKey({ code: "provider_unavailable", valid: false })).toEqual({ display: "unavailable", key: "checkout.verifyProviderUnavailable" });
});

test("code unsupported_game -> même panneau ambre que provider_unavailable (texte neutre)", () => {
  expect(identityErrorKey({ code: "unsupported_game", valid: false })).toEqual({ display: "unavailable", key: "checkout.verifyProviderUnavailable" });
});

// --- Fail-closed : tout le reste est une panne, jamais « vérifié » ------------

test("valid:true -> null (l'appelant ne doit pas en déduire une erreur)", () => {
  expect(identityErrorKey({ status: 200, valid: true })).toBeNull();
});

test("code inconnu avec valid:false -> générique neutre", () => {
  expect(identityErrorKey({ status: 400, code: "weird_code", valid: false })).toEqual({ display: "unavailable", key: "checkout.verifyError" });
});

test("pas de réponse du tout (réseau) -> générique neutre", () => {
  expect(identityErrorKey({})).toEqual({ display: "unavailable", key: "checkout.verifyError" });
  expect(identityErrorKey(undefined)).toEqual({ display: "unavailable", key: "checkout.verifyError" });
});

test("corps HTTP 400 inattendu sans code -> générique neutre", () => {
  expect(identityErrorKey({ status: 400 })).toEqual({ display: "unavailable", key: "checkout.verifyError" });
});

// --- Parité FR/EN des clés de cette tâche -------------------------------------

// Clés émises par la table + libellés de repli Aldux champs sans `label`
// (playerId existe déjà, zone est nouveau).
const KEYS = [
  "checkout.verifyIdInvalid",
  "checkout.verifyMissingField",
  "checkout.verifyRateLimited",
  "checkout.verifyProviderUnavailable",
  "checkout.verifyError",
  "checkout.verify",
  "checkout.verifying",
  "checkout.verifyFound",
  "checkout.verifyPlayerName",
  "checkout.verifyRegion",
  "checkout.playerId",
  "checkout.zone",
];

test("chacune de ces clés existe en FR et en EN avec un texte non vide", () => {
  const lookup = (lang, path) => {
    let node = translations[lang];
    for (const part of path.split(".")) {
      node = node?.[part];
      if (node === undefined) return undefined;
    }
    return node;
  };
  for (const key of KEYS) {
    const fr = lookup("fr", key);
    const en = lookup("en", key);
    expect({ key, fr }).toEqual({ key, fr: expect.any(String) });
    expect({ key, en }).toEqual({ key, en: expect.any(String) });
    expect(fr.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
  }
});

test("aucun nom de fournisseur dans les textes de vérification", () => {
  for (const key of KEYS) {
    const get = (lang) => {
      let node = translations[lang];
      for (const part of key.split(".")) node = node[part];
      return node;
    };
    expect(get("fr").replace(/provider/i, "")).not.toMatch(/fazercards|neferbyte/i);
    expect(get("en").replace(/provider/i, "")).not.toMatch(/fazercards|neferbyte/i);
  }
});
