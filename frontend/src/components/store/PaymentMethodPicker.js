import { useEffect, useState } from "react";
import { Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";

const USSD = {
  mvola: (phone, amount) => `#111*1*2*${phone}*${amount}*1*0#`,
  orange: (phone, amount) => `#144*1*1*${phone}*${phone}*${amount}*1#`,
};
const pretty = (p) => p.replace(/(\d{3})(\d{2})(\d{3})(\d{2})/, "$1 $2 $3 $4");

export function PaymentMethodPicker({ method, setMethod, phone, setPhone, reference, setReference, total }) {
  const { t } = useLang();
  const [config, setConfig] = useState(null);
  useEffect(() => { api.get("/payments/config").then((r) => setConfig(r.data)).catch(() => {}); }, []);

  const providers = [
    { key: "mvola", label: "MVola", color: "var(--mvola)" },
    { key: "orange", label: "Orange Money", color: "var(--orange)" },
  ];
  const manualProvider = method === "manual" ? (reference.provider || "mvola") : null;
  const merchant = config?.providers?.[manualProvider || "mvola"];

  const copy = async (v) => { await navigator.clipboard.writeText(v); toast.success(t("checkout.copied")); };

  return (
    <div className="space-y-4" data-testid="payment-methods">
      <div className="grid grid-cols-2 gap-3">
        {providers.map((p) => (
          <button key={p.key} type="button" data-testid={`method-${p.key}`} onClick={() => setMethod(p.key)}
            className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors ${method === p.key ? "bg-white" : "border-slate-200 bg-white hover:border-slate-300"}`}
            style={method === p.key ? { borderColor: p.color } : undefined}>
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
            <span className="font-bold text-slate-900">{p.label}</span>
          </button>
        ))}
      </div>
      <button type="button" data-testid="method-manual" onClick={() => setMethod("manual")} className={`w-full rounded-2xl border-2 p-3 text-left text-sm font-semibold transition-colors ${method === "manual" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{t("checkout.manual")}</button>

      {method !== "manual" && (
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="payment-phone">{t("checkout.phone")}</label>
          <Input id="payment-phone" data-testid="payment-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={method === "mvola" ? "034 XX XXX XX" : "037 XX XXX XX"} className="mt-1 h-12 rounded-xl" />
          <p className="mt-1 text-xs text-slate-500">{t("checkout.phoneHint")}</p>
          {config?.mode === "simulation" && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="simulation-mode-notice">{t("checkout.simulated")}</p>}
          {config?.live && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600" data-testid="live-gateway-notice">{t("checkout.redirect")}</p>}
        </div>
      )}

      {method === "manual" && merchant && (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
          <div className="flex gap-2">
            {providers.map((p) => (
              <button key={p.key} type="button" data-testid={`manual-provider-${p.key}`} onClick={() => setReference({ ...reference, provider: p.key })} className={`rounded-full px-3 py-1 text-xs font-bold ${manualProvider === p.key ? "text-white" : "bg-white text-slate-600"}`} style={manualProvider === p.key ? { background: p.color } : undefined}>{p.label}</button>
            ))}
          </div>
          <a href={`tel:${encodeURIComponent(USSD[manualProvider](merchant.merchant, total))}`} data-testid="ussd-button" className="flex h-12 items-center justify-center gap-2 rounded-full font-bold text-white" style={{ background: providers.find((p) => p.key === manualProvider).color }}><Smartphone className="h-4 w-4" />{t("checkout.ussd")} · {total.toLocaleString("fr-FR")} Ar</a>
          <div className="flex items-center justify-between rounded-xl bg-white p-3">
            <div><p className="font-display text-lg font-bold text-slate-900" data-testid="merchant-number">{pretty(merchant.merchant)}</p><p className="text-xs text-slate-500">{merchant.name}</p></div>
            <button type="button" data-testid="copy-merchant" onClick={() => copy(merchant.merchant)} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><Copy className="h-4 w-4" />{t("checkout.copy")}</button>
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700" htmlFor="manual-reference">{t("checkout.reference")}</label>
            <Input id="manual-reference" data-testid="manual-reference" value={reference.value || ""} onChange={(e) => setReference({ ...reference, value: e.target.value })} placeholder="Ex : Ref 1148190***" className="mt-1 h-12 rounded-xl" />
            <p className="mt-1 text-xs text-slate-500">{t("checkout.refHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
