// Garde-fou i18n global : fr et en doivent avoir EXACTEMENT les mêmes clés.
// Échoue dès qu'une seule clé est ajoutée d'un seul côté — voulu (aucune dérive
// silencieuse de parité). Les clés *_key référencées par les fixtures du contrat
// seront ajoutées à ce test en T5, quand le dossier du contrat existera.

import { translations } from "@/i18n/translations";

function keySet(obj, prefix = "") {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of keySet(v, path)) keys.add(sub);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function leafEntries(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leafEntries(v, path));
    else out.push([path, v]);
  }
  return out;
}

describe("parité i18n globale FR/EN", () => {
  test("fr et en ont exactement les mêmes clés (aucun écart toléré)", () => {
    const fr = keySet(translations.fr);
    const en = keySet(translations.en);
    const onlyFr = [...fr].filter((k) => !en.has(k)).sort();
    const onlyEn = [...en].filter((k) => !fr.has(k)).sort();
    expect({ onlyFr, onlyEn }).toEqual({ onlyFr: [], onlyEn: [] });
  });

  test("aucune valeur de traduction n'est restée à l'état de chemin brut", () => {
    // t(path) renvoie le chemin si la traduction manque : une valeur égale à sa
    // propre clé s'afficherait tel quel à l'écran (ex. "checkout.foo").
    const raw = leafEntries({ ...translations.fr, ...translations.en }).filter(([path, value]) => value === path);
    expect(raw).toEqual([]);
  });

  test("les clés du moteur sdui.* existent en FR et EN", () => {
    for (const lang of ["fr", "en"]) {
      const sdui = translations[lang].sdui;
      expect(sdui).toBeDefined();
      for (const key of [
        "loading",
        "error.title",
        "error.retry",
        "action.blocked",
        "action.confirmTitle",
        "action.confirmBody",
        "action.cancel",
        "action.run",
        "action.running",
        "action.forbidden",
        "label.missing",
        "table.empty",
        "table.selectAll",
        "table.selected",
        "checklist.ok",
        "checklist.ko",
      ]) {
        const value = key.split(".").reduce((acc, part) => (acc ? acc[part] : undefined), sdui);
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
