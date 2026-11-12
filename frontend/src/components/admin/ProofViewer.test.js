import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProofViewer } from "./ProofViewer";
import { api } from "@/lib/api";

// PL-UX-4 — visionneuse de preuves : chargement au clic, zoom (+ / − /
// Ajuster), navigation, fermeture (✕, Échap, retour), focus rendu.

jest.mock("@/lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = require("@/i18n/translations");
  const t = (path, vars) => {
    let s = path.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), translations.fr) ?? path;
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  };
  return { useLang: () => ({ t, lang: "fr" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const order = {
  id: "ord-1", order_number: "MGS-1",
  payment_proofs: [
    { size: 1024, uploaded_at: "2026-11-10T10:00:00Z" },
    { size: 2048, uploaded_at: "2026-11-10T10:01:00Z" },
    { size: 512, uploaded_at: "2026-11-10T10:02:00Z" },
  ],
};

let urls;
beforeEach(() => {
  api.get.mockReset();
  urls = [];
  global.URL.createObjectURL = jest.fn(() => { const u = `blob:mock-${urls.length}`; urls.push(u); return u; });
  global.URL.revokeObjectURL = jest.fn();
  api.get.mockImplementation(() => Promise.resolve({ data: new Blob(["x"], { type: "image/png" }) }));
});
afterEach(() => { document.body.innerHTML = ""; });

async function mount(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ProofViewer order={order} {...props} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { container, root };
}

const scaleOf = (container) => {
  const img = container.querySelector('[data-testid="proof-viewer-image"]');
  const m = /scale\(([\d.]+)\)/.exec(img?.getAttribute("style") || "");
  return m ? Number(m[1]) : null;
};

test("PL-UX-4 : l'image est téléchargée à l'ouverture, avec l'authentification courante", async () => {
  const { container, root } = await mount();
  expect(api.get).toHaveBeenCalledWith("/admin/orders/ord-1/proofs/0", { responseType: "blob" });
  expect(container.querySelector('[data-testid="proof-viewer-image"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("PL-UX-4 : la visionneuse est un dialogue modal avec un libellé français", async () => {
  const { container, root } = await mount();
  const viewer = container.querySelector('[data-testid="proof-viewer"]');
  expect(viewer.getAttribute("role")).toBe("dialog");
  expect(viewer.getAttribute("aria-modal")).toBe("true");
  expect(viewer.getAttribute("aria-label")).toBe("Preuves de paiement");
  await act(async () => root.unmount());
});

test("PL-UX-4 : zoom + / − / « Ajuster »", async () => {
  const { container, root } = await mount();
  expect(scaleOf(container)).toBe(1);
  await act(async () => { container.querySelector('[data-testid="proof-zoom-in"]').click(); });
  expect(scaleOf(container)).toBeGreaterThan(1);
  await act(async () => { container.querySelector('[data-testid="proof-zoom-out"]').click(); });
  expect(scaleOf(container)).toBeCloseTo(1, 5);
  await act(async () => { container.querySelector('[data-testid="proof-zoom-in"]').click(); });
  await act(async () => { container.querySelector('[data-testid="proof-zoom-fit"]').click(); });
  expect(scaleOf(container)).toBe(1);
  await act(async () => root.unmount());
});

test("PL-UX-4 : navigation entre images (compteur n/3, flèches, pastilles)", async () => {
  const { container, root } = await mount();
  expect(container.querySelector('[data-testid="proof-viewer-counter"]').textContent).toBe("1 / 3");
  await act(async () => { container.querySelector('[data-testid="proof-viewer-next"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(container.querySelector('[data-testid="proof-viewer-counter"]').textContent).toBe("2 / 3");
  expect(api.get).toHaveBeenCalledWith("/admin/orders/ord-1/proofs/1", { responseType: "blob" });
  await act(async () => { container.querySelector('[data-testid="proof-viewer-dot-2"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(container.querySelector('[data-testid="proof-viewer-counter"]').textContent).toBe("3 / 3");
  await act(async () => root.unmount());
});

test("PL-UX-4 : les flèches du clavier naviguent, Échap ferme", async () => {
  const onClose = jest.fn();
  const { container, root } = await mount({ onClose });
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(container.querySelector('[data-testid="proof-viewer-counter"]').textContent).toBe("2 / 3");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(onClose).toHaveBeenCalled();
  await act(async () => root.unmount());
});

test("PL-UX-4 : le bouton ✕ ferme la visionneuse", async () => {
  const onClose = jest.fn();
  const { container, root } = await mount({ onClose });
  await act(async () => { container.querySelector('[data-testid="proof-viewer-close"]').click(); });
  expect(onClose).toHaveBeenCalled();
  await act(async () => root.unmount());
});

test("PL-UX-4 : le clic en dehors de l'image ferme la visionneuse", async () => {
  const onClose = jest.fn();
  const { container, root } = await mount({ onClose });
  await act(async () => { container.querySelector('[data-testid="proof-viewer-area"]').click(); });
  expect(onClose).toHaveBeenCalled();
  await act(async () => root.unmount());
});

test("PL-UX-4 : une preuve purgée (410) affiche un message d'erreur clair", async () => {
  api.get.mockRejectedValue({ response: { status: 410 } });
  const { container, root } = await mount();
  const error = container.querySelector('[data-testid="proof-viewer-error"]');
  expect(error).not.toBeNull();
  expect(error.getAttribute("role")).toBe("alert");
  expect(error.textContent).toContain("Preuve supprimée");
  await act(async () => root.unmount());
});

test("PL-UX-4 : les URL d'objet sont libérées à la fermeture", async () => {
  const { root } = await mount();
  expect(urls.length).toBeGreaterThan(0);
  await act(async () => root.unmount());
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(urls[0]);
});


test("PL-UX-4 : la visionneuse SURVIT à un rendu du parent (pas de fermeture parasite)", async () => {
  // Régression : l'effet « historique » se rejouait à chaque rendu du parent
  // (nouvelle fonction `onClose`) → le popstate asynchrone du history.back()
  // arrivait sur le listener suivant et fermait la visionneuse d'elle-même au
  // premier rafraîchissement de la liste admin (constaté en capture 1440 px).
  // Note : jsdom ne rejoue pas le popstate de history.back() — ce test garde
  // le comportement « la visionneuse reste montée », le correctif (effet
  // monté UNE fois, `onClose` dans une ref) est vérifié par la capture.
  function Harness() {
    const [open, setOpen] = useState(true);
    const [, bump] = useState(0);
    return (
      <>
        <button type="button" data-testid="rerender" onClick={() => bump((n) => n + 1)}>r</button>
        {open && <ProofViewer order={order} onClose={() => setOpen(false)} />}
      </>
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(container.querySelector('[data-testid="proof-viewer"]')).not.toBeNull();
  // Le parent se re-rend (comme le rafraîchissement de la liste admin).
  await act(async () => { container.querySelector('[data-testid="rerender"]').click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  expect(container.querySelector('[data-testid="proof-viewer"]')).not.toBeNull();
  await act(async () => root.unmount());
});
