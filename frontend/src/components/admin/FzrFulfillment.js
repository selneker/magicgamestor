import { useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Convention couleurs (clair + sombre) : vert = succès, bleu = en cours/info, ambre = attente/action, rouge = erreur, gris = neutre.
const STATUS_STYLE = {
  submitted: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  processing: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  refunded: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  submit_timeout: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  error: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  creating: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};
const NEUTRAL = "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
const TO_SEND = "bg-slate-200 text-slate-600 dark:bg-slate-600/60 dark:text-slate-200";

export const lineRecord = (order, idx) => (idx === 0 ? order.fazercards : order.fazercards_lines?.[String(idx)]);
export const unitRecord = (order, idx, u) => order.fazercards_components?.[String(idx)]?.[String(u)];
export const lineSendable = (rec) => !rec || (!rec.provider_order_id && ["submit_timeout", "error"].includes(rec.status));

const StatusBadge = ({ rec, testid, t }) => (
  <>
    <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[rec.provider_status || rec.status] || NEUTRAL}`} data-testid={testid}>
      {rec.provider_order_id ? `✓ ${rec.provider_status || rec.status}` : rec.status}
    </span>
    {rec.provider_order_id && <span className="font-mono text-slate-500 dark:text-slate-400" data-testid={`${testid}-provider-id`}>{rec.provider_order_id}</span>}
    {rec.supplier_price_usd_at_order && <span className="text-slate-400 dark:text-slate-500">${rec.supplier_price_usd_at_order}</span>}
    {rec.last_error && !rec.provider_order_id && <span className="text-rose-600 dark:text-rose-400">{rec.last_error}</span>}
  </>
);

export const FzrFulfillment = ({ order, mappedIds, mapStatus = {}, mapComponents = {}, readyCount, onChanged }) => {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const items = order.items || [];

  const allRecords = [];
  items.forEach((it, idx) => {
    const comps = mapComponents[it.product_id];
    if (comps?.length) comps.forEach((_, u) => allRecords.push(unitRecord(order, idx, u)));
    else allRecords.push(lineRecord(order, idx));
  });
  const hasAny = allRecords.some(Boolean);
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
      if (failed.length) failed.forEach((r) => toast.error(`${r.product}${r.component_name ? ` · ${r.component_name}` : ""} : ${r.error}`));
      else toast.success(t("admin.fzr.sent"));
      setReport(null); onChanged();
    } catch (e) { toast.error(errorMessage(e)); setReport(null); onChanged(); } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { await api.post(`/admin/orders/${order.id}/fazercards/refresh-status`); onChanged(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const canRefresh = allRecords.some((r) => r?.provider_order_id && !["completed", "refunded"].includes(r.provider_status));

  const directBadge = (item) => {
    if (item.quantity !== 1) return { cls: STATUS_STYLE.submit_timeout, label: t("admin.fzr.lineQty"), kind: "blocked" };
    if (mappedIds[item.product_id]) return { cls: TO_SEND, label: `○ ${t("admin.fzr.lineToSend")}`, kind: "ready" };
    const st = mapStatus[item.product_id];
    if (st === "unconfirmed") return { cls: STATUS_STYLE.submit_timeout, label: t("admin.fzr.lineUnconfirmed"), kind: "unconfirmed" };
    return { cls: STATUS_STYLE.submit_timeout, label: t("admin.fzr.lineUnmapped"), kind: "blocked" };
  };

  return (
    <div className="col-span-full space-y-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs dark:bg-slate-800/40" data-testid={`fzr-block-${order.order_number}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">FazerCards</span>
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
      <ul className="space-y-1.5">
        {items.map((item, idx) => {
          const comps = mapComponents[item.product_id];
          if (comps?.length) {
            return (
              <li key={idx} className="rounded-lg border-l-2 border-sky-300 bg-white/70 px-2.5 py-1.5 dark:border-sky-500/50 dark:bg-slate-900/30" data-testid={`fzr-line-${order.order_number}-${idx}`}>
                <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-700 dark:text-slate-100">
                  {item.quantity}× {item.name}
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{t("admin.fzr.composition")}</span>
                </p>
                <ul className="mt-1.5 space-y-1 pl-2">
                  {comps.map((c, u) => {
                    const rec = unitRecord(order, idx, u);
                    return (
                      <li key={u} className="flex flex-wrap items-center gap-2" data-testid={`fzr-comp-${order.order_number}-${idx}-${u}`}>
                        <span className="text-slate-500 dark:text-slate-400">└─ 1× {c.offer_name}</span>
                        {rec ? <StatusBadge rec={rec} t={t} testid={`fzr-comp-status-${order.order_number}-${idx}-${u}`} />
                          : order.status === "paid" ? <span className={`rounded-full px-2 py-0.5 font-semibold ${TO_SEND}`} data-testid={`fzr-comp-ready-${order.order_number}-${idx}-${u}`}>○ {t("admin.fzr.lineToSend")}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          }
          const rec = lineRecord(order, idx);
          return (
            <li key={idx} className="flex flex-wrap items-center gap-2 px-0.5" data-testid={`fzr-line-${order.order_number}-${idx}`}>
              <span className="text-slate-600 dark:text-slate-300">{item.quantity}× {item.name}</span>
              {rec ? <StatusBadge rec={rec} t={t} testid={`fzr-line-status-${order.order_number}-${idx}`} />
                : order.status === "paid" ? (() => {
                  const b = directBadge(item);
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
              <p className="flex justify-between gap-4 border-b border-slate-100 py-1 dark:border-slate-700"><span className="text-slate-500">{t("admin.fzr.mgsOrder")}</span><span className="font-semibold">{report.order_number}</span></p>
              <p className="flex justify-between gap-4 border-b border-slate-100 py-1 dark:border-slate-700"><span className="text-slate-500">{t("admin.fzr.playerId")}</span><span className="font-semibold">{report.player_id}</span></p>
              <p className="flex justify-between gap-4 border-b border-slate-100 py-1 dark:border-slate-700"><span className="text-slate-500">{t("admin.fzr.playerName")}</span><span className="font-semibold">{report.player_name || "—"}</span></p>
              {(report.lines || []).map((l, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60" data-testid={`fzr-preflight-line-${l.index}${l.component_index != null ? `-${l.component_index}` : ""}`}>
                  <p className="font-semibold">{l.product}{l.component_name ? <span className="text-slate-500"> · {l.component_name}</span> : null}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{l.offer_name} ({l.offer_id}) · ${l.price_usd}</p>
                  <p className="break-all text-xs text-slate-500">{t("admin.fzr.idem")} : {l.idempotency_key}</p>
                  {l.retry && <p className="text-xs text-amber-700 dark:text-amber-400">{t("admin.fzr.preflightRetryNote")}</p>}
                </div>
              ))}
              {(report.skipped || []).map((s, i) => (
                <p key={i} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" data-testid={`fzr-preflight-skipped-${s.index}`}>{s.product} : {s.reason}</p>
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
