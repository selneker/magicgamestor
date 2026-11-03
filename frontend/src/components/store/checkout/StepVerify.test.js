import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import { setMockLang } from "@/context/LanguageContext";
import { StepVerify } from "./StepVerify";

// react-router-dom v7 ne se résout pas sous jest : mocks comme dans les autres tests.
jest.mock("react-router-dom", () => {
  const React = require("react");
  return {
    Link: ({ children, ...props }) => React.createElement("a", props, children),
  };
});

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
  { id: "pubg-mobile", name: "PUBG Mobile", slug: "pubg-mobile", active: true },
  { id: "mobile-legends", name: "Mobile Legends", slug: "mobile-legends", active: true },
];
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: mockGames }) }));

// Button (Radix) réduit à un <button> natif : ce que le test vérifie est le
// comportement, pas la librairie de primitives.
jest.mock("@/components/ui/button", () => {
  const React = require("react");
  return { Button: ({ children, ...props }) => React.createElement("button", props, children) };
});

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// Contrat de jeu ARBITRAIRE (config admin simulée, jamais une hypothèse du front).
const PUBG_SPEC = [{ key: "player_id", label: "ID PUBG Mobile", label_en: "PUBG Mobile ID", min_length: 8, max_length: 12, required: true, primary: true }];

// --- Mini-parent : tient le state exactement comme Checkout.js le fait --------
// Les callbacks passés à StepVerify STABLES (useState setters en prod) : un
// jest.fn() crié inline ref userait l'effet d'annulation à chaque rendu.
const setPubgIdMock = jest.fn();
const setEmailMock = jest.fn();
const onContinueMock = jest.fn();

function Harness({ spec = PUBG_SPEC, gameId = "pubg-mobile", pubgId = "", user = null }) {
  const [identityValues, setIdentityValues] = useState({});
  const [verified, setVerified] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [autoVerify, setAutoVerify] = useState(0);
  return (
    <StepVerify
      gameName="PUBG Mobile"
      pubgId={pubgId}
      setPubgId={setPubgIdMock}
      user={user}
      verified={verified}
      setVerified={setVerified}
      autoVerify={autoVerify}
      setAutoVerify={setAutoVerify}
      gameId={gameId}
      identity={identity}
      setIdentity={setIdentity}
      identitySpec={spec}
      identityValues={identityValues}
      setIdentityValues={setIdentityValues}
      email=""
      setEmail={setEmailMock}
      onContinue={onContinueMock}
    />
  );
}

async function mount(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness {...props} />);
  });
  return { container, root };
}

const unmount = async (container, root) => {
  await act(async () => root.unmount());
  container.remove();
};
const elOf = (c, testid) => c.querySelector(`[data-testid="${testid}"]`);
const inputOf = (c) => c.querySelector('[data-testid="identity-field-player_id"]');
const continueOf = (c) => elOf(c, "checkout-verify-continue");

let warnSpy;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockReset();
  api.get.mockResolvedValue({ data: [] });
  api.post.mockReset();
  setPubgIdMock.mockClear(); setEmailMock.mockClear(); onContinueMock.mockClear();
  setMockLang("fr");
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete global.IS_REACT_ACT_ENVIRONMENT;
  warnSpy.mockRestore();
});

// --- PUBG emprunte le formulaire générique (plus aucun écran historique) ------

test("PUBG : champ du contrat du jeu, sans input numérique spécial ni garde", async () => {
  const { container, root } = await mount();
  try {
    expect(inputOf(container)).not.toBeNull();
    expect(inputOf(container).type).toBe("text");
    expect(inputOf(container).getAttribute("inputmode")).toBeNull();
    expect(elOf(container, "pubg-id-input")).toBeNull();
    expect(elOf(container, "pubg-verify-btn")).toBeNull();
    // Pré-remplissage §4.8 : pas de vérification spontanée.
    expect(api.post).not.toHaveBeenCalled();
    // Sortie verrouillée tant que rien n'est vérifié.
    expect(continueOf(container)).toBeNull();
  } finally { await unmount(container, root); }
});

test("Pré-remplissage depuis le dernier ID connu, jamais compté comme vérifié", async () => {
  const { container, root } = await mount({ pubgId: "52328390220" });
  try {
    expect(inputOf(container).value).toBe("52328390220");
    // Aucune requête n'est partie : le préremplissage ne vérifie RIEN (§4.8).
    expect(elOf(container, "identity-verify-valid")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(continueOf(container)).toBeNull();
  } finally { await unmount(container, root); }
});

test("Effacer le champ ne ramène pas le préremplissage (effacement volontaire)", async () => {
  const { container, root } = await mount({ pubgId: "52328390220" });
  try {
    const input = inputOf(container);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(inputOf(container).value).toBe("");
    expect(api.post).not.toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

// --- Identités enregistrées : pré-remplies, TOUJOURS revérifiées (§4.8) -------

test("Chip d'identité : préremplit et REVÉRIFIE, jamais de drapeau validated", async () => {
  api.get.mockResolvedValue({ data: [{ id: "i1", label: "PUBG 52328390220", fields: { player_id: "52328390220" } }] });
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Sel" } });
  const user = { user_id: "u1" };
  const { container, root } = await mount({ user });
  try {
    await act(async () => {}); // flush du GET /me/game-identities
    expect(elOf(container, "checkout-identities")).not.toBeNull();

    // Clic sur le chip : champs préremplis — mais pas de « vérifié », la requête part.
    const chip = elOf(container, "identity-pick-i1");
    await act(async () => { chip.click(); });
    await act(async () => {}); // flush de la vérification auto (autoTrigger)

    expect(api.post).toHaveBeenCalledWith("/fazercards/validate-id", {
      game_id: "pubg-mobile",
      fields: { player_id: "52328390220" },
    });
    // AUCUN drapeau « validated » dans le corps de la requête.
    expect(JSON.stringify(api.post.mock.calls)).not.toContain("validated");
    // La re-vérification réelle a réussi : la sortie correspond exactement à
    // ce verdict HORS de préremplissage (§4.8 : jamais acceptée telle quelle).
    await act(async () => {});
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    expect(continueOf(container)).not.toBeNull();
  } finally { await unmount(container, root); }
});

// --- Machine §4 : sortie uniquement sur valid:true, annulée au changement -----

test("valid:true -> pseudo affiché, bouton Continuer actif", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Selneker" } });
  const { container, root } = await mount({ pubgId: "52328390220" });
  try {
    const btn = elOf(container, "identity-verify-btn");
    await act(async () => { btn.click(); });
    await act(async () => {});
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    expect(elOf(container, "identity-verify-player-name").textContent).toContain("Selneker");
    expect(continueOf(container)).not.toBeNull();
  } finally { await unmount(container, root); }
});

const texte = (c) =>
  (elOf(c, "identity-verify-invalid") || elOf(c, "identity-verify-error"))?.textContent ?? "";

// `rejete` : les cas 200 { valid:false } sont des RÉPONSES, les pannes HTTP sont des rejets.
test.each([
  ["invalid_id", { status: 200, data: { valid: false, code: "invalid_id", message: "api message" } }, false, "Identifiant invalide"],
  ["missing_field", { status: 200, data: { valid: false, code: "missing_field" } }, false, "Renseignez tous les champs"],
  ["429", { response: { status: 429, data: { code: "rate_limited" } } }, true, "Trop de tentatives"],
  ["503", { response: { status: 503, data: { detail: "kaboom" } } }, true, "Service momentanément indisponible"],
  ["inconnu", { status: 418, data: { detail: "teapot" } }, true, "Vérification impossible pour le moment"],
  ["réseau", { message: "Network Error" }, true, "Vérification impossible pour le moment"],
])("verdict %s : sortie bloquée, message de la table (fail-closed)", async (_nom, reponse, rejete, attendu) => {
  if (rejete) api.post.mockRejectedValueOnce(reponse); else api.post.mockResolvedValueOnce(reponse);
  const { container, root } = await mount({ pubgId: "52328390220" });
  try {
    await act(async () => { elOf(container, "identity-verify-btn").click(); });
    await act(async () => {});
    expect(elOf(container, "identity-verify-valid")).toBeNull();
    expect(continueOf(container)).toBeNull();
    expect(texte(container)).toContain(attendu);
  } finally { await unmount(container, root); }
});

test("Un champ modifié annule la vérification : la sortie se referme", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Selneker" } });
  const { container, root } = await mount({ pubgId: "52328390220" });
  try {
    await act(async () => { elOf(container, "identity-verify-btn").click(); });
    await act(async () => {});
    expect(continueOf(container)).not.toBeNull();

    const input = inputOf(container);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(input, "987654321");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(inputOf(container).value).toBe("987654321");
    expect(continueOf(container)).toBeNull();
    expect(elOf(container, "identity-verify-valid")).toBeNull();
  } finally { await unmount(container, root); }
});
