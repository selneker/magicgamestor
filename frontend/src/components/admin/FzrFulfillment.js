import { useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STATUS_STYLE = {
  submitted: "bg-sky-100 text-sky-700", processing: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700", failed: "bg-rose-100 text-rose-700",
  refunded: "bg-rose-100 text-rose-700", cancelled: "bg-rose-100 text-rose-700",
  submit_timeout: "bg-amber-100 text-amber-700", error: "bg-rose-100 text-rose-700", creating: "bg-slate-100 text-slate-600",
};

export const lineRecord = (order, idx) => (idx === 0 ? order.fazercards : order.fazercards_lines?.[String(idx)]);
export const lineSendable = (rec) => !rec || (!rec.provider_order_id && ["submit_timeout", "error"].includes(rec.status));

export const FzrFulfillment = ({ order, mappedIds, mapStatus = {}, readyCount, onChanged }) => {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const items = order.items || [];
  const records = items.map((_, idx) => lineRecord(order, idx));
  const hasAny = records.some(Boolean);
  if (!hasAny && order.status !== "paid") return null;

  const openPreflight = async () => {
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/orders/${order.id}/fazercards/preflight`);
      setReport(data);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const fulfill = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/orders/${order.id}/fazercards/fulfill`);
      const failed = (data.results || []).filter((r) => !r.ok);
      if (failed.length) failed.forEach((r) => toast.error(`${r.product} : ${r.error}`));
      else toast.success(t("admin.fzr.sent"));
      setReport(null); onChanged();
    } catch (e) { toast.error(errorMessage(e)); setReport(null); onChanged(); } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { await api.post(`/admin/orders/${order.id}/fazercards/refresh-status`); onChanged(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const canRefresh = records.some((r) => r?.provider_order_id && !["completed", "refunded"].includes(r.provider_status));

  const lineBadge = (item) => {
    if (item.quantity !== 1) return { cls: "bg-amber-100 text-amber-700", label: t("admin.fzr.lineQty"), kind: "blocked" };
    if (mappedIds[item.product_id]) return { cls: "bg-slate-200 text-slate-600", label: `○ ${t("admin.fzr.lineToSend")}`, kind: "ready" };
    const st = mapStatus[item.product_id];
    if (st === "composite") return { cls: "bg-sky-100 text-sky-700", label: t("admin.fzr.lineComposite"), kind: "composite" };
    if (st === "unconfirmed") return { cls: "bg-amber-100 text-amber-700", label: t("admin.fzr.lineUnconfirmed"), kind: "unconfirmed" };
    return { cls: "bg-amber-100 text-amber-700", label: t("admin.fzr.lineUnmapped"), kind: "blocked" };
  };

  return (
    <div className="col-span-full space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs" data-testid={`fzr-block-${order.order_number}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black uppercase tracking-[0.1em] text-slate-500">FazerCards</span>
        {readyCount > 0 && order.status === "paid" && (
          <Button size="sm" className="h-7 rounded-full text-xs" onClick={openPreflight} disabled={busy} data-testid={`fzr-send-${order.order_number}`}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
            {t("admin.fzr.send")} ({readyCount})
          </Button>
        )}
        {canRefresh && (
          <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={refresh} disabled={busy} data-testid={`fzr-refresh-${order.order_number}`}>
            <RefreshCw className="mr-1 h-3 w-3" />{t("admin.fzr.refresh")}
          </Button>
        )}
      </div>
      <ul className="space-y-0.5">
        {items.map((item, idx) => {
          const rec = records[idx];
          return (
            <li key={idx} className="flex flex-wrap items-center gap-2" data-testid={`fzr-line-${order.order_number}-${idx}`}>
              <span className="text-slate-600">{item.quantity}× {item.name}</span>
              {rec ? (
                <>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[rec.provider_status || rec.status] || "bg-slate-100 text-slate-600"}`} data-testid={`fzr-line-status-${order.order_number}-${idx}`}>
                    {rec.provider_order_id ? `✓ ${rec.provider_status || rec.status}` : rec.status}
                  </span>
                  {rec.provider_order_id && <span className="font-mono" data-testid={`fzr-line-provider-id-${order.order_number}-${idx}`}>{rec.provider_order_id}</span>}
                  {rec.supplier_price_usd_at_order && <span className="text-slate-500">${rec.supplier_price_usd_at_order}</span>}
                  {rec.last_error && !rec.provider_order_id && <span className="text-rose-600">{rec.last_error}</span>}
                </>
              ) : order.status === "paid" ? (() => {
                const b = lineBadge(item);
                return <span className={`rounded-full px-2 py-0.5 font-semibold ${b.cls}`} data-testid={`fzr-line-${b.kind}-${order.order_number}-${idx}`}>{b.label}</span>;
              })() : null}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent data-testid="fzr-preflight-dialog">
          <DialogHeader><DialogTitle>{t("admin.fzr.preflightTitle")}</DialogTitle></DialogHeader>
          {report && (
            <div className="space-y-2 text-sm">
              <p className="flex justify-between gap-4 border-b border-slate-100 py-1"><span className="text-slate-500">{t("admin.fzr.mgsOrder")}</span><span className="font-semibold">{report.order_number}</span></p>
              <p className="flex justify-between gap-4 border-b border-slate-100 py-1"><span className="text-slate-500">{t("admin.fzr.playerId")}</span><span className="font-semibold">{report.player_id}</span></p>
              <p className="flex justify-between gap-4 border-b border-slate-100 py-1"><span className="text-slate-500">{t("admin.fzr.playerName")}</span><span className="font-semibold">{report.player_name || "—"}</span></p>
              {(report.lines || []).map((l) => (
                <div key={l.index} className="rounded-lg bg-slate-50 p-2" data-testid={`fzr-preflight-line-${l.index}`}>
                  <p className="font-semibold">{l.product}</p>
                  <p className="text-xs text-slate-600">{l.offer_name} ({l.offer_id}) · ${l.price_usd}</p>
                  <p className="break-all text-xs text-slate-500">{t("admin.fzr.idem")} : {l.idempotency_key}</p>
                  {l.retry && <p className="text-xs text-amber-700">{t("admin.fzr.preflightRetryNote")}</p>}
                </div>
              ))}
              {(report.skipped || []).map((s) => (
                <p key={s.index} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700" data-testid={`fzr-preflight-skipped-${s.index}`}>{s.product} : {s.reason}</p>
              ))}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="rounded-full" onClick={() => setReport(null)} data-testid="fzr-preflight-cancel">{t("admin.fzr.preflightCancel")}</Button>
                <Button className="rounded-full" onClick={fulfill} disabled={busy} data-testid="fzr-preflight-confirm">
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.preflightConfirm")} ({(report.lines || []).length})
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
