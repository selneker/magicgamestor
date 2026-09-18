import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { CalendarRange, Download, LayoutDashboard, Package, ReceiptText } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export default function AdminLayout() {
  const { t } = useLang();
  const [online, setOnline] = useState(false);
  useEffect(() => { api.get("/settings/status").then((r) => setOnline(r.data.online)).catch(() => {}); }, []);
  const toggle = async (v) => { setOnline(v); await api.post("/admin/status", { online: v }).catch(() => setOnline(!v)); };
  const tabs = [
    ["/admin", LayoutDashboard, t("admin.dashboard"), "admin-tab-dashboard", true],
    ["/admin/commandes", ReceiptText, t("admin.orders"), "admin-tab-orders"],
    ["/admin/catalogue", Package, t("admin.products"), "admin-tab-products"],
    ["/admin/evenements", CalendarRange, t("admin.events"), "admin-tab-events"],
  ];
  const exportCsv = async () => {
    const { data } = await api.get("/admin/export", { responseType: "blob" });
    const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href = url; a.download = "orders.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="pb-16 pt-6" data-testid="admin-layout">
      <div className="flex flex-wrap items-center gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Magic Game Store</p><h1 className="font-display text-3xl font-bold text-slate-900">{t("nav.admin")}</h1></div>
        <label className="ml-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-200">
          <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />{online ? t("admin.online") : t("admin.offline")}
          <Switch checked={online} onCheckedChange={toggle} data-testid="admin-online-toggle" />
        </label>
        <Button variant="outline" size="sm" className="rounded-full" onClick={exportCsv} data-testid="admin-export"><Download className="mr-1 h-4 w-4" />{t("admin.export")}</Button>
        <Button asChild variant="ghost" size="sm" className="rounded-full"><Link to="/">{t("nav.shop")}</Link></Button>
      </div>
      <nav className="no-scrollbar mt-6 flex gap-2 overflow-x-auto">
        {tabs.map(([to, Icon, label, id, end]) => (
          <NavLink key={to} to={to} end={end} data-testid={id} className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}><Icon className="h-4 w-4" />{label}</NavLink>
        ))}
      </nav>
      <div className="mt-6"><Outlet /></div>
    </div>
  );
}
