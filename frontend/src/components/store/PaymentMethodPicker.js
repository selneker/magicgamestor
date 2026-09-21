import { useState } from "react";
import { Smartphone } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { UssdDialog } from "@/components/store/UssdDialog";

const USSD = {
  mvola: (phone, amount) => `#111*1*2*${phone}*${amount}*1*0#`,
  orange: (phone, amount) => `#144*1*1*${phone}*${phone}*${amount}*1#`,
};
const pretty = (p) => p.replace(/(\d{3})(\d{2})(\d{3})(\d{2})/, "$1 $2 $3 $4");
const PROVIDERS = [
  { key: "mvola", label: "MVola", color: "var(--mvola)" },
  { key: "orange", label: "Orange Money", color: "var(--orange)" },
];

export function PaymentMethodPicker({ method, setMethod, phone, setPhone, reference, setReference, total, config, onManualSubmit, busy }) {
  const { t } = useLang();
  const [dialog, setDialog] = useState(false);
  const papiAuto = config ? config.papi_auto !== false : true;
  const manualProvider = method === "manual" ? (reference.provider || "mvola") : null;
  const merchant = config?.providers?.[manualProvider || "mvola"];
  const active = PROVIDERS.find((p) => p.key === (manualProvider || "mvola"));

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
        <div className="space-y-3 border border-foreground bg-muted/40 p-4">
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button key={p.key} type="button" data-testid={`manual-provider-${p.key}`} onClick={() => setReference({ ...reference, provider: p.key })} className={`rounded-full px-3 py-1 text-xs font-bold ${manualProvider === p.key ? "text-white" : "bg-card text-muted-foreground"}`} style={manualProvider === p.key ? { background: p.color } : undefined}>{p.label}</button>
            ))}
          </div>
          <button type="button" data-testid="ussd-button" onClick={() => setDialog(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full font-bold text-white" style={{ background: active.color }}>
            <Smartphone className="h-4 w-4" />{t("checkout.ussd")} · {total.toLocaleString("fr-FR")} Ar
          </button>
          <div className="flex items-center justify-between border border-foreground bg-card p-3">
            <div><p className="num text-lg text-foreground" data-testid="merchant-number">{pretty(merchant.merchant)}</p><p className="text-xs text-muted-foreground">{merchant.name}</p></div>
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="manual-reference">{t("checkout.reference")}</label>
            <Input id="manual-reference" data-testid="manual-reference" value={reference.value || ""} onChange={(e) => setReference({ ...reference, value: e.target.value })} placeholder="Ex : Ref 1148190***" className="mt-1 h-12 rounded-xl" />
            <p className="mt-1 text-xs text-muted-foreground">{t("checkout.refHint")}</p>
          </div>
          <UssdDialog open={dialog} onOpenChange={setDialog} providerLabel={active.label} color={active.color}
            merchant={pretty(merchant.merchant)} merchantName={merchant.name} ussdCode={USSD[manualProvider](merchant.merchant, total)}
            total={total} reference={reference} setReference={setReference} onSubmit={onManualSubmit} busy={busy} />
        </div>
      )}
    </div>
  );
}
