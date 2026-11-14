import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OrderHistory, { OrderDetail, OrderStatusBadge } from "./OrderHistory";

// PL-005-FE-01 — historique client refait (maquette apercu-historique-
// commandes.html) ; PL-005-FE-02 applique la « RONDE 2 » (maquette v3,
// écrans 3 et 4) : liste affichée sur /suivi avec filtre de recherche local
// (props query/onResult), 3 colonnes souples sur bureau, badge « Annulée »
// sans rouge (tokens --badge-cancel-*), copie = ID de commande sans
// navigation, chevron de repli NU tout en bas (date + numéro DANS la zone
// repliée, toujours rendue), barre d'action fixée (Chat pilule lime + bouton
// principal), aucun poids de police au-dessus de 600 (classe
// order-history-weight), flèche de retour → /suivi.
let mockUser = null; // useAuth().user
let mockMe = []; // GET /orders/me
let mockOrderGet = null; // GET /orders/{id}
let mockNavigate = jest.fn();
let mockAdd = jest.fn(() => ({ ok: true }));
let mockGames = [
  { id: "pubg-mobile", name: "PUBG Mobile", identity_fields: [{ key: "player_id", label: "ID PUBG Mobile" }] },
];

jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children),
    useParams: () => ({ orderId: "ord-1" }),
    useNavigate: () => mockNavigate,
  };
});
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatAr: (v) => `${Number(v || 0).toLocaleString("fr-FR")} Ar`,
  errorMessage: () => "erreur",
}));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key, vars) => {
      let s = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
      if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
      return s;
    },
    lang: "fr",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: mockGames }) }));
jest.mock("@/context/CartContext", () => ({
  useCart: () => ({ add: mockAdd, setOpen: jest.fn(), items: [] }),
  addFeedback: (r) => r.ok,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const mkOrder = (over = {}) => ({
  id: "ord-1", order_number: "MGS-66458C", status: "pending_payment", game_id: "pubg-mobile",
  pubg_id: "52328390220", identity_snapshot: null,
  items: [{ product_id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", quantity: 1, line_total: 2500 }],
  total: 2500, subtotal: 2500, payment_fee: 0, payment_method: "mvola", manual_operator: null,
  payment_proofs: [], created_at: "2026-11-13T16:30:00Z", ...over,
});

beforeEach(() => {
  const { api } = require("@/lib/api");
  api.get.mockReset(); api.post.mockReset();
  mockNavigate.mockClear();
  mockAdd = jest.fn(() => ({ ok: true }));
  mockUser = { user_id: "u1" };
  mockMe = [];
  mockOrderGet = null;
  api.get.mockImplementation((url) => {
    if (url === "/orders/me") return Promise.resolve({ data: mockMe });
    if (url.startsWith("/orders/")) return Promise.resolve({ data: mockOrderGet }); // GET /orders/{id}
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  document.body.classList.remove("receipt-print");
  delete navigator.clipboard; // mock de copie uniquement par test
});

async function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}

describe("Badge de statut (liste + détail)", () => {
  test.each([
    ["delivered", "text-[color:var(--status-done)]", "border-[color:color-mix(in_srgb,var(--status-done)_35%,transparent)]"],
    ["paid", "text-[color:var(--status-progress)]", "border-[color:color-mix(in_srgb,var(--status-progress)_35%,transparent)]"],
    ["pending_payment", "text-[color:var(--muted-foreground)]", "border-[color:var(--rule-strong)]"],
    ["cancelled", "text-[color:var(--badge-cancel-text)]", "border-[color:var(--badge-cancel-border)]"],
    ["refunded", "text-[color:var(--status-refund)]", "border-[color:color-mix(in_srgb,var(--status-refund)_35%,transparent)]"],
  ])("badge %s : bordure + couleur de la famille, fond transparent", async (status, textClass, borderClass) => {
    const { container } = await mount(<OrderStatusBadge status={status} />);
    const badge = container.querySelector(`[data-testid="order-badge-${status}"]`);
    expect(badge.className).toContain("bg-transparent");
    expect(badge.className).toContain("rounded-[7px]");
    expect(badge.className).toContain(textClass);
    expect(badge.className).toContain(borderClass);
    expect(badge.textContent).toBe(require("@/i18n/translations").translations.fr.order.status[status]);
  });

  test("statut inconnu → famille « en attente » (gris), jamais un fond plein", async () => {
    const { container } = await mount(<OrderStatusBadge status="statut_inconnu" />);
    const badge = container.querySelector('[data-testid="order-badge-statut_inconnu"]');
    expect(badge.className).toContain("text-[color:var(--muted-foreground)]");
  });
});

describe("Liste /commandes", () => {
  test("cartes : jeu + produit en texte (aucune image), montant/méthode, numéro + copie, date", async () => {
    mockMe = [
      mkOrder({ id: "ord-a", order_number: "MGS-A1" }),
      mkOrder({ id: "ord-b", order_number: "MGS-B2", status: "delivered", payment_method: "manual", manual_operator: "orange" }),
    ];
    const { container } = await mount(<OrderHistory />);
    const card = container.querySelector('[data-testid="order-history-card-MGS-A1"]');
    expect(card.textContent).toContain("PUBG Mobile — 660 UC");
    expect(card.textContent).toContain("ID PUBG Mobile 52328390220");
    expect(card.querySelector("img")).toBeNull(); // aucune icône/pastille de jeu
    expect(card.textContent).toContain("MVola"); // méthode manuelle → opérateur persisté
    expect(container.querySelector('[data-testid="order-copy-MGS-A1"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="order-history-open-MGS-A1"]').getAttribute("href")).toBe("/commandes/ord-a");
    expect(card.textContent).toContain("13 nov."); // date courte
  });

  // PL-005-FE-02 (tâche 4) — badge SUR la ligne du titre (alignement haut) ;
  // (tâche 3) — variante desktop 3 colonnes souples (mobile lg:hidden).
  test("liste : badge aligné haut sur la ligne du titre + colonnes desktop 3 zones", async () => {
    mockMe = [mkOrder({ id: "ord-a", order_number: "MGS-A1", status: "delivered" })];
    const { container } = await mount(<OrderHistory />);
    const card = container.querySelector('[data-testid="order-history-card-MGS-A1"]');
    const mobile = card.querySelector("div.lg\\:hidden > div");
    expect(mobile.className).toContain("items-start");
    const wide = card.querySelector("div.hidden.lg\\:grid");
    expect(wide).not.toBeNull();
    expect(wide.className).toContain("lg:grid-cols-[minmax(0,1fr)_140px_170px]");
    expect(wide.className).toContain("lg:gap-5");
  });

  // PL-005-FE-02 (tâche 2) — filtre local du bouton de recherche : numéro,
  // ID joueur, produit, insensible à la casse ; compteur remonté à onResult.
  test("recherche : filtre local (numéro/ID/produit, casse ignorée) + onResult compté", async () => {
    mockMe = [
      mkOrder({ id: "ord-a", order_number: "MGS-A1" }),
      mkOrder({ id: "ord-b", order_number: "MGS-B2", status: "delivered" }),
    ];
    const onResult = jest.fn();
    const { container } = await mount(<OrderHistory query="mgs-a1" onResult={onResult} />);
    expect(container.textContent).toContain("MGS-A1");
    expect(container.textContent).not.toContain("MGS-B2");
    expect(onResult).toHaveBeenLastCalledWith(1, "mgs-a1");
    // Rien ne correspond → message « introuvable » (pas l'état vide).
    const empty = await mount(<OrderHistory query="introuvable" />);
    expect(empty.container.querySelector('[data-testid="orders-empty"]').textContent)
      .toBe(require("@/i18n/translations").translations.fr.order.notFound);
  });

  test("pastille « Besoin d'aide ? » présente sur en attente/en cours, absente sur livrée/annulée/remboursée", async () => {
    mockMe = [
      mkOrder({ id: "ord-a", order_number: "MGS-A1", status: "pending_payment" }),
      mkOrder({ id: "ord-b", order_number: "MGS-B2", status: "paid" }),
      mkOrder({ id: "ord-c", order_number: "MGS-C3", status: "delivered" }),
      mkOrder({ id: "ord-d", order_number: "MGS-D4", status: "cancelled" }),
      mkOrder({ id: "ord-e", order_number: "MGS-E5", status: "refunded" }),
    ];
    const { container } = await mount(<OrderHistory />);
    expect(container.querySelector('[data-testid="order-help-MGS-A1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-help-MGS-B2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-help-MGS-C3"]')).toBeNull();
    expect(container.querySelector('[data-testid="order-help-MGS-D4"]')).toBeNull();
    expect(container.querySelector('[data-testid="order-help-MGS-E5"]')).toBeNull();
  });

  test("pastille : radius 8 px, pas une pilule (pas de rounded-full), ouvre le point d'entrée IA", async () => {
    mockMe = [mkOrder({ id: "ord-a", order_number: "MGS-A1" })];
    const { container } = await mount(<OrderHistory />);
    const pill = container.querySelector('[data-testid="order-help-MGS-A1"]');
    expect(pill.className).toContain("rounded-[8px]");
    expect(pill.className).not.toContain("rounded-full");
    await act(async () => pill.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith("/chat", { state: { order_id: "ord-a" } }); // PL-005-BE-01 : point d'entrée unique
  });

  test("onglets : filtre local sans nouvel appel API — « Terminées » cache les commandes en cours", async () => {
    mockMe = [
      mkOrder({ id: "ord-a", order_number: "MGS-A1", status: "pending_payment" }),
      mkOrder({ id: "ord-b", order_number: "MGS-B2", status: "paid" }),
      mkOrder({ id: "ord-c", order_number: "MGS-C3", status: "delivered" }),
      mkOrder({ id: "ord-d", order_number: "MGS-D4", status: "cancelled" }),
    ];
    const { api } = require("@/lib/api");
    const { container, root } = await mount(<OrderHistory />);
    expect(container.textContent).toContain("MGS-A1");
    expect(container.textContent).toContain("MGS-C3");
    const before = api.get.mock.calls.length;
    await act(async () => container.querySelector('[data-testid="orders-tab-done"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(api.get.mock.calls.length).toBe(before); // aucun nouvel appel
    expect(container.textContent).not.toContain("MGS-A1"); // en cours cachées
    expect(container.textContent).not.toContain("MGS-B2");
    expect(container.textContent).toContain("MGS-C3");
    expect(container.textContent).toContain("MGS-D4");
    await act(async () => container.querySelector('[data-testid="orders-tab-progress"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("MGS-A1");
    expect(container.textContent).toContain("MGS-B2");
    expect(container.textContent).not.toContain("MGS-C3");
    await act(async () => root.unmount());
  });

  test("aucune commande → état vide traduit", async () => {
    mockMe = [];
    const { container } = await mount(<OrderHistory />);
    expect(container.querySelector('[data-testid="orders-empty"]').textContent)
      .toBe(require("@/i18n/translations").translations.fr.order.historyEmpty);
  });
});

describe("Détail /commandes/:id", () => {
  test("en-tête : montant en grand + statut ; coche ronde verte UNIQUEMENT si livrée", async () => {
    mockOrderGet = mkOrder({ status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    const delivered = await mount(<OrderDetail />);
    expect(delivered.container.querySelector('[data-testid="order-detail-amount"]').textContent).toMatch(/2\s500/); // espace insécable fr-FR
    expect(delivered.container.querySelector('[data-testid="order-hero-check"]')).not.toBeNull();
    await act(async () => delivered.root.unmount());
    mockOrderGet = mkOrder({ status: "paid" });
    const paid = await mount(<OrderDetail />);
    expect(paid.container.querySelector('[data-testid="order-hero-check"]')).toBeNull();
    expect(paid.container.querySelector('[data-testid="order-hero-status"]').className).toContain("text-[color:var(--status-progress)]");
  });

  // PL-005-FE-02 (tâche 11) — le bouton Chat n'est plus dans la carte :
  // il vit dans la barre du bas (pilule lime, rayon 999 px, 92 px de large).
  test("carte : jeu en texte seul, lignes produit / ID / méthode ; Chat dans la barre du bas", async () => {
    mockOrderGet = mkOrder({ status: "pending_payment", payment_method: "binance" });
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-detail-card"]').textContent).toContain("PUBG Mobile");
    const bar = container.querySelector('[data-testid="order-detail-bar"]');
    expect(bar).not.toBeNull();
    expect(bar.textContent).toContain("Reprendre le paiement");
    const chat = bar.querySelector('[data-testid="order-chat-button"]');
    expect(chat.className).toContain("rounded-[999px]");
    expect(chat.className).toContain("bg-[color:var(--brand-lime)]");
    expect(chat.textContent).toContain("Chat");
    expect(container.querySelector('[data-testid="order-detail-product"]').textContent).toContain("1 × 660 UC");
    expect(container.querySelector('[data-testid="order-detail-identity"]').textContent).toContain("52328390220");
    expect(container.querySelector('[data-testid="order-detail-method"]').textContent).toContain("Binance USDT");
  });

  // PL-005-FE-02 (tâche 8) — flèche de retour = même composant que le
  // paiement ; retour EXPLICITE vers /suivi, jamais navigate(-1).
  test("flèche de retour → /suivi (jamais navigate(-1))", async () => {
    mockOrderGet = mkOrder({ status: "paid" });
    const { container } = await mount(<OrderDetail />);
    await act(async () => container.querySelector('[data-testid="order-detail-back"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith("/suivi");
    expect(mockNavigate).not.toHaveBeenCalledWith(-1);
  });

  test("bouton Chat et ligne d'aide ouvrent le point d'entrée IA avec la commande en contexte", async () => {
    mockOrderGet = mkOrder({ status: "paid" });
    const { container } = await mount(<OrderDetail />);
    await act(async () => container.querySelector('[data-testid="order-chat-button"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith("/chat", { state: { order_id: "ord-1" } });
    await act(async () => container.querySelector('[data-testid="order-help-row"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  // PL-005-FE-02 (tâches 9 et 10) — chevron NU (icône seule, aucune bordure
  // ni fond) tout en bas ; la zone repliée est TOUJOURS rendue (hidden →
  // block) et contient désormais le numéro + la date (tâche 9) qui
  // n'apparaissent NULLE PART ailleurs.
  test("repli : chevron nu en bas, zone TOUJOURS rendue, numéro + date dedans", async () => {
    mockOrderGet = mkOrder({
      status: "cancelled", cancel_reason: "cannot_pay_now",
      cancelled_at: "2026-11-13T17:00:00Z", cancel_note: "Je paierai plus tard",
      payment_proofs: [{ size: 100, content_type: "image/jpeg", uploaded_at: "2026-11-13T16:40:00Z" }],
    });
    const { container, root } = await mount(<OrderDetail />);
    const toggle = container.querySelector('[data-testid="order-details-toggle"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("order-detail-extra");
    expect(toggle.className).toContain("h-11 w-11");
    // Chevron NU : aucun span bordé à l'intérieur, uniquement l'icône svg.
    expect(toggle.querySelector("span")).toBeNull();
    expect(toggle.querySelector("svg")).not.toBeNull();
    const extra = container.querySelector('[data-testid="order-detail-extra"]');
    expect(extra.className).toContain("hidden");
    // Le numéro et la date vivent DANS la zone repliée, pas ailleurs.
    expect(extra.textContent).toContain("MGS-66458C");
    expect(container.querySelector('[data-testid="order-detail-number"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-detail-date"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-detail-copy"]')).not.toBeNull();
    await act(async () => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(extra.className).toContain("block");
    expect(extra.textContent).toContain("1 preuve(s) envoyée(s)");
    expect(container.querySelector('[data-testid="order-detail-cancel"]').textContent).toContain("Je ne peux pas payer maintenant");
    expect(container.querySelector('[data-testid="order-detail-cancel-note"]').textContent).toContain("Je paierai plus tard");
    await act(async () => root.unmount());
  });

  // PL-005-FE-02 (tâche 10) — le chevron existe MAINTENANT toujours (la zone
  // repliée porte au minimum numéro + date, tâche 9).
  test("zone repliée toujours présente (numéro + date) → chevron toujours rendu", async () => {
    mockOrderGet = mkOrder({ status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-details-toggle"]')).not.toBeNull();
  });

  test("reçu : ligne visible seulement si payé au moins une fois (paid_at)", async () => {
    mockOrderGet = mkOrder({ status: "pending_payment" });
    const first = await mount(<OrderDetail />);
    expect(first.container.querySelector('[data-testid="order-receipt-action"]')).toBeNull();
    mockOrderGet = mkOrder({ status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    const second = await mount(<OrderDetail />);
    expect(second.container.querySelector('[data-testid="order-receipt-action"]')).not.toBeNull();
  });

  test("reçu : le clic déclenche window.print() avec la classe d'impression, nettoyée par afterprint", async () => {
    const printSpy = jest.fn();
    window.print = printSpy;
    mockOrderGet = mkOrder({ status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-receipt-view"]')).not.toBeNull(); // vue construite à partir des données affichées
    await act(async () => container.querySelector('[data-testid="order-receipt-action"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(printSpy).toHaveBeenCalled();
    expect(document.body.classList.contains("receipt-print")).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("receipt-print")).toBe(false);
  });

  test("commande en attente → « Reprendre le paiement » vers /orders/:id (jamais « Commander à nouveau »)", async () => {
    mockOrderGet = mkOrder({ status: "pending_payment" });
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-again-button"]')).toBeNull();
    const resume = container.querySelector('[data-testid="order-resume-pending-button"]');
    expect(resume.textContent).toBe("Reprendre le paiement");
    await act(async () => resume.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith("/orders/ord-1");
  });

  test("commande livrée + commande pending_payment du même produit ailleurs → « Reprendre le paiement » vers CETTE commande", async () => {
    mockOrderGet = mkOrder({ id: "ord-1", status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    mockMe = [mkOrder({ id: "ord-9", order_number: "MGS-OTHER", status: "pending_payment", items: [{ product_id: "p1", slug: "660-uc", name: "660 UC", quantity: 1, line_total: 2500 }] })];
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-again-button"]')).toBeNull();
    const resume = container.querySelector('[data-testid="order-resume-pending-button"]');
    expect(resume.textContent).toBe("Reprendre le paiement");
    await act(async () => resume.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith("/orders/ord-9");
  });

  test("commande livrée sans autre commande en attente → « Commander à nouveau » pré-remplit le panier (jamais de commande créée)", async () => {
    mockOrderGet = mkOrder({ id: "ord-1", status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => {
      if (url === "/orders/me") return Promise.resolve({ data: mockMe });
      if (url.startsWith("/orders/")) return Promise.resolve({ data: mockOrderGet });
      if (url.startsWith("/products/")) return Promise.resolve({ data: { id: "p1", slug: "660-uc", name: "660 UC", name_en: "660 UC", type: "uc", price: 2500, game_id: "pubg-mobile", purchasable: true } });
      return Promise.resolve({ data: [] });
    });
    const { container } = await mount(<OrderDetail />);
    const again = container.querySelector('[data-testid="order-again-button"]');
    expect(again.textContent).toBe("Commander à nouveau");
    await act(async () => again.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), 1); // produit relu (prix frais), ajouté au panier
    expect(mockNavigate).toHaveBeenCalledWith("/commande?pubg_id=52328390220"); // ID joueur pré-rempli, flux normal
  });

  test("produit retiré du catalogue → aucune commande forcée : fiche produit (flux normal)", async () => {
    mockOrderGet = mkOrder({ id: "ord-1", status: "delivered", paid_at: "2026-11-13T17:00:00Z" });
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => {
      if (url === "/orders/me") return Promise.resolve({ data: mockMe });
      if (url.startsWith("/orders/")) return Promise.resolve({ data: mockOrderGet });
      return Promise.reject(new Error("404"));
    });
    const { container } = await mount(<OrderDetail />);
    await act(async () => container.querySelector('[data-testid="order-again-button"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/produit/660-uc");
  });

  test("403/404 → message générique (jamais de détail)", async () => {
    const { api } = require("@/lib/api");
    api.get.mockImplementation((url) => (url === "/orders/me" ? Promise.resolve({ data: [] }) : Promise.reject(new Error("403"))));
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-detail-unavailable"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="order-detail-card"]')).toBeNull();
  });

  // PL-005-FE-02 (tâche 6) — en-tête du détail : « Annulée » = ✕ + blanc 62 %
  // (token), AUCUNE bordure, jamais le rouge ; seuls failed garde le rouge.
  test("en-tête : « Annulée » = ✕ sans bordure, jamais rouge ; failed garde le rouge", async () => {
    mockOrderGet = mkOrder({ status: "cancelled" });
    const c = await mount(<OrderDetail />);
    const hero = c.container.querySelector('[data-testid="order-hero-status"]');
    expect(hero.className).toContain("text-[color:var(--badge-cancel-text)]");
    expect(hero.className).not.toContain("border-");
    expect(hero.className).not.toContain("text-[color:var(--destructive)]");
    expect(hero.textContent).toContain("Annulée");
    await act(async () => c.root.unmount());
    mockOrderGet = mkOrder({ status: "failed" });
    const f = await mount(<OrderDetail />);
    expect(f.container.querySelector('[data-testid="order-hero-status"]').className)
      .toContain("text-[color:var(--destructive)]");
  });

  // PL-005-FE-02 (tâche 5) — copier le numéro du détail porte l'ID de
  // commande (order.id) et NE NAVIGUE PAS (pas de lien étiré ici, mais la
  // garde stopPropagation est posée).
  test("copie du détail = order.id, sans navigation", async () => {
    navigator.clipboard = { writeText: jest.fn().mockResolvedValue() };
    mockOrderGet = mkOrder({ id: "ord-1", status: "paid" });
    const { container } = await mount(<OrderDetail />);
    await act(async () => toggleCopy(container));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ord-1");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // PL-005-FE-02 (tâche 7) — aucun poids au-dessus de 600 : la classe
  // conteneur neutralise .num (700 non-layered), aucune classe font-bold /
  // extrabold / black n'est posée sur la page.
  test("poids ≤ 600 : conteneur order-history-weight, aucune classe > 600", async () => {
    mockOrderGet = mkOrder({ status: "paid" });
    const { container } = await mount(<OrderDetail />);
    expect(container.querySelector('[data-testid="order-detail-page"]').className).toContain("order-history-weight");
    const weightHeavy = [...container.querySelectorAll('[data-testid="order-detail-page"] [class*="font-"]')]
      .map((el) => el.className.match(/font-(bold|extrabold|black)/)?.[0]).filter(Boolean);
    expect(weightHeavy).toEqual([]);
    const liste = await mount(<OrderHistory />);
    expect(liste.container.querySelector('[data-testid="order-history-page"]').className).toContain("order-history-weight");
    await act(async () => liste.root.unmount());
  });
});

// Clic sur le bouton de copie du détail (order-detail-copy) : helper partagé.
async function toggleCopy(container) {
  const btn = container.querySelector('[data-testid="order-detail-copy"]');
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
