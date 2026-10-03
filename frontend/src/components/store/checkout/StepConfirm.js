import { Link } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OrderSummary({ summary }) {
  const { t } = useLang();
  return (
    <div className="space-y-3 rounded-[18px] border-2 border-[color:var(--rule)] bg-card p-4 text-sm" data-testid="checkout-summary">
      <Row label={t("checkout.product")}><div className="text-right">{summary.lines.map((l) => <p key={l.key} className="font-semibold">{l.label}</p>)}</div></Row>
      <Row label={t("checkout.playerId")}><span className="num font-semibold" data-testid="confirm-player-id">{summary.pubgId}{summary.name ? ` · ${summary.name}` : ""}</span></Row>
      <Row label={t("checkout.methodCol")}><span className="font-semibold" data-testid="confirm-method">{summary.method}</span></Row>
      <Row label={t("checkout.amount")}><span className="font-semibold">{formatAr(summary.subtotal)}</span></Row>
      <Row label={t("checkout.paymentFee")}><span className="font-semibold" data-testid="confirm-fee">{formatAr(summary.fee)}</span></Row>
      <div className="flex items-center justify-between border-t-2 border-[color:var(--rule)] pt-2 text-base font-bold">
        <span>{t("checkout.total")}</span><span className="num" data-testid="confirm-total">{formatAr(summary.subtotal + summary.fee)}</span>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">{label}</span>{children}</div>;
}

export function OrderDone({ order, trackUrl }) {
  const { t } = useLang();
  return (
    <section className="rounded-[22px] border-2 border-foreground bg-card p-6 text-center" data-testid="checkout-done">
      <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
      <h2 className="mt-4 font-display text-2xl font-bold">{t("checkout.orderConfirmed")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("checkout.orderPaidAuto")}</p>
      <p className="mt-4 inline-block rounded-full bg-muted px-4 py-1 font-mono text-sm font-bold" data-testid="checkout-done-order-number">{order.order_number}</p>
      <Button asChild className="mt-6 h-12 w-full rounded-full font-bold" data-testid="checkout-done-view-order"><Link to={trackUrl}>{t("checkout.viewOrder")}</Link></Button>
    </section>
  );
}

export function StepConfirm({ method, order, trackUrl, summary, reference, setReference, busy, onConfirm }) {
  const { t } = useLang();
  if (method !== "manual") return order ? <OrderDone order={order} trackUrl={trackUrl} /> : null;
  return (
    <section className="space-y-4" data-testid="checkout-step-confirm">
      <div className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6">
        <label className="font-display text-lg font-bold" htmlFor="manual-reference">{t("checkout.reference")}</label>
        <Input id="manual-reference" data-testid="manual-reference" value={reference.value || ""} onChange={(e) => setReference({ ...reference, value: e.target.value })} placeholder="Ex : Ref 1148190***" className="mt-2 h-12 rounded-[12px]" />
        <p className="mt-1 text-xs text-muted-foreground">{t("checkout.refHint")}</p>
      </div>
      <OrderSummary summary={summary} />
      <Button type="button" onClick={onConfirm} disabled={busy || !(reference.value || "").trim()} data-testid="confirm-order-button" className="h-12 w-full rounded-full text-base font-bold">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checkout.processing")}</> : t("checkout.confirmOrder")}
      </Button>
    </section>
  );
}
