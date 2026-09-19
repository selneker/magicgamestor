import { NavLink, useLocation } from "react-router-dom";
import { Crown, Receipt, Sparkles, ShoppingCart } from "lucide-react";

export function BottomNav() {
  const { pathname, search } = useLocation();
  const items = [
    { to: "/boutique?type=uc", icon: ShoppingCart, label: "UC", id: "bottom-nav-uc", active: pathname === "/boutique" && !search.includes("prime") },
    { to: "/boutique?type=prime,prime_plus", icon: Crown, label: "Abonnements", id: "bottom-nav-prime", active: pathname === "/boutique" && search.includes("prime") },
    { to: "/evenements", icon: Sparkles, label: "Événements", id: "bottom-nav-events", active: pathname.startsWith("/evenements") },
    { to: "/suivi", icon: Receipt, label: "Commandes", id: "bottom-nav-orders", active: pathname.startsWith("/suivi") || pathname.startsWith("/compte") },
  ];
  if (pathname.startsWith("/admin")) return null;
  const itemClass = (active) => `relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-[14px] px-1 text-[9px] font-medium uppercase tracking-[0.04em] leading-none transition-[background-color,color,transform] duration-200 active:scale-[0.94] ${active ? "liquid-active font-semibold" : "text-[#F4F3EE]/70"}`;
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden" data-testid="bottom-nav">
      <ul className="liquid-nav pointer-events-auto mx-auto grid max-w-md grid-cols-4 items-stretch gap-1 p-1">
        {items.map(({ to, icon: Icon, label, id, active }) => (
          <li key={id} className="min-w-0">
            <NavLink to={to} data-testid={id} aria-current={active ? "page" : undefined} className={itemClass(active)}>
              <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.5 : 1.75} /><span className="w-full truncate text-center">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
