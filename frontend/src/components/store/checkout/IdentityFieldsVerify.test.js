import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import { setMockLang } from "@/context/LanguageContext";
import { recentPlayerIdList, rememberPlayerId } from "@/lib/recentPlayerIds";
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

// Motifs ARBITRAIRES simulés : ils représentent la config admin d'un jeu
// (« identity_fields » fournie par le backend), jamais une hypothèse du code
// du front. Aucun garde de format n'existe côté checkout.
const PUBG_SPEC = [{ key: "player_id", label: "ID", pattern: "^[0-9]{8,12}$", min_length: 8, max_length: 12, required: true }];
const ML_SPEC = [
  { key: "player_id", label: "ID joueur", label_en: "Player ID", pattern: "^[0-9]{8,12}$", min_length: 8, max_length: 12, required: true },
  { key: "zone_id", label: "Zone ID", label_en: "Zone ID", pattern: "^[0-9]{3,5}$", min_length: 3, max_length: 5, required: true },
];
const ML_VALUES = { player_id: "123456789", zone_id: "123" };
const FREE_FIRE_SPEC = [{ key: "player_id", label: "ID joueur", label_en: "Player ID", pattern: "^[0-9]{8,12}$", min_length: 8, max_length: 12, required: true }];

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
  global.localStorage.clear();
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

// --- Verdict « refused » de la table §2 ---------------------------------------

test("invalid_id : message de la table, jamais le detail ni le message de l'API", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id", message: "invalid id", detail: "unknown id" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toBe("Identifiant invalide. Corrigez-le et revérifiez.");
    expect(text).not.toContain("invalid id");
    expect(text).not.toContain("unknown id");
    expect(text).not.toContain("PUBG");
  } finally { await unmount(container, root); }
});

test("Le verdict refuse est traduit (FR et EN)", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  for (const lang of ["fr", "en"]) {
    setMockLang(lang);
    const { container, root } = await mount();
    try {
      await verifier(container);
      expect(texteDe(container, "identity-verify-invalid")).toBe(lang === "fr"
        ? "Identifiant invalide. Corrigez-le et revérifiez."
        : "Invalid ID. Correct it and verify again.");
    } finally { await unmount(container, root); }
  }
});

test("missing_field : on demande de renseigner les champs (jamais « invalide »)", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "missing_field" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toContain("Renseignez tous les champs");
    expect(text).not.toContain("invalide");
  } finally { await unmount(container, root); }
});

test("Chaque panne a son message: verdicts de la table §2, jamais « ID invalide »", async () => {
  const pannes = [
    { status: 503, code: "unsupported_game", attendu: "Service momentanément indisponible, réessayez" },
    { status: 502, code: "provider_unavailable", attendu: "Service momentanément indisponible, réessayez" },
    { status: 504, code: "provider_unavailable", attendu: "Service momentanément indisponible, réessayez" },
    { status: 429, code: "rate_limited", attendu: "Trop de tentatives. Réessayez dans quelques minutes." },
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

test("valid:false sans code (backend ancien) : fail-closed, panne neutre ambre", async () => {
  api.post.mockResolvedValue({ data: { valid: false } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Vérification impossible pour le moment");
  } finally { await unmount(container, root); }
});

test("Le parcours PUBG emprunte la même table : verdict neutre, sans libellé figé", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id", message: "pubg says no" } });
  const { container, root } = await mount({ gameId: "pubg-mobile" });
  try {
    await verifier(container);
    const text = texteDe(container, "identity-verify-invalid");
    expect(text).toBe("Identifiant invalide. Corrigez-le et revérifiez.");
    expect(text).not.toContain("pubg says no");
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

test("Reponse non JSON (HTML) : verdict de panne de la table, jamais « ID invalide »", async () => {
  api.post.mockResolvedValue({ data: "<html>oops</html>" });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Vérification impossible pour le moment");
    expect(warnSpy).toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

test("Reponse {} : verdict de panne de la table, jamais « ID invalide »", async () => {
  api.post.mockResolvedValue({ data: {} });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Vérification impossible pour le moment");
  } finally { await unmount(container, root); }
});

test("Reponse null : verdict de panne de la table, jamais « ID invalide »", async () => {
  api.post.mockResolvedValue({ data: null });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(invalidOf(container)).toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Vérification impossible pour le moment");
  } finally { await unmount(container, root); }
});

test("Code inconnu avec valid:false : verdict générique neutre (fail-closed)", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "mystery_code" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(errorOf(container)).not.toBeNull();
    expect(texteDe(container, "identity-verify-error")).toContain("Vérification impossible pour le moment");
    // Le verdict générique n'expose JAMAIS un code brut.
    expect(texteDe(container, "identity-verify-error")).not.toContain("mystery_code");
  } finally { await unmount(container, root); }
});

// --- Libelles du spec (§1 : formulaire dynamique et replis) -------------------

test("Un seul champ dans la config : aucun champ zone ne s'affiche", async () => {
  const { container, root } = await mount({ spec: FREE_FIRE_SPEC, gameId: "free-fire", values: { player_id: "123456789" } });
  try {
    expect(elOf(container, "identity-field-player_id")).not.toBeNull();
    expect(elOf(container, "identity-field-zone_id")).toBeNull();
  } finally { await unmount(container, root); }
});

test("Deux champs : les libelles admin pilotent le formulaire", async () => {
  const { container, root } = await mount();
  try {
    expect(container.querySelector('[for="identity-player_id"]').textContent).toContain("ID joueur");
    expect(container.querySelector('[for="identity-zone_id"]').textContent).toContain("Zone ID");
  } finally { await unmount(container, root); }
});

test("Champ sans label declare : repli contractuel « ID joueur » / « Zone » (§1)", async () => {
  const spec = [
    { key: "player_id", required: true, primary: true },
    { key: "zone_id", required: true },
  ];
  const { container, root } = await mount({ spec, gameId: "generic-game", values: { player_id: "abc" } });
  try {
    expect(container.querySelector('[for="identity-player_id"]').textContent).toContain("ID joueur");
    expect(container.querySelector('[for="identity-zone_id"]').textContent).toContain("Zone");
    expect(container.querySelector('[for="identity-zone_id"]').textContent).not.toContain("ID joueur");
  } finally { await unmount(container, root); }
});

test("Jeu inconnu du catalogue : le formulaire reste fonctionnel et neutre", async () => {
  api.post.mockResolvedValue({ data: { valid: false, code: "invalid_id" } });
  const { container, root } = await mount({ gameId: "jeu-inconnu" });
  try {
    await verifier(container);
    expect(texteDe(container, "identity-verify-invalid")).toBe("Identifiant invalide. Corrigez-le et revérifiez.");
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

// --- Message de confirmation (S2) -------------------------------------------

test("Confirmation : le nom du jeu remplace PUBG, le texte PUBG reste identique", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "TestPlayer" } });
  const ml = await mount();
  try {
    await verifier(ml.container);
    const text = texteDe(ml.container, "identity-verify-confirm");
    expect(text).toContain("Mobile Legends");
    expect(text).not.toContain("PUBG");
    expect(text).toContain("ID joueur");
  } finally { await unmount(ml.container, ml.root); }

  const pubg = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: { player_id: "52328390220" } });
  try {
    await verifier(pubg.container);
    expect(texteDe(pubg.container, "identity-verify-confirm")).toBe("Vérifiez que cet ID correspond bien à votre compte PUBG Mobile.");
  } finally { await unmount(pubg.container, pubg.root); }
});

// --- Detail brut de l'API (S1) -----------------------------------------------

test("Les erreurs HTTP suivent la table §2, aucun detail brut affiche", async () => {
  for (const c of [
    // 422 -> saisie incorrecte de la table : panneau rouge, champs à corriger.
    { nom: "422", erreur: { response: { status: 422, data: { detail: [{ loc: ["body", "fields"], msg: "field required" }] } } }, panneau: "identity-verify-invalid", attendu: "Renseignez tous les champs", interdit: ["field required"] },
    { nom: "404", erreur: { response: { status: 404, data: { detail: "jeu inconnu" } } }, panneau: "identity-verify-error", attendu: "Vérification impossible pour le moment", interdit: ["jeu inconnu"] },
    { nom: "500", erreur: { response: { status: 500, data: { detail: "boom" } } }, panneau: "identity-verify-error", attendu: "Vérification impossible pour le moment", interdit: ["boom"] },
    { nom: "reseau", erreur: { message: "Network Error" }, panneau: "identity-verify-error", attendu: "Vérification impossible pour le moment", interdit: ["Network Error"] },
  ]) {
    api.post.mockRejectedValue(c.erreur);
    const { container, root } = await mount();
    try {
      await verifier(container);
      const text = texteDe(container, c.panneau);
      expect(text).toBeTruthy();
      expect(text).toContain(c.attendu);
      for (const interdit of c.interdit) expect(text).not.toContain(interdit);
      // Un message traduit du dictionnaire, jamais une chaine technique.
      expect(warnSpy).toHaveBeenCalled();
    } finally { await unmount(container, root); }
  }
});

// --- Reponse tardive (S3) ----------------------------------------------------

// Le composant a besoin de valeurs reellement modifiees : on monte un
// petit composant conteneur qui tient les valeurs dans un state.
function Harness({ spec, gameId, initialValues, onVerified }) {
  const [values, setValues] = useState(initialValues);
  return (
    <IdentityFieldsVerify
      spec={spec}
      gameId={gameId}
      values={values}
      setValues={setValues}
      onVerified={onVerified}
      checkout
    />
  );
}

test("Reponse arrivee apres une modification des champs : ignoree", async () => {
  let resolvePost;
  api.post.mockReturnValue(new Promise((res) => { resolvePost = res; }));
  const onVerified = jest.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness spec={ML_SPEC} gameId="mobile-legends" initialValues={ML_VALUES} onVerified={onVerified} />);
  });
  try {
    await verifier(container);
    expect(api.post).toHaveBeenCalledTimes(1);

    // Le joueur modifie un champ pendant que la requete est en vol.
    const input = container.querySelector('[data-testid="identity-field-player_id"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(input, "987654321");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // La reponse (tardive) arrive enfin.
    await act(async () => { resolvePost({ data: { valid: false, code: "invalid_id" } }); });

    expect(invalidOf(container)).toBeNull();
    expect(errorOf(container)).toBeNull();
    expect(elOf(container, "identity-verify-valid")).toBeNull();
    expect(onVerified).not.toHaveBeenCalledWith(expect.objectContaining({ fields: expect.anything() }));
  } finally { await unmount(container, root); }
});

// --- Contrat PL-003-SEL-2 §1 : plafond 60 sans max_length ---------------------

test("Sans max_length : le champ plafonne a 60 caracteres (repli, jamais illimite)", async () => {
  // Champ sans aucune longueur ni motif declare dans la config du jeu.
  const spec = [{ key: "player_id", label: "ID", required: true, primary: true }];
  const { container, root } = await mount({ spec, gameId: "generic-game", values: { player_id: "a".repeat(61) } });
  try {
    const err = elOf(container, "identity-field-error-player_id");
    expect(err).not.toBeNull();
    expect(err.textContent).toBe("60 caractères maximum");
    // Entrée maxLength du DOM : le navigateur ne peut pas saisir plus de 60.
    expect(container.querySelector('[data-testid="identity-field-player_id"]').maxLength).toBe(60);
  } finally { await unmount(container, root); }
});

test("Sans max_length : 60 exactes passent la validation locale", async () => {
  const spec = [{ key: "player_id", label: "ID", required: true, primary: true }];
  const { container, root } = await mount({ spec, gameId: "generic-game", values: { player_id: "a".repeat(60) } });
  try {
    expect(elOf(container, "identity-field-error-player_id")).toBeNull();
    expect(btnOf(container).getAttribute("aria-disabled")).toBe("false");
  } finally { await unmount(container, root); }
});

// --- Contrat PL-003-FE-3 : une seule requête par clic -------------------------

test("Double clic : une seule requête part, le bouton se fige en cours", async () => {
  let resolvePost;
  api.post.mockReturnValue(new Promise((res) => { resolvePost = res; }));
  const { container, root } = await mount();
  try {
    await act(async () => { btnOf(container).click(); });
    // Second événement discret (nouveau rendu commité) : le bouton est en cours.
    expect(btnOf(container).textContent).toContain("Vérification");
    await act(async () => { btnOf(container).click(); });
    await act(async () => { resolvePost({ data: { valid: true, player_name: "Sel" } }); });
    expect(api.post).toHaveBeenCalledTimes(1);
  } finally { await unmount(container, root); }
});

// --- Valeurs transmises : AUCUN filtre de caractères, pas de motif imposé ------

test("Valeur alphanumérique : transmise sans filtre après découpe aux espaces", async () => {
  const spec = [{ key: "player_id", label: "ID", required: true, primary: true }];
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Sel" } });
  const { container, root } = await mount({ spec, gameId: "generic-game", values: { player_id: "  AB-1234_xyz  " } });
  try {
    await verifier(container);
    expect(api.post).toHaveBeenCalledWith("/fazercards/validate-id", { game_id: "generic-game", fields: { player_id: "AB-1234_xyz" } });
  } finally { await unmount(container, root); }
});

test("Sans motif déclaré : toute chaîne de 60 est envoyée telle quelle", async () => {
  const spec = [{ key: "player_id", label: "ID", required: true, primary: true }];
  const value = "ABCdef-_09xy &1ABCdef-_09xy &1ABCdef-_09xy &1ABCdef-_09xy &1"; // 60 caractères, sans motif
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Sel" } });
  const { container, root } = await mount({ spec, gameId: "generic-game", values: { player_id: value } });
  try {
    expect(value.length).toBe(60);
    await verifier(container);
    expect(api.post).toHaveBeenCalledWith("/fazercards/validate-id", { game_id: "generic-game", fields: { player_id: value } });
  } finally { await unmount(container, root); }
});

// --- Repli manuel après une panne (aucun nouvel essai automatique) ------------

test("Panne : le bouton « Vérifier » reste disponible pour un nouvel essai, sans requête spontanée", async () => {
  api.post.mockRejectedValueOnce({ response: { status: 503, data: { code: "provider_unavailable" } } })
    .mockResolvedValueOnce({ data: { valid: true, player_name: "Sel" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(elOf(container, "identity-verify-error")).not.toBeNull();
    // Le bouton de nouveau essai est le même, toujours actif.
    expect(btnOf(container).getAttribute("aria-disabled")).toBe("false");
    // Aucune requête spontanée n'est partie pendant l'affichage de la panne.
    expect(api.post).toHaveBeenCalledTimes(1);
    await verifier(container);
    await act(async () => {});
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    expect(api.post).toHaveBeenCalledTimes(2);
  } finally { await unmount(container, root); }
});

// --- PL-003-FE-5 : pseudo traduit + région affichée quand le backend la renvoie

test("Région présente : libellé pseudo traduit (FR) et région affichée", async () => {
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Seln", region: "Indonesia" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    await act(async () => {});
    expect(texteDe(container, "identity-verify-player-name")).toContain("Nom du joueur");
    expect(texteDe(container, "identity-verify-player-name")).toContain("Seln");
    expect(texteDe(container, "identity-verify-region")).toContain("Région : Indonesia");
  } finally { await unmount(container, root); }
});

const sansRegion = [
  ["absente de la réponse", undefined],
  ["chaîne vide", ""],
  ["espaces seuls", "   "],
];

test.each(sansRegion)("Région %s : aucune ligne, aucun « undefined »", async (_nom, region) => {
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Seln", ...(region === undefined ? {} : { region }) } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    await act(async () => {});
    expect(elOf(container, "identity-verify-region")).toBeNull();
    expect(container.textContent).not.toContain("undefined");
    // Personne n'invente de région : une seule requête, panneau sans ligne région.
    expect(api.post.mock.calls.length).toBe(1);
  } finally { await unmount(container, root); }
});

test("Libellés EN : « Player name » et « Region » (parité FR/EN)", async () => {
  setMockLang("en");
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Seln", region: "Indonesia" } });
  const { container, root } = await mount();
  try {
    await verifier(container);
    await act(async () => {});
    expect(texteDe(container, "identity-verify-player-name")).toContain("Player name");
    expect(texteDe(container, "identity-verify-region")).toContain("Region : Indonesia");
    expect(container.textContent).not.toContain("Nom du joueur");
  } finally { await unmount(container, root); }
});

test("Restauration via initial : pseudo ET région réaffichés sans appeler le backend", async () => {
  api.post.mockReset();
  const onVerified = jest.fn();
  const { container, root } = await mount({
    initial: { name: "Seln", region: "Indonesia" },
    onVerified,
  });
  try {
    await act(async () => {});
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    expect(texteDe(container, "identity-verify-player-name")).toContain("Seln");
    expect(texteDe(container, "identity-verify-region")).toContain("Indonesia");
    expect(api.post).not.toHaveBeenCalled();
  } finally { await unmount(container, root); }
});


// --- PL-UX-3 : suggestions d'ID joueur déjà utilisés (stockage local) ----------

// Les suggestions sont rendues dans le composant : le test lit le DOM rendu.
const pastilles = (c) => Array.from(c.querySelectorAll('[data-testid^="identity-recent-id-"]'));

test("PL-UX-3 : aucun ID mémorisé → aucune pastille", async () => {
  global.localStorage.clear();
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: {} });
  try {
    expect(elOf(container, "identity-recent-ids")).toBeNull();
    expect(pastilles(container)).toHaveLength(0);
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : les ID déjà utilisés apparaissent en pastilles, les plus récents d'abord", async () => {
  rememberPlayerId("pubg-mobile", "111111111");
  rememberPlayerId("pubg-mobile", "222222222");
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: {} });
  try {
    const pills = pastilles(container);
    expect(pills.map((p) => p.textContent)).toEqual(["222222222", "111111111"]);
    // Une seule ligne, pas de retour à la ligne, pas de défilement.
    expect(elOf(container, "identity-recent-ids").className).toContain("overflow-hidden");
    expect(elOf(container, "identity-recent-ids").className).not.toContain("flex-wrap");
    // Zone tactile : 44 px de hauteur minimum (h-11).
    expect(pills[0].className).toContain("h-11");
    // Nom accessible et ligne de suggestions sur la ligne du bouton.
    expect(pills[0].getAttribute("aria-label")).toBe("Utiliser l'ID 222222222");
    expect(elOf(container, "identity-verify-row")).not.toBeNull();
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : les ID d'un AUTRE jeu ne sont jamais proposés", async () => {
  rememberPlayerId("free-fire", "333333333");
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: {} });
  try {
    expect(pastilles(container)).toHaveLength(0);
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : une pastille remplit le champ, sans lancer la vérification", async () => {
  rememberPlayerId("pubg-mobile", "444444444");
  api.post.mockReset();
  const setValues = jest.fn();
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: {}, setValues });
  try {
    await act(async () => { pastilles(container)[0].click(); });
    expect(setValues).toHaveBeenCalledTimes(1);
    const update = setValues.mock.calls[0][0];
    expect(update({ player_id: "" })).toEqual({ player_id: "444444444" });
    // Pas de vérification automatique : c'est le comportement actuel après saisie.
    expect(api.post).not.toHaveBeenCalled();
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : après une vérification réussie, l'ID est mémorisé et les suggestions disparaissent", async () => {
  global.localStorage.clear();
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Sel" } });
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: { player_id: "555555555" } });
  try {
    await verifier(container);
    expect(elOf(container, "identity-verify-valid")).not.toBeNull();
    // Les suggestions disparaissent tant que l'ID est vérifié.
    expect(elOf(container, "identity-recent-ids")).toBeNull();
    // L'ID est enregistré en tête de liste pour ce jeu.
    expect(recentPlayerIdList("pubg-mobile")).toEqual(["555555555"]);
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : « Changer » (editing) fait réapparaître les suggestions", async () => {
  rememberPlayerId("pubg-mobile", "666666666");
  // `checkout: false` = l'écran de commande (le composant garde la ligne
  // « Vérifier » visible même quand l'ID est déjà vérifié).
  const { container, root } = await mount({
    spec: PUBG_SPEC, gameId: "pubg-mobile", values: { player_id: "666666666" },
    initial: { name: "Sel" }, editing: true, checkout: false,
  });
  try {
    expect(elOf(container, "identity-recent-ids")).not.toBeNull();
    expect(pastilles(container).map((p) => p.textContent)).toEqual(["666666666"]);
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : sans `editing`, un ID vérifié ne montre aucune suggestion", async () => {
  rememberPlayerId("pubg-mobile", "777777777");
  const { container, root } = await mount({
    spec: PUBG_SPEC, gameId: "pubg-mobile", values: { player_id: "777777777" },
    initial: { name: "Sel" }, checkout: false,
  });
  try {
    expect(elOf(container, "identity-recent-ids")).toBeNull();
  } finally { await unmount(container, root); }
});

test("PL-UX-3 : un ID déjà mémorisé ne crée pas de doublon", async () => {
  global.localStorage.clear();
  rememberPlayerId("pubg-mobile", "888888888");
  api.post.mockResolvedValue({ data: { valid: true, player_name: "Sel" } });
  const { container, root } = await mount({ spec: PUBG_SPEC, gameId: "pubg-mobile", values: { player_id: "888888888" } });
  try {
    await verifier(container);
    expect(recentPlayerIdList("pubg-mobile")).toEqual(["888888888"]);
  } finally { await unmount(container, root); }
});
