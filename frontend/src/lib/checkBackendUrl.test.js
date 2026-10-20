/**
 * Tests du controle de build `scripts/check-backend-url.mjs`.
 *
 * Le fichier vit dans `src/` parce que la configuration jest de create-react-app
 * ne collecte les tests que sous `src/` (react-scripts/scripts/utils/createJestConfig.js,
 * `testMatch`). Le script lui-meme reste hors de `src/` : il ne doit jamais
 * etre bundle.
 *
 * Le script resout le repertoire des fichiers .env par rapport a SA propre
 * position (`<script>/..`). On le copie donc dans un dossier temporaire : les
 * tests n'écrivent jamais dans le depot.
 */

const { spawnSync } = require("child_process");
const { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } = require("fs");
const { join, dirname } = require("path");
const { tmpdir } = require("os");

const SCRIPT = join(__dirname, "..", "..", "scripts", "check-backend-url.mjs");

// Lance le script dans un dossier temporaire et renvoie { code, stdout, stderr }.
function run({ env = {}, files = {}, args = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "mgs-env-"));
  try {
    // Le script resout le repertoire des .env par rapport a SA position
    // (`<script>/..`) : on reproduit donc l'arborescence reelle,
    // scripts/check-backend-url.mjs a la racine du dossier temporaire.
    const scriptsDir = join(dir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    copyFileSync(SCRIPT, join(scriptsDir, "check-backend-url.mjs"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    const childEnv = { ...process.env, ...env };
    for (const key of Object.keys(childEnv)) {
      if (childEnv[key] === undefined) delete childEnv[key];
    }
    // spawnSync (et non execFileSync) : il rend stdout ET stderr dans les deux
    // cas, succes comme echec. Le script ecrit l'avertissement sur stderr
    // (console.warn) et l'erreur sur stderr (console.error).
    const res = spawnSync(process.execPath, [join(scriptsDir, "check-backend-url.mjs"), ...args], {
      env: childEnv,
      encoding: "utf8",
    });
    return { code: res.status === null ? 1 : res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VAR = "REACT_APP_BACKEND_URL";

describe("check-backend-url", () => {
  it("accepte une variable definie dans l'environnement de build", () => {
    const r = run({ env: { [VAR]: "https://api.exemple.test" }, args: ["--strict"] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("est definie");
    expect(r.stdout).toContain("l'environnement de build");
  });

  it("lit .env.production pour un build de production", () => {
    // Regression : le mode etait deduit de NODE_ENV (undefined pendant
    // prebuild), la liste de developpement etait utilisee et ce fichier
    // etait ignore -> le build etait bloque a tort.
    const r = run({
      env: { [VAR]: undefined },
      files: { ".env.production": `${VAR}=https://api.prod.exemple.test\n` },
      args: ["--strict"],
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(".env.production");
  });

  it("refuse .env.development pour un build de production", () => {
    // Regression : ce fichier etait pris en compte alors que CRA l'ignore en
    // production -> le build passait avec baseURL "undefined/api".
    const r = run({
      env: { [VAR]: undefined },
      files: { ".env.development": `${VAR}=https://api.dev.exemple.test\n` },
      args: ["--strict"],
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("n'est pas definie");
  });

  it("refuse une variable absente en production mais n'avertit qu'en developpement", () => {
    const strict = run({ env: { [VAR]: undefined }, args: ["--strict"] });
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("n'est pas definie");

    const warn = run({ env: { [VAR]: undefined }, args: ["--warn", "--development"] });
    expect(warn.code).toBe(0);
    // console.warn ecrit sur stderr (comme console.error) ; seul console.log va sur stdout.
    expect(warn.stderr).toContain("avertissement");
  });

  it("accepte une valeur vide : l'API est alors appelee en relatif sur le meme domaine", () => {
    // Une valeur vide produit baseURL "/api" : c'est le cas legitime "front et
    // API sur le meme domaine". Seule l'ABSENCE est un defaut de build.
    const r = run({ env: { [VAR]: "" }, args: ["--strict"] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("vide");
  });
});
