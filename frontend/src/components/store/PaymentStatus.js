import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

// The Ariary amount follows the active language (fr: "2 500", en: "2,500").
// Intl is used directly rather than a hardcoded "fr-FR".
const formatAmount = (value, lang) =>
  `${Number(value || 0).toLocaleString(lang || "fr").replace(/\u202f/g, " ")} Ar`;

export function PaymentStatus({ order, onRetry, onCompleted }) {
  const { t, lang } = useLang();
  const [state, setState] = useState("pending");
  const [simulated, setSimulated] = useState(!!order.simulated);
  const timer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await api.get(`/payments/${order.id}/status`);
        if (cancelled) return;
        setSimulated(data.simulated);
        if (data.payment_status === "completed") return setState("completed");
        if (data.payment_status === "expired") return setState("expired");
        if (["failed", "cancelled"].includes(data.payment_status)) return setState("failed");
      } catch (_) { /* keep polling */ }
      timer.current = setTimeout(poll, 3000);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [order.id]);

  useEffect(() => {
    if (state === "completed" && onCompleted) onCompleted();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const trackUrl = `/suivi/${order.order_number}?pubg_id=${order.pubg_id}`;
  const color = order.payment_method === "mvola" ? "var(--mvola)" : "var(--orange)";

  // A single heading for every state, so the live region is the same DOM node
  // throughout: its text changes once per state change, never on each poll.
  const statusTitle =
    state === "pending" ? t("checkout.waiting")
      : state === "completed" ? t("checkout.success")
        : state === "expired" ? t("checkout.expired")
          : t("checkout.failed");
  const statusTestId =
    state === "completed" ? "payment-success"
      : state === "expired" ? "payment-expired"
        : state === "failed" ? "payment-failed"
          : undefined;

  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-md rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-8 text-center" data-testid="payment-status">
      {state === "pending" && (
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ color }}>
          {/* Tinted disc as a separate layer with opacity rather than color-mix():
              the production browserslist still targets Chrome 109 and UC 15.5,
              which do not support color-mix(). */}
          <span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ background: color, opacity: 0.12 }} />
          <Smartphone className="h-9 w-9 animate-pulse" />
        </div>
      )}
      {state === "completed" && <CheckCircle2 className="mx-auto h-20 w-20 text-emerald-500" />}
      {(state === "failed" || state === "expired") && <XCircle className="mx-auto h-20 w-20 text-rose-500" />}

      <h2 role="status" aria-live="polite" className="mt-6 font-display text-2xl font-bold text-foreground" data-testid={statusTestId}>{statusTitle}</h2>

      {state === "pending" && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{order.payment_method === "mvola" ? "MVola" : "Orange Money"} · {order.payment_phone}</p>
          <p className="mt-1 font-display text-3xl font-bold text-foreground">{formatAmount(order.total, lang)}</p>
          {simulated && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="simulation-notice">{t("checkout.simulated")}</p>}
          <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-muted-foreground" />
        </>
      )}
      {state === "completed" && (
        <>
          <p className="mt-2 text-muted-foreground">{t("order.next.paid")}</p>
          <p className="mt-4 inline-block rounded-full bg-muted px-4 py-1 font-mono text-sm font-bold" data-testid="order-number">{order.order_number}</p>
          <Button asChild className="mt-6 h-12 w-full rounded-full font-bold" data-testid="view-order-button"><Link to={trackUrl}>{t("checkout.viewOrder")}</Link></Button>
        </>
      )}
      {(state === "failed" || state === "expired") && (
        <>
          <p className="mt-2 text-muted-foreground">{state === "expired" ? t("order.next.expired") : t("order.next.failed")}</p>
          <Button onClick={onRetry} variant="outline" className="mt-6 h-12 w-full rounded-full font-bold" data-testid="retry-payment-button">{t("checkout.retry")}</Button>
        </>
      )}
    </motion.div>
  );
}
