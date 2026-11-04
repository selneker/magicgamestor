// makeT (t.js) : résolution locale des clés à point du contrat. Le t() fourni
// reste autoritaire (direct d'abord) ; resolveFlat ne sert qu'aux clés que le
// dot-walk strict ne peut pas résoudre. translations.js réel est utilisé :
// ces tests couvrent les vraies clés FR et EN.

import { makeT, resolveFlat } from "./t";
import { translations } from "@/i18n/translations";

const passthrough = (path) => path; // t() qui ne résout rien : tout passe par resolveFlat

describe("resolveFlat", () => {
  test("descend l'arbre imbriqué classique", () => {
    expect(resolveFlat(translations.fr, "common.save")).toBe("Enregistrer");
    expect(resolveFlat(translations.en, "common.save")).toBe("Save");
  });

  test("résout une clé littérale à point coexistant avec sa clé parente", () => {
    // les trois paires du contrat — impossible au dot-walk strict
    expect(resolveFlat(translations.fr, "admin.provider.section.game")).toBe("Configuration du jeu");
    expect(resolveFlat(translations.fr, "admin.provider.section.game.hint")).toBe(
      "Le code jeu est vérifié contre le catalogue du fournisseur avant l'enregistrement."
    );
    expect(resolveFlat(translations.fr, "admin.aluu_mapping.preview")).toBe("Aperçu");
    expect(resolveFlat(translations.fr, "admin.aluu_mapping.preview.empty")).toBe(
      "Aucune proposition : rien ne peut être appliqué."
    );
    expect(resolveFlat(translations.fr, "admin.aluu_mapping.apply")).toBe("Appliquer la sélection");
    expect(resolveFlat(translations.fr, "admin.aluu_mapping.apply.confirm")).toBe(
      "Appliquer les correspondances sélectionnées ?"
    );
  });

  test("clé absente → undefined (jamais une valeur inventée)", () => {
    expect(resolveFlat(translations.fr, "admin.provider.section.game.hintx")).toBeUndefined();
    expect(resolveFlat(translations.fr, "inexistant.clé")).toBeUndefined();
    expect(resolveFlat(undefined, "common.save")).toBeUndefined();
    expect(resolveFlat(translations.fr, undefined)).toBeUndefined();
  });
});

describe("makeT", () => {
  test("le t() fourni gagne : les moqueries de test restent autoritaires", () => {
    const t = (path) => (path === "sdui.loading" ? "MOCK" : path);
    const tt = makeT(t, "fr");
    expect(tt("sdui.loading")).toBe("MOCK");
  });

  test("clé non résolue par t() mais présente dans le dictionnaire → resolveFlat", () => {
    const tt = makeT(passthrough, "fr");
    expect(tt("common.save")).toBe("Enregistrer");
    expect(tt("admin.provider.section.game.hint")).toBe(
      "Le code jeu est vérifié contre le catalogue du fournisseur avant l'enregistrement."
    );
  });

  test("EN : même résolution côté anglais", () => {
    const tt = makeT(passthrough, "en");
    expect(tt("admin.aluu_mapping.preview.empty")).toBe("No proposal: nothing can be applied.");
    expect(tt("common.save")).toBe("Save");
  });

  test("échec total → même repli que t() (le chemin brut, jamais inventé)", () => {
    const tt = makeT(passthrough, "fr");
    expect(tt("sdui.inexistant")).toBe("sdui.inexistant");
  });

  test("substitution {vars} sur une résolution à plat", () => {
    // sdui.table.selected porte {count} — résolue ici car passthrough ne résout rien
    const tt = makeT(passthrough, "fr");
    expect(tt("sdui.table.selected", { count: 3 })).toBe("3 sélectionnée(s)");
    // variable absente : le jeton reste visible
    expect(tt("sdui.table.selected")).toContain("{count}");
  });
});
