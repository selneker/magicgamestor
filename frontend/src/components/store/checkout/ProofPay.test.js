import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProofPay } from "./ProofPay";

// PL-CHK-2 — paiement manuel : zone de preuve (type/taillée/plafond 3,
// preuves déjà envoyées comprises), envoi multipart sans Content-Type manuel,
// écran d'attente « Preuve envoyée » + Relancer (cooldown/plafond), et
// interrogation du statut (onglet visible, arrêt au démontage / statut final).

const ORDER_PENDING = {
  id: "o1", order_number: "MGS-T1", pubg_id: "123", status: "pending_payment",
  payment_method: "manual", subtotal: 2500, payment_fee: 0,
  items: [{ product_id: "p1", name: "660 UC", quantity: 1 }],
  payment_deadline_at: null, payment_proofs: [],
};
const CONFIG = { providers: { mvola: { merchant: "0383905692", name: "Test Merchant" } } };
const SUMMARY = { lines: [{ key: "p1", label: "1 × 660 UC" }], pubgId: "123", name: "Joueur", method: "USSD", subtotal: 2500, fee: 0 };
const onConfirmed = jest.fn();

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
    useNavigate: () => jest.fn(),
  };
});
jest.mock("sonner", () => ({ toast: { message: jest.fn(), error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errorMessage: (e, f) => `Erreur: ${e?.response?.data?.code || "inconnue"}`,
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
}));
// PL-SEC-HARDEN : le contrat captcha est traité par le mécanisme existant.
jest.mock("@/components/common/CaptchaWidget", () => ({
  isCaptchaError: (e) => e?.response?.data?.code === "captcha_required",
}));
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path, vars) => {
    let v = path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
    if (typeof v === "string" && vars) v = v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    return v;
  };
  return { useLang: () => ({ t: make("fr"), lang: "fr" }) };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'URL d'objet : on compte simplement les libérations.
const mkBlobUrl = jest.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revoke = jest.fn();
URL.createObjectURL = mkBlobUrl;
URL.revokeObjectURL = revoke;

const HHarness = ({ initial }) => {
  const [order, setOrder] = useState(initial);
  return <ProofPay order={order} config={CONFIG} summary={SUMMARY} reference={{ provider: "mvola" }} onUpdated={setOrder} onConfirmed={onConfirmed} />;
};

async function mountProof(order) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<HHarness initial={order} />); });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}

const png = () => new File(["x"], `c-${Math.random().toString(36).slice(2)}.png`, { type: "image/png" });

async function addFiles(container, files) {
  const input = container.querySelector('[data-testid="proof-input"]');
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}

const { api } = require("@/lib/api");

beforeEach(() => {
  jest.useFakeTimers();
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation(() => Promise.resolve({ data: {} }));
  api.post.mockImplementation(() => Promise.resolve({ data: {} }));
});
afterEach(() => {
  document.body.innerHTML = "";
  jest.useRealTimers();
  mkBlobUrl.mockClear(); revoke.mockClear();
  onConfirmed.mockClear();
});

describe("zone de preuve", () => {
  test("rend les instructions USSD, le montant et la zone : compteur 0 / 3", async () => {
    const { container, root } = await mountProof(ORDER_PENDING);
    expect(container.querySelector('[data-testid="ussd-code"]').textContent).toBe("#111*1*2*0383905692*2500*1*0#");
    expect(container.querySelector('[data-testid="manual-amount"]').textContent).toMatch(/2\s500/);
    expect(container.querySelector('[data-testid="proof-count"]').textContent).toBe("0 / 3 captures");
    expect(container.querySelector('[data-testid="proof-submit"]').disabled).toBe(true);
    expect(container.querySelector('[data-testid="manual-reference"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("ajout / retrait de vignettes avec compteur et libération des URL", async () => {
    const { container, root } = await mountProof(ORDER_PENDING);
    await addFiles(container, [png(), png()]);
    expect(container.querySelector('[data-testid="proof-count"]').textContent).toBe("2 / 3 captures");
    expect(container.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(2);
    expect(mkBlobUrl).toHaveBeenCalledTimes(2);
    await act(async () => { container.querySelector('[data-testid="proof-remove-0"]').click(); });
    expect(container.querySelector('[data-testid="proof-count"]').textContent).toBe("1 / 3 captures");
    expect(container.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(1);
    expect(revoke).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("plafond de 3 INCLUT les preuves déjà envoyées", async () => {
    const { container, root } = await mountProof({ ...ORDER_PENDING, payment_proofs: [{ size: 10, content_type: "image/jpeg" }, { size: 10, content_type: "image/jpeg" }] });
    // Compteur plausible : 2 déjà envoyées + 0 locale = 2 / 3.
    expect(container.querySelector('[data-testid="proof-count"]').textContent).toBe("2 / 3 captures");
    await addFiles(container, [png(), png()]); // 2 demandées, une seule possible
    expect(container.querySelector('[data-testid="proof-count"]').textContent).toBe("3 / 3 captures");
    expect(mkBlobUrl).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  test("type refusé (JPEG/PNG uniquement) et taille refusée (8 Mo)", async () => {
    const { container, root } = await mountProof(ORDER_PENDING);
    const bad = new File(["x"], "c.gif", { type: "image/gif" });
    await addFiles(container, [bad]);
    expect(container.querySelector('[data-testid="proof-error"]').textContent).toContain("JPEG ou PNG");
    expect(mkBlobUrl).not.toHaveBeenCalled();
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    await addFiles(container, [big]);
    expect(container.querySelector('[data-testid="proof-error"]').textContent).toContain("8 Mo");
    await act(async () => root.unmount());
  });
});

describe("envoi de la preuve", () => {
  test("succès : POST FormData (champ files répété), état réel et écran d'attente", async () => {
    const uploaded = { ...ORDER_PENDING, status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/png", uploaded_at: "2026-11-10T10:00:00Z" }] };
    api.post.mockImplementation((url) => (url === "/orders/o1/proof" ? Promise.resolve({ data: {} }) : Promise.resolve({ data: {} })));
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: uploaded }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(ORDER_PENDING);
    await addFiles(container, [png(), png()]);
    expect(container.querySelector('[data-testid="proof-submit"]').disabled).toBe(false);
    await act(async () => { container.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const call = api.post.mock.calls.find((c) => c[0] === "/orders/o1/proof");
    expect(call[1]).toBeInstanceOf(FormData);
    expect(Array.from(call[1].getAll("files")).length).toBe(2);
    expect(container.querySelector('[data-testid="proof-waiting"]')).not.toBeNull(); // écran « Preuve envoyée »
    expect(container.querySelector('[data-testid="proof-waiting"]').textContent).toContain("Preuve envoyée");
    // Pas de compte à rebours sur l'écran d'attente.
    expect(container.querySelector('[data-testid="payment-countdown"]')).toBeNull();
    expect(revoke).toHaveBeenCalled(); // URL libérées au succès
    await act(async () => root.unmount());
  });

  test("breadcrumbs de codes serveur → messages FR clairs (409/429/503/captcha)", async () => {
    const error = (status, code) => ({ response: { status, data: { detail: { code, message: "x" } } } });
    const cases = [
      [409, "proof_format", "JPEG ou PNG"],
      [409, "proof_too_large", "8 Mo"],
      [409, "proof_count", "1 à 3"],
      [409, "proof_limit", "Trois preuves"],
      [409, "proof_not_pending", "n'attend plus"],
      [409, "proof_already_validated", "déjà été validée"],
      [409, "proof_conflict", "réessayez"],
      [429, null, "Trop d'envois"],
      [503, null, "indisponible"],
      [400, "other", null], // pas de code reconnu → errorMessage générique
    ];
    for (const [status, code, expected] of cases) {
      api.post.mockImplementation((url) => (url === "/orders/o1/proof" ? Promise.reject(error(status, code)) : Promise.resolve({ data: {} })));
      const { container, root } = await mountProof(ORDER_PENDING);
      await addFiles(container, [png()]);
      await act(async () => { container.querySelector('[data-testid="proof-submit"]').click(); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const msg = container.querySelector('[data-testid="proof-error"]').textContent;
      if (expected === null) expect(msg).toContain("Erreur:"); else expect(msg).toContain(expected);
      expect(msg).not.toMatch(/^proof_|remind_/); // jamais un nom technique brut
      await act(async () => root.unmount());
    }
  });

  test("captcha_required → le mécanisme existant prend la main", async () => {
    api.post.mockImplementation((url) => (url === "/orders/o1/proof" ? Promise.reject({ response: { status: 400, data: { code: "captcha_required" } } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(ORDER_PENDING);
    await addFiles(container, [png()]);
    await act(async () => { container.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="proof-error"]').textContent).toContain("contrôle de sécurité");
    await act(async () => root.unmount());
  });

  test("proof_deadline_passed : la commande est rechargée → écran expiré", async () => {
    api.post.mockImplementation((url) => (url === "/orders/o1/proof" ? Promise.reject({ response: { status: 400, data: { detail: { code: "proof_deadline_passed" } } } }) : Promise.resolve({ data: {} })));
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: { ...ORDER_PENDING, status: "expired" } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(ORDER_PENDING);
    await addFiles(container, [png()]);
    await act(async () => { container.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="proof-expired"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-expired"]').textContent).toContain("Aucun paiement n'a été débité");
    await act(async () => root.unmount());
  });
});

describe("écran d'attente + Relancer", () => {
  const waiting = { ...ORDER_PENDING, status: "proof_submitted", payment_proofs: [{ size: 10, content_type: "image/png", uploaded_at: "2026-11-10T10:00:00Z" }] };

  test("Relancer : succès → cooldown + relances restantes ; bouton désactivé pendant", async () => {
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: waiting }) : Promise.resolve({ data: {} })));
    api.post.mockImplementation((url) => (url === "/orders/o1/remind" ? Promise.resolve({ data: { ok: true, reminders_left: 2, remaining_seconds: 180, next_at: "now+180" } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(waiting);
    const btn = container.querySelector('[data-testid="remind-button"]');
    await act(async () => { btn.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="remind-cd"]').textContent).toContain("03:00");
    expect(container.querySelector('[data-testid="remind-left"]').textContent).toContain("2");
    expect(container.querySelector('[data-testid="remind-button"]').disabled).toBe(true); // cooldown
    await act(async () => root.unmount());
  });

  test("remind_cooldown 429 → minutes affichées, bouton désactivé", async () => {
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: waiting }) : Promise.resolve({ data: {} })));
    api.post.mockImplementation((url) => (url === "/orders/o1/remind" ? Promise.reject({ response: { status: 429, data: { detail: { code: "remind_cooldown", remaining_seconds: 95 } } } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(waiting);
    await act(async () => { container.querySelector('[data-testid="remind-button"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="remind-cd"]').textContent).toContain("01:35");
    expect(container.querySelector('[data-testid="remind-button"]').disabled).toBe(true);
    await act(async () => root.unmount());
  });

  test("remind_limit → bouton désactivé avec message clair", async () => {
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: waiting }) : Promise.resolve({ data: {} })));
    api.post.mockImplementation((url) => (url === "/orders/o1/remind" ? Promise.reject({ response: { status: 429, data: { detail: { code: "remind_limit" } } } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(waiting);
    await act(async () => { container.querySelector('[data-testid="remind-button"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="remind-limit"]').textContent).toContain("maximal");
    expect(container.querySelector('[data-testid="remind-button"]').disabled).toBe(true);
    await act(async () => root.unmount());
  });

  test("statut devient late_payment : écran dédié sans promesse de livraison", async () => {
    api.get.mockImplementation(() => Promise.resolve({ data: { ...waiting, status: "late_payment" } }));
    const { container, root } = await mountProof(waiting);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); }); // premier poll → late_payment
    expect(container.querySelector('[data-testid="proof-late"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-late"]').textContent).toContain("Paiement reçu après expiration");
    await act(async () => root.unmount());
  });

  test("statut final au poll : paid → onConfirmed (étape Confirmation) puis l'appel s'arrête", async () => {
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: { ...waiting, status: "paid" } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(waiting);
    const flush = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
    await flush();
    expect(onConfirmed).toHaveBeenCalled(); // paid → étape 4
    const calls = api.get.mock.calls.filter((c) => c[0] === "/orders/o1").length;
    await act(async () => { jest.advanceTimersByTime(90_000); });
    expect(api.get.mock.calls.filter((c) => c[0] === "/orders/o1").length).toBe(calls); // arrêt sur statut final
    await act(async () => root.unmount());
  });

  test("interrogation : 10s ×3, 20s ×2 puis 30s ; démontage stoppe", async () => {
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: waiting }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(waiting);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const calls = () => api.get.mock.calls.filter((c) => c[0] === "/orders/o1").length;
    expect(calls()).toBe(1); // premier passage immédiat
    // Chaque itération de la boucle attend d'abord la fin du timer, puis effectue
    // sa requête immédiatement : une avance + flush microtâches par salve.
    const tick = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
    await tick(10_000); await tick(10_000); await tick(10_000); // 3 × 10 s
    expect(calls()).toBe(4);
    await tick(20_000); await tick(20_000); // 2 × 20 s
    expect(calls()).toBe(6);
    await tick(30_000); // puis 30 s
    expect(calls()).toBe(7);
    await act(async () => root.unmount());
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(calls()).toBe(7); // démontage : plus rien
  });

  test("onglet caché : aucune interrogation tant que visibilityState ≠ visible", async () => {
    const orig = document.visibilityState;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: waiting }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountProof(waiting);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(45_000); });
    expect(api.get.mock.calls.filter((c) => c[0] === "/orders/o1").length).toBe(0);
    await act(async () => root.unmount());
    Object.defineProperty(document, "visibilityState", { value: orig, configurable: true });
  });
});

describe("écrans de fin", () => {
  test("cancelled → message + retour à l'accueil", async () => {
    const { container, root } = await mountProof({ ...ORDER_PENDING, status: "cancelled" });
    expect(container.querySelector('[data-testid="proof-cancelled"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-home"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
  test("expired → écran d'expiration « recommencer »", async () => {
    const { container, root } = await mountProof({ ...ORDER_PENDING, status: "expired" });
    expect(container.querySelector('[data-testid="proof-expired"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-expired"]').textContent).toContain("Recommencer");
    await act(async () => root.unmount());
  });
});
