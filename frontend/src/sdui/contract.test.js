// Test de contrat (FE-005) : TOUTE clé i18n référencée par les fixtures du
// contrat aluu-admin v0 et TOUT code de errors.json existe en FR et en EN,
// résoluble par le mécanisme réel du rendu (resolveFlat, voir t.js).
// Les fixtures sont des copies fidèles du contrat — un drift est détecté ici.

import { resolveFlat } from "./t";
import { translations } from "@/i18n/translations";
import { parseScreen, versionSupported, confirmNeeded, isAllowedAction, getActionRoute } from "./engine";
import providerScreen from "./__fixtures__/screen-provider.json";
import mappingScreen from "./__fixtures__/screen-mapping.json";
import previewResponse from "./__fixtures__/preview-response.json";
import applyResponse from "./__fixtures__/apply-response.json";
import errorCodesFixture from "./__fixtures__/error-codes.json";
import errorSamples from "./__fixtures__/errors-samples.json";

const contractVersion = "v0";

/** Clés référencées par un écran : label_key, placeholder_key, value_key,
 * confirm_key, empty_key, columns[].label_key, options[].label_key — plus les
 * états de lignes (rendus via admin.aluu_mapping.state.<état>, README § 5). */
function collectScreenKeys(screen) {
  const keys = new Set();
  const states = new Set();
  for (const block of screen.blocks || []) {
    for (const field of ["label_key", "placeholder_key", "confirm_key", "empty_key"]) {
      if (typeof block[field] === "string" && block[field]) keys.add(block[field]);
    }
    if (block.kind === "table") {
      for (const col of block.columns || []) {
        if (typeof col.label_key === "string" && col.label_key) keys.add(col.label_key);
      }
      for (const row of block.rows || []) {
        if (typeof row.value_key === "string" && row.value_key) keys.add(row.value_key);
        if (typeof row.state === "string" && row.state) states.add(row.state);
      }
    }
    if (block.kind === "select") {
      for (const opt of block.options || []) {
        if (typeof opt.label_key === "string" && opt.label_key) keys.add(opt.label_key);
      }
    }
  }
  return { keys, states };
}

describe("fixtures : copies fidèles du contrat", () => {
  test("version du contrat v0, acceptée par le moteur FE-004 sans avertissement", () => {
    for (const screen of [providerScreen, mappingScreen]) {
      expect(screen.contract_version).toBe(contractVersion);
      expect(versionSupported(screen)).toBe(true);
      const { warnings } = parseScreen(screen);
      expect(warnings).toEqual([]);
    }
  });

  test("les actions des boutons existent dans le moteur (listes blanches)", () => {
    for (const screen of [providerScreen, mappingScreen]) {
      for (const block of screen.blocks) {
        if (block.kind === "button") {
          expect(isAllowedAction(getActionRoute(block.action))).toBe(true);
          expect(confirmNeeded(block.action)).toBe(
            ["put_config", "put_game_provider", "mapping_apply"].includes(block.action)
          );
        }
      }
    }
  });

  test("échantillons de réponses : états du § 5 uniquement", () => {
    for (const row of previewResponse.rows) {
      expect(["proposed", "ambiguous", "missing"]).toContain(row.state);
    }
    expect(previewResponse.rows.map((r) => r.state)).toEqual(["proposed", "ambiguous", "missing"]);
    expect(applyResponse.written_count).toBe(applyResponse.written.length);
  });
});

describe("clés i18n du contrat : FR et EN (résolution réelle)", () => {
  const provider = collectScreenKeys(providerScreen);
  const mapping = collectScreenKeys(mappingScreen);
  const keys = [...provider.keys, ...mapping.keys];
  const states = [...provider.states, ...mapping.states, ...previewResponse.rows.map((r) => r.state)];

  test("les fixtures référencent bien les clés attendues (garde anti-drift)", () => {
    // piquets minimaux : chaque famille du contrat est représentée
    for (const key of [
      "common.save",
      "admin.provider.title",
      "admin.provider.section.game.hint", // paire ambiguë n° 1
      "admin.aluu_mapping.preview.empty", // paire ambiguë n° 2
      "admin.aluu_mapping.apply.confirm", // paire ambiguë n° 3
    ]) {
      expect(keys).toContain(key);
    }
    // les 6 états du § 5 sont tous couverts par les fixtures
    expect([...new Set(states)].sort()).toEqual(
      ["ambiguous", "mapped", "missing", "proposed", "stale", "unconfirmed"]
    );
  });

  test.each(keys)("« %s » résout en FR et en EN", (key) => {
    expect(typeof resolveFlat(translations.fr, key)).toBe("string");
    expect(resolveFlat(translations.fr, key)).not.toBe(key);
    expect(typeof resolveFlat(translations.en, key)).toBe("string");
    expect(resolveFlat(translations.en, key)).not.toBe(key);
  });

  test.each(states)("état « admin.aluu_mapping.state.%s » résout en FR et en EN", (state) => {
    const key = `admin.aluu_mapping.state.${state}`;
    expect(resolveFlat(translations.fr, key)).not.toBe(key);
    expect(resolveFlat(translations.en, key)).not.toBe(key);
  });
});

describe("codes d'erreur du contrat : FR et EN", () => {
  const codes = [...errorCodesFixture.codes, "unknown", ...errorSamples.samples.map((s) => s.body.code).filter(Boolean)];

  test("error-codes.json porte les 22 codes du contrat", () => {
    expect(errorCodesFixture.codes).toHaveLength(22);
  });

  test("l'échantillon d'authentification 403 n'a PAS de code (enveloppe FastAPI)", () => {
    const auth = errorSamples.samples.find((s) => s.family === "auth");
    expect(auth.http).toBe(403);
    expect(auth.body.code).toBeUndefined();
    expect(typeof auth.body.detail).toBe("string");
  });

  test("les autres échantillons portent un code du contrat", () => {
    for (const sample of errorSamples.samples) {
      if (sample.family === "auth") continue;
      expect(errorCodesFixture.codes).toContain(sample.body.code);
    }
  });

  test.each(codes)("« errors.%s » résout en FR et en EN", (code) => {
    const key = `errors.${code}`;
    expect(typeof resolveFlat(translations.fr, key)).toBe("string");
    expect(resolveFlat(translations.fr, key)).not.toBe(key);
    expect(typeof resolveFlat(translations.en, key)).toBe("string");
    expect(resolveFlat(translations.en, key)).not.toBe(key);
  });
});
