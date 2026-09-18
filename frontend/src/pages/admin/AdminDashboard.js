import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { api, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";

export default function AdminDashboard() {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {}); }, []);
  if (!stats) return <p className="text-slate-500">{t("common.loading")}</p>;
  const cards = [
    [t("admin.revenue"), formatAr(stats.revenue), "text-primary", "stat-revenue"],
    [t("admin.total"), stats.total_orders, "text-slate-900", "stat-total"],
    [t("admin.pending"), stats.status_count.paid + stats.status_count.awaiting_verification, "text-amber-600", "stat-pending"],
    [t("admin.delivered"), stats.status_count.delivered, "text-emerald-600", "stat-delivered"],
    [t("admin.customers"), stats.customers, "text-violet-600", "stat-customers"],
  ];
  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map(([label, value, cls, id]) => (
          <div key={id} data-testid={id} className="rounded-2xl border border-slate-100 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-2 font-display text-2xl font-bold ${cls}`}>{value}</p></div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("admin.last14")}</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.daily}><XAxis dataKey="_id" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} /><Tooltip formatter={(v) => formatAr(v)} /><Bar dataKey="revenue" fill="#007aff" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("admin.topProducts")}</h2>
          <ul className="mt-4 space-y-2">
            {stats.top_products.map((p) => <li key={p._id} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold">{p._id}</span><span className="text-slate-500">×{p.qty}</span></li>)}
            {stats.top_products.length === 0 && <li className="text-sm text-slate-400">—</li>}
          </ul>
          <div className="mt-4 flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[var(--mvola)]/10 px-3 py-1 text-[var(--mvola)]">MVola {stats.by_method.mvola || 0}</span>
            <span className="rounded-full bg-[var(--orange)]/10 px-3 py-1 text-[var(--orange)]">Orange {stats.by_method.orange || 0}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">USSD {stats.by_method.manual || 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
