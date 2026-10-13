import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

export default function Chat() {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <p className="py-12 text-muted-foreground" data-testid="chat-auth-loading">Chargement…</p>;
  if (isAdmin) return <Navigate to="/admin/messages" replace />;
  return <div className="pb-28 pt-6" data-testid="customer-chat-page">
    <h1 className="font-display text-3xl font-bold">Chat</h1>
    <p className="mb-6 mt-2 text-sm text-muted-foreground">Votre conversation privée avec Magic Game Store.</p>
    {user ? <ChatWorkspace /> : <section className="max-w-xl rounded-2xl border bg-card p-6" data-testid="chat-login-required">
      <p data-testid="chat-login-message">Vous devez créer un compte ou vous connecter pour démarrer une conversation.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild className="rounded-full"><Link to="/connexion" state={{ from: "/chat" }} data-testid="chat-login">Se connecter</Link></Button>
        <Button asChild variant="outline" className="rounded-full"><Link to="/inscription" state={{ from: "/chat" }} data-testid="chat-register">Créer un compte</Link></Button>
      </div>
    </section>}
  </div>;
}
