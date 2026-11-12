import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, RefreshCw, Trash2 } from "lucide-react";
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

// PL-UX-5 — une carte par commande, d'après la maquette validée
// (repports/maquettes/apercu-admin-commandes.html) : mobile (≤ 640 px) =
// bloc repliable (en-tête cliquable + chevron 180°, repliée par défaut) ;
// bureau = grille 3 colonnes fixes `215px | 1fr | auto` (18 px), sans
// bouton « Marquer livrée » (le sélecteur de statut appelle exactement la
// même route — voir setStatus). Un seul DOM : sur bureau le bloc replié se
// dissout en cellules de grille (`sm:contents`) et la flèche disparaît.
// Composant dédié : l'état ouvert/fermé est LOCAL à la carte (non
// persistant, repliée par défaut) et survit au rechargement périodique de
// la liste grâce à l'identité React stable (clé = id de commande).
function AdminOrderCard({ order: o, mappedIds, mapStatus, mapComponents, readyCount, isSuperAdmin, onStatus, onRemove, onSimulate, onChanged }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const itemsText = o.items.map((i) => `${i.quantity}× ${i.name}${i.season_name ? ` · ${i.season_name}` : ""}${i.week_key ? ` · sem. ${i.week_key}` : ""}`).join(", ");
  return (
    <article data-testid={`admin-order-${o.order_number}`} className="rounded-[16px] border border-[color:var(--rule)] bg-white px-4 py-[14px] sm:grid sm:grid-cols-[215px_1fr_auto] sm:items-start sm:gap-x-[18px] sm:gap-y-0">
      {/* En-tête. Mobile : la tête du bloc repliable — un <button> PUR (la
          maquette ne met PAS d'icône de copie dans l'en-tête fermé, ce qui
          évite aussi d'imbriquer un bouton de copie dans le bouton de
          repli) : tout l'en-tête est cliquable, chevron bas = fermé,
          chevron haut = ouvert (rotation 180°, 200 ms, coupée sous
          prefers-reduced-motion). Bureau : colonne 1 = div (n° + copie,
          date, badge) — pas de repli sur bureau, donc pas de bouton et
          aria-expanded reste vrai uniquement là où il existe. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`admin-order-body-${o.order_number}`}
        data-testid={`admin-order-toggle-${o.order_number}`}
        className="w-full cursor-pointer text-left focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-foreground sm:hidden"
      >
        <span className="flex items-start justify-between gap-2.5">
          <span className="block min-w-0">
            <span className="num block truncate text-[14px] font-bold text-foreground">{o.order_number}</span>
            <span className="num mt-[2px] block text-[11px] tracking-[0.04em] text-muted-foreground">{`${new Date(o.created_at).toLocaleDateString("fr-FR")} ${new Date(o.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}</span>
            <span className="mt-[7px] block leading-none"><StatusPill status={o.status} small /></span>
          </span>
          <span aria-hidden="true" className="mt-0.5 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-[color:var(--rule-strong)] bg-background text-foreground">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </span>
        </span>
      </button>
      {/* PL-UX-5 (aligné) : la maquette empile chaque colonne en UNE cellule
          (.row + marges internes) — plus aucune gouttière verticale. Les
          lignes homologues des colonnes 1 et 2 sont alignées au pixel :
          produit ↔ date (marge 2 px), paiement/email ↔ badge de statut
          (marge 3 px, hauteurs de ligne fixées à 21/17/21 px). */}
      <div className="hidden min-w-0 sm:col-start-1 sm:row-start-1 sm:row-span-2 sm:block">
        <span className="flex items-center gap-1.5 text-[14px] font-bold text-foreground">
          <span className="num truncate">{o.order_number}</span>
          <CopyButton small value={o.order_number} label="n° de commande" testId={`copy-order-${o.order_number}`} />
        </span>
        <span className="num mt-[2px] block text-[11px] leading-[17px] tracking-[0.04em] text-muted-foreground">{new Date(o.created_at).toLocaleString("fr-FR")}</span>
        <span className="mt-[7px] block leading-none"><StatusPill status={o.status} small /></span>
      </div>

      {/* Ligne résumé du mobile (produit … montant) ; sur bureau, la ligne se
          dissout : seul le montant reste placé (col. 3, l. 1) — le produit
          est rendu dans la pile de la colonne 2 (copie bureau), visible
          uniquement là. */}
      <div className="mt-2 flex items-baseline justify-between gap-3 sm:contents">
        <p className="min-w-0 truncate text-sm text-muted-foreground sm:hidden">{itemsText}</p>
        <p className="num shrink-0 text-[17px] font-extrabold text-foreground sm:col-start-3 sm:row-start-1 sm:text-right" data-testid={`admin-order-total-${o.order_number}`}>{formatAr(o.total)}</p>
      </div>

      {/* Corps replié du mobile ; sur bureau, dissolution en cellules : pile
          colonne 2 (joueur, produit +2 px, paiement +3 px — cellule unique à
          cheval sur les lignes 1-2, alignée au pixel avec la colonne 1),
          actions (col. 3, l. 2, +10 px), bloc Détails (pleine largeur). */}
      <div
        id={`admin-order-body-${o.order_number}`}
        data-testid={`admin-order-body-${o.order_number}`}
        className={`${open ? "block" : "hidden"} min-w-0 border-t border-[color:var(--rule)] pt-2.5 sm:contents`}
      >
        <div className="min-w-0 sm:col-start-2 sm:row-span-2 sm:row-start-1">
          <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-slate-900">
            <span className="min-w-0 truncate">{o.pseudo}</span>
            <span aria-hidden="true">·</span>
            <span className="num font-mono">{o.pubg_id}</span>
            <CopyButton small value={o.pubg_id} label="PUBG ID" testId={`copy-pubg-${o.order_number}`} />
          </p>
          {/* Copie bureau de la ligne produit : alignée avec la date/heure
              (col. 1). Sur mobile, la ligne produit du résumé suffit. */}
          <p className="hidden min-w-0 truncate text-sm leading-[21px] text-muted-foreground sm:mt-[2px] sm:block">{itemsText}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground sm:mt-[3px]">
            <span className="shrink-0">
              {o.payment_method === "manual" && o.manual_operator
                ? <>{paymentLabel(o.payment_method, t)} · <span className="font-semibold text-foreground">{paymentOperatorLabel(o.manual_operator, t)}</span></>
                : <span className="font-semibold text-foreground">{paymentLabel(o.payment_method, t)}</span>}
              {o.payment_method === "manual"
                ? (o.manual_reference ? <> · {o.manual_reference} <CopyButton value={o.manual_reference} label="référence de transaction" testId={`copy-ref-${o.order_number}`} /></> : null)
                : (o.payment_method !== "binance" && o.payment_phone ? <> · {o.payment_phone} <CopyButton value={o.payment_phone} label="numéro de paiement" testId={`copy-phone-${o.order_number}`} /></> : null)}
            </span>
            {o.email && (
              <span className="min-w-0 max-w-full basis-full truncate sm:basis-auto" data-testid={`admin-order-email-${o.order_number}`}>
                <span className="hidden sm:inline">· </span>{o.email}
              </span>
            )}
          </p>
        </div>
        {/* Actions : le sélecteur de statut REMPLACE le bouton « Marquer
            livrée » (même route, mêmes effets) ; « Preuves (n) » seulement
            s'il y a au moins une preuve ; suppression réservée super-admin.
            Mobile : sélecteur pleine largeur 44 px, Preuves flexible 44 px,
            suppression 44 px. Bureau : 34 px, rayon 8 px, aligné à droite. */}
        <div className="flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-2 sm:mt-[10px] sm:justify-end">
          <Select value={o.status} onValueChange={(v) => onStatus(o, v)} disabled={!TRANSITIONS[o.status]?.length}>
            <SelectTrigger className="mt-2.5 h-11 w-full rounded-[8px] border-ink font-semibold text-xs sm:mt-0 sm:h-[34px] sm:w-[235px] sm:shrink-0" data-testid={`admin-status-select-${o.order_number}`}><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.filter((s) => s === o.status || TRANSITIONS[o.status]?.includes(s)).map((s) => <SelectItem key={s} value={s}>{t(`order.status.${s}`)}</SelectItem>)}</SelectContent>
          </Select>
          <OrderProofs order={o} className="h-11 flex-1 sm:h-[34px] sm:flex-none" />
          {o.status === "pending_payment" && o.payment_method !== "manual" && (
            <><Button className="h-11 rounded-[8px] text-xs sm:h-[34px]" variant="outline" onClick={() => onSimulate(o, "completed")} data-testid={`admin-simulate-paid-${o.order_number}`}>{t("admin.forcePaid")}</Button>
            <Button className="h-11 rounded-[8px] text-xs sm:h-[34px]" variant="outline" onClick={() => onSimulate(o, "failed")} data-testid={`admin-simulate-failed-${o.order_number}`}>{t("admin.forceFailed")}</Button></>
          )}
          {isSuperAdmin && <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0 rounded-[8px] text-slate-400 hover:text-rose-600 sm:h-[34px] sm:w-[34px]" onClick={() => onRemove(o)} data-testid={`admin-delete-${o.order_number}`}><Trash2 className="h-4 w-4" /></Button>}
        </div>
        <FzrFulfillment order={o} mappedIds={mappedIds} mapStatus={mapStatus} mapComponents={mapComponents} readyCount={readyCount} onChanged={onChanged} />
      </div>
    </article>
  );
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
      <div className="mt-4 space-y-2.5">
        {visibleOrders.length === 0 && <p className="rounded-2xl bg-white p-6 text-slate-500" data-testid="admin-orders-empty">{t("order.none")}</p>}
        {visibleOrders.map((o) => (
          <AdminOrderCard
            key={o.id}
            order={o}
            mappedIds={mappedIds}
            mapStatus={mapStatus}
            mapComponents={mapComponents}
            readyCount={readyCount(o)}
            isSuperAdmin={isSuperAdmin}
            onStatus={setStatus}
            onRemove={remove}
            onSimulate={simulate}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}
