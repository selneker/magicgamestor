import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CaptchaWidget, useCaptcha } from "./CaptchaWidget";

// PL-SEC-HARDEN-1-CAPTCHA — le script Turnstile n'est JAMAIS chargé en test :
// soit window.turnstile est simulé (le module le détecte et n'injecte rien),
// soit on laisse jsdom créer une balise script sans fetch pour vérifier le
// singleton de chargement.

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
    // Taille compacte ≤ 400 px d'écran (jsdom n'a pas matchMedia → « normal »)
    expect(["normal", "compact"]).toContain(turnstileOpts.size);
    act(() => { turnstileOpts.callback("jeton-123"); });
    expect(onVerify).toHaveBeenCalledWith("jeton-123");
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
  test("échec de chargement du script : le formulaire n'est pas bloqué (onError)", async () => {
    process.env[ENV_VAR] = TEST_KEY;
    const onVerify = jest.fn();
    const onError = jest.fn();
    await mountWidget({ onVerify, onError });
    // jsdom n'exécute pas le src : simuler l'échec HTTP du CDN
    const script = document.querySelector("script[src*='challenges.cloudflare.com']");
    expect(script).not.toBeNull();
    await act(async () => { script.dispatchEvent(new Event("error")); });
    expect(onError).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="captcha-widget"]')).toBeNull();
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
    await act(async () => r.unmount());
  });
});
