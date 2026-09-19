import { NavLink, useLocation } from "react-router-dom";
import { Crown, Receipt, Sparkles, ShoppingCart, MessageCircle } from "lucide-react";
import { useChat } from "@/context/ChatContext";

export function BottomNav() {
  const { count, panelOpen, setPanelOpen } = useChat();
  const { pathname, search } = useLocation();
  const items = [
    { to: "/boutique?type=uc", icon: ShoppingCart, label: "UC", id: "bottom-nav-uc", active: pathname === "/boutique" && !search.includes("prime") },
    { to: "/boutique?type=prime,prime_plus", icon: Crown, label: "Prime", id: "bottom-nav-prime", active: pathname === "/boutique" && search.includes("prime") },
    { to: "/evenements", icon: Sparkles, label: "Events", id: "bottom-nav-events", active: pathname.startsWith("/evenements") },
    { to: "/suivi", icon: Receipt, label: "Suivi", id: "bottom-nav-orders", active: pathname.startsWith("/suivi") || pathname.startsWith("/compte") },
  ];
  if (pathname.startsWith("/admin")) return null;
  const itemClass = (active) => `relative flex min-h-[54px] w-full flex-col items-center justify-center gap-1 overflow-hidden px-0.5 text-[9px] font-bold uppercase tracking-[0.04em] leading-none transition-[background-color,color,transform] duration-200 active:scale-[0.94] ${active ? "liquid-active" : "text-[#F4F3EE]/70"}`;
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden" data-testid="bottom-nav">
      <ul className="liquid-nav pointer-events-auto mx-auto grid max-w-md grid-cols-5 items-stretch gap-1 p-1">
        {items.map(({ to, icon: Icon, label, id, active }) => (
          <li key={id}>
            <NavLink to={to} data-testid={id} aria-current={active ? "page" : undefined} className={itemClass(active)}>
              <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.5 : 1.75} /><span className="truncate">{label}</span>
            </NavLink>
          </li>
        ))}
        <li>
          <button type="button" data-testid="bottom-nav-chat" aria-pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)} className={itemClass(panelOpen || pathname === "/chat")}>
            <MessageCircle className="h-[20px] w-[20px]" strokeWidth={panelOpen ? 2.5 : 1.75} /><span>Chat</span>
            {count > 0 && <span data-testid="mobile-chat-unread" className="absolute right-1.5 top-1 min-w-[18px] bg-primary px-1 text-center text-[10px] font-black leading-[18px] text-[#0A0A0A] ring-1 ring-[#0A0A0A]">{count}</span>}
          </button>
        </li>
      </ul>
    </nav>
  );
}
