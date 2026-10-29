// Tests de la page SDUI parente (FE-005). Client HTTP mocké (@/lib/api) ; le
// résolveur de langage est mocké en passthrough : les textes affichés viennent
// alors des VRAIES traductions du contrat (via resolveFlat) — les assertions
// portent les textes EXACTS d'i18n-keys.json. Motif du dépôt : createRoot +
// act (React 19), IS_REACT_ACT_ENVIRONMENT, clic via element.click().

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminSduiScreen from "./AdminSduiScreen";
import providerFixture from "@/sdui/__fixtures__/screen-provider.json";
import mappingFixture from "@/sdui/__fixtures__/screen-mapping.json";
import previewFixture from "@/sdui/__fixtures__/preview-response.json";
import applyFixture from "@/sdui/__fixtures__/apply-response.json";
import { api } from "@/lib/api";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), put: jest.fn(), post: jest.fn() } }));

jest.mock("@/context/LanguageContext", () => ({
  // passthrough : makeT retombe sur resolveFlat(translations) — textes réels du contrat.
  useLang: () => ({ t: (path) => path, lang: "fr" }),
}));

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    rerender: async (el) => {
      await act(async () => {
        root.render(el);
      });
    },
  };
}

const click = (el) => act(async () => el.click());
const q = (container, testid) => container.querySelector(`[data-testid="${testid}"]`);

const selectValue = async (select, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const expectAllPathsAdmin = () => {
  for (const fn of [api.get, api.put, api.post]) {
    for (const call of fn.mock.calls) {
      expect(String(call[0])).toMatch(/^\/admin\//);
    }
  }
};

const GAME = "example_game";

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ——— Récupération (GET) ————————————————————————————————————————————————————

test("GET : chemins exacts des deux écrans, gameId encodé", async () => {
  api.get.mockResolvedValue({ data: providerFixture });
  const a = await mount(<AdminSduiScreen screen="provider" gameId="jeu 1" />);
  expect(api.get).toHaveBeenCalledWith("/admin/games/jeu%201/provider");
  await act(async () => a.root.unmount());

  api.get.mockResolvedValue({ data: mappingFixture });
  const b = await mount(<AdminSduiScreen screen="mapping" gameId="jeu 1" />);
  expect(api.get).toHaveBeenCalledWith("/admin/games/jeu%201/aluu-mapping");
  await act(async () => b.root.unmount());
});

test("changement de gameId ou d'écran → nouveau GET", async () => {
  api.get.mockResolvedValue({ data: providerFixture });
  const { root, rerender } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  await rerender(<AdminSduiScreen screen="provider" gameId="autre-jeu" />);
  await rerender(<AdminSduiScreen screen="mapping" gameId="autre-jeu" />);
  const urls = api.get.mock.calls.map((c) => c[0]);
  expect(urls).toEqual([
    "/admin/games/example_game/provider",
    "/admin/games/autre-jeu/provider",
    "/admin/games/autre-jeu/aluu-mapping",
  ]);
  await act(async () => root.unmount());
});

test("les deux fixtures se rendent : un seul h1 chacun, blocs du contrat", async () => {
  api.get.mockResolvedValue({ data: providerFixture });
  const a = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  expect(a.container.querySelectorAll("h1")).toHaveLength(1);
  expect(a.container.querySelector("h1").textContent).toBe("Fournisseur du jeu");
  expect(q(a.container, "sdui-select-provider").querySelector("select").disabled).toBe(true); // select disabled du contrat
  expect(q(a.container, "sdui-select-provider").querySelector("select").value).toBe("fazercards");
  await act(async () => a.root.unmount());

  api.get.mockResolvedValue({ data: mappingFixture });
  const b = await mount(<AdminSduiScreen screen="mapping" gameId={GAME} />);
  expect(b.container.querySelectorAll("h1")).toHaveLength(1);
  expect(b.container.querySelector("h1").textContent).toBe("Correspondance produits ↔ packs");
  expect(q(b.container, "sdui-table-products")).not.toBeNull();
  await act(async () => b.root.unmount());
});

test("réponse périmée IGNORÉE : la plus récente gagne", async () => {
  const resolvers = [];
  api.get.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const { container, root, rerender } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  const resolveFirst = resolvers[0];
  await rerender(<AdminSduiScreen screen="provider" gameId="autre-jeu" />);
  const resolveSecond = resolvers[1];
  // la deuxième arrive AVANT la première
  await act(async () => {
    resolveSecond({ data: { ...providerFixture, screen: "provider", game: { id: "autre-jeu", name: "Autre" } } });
  });
  expect(container.querySelector("h1").textContent).toBe("Fournisseur du jeu");
  await act(async () => {
    resolveFirst({ data: { contract_version: "v0" } }); // périmée : ignorée
  });
  // l'écran le plus récent reste affiché (l'ancien ne l'a jamais remplacé)
  expect(container.querySelector("h1").textContent).toBe("Fournisseur du jeu");
  await act(async () => root.unmount());
});

test("réponse après démontage : aucune mise à jour, aucune exception", async () => {
  let resolveGet;
  api.get.mockImplementation(() => new Promise((resolve) => (resolveGet = resolve)));
  const { root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  await act(async () => root.unmount());
  await act(async () => {
    resolveGet({ data: providerFixture });
  });
  expect(true).toBe(true); // pas d'exception ni d'avertissement React
});

test("contract_version ≠ v0 refusée : écran d'erreur, aucun bloc rendu", async () => {
  api.get.mockResolvedValue({ data: { ...providerFixture, contract_version: "v1" } });
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  expect(q(container, "sdui-version")).not.toBeNull();
  expect(container.querySelector("h1")).toBeNull();
  expectAllPathsAdmin();
  await act(async () => root.unmount());
});

// ——— put_config ————————————————————————————————————————————————————————————

test("put_config : corps EXACT du moteur (clé provider absente), puis l'écran est remplacé", async () => {
  api.get.mockResolvedValue({ data: providerFixture });
  const newScreen = {
    ...providerFixture,
    blocks: [{ kind: "heading", label_key: "admin.provider.section.connection", level: 1 }],
  };
  api.put.mockResolvedValue({ data: newScreen });
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
    await click(q(container, "sdui-button-save_config")); // écriture → confirmation d'abord
  expect(api.put).not.toHaveBeenCalled(); // JAMAIS avant confirmation
  await click(q(container, "sdui-confirm-run"));
  expect(api.put).toHaveBeenCalledTimes(1);
  const [url, body] = api.put.mock.calls[0];
  expect(url).toBe("/admin/games/example_game/provider/config");
  expect(body).toEqual({
    aluu_game_code: "example_game",
    aluu_check_endpoint: "game-check",
    aluu_identity_map: { player_id: "characterId" },
  });
  expect(body).not.toHaveProperty("provider"); // jamais la clé provider
  // la réponse EST le nouvel écran
  expect(container.querySelector("h1").textContent).toBe("Connexion fournisseur");
  expectAllPathsAdmin();
  await act(async () => root.unmount());
});

test("put_config : champ d'identité non relié (vidé) → aluu_identity_map omis", async () => {
  api.get.mockResolvedValue({ data: providerFixture });
  api.put.mockResolvedValue({ data: providerFixture });
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  const identity = q(container, "sdui-select-aluu_identity_map.player_id").querySelector("select");
  await selectValue(identity, ""); // délier le champ
  await click(q(container, "sdui-button-save_config"));
  await click(q(container, "sdui-confirm-run"));
  const body = api.put.mock.calls[0][1];
  expect(body).toEqual({ aluu_game_code: "example_game", aluu_check_endpoint: "game-check" });
  expect(body).not.toHaveProperty("aluu_identity_map");
  await act(async () => root.unmount());
});

// ——— put_game_provider —————————————————————————————————————————————————————

test("bascule : payload du bloc TEL QUEL ; can_switch_provider faux → désactivé, rien n'est envoyé", async () => {
  api.get.mockResolvedValue({ data: providerFixture }); // can_switch_provider: false
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  expect(q(container, "sdui-button-switch_provider").disabled).toBe(true);
  await click(q(container, "sdui-button-switch_provider")); // clic sans effet
  expect(api.put).not.toHaveBeenCalled();
  await act(async () => root.unmount());

  const allowed = { ...providerFixture, permissions: { ...providerFixture.permissions, can_switch_provider: true } };
  api.get.mockResolvedValue({ data: allowed });
  api.put.mockResolvedValue({ data: allowed });
  const b = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  await click(q(b.container, "sdui-button-switch_provider"));
  await click(q(b.container, "sdui-confirm-run"));
  expect(api.put).toHaveBeenCalledTimes(1);
  const [url, body] = api.put.mock.calls[0];
  expect(url).toBe("/admin/games/example_game/provider");
  expect(body).toEqual({ provider: "aluu" }); // exactement le payload du bloc
  await act(async () => b.root.unmount());
});

// ——— mapping_preview ———————————————————————————————————————————————————————

const mountMappingWithPreview = async () => {
  api.get.mockResolvedValue({ data: mappingFixture });
  api.post.mockResolvedValueOnce({ data: previewFixture }); // preview
  const handle = await mount(<AdminSduiScreen screen="mapping" gameId={GAME} />);
  await click(q(handle.container, "sdui-button-preview")); // POST lecture seule : sans confirmation
  return handle;
};

test("aperçu : POST avec corps VIDE, rows injectées UNIQUEMENT dans la table preview", async () => {
  const { container, root } = await mountMappingWithPreview();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post.mock.calls[0]).toHaveLength(1); // corps vide : pas d'argument data
  expect(api.post.mock.calls[0][0]).toBe("/admin/games/example_game/aluu-mapping/preview");
  // rows du contrat injectées dans la table preview uniquement
  expect(q(container, "sdui-row-preview-PRODUCT-0001")).not.toBeNull();
  expect(q(container, "sdui-row-preview-PRODUCT-0002")).not.toBeNull();
  expect(q(container, "sdui-row-products-PRODUCT-0001").textContent).toContain("Example Pack 0001"); // table products intacte
  expect(q(container, "sdui-row-products-PRODUCT-0005")).toBeNull();
  // les cases partent de row.selected : proposed cochée, ambiguous/missing non
  expect(q(container, "sdui-checkbox-PRODUCT-0001").checked).toBe(true);
  expect(q(container, "sdui-checkbox-PRODUCT-0002").checked).toBe(false);
  expect(q(container, "sdui-checkbox-PRODUCT-0003").checked).toBe(false);
  expect(q(container, "sdui-checkbox-PRODUCT-0002").disabled).toBe(true);
  expectAllPathsAdmin();
  await act(async () => root.unmount());
});

// ——— mapping_apply —————————————————————————————————————————————————————————

test("apply : seulement les proposed cochées, exactement ce corps ; désactivé sans sélection", async () => {
  const { container, root } = await mountMappingWithPreview();
  const applyButton = q(container, "sdui-button-apply");
  expect(applyButton.disabled).toBe(false); // PRODUCT-0001 proposée + cochée
  api.post.mockResolvedValueOnce({ data: applyFixture });
  api.get.mockResolvedValueOnce({ data: mappingFixture }); // refetch après apply
  await click(applyButton); // écriture → confirmation
  expect(api.post).toHaveBeenCalledTimes(1); // toujours rien avant confirmation
  await click(q(container, "sdui-confirm-run"));
  const [url, body] = api.post.mock.calls[1];
  expect(url).toBe("/admin/games/example_game/aluu-mapping/apply");
  expect(body).toEqual({ apply: [{ product_id: "PRODUCT-0001", denom: "000" }] });
  // 200 → recharger par GET puis vider l'aperçu
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(q(container, "sdui-row-preview-PRODUCT-0001")).toBeNull();
  expectAllPathsAdmin();
  await act(async () => root.unmount());
});

test("apply : décocher la dernière ligne proposed désactive le bouton", async () => {
  const { container, root } = await mountMappingWithPreview();
  expect(q(container, "sdui-button-apply").disabled).toBe(false);
  await click(q(container, "sdui-checkbox-PRODUCT-0001"));
  expect(q(container, "sdui-button-apply").disabled).toBe(true);
  await click(q(container, "sdui-button-apply")); // sans effet
  expect(api.post.mock.calls.filter((c) => String(c[0]).endsWith("/apply"))).toHaveLength(0);
  await act(async () => root.unmount());
});

test("apply : désactivé avant tout aperçu — et une table du même key ne le réactive pas", async () => {
  api.get.mockResolvedValue({ data: mappingFixture });
  const { container, root } = await mount(<AdminSduiScreen screen="mapping" gameId={GAME} />);
  // bouton apply (key « apply ») et table products : aucune ligne proposée chargée
  expect(q(container, "sdui-button-apply").disabled).toBe(true);
  await act(async () => root.unmount());
});

// ——— Erreurs (code seul ; detail JAMAIS affiché ; écran inchangé) ———————————

const ERR = {
  known: { response: { status: 400, data: { code: "invalid_game_code", detail: "TECHNICAL_DETAIL" } } },
  unknownCode: { response: { status: 400, data: { code: "brand_new_code", detail: "TECHNICAL_DETAIL" } } },
  network: new Error("network down"),
  auth403: { response: { status: 403, data: { detail: "Not authenticated" } } },
  stale: { response: { status: 409, data: { code: "mapping_stale", detail: "TECHNICAL_DETAIL" } } },
};

test("erreur d'action : code connu traduit, detail jamais affiché, écran inchangé", async () => {
  api.get.mockResolvedValue({ data: providerFixture });
  api.put.mockRejectedValueOnce(ERR.known);
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  await click(q(container, "sdui-button-save_config"));
  await click(q(container, "sdui-confirm-run"));
  const banner = q(container, "sdui-action-error");
  expect(banner.getAttribute("role")).toBe("alert");
  expect(banner.textContent).toContain("Code jeu invalide (lettres, chiffres, tiret et souligné uniquement).");
  expect(container.textContent).not.toContain("TECHNICAL_DETAIL");
  expect(container.querySelector("h1").textContent).toBe("Fournisseur du jeu"); // écran inchangé
  await act(async () => root.unmount());
});

test.each([
  ["code inconnu", ERR.unknownCode, "Erreur inattendue. Réessayez."],
  ["réseau", ERR.network, "Erreur inattendue. Réessayez."],
  ["403 sans code", ERR.auth403, "Vous n'avez pas la permission requise."],
])("erreur : %s → message du code ou errors.unknown, jamais le detail", async (_name, err, expected) => {
  api.get.mockResolvedValue({ data: providerFixture });
  api.put.mockRejectedValueOnce(err);
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  await click(q(container, "sdui-button-save_config"));
  await click(q(container, "sdui-confirm-run"));
  expect(q(container, "sdui-action-error").textContent).toContain(expected);
  expect(container.textContent).not.toContain("TECHNICAL_DETAIL");
  expect(container.textContent).not.toContain("brand_new_code");
  await act(async () => root.unmount());
});

test("409 mapping_stale : l'aperçu reste en place, message du code invite à relancer", async () => {
  const { container, root } = await mountMappingWithPreview();
  api.post.mockRejectedValueOnce(ERR.stale); // l'apply POST lui-même est rejeté
  await click(q(container, "sdui-button-apply"));
  await click(q(container, "sdui-confirm-run"));
  expect(q(container, "sdui-action-error").textContent).toContain(
    "La sélection a changé depuis l'aperçu. Rien n'a été enregistré : relancez l'aperçu."
  );
  // l'aperçu est conservé (rien n'a été écrit)
  expect(q(container, "sdui-row-preview-PRODUCT-0001")).not.toBeNull();
  expect(q(container, "sdui-row-preview-PRODUCT-0002")).not.toBeNull();
  await act(async () => root.unmount());
});

test("erreur de GET : écran d'erreur du rendu avec le code, retry relance le GET", async () => {
  api.get.mockRejectedValueOnce(ERR.known).mockResolvedValueOnce({ data: providerFixture });
  const { container, root } = await mount(<AdminSduiScreen screen="provider" gameId={GAME} />);
  expect(q(container, "sdui-error")).not.toBeNull();
  expect(q(container, "sdui-error").textContent).toContain("Code jeu invalide (lettres, chiffres, tiret et souligné uniquement).");
  expect(container.textContent).not.toContain("TECHNICAL_DETAIL");
  await click(q(container, "sdui-error-retry"));
  expect(q(container, "sdui-screen")).not.toBeNull();
  expect(api.get).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});
