import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useLang } from "@/context/LanguageContext";
import { useGames } from "@/context/GameContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fieldError } from "@/components/store/checkout/IdentityFieldsVerify";

const fieldLabel = (f, lang) => (lang === "en" && f.label_en) || f.label || f.key;

function IdentityForm({ spec, form, setForm, onSubmit, onCancel, busy }) {
  const { t, lang } = useLang();
  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t bg-muted/50 px-4 py-4" data-testid="identity-form">
      <div><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="ident-label">{t("account.identities.label")}</label><Input id="ident-label" data-testid="identity-label-input" value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} className="mt-1 h-11" placeholder="Compte principal" /></div>
      {spec.map((f) => (
        <div key={f.key}>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor={`ident-${f.key}`}>{fieldLabel(f, lang)}</label>
          <Input id={`ident-${f.key}`} data-testid={f.key === "player_id" ? "identity-player-id-input" : `identity-input-${f.key}`} value={form.fields[f.key] || ""} required={f.required !== false}
            maxLength={f.max_length || undefined} onChange={(e) => setForm({ ...form, fields: { ...form.fields, [f.key]: e.target.value.trim() } })} className="mt-1 h-11 num" />
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-full font-semibold" data-testid="identity-cancel">{t("account.identities.cancel")}</Button>
        <Button type="submit" disabled={busy} className="flex-1 rounded-full font-semibold" data-testid="identity-save">{t("account.identities.save")}</Button>
      </div>
    </form>
  );
}

// Saved player identities, per game, following each game's declared identity fields.
export function GameIdentities() {
  const { t, lang } = useLang();
  const { games } = useGames();
  const [gameId, setGameId] = useState(games[0]?.id || "pubg-mobile");
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const game = games.find((g) => g.id === gameId) || games[0];
  const spec = useMemo(() => game?.identity_fields || [], [game]);

  const load = () => api.get("/me/game-identities", { params: { game_id: gameId } }).then((r) => setItems(r.data)).catch(() => setItems([]));
  useEffect(() => { setForm(null); load(); }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (spec.some((f) => fieldError(f, form.fields[f.key]))) return toast.error(t("account.identities.invalid"));
    setBusy(true);
    const primary = spec.find((f) => f.primary)?.key || spec[0]?.key;
    const fields = Object.fromEntries(spec.map((f) => [f.key, form.fields[f.key] || ""]).filter(([, v]) => v));
    const body = { label: form.label.trim() || `${game?.name || ""} ${fields[primary] || ""}`.trim().slice(0, 40), fields };
    try {
      if (form.id) await api.patch(`/me/game-identities/${form.id}`, body);
      else await api.post("/me/game-identities", { ...body, game_id: gameId });
      toast.success(t("account.identities.saved")); setForm(null); load();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    try { await api.delete(`/me/game-identities/${id}`); toast.success(t("account.identities.removed")); load(); }
    catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <div data-testid="game-identities">
      {games.length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto border-b px-4 py-3" role="tablist" data-testid="identity-game-tabs">
          {games.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === gameId} onClick={() => setGameId(g.id)} data-testid={`identity-game-${g.id}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${g.id === gameId ? "bg-primary text-[#0A0A0A]" : "text-muted-foreground hover:bg-muted"}`}>{g.name}</button>
          ))}
        </div>
      )}
      {items.length === 0 && !form && <p className="px-4 py-3.5 text-[13px] text-muted-foreground" data-testid="identities-empty">{t("account.identities.empty")}</p>}
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-3.5 px-4 py-3.5" data-testid={`identity-row-${it.id}`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{it.label}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground num">{game?.name} · {Object.entries(it.fields || {}).map(([k, v]) => `${fieldLabel(spec.find((f) => f.key === k) || { key: k }, lang)} ${v}`).join(" · ")}</span>
          </span>
          <button type="button" aria-label={t("account.identities.edit")} onClick={() => setForm({ id: it.id, label: it.label, fields: { ...it.fields } })} className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--rule-strong)] transition-colors hover:bg-muted" data-testid={`identity-edit-${it.id}`}><Pencil className="h-4 w-4" /></button>
          <button type="button" aria-label={t("account.identities.remove")} onClick={() => remove(it.id)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--rule-strong)] text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground" data-testid={`identity-delete-${it.id}`}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      {form ? (
        <IdentityForm spec={spec} form={form} setForm={setForm} onSubmit={submit} onCancel={() => setForm(null)} busy={busy} />
      ) : spec.length > 0 && (
        <button type="button" onClick={() => setForm({ id: null, label: "", fields: {} })} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left text-[13px] font-semibold transition-colors hover:bg-muted" data-testid="identity-add">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-[#0A0A0A]"><Plus className="h-[18px] w-[18px]" /></span>
          {t("account.identities.add")}
        </button>
      )}
    </div>
  );
}
