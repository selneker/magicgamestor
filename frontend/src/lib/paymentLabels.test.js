import { PAYMENT_METHOD_LABELS, paymentColor, paymentLabel } from "./paymentLabels";

// t factice : renvoie la valeur FR du dictionnaire réel pour la clé de repli.
const t = (key) => (key === "order.methodOther" ? "Autre" : key);

describe("paymentLabel", () => {
  test.each([
    ["mvola", "MVola"],
    ["orange", "Orange Money"],
    ["manual", "USSD"],
    ["binance", "Binance USDT"],
  ])("%s → %s", (value, expected) => {
    expect(paymentLabel(value, t)).toBe(expected);
  });

  test("casse et espaces différents sont normalisés", () => {
    expect(paymentLabel("MVOLA", t)).toBe("MVola");
    expect(paymentLabel(" Binance ", t)).toBe("Binance USDT");
    expect(paymentLabel("ORANGE", t)).toBe("Orange Money");
  });

  test("valeur inconnue non vide : valeur brute nettoyée, jamais « Orange Money »", () => {
    expect(paymentLabel("fiveone", t)).toBe("fiveone");
    expect(paymentLabel("  weird_method  ", t)).toBe("weird_method");
  });

  test.each([undefined, null, "", "   "])("valeur absente (%p) → « Autre » via t()", (value) => {
    expect(paymentLabel(value, t)).toBe("Autre");
  });

  test("sans t(), le repli reste « Autre » (nom de repli, non traduit)", () => {
    expect(paymentLabel(undefined)).toBe("Autre");
  });

  test("les libellés sont des noms de marque non traduits (constants)", () => {
    expect(PAYMENT_METHOD_LABELS).toEqual({
      mvola: "MVola",
      orange: "Orange Money",
      manual: "USSD",
      binance: "Binance USDT",
    });
  });
});

describe("paymentColor", () => {
  test("mvola et orange gardent leur couleur de marque", () => {
    expect(paymentColor("mvola")).toBe("var(--mvola)");
    expect(paymentColor("orange")).toBe("var(--orange)");
  });

  test("binance et manual : neutre, jamais la couleur Orange", () => {
    expect(paymentColor("binance")).toBe("var(--brand-sand)");
    expect(paymentColor("manual")).toBe("var(--brand-sand)");
    expect(paymentColor("binance")).not.toBe("var(--orange)");
  });

  test.each([undefined, null, "unknown"])("valeur %p → neutre", (value) => {
    expect(paymentColor(value)).toBe("var(--brand-sand)");
  });
});
