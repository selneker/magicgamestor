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

    // Corrections design 2026-11-25 : cibles 44 px, champ mobile 16 px,
    // focus clavier et dialogue d'annulation. Sans ce garde-fou, une copie
    // depuis design-system-v3.html (non suivie) effacerait les correctifs.
    it("verrouille les correctifs d'accessibilite du prototype", () => {
        const hit = 'content:"";position:absolute;left:50%;top:50%;width:100%;min-width:44px;height:44px;transform:translate(-50%,-50%)';
        expect(html).toContain(".mgs-crumb a::after{" + hit + "}");
        expect(html).toContain(".mgs-tag-toggle::after{" + hit + "}");
        expect(html).toContain("@media (max-width:767px){.mgs-input{font-size:16px}}");
        expect(html).toContain(".mgs-input:focus-visible{box-shadow:0 0 0 .2em var(--color--yellow-700)}");
        expect(html).toContain('aria-modal="true" aria-label="Annuler la commande"');
        expect(html).toContain("__mgsCancelTrigger");
    });
});
