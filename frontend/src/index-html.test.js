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

    // PL-DS-V3 (mode prototype statique, choix propriétaire « option B ») :
    // public/index.html est littéralement design-system-v3.html. Le garde-fou
    // vérifie que le prototype est servi intact (pages mgs-*, animations
    // Lottie, template Slush « Defi ») au lieu du bootstrap React remplacé.
    it("sert le prototype design-system-v3 intact (mode statique)", () => {
        expect(html).toMatch(/mgs-page/);
        expect(html).toMatch(/data-lottie/);
        expect(html).toMatch(/Slush/);
    });
});
