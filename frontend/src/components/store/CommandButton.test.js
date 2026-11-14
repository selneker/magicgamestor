import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CommandButton from "./CommandButton";

// PL-005-FE-02 (tâche 2) — composant de recherche fourni (ANNEXE A), adapté
// aux conventions du projet. Comportements couverts : ouverture par clic ou
// par le raccourci Ctrl+K / ⌘K, refermeture par Échap et par clic dehors,
// placeholder traduit rendu dans le champ, aria-keyshortcuts posé sur la
// pilule fermée, onSearch déclenché par Entrée.

jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key) => (key === "order.find" ? "Rechercher" : key),
    lang: "fr",
  }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  document.body.innerHTML = "";
});

async function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

// Le composant écoute les touches sur window : simule Ctrl+K / ⌘K pressé.
function pressKey(key, { ctrl = false, meta = false, code } = {}) {
  return new KeyboardEvent("keydown", {
    key, ctrlKey: ctrl, metaKey: meta, bubbles: true, code: code || `Key${key.toUpperCase()}`,
  });
}

// Sortie d'animation AnimatePresence : le DOM n'est nettoyé qu'après la
// transition (180 ms), attendue en temps réel.
const waitExit = () => act(async () => { await new Promise((r) => setTimeout(r, 350)); });

describe("CommandButton (tâche 2)", () => {
  test("fermé par défaut, ouvre au clic, champ + Esc visibles, aria-keyshortcuts", async () => {
    const { container, root } = await mount(
      <CommandButton shortcut="mod+k" placeholder="N° de commande ou ID joueur">Rechercher</CommandButton>,
    );
    const trigger = container.querySelector('[data-testid="command-button-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain("Rechercher");
    // Raccourci annoncé aux lecteurs d'écran (Control+K sur plateforme PC en jsdom).
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    expect(container.querySelector('[data-testid="command-input"]')).toBeNull();
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = container.querySelector('[data-testid="command-input"]');
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("N° de commande ou ID joueur");
    // Les touches Ctrl + K sont affichées sur la pilule fermée.
    expect(trigger.textContent).toContain("K");
    await act(async () => root.unmount());
  });

  test("ouvre par le raccourci clavier Ctrl+K (et Échap referme)", async () => {
    const onSearch = jest.fn();
    const { container, root } = await mount(<CommandButton onSearch={onSearch} placeholder="Recherche" />);
    expect(container.querySelector('[data-testid="command-input"]')).toBeNull();
    // keydown global : Ctrl enfoncé + K (isTrusted = false en jsdom, accepté).
    await act(async () => window.dispatchEvent(pressKey("k", { ctrl: true })));
    expect(container.querySelector('[data-testid="command-input"]')).not.toBeNull();
    // Échap referme, remet le champ à vide.
    await act(async () => container.querySelector('[data-testid="command-input"]').dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ));
    await waitExit();
    expect(container.querySelector('[data-testid="command-input"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("Entrée déclenche onSearch avec la valeur du champ ; clic dehors referme", async () => {
    const onSearch = jest.fn();
    const { container, root } = await mount(<CommandButton onSearch={onSearch} placeholder="Recherche" />);
    await act(async () => container.querySelector('[data-testid="command-button-trigger"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    const input = container.querySelector('[data-testid="command-input"]');
    await act(async () => {
      // React 19 : la saisie passe par le value tracker (setter natif + event input).
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "MGS-123");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSearch).toHaveBeenCalledWith("MGS-123");
    // Clic hors de la pilule → refermeture.
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await waitExit();
    expect(container.querySelector('[data-testid="command-input"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
