import { NavLink, useLocation } from "react-router-dom";
import { Crown, History, Rss, ShoppingCart, MessageCircle } from "lucide-react";
import { useChat } from "@/context/ChatContext";
import { useLang } from "@/context/LanguageContext";

export function BottomNav() {
  const { t } = useLang();
  const { count } = useChat();
  const { pathname, search } = useLocation();
  const items = [
    { to: "/boutique?type=uc", icon: ShoppingCart, label: t("nav.uc"), id: "bottom-nav-uc", active: pathname === "/boutique" && !search.includes("prime") },
    { to: "/boutique?type=prime,prime_plus", icon: Crown, label: t("nav.prime"), id: "bottom-nav-prime", active: pathname === "/boutique" && search.includes("prime") },
    { to: "/evenements", icon: Rss, label: t("nav.events"), id: "bottom-nav-events", active: pathname.startsWith("/evenements") },
    { to: "/suivi", icon: History, label: t("nav.orders"), id: "bottom-nav-orders", active: pathname.startsWith("/suivi") || pathname.startsWith("/compte") },
    { to: "/chat", icon: MessageCircle, label: "Chat", id: "bottom-nav-chat", active: pathname === "/chat" },
  ];
  if (pathname.startsWith("/admin")) return null;
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 md:hidden" data-testid="bottom-nav">
      <ul className="glass mx-auto flex max-w-md items-center justify-around rounded-full px-2 py-2 shadow-[0_8px_32px_rgba(15,23,42,0.12)]">
        {items.map(({ to, icon: Icon, label, id, active }) => (
          <li key={id}>
            <NavLink to={to} data-testid={id} className={`relative flex flex-col items-center gap-0.5 rounded-full px-2 py-1.5 text-[11px] font-semibold transition-colors ${active ? "bg-primary text-white" : "text-slate-500"}`}>
              <Icon className="h-5 w-5" />{label}
              {id === "bottom-nav-chat" && count > 0 && <span data-testid="mobile-chat-unread" className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] text-white">{count}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
