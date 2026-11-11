import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ProofSheet, ProofWaiting, LateScreen, EndScreen, ProofExpired } from "./ProofPay";

// PL-CHK-4 — feuille « Confirmation du paiement » (écran 3 : vignettes + n/3,
// récap unique, case obligatoire, Confirmer grisé), écran d'attente (écran 4 :
// carte « Détails de la commande » avec ID et pseudo SÉPARÉS, Relancer fixé
// avec cooldown), écran 8 (expirée). La LOGIQUE d'upload est conservée :
// multipart sans Content-Type manuel, revokeObjectURL, erreurs proof_* / 429 /
// 503 / captcha, proof_deadline_passed → refetch.

const ORDER_PENDING = {
  id: "o1", order_number: "MGS-T1", pubg_id: "123456789", pseudo: "Joueur", status: "pending_payment",
  payment_method: "manual", manual_operator: "mvola", subtotal: 2500, payment_fee: 0, total: 2500,
  items: [{ product_id: "p1", name: "660 UC", quantity: 1, line_total: 2500 }],
  payment_deadline_at: null, payment_proofs: [],
};
const ORDER_WAITING = { ...ORDER_PENDING, status: "proof_submitted", payment_proofs: [{}, {}] };
const SUMMARY = { lines: [{ key: "p1", label: "1 × 660 UC" }], pubgId: "123456789", subtotal: 2500, fee: 0 };

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
    useNavigate: () => mockNavigate,
  };
});
const mockNavigate = jest.fn();
jest.mock("sonner", () => ({ toast: { message: jest.fn(), error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  errorMessage: (e, f) => `Erreur: ${e?.response?.data?.code || "inconnue"}`,
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
}));
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
jest.mock("@/lib/paymentLabels", () => ({
  paymentLabel: (m) => (m === "manual" ? "Manuel" : m),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'URL d'objet : on compte simplement les libérations.
const mkBlobUrl = jest.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revoke = jest.fn();
URL.createObjectURL = mkBlobUrl;
URL.revokeObjectURL = revoke;

async function mountSheet(order = ORDER_PENDING, over = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ProofSheet open onOpenChange={jest.fn()} order={order} summary={SUMMARY} onUpdated={over.onUpdated || jest.fn()} onSubmitted={over.onSubmitted || jest.fn()} />);
  });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}

async function mountUi(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}

const png = () => new File(["x"], `c-${Math.random().toString(36).slice(2)}.png`, { type: "image/png" });

async function addFiles(container, files) {
  const input = document.querySelector('[data-testid="proof-input"]'); // contenu Radix portalisé
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
  localStorage.clear();
  mockNavigate.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
  jest.useRealTimers();
  mkBlobUrl.mockClear(); revoke.mockClear();
});

describe("feuille de preuve (écran 3)", () => {
  test("titre, aide, récap unique et case obligatoire ; Confirmer désactivé sans image", async () => {
    const { container, root } = await mountSheet();
    expect(document.querySelector('[data-testid="proof-sheet-title"]').textContent).toBe("Confirmation du paiement");
    expect(document.querySelector('[data-testid="proof-recap"]').textContent).toContain("1 × 660 UC");
    expect(document.querySelector('[data-testid="proof-recap"]').textContent).toMatch(/2[\s\u00a0\u202f]500/);
    expect(document.querySelector('[data-testid="proof-exact-checkbox"]').getAttribute("aria-checked")).toBe("false");
    // PL-CHK-5 — nouveau texte de la case (maquette) + pied FIXE : le bouton
    // « Confirmer » vit dans le pied, HORS de la zone défilable.
    expect(document.querySelector('[data-testid="proof-exact-row"]').textContent)
      .toContain("J'ai déjà effectué le paiement.");
    expect(document.querySelector('[data-testid="proof-sheet-footer"]').contains(document.querySelector('[data-testid="proof-submit"]'))).toBe(true);
    expect(document.querySelector('[data-testid="proof-sheet-scroll"]').contains(document.querySelector('[data-testid="proof-submit"]'))).toBe(false);
    expect(document.querySelector('[data-testid="proof-submit"]').disabled).toBe(true);
    await act(async () => root.unmount());
  });

  test("images ajoutées mais sans case : Confirmer toujours désactivé ; case cochée → actif", async () => {
    const { container, root } = await mountSheet();
    await addFiles(container, [png()]);
    expect(document.querySelector('[data-testid="proof-submit"]').disabled).toBe(true);
    await act(async () => { document.querySelector('[data-testid="proof-exact-checkbox"]').click(); });
    expect(document.querySelector('[data-testid="proof-submit"]').disabled).toBe(false);
    await act(async () => root.unmount());
  });

  test("ajout / retrait de vignettes et libération des URL", async () => {
    const { container, root } = await mountSheet();
    await addFiles(container, [png(), png()]);
    expect(document.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(2);
    expect(mkBlobUrl).toHaveBeenCalledTimes(2);
    await act(async () => { document.querySelector('[data-testid="proof-remove-0"]').click(); });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(1);
    await act(async () => root.unmount());
    // Démentage : les URL restantes sont libérées.
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  test("plafond de 3 INCLUT les preuves déjà envoyées", async () => {
    const { container, root } = await mountSheet({ ...ORDER_PENDING, payment_proofs: [{}, {}] });
    expect(document.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(0);
    await addFiles(container, [png()]);
    expect(document.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(1);
    // plus une seule tuile « + » (3 déjà comptées) : une 2e sélection est refusée
    expect(document.querySelector('[data-testid="proof-add-button"]')).toBeNull();
    await addFiles(container, [png()]);
    expect(document.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(1);
    expect(document.querySelector('[data-testid="proof-error"]').textContent).toBe("3 captures maximum par commande.");
    await act(async () => root.unmount());
  });

  test("type refusé et taille refusée : messages lisibles", async () => {
    const { container, root } = await mountSheet();
    const big = new File(["x".repeat(9)], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    await addFiles(container, [new File(["x"], "c.txt", { type: "text/plain" }), big]);
    expect(document.querySelectorAll("[data-testid^='proof-thumb-']").length).toBe(0);
    expect(document.querySelector('[data-testid="proof-error"]').textContent.length).toBeGreaterThan(5);
    await act(async () => root.unmount());
  });

  test("succès : POST FormData (champ files répété, pas de Content-Type), état réel + écran d'attente", async () => {
    const onUpdated = jest.fn();
    const onSubmitted = jest.fn();
    const fresh = { ...ORDER_PENDING, status: "proof_submitted" };
    api.post.mockResolvedValue({ data: { ok: true } });
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: fresh }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountSheet(ORDER_PENDING, { onUpdated, onSubmitted });
    await addFiles(container, [png(), png()]);
    await act(async () => { document.querySelector('[data-testid="proof-exact-checkbox"]').click(); });
    await act(async () => { document.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const call = api.post.mock.calls.find((c) => c[0] === "/orders/o1/proof");
    expect(call).not.toBeNull();
    const fd = call[1];
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.getAll("files")).toHaveLength(2);
    expect(fd.get("content-type")).toBeNull(); // le navigateur pose la limite multipart
    expect(onUpdated).toHaveBeenCalledWith(fresh);
    expect(onSubmitted).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test.each([
    [409, "proof_not_allowed", "Cette commande n'attend plus de preuve."],
    [429, "", "Trop d'envois : réessayez dans quelques minutes."],
    [503, "", "Envoi de preuve indisponible, réessayez plus tard."],
  ])("erreurs serveur %i → message FR clair, la feuille reste ouverte", async (status, code, expected) => {
    api.post.mockRejectedValue({ response: { status, data: { code, detail: code ? { code } : "technique" } } });
    const { container, root } = await mountSheet();
    await addFiles(container, [png()]);
    await act(async () => { document.querySelector('[data-testid="proof-exact-checkbox"]').click(); });
    await act(async () => { document.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="proof-error"]').textContent).toBe(expected);
    await act(async () => root.unmount());
  });

  test("captcha_required → le mécanisme existant prend la main", async () => {
    api.post.mockRejectedValue({ response: { status: 400, data: { code: "captcha_required" } } });
    const { container, root } = await mountSheet();
    await addFiles(container, [png()]);
    await act(async () => { document.querySelector('[data-testid="proof-exact-checkbox"]').click(); });
    await act(async () => { document.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="proof-error"]').textContent)
      .toBe("Merci de refaire le contrôle de sécurité ci-dessus puis de réessayer.");
    await act(async () => root.unmount());
  });

  test("proof_deadline_passed : la commande est rechargée (état réel → écran expiré par le parent)", async () => {
    const onUpdated = jest.fn();
    const onSubmitted = jest.fn();
    api.post.mockRejectedValue({ response: { status: 400, data: { detail: { code: "proof_deadline_passed" } } } });
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: { ...ORDER_PENDING, status: "expired" } }) : Promise.resolve({ data: {} })));
    const { container, root } = await mountSheet(ORDER_PENDING, { onUpdated, onSubmitted });
    await addFiles(container, [png()]);
    await act(async () => { document.querySelector('[data-testid="proof-exact-checkbox"]').click(); });
    await act(async () => { document.querySelector('[data-testid="proof-submit"]').click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
    expect(onSubmitted).toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

describe("écran d'attente (écran 4)", () => {
  const Waiting = (over = {}) => {
    const Harness = () => <ProofWaiting order={{ ...ORDER_WAITING, ...over }} onUpdated={jest.fn()} />;
    return mountUi(<Harness />);
  };

  test("titre, carte Détails ouverte par défaut, ID joueur et pseudo sur deux lignes séparées", async () => {
    const { container, root } = await Waiting();
    expect(container.querySelector('[data-testid="proof-wait-title"]').textContent)
      .toBe("Confirmation du paiement en attente");
    expect(container.querySelector('[data-testid="details-player-id"]').textContent).toBe("123456789");
    expect(container.querySelector('[data-testid="details-pseudo"]').textContent).toBe("Joueur");
    expect(container.querySelector('[data-testid="details-paid-with"]').textContent).toBe("MVola");
    expect(container.querySelector('[data-testid="details-amount"]').textContent).toMatch(/2[\s\u00a0\u202f]500/);
    expect(container.querySelector('[data-testid="details-number"]').textContent).toBe("#MGS-T1");
    // ouvert par défaut : les lignes sont visibles
    expect(container.querySelector('[data-testid="order-details-rows"]')).not.toBeNull();
    // PAS de lien « Annuler » ici (le backend refuse après preuve)
    expect(container.querySelector('[data-testid="cancel-open"]')).toBeNull();
    await act(async () => root.unmount());
  });

  test("Relancer : succès → cooldown mm:ss sur le bouton, relances restantes affichées", async () => {
    api.post.mockResolvedValue({ data: { remaining_seconds: 180, reminders_left: 2 } });
    const { container, root } = await Waiting();
    await act(async () => { container.querySelector('[data-testid="remind-button"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledWith("/orders/o1/remind", {});
    expect(container.querySelector('[data-testid="remind-left"]').textContent).toContain("2");
    expect(container.querySelector('[data-testid="remind-button"]').textContent).toContain("03:00");
    expect(container.querySelector('[data-testid="remind-button"]').disabled).toBe(true);
    await act(async () => root.unmount());
  });

  test("remind_limit → bouton désactivé avec message clair", async () => {
    api.post.mockRejectedValue({ response: { status: 429, data: { detail: { code: "remind_limit" } } } });
    const { container, root } = await Waiting();
    await act(async () => { container.querySelector('[data-testid="remind-button"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="remind-limit"]').textContent.length).toBeGreaterThan(5);
    expect(container.querySelector('[data-testid="remind-button"]').disabled).toBe(true);
    await act(async () => root.unmount());
  });

  test("interrogation : premier passage immédiat puis 10s ×3, 20s ×2 puis 30s ; démontage stoppe", async () => {
    api.get.mockImplementation((url) => (url === "/orders/o1" ? Promise.resolve({ data: ORDER_WAITING }) : Promise.resolve({ data: {} })));
    const onUpdated = jest.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ProofWaiting order={ORDER_WAITING} onUpdated={onUpdated} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const calls = () => api.get.mock.calls.filter((c) => c[0] === "/orders/o1").length;
    expect(calls()).toBe(1);
    const tick = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
    await tick(10_000); await tick(10_000); await tick(10_000);
    expect(calls()).toBe(4);
    await tick(20_000); await tick(20_000);
    expect(calls()).toBe(6);
    await tick(30_000);
    expect(calls()).toBe(7);
    await act(async () => root.unmount());
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(calls()).toBe(7);
  });

  test("statut final au poll : paid → onUpdated et l'appel s'arrête", async () => {
    let paid = false;
    api.get.mockImplementation((url) => Promise.resolve({ data: paid ? { ...ORDER_WAITING, status: "paid" } : ORDER_WAITING }));
    const onUpdated = jest.fn(() => { paid = true; });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ProofWaiting order={ORDER_WAITING} onUpdated={onUpdated} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(10_000); await Promise.resolve(); await Promise.resolve(); });
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }));
    const callsAfterPaid = api.get.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(60_000); await Promise.resolve(); await Promise.resolve(); });
    expect(api.get.mock.calls.length).toBe(callsAfterPaid);
    await act(async () => root.unmount());
  });
});

describe("écrans de fin", () => {
  test("late_payment → écran dédié", async () => {
    const { container, root } = await mountUi(<LateScreen />);
    expect(container.querySelector('[data-testid="proof-late"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("cancelled → message + retour à l'accueil", async () => {
    const { container, root } = await mountUi(<EndScreen order={{ ...ORDER_PENDING, status: "cancelled" }} />);
    expect(container.querySelector('[data-testid="proof-cancelled"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-home"]').getAttribute("href")).toBe("/");
    await act(async () => root.unmount());
  });

  test("expired → écran 8 : n° de commande + « Recommencer » purge la clé et ramène à l'écran 1 du jeu (PL-CHK-6)", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o1", createdAt: new Date().toISOString() }));
    const { container, root } = await mountUi(<ProofExpired order={{ ...ORDER_PENDING, status: "expired", game_id: "pubg-mobile" }} />);
    expect(container.querySelector('[data-testid="proof-expired"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-expired-title"]').textContent).toBe("La commande a expiré");
    expect(container.querySelector('[data-testid="proof-expired"]').textContent).toContain("MGS-T1");
    const restart = container.querySelector('[data-testid="proof-restart"]');
    expect(restart).not.toBeNull();
    expect(restart.getAttribute("href")).toBeNull(); // handler, plus un lien muet
    await act(async () => { restart.click(); });
    expect(mockNavigate).toHaveBeenCalledWith("/boutique?game=pubg-mobile", { replace: true });
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });

  test("cancelled/failed (PL-CHK-6) : « Recommencer » + retour accueil discret", async () => {
    localStorage.setItem("mgs_pending_order_id", JSON.stringify({ id: "o1", createdAt: new Date().toISOString() }));
    const { container, root } = await mountUi(<EndScreen order={{ ...ORDER_PENDING, status: "cancelled", game_id: "pubg-mobile" }} />);
    expect(container.querySelector('[data-testid="proof-cancelled"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proof-home"]').getAttribute("href")).toBe("/");
    const restart = container.querySelector('[data-testid="proof-restart"]');
    await act(async () => { restart.click(); });
    expect(mockNavigate).toHaveBeenCalledWith("/boutique?game=pubg-mobile", { replace: true });
    expect(localStorage.getItem("mgs_pending_order_id")).toBeNull();
    await act(async () => root.unmount());
  });
});
