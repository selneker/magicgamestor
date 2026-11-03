import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Coins, Gift } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useGames } from "@/context/GameContext";
import { Button } from "@/components/ui/button";
import { IdentityFieldsVerify } from "@/components/store/checkout/IdentityFieldsVerify";

// Jeu FIGÉ pour la fidélité (décision Selneker, option b — PL-003-FE-4) : le
// backend `/loyalty/redeem` exige encore `pubg_id` (BE-12 hors périmètre), mais
// la VÉRIFICATION passe désormais par le composant GÉNÉRIQUE. Les champs
// affichés viennent exclusivement de GET /api/games (identity_fields du jeu) :
// si le jeu est introuvable ou inactif dans la réponse, AUCUNE supposition de
// format — sans spec, pas de formulaire et pas d'échange.
const LOYALTY_GAME = "pubg-mobile";

function Ledger({ entries }) {
  const { t, lang } = useLang();
  if (!entries.length) return <p className="text-sm text-muted-foreground" data-testid="ledger-empty">{t("loyalty.ledgerEmpty")}</p>;
  return (
    <ul className="divide-y text-sm" data-testid="loyalty-ledger">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 py-2" data-testid={`ledger-${e.type}`}>
          <div className="min-w-0"><p className="truncate font-semibold">{e.reason}</p><p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR")} · {e.bucket === "promo" ? t("loyalty.promo") : t("loyalty.earned")}</p></div>
          <span className={`num shrink-0 text-right text-base font-semibold ${e.amount >= 0 ? "text-foreground" : "text-destructive"}`}>{e.amount > 0 ? "+" : ""}{e.amount} pts</span>
        </li>
      ))}
    </ul>
  );
}

function Rewards({ rewards, onRedeem }) {
  const { t } = useLang();
  const { user } = useAuth();
  const { games } = useGames();
  const game = games.find((g) => g.id === LOYALTY_GAME) || null;
  const spec = useMemo(() => game?.identity_fields || [], [game]);
  const primaryKey = useMemo(() => (spec.find((f) => f.primary) || spec[0])?.key || "player_id", [spec]);
  const [values, setValues] = useState({});
  // Uniquement ce que le composant générique renvoie sur `valid:true`
  // ({ name, fields }) — un préremplissage n'y entre jamais (§4.8).
  const [verified, setVerified] = useState(null);
  // Même règle que StepVerify : un ID mémorisé (`saved_pubg_ids`) arrive dans le
  // champ mais n'est JAMAIS compté comme vérifié — la re-vérification réelle
  // (POST /fazercards/validate-id, valid:true) seule ouvre l'échange, et un
  // effacement volontaire n'est pas ré-rempli.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !spec.length) return;
    const saved = user?.saved_pubg_ids?.[0];
    if (saved) setValues((v) => (v[primaryKey] ? v : { ...v, [primaryKey]: saved }));
  }, [spec, user, primaryKey]);
  const writeValues = useCallback((v) => { touched.current = true; setValues(v); }, []);

  // Le payload `/loyalty/redeem` ne change pas (BE-12 hors périmètre) : la
  // valeur tronquée-vérifiée du champ primaire part dans `pubg_id`.
  const verifiedId = verified?.fields?.[primaryKey] || null;

  return (
    <div className="space-y-3">
      {spec.length ? (
        <IdentityFieldsVerify
          gameId={LOYALTY_GAME}
          spec={spec}
          values={values}
          setValues={writeValues}
          onVerified={setVerified}
          checkout
        />
      ) : (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"
          data-testid="loyalty-verify-unavailable"
        >
          {t("checkout.verifyProviderUnavailable")}
        </p>
      )}
      {rewards.length === 0
        ? <p className="text-sm text-muted-foreground" data-testid="rewards-empty">{t("loyalty.rewardsEmpty")}</p>
        : rewards.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-[color:var(--rule-strong)]" data-testid={`reward-${r.id}`}>
          <div><p className="font-semibold">{r.name}</p>{r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}</div>
          {/* Bloqué tant que le composant générique n'a pas renvoyé `valid:true`
              (aucune modification de champ depuis) : pas de pubg_id signalé,
              pas d'échange. */}
          <Button size="sm" disabled={!verifiedId} onClick={() => onRedeem(r, verifiedId)} className="rounded-full font-semibold" data-testid={`redeem-${r.id}`}>{r.cost_points} pts</Button>
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
        <div className="panel-points p-5"><p className="eyebrow-invert">{t("loyalty.balance")}</p><p className="num mt-1 flex items-center gap-2 text-4xl text-[#C5FE02]" data-testid="loyalty-total"><Coins className="h-6 w-6" aria-hidden="true" />{data.balance.total}<span className="text-base font-semibold text-[#C5FE02]/80">pts</span></p></div>
        <div className="panel p-5"><p className="eyebrow">{t("loyalty.earned")}</p><p className="num mt-1 text-3xl text-foreground" data-testid="loyalty-earned">{data.balance.earned}</p></div>
        <div className="panel p-5"><p className="eyebrow">{t("loyalty.promo")}</p><p className="num mt-1 text-3xl text-foreground" data-testid="loyalty-promo">{data.balance.promo}</p></div>
      </div>
      <p className="mt-3 rounded-[14px] border-2 border-[color:var(--rule)] bg-muted/40 p-4 text-sm text-muted-foreground">{t("loyalty.howto", { pts: data.config.points_per_1000_ar })}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="panel p-6"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Gift className="h-5 w-5" />{t("loyalty.rewards")}</h2><div className="mt-4"><Rewards rewards={rewards} onRedeem={redeem} /></div></section>
        <section className="panel p-6"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><Coins className="h-5 w-5" />{t("loyalty.history")}</h2><div className="mt-4"><Ledger entries={data.ledger} /></div></section>
        <section className="panel p-6 lg:col-span-2"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><ArrowLeftRight className="h-5 w-5" />{t("loyalty.transfers")}</h2><div className="mt-4"><Transfers config={data.config} transfers={transfers} reload={load} /></div></section>
      </div>
    </div>
  );
}
