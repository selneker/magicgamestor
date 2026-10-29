// Tests de sécurité du moteur SDUI (contrat v0, écran = liste de blocks, actions
// NOMMÉES). Les écrans de test sont écrits dans ce fichier : les fixtures du contrat
// seront copiées en T5 (dossier src/sdui/__fixtures__/). Le t() imite le repli réel
// de LanguageContext.js (t(path) renvoie path lui-même si la traduction manque).

import {
  ACTION_ROUTES,
  parseScreen,
  isAllowedAction,
  getActionRoute,
  requestFor,
  confirmNeeded,
  confirmText,
  requirementsSatisfied,
  versionSupported,
  label,
  isFieldVisible,
  visibleBlocks,
  isRowSelectable,
  rowId,
  buildApplyPayload,
  buildConfigPayload,
  payloadFor,
  cellText,
  cellCandidates,
  formatCell,
  errorLabel,
} from "./engine";
// Le moteur recopie le formateur de prix de l'app (pur, sans import réseau) ;
// ce test croisé garantit qu'aucune divergence ne s'installe.
import { formatAr } from "@/lib/api";

// t() minimal fidèle au comportement réel : renvoie la clé si la traduction manque.
const DICT = {
  "sdui.label.missing": "Libellé indisponible",
  "sdui.action.confirmBody": "Cette action modifiera la configuration du jeu. Continuer ?",
  "admin.provider.title": "Fournisseur",
  "admin.provider.connection.configured": "Configuré",
  "admin.provider.connection.not_configured": "Non configuré",
  "admin.aluu_mapping.apply.confirm": "Appliquer les correspondances sélectionnées ?",
  "admin.aluu_mapping.state.mapped": "Lié",
  "admin.aluu_mapping.state.unconfirmed": "À confirmer",
  "admin.aluu_mapping.state.missing": "Non lié",
  "admin.aluu_mapping.state.stale": "Pack disparu",
  "admin.aluu_mapping.state.ambiguous": "Ambigu",
  "admin.aluu_mapping.state.proposed": "Proposé",
  "errors.unknown": "Erreur inattendue. Réessayez.",
  "errors.game_code_not_in_catalog": "Ce code jeu n'existe pas dans le catalogue ALUU.",
};
const t = (path) => DICT[path] ?? path;

// ——— Liste blanche (garde-fou d'ACTION_ROUTES) —————————————————————————————

describe("isAllowedAction — liste blanche stricte", () => {
  test.each(["GET", "PUT", "POST"])("%s sous /api/admin/ est autorisé", (method) => {
    expect(isAllowedAction({ method, path: "/api/admin/games/g1/provider" })).toBe(true);
  });

  test("DELETE est refusé, même sous /api/admin/", () => {
    expect(isAllowedAction({ method: "DELETE", path: "/api/admin/games/g1/provider" })).toBe(false);
  });

  test.each([
    ["chemin hors admin", { method: "GET", path: "/api/public/games" }],
    ["chemin sans /api", { method: "GET", path: "/admin/games" }],
    ["chemin relatif", { method: "GET", path: "api/admin/games" }],
    ["préfixe trompeur", { method: "GET", path: "/api/adminX/games" }],
    ["méthode manquante", { path: "/api/admin/games" }],
    ["méthode non string", { method: 200, path: "/api/admin/games" }],
    ["chemin non string", { method: "GET", path: 42 }],
    ["action null", null],
    ["action non objet", "GET"],
  ])("%s est refusé", (_name, action) => {
    expect(isAllowedAction(action)).toBe(false);
  });
});

describe("ACTION_ROUTES — table d'actions nommées du frontend", () => {
  test("chaque entrée de la table passe la liste blanche (garde-fou à l'import)", () => {
    for (const [name, route] of Object.entries(ACTION_ROUTES)) {
      expect(`${name}: ${isAllowedAction(route)}`).toBe(`${name}: true`);
    }
  });

  test("la table est gelée : aucune entrée ne peut être ajoutée ni remplacée", () => {
    expect(Object.isFrozen(ACTION_ROUTES)).toBe(true);
  });

  test("noms d'action v0 = 6 routes, dont 3 écritures et mapping_preview non confirmé", () => {
    expect(Object.keys(ACTION_ROUTES).sort()).toEqual([
      "get_mapping_screen",
      "get_provider_screen",
      "mapping_apply",
      "mapping_preview",
      "put_config",
      "put_game_provider",
    ]);
  });

  // README §3, tableau des routes : méthode et chemin (préfixe /api retiré par
  // requestFor). Tout écart entre la table et le contrat ferait échouer ce test.
  test.each([
    ["get_provider_screen", "GET", "/api/admin/games/:gameId/provider"],
    ["put_config", "PUT", "/api/admin/games/:gameId/provider/config"],
    ["put_game_provider", "PUT", "/api/admin/games/:gameId/provider"],
    ["get_mapping_screen", "GET", "/api/admin/games/:gameId/aluu-mapping"],
    ["mapping_preview", "POST", "/api/admin/games/:gameId/aluu-mapping/preview"],
    ["mapping_apply", "POST", "/api/admin/games/:gameId/aluu-mapping/apply"],
  ])("%s : méthode et chemin alignés sur le README §3", (name, method, path) => {
    expect(ACTION_ROUTES[name]).toEqual(expect.objectContaining({ method, path }));
  });

  test.each([
    ["nom inconnu", "delete_everything"],
    ["non string", 42],
    ["prototype pollué", "__proto__"],
    ["constructor", "constructor"],
    ["vide", ""],
  ])("getActionRoute %s → null (fail-closed)", (_name, action) => {
    expect(getActionRoute(action)).toBeNull();
  });
});

// ——— requestFor : routes nommées, préfixe /api, encodage du gameId ————————

describe("requestFor — le serveur ne fournit jamais le chemin", () => {
  test("put_config : le préfixe /api est retiré, sinon baseURL le redoublerait en 404 silencieux", () => {
    expect(requestFor("put_config", "g1", { aluu_game_code: "x" })).toEqual({
      method: "PUT",
      url: "/admin/games/g1/provider/config",
      data: { aluu_game_code: "x" },
    });
  });

  test("mapping_apply : POST nommé résolu depuis la table", () => {
    const req = requestFor("mapping_apply", "g1", { apply: [] });
    expect(req).toEqual({ method: "POST", url: "/admin/games/g1/aluu-mapping/apply", data: { apply: [] } });
  });

  test("nom d'action inconnu → null (jamais de requête)", () => {
    expect(requestFor("delete_everything", "g1")).toBeNull();
    expect(requestFor(undefined, "g1")).toBeNull();
    expect(requestFor({ method: "PUT", path: "/api/admin/x" }, "g1")).toBeNull(); // un objet ne fait pas un nom
  });

  test.each([
    ["manquant", undefined],
    ["vide", ""],
    ["non string", 42],
  ])("gameId %s → null", (_name, gameId) => {
    expect(requestFor("put_config", gameId)).toBeNull();
  });

  test("gameId hostile : encodé, la route ne peut pas être détournée", () => {
    const req = requestFor("put_config", "../../other/route");
    expect(req.url).toBe("/admin/games/..%2F..%2Fother%2Froute/provider/config");
    expect(req.url.split("/")).toHaveLength(6); // même profondeur qu'un gameId sain
  });

  test("payload copié en profondeur : la source n'est jamais mutée", () => {
    const payload = { apply: [{ product_id: "p1", denom: "000" }] };
    const req = requestFor("mapping_apply", "g1", payload);
    req.data.apply[0].denom = "corrompu";
    expect(payload.apply[0].denom).toBe("000");
    expect(requestFor("mapping_apply", "g1", payload).data.apply[0].denom).toBe("000");
  });

  test("GET : la charge éventuelle est ignorée, pas de clé data", () => {
    expect(requestFor("get_provider_screen", "g1", { malicious: true })).toEqual({
      method: "GET",
      url: "/admin/games/g1/provider",
    });
  });

  test("mapping_preview est bien un POST à URL dérivé de la table (et jamais confirmé)", () => {
    expect(requestFor("mapping_preview", "g1", {})).toEqual({
      method: "POST",
      url: "/admin/games/g1/aluu-mapping/preview",
      data: {},
    });
  });
});

// ——— Confirmation (Q3) ————————————————————————————————————————————————————

describe("confirmNeeded — confirmation avant toute écriture, jamais pour le POST lecture seule", () => {
  test.each([
    ["put_config", true],
    ["put_game_provider", true],
    ["mapping_apply", true],
    ["mapping_preview", false], // POST en lecture seule : pas de confirmation
    ["get_provider_screen", false],
    ["action_inconnue", false],
  ])("%s → %s", (name, expected) => {
    expect(confirmNeeded(name)).toBe(expected);
  });
});

describe("confirmText — confirm_key sinon texte par défaut, jamais un chemin brut", () => {
  test("confirm_key résolue → son texte", () => {
    expect(confirmText({ confirm_key: "admin.aluu_mapping.apply.confirm" }, t)).toBe(
      "Appliquer les correspondances sélectionnées ?"
    );
  });

  test("pas de confirm_key → sdui.action.confirmBody (put_config, Q3)", () => {
    expect(confirmText({}, t)).toBe("Cette action modifiera la configuration du jeu. Continuer ?");
    expect(confirmText(null, t)).toBe("Cette action modifiera la configuration du jeu. Continuer ?");
  });

  test("confirm_key non résolue → repli, jamais la clé elle-même", () => {
    const text = confirmText({ confirm_key: "does.not.exist" }, t);
    expect(text).toBe("Cette action modifiera la configuration du jeu. Continuer ?");
    expect(text).not.toBe("does.not.exist");
  });
});

// ——— requires[] → permissions.* ————————————————————————————————————————————

describe("requirementsSatisfied — fail-closed (le client n'est pas la sécurité)", () => {
  const perms = { can_edit: true, can_preview: true, can_apply: true, can_switch_provider: false };

  test("requires absent/vide → satisfait", () => {
    expect(requirementsSatisfied(undefined, perms)).toBe(true);
    expect(requirementsSatisfied(null, perms)).toBe(true);
    expect(requirementsSatisfied([], perms)).toBe(true);
  });

  test("permission accordée → satisfait", () => {
    expect(requirementsSatisfied(["permissions.can_edit"], perms)).toBe(true);
    expect(requirementsSatisfied(["permissions.can_edit", "permissions.can_apply"], perms)).toBe(true);
  });

  test("permission fausse → non satisfait (bouton désactivé, refusé serveur de toute façon)", () => {
    expect(requirementsSatisfied(["permissions.can_switch_provider"], perms)).toBe(false);
  });

  test.each([
    ["chemin inconnu", ["permissions.unknown_x"]],
    ["entrée non string", [42]],
    ["hors préfixe permissions.", ["can_edit"]],
    ["préfixe trompeur", ["permissionsX.can_edit"]],
    ["truthy mais pas true", (p) => requirementsSatisfied(["permissions.can_edit"], { ...p, can_edit: "yes" })],
  ])("%s → false (fail-closed)", (_name, req) => {
    expect(typeof req === "function" ? req(perms) : requirementsSatisfied(req, perms)).toBe(false);
  });

  test("permissions absentes avec requires[] → non satisfait", () => {
    expect(requirementsSatisfied(["permissions.can_edit"], undefined)).toBe(false);
    expect(requirementsSatisfied(["permissions.can_edit"], null)).toBe(false);
    expect(requirementsSatisfied(["permissions.can_edit"], "yes")).toBe(false);
  });

  test("requires[] illisible (non tableau) → non satisfait", () => {
    expect(requirementsSatisfied("permissions.can_edit", perms)).toBe(false);
    expect(requirementsSatisfied({}, perms)).toBe(false);
  });
});

// ——— Version du contrat (Q7) ———————————————————————————————————————————————

describe("versionSupported — fail-closed sur contract_version", () => {
  test('"v0" → true', () => {
    expect(versionSupported({ contract_version: "v0" })).toBe(true);
  });

  test.each([
    ["v1", { contract_version: "v1" }],
    ["absente", {}],
    ["non string", { contract_version: 0 }],
    ["écran null", null],
    ["non objet", "v0"],
  ])("%s → false (écran d'erreur, jamais les blocks)", (_name, raw) => {
    expect(versionSupported(raw)).toBe(false);
  });
});

// ——— parseScreen : blocks, kinds inconnus, écrans cassés ———————————————————

describe("parseScreen — blocks du contrat v0", () => {
  const SCREEN = {
    contract_version: "v0",
    screen: "provider",
    permissions: { can_edit: true },
    blocks: [
      { kind: "heading", label_key: "admin.provider.title", level: 1 },
      { kind: "text", label_key: "admin.provider.intro", tone: "muted" },
      { kind: "toggle", key: "hidden_kind", label_key: "x", value: true }, // supprimé du v0 (BE-004)
      { kind: "select", key: "provider", options: [{ value: "aluu" }, "broken-option", null] },
      { kind: "table", columns: [{ key: "name" }, 42], rows: [{ state: "mapped" }, null, "broken-row"] },
      { kind: "button", key: "save", label_key: "common.save", action: "put_config" },
      { kind: "carousel", items: [] }, // kind inconnu : ignoré, jamais rendu
      null,
      "a string block",
    ],
  };

  test("les 5 kinds du v0 passent, toggle et inconnu sont retirés avec avertissement", () => {
    const { screen, warnings } = parseScreen(SCREEN);
    expect(screen.blocks.map((b) => b.kind)).toEqual(["heading", "text", "select", "table", "button"]);
    expect(warnings).toContain("unknown_block_kind");
  });

  test("toggle n'existe plus en v0 (BE-004) : retiré comme tout kind inconnu, jamais rendu", () => {
    const { screen, warnings } = parseScreen(SCREEN);
    expect(screen.blocks.find((b) => b.kind === "toggle")).toBeUndefined();
    expect(warnings.filter((w) => w === "unknown_block_kind")).toHaveLength(2); // toggle + carousel
  });

  test("options/columns/rows normalisés en tableaux, éléments invalides retirés", () => {
    const { screen } = parseScreen(SCREEN);
    const select = screen.blocks.find((b) => b.kind === "select");
    const table = screen.blocks.find((b) => b.kind === "table");
    expect(select.options).toEqual([{ value: "aluu" }]);
    expect(table.columns).toEqual([{ key: "name" }]);
    expect(table.rows).toEqual([{ state: "mapped" }]);
  });

  test("button avec action nommée connue → aucun avertissement", () => {
    const { warnings } = parseScreen(SCREEN);
    expect(warnings).not.toContain("unknown_action_name");
  });

  test("button avec action inconnue → avertissement, block conservé (le rendu le désactive)", () => {
    const { screen, warnings } = parseScreen({
      blocks: [
        { kind: "button", key: "x", label_key: "x", action: "wipe_database" },
        { kind: "button", key: "y", label_key: "y" }, // pas d'action du tout
      ],
    });
    expect(screen.blocks).toHaveLength(2);
    expect(warnings.filter((w) => w === "unknown_action_name")).toHaveLength(2);
  });

  test("aucun chemin d'action lu dans le JSON : même un champ path/malveillant est ignoré", () => {
    const { screen } = parseScreen({
      blocks: [
        {
          kind: "button",
          key: "evil",
          label_key: "x",
          action: "mapping_apply",
          path: "/api/admin/anything",
          method: "DELETE",
        },
      ],
    });
    const button = screen.blocks[0];
    expect(button.action).toBe("mapping_apply"); // le nom seul compte, au rendu
    expect(screen.actions).toBeUndefined(); // plus de collecte d'actions serveur
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["chaîne", "screen"],
    ["nombre", 3],
  ])("écran %s → écran vide sans exception, jamais de TypeError", (_name, raw) => {
    const { screen, warnings } = parseScreen(raw);
    expect(screen.blocks).toEqual([]);
    expect(warnings).toContain("screen_not_an_object");
  });

  test("écran sans blocks → écran valide vide", () => {
    const { screen, warnings } = parseScreen({ contract_version: "v0", screen: "provider" });
    expect(screen.screen).toBe("provider");
    expect(screen.blocks).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("écran avec blocks manquants ({} dans blocks)", () => {
    const { screen, warnings } = parseScreen({ blocks: [{}] });
    expect(screen.blocks).toEqual([]);
    expect(warnings).toContain("unknown_block_kind");
  });
});

// ——— Libellés ——————————————————————————————————————————————————————————————

describe("label — jamais un chemin brut", () => {
  test("label_key manquante → repli sdui.label.missing, jamais la clé elle-même", () => {
    expect(label({ label_key: "does.not.exist" }, t)).toBe("Libellé indisponible");
    expect(label({ label_key: "does.not.exist" }, t)).not.toBe("does.not.exist");
  });

  test("label_key valide → traduction", () => {
    expect(label({ label_key: "admin.provider.title" }, t)).toBe("Fournisseur");
  });

  test("exception du contrat (§2 règle 1) : label_key null + label de donnée → label", () => {
    // libellé d'un code jeu du catalogue ALUU, d'un champ d'identité…
    expect(label({ label_key: null, label: "Example Game" }, t)).toBe("Example Game");
    expect(label({ label_key: null, label: "Player ID" }, t)).toBe("Player ID");
  });

  test("label_key non null mais non résolue → JAMAIS de repli vers node.label (une label_key cassée ne laisse pas passer un libellé arbitraire)", () => {
    expect(label({ label_key: "does.not.exist", label: "Player ID" }, t)).toBe("Libellé indisponible");
    expect(label({ label_key: "does.not.exist", label: "Player ID" }, t)).not.toBe("Player ID");
  });

  test.each([
    ["nœud null", null],
    ["nœud vide", {}],
    ["label non string", { label: 42 }],
  ])("%s → repli sdui.label.missing", (_name, node) => {
    expect(label(node, t)).toBe("Libellé indisponible");
  });
});

// ——— Visibilité conditionnelle (visible_when, format map) ——————————————————

describe("isFieldVisible — map champ → valeur attendue", () => {
  const BLOCK = { kind: "text", label_key: "admin.provider.undeclared_hint", visible_when: { provider_declared: false } };

  test("condition du contrat remplie → visible", () => {
    expect(isFieldVisible(BLOCK, { provider_declared: false })).toBe(true);
  });

  test("échantillon réel du contrat : visible_when {provider_declared: false} contre game.provider_declared", () => {
    // screen-provider.json : le bloc warning s'affiche quand le jeu n'a pas de
    // fournisseur déclaré (clé NUE, README §2 règle 5).
    const game = { id: "example_game", name: "Example Game", provider: "fazercards", provider_declared: false };
    expect(isFieldVisible(BLOCK, game)).toBe(true);
  });

  test("clé pointée « game.x » ou « permissions.x » → jamais satisfaite → bloc masqué (fail-closed)", () => {
    expect(isFieldVisible({ visible_when: { "game.provider_declared": false } }, { provider_declared: false })).toBe(false);
    expect(isFieldVisible({ visible_when: { "permissions.can_edit": true } }, { can_edit: true })).toBe(false);
  });

  test("condition non remplie → masqué", () => {
    expect(isFieldVisible(BLOCK, { provider_declared: true })).toBe(false);
    expect(isFieldVisible(BLOCK, {})).toBe(false); // champ absent du contexte
  });

  test("plusieurs entrées → ET logique", () => {
    const block = { visible_when: { a: 1, b: 2 } };
    expect(isFieldVisible(block, { a: 1, b: 2 })).toBe(true);
    expect(isFieldVisible(block, { a: 1, b: 3 })).toBe(false);
  });

  test("condition absente ou illisible → visible (fail-visible)", () => {
    expect(isFieldVisible({ kind: "text" }, {})).toBe(true);
    expect(isFieldVisible({ visible_when: "provider=aluu" }, {})).toBe(true);
    expect(isFieldVisible({ visible_when: ["provider_declared"] }, {})).toBe(true);
    expect(isFieldVisible(null, {})).toBe(true);
  });

  test("visibleBlocks filtre les blocks ; entrée non tableau → tableau vide", () => {
    const blocks = [BLOCK, { kind: "text", label_key: "x" }];
    expect(visibleBlocks(blocks, { provider_declared: false })).toHaveLength(2);
    expect(visibleBlocks(blocks, { provider_declared: true }).map((b) => b.label_key)).toEqual(["x"]);
    expect(visibleBlocks(undefined, {})).toEqual([]);
  });
});

// ——— Sélection de l'aperçu (Q10) ———————————————————————————————————————————

describe("isRowSelectable / rowId — seules les lignes proposed, identifiant obligatoire", () => {
  test.each([
    ["proposed", { state: "proposed", selected: true }, true],
    ["ambiguous même avec selected:true reçu", { state: "ambiguous", selected: true }, false],
    ["missing", { state: "missing" }, false],
    ["unconfirmed (table products)", { state: "unconfirmed" }, false],
    ["ligne cassée", null, false],
  ])("%s → %s", (_name, row, expected) => {
    expect(isRowSelectable(row)).toBe(expected);
  });

  test("rowId = product_id ?? key ; chaîne vide ou absente → null (ligne jamais interactive)", () => {
    expect(rowId({ product_id: "PRODUCT-0001" })).toBe("PRODUCT-0001");
    expect(rowId({ key: "api_key" })).toBe("api_key");
    expect(rowId({ product_id: null, key: "webhook_url" })).toBe("webhook_url"); // null → key
    expect(rowId({ product_id: "" })).toBeNull();
    expect(rowId({ key: "" })).toBeNull();
    expect(rowId({})).toBeNull();
    expect(rowId(null)).toBeNull();
  });
});

describe("buildApplyPayload — {apply: [{product_id, denom}]}, proposées cochées seulement", () => {
  const PREVIEW = [
    { product_id: "PRODUCT-0001", state: "proposed", selected: true, match: { denom: "000", offer_name: "Pack 1" } },
    { product_id: "PRODUCT-0002", state: "ambiguous", selected: false, match: null, candidates: [{ denom: "000" }] },
    { product_id: "PRODUCT-0003", state: "missing", selected: false, match: null },
    { product_id: "PRODUCT-0004", state: "proposed", selected: false, match: { denom: "001" } },
  ];

  test("sans map de sélection : repli sur row.selected de l'aperçu", () => {
    expect(buildApplyPayload(PREVIEW)).toEqual({ apply: [{ product_id: "PRODUCT-0001", denom: "000" }] });
  });

  test("selection[rowId] est prioritaire sur row.selected (l'écran décoche une ligne proposée)", () => {
    expect(buildApplyPayload(PREVIEW, { "PRODUCT-0001": false })).toEqual({ apply: [] });
    expect(buildApplyPayload(PREVIEW, { "PRODUCT-0001": false, "PRODUCT-0004": true })).toEqual({
      apply: [{ product_id: "PRODUCT-0004", denom: "001" }],
    });
  });

  test("une ligne ambiguous/missing n'est JAMAIS envoyée, même cochée dans la map", () => {
    const rows = [
      { product_id: "P1", state: "ambiguous", selected: false, match: { denom: "000" } },
      { product_id: "P2", state: "missing", selected: true, match: { denom: "000" } },
    ];
    expect(buildApplyPayload(rows, { P1: true, P2: true })).toEqual({ apply: [] });
  });

  test("ligne proposée cochée sans product_id ou sans denom string → jamais envoyée", () => {
    expect(buildApplyPayload([{ state: "proposed", selected: true, match: { denom: "000" } }])).toEqual({ apply: [] });
    expect(buildApplyPayload([{ product_id: "P1", state: "proposed", selected: true, match: null }])).toEqual({ apply: [] });
    expect(buildApplyPayload([{ product_id: "P1", state: "proposed", selected: true, match: { denom: 7 } }])).toEqual({
      apply: [],
    });
  });

  test.each([
    ["non tableau", "preview"],
    ["absent", undefined],
  ])("aperçu %s → {apply: []}, jamais d'exception", (_name, rows) => {
    expect(buildApplyPayload(rows)).toEqual({ apply: [] });
  });
});

describe("buildConfigPayload — assemblage du corps put_config (README §3.1)", () => {
  const BLOCKS = [
    { kind: "heading", label_key: "admin.provider.title" },
    {
      kind: "select",
      key: "aluu_game_code",
      value: "example_game",
      options: [{ value: "example_game" }, { value: "example_game_2" }],
    },
    {
      kind: "select",
      key: "aluu_check_endpoint",
      value: "game-check",
      options: [{ value: "game-check" }, { value: "bgmi" }],
    },
    {
      kind: "select",
      key: "aluu_identity_map.player_id",
      label_key: null,
      label: "Player ID",
      value: "characterId",
      options: [{ value: "characterId" }, { value: "charname" }],
    },
    {
      kind: "select",
      key: "aluu_identity_map.server_id",
      label_key: null,
      label: "Server ID",
      value: null, // champ non relié → clé OMISE, jamais null
      options: [{ value: "server_code" }],
    },
    { kind: "select", key: "provider", value: "fazercards", disabled: true, options: [{ value: "fazercards" }] },
    { kind: "button", key: "save", label_key: "common.save", action: "put_config" },
  ];

  test("assemblage conforme : deux scalaires + table d'identité sans les champs non reliés", () => {
    expect(buildConfigPayload(BLOCKS)).toEqual({
      aluu_game_code: "example_game",
      aluu_check_endpoint: "game-check",
      aluu_identity_map: { player_id: "characterId" },
    });
  });

  test("values[key] est prioritaire sur block.value", () => {
    expect(
      buildConfigPayload(BLOCKS, { aluu_game_code: "example_game_2", "aluu_identity_map.player_id": "charname" })
    ).toEqual({
      aluu_game_code: "example_game_2",
      aluu_check_endpoint: "game-check",
      aluu_identity_map: { player_id: "charname" },
    });
  });

  test("valeur vide ou null → clé OMISE, jamais null ; table d'identité vide → clé omise", () => {
    const payload = buildConfigPayload(BLOCKS, {
      aluu_game_code: "",
      "aluu_identity_map.player_id": null,
    });
    expect(payload).not.toHaveProperty("aluu_game_code");
    expect(payload).not.toHaveProperty("aluu_identity_map");
    expect(JSON.stringify(payload)).not.toContain("null");
  });

  test("valeur absente des options du select → traitée comme vide (clé omise)", () => {
    const payload = buildConfigPayload(BLOCKS, { aluu_check_endpoint: "endpoint_inventé" });
    expect(payload).not.toHaveProperty("aluu_check_endpoint");
    expect(payload.aluu_game_code).toBe("example_game");
  });

  test("aucune autre clé n'est envoyée (provider, champs hors contrat)", () => {
    const payload = buildConfigPayload(BLOCKS);
    expect(Object.keys(payload).sort()).toEqual(["aluu_check_endpoint", "aluu_game_code", "aluu_identity_map"]);
    expect(payload.provider).toBeUndefined();
  });

  test("entrées illisibles → objet vide ou sans exception, jamais null", () => {
    expect(buildConfigPayload("x")).toEqual({});
    expect(buildConfigPayload(undefined)).toEqual({});
    expect(buildConfigPayload(BLOCKS, 42)).toEqual(buildConfigPayload(BLOCKS)); // values non objet → ignorées
  });
});

describe("payloadFor — le corps de bascule ne sort que pour put_game_provider, forme exacte", () => {
  test("put_game_provider avec payload conforme → copie fraîche {provider}", () => {
    const block = { action: "put_game_provider", payload: { provider: "aluu" } };
    const payload = payloadFor(block);
    expect(payload).toEqual({ provider: "aluu" });
    expect(payload).not.toBe(block.payload); // la source n'est jamais mutée
    payload.provider = "corrompu";
    expect(block.payload.provider).toBe("aluu");
  });

  test("les deux valeurs du contrat sont acceptées", () => {
    expect(payloadFor({ action: "put_game_provider", payload: { provider: "fazercards" } })).toEqual({
      provider: "fazercards",
    });
  });

  test.each([
    ["autre action", { action: "put_config", payload: { provider: "aluu" } }],
    ["payload absent", { action: "put_game_provider" }],
    ["clé en trop", { action: "put_game_provider", payload: { provider: "aluu", aluu_game_code: "x" } }],
    ["valeur inconnue", { action: "put_game_provider", payload: { provider: "stripe" } }],
    ["payload non objet", { action: "put_game_provider", payload: "aluu" }],
    ["provider non string", { action: "put_game_provider", payload: { provider: 42 } }],
  ])("%s → undefined, rien n'est transmis", (_name, block) => {
    expect(payloadFor(block)).toBeUndefined();
  });

  test("block cassé → undefined, jamais d'exception", () => {
    expect(payloadFor(null)).toBeUndefined();
    expect(payloadFor("button")).toBeUndefined();
  });
});

// ——— Cellules ——————————————————————————————————————————————————————————————

describe("cellText — rendu texte par défaut, jamais un chemin brut ni un objet sérialisé", () => {
  test("valeur null avec value_key → libellé de la ligne (« Configuré » / « Non configuré »)", () => {
    const row = { key: "api_key", value: null, value_key: "admin.provider.connection.configured" };
    expect(cellText(row, { key: "value" }, t)).toBe("Configuré");
    expect(cellText({ value: null, value_key: "admin.provider.connection.not_configured" }, { key: "value" }, t)).toBe(
      "Non configuré"
    );
  });

  test("valeur null sans value_key → « — », jamais sdui.label.missing (décision FE-003)", () => {
    expect(cellText({ match: null }, { key: "match" }, t)).toBe("—");
    expect(cellText({ match: null }, { key: "match" }, t)).not.toBe("Libellé indisponible");
  });

  test("chaîne simple → telle quelle (identity_fields.label)", () => {
    expect(cellText({ label: "Player ID" }, { key: "label" }, t)).toBe("Player ID");
  });

  test("nombre → format fr (milliers séparés)", () => {
    expect(cellText({ price: 12000 }, { key: "price" }, t)).toMatch(/^12[\s\u00A0\u202F]000$/);
  });

  test.each([
    ["ligne cassée", null, { key: "state" }],
    ["colonne cassée", { state: "mapped" }, null],
    ["colonne sans key", { state: "mapped" }, { label_key: "x" }],
    ["key non string", { state: "mapped" }, { key: 42 }],
  ])("%s → chaîne vide, jamais d'exception", (_name, row, column) => {
    expect(cellText(row, column, t)).toBe("");
  });
});

describe("formatCell(format, row, column, t) — liste fermée du README §2", () => {
  test("format text : chaîne affichable telle quelle, échappée (jamais interprétée)", () => {
    expect(formatCell("text", { value: "<b>&amp;</b>" }, { key: "value", format: "text" }, t)).toBe("<b>&amp;</b>");
  });

  test("format text : une valeur non nulle l'emporte sur value_key (URL de webhook)", () => {
    const row = { value: "https://api.magicgame.store/api/aluu/webhook", value_key: "admin.provider.connection.not_configured" };
    expect(formatCell("text", row, { key: "value", format: "text" }, t)).toBe(
      "https://api.magicgame.store/api/aluu/webhook"
    );
  });

  test("format text : null → value_key traduit, sinon « — » (décision FE-003)", () => {
    expect(formatCell("text", { value: null, value_key: "admin.provider.connection.configured" }, { key: "value" }, t)).toBe(
      "Configuré"
    );
    expect(formatCell("text", { value: null }, { key: "value" }, t)).toBe("—");
  });

  test("format label_key : clé traduite ; clé non résolue → « — », JAMAIS le chemin brut", () => {
    expect(formatCell("label_key", { label_key: "admin.provider.title" }, { key: "label_key" }, t)).toBe("Fournisseur");
    expect(formatCell("label_key", { label_key: "admin.provider.connection.api_key" }, { key: "label_key" }, t)).toBe("—");
    expect(formatCell("label_key", { label_key: "does.not.exist" }, { key: "label_key" }, t)).toBe("—");
    expect(formatCell("label_key", { label_key: "does.not.exist" }, { key: "label_key" }, t)).not.toBe("does.not.exist");
    expect(formatCell("label_key", { label_key: null }, { key: "label_key" }, t)).toBe("—");
  });

  test("format money : entier >= 0 → formatAr de l'app ; non entier/négatif/non nombre → « — »", () => {
    expect(formatCell("money", { price: 12000 }, { key: "price", format: "money" }, t)).toMatch(/^12[\s\u00A0\u202F]000 Ar$/);
    expect(formatCell("money", { price: 12000.5 }, { key: "price", format: "money" }, t)).toBe("—");
    expect(formatCell("money", { price: -5 }, { key: "price", format: "money" }, t)).toBe("—");
    expect(formatCell("money", { price: "12000" }, { key: "price", format: "money" }, t)).toBe("—");
    expect(formatCell("money", { price: null }, { key: "price", format: "money" }, t)).toBe("—");
  });

  test("le format money du moteur sort EXACTEMENT ce que formatAr sort (divergence impossible)", () => {
    for (const n of [0, 5, 12000, 1500000]) {
      expect(formatCell("money", { price: n }, { key: "price", format: "money" }, t)).toBe(formatAr(n));
    }
  });

  test("format state : les 6 états du §5 traduits ; état inconnu → « — », JAMAIS la valeur brute", () => {
    expect(formatCell("state", { state: "mapped" }, { key: "state", format: "state" }, t)).toBe("Lié");
    expect(formatCell("state", { state: "proposed" }, { key: "state", format: "state" }, t)).toBe("Proposé");
    expect(formatCell("state", { state: "stale" }, { key: "state", format: "state" }, t)).toBe("Pack disparu");
    const weird = formatCell("state", { state: "weird_state" }, { key: "state", format: "state" }, t);
    expect(weird).toBe("—");
    expect(weird).not.toBe("weird_state");
    expect(weird).not.toBe("admin.aluu_mapping.state.weird_state");
    expect(formatCell("state", { state: null }, { key: "state", format: "state" }, t)).toBe("—");
  });

  test("format pack : trois chaînes → « offer_name (denom) · price_usd USD », price_usd JAMAIS converti", () => {
    const match = { denom: "000", offer_name: "Example Pack 0001", price_usd: "0.0000" };
    expect(formatCell("pack", { match }, { key: "match", format: "pack" }, t)).toBe(
      "Example Pack 0001 (000) · 0.0000 USD"
    );
  });

  test("format pack : price_usd reste « 0.0000 » — jamais converti en nombre ni reformatté", () => {
    const text = formatCell(
      "pack",
      { match: { denom: "000", offer_name: "P", price_usd: "0.0000" } },
      { key: "match", format: "pack" },
      t
    );
    expect(text).toContain("0.0000 USD");
    expect(text).not.toMatch(/\b0\b USD/); // pas de conversion "0.0000" → 0
    expect(text).not.toMatch(/Ar/); // jamais le formateur Ariary sur un prix USD
  });

  test.each([
    ["match null", null],
    ["champ manquant", { denom: "000", offer_name: "P" }],
    ["price_usd nombre", { denom: "000", offer_name: "P", price_usd: 0 }],
    ["tableau", ["x"]],
  ])("format pack, %s → « — »", (_name, match) => {
    expect(formatCell("pack", { match }, { key: "match", format: "pack" }, t)).toBe("—");
  });

  test("format checkbox → null : la case est rendue par le composant, jamais en texte", () => {
    expect(formatCell("checkbox", { selected: true }, { key: "selected", format: "checkbox" }, t)).toBeNull();
  });

  test.each([
    ["format inconnu", "badge"],
    ["format absent", undefined],
    ["format non string", 42],
  ])("%s → traité comme text, jamais deviné", (_name, format) => {
    expect(formatCell(format, { value: "<i>x</i>" }, { key: "value", format }, t)).toBe("<i>x</i>");
  });

  test("ligne/colonne cassées → chaîne vide ou « — », jamais d'exception", () => {
    expect(formatCell("text", null, { key: "x" }, t)).toBe("");
    expect(formatCell("state", { state: "mapped" }, null, t)).toBe("—");
    expect(formatCell("money", null, { key: "price", format: "money" }, t)).toBe("—");
  });
});

describe("cellCandidates — candidats d'une ligne ambiguous", () => {
  test("offer_name des candidats, dans l'ordre", () => {
    const row = {
      candidates: [
        { denom: "000", offer_name: "Pack A" },
        { denom: "000", offer_name: "Pack B" },
        "broken",
        { denom: "000" },
      ],
    };
    expect(cellCandidates(row)).toEqual(["Pack A", "Pack B"]);
  });

  test.each([
    ["ligne sans candidats", { state: "ambiguous" }],
    ["ligne cassée", null],
    ["candidats non tableau", { candidates: "x" }],
  ])("%s → tableau vide", (_name, row) => {
    expect(cellCandidates(row)).toEqual([]);
  });
});

// ——— Erreurs (errors.json) —————————————————————————————————————————————————

describe("errorLabel — code connu traduit, code inconnu → errors.unknown, jamais le detail", () => {
  test("code connu → sa traduction", () => {
    expect(errorLabel("game_code_not_in_catalog", t)).toBe("Ce code jeu n'existe pas dans le catalogue ALUU.");
  });

  test("code inconnu → errors.unknown, jamais le chemin ni le detail", () => {
    const text = errorLabel("some_future_code", t);
    expect(text).toBe("Erreur inattendue. Réessayez.");
    expect(text).not.toBe("errors.some_future_code");
    expect(text).not.toBe("SQLITE_STACK_TRACE_DETAIL"); // detail n'est jamais lu
  });

  test.each([
    ["code absent", undefined],
    ["code non string", 42],
    ["code vide", ""],
  ])("%s → errors.unknown", (_name, code) => {
    expect(errorLabel(code, t)).toBe("Erreur inattendue. Réessayez.");
  });

  test("errors.unknown elle-même manquante → chaîne vide, jamais un chemin brut", () => {
    const emptyT = () => undefined;
    expect(errorLabel("whatever", emptyT)).toBe("");
  });
});
