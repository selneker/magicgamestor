import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const EMPTY = { name: "", type: "uc", cost_points: 500, value: 60, description: "", active: true, stock: "" };
const SETTING_FIELDS = [["points_per_1000_ar", "Points par 1 000 Ar payés"], ["min_order_total", "Total minimum (Ar) pour gagner"], ["transfer_min", "Transfert minimum (pts)"], ["transfer_daily_limit", "Limite transfert / jour"], ["transfer_monthly_limit", "Limite transfert / mois"]];

export default function AdminLoyalty() {
  const [settings, setSettings] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [adjust, setAdjust] = useState({ user_email: "", amount: "", reason: "", bucket: "promo" });

  const load = useCallback(() => {
    api.get("/loyalty/admin/settings").then((r) => setSettings(r.data));
    api.get("/loyalty/admin/rewards").then((r) => setRewards(r.data));
    api.get("/loyalty/admin/redemptions", { params: { status: "pending" } }).then((r) => setRedemptions(r.data));
  }, []);
  useEffect(load, [load]);

  const saveSettings = async (patch) => { try { const { data } = await api.patch("/loyalty/admin/settings", patch); setSettings(data); toast.success("Paramètres enregistrés"); } catch (e) { toast.error(errorMessage(e)); } };
  const createReward = async (e) => {
    e.preventDefault();
    try { await api.post("/loyalty/admin/rewards", { ...form, cost_points: Number(form.cost_points), value: Number(form.value), stock: form.stock === "" ? null : Number(form.stock), description: form.description || null }); setForm(EMPTY); load(); toast.success("Récompense créée"); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const toggleReward = async (r) => { try { await api.patch(`/loyalty/admin/rewards/${r.id}`, { name: r.name, type: r.type, cost_points: r.cost_points, value: r.value, description: r.description, active: !r.active, stock: r.stock ?? null }); load(); } catch (e) { toast.error(errorMessage(e)); } };
  const resolve = async (id, action) => { try { await api.post(`/loyalty/admin/redemptions/${id}/${action}`); load(); } catch (e) { toast.error(errorMessage(e)); } };
  const doAdjust = async (e) => {
    e.preventDefault();
    try { const { data } = await api.post("/loyalty/admin/adjust", { ...adjust, amount: Number(adjust.amount) }); toast.success(`Nouveau solde : ${data.balance.total} pts`); setAdjust({ user_email: "", amount: "", reason: "", bucket: "promo" }); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  if (!settings) return <p className="text-slate-500">Chargement…</p>;
  return (
    <div className="space-y-6" data-testid="admin-loyalty">
      <h1 className="font-display text-2xl font-bold">Fidélité</h1>
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Paramètres économiques</h2>
          <label className="flex items-center gap-2 text-sm">Programme actif <Switch checked={settings.enabled} onCheckedChange={(v) => saveSettings({ enabled: v })} data-testid="loyalty-enabled-switch" /></label>
          <label className="flex items-center gap-2 text-sm">Transferts <Switch checked={settings.transfers_enabled} onCheckedChange={(v) => saveSettings({ transfers_enabled: v })} data-testid="loyalty-transfers-switch" /></label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTING_FIELDS.map(([key, label]) => (
            <div key={key}><label htmlFor={`s-${key}`} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
              <Input id={`s-${key}`} type="number" defaultValue={settings[key]} onBlur={(e) => Number(e.target.value) !== settings[key] && saveSettings({ [key]: Number(e.target.value) })} className="mt-1 h-10 rounded-xl" data-testid={`loyalty-setting-${key}`} /></div>
          ))}
        </div>
      </section>
      <section className="panel p-5">
        <h2 className="font-display text-lg font-bold">Récompenses</h2>
        <form onSubmit={createReward} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Input required placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10 rounded-xl lg:col-span-2" data-testid="reward-name-input" aria-label="Nom" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="h-10 rounded-xl border bg-background px-2 text-sm" data-testid="reward-type-select" aria-label="Type">{["uc", "discount", "bonus", "event"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <Input type="number" required min={1} placeholder="Coût (pts)" value={form.cost_points} onChange={(e) => setForm({ ...form, cost_points: e.target.value })} className="h-10 rounded-xl" data-testid="reward-cost-input" aria-label="Coût" />
          <Input type="number" required min={0} placeholder="Valeur (UC/Ar)" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="h-10 rounded-xl" data-testid="reward-value-input" aria-label="Valeur" />
          <Input type="number" min={0} placeholder="Stock (vide = ∞)" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="h-10 rounded-xl" data-testid="reward-stock-input" aria-label="Stock" />
          <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-10 rounded-xl lg:col-span-5" aria-label="Description" />
          <Button type="submit" className="h-10 rounded-full font-semibold" data-testid="reward-create-submit">Créer</Button>
        </form>
        <ul className="mt-4 divide-y text-sm">
          {rewards.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2" data-testid={`admin-reward-${r.id}`}><span>{r.name} · <span className="uppercase text-xs">{r.type}</span> · {r.cost_points} pts → {r.value}{r.stock != null ? ` · stock ${r.stock}` : ""}</span><Switch checked={r.active} onCheckedChange={() => toggleReward(r)} data-testid={`reward-toggle-${r.id}`} /></li>)}
        </ul>
      </section>
      <section className="panel p-5">
        <h2 className="font-display text-lg font-bold">Échanges à traiter ({redemptions.length})</h2>
        <ul className="mt-3 divide-y text-sm" data-testid="admin-redemptions">
          {redemptions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`redemption-${r.id}`}>
              <span>{r.reward_name} · {r.cost_points} pts · PUBG {r.pubg_id || "—"} · {new Date(r.created_at).toLocaleString("fr-FR")}</span>
              <span className="flex gap-2"><Button size="sm" onClick={() => resolve(r.id, "fulfill")} className="rounded-full" data-testid={`fulfill-${r.id}`}>Livré</Button><Button size="sm" variant="outline" onClick={() => resolve(r.id, "cancel")} className="rounded-full" data-testid={`cancel-redemption-${r.id}`}>Annuler + rembourser</Button></span>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel p-5">
        <h2 className="font-display text-lg font-bold">Ajustement manuel (journalisé)</h2>
        <form onSubmit={doAdjust} className="mt-3 grid gap-2 sm:grid-cols-5">
          <Input type="email" required placeholder="Email client" value={adjust.user_email} onChange={(e) => setAdjust({ ...adjust, user_email: e.target.value })} className="h-10 rounded-xl sm:col-span-2" data-testid="adjust-email-input" aria-label="Email" />
          <Input type="number" required placeholder="+/- points" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} className="h-10 rounded-xl" data-testid="adjust-amount-input" aria-label="Points" />
          <select value={adjust.bucket} onChange={(e) => setAdjust({ ...adjust, bucket: e.target.value })} className="h-10 rounded-xl border bg-background px-2 text-sm" aria-label="Type de points"><option value="promo">promo</option><option value="earned">earned</option></select>
          <Button type="submit" className="h-10 rounded-full font-semibold" data-testid="adjust-submit">Appliquer</Button>
          <Input required minLength={3} placeholder="Raison (obligatoire)" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} className="h-10 rounded-xl sm:col-span-5" data-testid="adjust-reason-input" aria-label="Raison" />
        </form>
      </section>
    </div>
  );
}
