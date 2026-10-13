import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Landmark, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AdminBinance from "@/pages/admin/AdminBinance";

const panel = "border-2 border-foreground bg-card p-4 sm:p-5";

// Unified "Paiements" admin surface. It only MERGES the existing admin UIs
// (PAPI + FiveOne Pay toggles/fees previously on the dashboard, and Binance)
// into one page — every endpoint, key and mechanism stays untouched. Secrets
// are never rendered: only server-side "configured" booleans are shown.
export default function AdminPayments() {
  const { t } = useLang();
  const { isSuperAdmin } = useAuth();
  const [settings, setSettings] = useState(null);
  const [feeRules, setFeeRules] = useState(null);
  const [feesOpen, setFeesOpen] = useState(false);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    api.get("/payments/admin/settings").then((r) => { setSettings(r.data); setFeeRules(r.data.payment_fees); }).catch(() => {});
  }, []);

  const update = async (key, patch) => {
    setSaving(key);
    try {
      const { data } = await api.patch("/payments/admin/settings", patch);
      setSettings(data); setFeeRules(data.payment_fees);
      toast.success(t("admin.papiAutoSaved"));
    } catch { toast.error(t("common.error")); } finally { setSaving(""); }
  };

  const providers = [
    { key: "papi_auto", icon: Smartphone, label: t("admin.papiAuto"), hint: t("admin.papiAutoHint"), testid: "papi-auto", ok: true },
    { key: "fiveone_enabled", icon: Landmark, label: t("admin.fiveone"), hint: t("admin.fiveoneHint"), testid: "fiveone", ok: settings?.fiveone_configured !== false, sandbox: settings?.fiveone_sandbox },
  ];

  return (
    <div className="space-y-8" data-testid="admin-payments">
      <div>
        <p className="eyebrow">Magic Game Store</p>
        <h2 className="font-display text-2xl font-black uppercase tracking-tight">{t("admin.paymentsTitle")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("admin.paymentsHint")}</p>
      </div>

      {/* Mobile Money gateways — PAPI & FiveOne Pay */}
      <section className={panel} data-testid="admin-payments-mobile">
        <p className="eyebrow">{t("admin.paymentProviders")}</p>
        <p className="mt-1 text-xs text-muted-foreground">Mode serveur : <b data-testid="payment-mode">{settings?.payment_mode ?? "…"}</b></p>
        <div className="mt-3 divide-y divide-border">
          {providers.map((p) => (
            <div key={p.key} className="flex items-start justify-between gap-3 py-3" data-testid={`${p.testid}-setting`}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-display text-base font-bold leading-tight">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[color:var(--rule-strong)] bg-background"><p.icon className="h-4 w-4" strokeWidth={2} /></span>
                  {p.label}
                  {p.sandbox && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">{t("admin.sandbox")}</span>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{p.hint}</p>
                {!p.ok && <p className="mt-1 text-xs font-semibold text-rose-600" data-testid={`${p.testid}-not-configured`}>{t("admin.fiveoneNotConfigured")}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                <span className="w-8 text-right text-xs font-bold uppercase tracking-widest" data-testid={`${p.testid}-state`}>{settings === null ? "…" : settings[p.key] ? "ON" : "OFF"}</span>
                <Switch checked={!!settings?.[p.key]} disabled={settings === null || !!saving || !isSuperAdmin} onCheckedChange={(v) => update(p.key, { [p.key]: v })} data-testid={`${p.testid}-toggle`} />
              </div>
            </div>
          ))}
          <form className="space-y-3 py-3" data-testid="payment-fees-setting" onSubmit={(e) => { e.preventDefault(); update("payment_fees", { payment_fees: Object.fromEntries(["papi", "fiveone"].map((k) => [k, { percent: Math.max(0, Number(feeRules[k]?.percent) || 0), min: Math.max(0, Number(feeRules[k]?.min) || 0), max: Math.max(0, Number(feeRules[k]?.max) || 0) }])) }); }}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-base font-bold leading-tight">{t("admin.paymentFees")}</p>
              <button type="button" onClick={() => setFeesOpen((o) => !o)} aria-label={t("admin.paymentFees")} aria-expanded={feesOpen} data-testid="payment-fees-toggle" className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                {feesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
            {feesOpen && feeRules && (
              <>
                <div className="flex min-w-0 items-center justify-between gap-3 border border-border p-3" data-testid="fee-rule-manual">
                  <p className="text-sm font-bold">{t("admin.feesManual")}</p>
                  <p className="shrink-0 text-sm font-semibold text-muted-foreground" data-testid="fee-manual-value">{t("admin.feesManualValue")}</p>
                </div>
                {["papi", "fiveone"].map((key) => (
                  <div key={key} className="min-w-0 border border-border p-3" data-testid={`fee-rule-${key}`}>
                    <p className="text-sm font-bold">{key === "papi" ? "Papi" : "FiveOne Pay"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{key === "papi" ? t("admin.feesPapiHint") : t("admin.feesFiveoneHint")}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {[["percent", t("admin.feeRate"), "0.05"], ["min", t("admin.feeMin"), "50"], ["max", t("admin.feeMax"), "50"]].map(([f, label, step]) => (
                        <label key={f} className="min-w-0 text-xs font-semibold text-muted-foreground">{label}
                          <Input type="number" min="0" step={step} inputMode="decimal" value={feeRules[key]?.[f] ?? ""} disabled={!isSuperAdmin} data-testid={`fee-${key}-${f}`} className="mt-1 h-10 w-full rounded-xl" onChange={(e) => setFeeRules({ ...feeRules, [key]: { ...feeRules[key], [f]: e.target.value } })} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <Button type="submit" size="sm" className="h-10 w-full rounded-full font-bold sm:w-auto" disabled={!!saving || !isSuperAdmin} data-testid="payment-fees-save">{t("admin.save")}</Button>
              </>
            )}
          </form>
        </div>
      </section>

      {/* Binance USDT — its own existing admin surface, reused verbatim. */}
      <section data-testid="admin-payments-binance">
        <AdminBinance />
      </section>
    </div>
  );
}
