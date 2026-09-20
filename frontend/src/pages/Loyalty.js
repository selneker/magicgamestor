import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Coins, Gift } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function Ledger({ entries }) {
  const { t, lang } = useLang();
  if (!entries.length) return <p className="text-sm text-muted-foreground" data-testid="ledger-empty">{t("loyalty.ledgerEmpty")}</p>;
  return (
    <ul className="divide-y text-sm" data-testid="loyalty-ledger">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 py-2" data-testid={`ledger-${e.type}`}>
          <div className="min-w-0"><p className="truncate">{e.reason}</p><p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")} · {e.bucket === "promo" ? t("loyalty.promo") : t("loyalty.earned")}</p></div>
          <span className={`num text-base ${e.amount >= 0 ? "text-foreground" : "text-destructive"}`}>{e.amount > 0 ? "+" : ""}{e.amount}</span>
        </li>
      ))}
    </ul>
  );
}

function Rewards({ rewards, onRedeem }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [pubg, setPubg] = useState(user.saved_pubg_ids?.[0] || "");
  if (!rewards.length) return <p className="text-sm text-muted-foreground" data-testid="rewards-empty">{t("loyalty.rewardsEmpty")}</p>;
  return (
    <div className="space-y-3">
      <div><label htmlFor="rw-pubg" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("checkout.pubgId")}</label><Input id="rw-pubg" value={pubg} onChange={(e) => setPubg(e.target.value.replace(/\D/g, ""))} className="mt-1 h-10 rounded-xl" data-testid="reward-pubg-input" /></div>
      {rewards.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" data-testid={`reward-${r.id}`}>
          <div><p className="font-semibold">{r.name}</p>{r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}</div>
          <Button size="sm" onClick={() => onRedeem(r, pubg)} className="rounded-full font-semibold" data-testid={`redeem-${r.id}`}>{r.cost_points} pts</Button>
        </div>
      ))}
    </div>
  );
}

function Transfers({ config, transfers, reload }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [form, setForm] = useState({ email: "", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post("/loyalty/transfers", { recipient_email: form.email, amount: Number(form.amount), note: form.note || undefined }); toast.success(t("loyalty.transferSent")); setForm({ email: "", amount: "", note: "" }); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const act = async (id, action) => { try { await api.post(`/loyalty/transfers/${id}/${action}`); reload(); } catch (err) { toast.error(errorMessage(err)); } };
  return (
    <div className="space-y-4">
      {!config.transfers_enabled ? <p className="text-sm text-muted-foreground">{t("loyalty.transfersOff")}</p> : !user.email_verified ? <p className="text-sm text-muted-foreground" data-testid="transfer-needs-verification">{t("loyalty.transferVerify")}</p> : (
        <form onSubmit={send} className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
          <Input type="email" required placeholder={t("loyalty.recipient")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11 rounded-xl" data-testid="transfer-email-input" aria-label={t("loyalty.recipient")} />
          <Input type="number" required min={config.transfer_min} placeholder="pts" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-11 rounded-xl" data-testid="transfer-amount-input" aria-label={t("loyalty.amount")} />
          <Button type="submit" disabled={busy} className="h-11 rounded-full font-semibold" data-testid="transfer-submit">{t("loyalty.send")}</Button>
          <p className="text-xs text-muted-foreground sm:col-span-3">{t("loyalty.transferRules", { min: config.transfer_min, daily: config.transfer_daily_limit, monthly: config.transfer_monthly_limit })}</p>
        </form>
      )}
      <ul className="divide-y text-sm" data-testid="transfers-list">
        {transfers.map((tr) => {
          const incoming = tr.to_user_id === user.user_id;
          return (
            <li key={tr.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`transfer-${tr.status}`}>
              <span>{incoming ? `← ${tr.from_email}` : `→ ${tr.to_email}`} · <b>{tr.amount} pts</b> · <span className="uppercase text-xs tracking-wider">{t(`loyalty.status.${tr.status}`)}</span></span>
              {tr.status === "pending" && (
                <span className="flex gap-2">
                  {incoming && <Button size="sm" onClick={() => act(tr.id, "accept")} className="rounded-full" data-testid={`accept-${tr.id}`}>{t("loyalty.accept")}</Button>}
                  <Button size="sm" variant="outline" onClick={() => act(tr.id, "cancel")} className="rounded-full" data-testid={`cancel-${tr.id}`}>{t("admin.cancel")}</Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Loyalty() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const load = useCallback(() => {
    api.get("/loyalty/me").then((r) => setData(r.data)).catch(() => setData({ balance: { total: 0, earned: 0, promo: 0 }, ledger: [], config: {} }));
    api.get("/loyalty/rewards").then((r) => setRewards(r.data)).catch(() => {});
    api.get("/loyalty/transfers").then((r) => setTransfers(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const redeem = async (reward, pubg) => {
    try { await api.post("/loyalty/redeem", { reward_id: reward.id, pubg_id: pubg || undefined }); toast.success(t("loyalty.redeemed")); load(); } catch (err) { toast.error(errorMessage(err)); }
  };
  if (!data) return <p className="py-12 text-slate-500">{t("common.loading")}</p>;
  return (
    <div className="pb-24 pt-6" data-testid="loyalty-page">
      <p className="eyebrow">{t("account.title")}</p>
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("loyalty.title")}</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="panel-black p-5"><p className="eyebrow text-background/70">{t("loyalty.balance")}</p><p className="num mt-1 text-4xl text-primary" data-testid="loyalty-total">{data.balance.total}</p></div>
        <div className="panel p-5"><p className="eyebrow">{t("loyalty.earned")}</p><p className="num mt-1 text-3xl" data-testid="loyalty-earned">{data.balance.earned}</p></div>
        <div className="panel p-5"><p className="eyebrow">{t("loyalty.promo")}</p><p className="num mt-1 text-3xl" data-testid="loyalty-promo">{data.balance.promo}</p></div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{t("loyalty.howto", { pts: data.config.points_per_1000_ar })}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="panel p-6"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Gift className="h-5 w-5" />{t("loyalty.rewards")}</h2><div className="mt-4"><Rewards rewards={rewards} onRedeem={redeem} /></div></section>
        <section className="panel p-6"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Coins className="h-5 w-5" />{t("loyalty.history")}</h2><div className="mt-4"><Ledger entries={data.ledger} /></div></section>
        <section className="panel p-6 lg:col-span-2"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><ArrowLeftRight className="h-5 w-5" />{t("loyalty.transfers")}</h2><div className="mt-4"><Transfers config={data.config} transfers={transfers} reload={load} /></div></section>
      </div>
    </div>
  );
}
