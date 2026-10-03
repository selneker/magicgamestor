import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { Button } from "@/components/ui/button";

export const ChatLink = () => {
  const { isAdmin } = useAuth();
  const { count } = useChat();
  return <Button asChild variant="ghost" size="sm" className="relative hidden gap-1 rounded-full md:inline-flex">
    <Link to={isAdmin ? "/admin/messages" : "/chat"} data-testid="header-chat-link"><MessageCircle className="h-5 w-5" />Chat
      {count > 0 && <span data-testid="header-chat-unread" aria-label={`${count} messages non lus`} className="rounded-full bg-primary px-1.5 text-xs text-white">{count}</span>}
    </Link>
  </Button>;
};
