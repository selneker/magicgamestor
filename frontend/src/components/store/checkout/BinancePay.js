import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Diamond, KV } from "@/components/store/PaymentFlow";

const POLL_MS = 8000;

// PL-CHK-5 — BinancePay refait selon l'écran 6 de `apercu-checkout-binance.html`
// (maquette fait foi) : deux étapes numérotées — ① montant exact / réseau /
// adresse (tronquée au MILIEU « TXyz…R7k2 », la copie prend la valeur
// COMPLÈTE), ② « Le paiement est détecté automatiquement. Aucune preuve à
// envoyer. » — puis le bouton fixé « En attente du paiement… » (rendu par le
// parent). Toute la logique existante est conservée : sondage
// GET /crypto/{id}/status (détection automatique), JAMAIS de 2ᵉ initiation,
// onConfirmed au statut CONFIRMED. L'écran tient dans 360 × 640 (plus de QR ni
// de grande carte).
const truncateMiddle = (s = "") => (s.length <= 12 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`);

export function BinancePay({ payment, orderId, onConfirmed, trackUrl }) {
  const { t } = useLang();
  const [p, setP] = useState(payment);
  const [detected, setDetected] = useState(payment?.status === "DETECTED");

  useEffect(() => {
    let stop = false;
    let timer;
    const poll = async () => {
      try {
        const { data } = await api.get(`/crypto/${orderId}/status`);
        if (stop) return;
        if (data.payment) {
          setP(data.payment);
          if (data.payment.status === "DETECTED") setDetected(true);
        }
        if (data.payment?.status === "CONFIRMED") return onConfirmed();
        if (data.payment?.status === "FAILED") return;
      } catch (_) { /* keep polling */ }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paiement refusé (logique existante conservée) : écran dédié compact.
  if (p.status === "FAILED") {
    return (
      <section className="mt-4 rounded-[18px] border border-[color:var(--rule)] bg-card p-4 text-center" data-testid="crypto-failed">
        <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold">{t("checkout.cryptoFailed")}</p>
        <Button asChild variant="outline" className="mt-3 h-11 w-full rounded-full font-bold"><Link to={trackUrl}>{t("checkout.viewOrder")}</Link></Button>
      </section>
    );
  }

  return (
    // Étapes numérotées (mêmes losanges 22 px / filet / copie nue que le
    // paiement manuel — composants partagés PaymentFlow).
    <section className="relative mt-5 pl-[34px]" data-testid="checkout-step-pay-binance">
      <span className="absolute bottom-4 left-[11px] top-3.5 w-px bg-[color:var(--rule-strong)]" aria-hidden="true" />
      <div className="relative mb-4">
        <Diamond n={1} />
        <h3 className="text-[16px] font-bold leading-[27px]" data-testid="crypto-amount-title">{t("checkout.binanceExactTitle")}</h3>
        <div className="mt-1">
          <KV label={t("checkout.binanceExactAmount")} value={`${p.amount_usdt} USDT`} copyValue={p.amount_usdt} testId="crypto-amount" />
          <KV label={t("checkout.binanceNetwork")} value={p.network} copyValue={p.network} testId="crypto-network" />
          <KV label={t("checkout.binanceAddress")} value={truncateMiddle(p.address)} copyValue={p.address} testId="crypto-address" />
          {p.memo && <KV label={t("checkout.binanceMemo")} value={p.memo} copyValue={p.memo} testId="crypto-memo" />}
        </div>
      </div>
      <div className="relative">
        <Diamond n={2} />
        {/* Détection automatique — jamais de preuve à envoyer. Quand le
            provider signale la transaction (DETECTED), un accusé est affiché
            sous le texte. */}
        <p className="text-[14px] font-medium leading-snug text-muted-foreground" data-testid="resume-binance-noproof">{t("checkout.binanceNoProof")}</p>
        {detected && (
          <p className="mt-2 flex items-center gap-2 text-[13px] font-bold" data-testid="crypto-detected">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("checkout.cryptoDetected")}
          </p>
        )}
      </div>
    </section>
  );
}
