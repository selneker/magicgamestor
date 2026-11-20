/**
 * Garde-fou de déploiement : l'index HTML public ne doit pas embarquer de
 * script tiers de prévisualisation (le logger Emergent n'a aucune utilité
 * en production et a été retiré après l'incident « écran gris / CSP »).
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"),
    "utf8",
);

describe("public/index.html", () => {
    it("ne charge plus le logger de prévisualisation Emergent", () => {
        expect(html).not.toMatch(/assets\.emergent\.sh/);
    });

    it("conserve le bootstrap de thème et les ressources publiques", () => {
        expect(html).toMatch(/mgs-theme/);
        expect(html).toMatch(/%PUBLIC_URL%\/manifest\.json/);
    });
});
