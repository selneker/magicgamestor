import { api, formatAr } from "@/lib/api";

// L'interceptor restaure la session : le cookie access dure 15 min, le refresh cookie 30 jours.
// Sans ce refresh silencieux sur /auth/me, un utilisateur qui revient (access expiré) serait
// considéré déconnecté à tort — c'était la cause du 401 observé sur /api/auth/me.

function ok(config, data) {
  return { data, status: 200, statusText: "OK", headers: {}, config };
}
function err401(config) {
  const error = new Error("Request failed with status code 401");
  error.config = config;
  error.response = { status: 401, data: { detail: "Not authenticated" }, headers: {}, config };
  error.isAxiosError = true;
  return error;
}

describe("api interceptor — garde-fou global /api (T1.7)", () => {
  let calls, handler;

  beforeEach(() => {
    calls = [];
    api.defaults.adapter = (config) => {
      calls.push({ url: config.url });
      return handler(config);
    };
  });

  test("une réponse avec content-type non-JSON est rejetée", async () => {
    handler = (config) =>
      Promise.resolve({
        data: "<html>erreur</html>",
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
        config,
      });
    await expect(api.get("/products")).rejects.toMatchObject({
      message: expect.stringContaining("non-JSON"),
    });
  });

  test("une réponse avec content-type JSON passe", async () => {
    handler = (config) =>
      Promise.resolve({
        data: [{ id: "p1" }],
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        config,
      });
    const { data } = await api.get("/products");
    expect(data).toEqual([{ id: "p1" }]);
  });

  test("une réponse sans content-type passe (compat tests existants)", async () => {
    handler = (config) =>
      Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
    const { data } = await api.get("/products");
    expect(data).toEqual({ ok: true });
  });
});

describe("api interceptor — restauration de session", () => {
  let calls, handler;

  beforeEach(() => {
    calls = [];
    api.defaults.adapter = (config) => {
      calls.push({ url: config.url, retry: !!config._retry, timeout: config.timeout });
      return handler(config);
    };
  });

  test("un 401 sur /auth/me déclenche un refresh puis rejoue la requête", async () => {
    handler = (config) => {
      if (config.url === "/auth/refresh") return Promise.resolve(ok(config, { access_token: "fresh" }));
      return config._retry ? Promise.resolve(ok(config, { user_id: "u1" })) : Promise.reject(err401(config));
    };
    const { data } = await api.get("/auth/me");
    expect(data).toEqual({ user_id: "u1" });
    expect(calls.filter((c) => c.url === "/auth/refresh")).toHaveLength(1);
    expect(calls.filter((c) => c.url === "/auth/me")).toHaveLength(2);
  });

  test("un 401 sur /auth/login n'essaie jamais de rafraîchir", async () => {
    handler = (config) => Promise.reject(err401(config));
    await expect(api.post("/auth/login", { email: "a@b.c", password: "x" })).rejects.toBeTruthy();
    expect(calls.some((c) => c.url === "/auth/refresh")).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("si le refresh échoue, le 401 d'origine remonte sans boucle", async () => {
    handler = (config) => Promise.reject(err401(config));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ response: { status: 401 } });
    expect(calls.map((c) => c.url)).toEqual(["/auth/me", "/auth/refresh"]);
  });

  // Fix « preuves noires » : le garde T1.7 rejetait toute réponse non-JSON,
  // y compris les images de preuves (image/jpeg) renvoyées par
  // /admin/orders/{id}/proofs/{index} et l'export admin — la visionneuse
  // plein écran noir était en réalité son état d'erreur.
  test("le garde JSON laisse passer une réponse blob (image de preuve)", async () => {
    handler = (config) => Promise.resolve({ ...ok(config, new Blob(["jpeg"])), headers: { "content-type": "image/jpeg" } });
    const { data } = await api.get("/admin/orders/o1/proofs/0", { responseType: "blob" });
    expect(data).toBeInstanceOf(Blob);
  });

  test("le garde JSON rejette toujours le HTML sur une réponse classique", async () => {
    handler = (config) => Promise.resolve({ ...ok(config, "<html></html>"), headers: { "content-type": "text/html" } });
    await expect(api.get("/products")).rejects.toThrow(/non-JSON/);
  });

  test("le refresh silencieux est borné par un timeout", async () => {
    handler = (config) => {
      if (config.url === "/auth/refresh") return Promise.resolve(ok(config, { access_token: "fresh" }));
      return config._retry ? Promise.resolve(ok(config, { user_id: "u1" })) : Promise.reject(err401(config));
    };
    await api.get("/auth/me");
    const refreshCall = calls.find((c) => c.url === "/auth/refresh");
    expect(refreshCall.timeout).toBe(15000);
  });

  test("un refresh en erreur réseau n'est pas transformé en 401 définitif", async () => {
    // Le 401 initial signifiait seulement « access expiré ». Si le refresh échoue pour une
    // raison réseau, AuthContext doit pouvoir réessayer / afficher hors ligne, pas déconnecter.
    const network = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK", isAxiosError: true });
    handler = (config) => config.url === "/auth/refresh" ? Promise.reject(network) : Promise.reject(err401(config));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ code: "ERR_NETWORK" });
  });

  test("un refresh en erreur serveur n'est pas transformé en 401 définitif", async () => {
    const serverError = Object.assign(new Error("Request failed with status code 500"), {
      response: { status: 500, data: { detail: "boom" }, headers: {} },
    });
    handler = (config) => config.url === "/auth/refresh" ? Promise.reject(serverError) : Promise.reject(err401(config));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ response: { status: 500 } });
  });

  test("un refresh 403 (origine/CSRF) n'est pas transformé en 401 définitif", async () => {
    const forbidden = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403, data: { detail: "Origine non autorisée." }, headers: {} },
    });
    handler = (config) => config.url === "/auth/refresh" ? Promise.reject(forbidden) : Promise.reject(err401(config));
    await expect(api.get("/auth/me")).rejects.toMatchObject({ response: { status: 403 } });
  });

  test("deux 401 simultanés ne déclenchent qu'un seul refresh", async () => {
    let refreshed = false;
    handler = (config) => {
      if (config.url === "/auth/refresh") { refreshed = true; return Promise.resolve(ok(config, { access_token: "fresh" })); }
      return refreshed ? Promise.resolve(ok(config, { user_id: "u1" })) : Promise.reject(err401(config));
    };
    const [a, b] = await Promise.all([api.get("/auth/me"), api.get("/auth/me")]);
    expect(a.data).toEqual({ user_id: "u1" });
    expect(b.data).toEqual({ user_id: "u1" });
    expect(calls.filter((c) => c.url === "/auth/refresh")).toHaveLength(1);
  });
});

describe("formatAr — montant Ariary selon la langue (T4.5)", () => {
  const original = localStorage.getItem("mgs_lang");
  afterEach(() => {
    if (original === null) localStorage.removeItem("mgs_lang");
    else localStorage.setItem("mgs_lang", original);
  });

  test("sans argument explicite : defaut fr-FR en francais, et sans mgs_lang", () => {
    localStorage.setItem("mgs_lang", "fr");
    expect(formatAr(1234.5)).toBe("1 234,5 Ar");
    localStorage.removeItem("mgs_lang");
    expect(formatAr(1234.5)).toBe("1 234,5 Ar");
  });

  test("sans argument explicite : en-GB quand la langue stockee est anglais", () => {
    localStorage.setItem("mgs_lang", "en");
    expect(formatAr(1234.5)).toBe("1,234.5 Ar");
  });

  test("un argument explicite est prioritaire sur la langue stockee", () => {
    localStorage.setItem("mgs_lang", "en");
    expect(formatAr(1234.5, "fr-FR")).toBe("1 234,5 Ar");
  });

  test("valeur nulle ou indefinie : montant a zero", () => {
    expect(formatAr(null)).toBe("0 Ar");
    expect(formatAr(undefined)).toBe("0 Ar");
  });
});
