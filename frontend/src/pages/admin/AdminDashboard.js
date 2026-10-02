import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { api, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminDashboard() {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [feeRules, setFeeRules] = useState(null);
  const [feesOpen, setFeesOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const { isSuperAdmin } = useAuth();
  useEffect(() => { api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => {}); }, []);
  useEffect(() => { api.get("/payments/admin/settings").then((r) => { setSettings(r.data); setFeeRules(r.data.payment_fees); }).catch(() => {}); }, []);
  const update = async (key, patch) => {
    setSaving(key);
    try {
      const { data } = await api.patch("/payments/admin/settings", patch);
      setSettings(data); setFeeRules(data.payment_fees);
      toast.success(t("admin.papiAutoSaved"));
    } catch { toast.error(t("common.error")); } finally { setSaving(""); }
  };
  if (!stats) return <p className="text-slate-500">{t("common.loading")}</p>;
  const cards = [
    [t("admin.revenue"), formatAr(stats.revenue), "text-primary", "stat-revenue"],
    [t("admin.total"), stats.total_orders, "text-slate-900", "stat-total"],
    [t("admin.pending"), stats.status_count.paid + stats.status_count.awaiting_verification, "text-amber-600", "stat-pending"],
    [t("admin.delivered"), stats.status_count.delivered, "text-emerald-600", "stat-delivered"],
    [t("admin.customers"), stats.customers, "text-violet-600", "stat-customers"],
  ];
  const providers = [
    { key: "papi_auto", label: t("admin.papiAuto"), hint: t("admin.papiAutoHint"), testid: "papi-auto", ok: true },
    { key: "fiveone_enabled", label: t("admin.fiveone"), hint: t("admin.fiveoneHint"), testid: "fiveone", ok: settings?.fiveone_configured !== false, sandbox: settings?.fiveone_sandbox },
  ];
  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <section className="border-2 border-foreground bg-card p-4 sm:p-5" data-testid="payment-providers">
        <p className="eyebrow">{t("admin.paymentProviders")}</p>
        <div className="mt-3 divide-y divide-border">
          {providers.map((p) => (
            <div key={p.key} className="flex items-start justify-between gap-3 py-3" data-testid={`${p.testid}-setting`}>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-bold leading-tight">{p.label}{p.sandbox && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">{t("admin.sandbox")}</span>}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.hint}</p>
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map(([label, value, , id]) => (
          <div key={id} data-testid={id} className="min-w-0 border border-foreground bg-card p-4 sm:p-5"><p className="eyebrow truncate">{label}</p><p className="num mt-3 break-words text-xl sm:text-2xl lg:text-3xl">{value}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-2 border-foreground bg-card p-5" data-testid="stat-pending-payment">
        <div>
          <p className="eyebrow">{t("admin.pendingPayment")}</p>
          <p className="num mt-2 text-3xl sm:text-4xl" data-testid="stat-pending-count">{stats.pending_payment_count ?? 0}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow">{t("admin.pendingTotal")}</p>
          <p className="num mt-2 text-3xl text-primary sm:text-4xl" data-testid="stat-pending-usd">${Number(stats.pending_payment_usd || 0).toFixed(2)}</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("admin.last14")}</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.daily}><XAxis dataKey="_id" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} /><Tooltip formatter={(v) => formatAr(v)} /><Bar dataKey="revenue" fill="#C5FE02" stroke="currentColor" className="text-foreground" /></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("admin.topProducts")}</h2>
          <ul className="mt-4 space-y-2">
            {stats.top_products.map((p) => <li key={p._id} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold">{p._id}</span><span className="text-slate-500">×{p.qty}</span></li>)}
            {stats.top_products.length === 0 && <li className="text-sm text-slate-400">—</li>}
          </ul>
          <div className="mt-4 flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[var(--mvola)]/10 px-3 py-1 text-[var(--mvola)]">MVola {stats.by_method.mvola || 0}</span>
            <span className="rounded-full bg-[var(--orange)]/10 px-3 py-1 text-[var(--orange)]">Orange {stats.by_method.orange || 0}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">USSD {stats.by_method.manual || 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
