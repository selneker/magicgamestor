import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

// Réveil d'une instance Render gratuite : ~30–60 s après ~15 min d'inactivité.
// On borne chaque essai (45 s), on réessaie deux fois, et on prévient l'UI au-delà de 6 s
// pour que le premier chargement reste compréhensible au lieu d'afficher un compte déconnecté.
const CHECK_TIMEOUT_MS = 45000;
const RETRY_DELAYS_MS = [3000, 8000];
const SLOW_AFTER_MS = 6000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode (dev) exécute setup → cleanup → setup : le second setup doit réarmer le drapeau.
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const checkAuth = useCallback(async () => {
    setLoading(true); setSlow(false); setOffline(false);
    const slowTimer = setTimeout(() => { if (alive.current) setSlow(true); }, SLOW_AFTER_MS);
    try {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          // L'interceptor d'api.js rafraîchit déjà la session sur 401 (cookie 30 j) :
          // un 401 ici signifie « réellement déconnecté ».
          const { data } = await api.get("/auth/me", { timeout: CHECK_TIMEOUT_MS });
          if (alive.current) setUser(data || false);
          return;
        } catch (err) {
          const status = err?.response?.status;
          // Seul un 401 est une absence de session certaine. Un 403 (origine/CSRF, WAF)
          // ou une panne ne doit pas faire croire à une déconnexion définitive.
          if (status === 401) {
            if (alive.current) setUser(false);
            return;
          }
          if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
      if (alive.current) { setUser(false); setOffline(true); }
    } finally {
      clearTimeout(slowTimer);
      if (alive.current) { setLoading(false); setSlow(false); }
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setUser(false);
  }, []);

  const role = user?.role;
  const isSuperAdmin = role === "super_admin";
  const isAdmin = role === "admin" || isSuperAdmin;
  const can = useCallback((permission) => isSuperAdmin || (user?.permissions || []).includes(permission), [isSuperAdmin, user]);
  const value = useMemo(() => ({ user, loading, slow, offline, setUser, logout, refresh: checkAuth, isAdmin, isSuperAdmin, can }),
                            [user, loading, slow, offline, logout, checkAuth, isAdmin, isSuperAdmin, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
