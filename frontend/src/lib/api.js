import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
});

let refreshing = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && !config._retry && !config.url.includes("/auth/")) {
      config._retry = true;
      refreshing = refreshing || api.post("/auth/refresh").finally(() => (refreshing = null));
      try {
        await refreshing;
        return api(config);
      } catch (_) {
        return Promise.reject(error);
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
