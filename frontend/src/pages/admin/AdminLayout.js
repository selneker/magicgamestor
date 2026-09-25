import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { CalendarRange, Coins, Download, LayoutDashboard, Package, PlugZap, ReceiptText, MessageCircle, Users } from "lucide-react";
import { AdminPush } from "@/components/admin/AdminPush";
import { useChat } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export default function AdminLayout() {
  const { t } = useLang();
  const { count } = useChat();
  const { can } = useAuth();
  const [online, setOnline] = useState(false);
  const [fzrAlerts, setFzrAlerts] = useState(0);
  useEffect(() => { api.get("/settings/status").then((r) => setOnline(r.data.online)).catch(() => {}); }, []);
  useEffect(() => { api.get("/admin/fazercards/price-alerts", { params: { limit: 1 } }).then((r) => setFzrAlerts(r.data.unacknowledged)).catch(() => {}); }, []);
  const toggle = async (v) => { setOnline(v); await api.post("/admin/status", { online: v }).catch(() => setOnline(!v)); };
  const tabs = [
    ["/admin", LayoutDashboard, t("admin.dashboard"), "admin-tab-dashboard", true],
    ["/admin/commandes", ReceiptText, t("admin.orders"), "admin-tab-orders"],
    ["/admin/catalogue", Package, t("admin.products"), "admin-tab-products"],
    ["/admin/fournisseur", PlugZap, `${t("admin.fzr.tab")}${fzrAlerts ? ` (${fzrAlerts})` : ""}`, "admin-tab-fzr"],
    ["/admin/evenements", CalendarRange, t("admin.events"), "admin-tab-events"],
    ["/admin/messages", MessageCircle, `Chat${count ? ` (${count})` : ""}`, "admin-tab-chat"],
    ["/admin/fidelite", Coins, "Fidélité", "admin-tab-loyalty"],
    ...(can("users.manage") ? [["/admin/utilisateurs", Users, "Utilisateurs", "admin-tab-users"]] : []),
  ];
  const exportCsv = async () => {
    const { data } = await api.get("/admin/export", { responseType: "blob" });
    const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href = url; a.download = "orders.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="pb-16 pt-6" data-testid="admin-layout">
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
      <nav className="no-scrollbar mt-6 flex gap-2 overflow-x-auto">
        {tabs.map(([to, Icon, label, id, end]) => (
          <NavLink key={to} to={to} end={end} data-testid={id} className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 border border-foreground px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition-colors ${isActive ? "bg-primary text-[#0A0A0A]" : "bg-card text-muted-foreground hover:bg-foreground hover:text-background"}`}><Icon className="h-3.5 w-3.5" strokeWidth={2} />{label}</NavLink>
        ))}
      </nav>
      <div className="mt-6"><Outlet /></div>
    </div>
  );
}
