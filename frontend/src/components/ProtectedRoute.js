import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProtectedRoute({ children, admin = false }) {
  const { user, loading, slow, offline, refresh } = useAuth();
  const { t } = useLang();
  const location = useLocation();
  if (loading || (user === null && !location.state?.user)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center" data-testid="auth-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        {slow && <p className="max-w-xs text-sm text-muted-foreground" data-testid="auth-waking">{t("auth.waking")}</p>}
      </div>
    );
  }
  // Serveur injoignable après réessais : plutôt que de renvoyer vers /connexion (l'utilisateur
  // est peut-être connecté), on explique et on laisse réessayer.
  if (!user && offline) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center" data-testid="auth-offline">
        <p className="max-w-xs text-sm text-muted-foreground">{t("auth.wakeFailed")}</p>
        <Button variant="outline" className="rounded-full font-semibold" onClick={refresh} data-testid="auth-retry">{t("auth.retry")}</Button>
      </div>
    );
  }
  if (!user) return <Navigate to="/connexion" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  if (admin && !["admin", "super_admin"].includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
