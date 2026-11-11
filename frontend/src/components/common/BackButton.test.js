import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { BackButton } from "./BackButton";

// PL-CHK-5 — flèche de retour style iOS « ‹ » : chevron nu SANS cercle ni fond
// (l'ancien bouton rond h-10 w-10 rounded-full border bg-card est retiré),
// zone tactile 44 × 44 px, aria-label FR/EN, lien quand `to` est fourni.

jest.mock("react-router-dom", () => {
  const React = require("react");
  return { Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children) };
});
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({ t: (p) => ({ "common.back": "Retour" }[p] || p), lang: "fr" }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("BackButton (chevron iOS)", () => {
  test("action : sans cercle ni bordure, zone tactile 44 px, aria-label", async () => {
    const onClick = jest.fn();
    const { container, root } = await mount(<BackButton onClick={onClick} testId="test-back" />);
    const btn = container.querySelector('[data-testid="test-back"]');
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-label")).toBe("Retour");
    // Zone tactile 44 × 44 : classes h-11 w-11 (jsdom ne calcule pas la mise en page).
    expect(btn.className).toContain("h-11");
    expect(btn.className).toContain("w-11");
    // AUCUN cercle : ni fond de carte ni bordure pleine du composant lui-même.
    expect(btn.className).not.toContain("rounded-full");
    expect(btn.className).not.toContain("border");
    expect(btn.className).not.toContain("bg-card");
    expect(container.querySelector("svg")).not.toBeNull(); // chevron
    await act(async () => { btn.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  test("lien : rend un <a> vers la cible, mêmes garanties", async () => {
    const { container, root } = await mount(<BackButton to="/boutique" testId="test-back-link" />);
    const a = container.querySelector('[data-testid="test-back-link"]');
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("/boutique");
    expect(a.getAttribute("aria-label")).toBe("Retour");
    expect(a.className).not.toContain("rounded-full");
    await act(async () => root.unmount());
  });
});
