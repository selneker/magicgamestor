import { Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";

const USSD = {
  mvola: (phone, amount) => `#111*1*2*${phone}*${amount}*1*0#`,
  orange: (phone, amount) => `#144*1*1*${phone}*${phone}*${amount}*1#`,
};
const pretty = (p) => p.replace(/(\d{3})(\d{2})(\d{3})(\d{2})/, "$1 $2 $3 $4");
const PROVIDERS = [
  { key: "mvola", label: "MVola", color: "var(--mvola)" },
  { key: "orange", label: "Orange Money", color: "var(--orange)" },
];

export function PaymentMethodPicker({ method, setMethod, phone, setPhone, reference, setReference, total, config }) {
  const { t } = useLang();
  const papiAuto = config ? config.papi_auto !== false : true;
  const provider = reference.provider || "mvola";
  const merchant = config?.providers?.[provider];
  const active = PROVIDERS.find((p) => p.key === provider);
  const code = merchant ? USSD[provider](merchant.merchant, total) : "";

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); toast.success(t("checkout.copied")); } catch { toast.error(t("common.error")); }
  };

  return (
    <div className="space-y-4" data-testid="payment-methods">
      {papiAuto && (
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map((p) => (
            <button key={p.key} type="button" data-testid={`method-${p.key}`} onClick={() => setMethod(p.key)}
              className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors ${method === p.key ? "bg-card" : "border-border bg-card hover:border-foreground"}`}
              style={method === p.key ? { borderColor: p.color } : undefined}>
              <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
              <span className="font-bold text-foreground">{p.label}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" data-testid="method-manual" onClick={() => setMethod("manual")} className={`w-full rounded-2xl border-2 p-3 text-left text-sm font-semibold transition-colors ${method === "manual" ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-foreground"}`}>{t("checkout.manual")}</button>
      {!papiAuto && <p className="text-xs text-muted-foreground" data-testid="papi-auto-off-notice">{t("checkout.papiOff")}</p>}

      {method !== "manual" && (
        <div>
          <label className="text-sm font-semibold" htmlFor="payment-phone">{t("checkout.phone")}</label>
          <Input id="payment-phone" data-testid="payment-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={method === "mvola" ? "034 XX XXX XX" : "037 XX XXX XX"} className="mt-1 h-12 rounded-xl" />
          <p className="mt-1 text-xs text-muted-foreground">{t("checkout.phoneHint")}</p>
          {config?.mode === "simulation" && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="simulation-mode-notice">{t("checkout.simulated")}</p>}
          {config?.live && <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground" data-testid="live-gateway-notice">{t("checkout.redirect")}</p>}
        </div>
      )}

      {method === "manual" && merchant && (
        <div className="space-y-3 border border-foreground bg-muted/40 p-4" data-testid="ussd-panel">
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button key={p.key} type="button" data-testid={`manual-provider-${p.key}`} onClick={() => setReference({ ...reference, provider: p.key })} className={`rounded-full px-3 py-1 text-xs font-bold ${provider === p.key ? "text-white" : "bg-card text-muted-foreground"}`} style={provider === p.key ? { background: p.color } : undefined}>{p.label}</button>
            ))}
          </div>

          <div className="space-y-2 border border-foreground bg-card p-3">
            <p className="text-sm text-foreground"><span className="font-semibold">{t("checkout.ussdName")} :</span> <span data-testid="merchant-name">{merchant.name}</span></p>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-sm text-foreground"><span className="font-semibold">{t("checkout.ussdNumberShort")} :</span> <span className="num break-all" data-testid="merchant-number">{pretty(merchant.merchant)}</span></p>
              <button type="button" onClick={() => copy(merchant.merchant)} data-testid="copy-merchant" className="inline-flex shrink-0 items-center gap-1 border border-foreground bg-primary px-3 py-1.5 text-xs font-bold text-[#0A0A0A] transition-transform hover:-translate-y-0.5">
                <Copy className="h-3.5 w-3.5" />{t("checkout.copy")}
              </button>
            </div>
          </div>

          <a href={`tel:*${code.slice(1)}`} data-testid="ussd-button"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full font-bold text-white" style={{ background: active.color }}>
            <Smartphone className="h-4 w-4" />{t("checkout.ussd")} · {total.toLocaleString("fr-FR")} Ar
          </a>

          <div className="flex items-center justify-between gap-2 border border-foreground bg-card p-3">
            <p className="min-w-0 text-sm text-foreground"><span className="font-semibold">{t("checkout.ussdCode")} :</span> <span className="num break-all" data-testid="ussd-code">{code}</span></p>
            <button type="button" onClick={() => copy(code)} data-testid="copy-ussd-code" className="inline-flex shrink-0 items-center gap-1 border border-foreground bg-primary px-3 py-1.5 text-xs font-bold text-[#0A0A0A] transition-transform hover:-translate-y-0.5">
              <Copy className="h-3.5 w-3.5" />{t("checkout.copy")}
            </button>
          </div>

          <div>
            <label className="text-sm font-semibold" htmlFor="manual-reference">{t("checkout.reference")}</label>
            <Input id="manual-reference" data-testid="manual-reference" value={reference.value || ""} onChange={(e) => setReference({ ...reference, value: e.target.value })} placeholder="Ex : Ref 1148190***" className="mt-1 h-12 rounded-xl" />
            <p className="mt-1 text-xs text-muted-foreground">{t("checkout.refHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
