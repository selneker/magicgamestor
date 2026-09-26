import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { StatusPill } from "@/pages/OrderTrack";
import { FzrFulfillment, lineRecord, lineSendable } from "@/components/admin/FzrFulfillment";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyButton } from "@/components/admin/CopyButton";

const STATUSES = ["pending_payment", "awaiting_verification", "paid", "delivered", "cancelled", "failed", "expired"];
// Mirrors backend TRANSITIONS in routers/orders.py
const TRANSITIONS = {
  pending_payment: ["paid", "cancelled", "failed", "expired"], awaiting_verification: ["paid", "delivered", "cancelled", "failed"],
  paid: ["delivered", "cancelled"], failed: ["paid", "cancelled"], expired: ["paid", "cancelled"], delivered: [], cancelled: [],
};
const canDeliver = (s) => TRANSITIONS[s]?.includes("delivered");

export default function AdminOrders() {
  const { t } = useLang();
  const { isSuperAdmin } = useAuth();
  const [orders, setOrders] = useState([]);
  const [filters, setFilters] = useState({ status: "all", method: "all", q: "" });
  const [mappedIds, setMappedIds] = useState({});
  const [mapStatus, setMapStatus] = useState({});
  useEffect(() => {
    api.get("/admin/fazercards/mappings").then(({ data }) => {
      setMappedIds(Object.fromEntries(data.products.filter((p) => p.fulfillable).map((p) => [p.id, true])));
      setMapStatus(Object.fromEntries(data.products.map((p) => [p.id, p.mapping_status])));
    }).catch(() => {});
  }, []);
  const readyCount = (o) => (o.status !== "paid" ? 0
    : (o.items || []).filter((it, idx) => it.quantity === 1 && !!mappedIds[it.product_id] && lineSendable(lineRecord(o, idx))).length);

  const [params, setParams] = useSearchParams();
  const focusedOrder = params.get("order");
  const [focusError, setFocusError] = useState("");
  const load = useCallback(async () => {
    try {
      const { data } = focusedOrder ? await api.get(`/orders/${encodeURIComponent(focusedOrder)}`) : await api.get("/admin/orders", { params: filters });
      setOrders(focusedOrder ? [data] : data); setFocusError("");
    } catch (e) { if (focusedOrder) { setOrders([]); setFocusError(errorMessage(e)); } }
  }, [filters, focusedOrder]);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);
  useEffect(() => { const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const setStatus = async (o, status) => {
    try { await api.patch(`/admin/orders/${o.id}`, { status }); toast.success(t(`order.status.${status}`)); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const remove = async (o) => {
    if (!isSuperAdmin) return;
    if (!window.confirm(t("admin.confirmDelete"))) return;
    try { await api.delete(`/admin/orders/${o.id}`); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const simulate = async (o, outcome) => {
    try { await api.post(`/payments/${o.id}/simulate`, { outcome }); load(); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div data-testid="admin-orders">
      {focusedOrder && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary bg-accent p-3" data-testid="notification-order-focus"><span className="text-sm">Commande ouverte depuis la notification</span><Button variant="outline" size="sm" data-testid="admin-orders-show-all" onClick={() => setParams({})}>Toutes les commandes</Button></div>}
      {focusError && <p role="alert" data-testid="notification-order-error" className="mb-3 text-sm text-rose-600">{focusError}</p>}
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
            <div><p className="flex items-center gap-1 num text-base text-foreground">{o.order_number}<CopyButton value={o.order_number} label="n° de commande" testId={`copy-order-${o.order_number}`} /></p><p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{new Date(o.created_at).toLocaleString("fr-FR")}</p><div className="mt-1"><StatusPill status={o.status} /></div></div>
            <div className="text-sm">
              <p className="flex flex-wrap items-center gap-1 font-semibold text-slate-900">{o.pseudo} · <span className="font-mono">{o.pubg_id}</span><CopyButton value={o.pubg_id} label="PUBG ID" testId={`copy-pubg-${o.order_number}`} /></p>
              <p className="text-slate-600">{o.items.map((i) => `${i.quantity}× ${i.name}${i.season_name ? ` · ${i.season_name}` : ""}${i.week_key ? ` · sem. ${i.week_key}` : ""}`).join(", ")}</p>
              <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">{o.payment_method === "manual" ? <>USSD · {o.manual_reference || ""}<CopyButton value={o.manual_reference} label="référence de transaction" testId={`copy-ref-${o.order_number}`} /></> : <>{o.payment_method === "mvola" ? "MVola" : "Orange Money"} · {o.payment_phone || ""}<CopyButton value={o.payment_phone} label="numéro de paiement" testId={`copy-phone-${o.order_number}`} /></>}{o.email ? ` · ${o.email}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-xl text-foreground">{formatAr(o.total)}</span>
              <Select value={o.status} onValueChange={(v) => setStatus(o, v)} disabled={!TRANSITIONS[o.status]?.length}>
                <SelectTrigger className="h-9 w-44 rounded-full text-xs" data-testid={`admin-status-select-${o.order_number}`}><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.filter((s) => s === o.status || TRANSITIONS[o.status]?.includes(s)).map((s) => <SelectItem key={s} value={s}>{t(`order.status.${s}`)}</SelectItem>)}</SelectContent>
              </Select>
              {canDeliver(o.status) && <Button size="sm" onClick={() => setStatus(o, "delivered")} data-testid={`admin-deliver-${o.order_number}`}>{t("admin.markDelivered")}</Button>}
              {o.status === "pending_payment" && o.payment_method !== "manual" && (
                <><Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => simulate(o, "completed")} data-testid={`admin-simulate-paid-${o.order_number}`}>{t("admin.forcePaid")}</Button>
                <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => simulate(o, "failed")} data-testid={`admin-simulate-failed-${o.order_number}`}>{t("admin.forceFailed")}</Button></>
              )}
              {isSuperAdmin && <Button size="icon" variant="ghost" className="rounded-full text-slate-400 hover:text-rose-600" onClick={() => remove(o)} data-testid={`admin-delete-${o.order_number}`}><Trash2 className="h-4 w-4" /></Button>}
            </div>
            <FzrFulfillment order={o} mappedIds={mappedIds} mapStatus={mapStatus} readyCount={readyCount(o)} onChanged={load} />
          </article>
        ))}
      </div>
    </div>
  );
}
