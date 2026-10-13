import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

// Google OAuth is owned by Magic Game Store: the backend (api.magicgame.store) runs the
// authorization-code flow and redirects back with first-party auth cookies already set.
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export function startGoogleLogin(returnTo = "/compte") {
  const base = `${process.env.REACT_APP_BACKEND_URL}/api/auth/google/start`;
  window.location.href = `${base}?return_to=${encodeURIComponent(returnTo)}`;
}

// Surfaces ?error=google after a failed round-trip; success needs no handling (AuthProvider calls /auth/me).
export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("error") === "google") {
      toast.error("Connexion Google impossible. Réessayez.");
      params.delete("error");
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [location, navigate]);
  return null;
}
