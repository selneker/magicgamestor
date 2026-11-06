import { ADMIN_NAV, ADMIN_NAV_GROUPS, adminNavVisible, adminBarItems, adminMoreItems, adminSidebarGroups, adminBadge } from "./adminNav";
import { translations } from "@/i18n/translations";

// Contrat de navigation admin (MGS-FE-ADMIN-20261105-01) : une seule source de
// vérité, lue par la sidebar desktop ET par la barre du bas / menu Plus mobile.

const canAll = () => true;
const canNone = () => false;

// Routes réellement montées dans App.js — le jeu en moins faisait justement
// défaut sur mobile avant l'unification.
const EXPECTED_PATHS = [
  "/admin",
  "/admin/commandes",
  "/admin/catalogue",
  "/admin/jeux",
  "/admin/fournisseur",
  "/admin/paiements",
  "/admin/evenements",
  "/admin/messages",
  "/admin/fidelite",
  "/admin/utilisateurs",
  "/admin/notifications",
];

const resolve = (lang, path) =>
  path.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), translations[lang]);

describe("ADMIN_NAV — source de vérité unique", () => {
  test("couvre exactement les routes admin montées dans App.js", () => {
    expect(ADMIN_NAV.map((e) => e.path).sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  test("chaque entrée a un schéma complet et des clés uniques", () => {
    const keys = new Set();
    const paths = new Set();
    for (const e of ADMIN_NAV) {
      expect(e.key).toBeTruthy();
      expect(e.labelKey).toBeTruthy();
      expect(e.shortLabelKey).toBeTruthy();
      expect(e.icon).toBeTruthy();
      expect(e.path.startsWith("/admin")).toBe(true);
      expect(ADMIN_NAV_GROUPS.some((g) => g.key === e.group)).toBe(true);
      expect(["bar", "more"]).toContain(e.mobile);
      expect(keys.has(e.key)).toBe(false);
      expect(paths.has(e.path)).toBe(false);
      keys.add(e.key);
      paths.add(e.path);
    }
    if (ADMIN_NAV.some((e) => e.mobile === "more")) {
      for (const e of ADMIN_NAV.filter((x) => x.mobile === "more")) {
        expect(typeof e.moreOrder).toBe("number");
      }
    }
  });

  test("chaque entrée est atteignable sur mobile (barre ou Plus) ET présente dans la sidebar desktop", () => {
    for (const permission of [canAll, canNone]) {
      const bar = adminBarItems(permission).map((e) => e.key);
      const more = adminMoreItems(permission).map((e) => e.key);
      const sidebar = adminSidebarGroups(permission).flatMap((g) => g.items.map((e) => e.key));
      for (const e of adminNavVisible(permission)) {
        expect(bar.includes(e.key) || more.includes(e.key)).toBe(true);
        expect(sidebar.includes(e.key)).toBe(true);
      }
      // Exactement une surface mobile par entrée, exactement un groupe sidebar.
      expect(bar.length + more.length).toBe(adminNavVisible(permission).length);
      expect(sidebar.length).toBe(adminNavVisible(permission).length);
    }
  });

  test("la barre mobile affiche Accueil, Commandes, Catalogue, Chat — le reste va dans Plus", () => {
    expect(adminBarItems(canAll).map((e) => e.key)).toEqual(["dashboard", "orders", "catalogue", "chat"]);
    expect(adminMoreItems(canAll).map((e) => e.key)).toEqual([
      "games", "fournisseur", "payments", "events", "loyalty", "users", "notifications",
    ]);
  });

  test("la sidebar desktop groupe en Opérations / Boutique / Système", () => {
    const groups = adminSidebarGroups(canAll);
    expect(groups.map((g) => g.key)).toEqual(["ops", "shop", "system"]);
    expect(groups[0].items.map((e) => e.key)).toEqual(["dashboard", "orders", "payments", "chat"]);
    expect(groups[1].items.map((e) => e.key)).toEqual(["catalogue", "games", "events", "loyalty"]);
    expect(groups[2].items.map((e) => e.key)).toEqual(["fournisseur", "users", "notifications"]);
  });

  test("Utilisateurs exige la permission users.manage et disparaît sans elle", () => {
    expect(adminNavVisible(canAll).some((e) => e.key === "users")).toBe(true);
    expect(adminNavVisible(canNone).some((e) => e.key === "users")).toBe(false);
  });

  test("tous les libellés résolvent en FR et EN (pas de retombe sur le chemin)", () => {
    for (const e of ADMIN_NAV) {
      expect(resolve("fr", e.labelKey)).toBeTruthy();
      expect(resolve("fr", e.labelKey)).not.toBe(e.labelKey);
      expect(resolve("en", e.labelKey)).toBeTruthy();
      expect(resolve("en", e.labelKey)).not.toBe(e.labelKey);
    }
    for (const g of ADMIN_NAV_GROUPS) {
      expect(resolve("fr", g.labelKey)).not.toBe(g.labelKey);
      expect(resolve("en", g.labelKey)).not.toBe(g.labelKey);
    }
  });

  test("les libellés courts de la barre mobile sont en minuscules et sans ellipse forcée", () => {
    for (const e of adminBarItems(canAll)) {
      for (const lang of ["fr", "en"]) {
        const label = resolve(lang, e.shortLabelKey);
        expect(typeof label).toBe("string");
        expect(label).toBe(label.toLowerCase());
        expect(label).not.toMatch(/…|\.\.\./);
        expect(label.length).toBeLessThanOrEqual(10);
      }
    }
  });

  test("adminBadge résout les compteurs déclarés et vaut 0 sinon", () => {
    const chat = ADMIN_NAV.find((e) => e.key === "chat");
    const fzr = ADMIN_NAV.find((e) => e.key === "fournisseur");
    expect(adminBadge(chat, { chat: 7 })).toBe(7);
    expect(adminBadge(chat, {})).toBe(0);
    expect(adminBadge(fzr, { fzr: 22 })).toBe(22);
    expect(adminBadge(ADMIN_NAV.find((e) => e.key === "orders"), { chat: 7 })).toBe(0);
  });
});
