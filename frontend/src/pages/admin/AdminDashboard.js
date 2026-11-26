import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { api, formatAr } from "@/lib/api";
import { paymentLabel } from "@/lib/paymentLabels";
import { useLang } from "@/context/LanguageContext";

export default function AdminDashboard() {
  const { t, lang } = useLang();
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {}); }, []);
  if (!stats) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  const cards = [
    [t("admin.revenue"), formatAr(stats.revenue, lang), "stat-revenue"],
    [t("admin.total"), stats.total_orders, "stat-total"],
    [t("admin.pending"), stats.status_count.paid + stats.status_count.awaiting_verification, "stat-pending"],
    [t("admin.delivered"), stats.status_count.delivered, "stat-delivered"],
    [t("admin.customers"), stats.customers, "stat-customers"],
  ];
  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map(([label, value, id]) => (
          <div key={id} data-testid={id} className="min-w-0 rounded-[10px] border border-[color:var(--foreground)] bg-card p-4 sm:p-5"><p className="eyebrow truncate">{label}</p><p className="num mt-3 break-words text-xl sm:text-2xl lg:text-3xl">{value}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-[10px] border-2 border-[color:var(--foreground)] bg-card p-5" data-testid="stat-pending-payment">
        <div>
          <p className="eyebrow">{t("admin.pendingPayment")}</p>
          <p className="num mt-2 text-3xl sm:text-4xl" data-testid="stat-pending-count">{stats.pending_payment_count ?? 0}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow">{t("admin.pendingTotal")}</p>
          <p className="num mt-2 text-3xl text-foreground sm:text-4xl" data-testid="stat-pending-usd">${Number(stats.pending_payment_usd || 0).toFixed(2)}</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[10px] border border-[color:var(--foreground)] bg-card p-5">
          <h2 className="font-display text-lg font-bold text-foreground">{t("admin.last14")}</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.daily}><XAxis dataKey="_id" tick={{ fontSize: 10, fill: "var(--color--dark)" }} tickFormatter={(d) => d.slice(5)} /><Tooltip formatter={(v) => formatAr(v, lang)} /><Bar dataKey="revenue" fill="var(--pubg)" stroke="var(--color--dark)" /></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-[10px] border border-[color:var(--foreground)] bg-card p-5">
          <h2 className="font-display text-lg font-bold text-foreground">{t("admin.topProducts")}</h2>
          <ul className="mt-4 space-y-2">
            {stats.top_products.map((p) => <li key={p._id} className="flex justify-between rounded-xl bg-card px-3 py-2 text-sm"><span className="font-semibold">{p._id}</span><span className="text-muted-foreground">×{p.qty}</span></li>)}
            {stats.top_products.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
          </ul>
          <div className="mt-4 flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-card px-3 py-1 text-foreground">MVola {stats.by_method.mvola || 0}</span>
            <span className="rounded-full bg-card px-3 py-1 text-foreground">Orange {stats.by_method.orange || 0}</span>
            <span className="rounded-full bg-card px-3 py-1 text-foreground">USSD {stats.by_method.manual || 0}</span>
            <span className="rounded-full bg-card px-3 py-1 text-foreground">{paymentLabel("binance", t)} {stats.by_method.binance || 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
