import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

// PL-CHK-2 — la branche « manual » (champ référence texte) est retirée : les
// commandes USSD passent désormais par la preuve par captures (ProofPay) et la
// commande est créée à la fin de l'étape Méthode. Ce fichier ne garde que le
// récap (OrderSummary) et l'écran de confirmation finale (OrderDone).

export function OrderSummary({ summary, sticky = false }) {
  const { t } = useLang();
  return (
    // PL-CHK-1 : récap compact sans cadre (bordure 2 px retirée) ; reste
    // collé en haut (sticky top-16) à l'étape 3 pendant le paiement automatique.
    <div className={`space-y-2.5 text-sm ${sticky ? "sticky top-16 z-10 rounded-[14px] bg-[color:hsl(var(--background))] py-2" : ""}`} data-testid="checkout-summary">
      <Row label={t("checkout.product")}><div className="text-right">{summary.lines.map((l) => <p key={l.key} className="font-semibold">{l.label}</p>)}</div></Row>
      <Row label={t("checkout.playerId")}><span className="num font-semibold" data-testid="confirm-player-id">{summary.pubgId}{summary.name ? ` · ${summary.name}` : ""}</span></Row>
      <Row label={t("checkout.methodCol")}><span className="font-semibold" data-testid="confirm-method">{summary.method}</span></Row>
      <Row label={t("checkout.amount")}><span className="font-semibold">{formatAr(summary.subtotal)}</span></Row>
      {summary.method && <Row label={t("checkout.paymentFee")}><span className="font-semibold" data-testid="confirm-fee">{formatAr(summary.fee)}</span></Row>}
      <div className="flex items-center justify-between border-t border-[color:var(--rule)] pt-2.5 text-base font-bold">
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
      <p className="mt-4 text-sm font-semibold">{t("checkout.deliveryReceived")} · {t("checkout.deliveryChecking")} · {t("checkout.deliveryDelivered")}</p>
      <p className="mt-4 inline-block rounded-full bg-muted px-4 py-1 font-mono text-sm font-bold" data-testid="checkout-done-order-number">{order.order_number}</p>
      <Button asChild className="mt-6 h-12 w-full rounded-full font-bold" data-testid="checkout-done-view-order"><Link to={trackUrl}>{t("checkout.viewOrder")}</Link></Button>
    </section>
  );
}

// Étape 4 (Confirmation) : même contrat qu'avant, la prop `method` disparaît
// car manuel n'atterrit plus ici que via onConfirmed (paid/delivered).
export function StepConfirm({ order, trackUrl }) {
  return order ? <OrderDone order={order} trackUrl={trackUrl} /> : null;
}
