import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const GROUPS = [["uc", "groupUc"], ["prime", "groupPrime"], ["prime_plus", "groupPrimePlus"], ["evo", "groupEvo"]];
const ucAmountOf = (o) => {
  const m = /^([\d\s]+)\s*UC$/i.exec((o?.name || "").trim());
  if (m) return parseInt(m[1].replace(/\s/g, ""), 10);
  const m2 = /^(\d+)_uc$/i.exec(o?.offer_id || "");
  return m2 ? parseInt(m2[1], 10) : null;
};

const StatusBadge = ({ p, t }) => {
  const s = p.mapping_status;
  const base = "rounded-full px-2 py-0.5 text-[11px] font-bold";
  if (s === "direct") return <span className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200`} data-testid={`fzr-status-${p.slug}`}>{t("admin.fzr.statusOk")}</span>;
  if (s === "composite") return <span className={`${base} bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200`} data-testid={`fzr-status-${p.slug}`}>{t("admin.fzr.statusComposite")}</span>;
  if (s === "unconfirmed") return <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200`} data-testid={`fzr-status-${p.slug}`}>{t("admin.fzr.statusUnconfirmed")}</span>;
  return <span className={`${base} bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200`} data-testid={`fzr-status-${p.slug}`}>{t("admin.fzr.statusMissing")}</span>;
};

export default function AdminFazercards() {
  const { t } = useLang();
  const { isSuperAdmin, can } = useAuth();
  const [settings, setSettings] = useState(null);
  const [alerts, setAlerts] = useState({ alerts: [], unacknowledged: 0 });
  const [products, setProducts] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [audit, setAudit] = useState(null);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    api.get("/admin/fazercards/settings").then((r) => setSettings(r.data)).catch(() => {});
    api.get("/admin/fazercards/price-alerts").then((r) => setAlerts(r.data)).catch(() => {});
    api.get("/admin/fazercards/mappings").then((r) => setProducts(r.data.products)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const loadCatalog = useCallback(async () => {
    setBusy("catalog");
    try { const { data } = await api.get("/fazercards/pubg/catalog"); setCatalog(data.categories); return data.categories; }
    catch (e) { toast.error(errorMessage(e)); return null; } finally { setBusy(""); }
  }, []);

  const toggleAuto = async (v) => {
    try {
      const { data } = await api.patch("/admin/fazercards/settings", { fzr_auto: v });
      setSettings((s) => ({ ...s, fzr_auto: data.fzr_auto }));
      toast.success(t("admin.fzr.autoSaved"));
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const refreshCatalog = async () => {
    setBusy("refresh");
    try {
      const { data } = await api.post("/admin/fazercards/catalog/refresh");
      toast.success(t("admin.fzr.refreshDone").replace("{n}", data.checked).replace("{c}", data.changes.length));
      load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const ack = async (id) => {
    try { await api.patch(`/admin/fazercards/price-alerts/${id}/ack`); toast.success(t("admin.fzr.ackDone")); load(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const loadCoverage = async () => {
    setBusy("coverage");
    try { const { data } = await api.get("/admin/fazercards/coverage"); setCoverage(data.offers); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };

  const runAudit = async () => {
    setBusy("audit");
    try { const { data } = await api.get("/admin/fazercards/uc-audit"); setAudit(data.rows); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const applyAudit = async () => {
    setBusy("audit-apply");
    try {
      const { data } = await api.post("/admin/fazercards/uc-audit/apply");
      toast.success(t("admin.fzr.ucAuditDone").replace("{f}", data.fixed_count).replace("{r}", data.removed_count));
      setAudit(data.rows); load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };

  const openConfig = async (p) => {
    if (!catalog) await loadCatalog();
    const m = p.fazercards_mapping;
    setEditing(p);
    setForm({
      mode: m?.mode === "composite" ? "composite" : "direct",
      category_id: m?.category_id || "",
      offer_id: m?.mode !== "composite" ? m?.offer_id || "" : "",
      components: m?.mode === "composite" && m.components?.length
        ? m.components.map((c) => ({ offer_id: c.offer_id, quantity: c.quantity }))
        : [{ offer_id: "", quantity: 1 }],
      confirmed: m ? m.confirmed !== false : true,
    });
  };

  const catOffers = useMemo(() => (catalog || []).find((c) => c.category_id === form?.category_id)?.offers || [], [catalog, form?.category_id]);
  const selectedOffer = catOffers.find((o) => o.offer_id === form?.offer_id);
  const compTotals = useMemo(() => {
    if (!form || form.mode !== "composite") return null;
    let uc = 0, usd = 0, valid = true;
    for (const c of form.components) {
      const offer = catOffers.find((o) => o.offer_id === c.offer_id);
      const amount = ucAmountOf(offer);
      if (!offer || amount === null) { valid = false; continue; }
      uc += amount * (Number(c.quantity) || 0);
      usd += parseFloat(offer.price_usd || 0) * (Number(c.quantity) || 0);
    }
    const target = editing?.uc_amount || 0;
    return { uc, usd: usd.toFixed(4), target, exact: valid && uc === target && uc > 0 };
  }, [form, catOffers, editing]);

  const saveMapping = async () => {
    setBusy("save");
    const payload = form.mode === "direct"
      ? { mode: "direct", category_id: form.category_id, offer_id: form.offer_id, confirmed: form.confirmed }
      : { mode: "composite", category_id: form.category_id, confirmed: form.confirmed,
          components: form.components.filter((c) => c.offer_id).map((c) => ({ offer_id: c.offer_id, quantity: Number(c.quantity) || 1 })) };
    try {
      await api.patch(`/admin/fazercards/products/${editing.id}/mapping`, payload);
      toast.success(t("admin.fzr.mappingSaved"));
      setEditing(null); setForm(null); load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const unlink = async (p) => {
    setBusy(`unlink-${p.id}`);
    try { await api.delete(`/admin/fazercards/products/${p.id}/mapping`); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };

  const setComp = (i, patch) => setForm((f) => ({ ...f, components: f.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const canSave = form && form.category_id && form.confirmed !== undefined &&
    (form.mode === "direct" ? !!form.offer_id : compTotals?.exact);

  const specialUnused = (coverage || []).filter((o) => o.kind === "special" && o.used_by.length === 0);
  const specialUsed = (coverage || []).filter((o) => o.kind === "special" && o.used_by.length > 0);

  return (
    <div className="space-y-6" data-testid="admin-fzr">
      <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-foreground bg-card p-4" data-testid="fzr-auto-setting">
        <div>
          <p className="font-display text-base font-bold">{t("admin.fzr.auto")}</p>
          <p className="text-xs text-muted-foreground">{t("admin.fzr.autoHint")}</p>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground" data-testid="fzr-webhook-state">
            {settings?.webhook_configured ? t("admin.fzr.webhookOk") : t("admin.fzr.webhookOff")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest" data-testid="fzr-auto-state">{settings === null ? "…" : settings.fzr_auto ? "ON" : "OFF"}</span>
          <Switch checked={!!settings?.fzr_auto} disabled={settings === null || !isSuperAdmin} onCheckedChange={toggleAuto} data-testid="fzr-auto-toggle" />
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-foreground">{t("admin.fzr.priceAlerts")}{alerts.unacknowledged > 0 && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-200" data-testid="fzr-alert-count">{alerts.unacknowledged}</span>}</h2>
          {can("catalog.manage") && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={refreshCatalog} disabled={busy === "refresh"} data-testid="fzr-refresh-catalog">
              {busy === "refresh" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
              {busy === "refresh" ? t("admin.fzr.refreshing") : t("admin.fzr.refreshCatalog")}
            </Button>
          )}
        </div>
        <div className="mt-4 max-h-[19rem] space-y-2 overflow-y-auto rounded-xl border border-border bg-muted/30 p-3" data-testid="fzr-alerts-scroll">
          {alerts.alerts.length === 0 && <p className="text-sm text-muted-foreground" data-testid="fzr-no-alerts">{t("admin.fzr.noAlerts")}</p>}
          {alerts.alerts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${a.acknowledged ? "border-border opacity-60" : a.direction === "up" ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10" : "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"}`} data-testid={`fzr-alert-${a.id}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{a.offer_name} <span className="font-mono text-xs text-muted-foreground">({a.category_id})</span></p>
                <p className="text-xs text-muted-foreground">{t("admin.fzr.oldCost")} : ${a.old_price_usd} → {t("admin.fzr.newCost")} : <span className={a.direction === "up" ? "font-bold text-rose-700 dark:text-rose-300" : "font-bold text-emerald-700 dark:text-emerald-300"}>${a.new_price_usd}</span>
                  {a.mgs_product && <> · {t("admin.fzr.mgsPrice")} : {formatAr(a.mgs_product.price)} ({a.mgs_product.name})</>}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(a.detected_at).toLocaleString("fr-FR")}</p>
              </div>
              {!a.acknowledged && <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => ack(a.id)} data-testid={`fzr-ack-${a.id}`}><Check className="mr-1 h-3 w-3" />{t("admin.fzr.ack")}</Button>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5" data-testid="fzr-mappings-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{t("admin.fzr.mappings")}</h2>
            <p className="text-xs text-muted-foreground">{t("admin.fzr.mappingHint")}</p>
          </div>
          {can("catalog.manage") && !catalog && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={loadCatalog} disabled={busy === "catalog"} data-testid="fzr-load-catalog">
              {busy === "catalog" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.loadCatalog")}
            </Button>
          )}
        </div>
        {can("catalog.manage") && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3 sm:flex-row sm:items-center" data-testid="fzr-uc-audit">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">{t("admin.fzr.ucAudit")}</p>
              <p className="text-xs text-muted-foreground">{t("admin.fzr.ucAuditHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="rounded-full" onClick={runAudit} disabled={busy === "audit"} data-testid="fzr-uc-audit-run">
                {busy === "audit" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.ucAuditRun")}
              </Button>
              <Button size="sm" className="rounded-full" onClick={applyAudit} disabled={busy === "audit-apply"} data-testid="fzr-uc-audit-apply">
                {busy === "audit-apply" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.ucAuditApply")}
              </Button>
            </div>
          </div>
        )}
        {audit && (
          <div className="mt-2 space-y-1" data-testid="fzr-uc-audit-rows">
            {audit.map((r) => (
              <div key={r.product_id} className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${r.action === "ok" ? "bg-emerald-50 dark:bg-emerald-500/10" : r.action === "fix" ? "bg-amber-50 dark:bg-amber-500/10" : r.action === "remove" ? "bg-rose-50 dark:bg-rose-500/10" : "bg-muted/50"}`} data-testid={`fzr-uc-audit-row-${r.slug}`}>
                <span className="w-20 shrink-0 font-bold text-foreground">{r.uc_amount} UC</span>
                <span className="min-w-0 flex-1 basis-full break-words text-muted-foreground sm:basis-0">{r.resolved_mode === "missing" ? t("admin.fzr.auditMissing") : `${r.resolved_mode === "direct" ? t("admin.fzr.direct") : t("admin.fzr.composite")} · ${r.resolved_summary}`}</span>
                <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 font-bold ${r.action === "ok" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200" : r.action === "fix" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : r.action === "remove" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"}`} data-testid={`fzr-uc-audit-action-${r.slug}`}>
                  {r.action === "ok" ? t("admin.fzr.auditOk") : r.action === "fix" ? t("admin.fzr.auditFix") : r.action === "remove" ? t("admin.fzr.auditRemove") : t("admin.fzr.auditMissing")}
                </span>
              </div>
            ))}
          </div>
        )}
        {GROUPS.map(([type, labelKey]) => {
          const group = products.filter((p) => p.type === type);
          if (!group.length) return null;
          return (
            <div key={type} className="mt-5" data-testid={`fzr-group-${type}`}>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{t(`admin.fzr.${labelKey}`)}</p>
              <div className="space-y-1.5">
                {group.map((p) => {
                  const m = p.fazercards_mapping;
                  return (
                    <div key={p.id} className="rounded-xl border border-border bg-background/40 px-3 py-2 text-sm" data-testid={`fzr-map-${p.slug}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 max-w-full break-words font-semibold text-foreground">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{formatAr(p.price)}</span>
                        <StatusBadge p={p} t={t} />
                        {!p.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{t("admin.fzr.inactive")}</span>}
                        {p.supplier_cost_usd != null && <span className="text-xs font-semibold text-foreground" data-testid={`fzr-cost-${p.slug}`}>${p.supplier_cost_usd}</span>}
                        {can("catalog.manage") && (
                          <span className="ml-auto flex shrink-0 items-center gap-1">
                            <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => openConfig(p)} data-testid={`fzr-configure-${p.slug}`}>
                              {m ? t("admin.fzr.modify") : t("admin.fzr.configure")}
                            </Button>
                            {m && (
                              <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs text-rose-600" onClick={() => unlink(p)} disabled={busy === `unlink-${p.id}`} data-testid={`fzr-unlink-${p.slug}`}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </span>
                        )}
                      </div>
                      {m && (
                        <p className="mt-1 break-words text-xs text-muted-foreground" data-testid={`fzr-map-detail-${p.slug}`}>
                          {m.mode === "composite"
                            ? m.components.flatMap((c) => Array.from({ length: c.quantity }, () => `1 × ${c.offer_name}`)).join(" + ")
                            : <>{m.offer_name} · <span className="font-mono">{m.offer_id}</span></>}
                          {" "}· {m.category_id}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5" data-testid="fzr-coverage-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">{t("admin.fzr.coverage")}</h2>
            <p className="text-xs text-muted-foreground">{t("admin.fzr.coverageHint")}</p>
          </div>
          <Button size="sm" variant="outline" className="rounded-full" onClick={loadCoverage} disabled={busy === "coverage"} data-testid="fzr-coverage-load">
            {busy === "coverage" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.coverageLoad")}
          </Button>
        </div>
        {coverage && (
          <div className="mt-4 space-y-1.5" data-testid="fzr-coverage-list">
            {specialUnused.map((o) => (
              <div key={`${o.category_id}:${o.offer_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10" data-testid={`fzr-coverage-${o.offer_id}`}>
                <span className="min-w-0 break-words font-semibold text-foreground">{o.name}</span>
                <span className="break-all font-mono text-xs text-muted-foreground">{o.offer_id} · {o.category_id}</span>
                <span className="text-xs font-semibold text-foreground">${o.price_usd}</span>
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">{t("admin.fzr.availableNotActive")}</span>
              </div>
            ))}
            {specialUsed.map((o) => (
              <div key={`${o.category_id}:${o.offer_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm opacity-80" data-testid={`fzr-coverage-${o.offer_id}`}>
                <span className="min-w-0 break-words font-semibold text-foreground">{o.name}</span>
                <span className="break-all font-mono text-xs text-muted-foreground">{o.offer_id}</span>
                <span className="text-xs font-semibold text-foreground">${o.price_usd}</span>
                <span className="ml-auto max-w-full break-words rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">{t("admin.fzr.usedBy")} {o.used_by.map((u) => u.name).join(", ")}</span>
              </div>
            ))}
            {specialUnused.length === 0 && specialUsed.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
          </div>
        )}
      </section>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setForm(null); } }}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="fzr-config-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing?.name} — FazerCards</DialogTitle></DialogHeader>
          {editing && form && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">{t("admin.fzr.mode")}</p>
                <RadioGroup value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))} className="flex gap-4">
                  <label className="flex items-center gap-2"><RadioGroupItem value="direct" data-testid="fzr-mode-direct" />{t("admin.fzr.direct")}</label>
                  {editing.type === "uc" && (
                    <label className="flex items-center gap-2"><RadioGroupItem value="composite" data-testid="fzr-mode-composite" />{t("admin.fzr.composite")}</label>
                  )}
                </RadioGroup>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">{t("admin.fzr.category")}</p>
                <Select value={form.category_id} onValueChange={(v) => setForm((f) => ({ ...f, category_id: v, offer_id: "", components: [{ offer_id: "", quantity: 1 }] }))}>
                  <SelectTrigger className="h-10" data-testid="fzr-category-select"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(catalog || []).map((c) => <SelectItem key={c.category_id} value={c.category_id}>{c.name} ({c.category_id})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.mode === "direct" ? (
                <>
                  <div>
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">{t("admin.fzr.offer")}</p>
                    <Select value={form.offer_id} onValueChange={(v) => setForm((f) => ({ ...f, offer_id: v }))} disabled={!form.category_id}>
                      <SelectTrigger className="h-10" data-testid="fzr-offer-select"><SelectValue placeholder={t("admin.fzr.pickOffer")} /></SelectTrigger>
                      <SelectContent>{catOffers.map((o) => <SelectItem key={o.offer_id} value={o.offer_id}>{o.name} · ${o.price_usd}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {selectedOffer && (
                    <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="flex justify-between"><span className="text-slate-500">Offer ID</span><span className="font-mono font-semibold" data-testid="fzr-offer-id">{selectedOffer.offer_id}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500">{t("admin.fzr.cost")}</span><span className="font-semibold" data-testid="fzr-offer-cost">${selectedOffer.price_usd}</span></p>
                      <p className="flex justify-between"><span className="text-slate-500">{t("admin.fzr.mgsSell")}</span><span className="font-semibold">{formatAr(editing.price)}</span></p>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{t("admin.fzr.components")}</p>
                  {form.components.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input type="number" min="1" max="50" value={c.quantity} onChange={(e) => setComp(i, { quantity: e.target.value })} className="h-9 w-16" data-testid={`fzr-comp-qty-${i}`} />
                      <span className="text-slate-400">×</span>
                      <Select value={c.offer_id} onValueChange={(v) => setComp(i, { offer_id: v })} disabled={!form.category_id}>
                        <SelectTrigger className="h-9 flex-1" data-testid={`fzr-comp-offer-${i}`}><SelectValue placeholder={t("admin.fzr.pickOffer")} /></SelectTrigger>
                        <SelectContent>{catOffers.filter((o) => ucAmountOf(o) !== null).map((o) => <SelectItem key={o.offer_id} value={o.offer_id}>{o.name} · ${o.price_usd}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => setForm((f) => ({ ...f, components: f.components.filter((_, j) => j !== i) }))} disabled={form.components.length <= 1} data-testid={`fzr-comp-remove-${i}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => setForm((f) => ({ ...f, components: [...f.components, { offer_id: "", quantity: 1 }] }))} disabled={form.components.length >= 10} data-testid="fzr-comp-add">
                    {t("admin.fzr.addComponent")}
                  </Button>
                  {compTotals && (
                    <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="flex justify-between"><span className="text-slate-500">{t("admin.fzr.totalUc")}</span><span className="font-semibold" data-testid="fzr-comp-total-uc">{compTotals.uc} / {compTotals.target} UC</span></p>
                      <p className="flex justify-between"><span className="text-slate-500">{t("admin.fzr.totalSupplier")}</span><span className="font-semibold" data-testid="fzr-comp-total-usd">${compTotals.usd}</span></p>
                      <p className={`font-bold ${compTotals.exact ? "text-emerald-700" : "text-rose-700"}`} data-testid="fzr-comp-check">
                        {compTotals.exact ? t("admin.fzr.compExact") : t("admin.fzr.compInvalid")}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-start gap-2 rounded-xl border border-slate-100 p-3">
                <Checkbox checked={form.confirmed} onCheckedChange={(v) => setForm((f) => ({ ...f, confirmed: !!v }))} data-testid="fzr-confirmed-toggle" className="mt-0.5" />
                <span>
                  <span className="text-sm font-semibold">{t("admin.fzr.confirmedLabel")}</span>
                  <span className="block text-xs text-slate-500">{t("admin.fzr.toConfirmHint")}</span>
                </span>
              </label>
              {!form.confirmed && (
                <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="fzr-unconfirmed-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />{t("admin.fzr.statusUnconfirmed")}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="rounded-full" onClick={() => { setEditing(null); setForm(null); }} data-testid="fzr-mapping-cancel">{t("admin.fzr.preflightCancel")}</Button>
                <Button className="rounded-full" onClick={saveMapping} disabled={!canSave || busy === "save"} data-testid="fzr-mapping-save">
                  {busy === "save" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.saveMapping")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
