import { absoluteImage, canonicalFor, isPrivatePath, keywordsFor, SITE_URL } from "./seo";

describe("SEO — URL canonique", () => {
  it("garde les facettes utiles du catalogue et retire le bruit", () => {
    expect(canonicalFor("/boutique", "?game=pubg-mobile&sort=price_asc&q=uc&min=1000"))
      .toBe(`${SITE_URL}/boutique?game=pubg-mobile`);
  });

  it("ne garde aucune query hors catalogue", () => {
    expect(canonicalFor("/produit/60-uc", "?utm_source=facebook"))
      .toBe(`${SITE_URL}/produit/60-uc`);
  });

  it("produit la racine avec slash final", () => {
    expect(canonicalFor("/")).toBe(`${SITE_URL}/`);
  });
});

describe("SEO — routes privées", () => {
  it("exclut compte, commande, admin, chat et authentification", () => {
    ["/admin", "/admin/catalogue", "/compte", "/compte/points", "/commande", "/suivi/ABC", "/orders/xyz", "/connexion", "/support", "/chat"]
      .forEach((path) => expect(isPrivatePath(path)).toBe(true));
  });

  it("laisse indexables les pages publiques", () => {
    ["/", "/jeux", "/boutique", "/produit/60-uc", "/evenements", "/pack-evolutif", "/terms", "/privacy"]
      .forEach((path) => expect(isPrivatePath(path)).toBe(false));
  });
});

describe("SEO — mots-clés", () => {
  it("résout le préfixe le plus long (fiche produit)", () => {
    expect(keywordsFor("/produit/60-uc", "fr")).toContain("UC PUBG Mobile");
    expect(keywordsFor("/produit/60-uc", "en")).toContain("PUBG Mobile UC");
  });

  it("retombe sur la page d'accueil pour une route inconnue", () => {
    expect(keywordsFor("/inconnu", "fr")).toBe(keywordsFor("/", "fr"));
  });
});

describe("SEO — images", () => {
  it("préfixe les images relatives avec le domaine canonique", () => {
    expect(absoluteImage("/uploads/a.png")).toBe(`${SITE_URL}/uploads/a.png`);
    expect(absoluteImage("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(absoluteImage(null)).toBe(`${SITE_URL}/og-image.png`);
  });
});
