import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, formatAr } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AdminFazercards() {
  const { t } = useLang();
  const { isSuperAdmin, can } = useAuth();
  const [settings, setSettings] = useState(null);
  const [alerts, setAlerts] = useState({ alerts: [], unacknowledged: 0 });
  const [products, setProducts] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api.get("/admin/fazercards/settings").then((r) => setSettings(r.data)).catch(() => {});
    api.get("/admin/fazercards/price-alerts").then((r) => setAlerts(r.data)).catch(() => {});
    api.get("/admin/fazercards/mappings").then((r) => setProducts(r.data.products.filter((p) => p.type === "uc"))).catch(() => {});
  }, []);
  useEffect(load, [load]);

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
  const loadCatalog = async () => {
    setBusy("catalog");
    try { const { data } = await api.get("/fazercards/pubg/catalog"); setCatalog(data.categories); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const ack = async (id) => {
    try { await api.patch(`/admin/fazercards/price-alerts/${id}/ack`); toast.success(t("admin.fzr.ackDone")); load(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const link = async (productId) => {
    const pick = picks[productId];
    if (!pick) return;
    const [category_id, offer_id] = pick.split("::");
    setBusy(`link-${productId}`);
    try { await api.patch(`/admin/fazercards/products/${productId}/mapping`, { category_id, offer_id }); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const unlink = async (productId) => {
    setBusy(`link-${productId}`);
    try { await api.delete(`/admin/fazercards/products/${productId}/mapping`); load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };

  const offerOptions = (catalog || []).flatMap((c) => c.offers.map((o) => ({
    value: `${c.category_id}::${o.offer_id}`, label: `${c.category_id} · ${o.name} · $${o.price_usd}`,
  })));

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

      <section className="rounded-2xl border border-slate-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-slate-900">{t("admin.fzr.priceAlerts")}{alerts.unacknowledged > 0 && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700" data-testid="fzr-alert-count">{alerts.unacknowledged}</span>}</h2>
          {can("catalog.manage") && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={refreshCatalog} disabled={busy === "refresh"} data-testid="fzr-refresh-catalog">
              {busy === "refresh" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
              {busy === "refresh" ? t("admin.fzr.refreshing") : t("admin.fzr.refreshCatalog")}
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {alerts.alerts.length === 0 && <p className="text-sm text-slate-400" data-testid="fzr-no-alerts">{t("admin.fzr.noAlerts")}</p>}
          {alerts.alerts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${a.acknowledged ? "border-slate-100 opacity-60" : a.direction === "up" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`} data-testid={`fzr-alert-${a.id}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.offer_name} <span className="font-mono text-xs text-slate-500">({a.category_id})</span></p>
                <p className="text-xs text-slate-600">{t("admin.fzr.oldCost")} : ${a.old_price_usd} → {t("admin.fzr.newCost")} : <span className={a.direction === "up" ? "font-bold text-rose-700" : "font-bold text-emerald-700"}>${a.new_price_usd}</span>
                  {a.mgs_product && <> · {t("admin.fzr.mgsPrice")} : {formatAr(a.mgs_product.price)} ({a.mgs_product.name})</>}</p>
                <p className="text-[11px] text-slate-400">{new Date(a.detected_at).toLocaleString("fr-FR")}</p>
              </div>
              {!a.acknowledged && <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => ack(a.id)} data-testid={`fzr-ack-${a.id}`}><Check className="mr-1 h-3 w-3" />{t("admin.fzr.ack")}</Button>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">{t("admin.fzr.mappings")}</h2>
            <p className="text-xs text-slate-500">{t("admin.fzr.mappingHint")}</p>
          </div>
          {can("catalog.manage") && !catalog && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={loadCatalog} disabled={busy === "catalog"} data-testid="fzr-load-catalog">
              {busy === "catalog" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.loadCatalog")}
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {products.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3 text-sm" data-testid={`fzr-map-${p.slug}`}>
              <span className="w-24 font-semibold">{p.name}</span>
              <span className="text-xs text-slate-500">{formatAr(p.price)}</span>
              {p.fazercards_mapping ? (
                <>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700" data-testid={`fzr-map-linked-${p.slug}`}>{t("admin.fzr.linked")}</span>
                  <span className="text-xs text-slate-600">{p.fazercards_mapping.offer_name} · {p.fazercards_mapping.category_id} · ${p.fazercards_mapping.price_usd_at_link}</span>
                  {can("catalog.manage") && <Button size="sm" variant="ghost" className="ml-auto rounded-full text-xs text-rose-600" onClick={() => unlink(p.id)} disabled={busy === `link-${p.id}`} data-testid={`fzr-unlink-${p.slug}`}>{t("admin.fzr.unlink")}</Button>}
                </>
              ) : (
                <>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t("admin.fzr.notLinked")}</span>
                  {can("catalog.manage") && catalog && (
                    <div className="ml-auto flex items-center gap-2">
                      <Select value={picks[p.id] || ""} onValueChange={(v) => setPicks((s) => ({ ...s, [p.id]: v }))}>
                        <SelectTrigger className="h-9 w-72 rounded-full text-xs" data-testid={`fzr-offer-select-${p.slug}`}><SelectValue placeholder={t("admin.fzr.pickOffer")} /></SelectTrigger>
                        <SelectContent>{offerOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" className="rounded-full text-xs" onClick={() => link(p.id)} disabled={!picks[p.id] || busy === `link-${p.id}`} data-testid={`fzr-link-${p.slug}`}>{t("admin.fzr.link")}</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
