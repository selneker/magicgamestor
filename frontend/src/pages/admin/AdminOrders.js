import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { paymentLabel, paymentOperatorLabel } from "@/lib/paymentLabels";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { StatusPill } from "@/pages/OrderTrack";
import { OrderProofs } from "@/pages/admin/OrderProofs";
import { FzrFulfillment, lineRecord, repRecord, lineSendable } from "@/components/admin/FzrFulfillment";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyButton } from "@/components/admin/CopyButton";

// PL-CHK-2 — proof_submitted et late_payment ajoutés aux filtres et aux
// transitions (miroir exact de routers/orders.py).
const STATUSES = ["pending_payment", "awaiting_verification", "proof_submitted", "late_payment", "paid", "delivered", "cancelled", "failed", "expired"];
// Mirrors backend TRANSITIONS in routers/orders.py
const TRANSITIONS = {
  pending_payment: ["paid", "cancelled", "failed", "expired", "proof_submitted", "late_payment"],
  awaiting_verification: ["paid", "delivered", "cancelled", "failed"],
  proof_submitted: ["paid", "delivered", "cancelled", "failed"],
  late_payment: ["paid", "cancelled"],
  paid: ["delivered", "cancelled"], failed: ["paid", "cancelled"], expired: ["paid", "cancelled", "late_payment"],
  delivered: [], cancelled: [],
};
const canDeliver = (s) => TRANSITIONS[s]?.includes("delivered");

// PL-UX-3 — filtre de méthode de paiement.
// Le backend filtre sur `payment_method` (UN seul scalaire :
// `GET /admin/orders` → `query["payment_method"] = method`,
// backend/routers/orders.py). Depuis PL-ORDER-CLIENT-1 (23d035a), MVola et
// Orange Money sont des commandes `payment_method: "manual"` +
// `manual_operator: "mvola" | "orange"` ; PL-CHK-4 (b4c439e) a fait passer le
// tunnel sur ce modèle. Les filtres `method=mvola` / `method=orange` ne
// renvoient donc PLUS AUCUNE commande — seul « USDT » répondait. Le backend
// n'expose AUCUN paramètre d'opérateur : on n'invente rien.
// → Les méthodes sont toutes restaurées dans le sélecteur, et le filtre
// opérateur est appliqué côté client sur la fenêtre renvoyée par l'API
// (les 200 commandes les plus récentes : `limit` par défaut du serveur).
// La limite est affichée dans l'admin (data-testid
// `admin-method-operator-note`), jamais cachée.
export const METHOD_FILTERS = [
  { value: "all", label: (t) => t("admin.allMethods") },
  { value: "mvola", label: () => "MVola" },
  { value: "orange", label: () => "Orange Money" },
  { value: "manual", label: (t) => paymentLabel("manual", t) },
  { value: "binance", label: (t) => paymentLabel("binance", t) },
];

// Filtres « opérateur » : le serveur ne sait pas les exprimer.
export const OPERATOR_METHOD_FILTERS = ["mvola", "orange"];
export const isOperatorFilter = (method) => OPERATOR_METHOD_FILTERS.includes(method);

// Opérateur d'une commande : `manual_operator` pour les commandes manuelles
// nouvelles, `payment_method` pour les commandes antérieures (mvola|orange).
export const orderOperator = (o) => {
  if (o.payment_method === "manual") return o.manual_operator || null;
  if (o.payment_method === "mvola" || o.payment_method === "orange") return o.payment_method;
  return null;
};

// Filtre opérateur appliqué à la liste reçue de l'API.
export const filterOrdersByMethod = (orders, method) =>
  (isOperatorFilter(method) ? orders.filter((o) => orderOperator(o) === method) : orders);

// Paramètres envoyés à l'API : pour un filtre opérateur, AUCUN `method`
// (le serveur ne le comprendrait pas et renverrait 0 commande) ; statut et
// recherche restent filtrés côté serveur.
export const adminOrdersParams = (filters) =>
  (isOperatorFilter(filters.method)
    ? { status: filters.status, q: filters.q }
    : { ...filters });

// PL-UX-3 — la limite du filtre opérateur est AFFICHÉE (jamais cachée) :
// le filtre est appliqué côté client, sur la fenêtre renvoyée par l'API.
export function AdminMethodOperatorNote({ method }) {
  const { t } = useLang();
  if (!isOperatorFilter(method)) return null;
  return <p className="mt-2 text-xs text-muted-foreground" data-testid="admin-method-operator-note">{t("admin.methodOperatorNote")}</p>;
}

export default function AdminOrders() {
  const { t } = useLang();
  const { isSuperAdmin } = useAuth();
  const [orders, setOrders] = useState([]);
  const [filters, setFilters] = useState({ status: "all", method: "all", q: "" });
  const [mappedIds, setMappedIds] = useState({});
  const [mapStatus, setMapStatus] = useState({});
  const [mapComponents, setMapComponents] = useState({});
  useEffect(() => {
    api.get("/admin/fazercards/mappings").then(({ data }) => {
      setMappedIds(Object.fromEntries(data.products.filter((p) => p.fulfillable).map((p) => [p.id, true])));
      setMapStatus(Object.fromEntries(data.products.map((p) => [p.id, p.mapping_status])));
      const comps = {};
      data.products.forEach((p) => {
        const m = p.fazercards_mapping;
        if (m && m.mode === "composite" && Array.isArray(m.components)) {
          comps[p.id] = m.components.flatMap((c) => Array.from({ length: c.quantity }, () => ({ offer_name: c.offer_name, offer_id: c.offer_id })));
        }
      });
      setMapComponents(comps);
    }).catch(() => {});
  }, []);
  const readyCount = (o) => {
    if (o.status !== "paid") return 0;
    let n = 0;
    (o.items || []).forEach((it, idx) => {
      const comps = mapComponents[it.product_id];
      const qty = Math.max(1, it.quantity || 1);
      for (let q = 0; q < qty; q++) {
        if (comps?.length) comps.forEach((_, u) => { if (lineSendable(repRecord(o, idx, q, u))) n += 1; });
        else if (mappedIds[it.product_id] && lineSendable(repRecord(o, idx, q, null))) n += 1;
      }
    });
    return n;
  };

  const [params, setParams] = useSearchParams();
  const focusedOrder = params.get("order");
  const [focusError, setFocusError] = useState("");
  const requestFilters = useMemo(() => adminOrdersParams(filters), [filters]);
  const load = useCallback(async () => {
    try {
      const { data } = focusedOrder ? await api.get(`/orders/${encodeURIComponent(focusedOrder)}`) : await api.get("/admin/orders", { params: requestFilters });
      setOrders(focusedOrder ? [data] : data); setFocusError("");
    } catch (e) { if (focusedOrder) { setOrders([]); setFocusError(errorMessage(e)); } }
  }, [requestFilters, focusedOrder]);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);
  useEffect(() => { const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  // Liste affichée : filtre opérateur côté client (le serveur ne le fait pas).
  const visibleOrders = useMemo(() => filterOrdersByMethod(orders, filters.method), [orders, filters.method]);

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
          <SelectContent>{METHOD_FILTERS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label(t)}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="rounded-full" onClick={load} data-testid="admin-orders-refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {/* PL-UX-3 — le filtre opérateur est appliqué côté client (le backend ne
          filtre que par `payment_method`) : la limite est dite, jamais cachée. */}
      <AdminMethodOperatorNote method={filters.method} />
      <div className="mt-4 space-y-3">
        {visibleOrders.length === 0 && <p className="rounded-2xl bg-white p-6 text-slate-500" data-testid="admin-orders-empty">{t("order.none")}</p>}
        {visibleOrders.map((o) => (
          <article key={o.id} data-testid={`admin-order-${o.order_number}`} className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div><p className="flex items-center gap-1 num text-base text-foreground">{o.order_number}<CopyButton value={o.order_number} label="n° de commande" testId={`copy-order-${o.order_number}`} /></p><p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{new Date(o.created_at).toLocaleString("fr-FR")}</p><div className="mt-1"><StatusPill status={o.status} /></div></div>
            <div className="text-sm">
              <p className="flex flex-wrap items-center gap-1 font-semibold text-slate-900">{o.pseudo} · <span className="font-mono">{o.pubg_id}</span><CopyButton value={o.pubg_id} label="PUBG ID" testId={`copy-pubg-${o.order_number}`} /></p>
              <p className="text-slate-600">{o.items.map((i) => `${i.quantity}× ${i.name}${i.season_name ? ` · ${i.season_name}` : ""}${i.week_key ? ` · sem. ${i.week_key}` : ""}`).join(", ")}</p>
              <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">{o.payment_method === "manual" ? <>{paymentLabel(o.payment_method, t)}{o.manual_operator ? <> · {paymentOperatorLabel(o.manual_operator, t)}</> : null}{o.manual_reference ? <> · {o.manual_reference}<CopyButton value={o.manual_reference} label="référence de transaction" testId={`copy-ref-${o.order_number}`} /></> : null}</> : o.payment_method === "binance" ? <>{paymentLabel(o.payment_method, t)}</> : <>{paymentLabel(o.payment_method, t)} · {o.payment_phone || ""}<CopyButton value={o.payment_phone} label="numéro de paiement" testId={`copy-phone-${o.order_number}`} /></>}{o.email ? ` · ${o.email}` : ""}</p>
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
            <FzrFulfillment order={o} mappedIds={mappedIds} mapStatus={mapStatus} mapComponents={mapComponents} readyCount={readyCount(o)} onChanged={load} />
            {/* PL-CHK-2 — preuves de paiement : affichage uniquement, aucune action admin modifiée. */}
            <OrderProofs order={o} />
          </article>
        ))}
      </div>
    </div>
  );
}
