import { AnimatePresence, motion } from "framer-motion";
import { Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const USSD = {
  mvola: (phone, amount) => `#111*1*2*${phone}*${amount}*1*0#`,
  orange: (phone, amount) => `#144*1*1*${phone}*${phone}*${amount}*1#`,
};
const pretty = (p) => p.replace(/(\d{3})(\d{2})(\d{3})(\d{2})/, "$1 $2 $3 $4");

// Payment-method selection with inline expand/collapse. Selecting a card
// reveals its details + a payment summary + Cancel/Pay. Pay hands off to the
// parent (navigates to the dedicated confirmation route). Reuses the existing
// payment APIs/config — no new payment logic.
export function PaymentFlow({ method, setMethod, phone, setPhone, reference, setReference, subtotal, config, onPay }) {
  const { t } = useLang();
  const papiAuto = config ? (config.auto_payment ?? config.papi_auto !== false) : true;

  const feeFor = (m) => {
    const rule = config?.payment_fees?.[m === "manual" ? "manual" : config?.gateway === "fiveone" ? "fiveone" : "papi"];
    return rule ? Math.min(Math.max(Math.round((subtotal * rule.percent) / 100), rule.min), rule.max) : 0;
  };

  const cards = [];
  if (papiAuto) {
    cards.push({ key: "mvola", title: t("checkout.mvolaAuto"), sub: t("checkout.autoSub"), color: "var(--mvola)" });
    cards.push({ key: "orange", title: t("checkout.orangeAuto"), sub: t("checkout.autoSub"), color: "var(--orange)" });
  }
  cards.push({ key: "manual", title: t("checkout.manualTitle"), sub: t("checkout.manualSub") });

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); toast.success(t("checkout.copied")); } catch { toast.error(t("common.error")); }
  };

  return (
    <div className="space-y-3" data-testid="payment-methods">
      <p className="eyebrow pb-1">{t("checkout.selectMethod")}</p>
      {!papiAuto && <p className="text-xs text-muted-foreground" data-testid="papi-auto-off-notice">{t("checkout.papiOff")}</p>}
      {cards.map((c) => {
        const selected = method === c.key;
        const fee = feeFor(c.key);
        const grand = subtotal + fee;
        return (
          <div key={c.key} className={`overflow-hidden rounded-[18px] border-2 bg-card transition-colors ${selected ? "border-foreground" : "border-[color:var(--rule)]"}`}>
            <button
              type="button"
              data-testid={`method-${c.key}`}
              aria-pressed={selected}
              onClick={() => setMethod(selected ? null : c.key)}
              className="flex w-full items-center gap-3 p-4 text-left active:scale-[0.99]"
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-foreground" : "border-[color:var(--rule-strong)]"}`}>
                {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              {c.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />}
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[15px] font-bold leading-tight text-foreground">{c.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">{c.sub}</span>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {selected && (
                <motion.div
                  key="exp"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: "easeOut" }}
                  className="overflow-hidden"
                  data-testid={`payment-expanded-${c.key}`}
                >
                  <div className="space-y-4 border-t-2 border-[color:var(--rule)] p-4">
                    {c.key !== "manual" ? (
                      <div>
                        <label className="text-sm font-semibold" htmlFor="payment-phone">{t("checkout.phone")}</label>
                        <Input id="payment-phone" data-testid="payment-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={c.key === "mvola" ? "034 XX XXX XX" : "037 XX XXX XX"} className="mt-1 h-12 rounded-[12px]" />
                        <p className="mt-1 text-xs text-muted-foreground">{t("checkout.phoneHint")}</p>
                        {config?.mode === "simulation" && <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="simulation-mode-notice">{t("checkout.simulated")}</p>}
                        {config?.live && <p className="mt-2 rounded-[10px] bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground" data-testid="live-gateway-notice">{t("checkout.redirect")}</p>}
                      </div>
                    ) : (
                      <ManualPanel reference={reference} setReference={setReference} config={config} subtotal={subtotal} copy={copy} />
                    )}

                    <div className="space-y-2 rounded-[14px] border-2 border-[color:var(--rule)] bg-muted/40 p-3 text-sm" data-testid={`payment-summary-${c.key}`}>
                      <SummaryRow label={t("checkout.amount")} value={formatAr(subtotal)} />
                      <SummaryRow label={t("checkout.methodCol")} value={c.title} />
                      <SummaryRow label={t("checkout.paymentFee")} value={formatAr(fee)} />
                      <SummaryRow label={t("checkout.arrival")} value={c.key === "manual" ? t("checkout.arrivalManual") : t("checkout.arrivalInstant")} />
                      <div className="flex items-center justify-between border-t-2 border-[color:var(--rule)] pt-2 font-bold">
                        <span>{t("checkout.totalToPay")}</span>
                        <span className="num" data-testid={`payment-total-${c.key}`}>{formatAr(grand)}</span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setMethod(null)} data-testid="payment-cancel" className="flex-1 rounded-full border-[color:var(--rule-strong)] font-semibold">{t("checkout.cancel")}</Button>
                      <Button type="button" onClick={onPay} data-testid="payment-pay" className="flex-1 rounded-full font-bold">{t("checkout.pay")}</Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ManualPanel({ reference, setReference, config, subtotal, copy }) {
  const { t } = useLang();
  const PROVIDERS = [
    { key: "mvola", label: "MVola", color: "var(--mvola)" },
    { key: "orange", label: "Orange Money", color: "var(--orange)" },
  ];
  const provider = reference.provider || "mvola";
  const merchant = config?.providers?.[provider];
  const active = PROVIDERS.find((p) => p.key === provider);
  const code = merchant ? USSD[provider](merchant.merchant, subtotal) : "";

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <button key={p.key} type="button" data-testid={`manual-provider-${p.key}`} onClick={() => setReference({ ...reference, provider: p.key })} className={`rounded-full px-3 py-1 text-xs font-bold ${provider === p.key ? "text-white" : "border bg-card text-muted-foreground"}`} style={provider === p.key ? { background: p.color } : undefined}>{p.label}</button>
        ))}
      </div>

      {merchant && (
        <>
          <div className="space-y-2 rounded-[12px] border-2 border-[color:var(--rule)] bg-card p-3">
            <p className="text-sm text-foreground"><span className="font-medium">{t("checkout.ussdName")} :</span> <span data-testid="merchant-name">{merchant.name}</span></p>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-sm text-foreground"><span className="font-medium">{t("checkout.ussdNumberShort")} :</span> <span className="num break-all" data-testid="merchant-number">{pretty(merchant.merchant)}</span></p>
              <button type="button" onClick={() => copy(merchant.merchant)} data-testid="copy-merchant" aria-label={`${t("checkout.copy")} ${merchant.merchant}`} className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground hover:bg-primary hover:text-[#0A0A0A]">
                <Copy className="h-3.5 w-3.5" />{t("checkout.copy")}
              </button>
            </div>
          </div>

          <a href={`tel:*${code.slice(1)}`} data-testid="ussd-button" className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] font-semibold text-white" style={{ background: active.color }}>
            <Smartphone className="h-4 w-4" />{t("checkout.ussd")} · {subtotal.toLocaleString("fr-FR")} Ar
          </a>
        </>
      )}

      <div>
        <label className="text-sm font-semibold" htmlFor="manual-reference">{t("checkout.reference")}</label>
        <Input id="manual-reference" data-testid="manual-reference" value={reference.value || ""} onChange={(e) => setReference({ ...reference, value: e.target.value })} placeholder="Ex : Ref 1148190***" className="mt-1 h-12 rounded-[12px]" />
        <p className="mt-1 text-xs text-muted-foreground">{t("checkout.refHint")}</p>
      </div>
    </div>
  );
}
