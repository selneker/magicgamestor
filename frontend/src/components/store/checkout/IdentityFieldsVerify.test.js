import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import { setMockLang } from "@/context/LanguageContext";
import { IdentityFieldsVerify } from "./IdentityFieldsVerify";

// Les messages sont resolus contre le VRAI dictionnaire (FR et EN) : le test
// verifie les chaines reelles, pas des cles.
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
  { id: "free-fire", name: "Free Fire", slug: "free-fire", active: true },
];
jest.mock("@/context/GameContext", () => ({ useGames: () => ({ games: mockGames }) }));

// `errorMessage` reproduit le comportement reel (renvoie le `detail` de l'API)
// : le test prouve que le composant ne l'affiche pas.
jest.mock("@/lib/api", () => ({
  api: { post: jest.fn() },
  errorMessage: (e, fallback) => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join(" ");
    return fallback;
  },
}));

const PUBG_SPEC = [{ key: "player_id", label: "ID", pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true }];
const ML_SPEC = [
  { key: "player_id", label: "ID joueur", label_en: "Player ID", pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true },
  { key: "zone_id", label: "Zone ID", label_en: "Zone ID", pattern: "^[0-9]{3,5}$", min_length: 3, max_length: 5, required: true },
];
const ML_VALUES = { player_id: "123456789", zone_id: "123" };
const FREE_FIRE_SPEC = [{ key: "player_id", label: "ID joueur", label_en: "Player ID", pattern: "^[0-9]{9,13}$", min_length: 9, max_length: 13, required: true }];

// --- Montage factorise -------------------------------------------------------

const propsParDefaut = () => ({
  spec: ML_SPEC,
  gameId: "mobile-legends",
  values: ML_VALUES,
  setValues: jest.fn(),
  onVerified: jest.fn(),
  checkout: true,
});

async function mount(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<IdentityFieldsVerify {...propsParDefaut()} {...props} />);
  });
  return { container, root };
}

const unmount = async (container, root) => {
  await act(async () => root.unmount());
  container.remove();
};

const btnOf = (c) => c.querySelector('[data-testid="identity-verify-btn"]');
const elOf = (c, testid) => c.querySelector(`[data-testid="${testid}"]`);
const invalidOf = (c) => elOf(c, "identity-verify-invalid");
const errorOf = (c) => elOf(c, "identity-verify-error");
const texteDe = (c, testid) => elOf(c, testid)?.textContent ?? "";

// Un clic sur le bouton de verification, dans le cycle React.
const verifier = async (container) => {
  await act(async () => { btnOf(container).click(); });
};

let warnSpy;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.post.mockReset();
  setMockLang("fr");
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete global.IS_REACT_ACT_ENVIRONMENT;
  warnSpy.mockRestore();
});

// --- Parcours PUBG (contrat de la garde inerte, Phase 2) ----------------------

test("Champs inexploitables : clic et Entree ne declenchent aucune requete", async () => {
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: {} });
  try {
    const btn = btnOf(container);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.className).toContain("bg-muted");
    expect(btn.className).not.toContain("opacity-50");

    await act(async () => {
      btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      // jsdom ne traduit pas Entree en clic : on emule l'activation navigateur.
      btn.click();
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(invalidOf(container)).toBeNull();
  } finally { await unmount(container, root); }
});

test("Champs valides : le clic declenche la verification", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Test" } });
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: { player_id: "52328390220" } });
  try {
    expect(btnOf(container).getAttribute("aria-disabled")).toBe("false");
    await verifier(container);
    expect(api.post).toHaveBeenCalledTimes(1);
  } finally { await unmount(container, root); }
});

// --- Messages multi-jeux (T-ML-FRONT) ----------------------------------------

test("Mobile Legends + invalid_id : message du jeu, jamais « PUBG »", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id", message: "invalid id" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("Mobile Legends");
    expect(text).not.toContain("PUBG");
    expect(text).not.toBe("ID PUBG Mobile invalide");
  } finally { await unmount(container, root); }
});

test("Le message invalide est traduit (FR et EN) et nomme le jeu", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  for (const lang of ["fr", "en"]) {
    setMockLang(lang);
    const { container, root } = await mount();
    try {
      await verifier(container);
      const text = texteDe(container, "identity-verify-invalid");
      expect(text).toContain("Mobile Legends");
      expect(text).not.toContain("PUBG");
      expect(text).toContain(lang === "fr" ? "invalide pour" : "Invalid");
    } finally { await unmount(container, root); }
  }
});

test("missing_field : on demande de renseigner les champs (jamais « ID invalide »)", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "missing_field" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("Renseignez tous les champs");
    expect(text).not.toContain("invalide");
  } finally { await unmount(container, root); }
});

test("Chaque panne a son message et n'affiche jamais « ID invalide »", async () => {
  const pannes = [
    { status: 503, code: "unsupported_game", attendu: "Vérification indisponible pour ce jeu" },
    { status: 502, code: "provider_unavailable", attendu: "Service momentanément indisponible, réessayez" },
    { status: 504, code: "provider_unavailable", attendu: "Service momentanément indisponible, réessayez" },
    { status: 429, code: "rate_limited", attendu: "Trop de requêtes, patientez" },
  ];
  for (const panne of pannes) {
    api.post.mockRejectedValue({ response: { status: panne.status, data: { detail: "upstream failure", code: panne.code } } });
    const { container, root } = await mount();
    try {
      await verifier(container);
      expect(invalidOf(container)).toBeNull();
      const text = texteDe(container, "identity-verify-error");
      expect(text).toContain(panne.attendu);
      expect(text).not.toMatch(/invalide/i);
    } finally { await unmount(container, root); }
  }
});

test("Reponse sans code (backend ancien) : message neutre avec le nom du jeu", async () => {
  api.post.mockResolvedValue({ data: { valid: false } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("Mobile Legends");
    expect(text).not.toContain("PUBG");
  } finally { await unmount(container, root); }
});

test("Le parcours generique n'utilise plus le libelle PUBG « ID PUBG Mobile invalide »", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  const { container, root } = await mount({ gameId: "pubg-mobile" });
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    // Le nom du jeu, mais pas l'ancien libelle fige.
    expect(text).toContain("PUBG Mobile");
    expect(text).not.toBe("ID PUBG Mobile invalide");
  } finally { await unmount(container, root); }
});

test("Succes : le compte est affiche comme avant", async () => {
  const onVerified = jest.fn();
  api.post.mockResolvedValue({ data: { valid: true, player_name: "TestPlayer" } });
  const { container, root } = await mount({ onVerified });
  try {
    await verifier(container);
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    expect(texteDe(container, "identity-verify-player-name")).toContain("TestPlayer");
    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ name: "TestPlayer" }));
    expect(invalidOf(container)).toBeNull();
  } finally { await unmount(container, root); }
});

test("Garde inerte : champs incomplets -> aria-disabled et aucune requete", async () => {
  const { container, root } = await mount({ values: { player_id: "123456789", zone_id: "" } });
  try {
    expect(btnOf(container).getAttribute("aria-disabled")).toBe("true");
    await verifier(container);
    expect(api.post).not.toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

// --- Forme de la reponse (B2) ------------------------------------------------

test("Reponse non JSON (HTML) : etat erreur, jamais « ID invalide »", async () => {
  api.post.mockResolvedValue({ data: "<html>oops</html>" });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Service momentanément indisponible, réessayez");
    expect(warnSpy).toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

test("Reponse {} : etat erreur, jamais « ID invalide »", async () => {
  api.post.mockResolvedValue({ data: {} });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Service momentanément indisponible, réessayez");
  } finally { await unmount(container, root); }
});

test("Reponse null : etat erreur, jamais « ID invalide »", async () => {
  api.post.mockResolvedValue({ data: null });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Service momentanément indisponible, réessayez");
  } finally { await unmount(container, root); }
});

test("Code inconnu avec valid:false : invalide, avec le nom du jeu", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "mystery_code" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(errorOf(container)).toBeNull();
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("Mobile Legends");
    expect(text).not.toMatch(/invalide.*invalide/i);
  } finally { await unmount(container, root); }
});

// --- Libelles du spec (A3) ----------------------------------------------------

test("Un seul champ : le message ne cite que ce champ (Free Fire, sans zone)", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  const { container, root } = await mount({ spec: FREE_FIRE_SPEC, gameId: "free-fire", values: { player_id: "123456789" } });
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("ID joueur");
    expect(text).toContain("Free Fire");
    expect(text).not.toMatch(/zone/i);
  } finally { await unmount(container, root); }
});

test("Plusieurs champs : les libelles sont reunis par « ou »", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("ID joueur ou Zone ID");
    expect(text).toContain("Mobile Legends");
  } finally { await unmount(container, root); }
});

test("Nom du jeu inconnu : le message reste neutre, sans « pour ... »", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  const { container, root } = await mount({ gameId: "jeu-inconnu" });
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toBe("ID joueur ou Zone ID invalide");
    expect(text).not.toContain("pour");
  } finally { await unmount(container, root); }
});

// --- Annonce aux lecteurs d'ecran (A1) ---------------------------------------

test("Les messages sont annonces : alert pour les echecs, status pour le succes", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(elOf(container, "identity-verify-invalid").getAttribute("role")).toBe("alert");
  } finally { await unmount(container, root); }

  api.post.mockRejectedValue({ response: { status: 503, data: { code: "unsupported_game" } } });
  const echec = await mount();
  try {
    await verifier(echec.container);
    expect(elOf(echec.container, "identity-verify-error").getAttribute("role")).toBe("alert");
  } finally { await unmount(echec.container, echec.root); }

  api.post.mockResolvedValue({ data: { valid: true, player_name: "TestPlayer" } });
  const succes = await mount();
  try {
    await verifier(succes.container);
    expect(elOf(succes.container, "identity-verify-valid").getAttribute("role")).toBe("status");
  } finally { await unmount(succes.container, succes.root); }
});

// --- Detail brut de l'API (S1) -----------------------------------------------

test("Erreur sans code connu : message generique traduit, aucun detail brut affiche", async () => {
  const cas = [
    { nom: "422", erreur: { response: { status: 422, data: { detail: [{ loc: ["body", "fields"], msg: "field required" }] } } }, interdit: ["field required"] },
    { nom: "404", erreur: { response: { status: 404, data: { detail: "jeu inconnu" } } }, interdit: ["jeu inconnu"] },
    { nom: "500", erreur: { response: { status: 500, data: { detail: "boom" } } }, interdit: ["boom"] },
    { nom: "reseau", erreur: { message: "Network Error" }, interdit: ["Network Error"] },
  ];
  for (const c of cas) {
    api.post.mockRejectedValue(c.erreur);
    const { container, root } = await mount();
    try {
      await verifier(container);
      const text = texteDe(container, "identity-verify-error");
      expect(text).toBeTruthy();
      for (const interdit of c.interdit) expect(text).not.toContain(interdit);
      // Un message traduit du dictionnaire, pas une chaine technique.
      expect(["Erreur fournisseur", "Problème temporaire de l'API"]).toContain(text);
      expect(warnSpy).toHaveBeenCalled();
    } finally { await unmount(container, root); }
  }
});

