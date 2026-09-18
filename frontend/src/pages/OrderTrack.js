import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, PackageCheck, Search, XCircle } from "lucide-react";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STYLE = {
  pending_payment: ["bg-amber-50 text-amber-700", Clock], awaiting_verification: ["bg-sky-50 text-sky-700", Clock],
  paid: ["bg-emerald-50 text-emerald-700", CheckCircle2], delivered: ["bg-emerald-600 text-white", PackageCheck],
  cancelled: ["bg-slate-100 text-slate-600", XCircle], failed: ["bg-rose-50 text-rose-700", XCircle],
};

export function StatusPill({ status }) {
  const { t } = useLang();
  const [cls, Icon] = STYLE[status] || STYLE.pending_payment;
  return <span data-testid={`status-${status}`} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${cls}`}><Icon className="h-3.5 w-3.5" />{t(`order.status.${status}`)}</span>;
}

export function OrderCard({ order }) {
  const { t, lang } = useLang();
  return (
    <article data-testid={`order-card-${order.order_number}`} className="rounded-[2rem] border border-slate-100 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("order.number")}</p><p className="font-mono text-lg font-bold text-slate-900">{order.order_number}</p></div>
        <StatusPill status={order.status} />
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="order-next-step">{t(`order.next.${order.status}`)}</p>
      <ul className="mt-4 divide-y text-sm">
        {order.items.map((i, idx) => <li key={idx} className="flex justify-between py-2"><span>{i.quantity} × {lang === "en" && i.name_en ? i.name_en : i.name}</span><span className="font-semibold">{formatAr(i.line_total)}</span></li>)}
      </ul>
      <div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-sm text-slate-500">
        <span>PUBG ID <b className="text-slate-900">{order.pubg_id}</b> · {order.pseudo}</span>
        <span className="capitalize">{order.payment_method === "orange" ? "Orange Money" : order.payment_method === "mvola" ? "MVola" : "USSD"}</span>
        <span>{new Date(order.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")}</span>
        <span className="font-display text-lg font-bold text-slate-900">{formatAr(order.total)}</span>
      </div>
    </article>
  );
}

export default function OrderTrack() {
  const { t } = useLang();
  const { user } = useAuth();
  const { orderNumber } = useParams();
  const [params] = useSearchParams();
  const [number, setNumber] = useState(orderNumber || "");
  const [pubgId, setPubgId] = useState(params.get("pubg_id") || "");
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async (n = number, p = pubgId) => {
    if (!n || !p) return;
    setBusy(true); setError(""); setOrder(null);
    try { const { data } = await api.get("/orders/track", { params: { order_number: n, pubg_id: p } }); setOrder(data); }
    catch (e) { setError(e.response?.status === 404 ? t("order.notFound") : errorMessage(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (orderNumber && params.get("pubg_id")) search(orderNumber, params.get("pubg_id")); }, [orderNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!order || !["pending_payment"].includes(order.status)) return;
    const id = setInterval(() => search(order.order_number, order.pubg_id), 5000);
    return () => clearInterval(id);
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-2xl pb-24 pt-6">
      <h1 className="font-display text-3xl font-bold text-slate-900 sm:text-4xl">{t("order.track")}</h1>
      {user && <p className="mt-1 text-sm text-slate-500"><Link to="/compte" className="font-semibold text-primary" data-testid="go-to-account">{t("account.orders")} →</Link></p>}
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="mt-6 grid gap-3 rounded-[2rem] border border-slate-100 bg-white p-5 sm:grid-cols-[1fr_1fr_auto]" data-testid="track-form">
        <Input data-testid="track-order-number" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="MGS-XXXXXX" className="h-12 rounded-xl font-mono" required />
        <Input data-testid="track-pubg-id" value={pubgId} onChange={(e) => setPubgId(e.target.value.replace(/\D/g, ""))} placeholder={t("checkout.pubgId")} className="h-12 rounded-xl" required inputMode="numeric" />
        <Button type="submit" disabled={busy} className="h-12 rounded-xl px-5 font-bold" data-testid="track-submit"><Search className="mr-2 h-4 w-4" />{t("order.find")}</Button>
      </form>
      {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" data-testid="track-error">{error}</p>}
      {order && <div className="mt-6"><OrderCard order={order} /></div>}
    </div>
  );
}
