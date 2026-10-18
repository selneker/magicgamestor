import { isCurrencyProduct, ucAmountOf } from "./AdminFazercards";

jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key, lang: "fr" }) }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: false, can: () => false }) }));

// La lecture de quantité du formulaire admin doit être IDENTIQUE au backend :
// PUBG = comportement historique ; autre jeu = un seul nombre AUTONOME, sinon refus (null).
test("quantity reading follows the backend rule for every game", () => {
  expect(ucAmountOf({ name: "60 UC" }, "pubg-mobile")).toBe(60);
  expect(ucAmountOf({ name: "8 100 UC" }, "pubg-mobile")).toBe(8100);
  expect(ucAmountOf({ offer_id: "60_uc", name: "" }, "pubg-mobile")).toBe(60);
  expect(ucAmountOf({ name: "1,000 UC" }, "pubg-mobile")).toBe(null);
  expect(ucAmountOf({ name: "First Purchase Pack" }, "pubg-mobile")).toBe(null);

  expect(ucAmountOf({ name: "30 Diamants" }, "free-fire")).toBe(30);
  expect(ucAmountOf({ name: "1000 Diamants" }, "free-fire")).toBe(1000);
  expect(ucAmountOf({ name: "80 CP" }, "codm")).toBe(80);
  expect(ucAmountOf({ name: "Diamonds Pack" }, "free-fire")).toBe(null);
  expect(ucAmountOf({ name: "20 30 Diamonds" }, "free-fire")).toBe(null);
  expect(ucAmountOf({ name: "500+50 Diamants" }, "free-fire")).toBe(null);
  expect(ucAmountOf({ name: "1 000 Diamants" }, "free-fire")).toBe(null);
  expect(ucAmountOf({ name: "MP40 Bundle" }, "free-fire")).toBe(null);
  expect(ucAmountOf({ name: "40 80 CP" }, "codm")).toBe(null);
});

// Un produit de monnaie = quantité > 0 et type hors prime / prime_plus / evo (règle backend).
test("currency products follow the backend rule for every game", () => {
  expect(isCurrencyProduct({ type: "uc", uc_amount: 60 })).toBe(true);
  expect(isCurrencyProduct({ type: "diamonds", uc_amount: 100 })).toBe(true);
  expect(isCurrencyProduct({ type: "cp", uc_amount: 400 })).toBe(true);
  expect(isCurrencyProduct({ uc_amount: 100 })).toBe(true);
  expect(isCurrencyProduct({ type: "prime", uc_amount: 60 })).toBe(false);
  expect(isCurrencyProduct({ type: "prime_plus", uc_amount: 60 })).toBe(false);
  expect(isCurrencyProduct({ type: "evo", uc_amount: 170 })).toBe(false);
  expect(isCurrencyProduct({ type: "uc", uc_amount: 0 })).toBe(false);
  expect(isCurrencyProduct({ type: "uc" })).toBe(false);
  expect(isCurrencyProduct(null)).toBe(false);
});
