import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const NETWORKS = ["TRC20", "BEP20", "APTOS", "TON"];
const panel = "border-2 border-foreground bg-card p-4 sm:p-5";

export default function AdminBinance() {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";
  const [s, setS] = useState(null);
  const [payments, setPayments] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [networks, setNetworks] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/crypto/admin/settings").then((r) => setS(r.data)).catch((e) => toast.error(errorMessage(e)));
    api.get("/crypto/admin/payments").then((r) => setPayments(r.data)).catch(() => {});
    api.get("/crypto/admin/unmatched").then((r) => setUnmatched(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!s) return <p className="text-muted-foreground">Chargement…</p>;

  const setWallet = (n, patch) => setS({ ...s, wallets: { ...s.wallets, [n]: { ...s.wallets[n], ...patch } } });
  const save = async (patch = {}) => {
    setBusy(true);
    try {
      const body = { enabled: s.enabled, rate_ar_per_usdt: Number(s.rate_ar_per_usdt) || undefined, expiry_minutes: Number(s.expiry_minutes), wallets: s.wallets, ...patch };
      const { data } = await api.patch("/crypto/admin/settings", body);
      setS(data); toast.success("Réglages Binance enregistrés.");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast.success(ok(r.data)); load(); } catch (e) { toast.error(errorMessage(e)); } };

  return (
    <div className="space-y-6" data-testid="admin-binance">
      <section className={panel}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Paiements · Binance USDT (dépôts CEX)</p>
            <p className="mt-1 text-xs text-muted-foreground">Détection automatique via l'API Binance (lecture seule). Aucun retrait, aucun trading.</p>
            <p className={`mt-2 text-xs font-bold ${s.api_configured ? "text-emerald-600" : "text-rose-600"}`} data-testid="binance-api-status">{s.api_configured ? "✓ Clés API configurées côté serveur" : "⚠ BINANCE_API_KEY / BINANCE_API_SECRET absentes côté serveur"}</p>
          </div>
          <Switch checked={s.enabled} disabled={!superAdmin || busy} onCheckedChange={(v) => save({ enabled: v })} data-testid="binance-enabled-toggle" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Taux (Ar pour 1 USDT)
            <Input type="number" min="1" value={s.rate_ar_per_usdt || ""} onChange={(e) => setS({ ...s, rate_ar_per_usdt: e.target.value })} disabled={!superAdmin} className="mt-1 h-11" data-testid="binance-rate-input" />
          </label>
          <label className="text-sm font-semibold">Validité d'un paiement (minutes)
            <Input type="number" min="10" max="180" value={s.expiry_minutes} onChange={(e) => setS({ ...s, expiry_minutes: e.target.value })} disabled={!superAdmin} className="mt-1 h-11" data-testid="binance-expiry-input" />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Le taux et le montant USDT exact sont figés dans chaque paiement : modifier le taux n'affecte pas les paiements existants.</p>
      </section>

      <section className={panel} data-testid="binance-wallets">
        <p className="eyebrow">Wallets de dépôt Binance</p>
        <p className="mt-1 text-xs text-muted-foreground">Collez l'adresse exacte affichée par Binance (Dépôt → USDT → réseau). Renseignez le MEMO uniquement si Binance en affiche un pour ce réseau.</p>
        <div className="mt-3 divide-y divide-border">
          {NETWORKS.map((n) => (
            <div key={n} className="grid gap-2 py-3 sm:grid-cols-[110px_1fr_160px_auto] sm:items-center" data-testid={`binance-wallet-${n}`}>
              <p className="font-display font-bold">{n}<span className="block text-[11px] font-normal text-muted-foreground">Binance : {s.binance_codes[n]}</span></p>
              <Input placeholder="Adresse" value={s.wallets[n].address} onChange={(e) => setWallet(n, { address: e.target.value })} disabled={!superAdmin} className="h-10 font-mono text-xs" data-testid={`binance-address-${n}`} />
              <Input placeholder="MEMO (si requis)" value={s.wallets[n].memo} onChange={(e) => setWallet(n, { memo: e.target.value })} disabled={!superAdmin} className="h-10 font-mono text-xs" data-testid={`binance-memo-${n}`} />
              <Switch checked={s.wallets[n].active} onCheckedChange={(v) => setWallet(n, { active: v })} disabled={!superAdmin} data-testid={`binance-active-${n}`} />
            </div>
          ))}
        </div>
        {superAdmin && <Button onClick={() => save()} disabled={busy} className="mt-3 rounded-full font-bold" data-testid="binance-save">Enregistrer</Button>}
      </section>

      <section className={panel}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => act(() => api.post("/crypto/admin/check"), (d) => d.ran ? `Vérification effectuée : ${JSON.stringify(d.results)}` : `Non exécutée (${d.reason})`)} data-testid="binance-check-now"><RefreshCw className="mr-1 h-4 w-4" />Vérifier les dépôts maintenant</Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => api.get("/crypto/admin/networks").then((r) => setNetworks(r.data.networks)).catch((e) => toast.error(errorMessage(e)))} data-testid="binance-load-networks">Réseaux USDT Binance (live)</Button>
        </div>
        {networks && (
          <div className="mt-3 overflow-x-auto text-xs" data-testid="binance-networks-list">
            {networks.map((n) => <p key={n.network} className="py-0.5"><b>{n.network}</b> {n.name} · dépôt {n.depositEnable ? "ON" : "OFF"} · memo {n.memoRegex ? "oui" : "non"} · {n.minConfirm} conf.{n.mgs_key ? ` · MGS ${n.mgs_key}` : ""}</p>)}
          </div>
        )}
      </section>

      <section className={panel} data-testid="binance-unmatched">
        <p className="eyebrow">Dépôts non associés (revue manuelle) · {unmatched.length}</p>
        {unmatched.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Aucun dépôt à revoir.</p>}
        {unmatched.map((u) => (
          <div key={u.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <div className="min-w-0"><p className="font-bold">{u.amount} USDT · {u.network} · <span className="text-rose-600">{u.reason}</span></p><p className="break-all font-mono text-muted-foreground">{u.tx_hash}</p></div>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => act(() => api.patch(`/crypto/admin/unmatched/${u.id}`), () => "Marqué comme revu.")} data-testid={`binance-unmatched-review-${u.id}`}>Marquer revu</Button>
          </div>
        ))}
      </section>

      <section className={panel} data-testid="binance-payments">
        <p className="eyebrow">Paiements USDT récents</p>
        {payments.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Aucun paiement USDT.</p>}
        {payments.map((p) => (
          <div key={p.id} className="mt-2 grid gap-1 border-t border-border pt-2 text-xs sm:grid-cols-[1fr_auto]" data-testid={`binance-payment-${p.id}`}>
            <div className="min-w-0"><p className="font-bold">{p.order_number} · {p.amount_usdt} USDT · {p.network} · taux {p.rate_ar_per_usdt} Ar</p>{p.tx_hash && <p className="break-all font-mono text-muted-foreground">{p.tx_hash}</p>}</div>
            <span className={`self-start rounded-full border px-2 py-0.5 font-black ${p.status === "CONFIRMED" ? "border-foreground bg-primary text-[#0A0A0A]" : p.status === "FAILED" ? "border-rose-300 text-rose-600" : "border-[color:var(--rule-strong)]"}`}>{p.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
