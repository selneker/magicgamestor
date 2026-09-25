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

export const FzrFulfillment = ({ order, mapped, onChanged }) => {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const fzr = order.fazercards;
  const eligible = mapped && order.status === "paid" && (!fzr || (!fzr.provider_order_id && ["submit_timeout", "error"].includes(fzr.status)));
  if (!fzr && !eligible) return null;

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
      await api.post(`/admin/orders/${order.id}/fazercards/fulfill`);
      toast.success(t("admin.fzr.sent"));
      setReport(null); onChanged();
    } catch (e) { toast.error(errorMessage(e)); setReport(null); onChanged(); } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { await api.post(`/admin/orders/${order.id}/fazercards/refresh-status`); onChanged(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="col-span-full flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs" data-testid={`fzr-block-${order.order_number}`}>
      <span className="font-black uppercase tracking-[0.1em] text-slate-500">FazerCards</span>
      {fzr && (
        <>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[fzr.provider_status || fzr.status] || "bg-slate-100 text-slate-600"}`} data-testid={`fzr-status-${order.order_number}`}>
            {fzr.provider_status || fzr.status}
          </span>
          {fzr.provider_order_id && <span className="font-mono" data-testid={`fzr-provider-id-${order.order_number}`}>{fzr.provider_order_id}</span>}
          {fzr.supplier_price_usd_at_order && <span className="text-slate-500">{t("admin.fzr.supplierPrice")} : ${fzr.supplier_price_usd_at_order}</span>}
          {fzr.player_name_at_validation && <span className="text-slate-500">{fzr.player_name_at_validation}</span>}
          {fzr.last_error && !fzr.provider_order_id && <span className="text-rose-600">{fzr.last_error}</span>}
          {fzr.provider_order_id && !["completed", "refunded"].includes(fzr.provider_status) && (
            <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={refresh} disabled={busy} data-testid={`fzr-refresh-${order.order_number}`}>
              <RefreshCw className="mr-1 h-3 w-3" />{t("admin.fzr.refresh")}
            </Button>
          )}
        </>
      )}
      {eligible && (
        <Button size="sm" className="h-7 rounded-full text-xs" onClick={openPreflight} disabled={busy} data-testid={`fzr-send-${order.order_number}`}>
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
          {fzr ? t("admin.fzr.retry") : t("admin.fzr.send")}
        </Button>
      )}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent data-testid="fzr-preflight-dialog">
          <DialogHeader><DialogTitle>{t("admin.fzr.preflightTitle")}</DialogTitle></DialogHeader>
          {report && (
            <div className="space-y-1 text-sm">
              {[[t("admin.fzr.mgsOrder"), report.order_number], [t("admin.fzr.product"), report.product],
                [t("admin.fzr.offer"), `${report.offer_name} (${report.offer_id})`], ["category_id", report.category_id],
                ["price_usd", `$${report.price_usd}`], [t("admin.fzr.playerId"), report.player_id],
                [t("admin.fzr.playerName"), report.player_name || "—"], [t("admin.fzr.idem"), report.idempotency_key]].map(([k, v]) => (
                <p key={k} className="flex justify-between gap-4 border-b border-slate-100 py-1"><span className="text-slate-500">{k}</span><span className="font-semibold break-all text-right">{v}</span></p>
              ))}
              {report.retry && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">{t("admin.fzr.preflightRetryNote")}</p>}
              <div className="flex justify-end gap-2 pt-3">
                <Button variant="outline" className="rounded-full" onClick={() => setReport(null)} data-testid="fzr-preflight-cancel">{t("admin.fzr.preflightCancel")}</Button>
                <Button className="rounded-full" onClick={fulfill} disabled={busy} data-testid="fzr-preflight-confirm">
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{t("admin.fzr.preflightConfirm")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
