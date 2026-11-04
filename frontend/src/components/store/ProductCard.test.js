import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CartProvider, useCart } from "@/context/CartContext";
import { ProductCard } from "./ProductCard";

// Le « + » de la carte produit doit suivre EXACTEMENT la règle de quantité du panier (CartContext) :
// abonnements/évo = 1 max, jetons de monnaie de TOUT jeu = plafond 20 — jamais « type === "uc" ».
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key, lang: "fr" }) }));
jest.mock("@/lib/favorites", () => ({ useFavorites: () => [[], jest.fn()] }));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn() }, formatAr: (n) => `${n} Ar` }));
jest.mock("react-router-dom", () => {
  const R = require("react");
  return { Link: ({ children }) => R.createElement("span", null, children) };
});
// Les badges des cartes doivent suivre la monnaie du jeu (données /games), pas un « UC » codé en dur.
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: global.mockGames || [] }) }));

const FF = { id: "ff-310", slug: "ff-310-diamants", name: "310 Diamants", type: "diamonds", price: 2500,
             game_id: "free-fire", uc_amount: 310, purchasable: true };
const PUBG = { id: "pubg-60", slug: "pubg-60-uc", name: "60 UC", type: "uc", price: 900,
               game_id: "pubg-mobile", uc_amount: 60, purchasable: true };
const PRIME = { id: "pubg-prime", slug: "pubg-prime", name: "Prime", type: "prime", price: 1100,
                game_id: "pubg-mobile", duration_months: 1, purchasable: true };
const CODM = { id: "codm-80", slug: "codm-80-cp", name: "80 CP", type: "cp", price: 700,
               game_id: "codm", uc_amount: 80, purchasable: true };
const FF_OFF = { ...FF, id: "ff-off", slug: "ff-off", name: "Pack épuisé", purchasable: false };
const PUBG_POP = { ...PUBG, id: "pubg-60-uc-pop", slug: "pubg-60-uc-pop", name: "60 UC", popular: true };

function ItemsProbe() {
  const { items, setQty } = useCart();
  return (
    <div>
      <div data-testid="probe">{JSON.stringify(items.map((i) => [i.id, i.qty]))}</div>
      <button data-testid="probe-set-5" onClick={() => setQty("ff-310", 5)}>set5</button>
    </div>
  );
}

const byLabel = (c, label) => [...c.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
const probeQty = (c) => JSON.parse(c.querySelector('[data-testid="probe"]').textContent);

async function mountCard(product) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CartProvider><ProductCard product={product} /><ItemsProbe /></CartProvider>);
  });
  return { container, root };
}

async function unmountCard(container, root) {
  await act(async () => root.unmount());
  container.remove();
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  global.mockGames = [
    { id: "pubg-mobile", currency_label: "UC", product_types: [{ key: "uc", label: "UC" }, { key: "prime", label: "Prime" }, { key: "prime_plus", label: "Prime+" }, { key: "evo", label: "Pack évolutif" }] },
    { id: "free-fire", currency_label: "Diamants", product_types: [{ key: "diamonds", label: "Diamants" }] },
    { id: "codm", currency_label: "CP", product_types: [{ key: "cp", label: "CP" }] },
  ];
});
afterEach(() => { delete global.mockGames; delete global.IS_REACT_ACT_ENVIRONMENT; });

test("Free Fire : l'ajout puis le « + » incrémentent la carte ET le panier", async () => {
  const { container, root } = await mountCard(FF);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 310 Diamants").click(); });
    expect(probeQty(container)).toEqual([["ff-310", 1]]);
    const inc = byLabel(container, "Ajouter un exemplaire : 310 Diamants");
    expect(inc.disabled).toBe(false);
    await act(async () => { inc.click(); });
    expect(probeQty(container)).toEqual([["ff-310", 2]]);
    expect(container.querySelector('[aria-live="polite"]').textContent).toContain("2");
  } finally { await unmountCard(container, root); }
});

test("Free Fire : le plafond réel du panier (20) est respecté, carte/panier alignés", async () => {
  const { container, root } = await mountCard(FF);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 310 Diamants").click(); });
    for (let i = 0; i < 25; i++) {
      const inc = byLabel(container, "Ajouter un exemplaire : 310 Diamants");
      if (inc.disabled) break;
      await act(async () => { inc.click(); });
    }
    expect(probeQty(container)).toEqual([["ff-310", 20]]);
    expect(byLabel(container, "Ajouter un exemplaire : 310 Diamants").disabled).toBe(true);
  } finally { await unmountCard(container, root); }
});

test("Abonnements (Prime) : « + » toujours désactivé, quantité forcée à 1", async () => {
  const { container, root } = await mountCard(PRIME);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : Prime").click(); });
    expect(probeQty(container)).toEqual([["pubg-prime", 1]]);
    expect(byLabel(container, "Ajouter un exemplaire : Prime").disabled).toBe(true);
  } finally { await unmountCard(container, root); }
});

test("PUBG Mobile : ajout + « + » inchangés (plafond 20)", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 60 UC").click(); });
    await act(async () => { byLabel(container, "Ajouter un exemplaire : 60 UC").click(); });
    expect(probeQty(container)).toEqual([["pubg-60", 2]]);
  } finally { await unmountCard(container, root); }
});

test("Produit indisponible : aucun bouton d'ajout sur la carte", async () => {
  const { container, root } = await mountCard(FF_OFF);
  try {
    expect(container.textContent).toContain("Indisponible");
    expect(byLabel(container, "Ajouter au panier : Pack épuisé")).toBeUndefined();
    expect(byLabel(container, "Ajouter un exemplaire : Pack épuisé")).toBeUndefined();
  } finally { await unmountCard(container, root); }
});

test("Parcours panier : setQty met à jour la carte (même source de vérité)", async () => {
  const { container, root } = await mountCard(FF);
  try {
    await act(async () => { byLabel(container, "Ajouter au panier : 310 Diamants").click(); });
    await act(async () => { container.querySelector('[data-testid="probe-set-5"]').click(); });
    expect(probeQty(container)).toEqual([["ff-310", 5]]);
    expect(container.querySelector('[aria-live="polite"]').textContent).toContain("5");
  } finally { await unmountCard(container, root); }
});

test("Free Fire : aucun badge de type ni de categorie sur la carte", async () => {
  const { container, root } = await mountCard(FF);
  try {
    // Les badges de type (« UC », « Diamants », « CP »...) et de categorie
    // (« Pack UC », « Abonnement », « Elite Pack ») sont retires : la carte
    // n'affiche plus que « Populaire », la remise et « Indisponible ».
    expect(container.querySelector('[data-testid="card-type-ff-310-diamonds"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-context-ff-310-diamonds"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\bUC\b/);
    // « Diamants » ne subsiste que dans le NOM du produit, jamais dans un badge.
    expect(container.querySelector('[data-testid^="card-type-"]')).toBeNull();
  } finally { await unmountCard(container, root); }
});

test("PUBG Mobile : aucun badge de type ni de categorie, la carte reste lisible", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    expect(container.querySelector('[data-testid="card-type-pubg-60-uc"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-context-pubg-60-uc"]')).toBeNull();
    // Le contenu utile reste : nom, figure, unite et prix.
    expect(container.textContent).toContain("60 UC");
    expect(container.textContent).toContain("900 Ar");
  } finally { await unmountCard(container, root); }
});

test("CODM : aucun badge de type ni de categorie", async () => {
  const { container, root } = await mountCard(CODM);
  try {
    expect(container.querySelector('[data-testid="card-type-codm-80-cp"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-context-codm-80-cp"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\bUC\b/);
  } finally { await unmountCard(container, root); }
});

test("Produit Populaire : le badge « Populaire » (flamme) reste affiche", async () => {
  const { container, root } = await mountCard(PUBG_POP);
  try {
    const badge = container.querySelector('[data-testid="card-context-pubg-60-uc-pop"]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("Populaire");
    expect(badge.querySelector("svg")).not.toBeNull();
    // Fond neon + texte encre : deux surfaces fixes, qui ne suivent pas le theme.
    expect(badge.className).toContain("bg-[color:var(--card-badge-bg)]");
    expect(badge.className).toContain("text-ink");
  } finally { await unmountCard(container, root); }
});

// La pastille de prix suit le theme AVEC la carte (MGS-FE-CARDS-20261104-02
// étape 2) : son texte vient du jeton `--card-ink` (crème en sombre), plus
// jamais de `text-ink` fixe — la surface et le texte changent ENSEMBLE.
test("Carte disponible : la pastille utilise le jeton --card-ink (pas de texte fixe)", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const prix = [...container.querySelectorAll("span")].find((s) => s.textContent.trim() === "900 Ar");
    expect(prix).toBeTruthy();
    const pastille = prix.closest("div[class*='card-pill-bg']");
    expect(pastille).toBeTruthy();
    expect(pastille.className).toContain("text-[color:var(--card-ink)]");
    expect(pastille.className).not.toContain("text-ink");
    expect(pastille.className).not.toContain("text-foreground");
    expect(pastille.className).toContain("border-2");
  } finally { await unmountCard(container, root); }
});

// Étape 2 : le bouton rond d'achat et l'anneau de focus passent par les jetons
// de la carte (néon + icône noire en sombre, encre + icône néon en clair).
test("CTA et focus de la carte passent par les jetons --card-cta-* / --card-focus", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const addBtn = byLabel(container, "Ajouter au panier : 60 UC");
    expect(addBtn.className).toContain("bg-[color:var(--card-cta-bg)]");
    // Modèle : le bouton rond n'a PAS de bordure (même couleur que le fond).
    expect(addBtn.className).not.toContain("border-2");
    expect(addBtn.className).toContain("text-[color:var(--card-cta-fg)]");
    expect(addBtn.className).toContain("outline-[color:var(--card-focus)]");
  } finally { await unmountCard(container, root); }
});

// --- MGS-FE-CARDS-20261104-02 étape 1 : montant pour toutes les monnaies, prix complet ---

// Le montant vedette vient de productFigure (toute monnaie de jeu), plus seulement
// de type === "uc" : Free Fire doit afficher « 310 » + « Diamants » comme PUBG.
test("Free Fire : le montant « 310 » et l'unité « Diamants » sont la vedette", async () => {
  const { container, root } = await mountCard(FF);
  try {
    const figureP = [...container.querySelectorAll("p")].find((p) => p.textContent.includes("310"));
    expect(figureP).toBeTruthy();
    const [montant, unite] = [...figureP.querySelectorAll("span")];
    // Le montant n'est JAMAIS coupé : shrink-0, sans truncate.
    expect(montant.textContent).toBe("310");
    expect(montant.className).toContain("shrink-0");
    expect(montant.className).not.toContain("truncate");
    // L'unité vient de la monnaie du jeu (currency_label), pas d'un « UC » codé en dur.
    expect(unite.textContent).toBe("Diamants");
    expect(unite.className).toContain("truncate");
  } finally { await unmountCard(container, root); }
});

test("Free Fire : le bouton d'achat est « + » (monnaie), comme pour PUBG", async () => {
  const { container, root } = await mountCard(FF);
  try {
    const addBtn = byLabel(container, "Ajouter au panier : 310 Diamants");
    expect(addBtn).toBeTruthy();
    // Chemin du « + » (ICONS.plus) : toute monnaie de jeu donne « + ».
    expect(addBtn.querySelector('path[d="M12 5v14M5 12h14"]')).toBeTruthy();
  } finally { await unmountCard(container, root); }
});

test("Le prix complet n'est jamais coupé : whitespace-nowrap, pas de truncate", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const prix = [...container.querySelectorAll("span")].find((s) => s.textContent.trim() === "900 Ar");
    expect(prix).toBeTruthy();
    expect(prix.className).toContain("whitespace-nowrap");
    expect(prix.className).not.toContain("truncate");
  } finally { await unmountCard(container, root); }
});

test("La remise est hors de la pastille : badge + ancien prix barré au-dessus", async () => {
  const PROMO = { ...FF, id: "ff-promo", slug: "ff-promo", name: "310 Diamants promo", old_price: 3000 };
  const { container, root } = await mountCard(PROMO);
  try {
    const badge = container.querySelector('[data-testid="card-discount-ff-promo"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("-17%");
    // Le badge n'est PAS dans la pastille de prix.
    expect(badge.closest("div[class*='card-pill-bg']")).toBeNull();
    // Sur la même ligne : l'ancien prix, barré.
    const ligne = badge.parentElement;
    const ancien = [...ligne.querySelectorAll("span")].find((s) => s.textContent === "3000 Ar");
    expect(ancien).toBeTruthy();
    expect(ancien.className).toContain("line-through");
    // La pastille n'a « mt-auto » que s'il n'y a pas de ligne de remise.
    const pastille = badge.closest("article").querySelector("div[class*='card-pill-bg']");
    expect(pastille).toBeTruthy();
    expect(pastille.className).not.toContain("mt-auto");
  } finally { await unmountCard(container, root); }
});

test("Sans remise : le bloc du bas garde « mt-auto » (collé en bas)", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const pastille = container.querySelector("div[class*='card-pill-bg']");
    expect(pastille).toBeTruthy();
    // MGS-FE-CARDS-20261104-02B : le mt-auto + le 12 px du modèle vivent sur
    // le bloc du bas (wrapper), plus sur la pastille elle-même.
    const bloc = pastille.parentElement;
    expect(bloc.className).toContain("mt-auto");
    expect(bloc.className).toContain("pt-3");
    expect(pastille.className).not.toContain("mt-auto");
    expect(container.querySelector('[data-testid^="card-discount-"]')).toBeNull();
  } finally { await unmountCard(container, root); }
});

// --- MGS-FE-CARDS-20261104-02B : alignement sur le modèle visuel ---

test("Alignement modèle : unité 11px/leading-none, vedette mt-2, cœur 16px", async () => {
  const { container, root } = await mountCard(FF);
  try {
    const figP = [...container.querySelectorAll("p")].find((p) => p.querySelector("span.shrink-0"));
    expect(figP.className).toContain("mt-2");
    const unite = figP.querySelector("span.min-w-0");
    expect(unite.className).toContain("text-[11px]");
    expect(unite.className).toContain("leading-none");
    expect(unite.className).not.toContain("text-sm");
    const heart = container.querySelector("button[aria-pressed]");
    expect(heart.querySelector("svg").getAttribute("class")).toContain("h-4 w-4");
  } finally { await unmountCard(container, root); }
});

test("Alignement modèle : la pastille d'un pack sans montant porte « + »", async () => {
  const PACK = { id: "pack-frag", slug: "pack-frag", name: "Fragments matériaux", type: "material", price: 5000, game_id: "pubg-mobile", purchasable: true };
  const { container, root } = await mountCard(PACK);
  try {
    const addBtn = byLabel(container, "Ajouter au panier : Fragments matériaux");
    expect(addBtn.querySelector('path[d="M12 5v14M5 12h14"]')).toBeTruthy();
  } finally { await unmountCard(container, root); }
});

test("Alignement modèle : badge « Populaire » bordure encre fixe, padding 9px, 0,08em", async () => {
  const { container, root } = await mountCard(PUBG_POP);
  try {
    const badge = container.querySelector('[data-testid^="card-context-"]');
    expect(badge.className).toContain("border-ink");
    expect(badge.className).not.toContain("card-border");
    expect(badge.className).toContain("px-[9px]");
    expect(badge.className).toContain("tracking-[0.08em]");
  } finally { await unmountCard(container, root); }
});

// --- MGS-FE-CARDS-20261104-02 étape 3 : une seule vedette, carte compacte, zones 44 px ---

test("Carte monnaie : plus de titre visible, le nom passe en sr-only", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const h2 = container.querySelector("h2");
    expect(h2).toBeTruthy();
    expect(h2.className).toContain("sr-only");
    expect(h2.textContent).toContain("60 UC");
    // Le montant reste la vedette visible.
    const figureP = [...container.querySelectorAll("p")].find((p) => p.textContent.includes("60"));
    expect(figureP).toBeTruthy();
  } finally { await unmountCard(container, root); }
});

test("Carte pack : étiquette de catégorie + titre vedette, sans hauteur minimale", async () => {
  const PACK = { id: "pack-frag", slug: "pack-frag", name: "Fragments matériaux", type: "material", price: 5000, game_id: "pubg-mobile", purchasable: true };
  const { container, root } = await mountCard(PACK);
  try {
    const label = [...container.querySelectorAll("p")].find((p) => p.textContent === "card.category.pack");
    expect(label).toBeTruthy();
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-[color:var(--card-ink-muted)]");
    const h2 = container.querySelector("h2");
    expect(h2.textContent).toContain("Fragments matériaux");
    expect(h2.className).toContain("line-clamp-2");
    expect(h2.className).toContain("[text-wrap:balance]");
    expect(h2.className).not.toContain("min-h");
    const article = container.querySelector("article");
    expect(article.className).not.toContain("min-h-[260px]");
    expect(article.className).toContain("h-full");
  } finally { await unmountCard(container, root); }
});

test("Mapping des étiquettes : prime sans durée → « abonnement »", async () => {
  const PRIME_ND = { id: "prime-nd", slug: "prime-nd", name: "Prime 7 jours", type: "prime", price: 2500, game_id: "pubg-mobile", purchasable: true };
  const { container, root } = await mountCard(PRIME_ND);
  try {
    expect([...container.querySelectorAll("p")].some((p) => p.textContent === "card.category.subscription")).toBe(true);
  } finally { await unmountCard(container, root); }
});

test("Mapping des étiquettes : evo → « pack évolutif »", async () => {
  const EVO = { id: "evo-pack", slug: "evo-pack", name: "Pack évolutif", type: "evo", price: 19000, game_id: "pubg-mobile", purchasable: true };
  const { container, root } = await mountCard(EVO);
  try {
    expect([...container.querySelectorAll("p")].some((p) => p.textContent === "card.category.evo")).toBe(true);
    // L'evo garde son icône « panier ».
    expect(byLabel(container, "Ajouter au panier : Pack évolutif").querySelector("circle")).toBeTruthy();
  } finally { await unmountCard(container, root); }
});

test("Zones tactiles 44 px : cœur et bouton rond étendus par pseudo-élément", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const heart = container.querySelector("button[aria-pressed]");
    expect(heart.className).toContain("before:-inset-1.5");
    expect(heart.className).toContain("before:content-['']");
    const addBtn = byLabel(container, "Ajouter au panier : 60 UC");
    expect(addBtn.className).toContain("before:-inset-0.5");
    expect(addBtn.className).toContain("before:content-['']");
  } finally { await unmountCard(container, root); }
});

test("Container query : l'article porte mgs-card et le prix mgs-card-price", async () => {
  const { container, root } = await mountCard(PUBG);
  try {
    const article = container.querySelector("article");
    expect(article.className).toContain("mgs-card");
    const prix = [...container.querySelectorAll("span")].find((s) => s.textContent.trim() === "900 Ar");
    expect(prix.className).toContain("mgs-card-price");
    expect(prix.className).toContain("text-base");
    expect(prix.className).toContain("sm:text-2xl");
    expect(prix.className).not.toContain("clamp");
  } finally { await unmountCard(container, root); }
});
