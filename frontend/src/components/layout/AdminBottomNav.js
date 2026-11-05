import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Home, LogOut, MoreHorizontal, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { useLang } from "@/context/LanguageContext";
import { adminBarItems, adminMoreItems, adminBadge, useFzrAlerts } from "@/lib/adminNav";

// Mobile-only admin bottom nav (<1024px). Desktop reads the same ADMIN_NAV
// source of truth for its sidebar (AdminLayout) — never duplicate entries here.
// Android pattern: 4 primary destinations + a `More` sheet grouping the rest
// (including Jeux, which had no mobile entry before the unification).
export function AdminBottomNav() {
  const { pathname, search } = useLocation();
  const { can, logout } = useAuth();
  const { count } = useChat();
  const { t } = useLang();
  const fzrAlerts = useFzrAlerts();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!pathname.startsWith("/admin")) return null;
  // Conversation admin ouverte (MGS-FE-ADMIN-20261105-02) : l'écran
  // conversation est plein écran, la barre du bas est masquée.
  if (pathname.startsWith("/admin/messages") && new URLSearchParams(search).has("c")) return null;

  const counts = { chat: count, fzr: fzrAlerts };
  const primary = adminBarItems(can);
  const secondary = adminMoreItems(can);
  const isActivePath = (e) => (e.end ? pathname === e.path : pathname.startsWith(e.path));

  return (
    <>
      {/* Barre collée au bas (pas flottante) : 5 colonnes égales, 56 px de haut
          + safe-area, cibles >= 44 px. Le contenu de page reçoit un
          padding-bottom équivalent (AdminLayout). État actif : pastille lime
          derrière l'icône uniquement — aucune entrée ne change de largeur. */}
      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden" data-testid="admin-bottom-nav-wrapper">
        <nav
          className="grid h-14 grid-cols-5 items-stretch border-t border-[color:var(--rule)] bg-card pb-[env(safe-area-inset-bottom)]"
          data-testid="admin-bottom-nav"
          aria-label={t("nav.admin")}
        >
          {primary.map((e) => {
            const Icon = e.icon;
            const badge = adminBadge(e, counts);
            const isActive = isActivePath(e);
            return (
              <NavLink
                key={e.key}
                to={e.path}
                end={e.end}
                aria-current={isActive ? "page" : undefined}
                data-testid={`admin-bnav-${e.key}`}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 transition-colors ${
                  isActive ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="relative flex h-7 w-11 items-center justify-center">
                  {isActive && <span className="absolute inset-0 rounded-full bg-primary" aria-hidden="true" />}
                  <Icon className={`relative z-10 h-[18px] w-[18px] ${isActive ? "text-ink" : ""}`} strokeWidth={2} />
                  {badge > 0 && (
                    <span className="absolute -right-1.5 -top-1 z-20 min-w-[14px] rounded-full bg-destructive px-1 text-center text-[9px] font-black leading-[14px] text-destructive-foreground">{badge}</span>
                  )}
                </span>
                <span className="max-w-full text-center text-[11px] font-semibold leading-none">{t(e.shortLabelKey)}</span>
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-testid="admin-bnav-more"
            aria-expanded={moreOpen}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 transition-colors ${
              moreOpen ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <span className="relative flex h-7 w-11 items-center justify-center">
              <MoreHorizontal className="relative z-10 h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <span className="max-w-full text-center text-[11px] font-semibold leading-none">{t("admin.short.more")}</span>
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
              className="fixed inset-0 z-[60] bg-foreground/35 backdrop-blur-xl lg:hidden"
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
              className="fixed inset-x-0 bottom-0 z-[61] border bg-card text-card-foreground pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden"
              style={{ borderRadius: "16px 16px 0 0" }}
            >
              <header className="flex items-center justify-between gap-3 border-b bg-foreground px-4 py-3 text-background">
                <p className="font-display text-sm font-semibold uppercase tracking-tight">{t("admin.more")}</p>
                <button type="button" onClick={() => setMoreOpen(false)} aria-label={t("common.close")} data-testid="admin-more-close" className="rounded-[8px] p-1 transition-colors hover:text-primary"><X className="h-5 w-5" strokeWidth={2} /></button>
              </header>
              <ul className="divide-y p-2">
                {secondary.map((e) => {
                  const Icon = e.icon;
                  const badge = adminBadge(e, counts);
                  return (
                    <li key={e.key}>
                      <Link to={e.path} onClick={() => setMoreOpen(false)} data-testid={`admin-bnav-${e.key}`} className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted">
                        <span className="flex h-9 w-9 items-center justify-center border border-[color:var(--rule-strong)] bg-background"><Icon className="h-4 w-4" strokeWidth={1.75} /></span>
                        <span className="flex-1 text-sm font-semibold">{t(e.labelKey)}</span>
                        {badge > 0 && (
                          <span className="rounded-full bg-foreground px-1.5 text-center text-[10px] font-black leading-[18px] text-background">{badge}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
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
