import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Download, Home, LogOut } from "lucide-react";
import { AdminPush } from "@/components/admin/AdminPush";
import { useChat } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { adminSidebarGroups, adminBadge, useFzrAlerts } from "@/lib/adminNav";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export default function AdminLayout() {
  const { t } = useLang();
  const { count } = useChat();
  const { can, logout } = useAuth();
  const { pathname } = useLocation();
  const [online, setOnline] = useState(false);
  const fzrAlerts = useFzrAlerts();
  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]');
    meta?.setAttribute("content", "noindex,nofollow");
    return () => meta?.setAttribute("content", "index,follow");
  }, []);
  useEffect(() => { api.get("/settings/status").then((r) => setOnline(r.data.online)).catch(() => {}); }, []);
  const toggle = async (v) => { setOnline(v); await api.post("/admin/status", { online: v }).catch(() => setOnline(!v)); };
  const groups = adminSidebarGroups(can);
  const exportCsv = async () => {
    const { data } = await api.get("/admin/export", { responseType: "blob" });
    const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href = url; a.download = "orders.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="pb-[calc(56px+env(safe-area-inset-bottom))] pt-6 lg:pb-16" data-testid="admin-layout">
      <div className="flex flex-wrap items-center gap-4 border-b border-foreground pb-4">
        <div><p className="eyebrow">Magic Game Store</p><h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{t("nav.admin")}</h1></div>
        <label className="ml-auto flex items-center gap-2 border border-foreground bg-card px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em]">
          <span className={`h-2 w-2 ${online ? "bg-primary ring-1 ring-foreground" : "bg-muted-foreground"}`} />{online ? t("admin.online") : t("admin.offline")}
          <Switch checked={online} onCheckedChange={toggle} data-testid="admin-online-toggle" />
        </label>
        <Button variant="outline" size="sm" className="rounded-full" onClick={exportCsv} data-testid="admin-export"><Download className="mr-1 h-4 w-4" />{t("admin.export")}</Button>
        <Button asChild variant="ghost" size="sm" className="rounded-full"><Link to="/">{t("nav.shop")}</Link></Button>
      </div>
      <AdminPush />
      <div className="mt-6 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
        {/* Sidebar desktop (>=1024px) : unique navigation desktop, toutes les
            pages accessibles sans scroll horizontal. Source : ADMIN_NAV.
            Épinglage type X/Twitter : la nav est sticky sous l'en-tête du site
            (h-16 + bordure), à hauteur de viewport moins 16px de marge basse ;
            seuls les groupes défilent (overflow propre), le pied — Boutique +
            Déconnexion — reste fixe hors de la zone scrollée. */}
        <aside className="hidden lg:block">
          <nav
            className="sticky top-16 flex h-[calc(100dvh-4rem-16px)] flex-col gap-4 pb-4"
            data-testid="admin-sidebar"
            aria-label={t("nav.admin")}
          >
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="eyebrow mb-2">{t(g.labelKey)}</p>
                <ul className="space-y-1">
                  {g.items.map((e) => {
                    const badge = adminBadge(e, { chat: count, fzr: fzrAlerts });
                    const Icon = e.icon;
                    const isActive = e.end ? pathname === e.path : pathname.startsWith(e.path);
                    return (
                      <li key={e.key}>
                        <NavLink
                          to={e.path}
                          end={e.end}
                          aria-current={isActive ? "page" : undefined}
                          data-testid={`admin-nav-${e.key}`}
                          className={`flex min-h-[40px] items-center gap-2.5 rounded-[10px] px-3 text-[12px] font-semibold transition-colors ${
                            isActive ? "bg-primary text-ink" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                          <span className="flex-1 truncate">{t(e.labelKey)}</span>
                          {badge > 0 && (isActive
                            ? <span className="ml-auto text-[11px] font-black text-ink">{badge}</span>
                            : <span className="ml-auto rounded-full bg-foreground px-1.5 text-center text-[10px] font-black leading-[18px] text-background">{badge}</span>)}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            </div>
            <div className="flex-none border-t border-[color:var(--rule-strong)] pt-3">
              <Link to="/" data-testid="admin-sidebar-shop" className="flex min-h-[40px] items-center gap-2.5 rounded-[10px] px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Home className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>{t("nav.shop")}</span>
              </Link>
              <button
                type="button"
                onClick={logout}
                data-testid="admin-sidebar-logout"
                className="flex min-h-[40px] w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[12px] font-semibold text-destructive transition-colors hover:bg-muted"
              >
                <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>{t("nav.logout")}</span>
              </button>
            </div>
          </nav>
        </aside>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </div>
  );
}
