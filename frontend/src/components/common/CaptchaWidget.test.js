import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CaptchaWidget, isCaptchaError, useCaptcha } from "./CaptchaWidget";

// PL-SEC-HARDEN-1-CAPTCHA — le script Turnstile n'est JAMAIS chargé en test :
// soit window.turnstile est simulé (le module le détecte et n'injecte rien),
// soit on laisse jsdom créer une balise script sans fetch pour vérifier le
// singleton de chargement.

// Le libellé d'échec CDN passe par t() : on résout depuis le vrai dictionnaire.
jest.mock("@/context/LanguageContext", () => {
  const { translations } = jest.requireActual("@/i18n/translations");
  const make = (lang) => (path) => path.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), translations[lang]) ?? path;
  return { useLang: () => ({ t: make("fr"), lang: "fr" }) };
});

const ENV_VAR = "REACT_APP_TURNSTILE_SITE_KEY";
const TEST_KEY = "0xAAAABBBB000000000000000000000001";

let turnstileOpts; // options passées à turnstile.render par le dernier montage
let removedIds = [];
let resetIds = [];

const stubTurnstile = () => {
  turnstileOpts = null;
  removedIds = [];
  resetIds = [];
  window.turnstile = {
    render: (el, opts) => {
      turnstileOpts = opts;
      el.innerHTML = "<div class='cf-iframe-mock'>mock</div>";
      return "w1";
    },
    remove: (id) => removedIds.push(id),
    reset: (id) => resetIds.push(id),
  };
};

const clearEnv = () => { delete process.env[ENV_VAR]; };

let container, root;
async function mountWidget(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<CaptchaWidget {...props} />); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  clearEnv();
  delete window.turnstile;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  document.body.innerHTML = "";
  global.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  document.body.innerHTML = "";
  clearEnv();
  delete window.turnstile;
});

describe("sans clé configurée", () => {
  test("rien n'est rendu, aucun script injecté, aucune callback", async () => {
    const onVerify = jest.fn();
    await mountWidget({ onVerify });
    expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
    expect(document.querySelectorAll("script[src*='challenges.cloudflare.com']")).toHaveLength(0);
    expect(onVerify).not.toHaveBeenCalled();
  });
});

describe("avec clé et window.turnstile simulé", () => {
  test("le widget rend avec la clé, le thème et le jeton remonte à onVerify", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    const onVerify = jest.fn();
    await mountWidget({ onVerify });
    expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
    expect(turnstileOpts.sitekey).toBe(TEST_KEY);
    expect(["light", "dark"]).toContain(turnstileOpts.theme);
    // PL-CHK-4 — toute la largeur du conteneur (jamais de taille fixe qui
    // déborde à 320-430 px), invisible tant que Cloudflare ne demande rien.
    expect(turnstileOpts.size).toBe("flexible");
    expect(turnstileOpts.appearance).toBe("interaction-only");
    // Langue du site (useLang → "fr" dans ce test).
    expect(turnstileOpts.language).toBe("fr");
    act(() => { turnstileOpts.callback("jeton-123"); });
    expect(onVerify).toHaveBeenCalledWith("jeton-123");
  });

  test("PL-CHK-4 — onInteractive : before/after-interactive-callback préviennent le parent", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    const onVerify = jest.fn();
    const onInteractive = jest.fn();
    await mountWidget({ onVerify, onInteractive });
    act(() => { turnstileOpts["before-interactive-callback"](); });
    expect(onInteractive).toHaveBeenLastCalledWith(true);
    act(() => { turnstileOpts["after-interactive-callback"](); });
    expect(onInteractive).toHaveBeenLastCalledWith(false);
    // Un before de plus (le prop est bien là) : toujours aucun crash.
    act(() => { turnstileOpts["before-interactive-callback"](); });
    expect(onInteractive).toHaveBeenCalledTimes(3);
  });

  test("expiration : le jeton est remis à VIDE (jeton à usage unique)", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    const onVerify = jest.fn();
    await mountWidget({ onVerify });
    act(() => { turnstileOpts["expired-callback"](); });
    expect(onVerify).toHaveBeenLastCalledWith("");
  });

  test("reset() via la ref : turnstile.reset est demandé avec l'id du widget", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    let widgetRef;
    const container0 = document.createElement("div");
    document.body.appendChild(container0);
    const r = createRoot(container0);
    
    await act(async () => { r.render(<CaptchaWidget ref={(ref) => { widgetRef = ref; }} onVerify={jest.fn()} />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { widgetRef.reset(); });
    expect(resetIds).toContain("w1");
    await act(async () => r.unmount());
  });

  test("démontage : turnstile.remove est appelé (pas de widget orphelin)", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    const onVerify = jest.fn();
    await mountWidget({ onVerify });
    await act(async () => root.unmount());
    root = null;
    expect(removedIds).toContain("w1");
  });

  test("deux widgets montés → aucun script de plus (le singleton détecte turnstile)", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    stubTurnstile();
    
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => {
      r.render(<React.Fragment><CaptchaWidget onVerify={jest.fn()} /><CaptchaWidget onVerify={jest.fn()} /></React.Fragment>);
    });
    expect(document.querySelectorAll("script[src*='challenges.cloudflare.com']")).toHaveLength(0);
    expect(turnstileOpts).not.toBeNull();
    await act(async () => r.unmount());
  });
});

describe("chargement du script (pas de window.turnstile préexistant)", () => {
  test("échec de chargement du CDN : fail-closed — message inline + bouton Réessayer", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    const onVerify = jest.fn();
    const onError = jest.fn();
    await mountWidget({ onVerify, onError });
    // jsdom n'exécute pas le src : simuler l'échec HTTP du CDN
    const script = document.querySelector("script[src*='challenges.cloudflare.com']");
    expect(script).not.toBeNull();
    await act(async () => { script.dispatchEvent(new Event("error")); });
    expect(onError).toHaveBeenCalled();
    // la balise morte est retirée (une nouvelle tentative doit repartir propre)
    expect(document.querySelectorAll("script[src*='challenges.cloudflare.com']")).toHaveLength(0);
    // plus le conteneur du widget — un panneau d'échec à la place
    expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
    const failed = container.querySelector('[data-testid="captcha-widget-failed"]');
    expect(failed).not.toBeNull();
    expect(failed.textContent).toContain("Impossible de charger la vérification anti-robot");
    expect(container.querySelector('[data-testid="captcha-retry"]')).not.toBeNull();
  });

  test("2e échec après Réessayer : toujours fail-closed, le singleton repart de zéro", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    await mountWidget({});
    let script = document.querySelector("script[src*='challenges.cloudflare.com']");
    await act(async () => { script.dispatchEvent(new Event("error")); });
    await act(async () => { container.querySelector('[data-testid="captcha-retry"]').click(); });
    script = document.querySelector("script[src*='challenges.cloudflare.com']");
    expect(script).not.toBeNull(); // une (re)tentative = une balise
    await act(async () => { script.dispatchEvent(new Event("error")); });
    expect(container.querySelector('[data-testid="captcha-widget-failed"]')).not.toBeNull();
    expect(document.querySelectorAll("script[src*='challenges.cloudflare.com']")).toHaveLength(0);
  });

  test("une seule balise <script>, même avec deux widgets montés", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => {
      r.render(<React.Fragment><CaptchaWidget onVerify={jest.fn()} /><CaptchaWidget onVerify={jest.fn()} /></React.Fragment>);
    });
    await act(async () => { await Promise.resolve(); });
    const scripts = document.querySelectorAll("script[src*='challenges.cloudflare.com/turnstile']");
    expect(scripts).toHaveLength(1);
    // nettoyage du test : on rejette le singleton pour ne pas le laisser en attente
    await act(async () => { scripts[0].dispatchEvent(new Event("error")); });
    await act(async () => r.unmount());
  });

  // Dernier test du fichier : il laisse le singleton RÉSOLU (chargement réussi),
  // ce qui ne gêne aucun test ultérieur.
  test("Réessayer : retente sans recharger la page et débloque le widget au succès", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    await mountWidget({});
    let script = document.querySelector("script[src*='challenges.cloudflare.com']");
    await act(async () => { script.dispatchEvent(new Event("error")); });
    expect(container.querySelector('[data-testid="captcha-widget-failed"]')).not.toBeNull();

    await act(async () => { container.querySelector('[data-testid="captcha-retry"]').click(); });
    // le singleton repart de zéro : une NOUVELLE balise (une seule au total)
    script = document.querySelector("script[src*='challenges.cloudflare.com']");
    expect(script).not.toBeNull();

    // cette fois le CDN répond : jsdom n'exécute pas le src, on simule le load
    stubTurnstile();
    await act(async () => { script.dispatchEvent(new Event("load")); });
    expect(container.querySelector('[data-testid="captcha-widget"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="captcha-widget-failed"]')).toBeNull();
    expect(turnstileOpts).not.toBeNull();
  });
});

describe("isCaptchaError", () => {
  const err = (status, code, detail) => ({ response: { status, data: { code, detail } } });

  test("contrat explicite backend : 400 + code captcha_required", () => {
    expect(isCaptchaError(err(400, "captcha_required", "Vérification anti-robot requise."))).toBe(true);
  });

  test("transition : 428 quel que soit le corps", () => {
    expect(isCaptchaError(err(428, "", ""))).toBe(true);
  });

  test("un 400 métier non-CAPTCHA n'est PAS une erreur captcha", () => {
    expect(isCaptchaError(err(400, "invalid_credentials", "Identifiants incorrects"))).toBe(false);
  });

  test("succès / autre erreur réseau : non", () => {
    expect(isCaptchaError(err(200, "", ""))).toBe(false);
    expect(isCaptchaError(new Error("Network Error"))).toBe(false);
  });
});
