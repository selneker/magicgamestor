import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatWorkspace } from "./ChatWorkspace";

// Espace admin Messages (MGS-FE-ADMIN-20261105-02) : badge « non lus » lisible
// (compteur seul, encre sur lime), ouverture de conversation via l'URL (?c=),
// liste masquée et conversation plein écran sur mobile.
// (react-router-dom est moqué comme dans les autres tests : le vrai paquet v7
// ne se résout pas sous jest)
let mockSearch = "";

jest.mock("react-router-dom", () => {
  const React = require("react");
  const Anchor = ({ to, children, ...props }) => React.createElement("a", { ...props, href: to }, children);
  return {
    Link: Anchor,
    NavLink: Anchor,
    useLocation: () => ({ pathname: "/admin/messages", search: mockSearch }),
    useSearchParams: () => [
      new URLSearchParams(mockSearch),
      (init) => { mockSearch = typeof init === "string" ? init : new URLSearchParams(init).toString(); },
    ],
  };
});
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, errorMessage: (e) => e?.message || "erreur" }));
// refreshUnread doit être stable entre les rendus (comme dans le vrai
// ChatContext) : une nouvelle identité à chaque rendu ferait reboucler les
// effets de ChatThread (onChanged → load → rendu → nouvel onChanged…).
const mockRefreshUnread = jest.fn();
jest.mock("@/context/ChatContext", () => ({ useChat: () => ({ count: 0, refreshUnread: mockRefreshUnread }) }));
jest.mock("@/context/LanguageContext", () => ({
  useLang: () => ({
    t: (key, vars) => {
      const value = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), require("@/i18n/translations").translations.fr) ?? key;
      return vars && typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`)) : value;
    },
    lang: "fr",
  }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const conversations = [
  { id: "c1", user_name: "Pipa Nilsen", user_email: "pipa@example.com", last_message: "Bonjour", updated_at: "2026-11-05T10:00:00Z", unread_count: 2 },
  { id: "c2", user_name: "Alex Rakoto", user_email: "alex@example.com", last_message: "Merci", updated_at: "2026-11-04T09:00:00Z", unread_count: 0 },
];
const messages = [
  { id: "m1", sender_role: "customer", text: "Bonjour", created_at: "2026-11-05T09:59:00Z", read: false },
  { id: "m2", sender_role: "admin", text: "Bonjour ! Comment pouvons-nous aider ?", created_at: "2026-11-05T10:00:00Z", read: true },
];

beforeEach(() => {
  mockSearch = "";
  const { api } = require("@/lib/api");
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/chat/conversations") return Promise.resolve({ data: { items: conversations, has_more: false } });
    if (url.endsWith("/messages")) return Promise.resolve({ data: { conversation: { id: "c1", user_name: "Pipa Nilsen" }, messages, has_more: false } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => { document.body.innerHTML = ""; });

async function mountWorkspace() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ChatWorkspace admin />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, root };
}
const rerender = async (root) => { await act(async () => { root.render(<ChatWorkspace admin />); }); };

test("badge non lus : compteur seul (min 22px, nowrap), encre #0A0A0A sur lime, aria-label avec le compteur", async () => {
  const { container, root } = await mountWorkspace();
  const badge = container.querySelector('[data-testid="chat-unread-c1"]');
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe("2");
  expect(badge.className).toContain("bg-primary");
  expect(badge.className).toContain("text-[#0A0A0A]");
  expect(badge.className).toContain("h-[22px]");
  expect(badge.className).toContain("min-w-[22px]");
  expect(badge.className).toContain("whitespace-nowrap");
  expect(badge.getAttribute("aria-label")).toBe("2 non lus");
  // Conversation lue : mention « Lu », pas de badge.
  const read = container.querySelector('[data-testid="chat-unread-c2"]');
  expect(read.textContent).toBe("Lu");
  expect(read.className).not.toContain("bg-primary");
  // Non lu : nom en gras + pastille lime ; lu : atténué.
  expect(container.querySelector('[data-testid="chat-unread-dot-c1"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="chat-unread-dot-c2"]')).toBeNull();
  await act(async () => root.unmount());
});

test("ouverture conversation (mobile) : URL ?c=, liste masquée, thread plein écran avec composer et retour", async () => {
  const { container, root } = await mountWorkspace();
  await act(async () => {
    container.querySelector('[data-testid="chat-conversation-c1"]').click();
  });
  expect(mockSearch).toBe("c=c1");
  await rerender(root);
  // La liste est masquée, la conversation occupe l'écran (fixed inset-0).
  const aside = container.querySelector('[data-testid="chat-conversations"]');
  expect(aside.className).toContain("hidden");
  const panel = container.querySelector('[data-testid="chat-thread-panel"]');
  expect(panel).not.toBeNull();
  expect(panel.className).toContain("fixed");
  expect(panel.className).toContain("inset-0");
  expect(panel.className).toContain("z-50");
  // Composer présent sans quitter le plein écran : saisie, envoi 44px, retour, Marquer lu.
  expect(container.querySelector('[data-testid="chat-message-input"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="chat-send"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="chat-send"]').className).toContain("h-11");
  expect(container.querySelector('[data-testid="chat-thread-back"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="chat-mark-read"]')).not.toBeNull();
  await act(async () => root.unmount());
});

test("retour à la liste : search sans c= → liste visible, thread absent", async () => {
  mockSearch = "c=c1";
  const { container, root } = await mountWorkspace();
  expect(container.querySelector('[data-testid="chat-thread-panel"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="chat-conversations"]').className).toContain("hidden");
  // Le bouton retour du navigateur = search repasse sans c=.
  mockSearch = "";
  await rerender(root);
  expect(container.querySelector('[data-testid="chat-thread-panel"]')).toBeNull();
  expect(container.querySelector('[data-testid="chat-conversations"]').className).not.toContain("hidden");
  await act(async () => root.unmount());
});

test("badge : le nom de la conversation non lue reste lisible (pas de texte fixe sur surface thème)", async () => {
  const { container, root } = await mountWorkspace();
  const name = container.querySelector('[data-testid="chat-conversation-c1"] .font-bold');
  expect(name.className).toContain("text-foreground");
  expect(name.className).toContain("font-bold");
  await act(async () => root.unmount());
});
