// Tests du rendu SDUI T2a. Écrans écrits dans ce fichier (pas de fixtures — T5).
// Motif du dépôt : react-dom/client createRoot + act (React 19), LanguageContext
// moqué (pas de react-router ni d'appel réseau ici — Screen ne fetch pas).

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { SduiScreen } from "./Screen";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/context/LanguageContext", () => {
  const DICT = {
    "sdui.loading": "Chargement de l'écran…",
    "sdui.error.title": "Impossible d'afficher cet écran",
    "sdui.error.retry": "Réessayer",
    "sdui.error.versionUnsupported": "Version d'écran non prise en charge. Rechargez la page.",
    "sdui.action.confirmTitle": "Confirmer l'action",
    "sdui.action.confirmBody": "Cette action modifiera la configuration du jeu. Continuer ?",
    "sdui.action.cancel": "Annuler",
    "sdui.action.run": "Exécuter",
    "sdui.action.running": "En cours…",
    "sdui.label.missing": "Libellé indisponible",
    "errors.unknown": "Erreur inattendue. Réessayez.",
    "errors.invalid_game_code": "Code jeu invalide.",
    "admin.provider.title": "Fournisseur du jeu",
    "admin.provider.intro": "Configurez la connexion fournisseur.",
    "admin.provider.save": "Enregistrer",
    "admin.provider.switch": "Changer de fournisseur",
    "sdui.test.endpoint": "Point de contrôle",
    "sdui.test.ep.game": "Game check",
    "sdui.test.ep.bgmi": "BGMI",
    "sdui.test.switchConfirm": "Confirmer la bascule du fournisseur pour ce jeu ?",
    "sdui.test.preview": "Aperçu",
    "sdui.test.apply": "Appliquer la sélection",
    "admin.aluu_mapping.apply.confirm": "Appliquer les correspondances sélectionnées ?",
    "admin.aluu_mapping.title": "Correspondance produits ↔ packs",
    "admin.aluu_mapping.empty": "Aucun produit à mapper pour ce jeu.",
    "admin.aluu_mapping.preview.empty": "Aucune proposition : rien ne peut être appliqué.",
    "admin.aluu_mapping.column.product": "Produit",
    "admin.aluu_mapping.column.price": "Prix de vente",
    "admin.aluu_mapping.column.state": "État",
    "admin.aluu_mapping.column.match": "Pack correspondant",
    "admin.aluu_mapping.column.selected": "Sélection",
    "admin.aluu_mapping.state.mapped": "Lié",
    "admin.aluu_mapping.state.unconfirmed": "À confirmer",
    "admin.aluu_mapping.state.missing": "Non lié",
    "admin.aluu_mapping.state.stale": "Pack disparu",
    "admin.aluu_mapping.state.ambiguous": "Ambigu",
    "admin.aluu_mapping.state.proposed": "Proposé",
    "admin.provider.identity.empty": "Aucun champ d'identité déclaré.",
    "sdui.test.identityField": "Player ID",
  };
  return { useLang: () => ({ t: (path) => DICT[path] ?? path, lang: "fr" }) };
});

const PROVIDER_SCREEN = {
  contract_version: "v0",
  screen: "provider",
  permissions: { can_edit: true, can_switch_provider: false, can_preview: true, can_apply: true },
  game: { id: "g1", name: "Game", provider: "aluu", provider_declared: true },
  blocks: [
    { kind: "heading", label_key: "admin.provider.title", level: 1 },
    { kind: "text", label_key: "admin.provider.intro", tone: "muted" },
    { kind: "text", label_key: "admin.provider.undeclared_hint", tone: "warning", visible_when: { provider_declared: false } },
    {
      kind: "select",
      key: "aluu_check_endpoint",
      label_key: "sdui.test.endpoint",
      value: "game-check",
      options: [
        { value: "game-check", label_key: "sdui.test.ep.game" },
        { value: "bgmi", label_key: "sdui.test.ep.bgmi" },
      ],
    },
    { kind: "toggle", key: "hidden", label_key: "x", value: true }, // connu, non rendu (Q9)
    { kind: "carousel", items: [] }, // kind inconnu : ignoré
    {
      kind: "button",
      key: "save",
      label_key: "admin.provider.save",
      action: "put_config",
      variant: "primary",
      requires: ["permissions.can_edit"],
    },
    {
      kind: "button",
      key: "switch",
      label_key: "admin.provider.switch",
      action: "put_game_provider",
      variant: "danger",
      requires: ["permissions.can_switch_provider"],
      confirm_key: "sdui.test.switchConfirm",
    },
    {
      kind: "button",
      key: "preview",
      label_key: "sdui.test.preview",
      action: "mapping_preview",
      variant: "secondary",
      requires: ["permissions.can_preview"],
    },
  ],
};

const MAPPING_SCREEN = {
  contract_version: "v0",
  screen: "mapping",
  permissions: { can_edit: false, can_preview: true, can_apply: true },
  game: { id: "example_game", name: "Example Game", provider: "aluu" },
  blocks: [
    { kind: "heading", label_key: "admin.aluu_mapping.title", level: 1 },
    {
      kind: "table",
      key: "products",
      empty_key: "admin.aluu_mapping.empty",
      columns: [
        { key: "name", label_key: "admin.aluu_mapping.column.product", format: "text" },
        { key: "price", label_key: "admin.aluu_mapping.column.price", format: "money" },
        { key: "state", label_key: "admin.aluu_mapping.column.state", format: "state" },
        { key: "match", label_key: "admin.aluu_mapping.column.match", format: "pack" },
      ],
      rows: [
        {
          product_id: "PRODUCT-0001",
          name: "Example Pack 0001",
          price: 5000,
          state: "mapped",
          match: { denom: "000", offer_name: "Example Pack 0001", price_usd: "0.0000" },
        },
        { product_id: "PRODUCT-0003", name: "Example Pack 0003", price: 15000, state: "stale", match: null },
      ],
    },
    {
      kind: "button",
      key: "preview",
      label_key: "sdui.test.preview",
      action: "mapping_preview",
      variant: "secondary",
      requires: ["permissions.can_preview"],
    },
    {
      kind: "table",
      key: "preview",
      empty_key: "admin.aluu_mapping.preview.empty",
      columns: [
        { key: "selected", label_key: "admin.aluu_mapping.column.selected", format: "checkbox" },
        { key: "product_id", label_key: "admin.aluu_mapping.column.product", format: "text" },
        { key: "state", label_key: "admin.aluu_mapping.column.state", format: "state" },
        { key: "match", label_key: "admin.aluu_mapping.column.match", format: "pack" },
      ],
      rows: [
        {
          product_id: "PRODUCT-0001",
          state: "proposed",
          match: { denom: "000", offer_name: "Example Pack 0001", price_usd: "0.0000" },
          selected: true,
        },
        {
          product_id: "PRODUCT-0002",
          state: "ambiguous",
          match: null,
          selected: false,
          candidates: [{ denom: "000", offer_name: "Example Pack 0002 (bonus)", price_usd: "0.0000" }],
        },
        { product_id: "PRODUCT-0003", state: "missing", match: null, selected: false },
      ],
    },
    {
      kind: "button",
      key: "apply",
      label_key: "sdui.test.apply",
      action: "mapping_apply",
      variant: "primary",
      requires: ["permissions.can_apply"],
      confirm_key: "admin.aluu_mapping.apply.confirm",
    },
  ],
};

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

const click = (el) => act(async () => el.click());
const q = (container, testid) => container.querySelector(`[data-testid="${testid}"]`);

afterEach(() => {
  document.body.innerHTML = "";
});

// ——— États hors rendu ——————————————————————————————————————————————————————

test("chargement : état dédié, aucun block rendu", async () => {
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} loading />);
  expect(q(container, "sdui-loading")).not.toBeNull();
  expect(q(container, "sdui-screen")).toBeNull();
  await act(async () => root.unmount());
});

test("erreur : role=alert, libellé du code traduit, JAMAIS le detail", async () => {
  const { container, root } = await mount(
    <SduiScreen raw={null} error={{ code: "invalid_game_code", detail: "MONGO_URI=mongodb://secret" }} />
  );
  const alert = q(container, "sdui-error");
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.textContent).toContain("Code jeu invalide.");
  expect(alert.textContent).not.toContain("MONGO_URI"); // detail jamais affiché
  await act(async () => root.unmount());
});

test("erreur de code inconnu → errors.unknown, jamais un chemin brut", async () => {
  const { container, root } = await mount(
    <SduiScreen raw={null} error={{ code: "some_future_code", detail: "trace" }} />
  );
  const alert = q(container, "sdui-error");
  expect(alert.textContent).toContain("Erreur inattendue. Réessayez.");
  expect(alert.textContent).not.toContain("errors.some_future_code");
  await act(async () => root.unmount());
});

test("erreur avec onRetry : le bouton Réessayer déclenche onRetry", async () => {
  const onRetry = jest.fn();
  const { container, root } = await mount(<SduiScreen raw={null} error={{ code: "provider_timeout" }} onRetry={onRetry} />);
  await click(q(container, "sdui-error-retry"));
  expect(onRetry).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

test("version non prise en charge (Q7) : écran d'erreur, aucun block, aucun appel", async () => {
  const onRun = jest.fn();
  const { container, root } = await mount(
    <SduiScreen raw={{ ...PROVIDER_SCREEN, contract_version: "v1" }} onRun={onRun} />
  );
  expect(q(container, "sdui-version")).not.toBeNull();
  expect(q(container, "sdui-version").getAttribute("role")).toBe("alert");
  expect(q(container, "sdui-button-save")).toBeNull();
  await act(async () => root.unmount());
});

test.each([null, undefined, "corrompu", 42])(
  "écran cru %s (pas un objet) : rendu vide sans exception",
  async (raw) => {
    const { container, root } = await mount(<SduiScreen raw={raw} />);
    expect(q(container, "sdui-loading")).toBeNull();
    expect(q(container, "sdui-error")).toBeNull();
    expect(q(container, "sdui-version")).not.toBeNull(); // version absente → fail-closed
    await act(async () => root.unmount());
  }
);

// ——— Rendu des briques —————————————————————————————————————————————————————

test("heading h1 traduit, text muted ; warning masqué par visible_when (game.provider_declared: true)", async () => {
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} />);
  expect(q(container, "sdui-heading-1").textContent).toBe("Fournisseur du jeu");
  expect(q(container, "sdui-screen").textContent).toContain("Configurez la connexion fournisseur.");
  expect(container.textContent).not.toContain("admin.provider.undeclared_hint");
  expect(q(container, "sdui-screen").querySelectorAll('[data-testid="sdui-text"]').length).toBe(1);
  await act(async () => root.unmount());
});

test("visible_when rempli (provider_declared: false) → le bloc warning apparaît avec l'icône d'alerte", async () => {
  const raw = {
    ...PROVIDER_SCREEN,
    game: { ...PROVIDER_SCREEN.game, provider_declared: false },
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const texts = q(container, "sdui-screen").querySelectorAll('[data-testid="sdui-text"]');
  expect(texts.length).toBe(2);
  const warning = [...texts].find((p) => p.querySelector("svg"));
  expect(warning).not.toBeNull(); // icône (lucide), jamais un emoji
  await act(async () => root.unmount());
});

test("toggle et kind inconnu ignorés sans casser l'écran (Q9) — le reste est rendu", async () => {
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} />);
  expect(container.textContent).not.toContain("hidden");
  expect(container.querySelector("input[type=checkbox]")).toBeNull();
  expect(q(container, "sdui-button-save")).not.toBeNull(); // le reste de l'écran vit
  await act(async () => root.unmount());
});

test("label_key manquante → repli sdui.label.missing, jamais un chemin brut", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    blocks: [{ kind: "heading", label_key: "does.not.exist", level: 2 }],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const heading = container.querySelector("h2");
  expect(heading.textContent).toBe("Libellé indisponible");
  expect(heading.textContent).not.toBe("does.not.exist");
  await act(async () => root.unmount());
});

// ——— select ————————————————————————————————————————————————————————————————

test("select : options traduites (label_key ou label du catalogue live), valeur contrôlée", async () => {
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} />);
  const select = q(container, "sdui-select-aluu_check_endpoint").querySelector("select");
  expect(select.disabled).toBe(false);
  expect([...select.options].map((o) => o.textContent)).toEqual(["Game check", "BGMI"]);
  expect(select.value).toBe("game-check");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, "bgmi");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(select.value).toBe("bgmi");
  await act(async () => root.unmount());
});

test("can_edit=false (Q12) ou block.disabled → select désactivé, jamais éditable", async () => {
  const readonly = {
    contract_version: "v0",
    game: {},
    permissions: { can_edit: false },
    blocks: [
      { kind: "select", key: "a", label_key: "sdui.test.endpoint", value: "game-check", options: [{ value: "game-check" }] },
      { kind: "select", key: "b", label_key: "sdui.test.endpoint", disabled: true, options: [{ value: "game-check" }] },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={readonly} />);
  expect(q(container, "sdui-select-a").querySelector("select").disabled).toBe(true);
  expect(q(container, "sdui-select-b").querySelector("select").disabled).toBe(true);
  await act(async () => root.unmount());
});

test("select sans options → select vide désactivé avec placeholder, jamais un champ libre (README §2.2)", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    permissions: { can_edit: true },
    blocks: [{ kind: "select", key: "code", label_key: "sdui.test.endpoint", placeholder_key: "sdui.test.endpoint", options: [] }],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const select = q(container, "sdui-select-code").querySelector("select");
  expect(select.disabled).toBe(true);
  expect(select.options.length).toBe(1); // placeholder seul, jamais d'input libre
  expect(container.querySelector("input")).toBeNull();
  await act(async () => root.unmount());
});

// ——— button : requires, variantes, double clic ——————————————————————————————

test("requires satisfait → actif ; can_switch_provider=false → désactivé ; clic désactivé → onRun JAMAIS appelé", async () => {
  const onRun = jest.fn(() => Promise.resolve());
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} onRun={onRun} />);

  const save = q(container, "sdui-button-save");
  expect(save.disabled).toBe(false); // can_edit: true

  const switchBtn = q(container, "sdui-button-switch");
  expect(switchBtn.disabled).toBe(true); // can_switch_provider: false → fail-closed
  await click(switchBtn);
  expect(onRun).not.toHaveBeenCalled();
  expect(q(container, "sdui-confirm")).toBeNull(); // pas de dialogue non plus
  await act(async () => root.unmount());
});

test("variantes : danger → destructive (jeton), inconnue → primary ; rien ne sort des jetons", async () => {
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} />);
  expect(q(container, "sdui-button-switch").className).toContain("bg-destructive");
  expect(q(container, "sdui-button-save").className).toContain("bg-primary");
  await act(async () => root.unmount());
});

test("écriture : confirmation d'abord — annuler n'appelle JAMAIS onRun, confirmer l'appelle", async () => {
  const onRun = jest.fn(() => Promise.resolve());
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} onRun={onRun} />);

  await click(q(container, "sdui-button-save")); // put_config, sans confirm_key
  const dialog = q(container, "sdui-confirm");
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("Cette action modifiera la configuration du jeu. Continuer ?"); // confirmBody par défaut (Q3)
  expect(onRun).not.toHaveBeenCalled(); // rien n'est parti avant confirmation

  await click(q(container, "sdui-confirm-cancel"));
  expect(q(container, "sdui-confirm")).toBeNull();
  expect(onRun).not.toHaveBeenCalled();

  await click(q(container, "sdui-button-save"));
  await click(q(container, "sdui-confirm-run"));
  expect(onRun).toHaveBeenCalledWith("put_config", expect.objectContaining({ key: "save" }));
  expect(q(container, "sdui-confirm")).toBeNull();
  await act(async () => root.unmount());
});

test("confirm_key du bloc sert de texte au dialogue (put_game_provider)", async () => {
  const onRun = jest.fn(() => Promise.resolve());
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} onRun={onRun} />);
  await click(q(container, "sdui-button-save"));
  await click(q(container, "sdui-confirm-cancel"));
  await click(q(container, "sdui-button-switch")); // désactivé (requires) → pas de dialogue
  expect(q(container, "sdui-confirm")).toBeNull();
  await act(async () => root.unmount());
});

test("confirm_key résolue apparaît dans le dialogue", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    permissions: { can_edit: true, can_switch_provider: true },
    blocks: [
      {
        kind: "button",
        key: "switch",
        label_key: "admin.provider.switch",
        action: "put_game_provider",
        variant: "danger",
        requires: ["permissions.can_switch_provider"],
        confirm_key: "sdui.test.switchConfirm",
      },
    ],
  };
  const onRun = jest.fn(() => Promise.resolve());
  const { container, root } = await mount(<SduiScreen raw={raw} onRun={onRun} />);
  await click(q(container, "sdui-button-switch"));
  expect(q(container, "sdui-confirm").textContent).toContain("Confirmer la bascule du fournisseur pour ce jeu ?");
  await act(async () => root.unmount());
});

test("mapping_preview (POST en lecture seule) s'exécute SANS confirmation", async () => {
  const onRun = jest.fn(() => Promise.resolve());
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} onRun={onRun} />);
  await click(q(container, "sdui-button-preview"));
  expect(q(container, "sdui-confirm")).toBeNull();
  expect(onRun).toHaveBeenCalledWith("mapping_preview", expect.objectContaining({ key: "preview" }));
  await act(async () => root.unmount());
});

test("double clic impossible : boutons désactivés pendant l'appel, réactivés après", async () => {
  let resolveRun;
  const onRun = jest.fn(() => new Promise((resolve) => { resolveRun = resolve; }));
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} onRun={onRun} />);

  await click(q(container, "sdui-button-preview"));
  expect(onRun).toHaveBeenCalledTimes(1);
  const save = q(container, "sdui-button-save");
  const preview = q(container, "sdui-button-preview");
  expect(preview.disabled).toBe(true); // pendant l'appel
  expect(save.disabled).toBe(true); // tous les boutons sont verrouillés

  await click(save); // clic pendant l'appel : ignoré
  expect(onRun).toHaveBeenCalledTimes(1);

  await act(async () => resolveRun());
  expect(preview.disabled).toBe(false); // l'appel est fini : réactivés
  expect(save.disabled).toBe(false);
  await act(async () => root.unmount());
});

test("échec de l'appel : les boutons se réactivent quand même (finally)", async () => {
  const onRun = jest.fn(() => Promise.reject(new Error("network")));
  const { container, root } = await mount(<SduiScreen raw={PROVIDER_SCREEN} onRun={onRun} />);
  await click(q(container, "sdui-button-preview"));
  await act(async () => {}); // laisse le finally s'exécuter
  expect(q(container, "sdui-button-preview").disabled).toBe(false);
  await act(async () => root.unmount());
});

// ——— table (T2b) ————————————————————————————————————————————————————————————
//
// NOTE Q9 : depuis la révision BE-004 du contrat, `toggle` n'existe plus — le
// moteur le retire comme tout kind inconnu ; le test « toggle et kind inconnu »
// ci-dessus vérifie toujours que l'écran survit à un bloc non rendu.

test("table : formats de la liste fermée — money Ar, état en badge, pack avec price_usd intact", async () => {
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} />);
  const products = q(container, "sdui-table-products");
  expect(products).not.toBeNull();

  const headers = products.querySelectorAll("th[scope=col]");
  expect([...headers].map((th) => th.textContent)).toEqual(["Produit", "Prix de vente", "État", "Pack correspondant"]);

  const row1 = q(container, "sdui-row-products-PRODUCT-0001");
  expect(row1.textContent).toContain("Example Pack 0001");
  expect(row1.textContent).toMatch(/^.*5[\s\u00A0\u202F]000 Ar.*$/); // formatAr de l'app
  expect(row1.textContent).toContain("Example Pack 0001 (000) · 0.0000 USD"); // price_usd jamais converti

  const badges = row1.querySelectorAll('[data-testid="sdui-state-badge"]');
  expect(badges).toHaveLength(1);
  expect(badges[0].textContent).toBe("Lié"); // texte porte le sens, jamais la couleur seule

  const row3 = q(container, "sdui-row-products-PRODUCT-0003");
  expect(row3.querySelectorAll('[data-testid="sdui-state-badge"]')[0].textContent).toBe("Pack disparu");
  expect(row3.textContent).toContain("—"); // match null → « — » (décision FE-003)
  await act(async () => root.unmount());
});

test("table vide : empty_key traduite, jamais un chemin brut", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    blocks: [
      { kind: "table", key: "preview", empty_key: "admin.aluu_mapping.preview.empty", columns: [{ key: "state", label_key: "admin.aluu_mapping.column.state", format: "state" }] },
      { kind: "table", key: "broken", empty_key: "does.not.exist", columns: [{ key: "a", label_key: "x", format: "text" }] },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  expect(q(container, "sdui-table-preview-empty").textContent).toBe("Aucune proposition : rien ne peut être appliqué.");
  expect(q(container, "sdui-table-broken-empty").textContent).toBe("Libellé indisponible"); // jamais does.not.exist
  await act(async () => root.unmount());
});

test("conteneur de table : défilement horizontal avec tabIndex=0", async () => {
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} />);
  const wrapper = q(container, "sdui-table-products");
  expect(wrapper.getAttribute("tabindex")).toBe("0");
  await act(async () => root.unmount());
});

test("colonne checkbox : seules les proposed sont cochables ; ambiguous/missing désactivées", async () => {
  const onSelect = jest.fn();
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} onSelect={onSelect} />);
  const proposed = q(container, "sdui-checkbox-PRODUCT-0001");
  expect(proposed.disabled).toBe(false);
  expect(proposed.checked).toBe(true); // row.selected === true de l'aperçu

  const ambiguous = q(container, "sdui-checkbox-PRODUCT-0002");
  const missing = q(container, "sdui-checkbox-PRODUCT-0003");
  expect(ambiguous.disabled).toBe(true);
  expect(missing.disabled).toBe(true);

  await click(ambiguous); // ligne non proposed : onSelect JAMAIS appelé
  await click(missing);
  expect(onSelect).not.toHaveBeenCalled();

  await click(proposed); // décocher une ligne proposée est permis (§5)
  expect(onSelect).toHaveBeenCalledWith("preview", "PRODUCT-0001", false);
  await act(async () => root.unmount());
});

test("selection[tableKey][rowId] est prioritaire sur row.selected ; forcée à false pour non proposed", async () => {
  const onSelect = jest.fn();
  const selection = { preview: { "PRODUCT-0001": false, "PRODUCT-0002": true } };
  const { container, root } = await mount(
    <SduiScreen raw={MAPPING_SCREEN} selection={selection} onSelect={onSelect} />
  );
  expect(q(container, "sdui-checkbox-PRODUCT-0001").checked).toBe(false); // décochée par l'écran
  expect(q(container, "sdui-checkbox-PRODUCT-0002").checked).toBe(false); // ambiguous : JAMAIS cochée
  await click(q(container, "sdui-checkbox-PRODUCT-0002"));
  expect(onSelect).not.toHaveBeenCalled(); // disabled → aucun changement
  await act(async () => root.unmount());
});

test("busy : cases à cocher et boutons désactivés pendant une opération du parent", async () => {
  const onSelect = jest.fn();
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} busy onSelect={onSelect} />);
  expect(q(container, "sdui-checkbox-PRODUCT-0001").disabled).toBe(true);
  expect(q(container, "sdui-button-preview").disabled).toBe(true);
  await click(q(container, "sdui-checkbox-PRODUCT-0001"));
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test("rowsByKey remplace le contenu de la table (README §3.6 : l'aperçu remplace la table preview)", async () => {
  const rowsByKey = {
    preview: [
      { product_id: "PRODUCT-0009", state: "proposed", match: { denom: "009", offer_name: "New Pack", price_usd: "1.0000" }, selected: false },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} rowsByKey={rowsByKey} />);
  expect(q(container, "sdui-row-preview-PRODUCT-0009")).not.toBeNull();
  expect(q(container, "sdui-row-preview-PRODUCT-0001")).toBeNull(); // ancien contenu remplacé
  expect(q(container, "sdui-checkbox-PRODUCT-0009").checked).toBe(false);
  await act(async () => root.unmount());
});

test("candidates d'une ligne ambiguous : JAMAIS rendus (aucune clé i18n du contrat)", async () => {
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} />);
  expect(container.textContent).not.toContain("Example Pack 0002 (bonus)");
  await act(async () => root.unmount());
});

test("table mal formée (colonnes/rows absents) : rendu vide sans exception", async () => {
  const raw = { contract_version: "v0", game: {}, blocks: [{ kind: "table", key: "x" }] };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  expect(q(container, "sdui-table-x-empty")).not.toBeNull(); // pas de empty_key → repli
  expect(q(container, "sdui-table-x-empty").textContent).toBe("Libellé indisponible");
  await act(async () => root.unmount());
});

// ——— select : valeur null / absente des options ————————————————————————————

test("select value null sans placeholder_key → option vide sélectionnée (délier un champ, §3.1)", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    permissions: { can_edit: true },
    blocks: [
      {
        kind: "select",
        key: "aluu_identity_map.server_id",
        label_key: null,
        label: "Server ID",
        value: null,
        options: [{ value: "server_code", label_key: null, label: "server_code" }],
      },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const select = q(container, "sdui-select-aluu_identity_map.server_id").querySelector("select");
  expect(select.value).toBe(""); // option vide sélectionnée
  expect(select.options[0].textContent).toBe(""); // option réellement vide, jamais un chemin
  expect(select.disabled).toBe(false); // vider le select délie le champ

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, "server_code");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(select.value).toBe("server_code");
  await act(async () => root.unmount());
});

test("select dont la valeur est absente des options (catalogue périmé) → traitée comme vide", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    permissions: { can_edit: true },
    blocks: [
      {
        kind: "select",
        key: "aluu_game_code",
        label_key: "admin.provider.field.game_code",
        value: "ancien_code",
        options: [{ value: "example_game", label_key: null, label: "Example Game" }],
      },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const select = q(container, "sdui-select-aluu_game_code").querySelector("select");
  expect(select.value).toBe(""); // valeur inconnue des options → vide
  await act(async () => root.unmount());
});

// ——— Nom accessible des tableaux (FE-005, commit 2) ————————————————————————

test("table : nommée par le heading qui précède (aria-labelledby), jamais par la clé brute", async () => {
  const { container, root } = await mount(<SduiScreen raw={MAPPING_SCREEN} />);
  const table = q(container, "sdui-table-products");
  expect(table.getAttribute("aria-label")).toBeNull(); // plus jamais la clé du bloc
  const labelledBy = table.getAttribute("aria-labelledby");
  expect(labelledBy).toBeTruthy();
  // le heading level 1 (titre de l'écran) précède la table : son id la nomme
  const heading = q(container, "sdui-heading-1");
  expect(heading.getAttribute("id")).toBe(labelledBy);
  expect(heading.textContent).toBe("Correspondance produits ↔ packs");
  await act(async () => root.unmount());
});

test("table sans heading précédent : aucun nom, ni aria-label ni aria-labelledby", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    blocks: [
      { kind: "table", key: "x", empty_key: "common.empty", columns: [{ key: "a", label_key: "x", format: "text" }] },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const table = q(container, "sdui-table-x");
  expect(table.getAttribute("aria-label")).toBeNull();
  expect(table.getAttribute("aria-labelledby")).toBeNull();
  await act(async () => root.unmount());
});

test("deux tableaux : chacun est nommé par le heading qui le précède (le plus proche)", async () => {
  const raw = {
    contract_version: "v0",
    game: {},
    blocks: [
      { kind: "heading", label_key: "admin.provider.section.connection", level: 2 },
      { kind: "table", key: "t1", empty_key: "common.empty", columns: [{ key: "a", label_key: "x", format: "text" }] },
      { kind: "heading", label_key: "admin.provider.section.game", level: 2 },
      { kind: "table", key: "t2", empty_key: "common.empty", columns: [{ key: "a", label_key: "x", format: "text" }] },
    ],
  };
  const { container, root } = await mount(<SduiScreen raw={raw} />);
  const headings = container.querySelectorAll("h2");
  const t1 = q(container, "sdui-table-t1");
  const t2 = q(container, "sdui-table-t2");
  expect(t1.getAttribute("aria-labelledby")).toBe(headings[0].getAttribute("id"));
  expect(t2.getAttribute("aria-labelledby")).toBe(headings[1].getAttribute("id"));
  expect(t1.getAttribute("aria-labelledby")).not.toBe(t2.getAttribute("aria-labelledby"));
  await act(async () => root.unmount());
});
