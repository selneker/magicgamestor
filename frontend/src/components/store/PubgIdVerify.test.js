import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "fs";
import { join } from "path";
import { PubgIdVerify } from "./PubgIdVerify";
import { api } from "@/lib/api";

// `errorMessage` reproduit le comportement REEL (renvoie le `detail` de l'API) :
// le test prouve que le composant ne l'affiche pas.
jest.mock("@/lib/api", () => ({
  api: { post: jest.fn() },
  errorMessage: (e, fallback) => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join(" ");
    return fallback;
  },
}));
jest.mock("@/context/LanguageContext", () => ({ useLang: () => ({ t: (key) => key }) }));

const VALID_ID = "52328390220";

/* --- contraste du bouton inactif -------------------------------------------
   Les valeurs sont lues DANS index.css, par BLOC de theme (`:root` et `.dark`),
   jamais par ordre de declaration : le test suit le CSS au lieu de le figer. */
const css = readFileSync(join(__dirname, "..", "..", "index.css"), "utf8");
const themeBlock = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`bloc ${selector} introuvable dans index.css`);
  return css.slice(start, css.indexOf("}", start));
};
const token = (block, name) => {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`jeton --${name} introuvable`);
  return m[1].trim();
};
const hslToRgb = (value) => {
  const [h, s, l] = value.split(/\s+/).map(parseFloat);
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
};
const luminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Le composant a besoin que le CHAMP change vraiment : on monte un petit
// conteneur qui tient l'ID dans un state.
function Harness({ pubgId, onVerified }) {
  const [id, setId] = useState(pubgId);
  return (
    <>
      <button type="button" data-testid="harness-change" onClick={() => setId("111111111")}>change</button>
      <PubgIdVerify pubgId={id} onVerified={onVerified} checkout />
    </>
  );
}

async function mount(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PubgIdVerify pubgId="" onVerified={jest.fn()} checkout {...props} />);
  });
  return { container, root };
}
const unmount = async (container, root) => {
  await act(async () => root.unmount());
  container.remove();
};
const btnOf = (container) => container.querySelector('[data-testid="pubg-verify-btn"]');
const errorOf = (container) => container.querySelector('[data-testid="pubg-verify-error"]');
const invalidOf = (container) => container.querySelector('[data-testid="pubg-verify-invalid"]');

let warnSpy;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.post.mockReset();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete global.IS_REACT_ACT_ENVIRONMENT;
  warnSpy.mockRestore();
});

test("Etat inactif : aria-disabled (pas disabled), fond attenue, sans effet au survol, contraste >= 3:1", async () => {
  const { container, root } = await mount({ pubgId: "" });
  try {
    const btn = btnOf(container);
    // `aria-disabled` et non l'attribut `disabled` : le bouton reste focusable.
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.className).toContain("bg-muted");
    expect(btn.className).toContain("text-foreground");
    expect(btn.className).toContain("cursor-not-allowed");
    expect(btn.className).not.toContain("opacity-50");
    expect(btn.className).not.toContain("hover:opacity-90");

    // Le couple de jetons utilise par l'etat inactif (bg-muted + text-foreground)
    // doit rester lisible dans les deux themes.
    const clair = contrast(hslToRgb(token(themeBlock(":root"), "foreground")), hslToRgb(token(themeBlock(":root"), "muted")));
    const sombre = contrast(hslToRgb(token(themeBlock(".dark"), "foreground")), hslToRgb(token(themeBlock(".dark"), "muted")));
    expect(clair).toBeGreaterThanOrEqual(3);
    expect(sombre).toBeGreaterThanOrEqual(3);
  } finally { await unmount(container, root); }
});

test("Clic sur le bouton inactif : aucune requete, aucun changement d'etat", async () => {
  const { container, root } = await mount({ pubgId: "123" }); // trop court : inactif
  try {
    const btn = btnOf(container);
    await act(async () => { btn.click(); });
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="pubg-verify-invalid"]')).toBeNull();
    expect(container.textContent).toContain("checkout.verify");
  } finally { await unmount(container, root); }
});

test("Entree sur le bouton inactif : il reste focusable et ne declenche rien", async () => {
  const { container, root } = await mount({ pubgId: "" });
  try {
    const btn = btnOf(container);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    await act(async () => {
      btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      // jsdom ne traduit pas Entree en clic : on emule l'activation que fait le
      // navigateur sur un bouton focusable (Entree -> clic).
      btn.click();
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="pubg-verify-invalid"]')).toBeNull();
  } finally { await unmount(container, root); }
});

test("Entree dans le champ de l'ID (vide ou invalide) : aucune requete, aucune soumission", async () => {
  const { container, root } = await mount({ pubgId: "" });
  try {
    const btn = btnOf(container);
    // Le bouton ne peut pas soumettre un formulaire : ce n'est pas un submit.
    expect(btn.getAttribute("type")).toBe("button");
    const form = document.createElement("form");
    const input = document.createElement("input");
    form.appendChild(input);
    container.appendChild(form);
    const submitted = jest.fn();
    form.addEventListener("submit", (e) => { e.preventDefault(); submitted(); });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

test("Verification en cours : bouton inerte, aria-busy, pas de double requete", async () => {
  let resolve;
  api.post.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { container, root } = await mount({ pubgId: VALID_ID });
  try {
    const btn = btnOf(container);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    await act(async () => { btn.click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    // Le « en cours » reste sur le fond actif : lisible (encre sur creme).
    expect(btn.className).toContain("bg-foreground");
    expect(btn.className).toContain("text-background");
    expect(container.querySelector('[data-testid="pubg-verify-loading"]')).not.toBeNull();
    await act(async () => { btn.click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: { valid: true, player_name: "Test" } }); });
  } finally { await unmount(container, root); }
});

test("Etat actif : le clic declenche bien la verification", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Test" } });
  const { container, root } = await mount({ pubgId: VALID_ID });
  try {
    const btn = btnOf(container);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    await act(async () => { btn.click(); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/fazercards/pubg/validate-id", { player_id: VALID_ID });
  } finally { await unmount(container, root); }
});

test("Forme attendue : valid:false affiche le libelle PUBG historique", async () => {
  api.post.mockResolvedValue({ data: { valid: false, message: "ID PUBG Mobile invalide" } });
  const { container, root } = await mount({ pubgId: VALID_ID });
  try {
    await act(async () => { btnOf(container).click(); });
    expect(invalidOf(container)).not.toBeNull();
    // Le libelle historique reste celui de `checkout.verifyInvalid`.
    expect(invalidOf(container).textContent).toContain("checkout.verifyInvalid");
    expect(errorOf(container)).toBeNull();
  } finally { await unmount(container, root); }
});

test("Forme inattendue (HTML, {}, null) : etat erreur, jamais « ID invalide »", async () => {
  const cas = [
    { nom: "HTML", data: "<html>oops</html>" },
    { nom: "objet vide", data: {} },
    { nom: "null", data: null },
  ];
  for (const c of cas) {
    api.post.mockResolvedValue({ data: c.data });
    const { container, root } = await mount({ pubgId: VALID_ID });
    try {
      await act(async () => { btnOf(container).click(); });
      expect(invalidOf(container)).toBeNull();
      expect(errorOf(container)).not.toBeNull();
      // Le message de panne, jamais le libelle « ID invalide ».
      expect(errorOf(container).textContent).toContain("checkout.verifyProviderUnavailable");
      expect(container.textContent).not.toContain("checkout.verifyInvalid");
      expect(warnSpy).toHaveBeenCalled();
    } finally { await unmount(container, root); }
  }
});

test("Reponse arrivee apres une modification du champ : ignoree", async () => {
  let resolve;
  api.post.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const onVerified = jest.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Harness pubgId={VALID_ID} onVerified={onVerified} />); });
  try {
    await act(async () => { btnOf(container).click(); });
    expect(api.post).toHaveBeenCalledTimes(1);

    // Le joueur modifie le champ PENDANT que la requete est en vol.
    await act(async () => { container.querySelector('[data-testid="harness-change"]').click(); });

    // La reponse, arrivee trop tard, ne doit rien poser.
    await act(async () => { resolve({ data: { valid: true, player_name: "Test" } }); });

    expect(container.querySelector('[data-testid="pubg-verify-valid"]')).toBeNull();
    expect(invalidOf(container)).toBeNull();
    expect(errorOf(container)).toBeNull();
    expect(onVerified).not.toHaveBeenCalledWith(expect.objectContaining({ name: "Test" }));
  } finally { await unmount(container, root); }
});

test("Erreur : message generique traduit, aucun detail technique affiche", async () => {
  const cas = [
    { nom: "422", erreur: { response: { status: 422, data: { detail: [{ loc: ["body"], msg: "field required" }] } } }, attendu: "checkout.errProvider", interdit: ["field required"] },
    { nom: "404", erreur: { response: { status: 404, data: { detail: "jeu inconnu" } } }, attendu: "checkout.errProvider", interdit: ["jeu inconnu"] },
    { nom: "500", erreur: { response: { status: 500, data: { detail: "boom" } } }, attendu: "checkout.errProvider", interdit: ["boom"] },
    { nom: "reseau", erreur: { message: "Network Error" }, attendu: "checkout.errTemporary", interdit: ["Network Error"] },
  ];
  for (const c of cas) {
    api.post.mockRejectedValue(c.erreur);
    const { container, root } = await mount({ pubgId: VALID_ID });
    try {
      await act(async () => { btnOf(container).click(); });
      const text = errorOf(container).textContent;
      // Un message traduit du dictionnaire...
      expect(text).toContain(c.attendu);
      // ...et jamais le detail brut de l'API.
      for (const interdit of c.interdit) expect(text).not.toContain(interdit);
      expect(warnSpy).toHaveBeenCalled();
    } finally { await unmount(container, root); }
  }
});

test("Panneau invalide : fond et texte du meme couple de jetons, contraste >= 4,5:1 dans les deux themes", async () => {
  api.post.mockResolvedValue({ data: { valid: false, message: "ID PUBG Mobile invalide" } });
  const { container, root } = await mount({ pubgId: VALID_ID });
  try {
    await act(async () => { btnOf(container).click(); });
    const el = invalidOf(container);
    expect(el.className).toContain("bg-destructive");
    expect(el.className).toContain("text-destructive-foreground");
    // Plus de rouge fige sur un fond fige : c'est ce qui vautait 4,41:1.
    expect(el.className).not.toContain("bg-red-50");
    expect(el.className).not.toContain("text-red-600");
    // Le couple mesure DANS index.css, par bloc de theme.
    const clair = contrast(hslToRgb(token(themeBlock(":root"), "destructive-foreground")), hslToRgb(token(themeBlock(":root"), "destructive")));
    const sombre = contrast(hslToRgb(token(themeBlock(".dark"), "destructive-foreground")), hslToRgb(token(themeBlock(".dark"), "destructive")));
    expect(clair).toBeGreaterThanOrEqual(4.5);
    expect(sombre).toBeGreaterThanOrEqual(4.5);
  } finally { await unmount(container, root); }
});

test("Annonce : alert sur invalide et erreur, status sur le compte verifie", async () => {
  api.post.mockResolvedValue({ data: { valid: false } });
  const invalide = await mount({ pubgId: VALID_ID });
  try {
    await act(async () => { btnOf(invalide.container).click(); });
    expect(invalidOf(invalide.container).getAttribute("role")).toBe("alert");
  } finally { await unmount(invalide.container, invalide.root); }

  api.post.mockRejectedValue({ response: { status: 500, data: { detail: "boom" } } });
  const echec = await mount({ pubgId: VALID_ID });
  try {
    await act(async () => { btnOf(echec.container).click(); });
    expect(errorOf(echec.container).getAttribute("role")).toBe("alert");
  } finally { await unmount(echec.container, echec.root); }

  api.post.mockResolvedValue({ data: { valid: true, player_name: "Test" } });
  const succes = await mount({ pubgId: VALID_ID });
  try {
    await act(async () => { btnOf(succes.container).click(); });
    expect(succes.container.querySelector('[data-testid="pubg-verify-valid"]').getAttribute("role")).toBe("status");
  } finally { await unmount(succes.container, succes.root); }
});
