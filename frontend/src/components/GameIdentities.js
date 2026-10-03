import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const GAME_ID = "pubg-mobile";
const EMPTY = { id: null, label: "", player_id: "" };
const validPubg = (v) => /^\d{9,13}$/.test(v);

function IdentityForm({ form, setForm, onSubmit, onCancel, busy }) {
  const { t } = useLang();
  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t bg-muted/50 px-4 py-4" data-testid="identity-form">
      <div><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="ident-label">{t("account.identities.label")}</label><Input id="ident-label" data-testid="identity-label-input" value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} className="mt-1 h-11" placeholder="Compte principal" /></div>
      <div><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="ident-pid">{t("account.identities.playerId")}</label><Input id="ident-pid" data-testid="identity-player-id-input" inputMode="numeric" value={form.player_id} onChange={(e) => setForm({ ...form, player_id: e.target.value.replace(/\D/g, "") })} required className="mt-1 h-11 num" placeholder="5123456789" /></div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-full font-semibold" data-testid="identity-cancel">{t("account.identities.cancel")}</Button>
        <Button type="submit" disabled={busy} className="flex-1 rounded-full font-semibold" data-testid="identity-save">{t("account.identities.save")}</Button>
      </div>
    </form>
  );
}

export function GameIdentities() {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/me/game-identities", { params: { game_id: GAME_ID } }).then((r) => setItems(r.data)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!validPubg(form.player_id)) return toast.error(t("account.identities.invalid"));
    setBusy(true);
    const body = { label: form.label.trim() || `PUBG ${form.player_id}`, fields: { player_id: form.player_id } };
    try {
      if (form.id) await api.patch(`/me/game-identities/${form.id}`, body);
      else await api.post("/me/game-identities", { ...body, game_id: GAME_ID });
      toast.success(t("account.identities.saved")); setForm(null); load();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    try { await api.delete(`/me/game-identities/${id}`); toast.success(t("account.identities.removed")); load(); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <div data-testid="game-identities">
      {items.length === 0 && !form && <p className="px-4 py-3.5 text-[13px] text-muted-foreground" data-testid="identities-empty">{t("account.identities.empty")}</p>}
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-3.5 px-4 py-3.5" data-testid={`identity-row-${it.id}`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{it.label}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground num">PUBG ID · {it.fields?.player_id}</span>
          </span>
          <button type="button" aria-label={t("account.identities.edit")} onClick={() => setForm({ id: it.id, label: it.label, player_id: it.fields?.player_id || "" })} className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--rule-strong)] transition-colors hover:bg-muted" data-testid={`identity-edit-${it.id}`}><Pencil className="h-4 w-4" /></button>
          <button type="button" aria-label={t("account.identities.remove")} onClick={() => remove(it.id)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--rule-strong)] text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground" data-testid={`identity-delete-${it.id}`}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      {form ? (
        <IdentityForm form={form} setForm={setForm} onSubmit={submit} onCancel={() => setForm(null)} busy={busy} />
      ) : (
        <button type="button" onClick={() => setForm(EMPTY)} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left text-[13px] font-semibold transition-colors hover:bg-muted" data-testid="identity-add">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-[#0A0A0A]"><Plus className="h-[18px] w-[18px]" /></span>
          {t("account.identities.add")}
        </button>
      )}
    </div>
  );
}
