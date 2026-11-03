import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import { setMockLang } from "@/context/LanguageContext";
import { translations } from "@/i18n/translations";
import Loyalty from "./Loyalty";

// Les messages sont resolus contre le VRAI dictionnaire (FR et EN).
jest.mock("@/context/LanguageContext", () => {
  const { translations } = require("@/i18n/translations");
  const state = { lang: "fr" };
  const t = (path, vars) => {
    const value =
      path.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), translations[state.lang]) ?? path;
    return vars && typeof value === "string"
      ? value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`))
      : value;
  };
  return { useLang: () => ({ t, lang: state.lang }), setMockLang: (l) => { state.lang = l; } };
});

var mockGames = [
  { id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true,
    identity_fields: [{ key: "player_id", label: "ID PUBG Mobile", label_en: "PUBG Mobile ID", min_length: 8, max_length: 60, required: true, primary: true }] },
];
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: mockGames }) }));

var mockUser = null;
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

// Button (Radix) réduit à un <button> natif : ce que le test vérifie est le
// comportement (disabled après vérification), pas la primitive.
jest.mock("@/components/ui/button", () => {
  const React = require("react");
  return { Button: ({ children, disabled, ...props }) => React.createElement("button", { disabled, ...props }, children) };
});

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const REWARDS = [{ id: "r1", name: "Bon 100 pts", cost_points: 100 }];

function page() {
  return (
    <Loyalty />
  );
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(page()); });
  await act(async () => {}); // flush des GET /loyalty/*
  return { container, root };
}

const unmount = async (container, root) => {
  await act(async () => root.unmount());
  container.remove();
};
const elOf = (c, testid) => c.querySelector(`[data-testid="${testid}"]`);
const inputOf = (c) => c.querySelector('[data-testid="identity-field-player_id"]');
const redeemOf = (c) => elOf(c, "redeem-r1");

const setValue = async (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/loyalty/me") return Promise.resolve({ data: { balance: { total: 100, earned: 100, promo: 0 }, ledger: [], config: {} } });
    if (url === "/loyalty/rewards") return Promise.resolve({ data: REWARDS });
    return Promise.resolve({ data: [] });
  });
  api.post.mockReset();
  mockGames = [
    { id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true,
      identity_fields: [{ key: "player_id", label: "ID PUBG Mobile", label_en: "PUBG Mobile ID", min_length: 8, max_length: 60, required: true, primary: true }] },
  ];
  mockUser = null;
  setMockLang("fr");
});

afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

// --- Jeu trouvé : le formulaire générique remplace l'ancien input PUBG --------

test("Jeu trouvé : formulaire générique des champs du jeu, échange bloqué avant vérification", async () => {
  const { container, root } = await mount();
  try {
    expect(inputOf(container)).not.toBeNull();
    expect(inputOf(container).type).toBe("text");
    // Sans input numérique spécial ni garde : le champ autorise les lettres.
    await setValue(inputOf(container), "ABCD12EF90");
    expect(inputOf(container).value).toBe("ABCD12EF90");
    // Aucune vérification spontanée : l'échange reste bloqué tant que le clic
    // « Vérifier » n'a pas retourné valid:true.
    expect(api.post).not.toHaveBeenCalled();
    expect(redeemOf(container).disabled).toBe(true);
  } finally { await unmount(container, root); }
});

test("ID mémorisé : prérempli, mais JAMAIS compté comme vérifié (§4.8)", async () => {
  mockUser = { user_id: "u1", saved_pubg_ids: ["ABCD12EF90"] };
  const { container, root } = await mount();
  try {
    expect(inputOf(container).value).toBe("ABCD12EF90");
    expect(api.post).not.toHaveBeenCalled();
    expect(elOf(container, "identity-verify-valid")).toBeNull();
    expect(redeemOf(container).disabled).toBe(true);
  } finally { await unmount(container, root); }
});

test("Effacer le champ ne ramène pas le préremplissage (effacement volontaire)", async () => {
  mockUser = { user_id: "u1", saved_pubg_ids: ["ABCD12EF90"] };
  const { container, root } = await mount();
  try {
    await setValue(inputOf(container), "");
    expect(inputOf(container).value).toBe("");
    expect(api.post).not.toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

// --- Jeu introuvable / inactif : message neutre, échange bloqué ---------------

test.each([
  ["introuvable", [{ id: "mobile-legends", name: "Mobile Legends", active: true, identity_fields: [] }]],
  ["inactif", [{ id: "pubg-mobile", name: "PUBG Mobile", active: false, identity_fields: [] }]],
])("Jeu %s dans GET /api/games : aucun format supposé, message neutre, échange bloqué", async (_nom, games) => {
  mockGames = games;
  const { container, root } = await mount();
  try {
    expect(elOf(container, "loyalty-verify-unavailable")).not.toBeNull();
    expect(elOf(container, "loyalty-verify-unavailable").textContent).toContain("Service momentanément indisponible");
    expect(inputOf(container)).toBeNull();
    expect(redeemOf(container).disabled).toBe(true);
  } finally { await unmount(container, root); }
});

// --- Machine valid:true : échange ouvert, annulé au changement de champ -------

test("valid:true → échange actif, payload /loyalty/redeem inchangé (pubg_id vérifié)", async () => {
  const VALUE60 = "Z1".repeat(30); // 60 caractères alphanumériques
  api.post.mockImplementation((url) => {
    if (url === "/fazercards/validate-id") return Promise.resolve({ data: { valid: true, player_name: "Selneker" } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await mount();
  try {
    await setValue(inputOf(container), VALUE60);
    await act(async () => { elOf(container, "identity-verify-btn").click(); });
    await act(async () => {});
    expect(api.post).toHaveBeenCalledWith("/fazercards/validate-id", {
      game_id: "pubg-mobile",
      fields: { player_id: VALUE60 },
    });
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    expect(redeemOf(container).disabled).toBe(false);
    await act(async () => { redeemOf(container).click(); });
    await act(async () => {});
    expect(api.post).toHaveBeenCalledWith("/loyalty/redeem", { reward_id: "r1", pubg_id: VALUE60 });
  } finally { await unmount(container, root); }
});

test("Un champ modifié annule la vérification : l'échange se referme", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/fazercards/validate-id") return Promise.resolve({ data: { valid: true, player_name: "Selneker" } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await mount();
  try {
    await setValue(inputOf(container), "ABCD12EF90");
    await act(async () => { elOf(container, "identity-verify-btn").click(); });
    await act(async () => {});
    expect(redeemOf(container).disabled).toBe(false);

    await setValue(inputOf(container), "ABCD12EF91");
    expect(redeemOf(container).disabled).toBe(true);
    expect(elOf(container, "identity-verify-valid")).toBeNull();
  } finally { await unmount(container, root); }
});

test("Verdict réfusé (valid:false) : échange toujours bloqué, message de la table", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/fazercards/validate-id") return Promise.resolve({ data: { valid: false, code: "invalid_id", message: "api message" } });
    return Promise.resolve({ data: {} });
  });
  const { container, root } = await mount();
  try {
    await setValue(inputOf(container), "ABCD12EF90");
    await act(async () => { elOf(container, "identity-verify-btn").click(); });
    await act(async () => {});
    expect(elOf(container, "identity-verify-invalid").textContent).toContain("Identifiant invalide. Corrigez-le et revérifiez.");
    expect(api.post.mock.calls.some(([url]) => url === "/loyalty/redeem")).toBe(false);
    expect(redeemOf(container).disabled).toBe(true);
  } finally { await unmount(container, root); }
});

// --- Parité FR/EN -----------------------------------------------------------

const pathsOf = (obj, prefix = "") =>
  Object.keys(obj).flatMap((k) =>
    obj[k] && typeof obj[k] === "object" ? pathsOf(obj[k], `${prefix}${k}.`) : [`${prefix}${k}`]
  );

test("Parité FR/EN du dictionnaire : mêmes chemins de clés, textes FE-4 présents", () => {
  expect(pathsOf(translations.fr).sort()).toEqual(pathsOf(translations.en).sort());
  expect(translations.fr.account.identities.invalid).toBe("Identifiant invalide. Vérifiez les champs.");
  expect(translations.en.account.identities.invalid).toBe("Invalid ID. Check the fields.");
  expect(translations.fr.checkout.verifyTitleGame).toBe("Vérification du compte {game}");
  expect(translations.en.checkout.verifyTitleGame).toBe("Verify your {game} account");
  // Message neutre du repli « jeu fidélité indisponible ».
  expect(translations.fr.checkout.verifyProviderUnavailable).toBe("Service momentanément indisponible, réessayez");
  expect(translations.en.checkout.verifyProviderUnavailable).toBe("Service temporarily unavailable, please try again");
});
