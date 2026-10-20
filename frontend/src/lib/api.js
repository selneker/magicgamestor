import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
});

// Endpoints dont un 401 signifie « mauvais identifiants / boucle de refresh » : jamais
// rafraîchis silencieusement. GET/PATCH /auth/me reste rafraîchissable à dessein :
// après l'expiration du cookie access (15 min), un visiteur qui revient doit retrouver
// sa session via /auth/refresh au lieu d'apparaître déconnecté.
const NO_SILENT_REFRESH = /\/auth\/(login|register|refresh|logout|google|forgot-password|reset-password|change-password|verify-email|resend-verification|me\/delete)(\/|$|\?)/;
const REFRESH_TIMEOUT_MS = 15000;

let refreshing = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && config && !config._retry && !NO_SILENT_REFRESH.test(config.url || "")) {
      config._retry = true;
      refreshing = refreshing || api.post("/auth/refresh", null, { timeout: REFRESH_TIMEOUT_MS })
        .finally(() => (refreshing = null));
      try {
        await refreshing;
        return api(config);
      } catch (refreshError) {
        // Un refresh 401 signifie « session réellement absente/révoquée » : on remonte le
        // 401 d'origine. Un timeout, une erreur réseau, un 5xx ou un 403 (origine/CSRF)
        // ne doivent PAS déconnecter à tort : AuthContext réessaie puis affiche hors ligne.
        const status = refreshError?.response?.status;
        if (status === 401) return Promise.reject(error);
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export function errorMessage(e, fallback = "Une erreur est survenue") {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  return d.msg || String(d);
}

export const formatAr = (n) => `${Number(n || 0).toLocaleString("fr-FR").replace(/\u202f/g, " ")} Ar`;

export function sessionId() {
  let id = localStorage.getItem("mgs_session");
  if (!id) {
    id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem("mgs_session", id);
  }
  return id;
}
