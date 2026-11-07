import { formatPointsCount } from "./pointsFormat";

global.IS_REACT_ACT_ENVIRONMENT = true;

// 0, 500, 1 250, 12 500, 1 250 000 : complet jusqu'à 9 999, abrégé ensuite,
// séparateurs selon la langue du site (fr : espace/virgule, en : virgule/K/M).
describe("formatPointsCount (pastille compacte, PL-BRAND-1)", () => {
  test.each([
    [0, "fr", "0"],
    [500, "fr", "500"],
    // ICU de Node : groupement fr = U+202F (espace fine), préfixes k/M = U+00A0.
    // (les navigateurs peuvent varier légèrement — visuellement une espace fine)
    [1250, "fr", "1\u202F250"],
    [9999, "fr", "9\u202F999"],
    [12500, "fr", "12,5\u00A0k"],
    [1250000, "fr", "1,2\u00A0M"],
    [0, "en", "0"],
    [1250, "en", "1,250"],
    [12500, "en", "12.5K"],
    [1250000, "en", "1.2M"],
  ])("%i (%s) → %s", (n, lang, expected) => {
    expect(formatPointsCount(n, lang)).toBe(expected);
  });

  test("langue inconnue → français", () => {
    expect(formatPointsCount(12500, "de")).toBe("12,5\u00A0k");
  });

  test("forme abrégée : reste courte (pastille <= 72 px, pas de troncature)", () => {
    for (const n of [12500, 125000, 1250000, 12500000]) {
      expect(formatPointsCount(n, "fr").length).toBeLessThanOrEqual(6);
    }
  });
});
