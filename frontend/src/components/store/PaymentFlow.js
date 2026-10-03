import { AnimatePresence, motion } from "framer-motion";
import { Banknote, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/context/LanguageContext";
import { formatAr } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const PAYMENT_LOGOS = {
  mvola: "/payment-logos/mvola.svg",
  orange: "/payment-logos/orange-money.svg",
  binance: "/payment-logos/binance.svg",
};

export const USSD = {
  mvola: (phone, amount) => `#111*1*2*${phone}*${amount}*1*0#`,
  orange: (phone, amount) => `#144*1*1*${phone}*${phone}*${amount}*1#`,
};
const pretty = (p) => p.replace(/(\d{3})(\d{2})(\d{3})(\d{2})/, "$1 $2 $3 $4");

export function paymentFee(config, method, subtotal) {
  if (!method || method === "binance") return 0;
  const rule = config?.payment_fees?.[method === "manual" ? "manual" : config?.gateway === "fiveone" ? "fiveone" : "papi"];
  return rule ? Math.min(Math.max(Math.round((subtotal * rule.percent) / 100), rule.min), rule.max) : 0;
}

export function methodLabel(t, m) {
  return { mvola: t("checkout.mvolaAuto"), orange: t("checkout.orangeAuto"), manual: t("checkout.manualTitle"), binance: t("checkout.binanceTitle") }[m] || "";
}

// Step 2: radio cards. Opening a card shows its details + required validation + Continue.
export function PaymentFlow({ method, setMethod, phone, setPhone, reference, setReference, network, setNetwork, accepted, setAccepted, subtotal, config, crypto, busy, onContinue }) {
  const { t } = useLang();
  const papiAuto = config ? (config.auto_payment ?? config.papi_auto !== false) : true;

  const cards = [];
  if (papiAuto) {
    cards.push({ key: "mvola", title: t("checkout.mvolaAuto"), sub: t("checkout.autoSub"), color: "var(--mvola)" });
    cards.push({ key: "orange", title: t("checkout.orangeAuto"), sub: t("checkout.autoSub"), color: "var(--orange)" });
  }
  cards.push({ key: "manual", title: t("checkout.manualTitle"), sub: t("checkout.manualSub") });
  if (crypto?.available) cards.push({ key: "binance", title: t("checkout.binanceTitle"), sub: t("checkout.binanceSub"), color: "#F0B90B" });

  const select = (key) => { setMethod(method === key ? null : key); setAccepted(false); };
  const phoneOk = (phone || "").replace(/\D/g, "").length >= 10;
  const canContinue = method === "manual" || (method === "binance" ? !!network && accepted : accepted && phoneOk);

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); toast.success(t("checkout.copied")); } catch { toast.error(t("common.error")); }
  };

  return (
    <div className="space-y-3" data-testid="payment-methods">
      <p className="eyebrow pb-1">{t("checkout.selectMethod")}</p>
      {!papiAuto && <p className="text-xs text-muted-foreground" data-testid="papi-auto-off-notice">{t("checkout.papiOff")}</p>}
      {cards.map((c) => {
        const selected = method === c.key;
        const fee = paymentFee(config, c.key, subtotal);
        return (
          <div key={c.key} className={`overflow-hidden rounded-[18px] border-2 bg-card transition-colors ${selected ? "border-foreground" : "border-[color:var(--rule)] hover:border-[color:var(--rule-strong)]"}`}>
            <button type="button" data-testid={`method-${c.key}`} aria-pressed={selected} aria-expanded={selected} onClick={() => select(c.key)} className="flex w-full items-center gap-3 p-4 text-left active:scale-[0.99]">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${selected ? "border-foreground" : "border-[color:var(--rule-strong)]"}`}>
                {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              {PAYMENT_LOGOS[c.key] ? (
                <img src={PAYMENT_LOGOS[c.key]} alt="" aria-hidden="true" className="h-8 w-24 shrink-0 object-contain object-left" />
              ) : (
                <span className="flex h-8 w-24 shrink-0 items-center text-muted-foreground" aria-hidden="true">
                  <Banknote className="h-6 w-6" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[15px] font-bold leading-tight text-foreground">{c.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">{c.sub}</span>
              </span>
              <span className="flex shrink-0 items-center pl-1" aria-hidden="true">
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${selected ? "rotate-180" : ""}`} />
              </span>
            </button>
            <AnimatePresence initial={false}>
              {selected && (
                <motion.div key="exp" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: "easeOut" }} className="overflow-hidden" data-testid={`payment-expanded-${c.key}`}>
                  <div className="space-y-4 border-t-2 border-[color:var(--rule)] p-4">
                    {(c.key === "mvola" || c.key === "orange") && <AutoPanel c={c} phone={phone} setPhone={setPhone} config={config} />}
                    {c.key === "manual" && <ManualPanel reference={reference} setReference={setReference} config={config} copy={copy} />}
                    {c.key === "binance" && <NetworkPicker crypto={crypto} network={network} setNetwork={setNetwork} />}

                    <div className="space-y-2.5 rounded-[14px] border-2 border-[color:var(--rule)] bg-muted/40 p-4 text-sm" data-testid={`payment-summary-${c.key}`}>
                      <SummaryRow label={t("checkout.amount")} value={formatAr(subtotal)} />
                      <SummaryRow label={c.key === "binance" ? t("checkout.paymentFee") : t("checkout.verificationFee")} value={formatAr(fee)} />
                      <div className="flex items-center justify-between border-t-2 border-[color:var(--rule)] pt-2.5">
                        <span className="font-display text-[15px] font-bold">{t("checkout.total")}</span>
                        <span className="num text-lg" data-testid={`payment-total-${c.key}`}>{formatAr(subtotal + fee)}</span>
                      </div>
                      {c.key === "binance" && <p className="text-xs text-muted-foreground">{t("checkout.binanceUsdtNext")}</p>}
                    </div>

                    {(c.key === "mvola" || c.key === "orange") && (
                      <AcceptBox testId="accept-fee-checkbox" checked={accepted} onChange={setAccepted}><span className="font-semibold">{t("checkout.acceptFee")}</span></AcceptBox>
                    )}
                    {c.key === "binance" && (
                      <AcceptBox testId="binance-accept-checkbox" checked={accepted} onChange={setAccepted}>
                        <span className="font-bold">{t("checkout.binanceWarn")} — {t("checkout.binanceAccept")}</span>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                          <li>{t("checkout.binanceRule1")}</li><li>{t("checkout.binanceRule2")}</li><li>{t("checkout.binanceRule3")}</li>
                        </ul>
                      </AcceptBox>
                    )}

                    <div className="flex gap-3 pt-1">
                      <Button type="button" variant="outline" onClick={() => select(c.key)} data-testid="payment-cancel" className="h-12 flex-[0.6] rounded-full border-[color:var(--rule-strong)] font-semibold">{t("checkout.cancel")}</Button>
                      <Button type="button" onClick={onContinue} disabled={!canContinue || busy} data-testid="payment-pay" className="h-12 flex-[1.4] rounded-full text-[15px] font-bold">{busy ? t("checkout.processing") : t("checkout.continue")}</Button>
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

function AutoPanel({ c, phone, setPhone, config }) {
  const { t } = useLang();
  return (
    <div>
      <label className="text-sm font-semibold" htmlFor="payment-phone">{t("checkout.phone")}</label>
      <Input id="payment-phone" data-testid="payment-phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={c.key === "mvola" ? "034 XX XXX XX" : "037 XX XXX XX"} className="mt-1 h-12 rounded-[12px] text-base" />
      <p className="mt-1 text-xs text-muted-foreground">{t("checkout.phoneHint")}</p>
      {config?.mode === "simulation" && <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="simulation-mode-notice">{t("checkout.simulated")}</p>}
      {config?.live && <p className="mt-2 rounded-[10px] bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground" data-testid="live-gateway-notice">{t("checkout.redirect")}</p>}
    </div>
  );
}

function AcceptBox({ testId, checked, onChange, children }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[14px] border-2 p-3 text-sm transition-colors ${checked ? "border-foreground bg-primary/5" : "border-[color:var(--rule)]"}`}>
      <Checkbox data-testid={testId} checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function NetworkPicker({ crypto, network, setNetwork }) {
  const { t } = useLang();
  return (
    <div>
      <p className="text-sm font-semibold">{t("checkout.chooseNetwork")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {crypto.networks.map((n) => {
          const on = network === n.key;
          return (
            <button key={n.key} type="button" data-testid={`binance-network-${n.key}`} aria-pressed={on} onClick={() => setNetwork(n.key)} className={`flex items-center gap-2.5 rounded-[12px] border-2 p-3 text-left transition-colors ${on ? "border-foreground bg-primary/10" : "border-[color:var(--rule)] hover:border-foreground"}`}>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-foreground" : "border-[color:var(--rule-strong)]"}`}>{on && <span className="h-2.5 w-2.5 rounded-full bg-foreground" />}</span>
              <span className="min-w-0"><span className="block text-sm font-black">{n.key}</span><span className="block truncate text-[11px] text-muted-foreground">{n.label}</span></span>
            </button>
          );
        })}
      </div>
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

function ManualPanel({ reference, setReference, config, copy }) {
  const { t } = useLang();
  const PROVIDERS = [
    { key: "mvola", label: "MVola", color: "var(--mvola)" },
    { key: "orange", label: "Orange Money", color: "var(--orange)" },
  ];
  const provider = reference.provider || "mvola";
  const merchant = config?.providers?.[provider];

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{t("checkout.chooseOperator")}</p>
      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <button key={p.key} type="button" data-testid={`manual-provider-${p.key}`} aria-pressed={provider === p.key} onClick={() => setReference({ ...reference, provider: p.key })} className={`rounded-full px-4 py-1.5 text-xs font-bold transition-opacity ${provider === p.key ? "text-white" : "border bg-card text-muted-foreground hover:opacity-80"}`} style={provider === p.key ? { background: p.color } : undefined}>{p.label}</button>
        ))}
      </div>
      {merchant && (
        <div className="space-y-2 rounded-[12px] border-2 border-[color:var(--rule)] bg-card p-3">
          <p className="text-sm text-foreground"><span className="font-medium">{t("checkout.ussdName")} :</span> <span data-testid="merchant-name">{merchant.name}</span></p>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-sm text-foreground"><span className="font-medium">{t("checkout.ussdNumberShort")} :</span> <span className="num break-all text-base font-bold" data-testid="merchant-number">{pretty(merchant.merchant)}</span></p>
            <button type="button" onClick={() => copy(merchant.merchant)} data-testid="copy-merchant" aria-label={`${t("checkout.copy")} ${merchant.merchant}`} className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-xs font-bold text-background transition-opacity hover:opacity-85">
              <Copy className="h-3.5 w-3.5" />{t("checkout.copy")}
            </button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground" data-testid="manual-instructions">{t("checkout.manualHowto")}</p>
    </div>
  );
}
