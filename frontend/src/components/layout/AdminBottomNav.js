import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarRange, Coins, Home, LayoutDashboard, LogOut, MessageCircle, MoreHorizontal, Package, PlugZap, ReceiptText, Users, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { useLang } from "@/context/LanguageContext";

// Mobile-only admin bottom nav — not a client duplicate, uses the Android
// pattern: 4 primary destinations + a `More` sheet grouping the rest.
export function AdminBottomNav() {
  const { pathname } = useLocation();
  const { can, logout } = useAuth();
  const { count } = useChat();
  const { t } = useLang();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!pathname.startsWith("/admin")) return null;

  const primary = [
    { to: "/admin", icon: LayoutDashboard, label: t("admin.dashboard"), id: "admin-bnav-dashboard", end: true },
    { to: "/admin/commandes", icon: ReceiptText, label: t("admin.orders"), id: "admin-bnav-orders" },
    { to: "/admin/catalogue", icon: Package, label: t("admin.products"), id: "admin-bnav-products" },
    { to: "/admin/messages", icon: MessageCircle, label: "Chat", id: "admin-bnav-chat", badge: count },
  ];

  const secondary = [
    { to: "/admin/fournisseur", icon: PlugZap, label: t("admin.fzr.tab"), id: "admin-bnav-fzr" },
    { to: "/admin/evenements", icon: CalendarRange, label: t("admin.events"), id: "admin-bnav-events" },
    { to: "/admin/fidelite", icon: Coins, label: "Fidélité", id: "admin-bnav-loyalty" },
    ...(can("users.manage") ? [{ to: "/admin/utilisateurs", icon: Users, label: "Utilisateurs", id: "admin-bnav-users" }] : []),
  ];

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
        data-testid="admin-bottom-nav-wrapper"
      >
        <nav
          className="liquid-nav pointer-events-auto grid grid-cols-5 items-stretch gap-0 p-1"
          data-testid="admin-bottom-nav"
          aria-label={t("nav.admin")}
        >
          {primary.map(({ to, icon: Icon, label, id, badge, end }) => (
            <NavLink
              key={id}
              to={to}
              end={end}
              data-testid={id}
              className={({ isActive }) =>
                `relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[20px] px-1 text-[9px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                  isActive ? "bg-primary text-[#0A0A0A]" : "text-[#F4F3EE]/75"
                }`
              }
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              <span className="w-full truncate text-center leading-none">{label}</span>
              {badge > 0 && (
                <span className="absolute right-1 top-1 min-w-[14px] rounded-full bg-destructive px-1 text-center text-[9px] font-black leading-[14px] text-destructive-foreground">{badge}</span>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-testid="admin-bnav-more"
            className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[20px] px-1 text-[9px] font-semibold uppercase tracking-[0.06em] transition-colors ${moreOpen ? "bg-primary text-[#0A0A0A]" : "text-[#F4F3EE]/75"}`}
          >
            <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
            <span className="w-full truncate text-center leading-none">{t("admin.more")}</span>
          </button>
        </nav>
      </div>

      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              key="admin-more-backdrop"
              data-testid="admin-more-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-[60] bg-foreground/35 backdrop-blur-xl md:hidden"
            />
            <motion.div
              key="admin-more-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={t("admin.more")}
              data-testid="admin-more-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-[61] border bg-card text-card-foreground pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden"
              style={{ borderRadius: "16px 16px 0 0" }}
            >
              <header className="flex items-center justify-between gap-3 border-b bg-foreground px-4 py-3 text-background">
                <p className="font-display text-sm font-semibold uppercase tracking-tight">{t("admin.more")}</p>
                <button type="button" onClick={() => setMoreOpen(false)} aria-label={t("common.close")} data-testid="admin-more-close" className="rounded-[8px] p-1 transition-colors hover:text-primary"><X className="h-5 w-5" strokeWidth={2} /></button>
              </header>
              <ul className="divide-y p-2">
                {secondary.map(({ to, icon: Icon, label, id }) => (
                  <li key={id}>
                    <Link to={to} onClick={() => setMoreOpen(false)} data-testid={id} className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted">
                      <span className="flex h-9 w-9 items-center justify-center border border-[color:var(--rule-strong)] bg-background"><Icon className="h-4 w-4" strokeWidth={1.75} /></span>
                      <span className="flex-1 text-sm font-semibold">{label}</span>
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/" onClick={() => setMoreOpen(false)} data-testid="admin-bnav-go-shop" className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted">
                    <span className="flex h-9 w-9 items-center justify-center border border-[color:var(--rule-strong)] bg-background"><Home className="h-4 w-4" strokeWidth={1.75} /></span>
                    <span className="flex-1 text-sm font-semibold">{t("nav.shop")}</span>
                  </Link>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={async () => { setMoreOpen(false); await logout(); }}
                    data-testid="admin-bnav-logout"
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <span className="flex h-9 w-9 items-center justify-center border border-[color:var(--rule-strong)] bg-background text-destructive"><LogOut className="h-4 w-4" strokeWidth={1.75} /></span>
                    <span className="flex-1 text-sm font-semibold text-destructive">{t("nav.logout")}</span>
                  </button>
                </li>
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
