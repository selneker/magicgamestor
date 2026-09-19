import { NavLink, useLocation } from "react-router-dom";
import { Crown, History, Rss, ShoppingCart, MessageCircle } from "lucide-react";
import { useChat } from "@/context/ChatContext";
import { useLang } from "@/context/LanguageContext";

export function BottomNav() {
  const { t } = useLang();
  const { count, panelOpen, setPanelOpen } = useChat();
  const { pathname, search } = useLocation();
  const items = [
    { to: "/boutique?type=uc", icon: ShoppingCart, label: t("nav.uc"), id: "bottom-nav-uc", active: pathname === "/boutique" && !search.includes("prime") },
    { to: "/boutique?type=prime,prime_plus", icon: Crown, label: t("nav.prime"), id: "bottom-nav-prime", active: pathname === "/boutique" && search.includes("prime") },
    { to: "/evenements", icon: Rss, label: t("nav.events"), id: "bottom-nav-events", active: pathname.startsWith("/evenements") },
    { to: "/suivi", icon: History, label: t("nav.orders"), id: "bottom-nav-orders", active: pathname.startsWith("/suivi") || pathname.startsWith("/compte") },
  ];
  if (pathname.startsWith("/admin")) return null;
  const itemClass = (active) => `relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-[1.25rem] px-1 text-[10.5px] font-semibold leading-tight transition-[background-color,color,transform] duration-200 active:scale-95 ${active ? "liquid-active text-white" : "text-slate-600 dark:text-slate-300"}`;
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden" data-testid="bottom-nav">
      <ul className="liquid-nav pointer-events-auto mx-auto grid max-w-md grid-cols-5 items-stretch gap-1 rounded-[1.75rem] p-1.5">
        {items.map(({ to, icon: Icon, label, id, active }) => (
          <li key={id}>
            <NavLink to={to} data-testid={id} aria-current={active ? "page" : undefined} className={itemClass(active)}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} /><span className="truncate">{label}</span>
            </NavLink>
          </li>
        ))}
        <li>
          <button type="button" data-testid="bottom-nav-chat" aria-pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)} className={itemClass(panelOpen || pathname === "/chat")}>
            <MessageCircle className="h-[22px] w-[22px]" strokeWidth={panelOpen ? 2.4 : 2} /><span>Chat</span>
            {count > 0 && <span data-testid="mobile-chat-unread" className="absolute right-2 top-1 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-white dark:ring-slate-900">{count}</span>}
          </button>
        </li>
      </ul>
    </nav>
  );
}
