import { isAdminRoute, showsSiteFooter } from "./bottomChrome";

// PL-UX-4 — l'admin n'a pas de pied de page ; les pages publiques gardent
// le leur.

test("l'admin est reconnu (toutes ses routes)", () => {
  expect(isAdminRoute("/admin")).toBe(true);
  expect(isAdminRoute("/admin/commandes")).toBe(true);
  expect(isAdminRoute("/admin/paiements/binance")).toBe(true);
});

test("admin sans footer, pages publiques avec footer", () => {
  expect(showsSiteFooter("/admin")).toBe(false);
  expect(showsSiteFooter("/admin/commandes")).toBe(false);
  expect(showsSiteFooter("/boutique")).toBe(true);
  expect(showsSiteFooter("/")).toBe(true);
  expect(showsSiteFooter("/compte")).toBe(true);
});

test("le mode « focalisé » garde son footer absent (inchangé)", () => {
  expect(showsSiteFooter("/commande")).toBe(false);
  expect(showsSiteFooter("/connexion")).toBe(false);
});
