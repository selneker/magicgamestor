// PL-005-FE-03 — la base design system inverse encre/crème pour le thème
// sombre (la maquette PL-DS-003 n'a qu'un thème clair) et ajoute des jetons
// de marque FIXES (--brand-*, --panel*). Ce test lit src/index.css et garantit
// que l'inversion et les jetons existent — sans build ni navigateur.
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "index.css"), "utf8");

// Petit extracteur : contenu d'un sélecteur de premier niveau (":root" / ".dark").
function blockOf(selector) {
  // Le sélecteur est cherché en début de ligne (indentation comprise).
  const start = css.indexOf(selector);
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  let depth = 1, i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(open + 1, i - 1);
}

const rootBlock = blockOf(":root");
const darkBlock = blockOf(".dark");

test("PL-005-FE-03 : jetons de marque fixes présents (encre #111111, crème #F4F1E8, néon #D4FF00)", () => {
  for (const [token, value] of [
    ["--brand-ink", "#111111"],
    ["--brand-cream", "#F4F1E8"],
    ["--brand-neon", "#D4FF00"],
    ["--brand-violet", "#5c4ade"],
    ["--brand-blue", "#4da2ff"],
    ["--brand-yellow", "#ffd731"],
    ["--brand-green", "#55db9c"],
  ]) {
    expect(rootBlock).toContain(`${token}: ${value}`);
  }
});

test("PL-005-FE-03 : thème clair = crème en fond, encre en texte", () => {
  expect(rootBlock).toContain("--foreground: 0 0% 7%"); // #111111
  expect(rootBlock).toMatch(/--background: var\(--cream\)/);
});

test("PL-005-FE-03 : thème sombre = inversion encre/crème (la maquette n'a qu'un thème clair)", () => {
  expect(darkBlock).toContain("--background: 0 0% 7%");        // l'encre devient le fond
  expect(darkBlock).toContain("--foreground: 45 35% 93%");     // la crème devient le texte
});

test("PL-005-FE-03 : les accents de marque sont identiques dans les deux thèmes", () => {
  for (const token of ["--primary", "--accent"]) {
    const light = rootBlock.match(new RegExp(`${token}: 170 100% 50%`));
    const dark = darkBlock.match(new RegExp(`${token}: 170 100% 50%`));
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
  }
});

test("PL-DS-V3 : polices embarquées inline (aucun appel Google Fonts, @font-face woff2)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  // Mode prototype statique (design-system-v3.html) : les polices sont
  // embarquées en data URI dans le HTML — aucun appel Google Fonts, aucun
  // fichier /fonts/ externe. L'intention « auto-hébergées » est préservée.
  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).not.toContain("fonts.gstatic.com");
  expect(html.match(/@font-face/g).length).toBe(4); // Onest + Bricolage × (latin + latin-ext)
  expect(html).toMatch(/woff2/); // polices woff2 embarquées
  expect(css).not.toContain("fonts.googleapis");
  expect(css).not.toContain("fonts.gstatic");
});
