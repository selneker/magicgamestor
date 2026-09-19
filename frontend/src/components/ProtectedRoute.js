import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children, admin = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading || (user === null && !location.state?.user)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-testid="auth-loading">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/connexion" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
