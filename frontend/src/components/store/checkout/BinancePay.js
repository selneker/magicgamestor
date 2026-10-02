import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Copy, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";

const POLL_MS = 8000;

export function BinancePay({ payment, orderId, onConfirmed, trackUrl }) {
  const { t } = useLang();
  const [p, setP] = useState(payment);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer;
    const poll = async () => {
      try {
        const { data } = await api.get(`/crypto/${orderId}/status`);
        if (stop) return;
        if (data.payment) setP(data.payment);
        if (data.payment?.status === "CONFIRMED") return onConfirmed();
        if (data.payment?.status === "FAILED") return;
      } catch (_) { /* keep polling */ }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); toast.success(t("common.copied")); } catch { toast.error(t("common.error")); }
  };

  const paid = async () => {
    setChecking(true);
    try {
      const { data } = await api.post(`/crypto/${orderId}/paid`);
      if (data.payment) setP(data.payment);
      if (data.payment?.status === "CONFIRMED") onConfirmed();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  if (p.status === "FAILED") {
    return (
      <section className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-6 text-center" data-testid="crypto-failed">
        <XCircle className="mx-auto h-14 w-14 text-rose-500" />
        <p className="mt-4 font-semibold">{t("checkout.cryptoFailed")}</p>
        <Button asChild variant="outline" className="mt-6 h-12 w-full rounded-full font-bold"><Link to={trackUrl}>{t("checkout.viewOrder")}</Link></Button>
      </section>
    );
  }

  const expires = new Date(p.expires_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="space-y-4" data-testid="checkout-step-pay-binance">
      <div className="rounded-[22px] border-2 border-[color:var(--rule)] bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">{t("checkout.binancePayTitle")}</h2>
          <span className="rounded-full border border-foreground bg-primary px-3 py-1 text-xs font-black text-[#0A0A0A]" data-testid="crypto-network">{p.network}</span>
        </div>
        <Field label={t("checkout.amount")} value={`${p.amount_usdt} USDT`} testId="crypto-amount" onCopy={() => copy(p.amount_usdt)} big />
        <p className="mt-2 flex items-start gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" />{t("checkout.exactAmount")}</p>
        <div className="mt-4 flex justify-center rounded-[16px] border-2 border-[color:var(--rule)] bg-white p-4" data-testid="crypto-qr"><QRCodeSVG value={p.address} size={168} /></div>
        <Field label={t("checkout.walletAddress")} value={p.address} testId="crypto-address" onCopy={() => copy(p.address)} copyLabel={t("checkout.copyAddress")} copyTestId="copy-address" />
        {p.memo && <Field label={t("checkout.memo")} value={p.memo} testId="crypto-memo" onCopy={() => copy(p.memo)} copyTestId="copy-memo" />}
        <p className="mt-4 text-xs text-muted-foreground" data-testid="crypto-expires">{t("checkout.expiresAt", { time: expires })}</p>
      </div>
      {(checking || p.status === "DETECTED") && (
        <p className="flex items-center gap-2 rounded-[14px] border-2 border-[color:var(--rule)] bg-muted px-3 py-3 text-sm font-semibold" data-testid={p.status === "DETECTED" ? "crypto-detected" : "crypto-checking"}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />{p.status === "DETECTED" ? t("checkout.cryptoDetected") : t("checkout.cryptoChecking")}
        </p>
      )}
      {!checking && p.status === "WAITING" && (
        <Button type="button" onClick={paid} data-testid="crypto-paid-button" className="h-12 w-full rounded-full text-base font-bold">{t("checkout.iPaid")}</Button>
      )}
    </section>
  );
}

function Field({ label, value, testId, onCopy, copyLabel, copyTestId, big }) {
  const { t } = useLang();
  return (
    <div className="mt-4">
      <p className="eyebrow">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={`num min-w-0 break-all font-bold ${big ? "font-display text-3xl" : "text-sm"}`} data-testid={testId}>{value}</p>
        <button type="button" onClick={onCopy} data-testid={copyTestId || `${testId}-copy`} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-[color:var(--rule-strong)] px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-foreground hover:bg-primary hover:text-[#0A0A0A]">
          <Copy className="h-3.5 w-3.5" />{copyLabel || t("checkout.copy")}
        </button>
      </div>
    </div>
  );
}
