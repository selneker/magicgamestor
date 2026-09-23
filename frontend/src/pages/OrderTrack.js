import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, PackageCheck, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STYLE = {
  pending_payment: ["border-foreground bg-transparent text-foreground", Clock],
  awaiting_verification: ["border-foreground bg-transparent text-foreground", Clock],
  paid: ["border-[#0A0A0A] bg-primary text-[#0A0A0A]", CheckCircle2],
  delivered: ["border-foreground bg-foreground text-background", PackageCheck],
  cancelled: ["border-foreground/40 bg-transparent text-muted-foreground line-through", XCircle],
  failed: ["border-destructive bg-destructive text-destructive-foreground", XCircle],
  expired: ["border-foreground/40 bg-transparent text-muted-foreground", Clock],
};

export function StatusPill({ status }) {
  const { t } = useLang();
  const [cls, Icon] = STYLE[status] || STYLE.pending_payment;
  return <span data-testid={`status-${status}`} className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${cls}`}><Icon className="h-3 w-3" strokeWidth={2.25} />{t(`order.status.${status}`)}</span>;
}

export function OrderCard({ order }) {
  const { t, lang } = useLang();
  return (
    <article data-testid={`order-card-${order.order_number}`} className="border border-foreground bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">{t("order.number")}</p><p className="num text-xl">{order.order_number}</p></div>
        <StatusPill status={order.status} />
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="order-next-step">{t(`order.next.${order.status}`)}</p>
      {order.late_payment && <p className="mt-2 rounded-xl border border-strong px-3 py-2 text-xs" data-testid="order-late-payment">{t("order.latePayment")}</p>}
      <ul className="mt-4 divide-y text-sm">
        {order.items.map((i, idx) => <li key={idx} className="flex justify-between py-2"><span>{i.quantity} × {lang === "en" && i.name_en ? i.name_en : i.name}</span><span className="font-semibold">{formatAr(i.line_total)}</span></li>)}
      </ul>
      <div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-sm text-slate-500">
        <span>PUBG ID <b className="text-slate-900">{order.pubg_id}</b> · {order.pseudo}</span>
        <span className="capitalize">{order.payment_method === "orange" ? "Orange Money" : order.payment_method === "mvola" ? "MVola" : "USSD"}</span>
        <span>{new Date(order.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")}</span>
        <span className="num text-xl text-foreground">{formatAr(order.total)}</span>
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
  const [history, setHistory] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!user) { setHistory(null); return; }
    api.get("/orders/me").then((r) => setHistory(r.data)).catch(() => setHistory([]));
  }, [user]);

  const search = async (n = number, p = pubgId) => {
    if (!n || !p) return;
    setBusy(true); setError(""); setOrder(null);
    try { const { data } = await api.get("/orders/track", { params: { order_number: n, pubg_id: p } }); setOrder(data); }
    catch (e) { setError(e.response?.status === 404 ? t("order.notFound") : errorMessage(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (orderNumber && params.get("pubg_id")) search(orderNumber, params.get("pubg_id")); }, [orderNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const [payInfo, setPayInfo] = useState(null);

  useEffect(() => {
    if (!order || order.status !== "pending_payment" || order.payment_method === "manual") return;
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get(`/payments/${order.id}/status`);
        if (!active) return;
        setPayInfo(data);
        if (data.order_status !== order.status) search(order.order_number, order.pubg_id);
      } catch (_) { /* no payment yet */ }
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(id); };
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      const { data } = await api.post("/payments/initiate", { order_id: order.id });
      if (data.payment_url && !data.simulated) { window.location.assign(data.payment_url); return; }
      search(order.order_number, order.pubg_id);
    } catch (e) { toast.error(errorMessage(e)); } finally { setRetrying(false); }
  };

  useEffect(() => {
    const ret = params.get("return");
    if (ret === "failure") toast.error(t("order.next.failed"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      {order && (
        <div className="mt-6 space-y-3">
          <OrderCard order={order} />
          {order.status === "pending_payment" && payInfo?.payment_url && !payInfo.simulated && (
            <Button asChild className="h-12 w-full rounded-full font-bold" style={{ background: order.payment_method === "mvola" ? "var(--mvola)" : "var(--orange)" }} data-testid="resume-payment-button">
              <a href={payInfo.payment_url}>{t("checkout.resume")}</a>
            </Button>
          )}
          {order.status === "pending_payment" && payInfo?.expires_at && <p className="text-center text-xs text-muted-foreground" data-testid="payment-deadline">{t("checkout.deadline", { time: new Date(payInfo.expires_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) })}</p>}
          {["failed", "expired"].includes(order.status) && order.payment_method !== "manual" && (
            <Button onClick={retry} disabled={retrying} variant="outline" className="h-12 w-full rounded-full font-bold" data-testid="retry-payment-button">{t("checkout.retry")}</Button>
          )}
        </div>
      )}
      {user && history && (
        <section className="mt-12" data-testid="order-history">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-slate-900 sm:text-2xl">{t("order.history")}</h2>
            {history.length > 5 && (
              <button onClick={() => setShowAll((s) => !s)} className="text-sm font-semibold text-primary" data-testid="order-history-toggle">
                {showAll ? t("order.seeLess") : `${t("order.seeAll")} (${history.length})`}
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-slate-100 bg-white p-6 text-sm text-slate-500" data-testid="order-history-empty">{t("order.historyEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {history.slice(0, showAll ? 100 : 5).map((o) => (
                <li key={o.id} data-testid={`history-order-${o.order_number}`} className="rounded-2xl border border-slate-100 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2.5">
                        <span className="num text-lg text-foreground">{o.order_number}</span>
                        <StatusPill status={o.status} />
                      </p>
                      <p className="mt-2 truncate text-sm font-medium text-slate-700">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                      <p className="mt-1.5 text-xs text-slate-500">{new Date(o.created_at).toLocaleString("fr-FR")} · PUBG ID {o.pubg_id}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2.5">
                      <span className="num text-xl text-foreground">{formatAr(o.total)}</span>
                      <Button size="sm" variant="outline" className="h-8 rounded-full px-4 text-xs font-bold" data-testid={`history-track-${o.order_number}`}
                        onClick={() => { setNumber(o.order_number); setPubgId(o.pubg_id); search(o.order_number, o.pubg_id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        {t("order.viewTrack")}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
