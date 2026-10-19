import { api } from "@/lib/api";

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
