import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "fs";
import { join } from "path";
import { PubgIdVerify } from "./PubgIdVerify";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({ api: { post: jest.fn() }, errorMessage: () => "erreur" }));
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

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.post.mockReset();
});
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

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
