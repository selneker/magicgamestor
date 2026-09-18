import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { StatusPill } from "@/pages/OrderTrack";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = ["pending_payment", "awaiting_verification", "paid", "delivered", "cancelled", "failed"];

export default function AdminOrders() {
  const { t } = useLang();
  const [orders, setOrders] = useState([]);
  const [filters, setFilters] = useState({ status: "all", method: "all", q: "" });

  const load = useCallback(() => api.get("/admin/orders", { params: filters }).then((r) => setOrders(r.data)).catch(() => {}), [filters]);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);
  useEffect(() => { const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const setStatus = async (o, status) => {
    try { await api.patch(`/admin/orders/${o.id}`, { status }); toast.success(t(`order.status.${status}`)); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const remove = async (o) => {
    if (!window.confirm(t("admin.confirmDelete"))) return;
    try { await api.delete(`/admin/orders/${o.id}`); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const simulate = async (o, outcome) => {
    try { await api.post(`/payments/${o.id}/simulate`, { outcome }); load(); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div data-testid="admin-orders">
      <div className="flex flex-wrap gap-2">
        <Input data-testid="admin-orders-search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder={t("admin.search")} className="h-10 w-full rounded-full sm:w-72" />
        <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
          <SelectTrigger className="h-10 w-48 rounded-full" data-testid="admin-filter-status"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t("admin.allStatus")}</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`order.status.${s}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.method} onValueChange={(v) => setFilters({ ...filters, method: v })}>
          <SelectTrigger className="h-10 w-44 rounded-full" data-testid="admin-filter-method"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t("admin.allMethods")}</SelectItem><SelectItem value="mvola">MVola</SelectItem><SelectItem value="orange">Orange Money</SelectItem><SelectItem value="manual">USSD</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="rounded-full" onClick={load} data-testid="admin-orders-refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <div className="mt-4 space-y-3">
        {orders.length === 0 && <p className="rounded-2xl bg-white p-6 text-slate-500" data-testid="admin-orders-empty">{t("order.none")}</p>}
        {orders.map((o) => (
          <article key={o.id} data-testid={`admin-order-${o.order_number}`} className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div><p className="font-mono text-sm font-bold text-slate-900">{o.order_number}</p><p className="text-xs text-slate-400">{new Date(o.created_at).toLocaleString("fr-FR")}</p><StatusPill status={o.status} /></div>
            <div className="text-sm">
              <p className="font-semibold text-slate-900">{o.pseudo} · <span className="font-mono">{o.pubg_id}</span></p>
              <p className="text-slate-600">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
              <p className="text-xs text-slate-500">{o.payment_method === "manual" ? `USSD · ${o.manual_reference || ""}` : `${o.payment_method === "mvola" ? "MVola" : "Orange Money"} · ${o.payment_phone || ""}`}{o.email ? ` · ${o.email}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-bold text-slate-900">{formatAr(o.total)}</span>
              <Select value={o.status} onValueChange={(v) => setStatus(o, v)}>
                <SelectTrigger className="h-9 w-44 rounded-full text-xs" data-testid={`admin-status-select-${o.order_number}`}><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`order.status.${s}`)}</SelectItem>)}</SelectContent>
              </Select>
              {o.status !== "delivered" && <Button size="sm" className="rounded-full bg-emerald-600 hover:bg-emerald-700" onClick={() => setStatus(o, "delivered")} data-testid={`admin-deliver-${o.order_number}`}>{t("admin.markDelivered")}</Button>}
              {o.status === "pending_payment" && o.payment_method !== "manual" && (
                <><Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => simulate(o, "completed")} data-testid={`admin-simulate-paid-${o.order_number}`}>{t("admin.forcePaid")}</Button>
                <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => simulate(o, "failed")} data-testid={`admin-simulate-failed-${o.order_number}`}>{t("admin.forceFailed")}</Button></>
              )}
              <Button size="icon" variant="ghost" className="rounded-full text-slate-400 hover:text-rose-600" onClick={() => remove(o)} data-testid={`admin-delete-${o.order_number}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
